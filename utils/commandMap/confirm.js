import { commandKey } from './patch.js'

/**
 * 待确认状态：w/a 档指令在真正执行前需要一次确认。
 *
 * 存在进程内、按「群 + 用户」隔离、2 分钟过期：
 *   - 不落盘：重启后一律当作没确认过，宁可多问一次；
 *   - 不共享：别人确认过的指令不能被另一个人复用。
 */

const TTL_MS = 120 * 1000

/** key → { command, expiresAt } */
const pending = new Map()

/** 肯定回答。只认短促明确的，长句子交给模型判断而不是这里猜 */
const AFFIRMATIVE_RE = /^(是|是的|对|好|好的|行|可以|确认|执行|嗯|要|yes|y|ok)[\s!！。.]*$/i

/**
 * 状态键：群 + 用户。私聊用固定前缀，避免和群号撞车。
 * @param {object} e
 * @returns {string}
 */
export function confirmKey (e) {
  const userId = e?.sender?.user_id || e?.user_id || 'unknown'
  const groupId = e?.group_id || e?.group?.group_id || 'private'
  return `${groupId}:${userId}`
}

/**
 * 登记一条待确认指令（覆盖旧的）。
 * @param {object} e
 * @param {string} command
 */
export function putPending (e, command) {
  pending.set(confirmKey(e), { command, expiresAt: Date.now() + TTL_MS })
}

/**
 * 取出并消费待确认指令。取过即删，避免「一次确认执行两次」。
 * @param {object} e
 * @returns {string | null}
 */
export function takePending (e) {
  const key = confirmKey(e)
  const record = pending.get(key)
  if (!record) return null
  pending.delete(key)
  if (Date.now() > record.expiresAt) return null
  return record.command
}

/** 只看不消费，用于「确认的是不是同一条」 */
export function peekPending (e) {
  const record = pending.get(confirmKey(e))
  if (!record) return null
  if (Date.now() > record.expiresAt) {
    pending.delete(confirmKey(e))
    return null
  }
  return record.command
}

export function clearPending (e) {
  pending.delete(confirmKey(e))
}

/**
 * 待确认的这条和现在要执行的是不是同一条。
 * @param {string} pendingCommand
 * @param {string} command
 * @returns {boolean}
 */
export function samePending (pendingCommand, command) {
  return Boolean(pendingCommand) && commandKey(pendingCommand) === commandKey(command)
}

/**
 * 用户这句话是不是「确认」。
 * @param {string} text
 * @returns {boolean}
 */
export function isAffirmative (text) {
  return AFFIRMATIVE_RE.test(String(text || '').trim())
}

/** 仅供测试：清空所有待确认 */
export function resetPending () {
  pending.clear()
}
