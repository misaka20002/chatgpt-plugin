import { randomUUID } from 'node:crypto'

/** 每次尝试独占历史缓冲，失败尝试不会污染已完成会话。 */
export function createAttemptHistory(type, messages = []) {
  const store = new Map()
  let parentMessageId
  for (const message of messages) {
    if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') continue
    const id = randomUUID()
    store.set(id, {
      id, parentMessageId, role: type === 'gemini' && message.role === 'assistant' ? 'model' : message.role,
      text: message.content, content: message.content, parts: [{ text: message.content }]
    })
    parentMessageId = id
  }
  return {
    parentMessageId,
    getMessageById: async id => store.get(id),
    upsertMessage: async message => { store.set(message.id, message) }
  }
}

export async function runProviderFallback(main, backup, execute, { enabled = true, onRetry = () => {} } = {}) {
  const state = { irreversible: false, requested: false }
  const attempts = enabled ? [main, main, ...(backup ? [backup] : [])] : [main]
  for (let i = 0; i < attempts.length; i++) {
    state.requested = false
    try {
      const result = await execute(attempts[i], state)
      if (result?.refused) return result
      if (!result?.text?.trim() && !result?.noMsg && !state.irreversible) {
        throw new Error('模型未返回有效回复')
      }
      return result
    } catch (err) {
      if (state.irreversible || !state.requested || err.noRetry || err.name === 'AbortError' && err.userCancelled || i === attempts.length - 1) throw err
      onRetry(attempts[i + 1], i + 1)
    }
  }
}

export function trimConversation(messages, config) {
  let result = messages.filter(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
  const count = Number(config.chatgptBlockCount)
  if (count > 0) result = result.slice(-Math.max(2, Math.floor(count / 2) * 2))
  // 无条数限制时仍按所选模型上下文预算裁剪完整轮次，避免 Redis 无限增长。
  const budget = Math.max(1, (config.maxModelTokens || config.responsesMaxModelTokens || 128000) - (config.apiMaxToken || config.responsesApiMaxToken || 65536))
  let chars = result.reduce((n, m) => n + m.content.length, 0)
  while (result.length > 2 && chars > budget * 2) {
    chars -= result[0].content.length + result[1].content.length
    result = result.slice(2)
  }
  return result
}
