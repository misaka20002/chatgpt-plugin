import fs from 'node:fs'
import path from 'node:path'

import { redactArgsForLog, maskSecret } from './toolArgRedaction.js'

/**
 * 工具调用/返回的落盘诊断日志。
 *
 * 为什么需要它：宿主 `logger.info` 只进 stdout，而线上这台机器是 dialog 全屏 TUI，
 * 应用的 stdout 落在 dialog 开的 pty 上——`docker logs` 只能抓到启动脚本那几行，
 * operator 实际上**看不见**控制台（2026-10-28 实测：docker logs 只有 314 字节）。
 * 于是每次排查都得往生产代码里插临时探针，插完还得记得删。
 *
 * 为什么单独开一个文件：宿主 `logger.mark` 落的是 `logs/command.<date>.log`，
 * 那份文件经常被直接发到群里排障，明文参数（可能含密钥、用户号）不能进那里。
 * ADR-0002 定了「明文留控制台、脱敏留转发」，这里延续同一分工：
 * **控制台照旧明文，这里额外写一份脱敏后的落盘记录**，排查时看这个文件。
 */

/** 单条记录里 payload 的最大字符数，超出截断 */
const MAX_PAYLOAD = 2000

/** 文件超过这个大小就轮转一次，避免无限增长 */
const MAX_FILE_BYTES = 4 * 1024 * 1024

let writeQueue = Promise.resolve()

function diagDir () {
  return path.join(process.cwd(), 'data', 'chatgpt', 'diag')
}

function diagFile () {
  return path.join(diagDir(), 'tool-calls.log')
}

/**
 * 凭证类字段名：这些参数落盘前一律掩码。
 *
 * `redactArgsForLog` 管的是「转发给会话」的安全（白名单式，只管 Memory_Tool 的正文）；
 * 而这里是**落在磁盘上的文件**，比群聊转发更容易被翻出来，所以额外做一层凭证掩码。
 */
const CREDENTIAL_KEY_RE = /(api[_-]?key|token|secret|password|passwd|pwd|cookie|authorization|credential|session)/i

function maskCredentials (args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args
  const out = {}
  for (const [key, value] of Object.entries(args)) {
    if (CREDENTIAL_KEY_RE.test(key) && (typeof value === 'string' || typeof value === 'number')) {
      out[key] = maskSecret(value)
    } else {
      out[key] = value
    }
  }
  return out
}

function truncate (value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined) return ''
  return text.length > MAX_PAYLOAD ? `${text.slice(0, MAX_PAYLOAD)}…（已截断）` : text
}

/**
 * 写一条工具调用/返回记录。
 *
 * 写不了也不能影响主流程：诊断日志失败一律吞掉。
 *
 * @param {object} entry
 * @param {string} entry.provider 提供方：API / Responses / Claude / Gemini
 * @param {'调用'|'返回'|'异常'} entry.kind
 * @param {string} entry.name 工具名
 * @param {object} [entry.args] 调用参数（落盘前脱敏）
 * @param {*} [entry.result] 返回结果
 * @param {string} [entry.note] 备注
 */
export function logToolCall ({ provider, kind, name, args, result, note } = {}) {
  const record = {
    t: new Date().toISOString(),
    provider: provider || 'unknown',
    kind: kind || '调用',
    name: name || 'unknown',
    args: args ? truncate(maskCredentials(redactArgsForLog(name || '', args))) : undefined,
    result: result === undefined ? undefined : truncate(result),
    note
  }

  writeQueue = writeQueue.then(() => appendLine(record)).catch(() => {})
  return writeQueue
}

async function appendLine (record) {
  try {
    const dir = diagDir()
    await fs.promises.mkdir(dir, { recursive: true })
    const file = diagFile()
    // 轮转：超过上限就留一份 .1，重新开新文件
    try {
      const stat = await fs.promises.stat(file)
      if (stat.size > MAX_FILE_BYTES) {
        await fs.promises.rename(file, `${file}.1`)
      }
    } catch {
      // 文件还不存在，正常往下走
    }
    await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // 诊断日志写不了就算了，不能影响主流程
  }
}

/**
 * 读最近的工具调用记录（给排障用）。
 *
 * @param {number} [limit] 最多读多少行
 * @returns {string} 原始 JSON 行
 */
export async function readToolCallLog (limit = 200) {
  try {
    const text = await fs.promises.readFile(diagFile(), 'utf8')
    return text.split('\n').filter(Boolean).slice(-limit).join('\n')
  } catch {
    return ''
  }
}
