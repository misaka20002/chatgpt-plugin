import { appendFile, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_REFERENCE_IMAGES = 6
const MAX_INPUT_FILES = 16
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

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
    globalThis.logger?.warn?.(`[sandboxIO] 获取消息附件失败: ${error?.message || error}`)
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
    globalThis.logger?.warn?.(`[sandboxIO] 获取引用消息失败: ${error?.message || error}`)
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
      globalThis.logger?.warn?.(`[sandboxIO] 跳过附件 ${inputPath}: ${error?.message || error}`)
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
      globalThis.logger?.error?.(`[sandboxIO] 发送输出文件失败: ${file.path} -> ${message}`)
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

