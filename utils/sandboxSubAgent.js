import { SubLLM } from '../model/SubLLM.js'
import { getUserData } from './common.js'
import { Config } from './config.js'

const COMMON_RULES = `你是系统沙箱的执行规划子代理。根据主代理给出的任务，生成一次可安全执行的沙箱调用参数。

必须只输出一个 JSON 对象，不能使用 Markdown、代码围栏或解释文字。不要向用户回复，也不要执行工具调用。
默认继续当前用户的沙箱会话；仅当任务明确要求“新任务”“重新开始”或“清空旧文件”时才设置 new_session=true。只在确有必要时填写 python_packages 或 node_packages。当前消息和引用消息的附件默认已经可用。`

const SANDBOX_PROMPTS = {
  local: `${COMMON_RULES}

目标是 Linux/WSL2 本地隔离沙箱。你可以生成 Shell、Python、Node.js、编译、文件处理与 Chromium 命令。输入附件在 inputs/，环境变量 SANDBOX_INPUT_IMAGES、SANDBOX_INPUT_MEDIA、SANDBOX_INPUT_FILES 给出路径。必须发送给用户的图片、视频、音频、HTML、PDF、压缩包等写入 outputs/；中间文件不要写入 outputs/。inputs/ 和 outputs/ 每次调用都会清空，其他会话目录文件会在闲置期内保留。网络和动态依赖仅在管理员开启联网时可用。网页截图时先写 outputs/page.html，再使用 $SANDBOX_CHROMIUM 无头截图到 outputs/page.png。

输出 schema：{"command":"完整 Shell 命令","new_session":true 可选,"timeout_seconds":1-300 可选,"python_packages":["包名"] 可选,"node_packages":["包名"] 可选,"use_message_images":true/false 可选,"send_output_media":true/false 可选,"send_output_files":true/false 可选}。command 必填。`,
  remote: `${COMMON_RULES}

目标是管理员部署的持久化 Docker 远程沙箱，可联网执行 Shell、Python、Node.js、编译、文件处理与 Chromium。输入附件在 inputs/，路径由 SANDBOX_INPUT_IMAGES、SANDBOX_INPUT_MEDIA、SANDBOX_INPUT_FILES 提供。inputs/、outputs/ 每次调用都会清空；需要持续编辑的文件留在会话根目录，交付时复制到 outputs/。outputs/ 中的媒体和普通附件会自动发送。网页截图必须使用 $SANDBOX_CHROMIUM 截取实际 HTML，不能用 Pillow、Canvas、SVG 或 Matplotlib 模拟截图。

输出 schema：{"command":"完整 Shell 命令","new_session":true 可选,"timeout_seconds":1-300 可选,"python_packages":["包名"] 可选,"node_packages":["包名"] 可选,"use_message_images":true/false 可选,"send_output_media":true/false 可选,"send_output_files":true/false 可选}。command 必填。`,
  vercel: `${COMMON_RULES}

你正在规划 Vercel 远程沙箱的一次执行。它能联网运行 Shell、Python 3.12、Node.js、npm、FFmpeg、ImageMagick、Chromium、Pillow、OpenCV、NumPy、Pandas、requests 和 aiohttp。优先使用已安装能力；只有明确缺少的包才写入 python_packages 或 node_packages。

【文件与会话】
1. 当前消息和引用消息的附件已经下载到 inputs/；先用 ls inputs 或环境变量 SANDBOX_INPUT_IMAGES、SANDBOX_INPUT_MEDIA、SANDBOX_INPUT_FILES 确认文件名，不能猜测附件路径。
2. inputs/、outputs/ 每次调用都会被清空。只有最终要发给用户的图片、音频、视频、HTML、PDF、压缩包或普通附件才写入 outputs/；中间文件写入会话根目录或 /tmp。
3. 同一用户的会话根目录在 Vercel 热实例存活期间会保留。需要继续编辑已有文件时，先 ls/find/cat 读取原文件，再用 Python、perl 或 sed 做最小修改；不要无必要全文重写。实例缩容或迁移后旧文件可能消失，因此找不到文件时应重新创建或在 command 中说明真实错误。
4. 不要输出 session_id、new_session、reset_paths、output_files 或 send_output_images；这些由插件处理。

【截图与媒体】
1. 用户只要求截取一个公开 http/https 页面时，优先只输出 screenshot_url；可按需给 screenshot_full_page、screenshot_width、screenshot_height、screenshot_wait_ms。不要为此写 Puppeteer。
2. 需要截图自己生成的 HTML、需要登录态/Cookie、或截图后还要继续处理时，在 command 中生成文件，并运行：node /app/tools/web_capture.mjs 'file://$PWD/page.html' --output outputs/page.png --full-page。外部网页也可用该脚本；已获授权的 Cookie 文件可位于 inputs/cookies.json。
3. 图片/GIF/音视频处理可用 FFmpeg、ImageMagick、Pillow，结果必须使用正确扩展名写入 outputs/。只需文本答案或调试信息时不要创建 outputs/ 文件，直接让 command 输出结果。

【命令要求】
1. command 是一段完整可执行的 Shell 命令，可使用多行脚本。需要交付文件时先 mkdir -p outputs。
2. 任务需要多个步骤时，在同一 command 中按顺序完成；使用 set -e 可让失败暴露真实错误。不要伪造成功、截图或文件。
3. 你只负责给出一次执行参数，不回答任务本身、不解释方案、不包裹 Markdown。

输出必须是一个合法 JSON 对象。command 和 screenshot_url 至少提供一个。可用字段只有：command、screenshot_url、screenshot_full_page、screenshot_width、screenshot_height、screenshot_wait_ms、timeout_seconds、python_packages、node_packages、use_message_images、send_output_media、send_output_files。

示例一（公开网页截图）：{"screenshot_url":"https://example.com","screenshot_full_page":true,"screenshot_wait_ms":2000}
示例二（交付附件副本）：{"command":"mkdir -p outputs && cp inputs/reference_1.img outputs/result.img"}
示例三（仅返回文本）：{"command":"printf 4"}`
}

