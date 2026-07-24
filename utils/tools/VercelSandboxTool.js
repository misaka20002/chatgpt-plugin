import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fetch from 'node-fetch'
import { Config } from '../config.js'
import { makeForwardMsg } from '../common.js'
import { AbstractTool } from './AbstractTool.js'

const MAX_REFERENCE_IMAGES = 6
const MAX_INPUT_FILES = 16
const RETRYABLE_STATUS = new Set([502, 503, 504])
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/
const MAX_CALL_FORWARD_CHARS = 6000

function buildCallForwardBatches(command, result) {
  const sourceMessage = `执行源码：\n${command || '(空)'}`
  const resultMessage = `执行结果：\n${String(result ?? '')}`
  if (sourceMessage.length + resultMessage.length <= MAX_CALL_FORWARD_CHARS) {
    return [{ title: '远程沙箱调用', messages: [sourceMessage, resultMessage] }]
  }
  return [
    { title: '远程沙箱调用 1/2（源码）', messages: [sourceMessage] },
    { title: '远程沙箱调用 2/2（结果）', messages: [resultMessage] }
  ]
}

async function sendCallForward(e, command, result) {
  if (!Config.vercelSandboxSendCallForward || !e?.reply) return
  try {
    for (const batch of buildCallForwardBatches(command, result)) {
      await e.reply(await makeForwardMsg(e, batch.messages, batch.title))
    }
  } catch (error) {
    globalThis.logger?.warn?.(`[vercelSandbox] 发送源码与结果合并转发失败: ${error?.message || error}`)
  }
}

function defaultSessionId(e) {
  const scope = e?.group_id || e?.group?.group_id || 'private'
  const user = e?.user_id || e?.sender?.user_id || e?.sender?.userId || 'owner'
  return `chat-${scope}-${user}`
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .slice(0, 64)
}

function extensionFromSource(source, fallback) {
  try {
    const pathname = source.startsWith('file:')
      ? fileURLToPath(source)
      : new URL(source).pathname
    const extension = path.extname(pathname).toLowerCase()
    if (/^\.[a-z0-9]{1,10}$/i.test(extension)) return extension
  } catch {
    const extension = path.extname(source).toLowerCase()
    if (/^\.[a-z0-9]{1,10}$/i.test(extension)) return extension
  }
  return fallback
}

function extensionFromMime(mimeType, fallback = '.bin') {
  const mimeMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav'
  }
  return mimeMap[String(mimeType || '').toLowerCase()] || fallback
}

function mediaMimeType(item, mediaType) {
  return item?.mimeType || item?.mime_type || (
    mediaType === 'video' ? 'video/mp4' :
      mediaType === 'audio' ? 'audio/mpeg' : 'image/jpeg'
  )
}

async function resolveMessageMedia(e, item) {
  const direct = item?.url || item?.path
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (
    typeof item?.file === 'string' &&
    (/^(?:https?:\/\/|data:|base64:\/\/|file:\/\/)/i.test(item.file) || path.isAbsolute(item.file))
  ) {
    return item.file.trim()
  }
  const fileId = item?.file_id || item?.id || item?.fid || item?.file
  if (!fileId) return ''
  try {
    let result
    if (e?.isGroup) {
      if (item?.type === 'file' && typeof e.group?.fs?.download === 'function') {
        result = await e.group.fs.download(fileId, item.busid || 0)
      } else if (typeof e.group?.getFileUrl === 'function') {
        result = await e.group.getFileUrl(fileId)
      } else if (typeof e.group?.getLocalFileInfo === 'function') {
        result = await e.group.getLocalFileInfo(fileId)
      }
    } else if (typeof e?.friend?.getLocalFileInfo === 'function') {
      result = await e.friend.getLocalFileInfo(fileId)
    } else if (typeof e?.friend?.getFileUrl === 'function') {
      result = await e.friend.getFileUrl(fileId)
    }
    if (typeof result === 'string') return result
    return result?.url || result?.data?.url || result?.file || result?.data?.file || ''
  } catch (error) {
    globalThis.logger?.warn?.(`[vercelSandbox] 获取消息附件失败: ${error?.message || error}`)
    return ''
  }
}

