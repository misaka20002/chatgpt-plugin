import crypto from 'node:crypto'

/**
 * 发给第三方托管服务的会话标识。
 *
 * Parallel 要求同一对话复用同一个 `session_id`（免费额度按它限流、日志按它关联），
 * 但群号 / QQ 号不能直接交给第三方，所以加进程级随机盐再哈希：同一进程内稳定、
 * 重启后换一套（对限流无影响），且无法从 session_id 反推出真实群号。
 */
const SESSION_SALT = crypto.randomBytes(16).toString('hex')

/**
 * @param {object} [e] 消息事件
 * @returns {string} 32 位十六进制
 */
export function conversationSessionId(e) {
  const scope = e?.group_id ? `group:${e.group_id}` : `user:${e?.user_id ?? e?.sender?.user_id ?? ''}`
  return crypto.createHash('sha256').update(`${SESSION_SALT}:${scope}`).digest('hex').slice(0, 32)
}
