import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import fetch from 'node-fetch'
import { Config } from '../config.js'
import { makeForwardMsg } from '../common.js'
import { hidePrivacyInfo } from '../paimonFuction.js'
import {
  prepareInputs,
  processOutputFiles,
  readStreamResponse,
  validatedApiUrl
} from '../sandboxIO.js'
import { AbstractTool } from './AbstractTool.js'

const RETRYABLE_STATUS = new Set([502, 503, 504])
const MAX_CALL_FORWARD_CHARS = 6000

const vercelSandboxSessionLocks = globalThis.__vercelSandboxSessionLocks || new Map()
globalThis.__vercelSandboxSessionLocks = vercelSandboxSessionLocks

async function withSessionLock(sessionId, task) {
  const previous = vercelSandboxSessionLocks.get(sessionId) || Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  vercelSandboxSessionLocks.set(sessionId, current)
  try {
    return await current
  } finally {
    if (vercelSandboxSessionLocks.get(sessionId) === current) {
      vercelSandboxSessionLocks.delete(sessionId)
    }
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value)
  const normalized = Number.isFinite(number) ? Math.round(number) : fallback
  return Math.max(min, Math.min(max, normalized))
}

function screenshotCommand(args = {}) {
  const url = typeof args.screenshot_url === 'string' ? args.screenshot_url.trim() : ''
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) throw new Error('screenshot_url 必须使用 http:// 或 https://')

  const width = boundedInteger(args.screenshot_width, 1440, 320, 3840)
  const height = boundedInteger(args.screenshot_height, 900, 240, 2160)
  const waitMs = boundedInteger(args.screenshot_wait_ms, 2000, 0, 30000)
  const parts = [
    'node',
    '/app/tools/web_capture.mjs',
    shellQuote(url),
    '--output',
    'outputs/webpage.png',
    '--width',
    String(width),
    '--height',
    String(height),
    '--wait-ms',
    String(waitMs),
    '--timeout-ms',
    '90000'
  ]
  if (args.screenshot_full_page !== false) parts.push('--full-page')
  return parts.join(' ')
}