async function getReplyMessage(e) {
  if (!e?.source && !e?.reply_id) return []
  try {
    if (e.reply_id && typeof e.getReply === 'function') {
      return (await e.getReply(e.reply_id))?.message || []
    }
    if (e.isGroup && e.group?.getChatHistory) {
      return (await e.group.getChatHistory(e.source.seq, 1)).pop()?.message || []
    }
    if (e.friend?.getChatHistory) {
      return (await e.friend.getChatHistory(e.source.time, 1)).pop()?.message || []
    }
  } catch (error) {
    globalThis.logger?.warn?.(`[vercelSandbox] 获取引用消息失败: ${error?.message || error}`)
  }
  return []
}

async function collectMediaInputs(e) {
  const images = []
  const media = []
  const seen = new Set()

  const add = (target, type, source, mimeType) => {
    if (typeof source !== 'string' || !source.trim()) return
    const normalized = source.trim()
    const key = `${type}:${normalized}`
    if (seen.has(key)) return
    seen.add(key)
    target.push({ type, source: normalized, mimeType })
  }

  const messages = [
    ...(Array.isArray(e?.message) ? e.message : []),
    ...await getReplyMessage(e)
  ]
  for (const item of messages) {
    if (item?.type === 'image') {
      add(images, 'image', await resolveMessageMedia(e, item), mediaMimeType(item, 'image'))
    } else if (['video', 'record', 'audio'].includes(item?.type)) {
      const type = item.type === 'video' ? 'video' : 'audio'
      add(media, type, await resolveMessageMedia(e, item), mediaMimeType(item, type))
    }
  }

  const isAtAvatarFallback = e?.at && !e?.source && !e?.reply_id && images.length === 0
  if (!isAtAvatarFallback) {
    for (const source of Array.isArray(e?.img) ? e.img : []) {
      add(images, 'image', source, 'image/jpeg')
    }
  }

  for (const item of Array.isArray(e?.get_Video) ? e.get_Video : []) {
    add(media, 'video', item?.url, mediaMimeType(item, 'video'))
  }

  return [
    ...images.slice(0, MAX_REFERENCE_IMAGES),
    ...media
  ].slice(0, MAX_INPUT_FILES)
}

async function inlineInput(source) {
  if (source.startsWith('base64://')) {
    const content = source.slice('base64://'.length)
    if (content.length % 4 !== 0 || !BASE64_PATTERN.test(content)) {
      throw new Error('附件包含无效 Base64 数据')
    }
    return content
  }
  if (source.startsWith('data:')) {
    const match = source.match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/]*={0,2})$/i)
    if (!match) throw new Error('不支持的 data URL，仅接受 Base64 编码')
    return match[2]
  }

  let localPath = source
  if (source.startsWith('file://')) localPath = fileURLToPath(source)
  if (/^[A-Za-z]:[\\/]/.test(localPath) || path.isAbsolute(localPath)) {
    return (await readFile(localPath)).toString('base64')
  }

  throw new Error(`不支持的附件地址: ${source.slice(0, 120)}`)
}

export async function prepareInputs(e) {
  const candidates = await collectMediaInputs(e)
  const inputUrls = []
  const inputFiles = []
  const imagePaths = []
  const mediaPaths = []

  for (const candidate of candidates) {
    const isImage = candidate.type === 'image'
    const index = isImage ? imagePaths.length + 1 : mediaPaths.length + 1
    const fallback = candidate.type === 'video' ? '.mp4' : candidate.type === 'audio' ? '.mp3' : '.img'
    const extension = isImage
      ? '.img'
      : extensionFromSource(candidate.source, extensionFromMime(candidate.mimeType, fallback))
    const inputPath = isImage
      ? `inputs/reference_${index}${extension}`
      : `inputs/media_${index}${extension}`

    try {
      if (/^https?:\/\//i.test(candidate.source)) {
        if (candidate.source.length > 4000) throw new Error('附件 URL 超过远端限制')
        inputUrls.push({ path: inputPath, url: candidate.source })
      } else {
        inputFiles.push({
          path: inputPath,
          content_base64: await inlineInput(candidate.source)
        })
      }
      if (isImage) imagePaths.push(inputPath)
      else mediaPaths.push(inputPath)
    } catch (error) {
      globalThis.logger?.warn?.(`[vercelSandbox] 跳过附件 ${inputPath}: ${error?.message || error}`)
    }
  }

  return {
    inputUrls,
    inputFiles,
    imagePaths,
    mediaPaths,
    inputPaths: [...imagePaths, ...mediaPaths]
  }
}

