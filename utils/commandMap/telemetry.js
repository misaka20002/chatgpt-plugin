import fs from 'node:fs'
import path from 'node:path'

/**
 * 命令误用埋点（**临时**）。
 *
 * 框架只记录「命中并执行」的指令，不记录「用户发了 #xxx 但没有任何插件匹配」——
 * 而没有这类数据，就没法知道「用户常把哪条指令打错」。所以这里补一个观察器：
 * 只在本机写一行 JSONL，不联网、不上报。
 *
 * 清理方式：删掉 `data/chatgpt/telemetry/` 目录，并把配置项 `commandMapTelemetry` 关掉。
 */

const LOG_PREFIX = '[Chatgpt][命令埋点]'

/** 单文件上限：超过就滚动，避免长期开机把磁盘写满 */
const MAX_BYTES = 2 * 1024 * 1024

/** 像指令的消息：井号或斜杠开头，且后面真的跟了字 */
const COMMAND_LIKE_RE = /^[#＃/／]\s*\S/

/** 我们自己注册的观察器不参与「有没有插件能匹配」的判断，否则永远匹配得上 */
const SELF_MARK = 'commandMissObserver'

/**
 * 这条消息看起来像不像一条指令。
 * @param {string} msg
 * @returns {boolean}
 */
export function isCommandLike (msg) {
  return COMMAND_LIKE_RE.test(String(msg || '').trim())
}

/**
 * 本机有没有任何插件能匹配这条消息。只做匹配判断，**不执行任何东西**。
 * @param {{ priority?: Array<object> }} loader
 * @param {string} msg
 * @returns {boolean}
 */
export function hasRegisteredMatch (loader, msg) {
  const text = String(msg || '')
  if (!text) return false
  const priority = Array.isArray(loader?.priority) ? loader.priority : []

  for (const item of priority) {
    if (String(item?.key || '').includes(SELF_MARK)) continue
    const rules = item?.plugin?.rule
    if (!Array.isArray(rules)) continue
    for (const rule of rules) {
      if (!rule?.reg) continue
      try {
        if (rule.reg instanceof RegExp ? rule.reg.test(text) : new RegExp(rule.reg).test(text)) return true
      } catch {
        // 坏正则跳过，不影响其余规则
      }
    }
  }
  return false
}

/**
 * 把一条「没匹配上」的消息追加到本地 JSONL。写失败只记一条 warn，不打断消息链。
 * @param {{ msg: string, userId?: string|number, groupId?: string|number, at?: string }} record
 * @returns {boolean}
 */
export function recordMiss ({ msg, userId = '', groupId = '', at = new Date().toISOString() }) {
  const dir = telemetryDir()
  const file = path.join(dir, 'command-miss.jsonl')
  try {
    fs.mkdirSync(dir, { recursive: true })
    rotateIfNeeded(file)
    fs.appendFileSync(file, `${JSON.stringify({ at, groupId, userId, msg: String(msg).slice(0, 200) })}\n`, 'utf8')
    return true
  } catch (err) {
    globalThis.logger?.warn?.(`${LOG_PREFIX} 写入失败：${err.message}`)
    return false
  }
}

export function telemetryDir () {
  return path.join(process.cwd(), 'data', 'chatgpt', 'telemetry')
}

function rotateIfNeeded (file) {
  try {
    const stat = fs.statSync(file)
    if (stat.size < MAX_BYTES) return
    fs.renameSync(file, `${file}.1`)
  } catch {
    // 文件不存在就是第一次写
  }
}