function buildCallForwardBatches(command, result) {
  const sourceMessage = `执行源码：\n${command || '(空)'}`
  const resultMessage = `执行结果：\n${hidePrivacyInfo(String(result ?? ''))}`
  if (sourceMessage.length + resultMessage.length <= MAX_CALL_FORWARD_CHARS) {
    return [{ title: 'Vercel 沙箱调用', messages: [sourceMessage, resultMessage] }]
  }
  return [
    { title: 'Vercel 沙箱调用 1/2（源码）', messages: [sourceMessage] },
    { title: 'Vercel 沙箱调用 2/2（结果）', messages: [resultMessage] }
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
  const bot = e?.bot?.uin || e?.self_id || e?.bot_id || 'bot'
  const scope = e?.group_id || e?.group?.group_id || 'private'
  const user = e?.user_id || e?.sender?.user_id || e?.sender?.userId || 'owner'
  return `chat-${bot}-${scope}-${user}`
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .slice(0, 64)
}

function emptyPreparedInputs() {
  return {
    inputUrls: [],
    inputFiles: [],
    imagePaths: [],
    mediaPaths: [],
    inputPaths: []
  }
}

function wrapSandboxCommand(command) {
  return `
SANDBOX_SESSION_DIR="$PWD"
export SANDBOX_SESSION_DIR
export SANDBOX_INPUT_DIR="$SANDBOX_SESSION_DIR/inputs"
export SANDBOX_OUTPUT_DIR="$SANDBOX_SESSION_DIR/outputs"
mkdir -p "$SANDBOX_INPUT_DIR" "$SANDBOX_OUTPUT_DIR"
if command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/vercel-sandbox-io.lock
  flock 9
fi
trap 'rm -rf /tmp/inputs /tmp/outputs' EXIT
rm -rf /tmp/inputs /tmp/outputs
ln -s "$SANDBOX_INPUT_DIR" /tmp/inputs
ln -s "$SANDBOX_OUTPUT_DIR" /tmp/outputs
${command}
`
}

export class VercelSandboxTool extends AbstractTool {
  name = 'vercelSandbox'

  description =
    '在用户配置的 Vercel 远程沙箱中执行联网 Shell、Python、Node.js、编译和文件处理命令。' +
    '当前消息或引用消息中的图片、视频、音频会写入 inputs/；输入路径分别写入 SANDBOX_INPUT_IMAGES、SANDBOX_INPUT_MEDIA 和 SANDBOX_INPUT_FILES。' +
    '请把生成或处理后的图片、视频、音频和需要交付的文件保存到 outputs/，工具会自动读取并直接发送给用户。' +
    '仅在确有文件交付需求时才产出文件，普通问答不要凭空生成文件，中间产物请写到会话目录或 /tmp 而非 outputs/。' +
    '生成文档可直接用已预装的 python-docx(Word)、openpyxl(Excel)、reportlab(PDF, 支持内置 CJK 字体)、pypdf(读取/合并 PDF)。' +
    '如果输出只作为中间结果、暂不发给用户，可设置 send_output_media=false 或 send_output_files=false。' +
    '即使命令执行 cd /tmp，/tmp/inputs 和 /tmp/outputs 也会自动映射回当前会话目录。' +
    '输出媒体通过流式接口返回，合计默认不超过 64MB；图片优先使用 JPEG/WebP，音频优先使用 MP3，视频优先使用 H.264/AAC MP4。' +
    '需要打开网页并截图时，优先填写 screenshot_url，不要自行安装 Puppeteer；沙盒已预装 Chromium、Puppeteer 和中文字体，截图会自动发送。' +
    'command 与 screenshot_url 至少填写一个；两者同时填写时会先截图再执行 command。' +
    '处理图片/GIF 时可直接使用 /app/tools/media_edit.py；GIF 会先合成完整帧再翻转或倒放，避免残影。' +
    '常用 Pillow、OpenCV、scikit-image、imageio、matplotlib、FFmpeg 和 ImageMagick 已预装。动态依赖和会话文件只在当前热实例存活期间复用。'

  parameters = {
    properties: {
      command: {
        type: 'string',
        description:
          '可选。要执行的完整 Shell 命令。与 screenshot_url 至少填写一个。输入位于 inputs/，需要回传的文件必须写入 outputs/；cd /tmp 后使用 inputs/outputs/ 仍然有效。'
      },
      screenshot_url: {
        type: 'string',
        description: '可选。要打开并截图的 http/https 网页地址。填写后由沙盒内置 Chromium 截图并自动发送，无需在 command 中编写 Puppeteer。'
      },
      screenshot_full_page: {
        type: 'boolean',
        description: '网页截图是否截取完整页面，默认 true。'
      },
      screenshot_width: {
        type: 'number',
        description: '网页截图视口宽度，默认 1440，范围 320-3840。'
      },
      screenshot_height: {
        type: 'number',
        description: '网页截图视口高度，默认 900，范围 240-2160。'
      },
      screenshot_wait_ms: {
        type: 'number',
        description: '页面基本加载完成后额外等待的毫秒数，默认 2000，最大 30000，可设为 0。'
      },
      session_id: {
        type: 'string',
        description:
          '可选会话 ID。Vercel 热实例未缩容时可复用文件和动态依赖，但不保证持久化。不填写时会按机器人、群和用户自动隔离。'
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
        description: '是否自动发送 outputs/ 中的普通附件，默认 true。'
      }
    },
    required: []
  }

  func = async function (args, e) {
    let command = typeof args?.command === 'string' ? args.command.trim() : ''
    const finish = async result => {
      await sendCallForward(e, command, result)
      return result
    }

    const apiUrl = validatedApiUrl(Config.sandboxApiUrl)
    const token = String(Config.sandboxToken || '').trim()
    if (!apiUrl) return await finish('vercelSandbox 尚未配置有效的 API URL，请在锅巴中填写 sandboxApiUrl。')
    if (!token) return await finish('vercelSandbox 尚未配置鉴权 Token，请在锅巴中填写 sandboxToken。')

    try {
      const capture = screenshotCommand(args)
      if (capture) command = command ? `${capture}\n${command}` : capture
    } catch (error) {
      return await finish(error?.message || String(error))
    }
    if (!command) return await finish('command 和 screenshot_url 至少需要填写一个')

    const sessionId = typeof args?.session_id === 'string' && args.session_id.trim()
      ? args.session_id.trim()
      : defaultSessionId(e)

    return await withSessionLock(sessionId, async () => {
      const preparedInputs = args?.use_message_images === false
        ? emptyPreparedInputs()
        : await prepareInputs(e)
      const preparedCommand = wrapSandboxCommand(command)
      const timeoutSeconds = Math.max(1, Math.min(300, Number(args.timeout_seconds) || 120))
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), (timeoutSeconds + 180) * 1000)
      const requestBody = JSON.stringify({
        command: preparedCommand,
        session_id: sessionId,
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
          await response.arrayBuffer().catch(() => { })
          await new Promise(resolve => setTimeout(resolve, 1500))
        }

        if (!response?.ok) {
          const responseText = response ? await response.text() : 'no response'
          return await finish(`沙箱请求失败，HTTP ${response?.status || 'unknown'}: ${responseText.slice(0, 1000)}`)
        }

        temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'vercel-sandbox-'))
        const { result, files } = await readStreamResponse(response, temporaryDirectory)
        const { sent, sendErrors } = await processOutputFiles(e, files, {
          sendMedia: args?.send_output_media !== false && args?.send_output_images !== false,
          sendFiles: args?.send_output_files !== false
        })
        const totalSent = sent.images + sent.videos + sent.audios + sent.files

        return await finish(JSON.stringify({
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
        }))
      } catch (error) {
        if (error?.name === 'AbortError') return await finish('沙箱请求超时')
        return await finish(`沙箱调用失败: ${error?.message || error}`)
      } finally {
        clearTimeout(timer)
        if (temporaryDirectory) {
          await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => { })
        }
      }
    })
  }
}
