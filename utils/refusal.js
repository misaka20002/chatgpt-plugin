/**
 * 模型安全审核拒绝的识别与温和回复词库。
 *
 * 审核拒绝是「用户输入已提交、模型生成或返回时被拦下」，不是程序故障：既不该把
 * `出现错误：模型拒绝回答：PROHIBITED_CONTENT` 这种内部状态码发到群里，也不该把被拒答的
 * 轮次写进会话历史。词条统一以「派蒙」占位，发送前按 `tts_First_person` 替换称呼，
 * 与 utils/randomMessage.js 的内置词库写法保持一致。
 *
 * 纯函数、零依赖，便于独立单测。
 */

export const REFUSAL_REPLIES = Object.freeze([
  '抱歉，这个问题派蒙暂时无法回答，换个话题聊聊吧。',
  '这条消息涉及受限内容，派蒙没办法回应哦，我们聊点别的吧。',
  '派蒙刚才生成的回复没有通过安全检查，请尝试换一种问法。',
  '唔，这个内容稍微有点敏感，派蒙不太方便回答呢。',
  '当前内容触发了安全限制，派蒙暂时无法生成回复。',
  '这个问题超出了派蒙的回答范围，请调整表述或换个内容再试吧。',
  '抱歉呀，派蒙的回复在返回时被安全策略拦住了，换个话题试试吧。',
  '该内容暂时无法回应，和派蒙聊点其他话题吧。'
])

/**
 * 判断异常或响应对象是否为模型内容安全审核拒绝。
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isModerationRefusalError(err) {
  if (!err) return false
  if (typeof err === 'object' && err.refused === true) return true
  const message = typeof err === 'string' ? err : (typeof err?.message === 'string' ? err.message : '')
  return /^模型拒绝回答(?:[:：]|$)/.test(message.trim())
}

/**
 * 从拒绝词库中随机抽取一条回复，并将“派蒙”替换为当前配置的 AI 第一人称。
 *
 * @param {string|{tts_First_person?: string}} [firstPersonOrConfig]
 * @param {() => number} [random]
 * @returns {string}
 */
export function pickRefusalReply(firstPersonOrConfig = '派蒙', random = Math.random) {
  const rawName = typeof firstPersonOrConfig === 'string'
    ? firstPersonOrConfig
    : firstPersonOrConfig?.tts_First_person
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : '派蒙'
  const rawIndex = Math.floor(random() * REFUSAL_REPLIES.length)
  const index = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < REFUSAL_REPLIES.length ? rawIndex : 0
  return REFUSAL_REPLIES[index].replace(/派蒙/g, name)
}