function extractJsonObject (text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(source)
  } catch {}

  const start = source.indexOf('{')
  if (start < 0) throw new Error('子代理没有返回 JSON 对象')
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1))
        } catch {
          throw new Error('子代理返回的 JSON 格式无效')
        }
      }
    }
  }
  throw new Error('子代理返回的 JSON 不完整')
}

function copyOptionalBoolean (target, source, key) {
  if (source[key] !== undefined) {
    if (typeof source[key] !== 'boolean') throw new Error(`子代理参数 ${key} 必须为布尔值`)
    target[key] = source[key]
  }
}

function copyOptionalNumber (target, source, key, min, max) {
  if (source[key] !== undefined) {
    if (!Number.isFinite(source[key])) throw new Error(`子代理参数 ${key} 必须为数字`)
    target[key] = Math.max(min, Math.min(max, source[key]))
  }
}

function copyOptionalStringArray (target, source, key) {
  if (source[key] !== undefined) {
    if (!Array.isArray(source[key]) || source[key].some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error(`子代理参数 ${key} 必须为非空字符串数组`)
    }
    target[key] = source[key].map(item => item.trim())
  }
}

function copySharedOptions (target, source) {
  copyOptionalNumber(target, source, 'timeout_seconds', 1, 300)
  copyOptionalStringArray(target, source, 'python_packages')
  copyOptionalStringArray(target, source, 'node_packages')
  copyOptionalBoolean(target, source, 'use_message_images')
  copyOptionalBoolean(target, source, 'send_output_media')
  copyOptionalBoolean(target, source, 'send_output_files')
}

function requireString (source, key) {
  const value = typeof source[key] === 'string' ? source[key].trim() : ''
  if (!value) throw new Error(`子代理参数 ${key} 不能为空`)
  return value
}

export function validateSandboxSubAgentPlan (kind, output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('子代理必须返回 JSON 对象')
  }
  const plan = {}
  if (kind === 'local' || kind === 'remote') {
    plan.command = requireString(output, 'command')
    copyOptionalBoolean(plan, output, 'new_session')
    copySharedOptions(plan, output)
    return plan
  }
  if (kind === 'vercel') {
    if (output.command !== undefined) plan.command = requireString(output, 'command')
    if (output.screenshot_url !== undefined) {
      const screenshotUrl = requireString(output, 'screenshot_url')
      if (!/^https?:\/\//i.test(screenshotUrl)) throw new Error('子代理参数 screenshot_url 必须为 HTTP/HTTPS 地址')
      plan.screenshot_url = screenshotUrl
    }
    if (!plan.command && !plan.screenshot_url) throw new Error('子代理必须提供 command 或 screenshot_url')
    copyOptionalBoolean(plan, output, 'screenshot_full_page')
    copyOptionalNumber(plan, output, 'screenshot_width', 320, 3840)
    copyOptionalNumber(plan, output, 'screenshot_height', 240, 2160)
    copyOptionalNumber(plan, output, 'screenshot_wait_ms', 0, 30000)
    copySharedOptions(plan, output)
    return plan
  }
  throw new Error(`未知沙箱类型: ${kind}`)
}

export async function resolveSandboxSubAgentProvider (e) {
  const configuredProvider = Config.sandboxSubAgentProvider || 'current'
  if (configuredProvider !== 'current') return configuredProvider
  const userData = e?.user_id ? await getUserData(e.user_id) : {}
  return (userData?.mode === 'default' ? '' : userData?.mode) || await redis.get('CHATGPT:USE') || 'api'
}

export async function buildSandboxSubAgentPlan (kind, task, e) {
  const normalizedTask = typeof task === 'string' ? task.trim() : ''
  if (!normalizedTask) throw new Error('task is required')
  const systemPrompt = SANDBOX_PROMPTS[kind]
  if (!systemPrompt) throw new Error(`未知沙箱类型: ${kind}`)
  const provider = await resolveSandboxSubAgentProvider(e)
  const subLLM = new SubLLM({
    provider,
    systemPrompt,
    timeoutMs: 120000
  })
  const response = await subLLM.chat(`主代理请求执行以下任务：\n${normalizedTask}`)
  return {
    provider,
    plan: validateSandboxSubAgentPlan(kind, extractJsonObject(response.text))
  }
}