export function safeOutputName(remotePath, index = 0) {
  const fallback = `sandbox-output-${index + 1}.bin`
  let name = path.posix.basename(String(remotePath || '').replace(/\\/g, '/')) || fallback
  name = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`
  return name || fallback
}

function outputKind(file) {
  const mimeType = String(file?.mime_type || '').toLowerCase()
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

function localOutputPath(directory, file, index) {
  const name = safeOutputName(file?.path, index)
  return path.join(directory, `${index + 1}-${Math.random().toString(36).slice(2)}-${name}`)
}

async function* responseChunks(body) {
  if (!body) throw new Error('沙箱流式响应缺少响应体')
  if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) yield chunk
    return
  }
  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) return
      yield value
    }
  }
  throw new Error('当前 Node.js fetch 不支持流式响应')
}

function decodeBase64Chunk(content) {
  if (
    typeof content !== 'string' ||
    content.length % 4 !== 0 ||
    !BASE64_PATTERN.test(content)
  ) {
    throw new Error('沙箱返回了损坏的文件分片')
  }
  return Buffer.from(content, 'base64')
}

export async function readStreamResponse(response, directory) {
  const decoder = new TextDecoder()
  let pending = ''
  let result
  let files = []
  let ended = false

  const handleLine = async (line) => {
    if (!line.trim()) return
    let event
    try {
      event = JSON.parse(line)
    } catch (error) {
      throw new Error(`沙箱返回了无效 NDJSON: ${error.message}`)
    }

    if (event.type === 'result') {
      if (result) throw new Error('沙箱流式响应包含重复执行结果')
      result = event.data
      files = (Array.isArray(result?.files) ? result.files : []).map((file, index) => ({
        ...file,
        name: safeOutputName(file?.path, index),
        local_path: localOutputPath(directory, file, index)
      }))
      for (const file of files) await writeFile(file.local_path, Buffer.alloc(0))
      return
    }

    if (event.type === 'file_chunk') {
      if (!result) throw new Error('沙箱在执行结果之前返回了文件分片')
      const file = files[event.index]
      if (!file) throw new Error(`沙箱返回了未知文件索引: ${event.index}`)
      await appendFile(file.local_path, decodeBase64Chunk(event.content_base64))
      return
    }

    if (event.type === 'end') ended = true
  }

  for await (const chunk of responseChunks(response.body)) {
    pending += decoder.decode(chunk, { stream: true })
    let newline
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      await handleLine(line)
    }
  }
  pending += decoder.decode()
  if (pending.trim()) await handleLine(pending)

  if (!result) throw new Error('沙箱流式响应缺少执行结果')
  if (!ended) throw new Error('沙箱流式响应在文件传输完成前中断')

  for (const file of files) {
    const actualSize = (await stat(file.local_path)).size
    const expectedSize = Number(file.size)
    if (Number.isFinite(expectedSize) && actualSize !== expectedSize) {
      throw new Error(`沙箱文件传输不完整: ${file.path} (${actualSize}/${expectedSize})`)
    }
  }
  return { result, files }
}

export async function processOutputFiles(e, files, options = {}) {
  const shouldSendMedia = options.sendMedia !== false
  const shouldSendFiles = options.sendFiles !== false
  const sent = { images: 0, videos: 0, audios: 0, files: 0 }
  const sendErrors = []

  for (const file of files) {
    const kind = outputKind(file)
    if ((kind === 'file' && !shouldSendFiles) || (kind !== 'file' && !shouldSendMedia)) continue
    if (!e?.reply) continue

    try {
      const fileStat = await stat(file.local_path)
      if (fileStat.size === 0) throw new Error('文件为空')

      if (kind === 'image') {
        await e.reply(segment.image(await readFile(file.local_path)))
        sent.images += 1
      } else if (kind === 'video') {
        await e.reply(segment.video(file.local_path))
        sent.videos += 1
      } else if (kind === 'audio') {
        await e.reply(segment.record(file.local_path))
        sent.audios += 1
      } else {
        await e.reply(segment.file(file.local_path, file.name))
        sent.files += 1
      }
    } catch (error) {
      const message = error?.message || String(error)
      sendErrors.push({ path: file.path, error: message })
      globalThis.logger?.error?.(`[vercelSandbox] 发送输出文件失败: ${file.path} -> ${message}`)
    }
  }

  return { sent, sendErrors }
}

export function validatedApiUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return ''
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return ''
  }
}

export class VercelSandboxTool extends AbstractTool {
  name = 'vercelSandbox'

  description =
    '在用户配置的 Vercel 远程沙箱中执行联网 Shell、Python、Node.js、编译和文件处理命令。' +
    '当前消息或引用消息中的媒体会写入 inputs/，路径列表可从 SANDBOX_INPUT_IMAGES、SANDBOX_INPUT_MEDIA 和 SANDBOX_INPUT_FILES 环境变量读取。' +
    '请根据用户要求在一次 command 中生成相应数量和类型的结果；所有需要发送给用户的文件都应分别保存到 outputs/，插件会按实际产物逐个自动发送。' +
    '标准输出和错误输出适合记录执行过程或返回简短文本；/tmp/inputs 和 /tmp/outputs 始终映射到当前会话目录。'

  parameters = {
    properties: {
      command: {
        type: 'string',
        description: '要执行的完整 Shell 命令。输入位于 inputs/，需要回传的文件必须写入 outputs/。'
      },
      session_id: {
        type: 'string',
        description: '可选会话 ID；远端热实例存活时可复用文件和动态依赖。'
      },
      timeout_seconds: {
        type: 'number',
        description: '可选超时时间，默认 120 秒，范围 1-300 秒。'
      },
      python_packages: {
        type: 'array',
        items: { type: 'string' },
        description: '可选，需要安装到当前会话 Python 环境的包。'
      },
      node_packages: {
        type: 'array',
        items: { type: 'string' },
        description: '可选，需要安装到当前会话 Node.js 环境的包。'
      },
      use_message_images: {
        type: 'boolean',
        description: '是否上传当前消息或引用消息中的图片、视频和音频，默认 true。'
      },
      send_output_images: {
        type: 'boolean',
        description: '旧兼容参数。设为 false 时不自动发送 outputs/ 中的媒体。'
      },
      send_output_media: {
        type: 'boolean',
        description: '是否自动发送 outputs/ 中的图片、视频和音频，默认 true。'
      },
      send_output_files: {
        type: 'boolean',
        description: '是否通过 segment.file 自动发送 outputs/ 中的普通附件，默认 true。'
      }
    },
    required: ['command']
  }

  func = async function (args, e) {
    const command = typeof args?.command === 'string' ? args.command.trim() : ''
    const finish = async result => {
      await sendCallForward(e, command, result)
      return result
    }
    const apiUrl = validatedApiUrl(Config.sandboxApiUrl)
    const token = String(Config.sandboxToken || '').trim()
    if (!apiUrl) return await finish('vercelSandbox 尚未配置有效的 API URL，请在锅巴中填写 sandboxApiUrl。')
    if (!token) return await finish('vercelSandbox 尚未配置鉴权 Token，请在锅巴中填写 sandboxToken。')

    if (!command) return await finish('command is required')

    const useMessageMedia = args.use_message_images !== false
    const preparedInputs = useMessageMedia
      ? await prepareInputs(e)
      : { inputUrls: [], inputFiles: [], imagePaths: [], mediaPaths: [], inputPaths: [] }
    const preparedCommand = `
SANDBOX_SESSION_DIR="$PWD"
export SANDBOX_SESSION_DIR
export SANDBOX_INPUT_DIR="$SANDBOX_SESSION_DIR/inputs"
export SANDBOX_OUTPUT_DIR="$SANDBOX_SESSION_DIR/outputs"
mkdir -p "$SANDBOX_INPUT_DIR" "$SANDBOX_OUTPUT_DIR"
rm -rf /tmp/inputs /tmp/outputs
ln -s "$SANDBOX_INPUT_DIR" /tmp/inputs
ln -s "$SANDBOX_OUTPUT_DIR" /tmp/outputs
${command}
`
    const timeoutSeconds = Math.max(1, Math.min(300, Number(args.timeout_seconds) || 120))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), (timeoutSeconds + 180) * 1000)
    const requestBody = JSON.stringify({
      command: preparedCommand,
      session_id: typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id.trim()
        : defaultSessionId(e),
      timeout_seconds: timeoutSeconds,
      python_packages: Array.isArray(args.python_packages) ? args.python_packages : [],
      node_packages: Array.isArray(args.node_packages) ? args.node_packages : [],
      input_urls: preparedInputs.inputUrls,
      input_files: preparedInputs.inputFiles,
      reset_paths: ['inputs', 'outputs'],
      output_files: ['outputs/*', 'outputs/**/*'],
      env: {
        SANDBOX_INPUT_IMAGES: JSON.stringify(preparedInputs.imagePaths),
        SANDBOX_INPUT_MEDIA: JSON.stringify(preparedInputs.mediaPaths),
        SANDBOX_INPUT_FILES: JSON.stringify(preparedInputs.inputPaths),
        SANDBOX_OUTPUT_DIR: 'outputs'
      }
    })

    let temporaryDirectory
    try {
      let response
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch(`${apiUrl}/v1/exec-stream`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: requestBody,
          signal: controller.signal
        })
        if (!RETRYABLE_STATUS.has(response.status) || attempt === 1) break
        await response.arrayBuffer().catch(() => {})
        await new Promise(resolve => setTimeout(resolve, 1500))
      }

      if (!response?.ok) {
        const responseText = response ? await response.text() : 'no response'
        return await finish(`沙箱请求失败，HTTP ${response?.status || 'unknown'}: ${responseText.slice(0, 1000)}`)
      }

      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'vercel-sandbox-'))
      const { result, files } = await readStreamResponse(response, temporaryDirectory)
      const { sent, sendErrors } = await processOutputFiles(e, files, {
        sendMedia: args.send_output_media !== false && args.send_output_images !== false,
        sendFiles: args.send_output_files !== false
      })
      const totalSent = sent.images + sent.videos + sent.audios + sent.files

      const toolResult = JSON.stringify({
        success: result.exit_code === 0,
        status: result.status,
        exit_code: result.exit_code,
        session_id: result.session_id,
        stdout: result.stdout,
        stderr: result.stderr,
        input_images: preparedInputs.imagePaths,
        input_media: preparedInputs.mediaPaths,
        input_files: preparedInputs.inputPaths,
        output_files: files.map(file => ({
          path: file.path,
          mime_type: file.mime_type,
          size: file.size
        })),
        images_sent: sent.images,
        videos_sent: sent.videos,
        audios_sent: sent.audios,
        files_sent: sent.files,
        send_errors: sendErrors,
        files_truncated: result.files_truncated,
        message: totalSent > 0
          ? `已直接发送 ${sent.images} 张图片、${sent.videos} 个视频、${sent.audios} 个音频和 ${sent.files} 个附件，无需再次调用发送工具`
          : undefined
      })
      return await finish(toolResult)
    } catch (error) {
      if (error?.name === 'AbortError') return await finish('沙箱请求超时')
      return await finish(`沙箱调用失败: ${error?.message || error}`)
    } finally {
      clearTimeout(timer)
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}
