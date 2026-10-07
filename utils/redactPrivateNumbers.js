/**
 * 回复文本中的私密号码脱敏。
 *
 * 提示词层的禁止外泄属于软约束：长对话中模型仍可能将号码与"某位特定用户"
 * 一类表达自然衔接，或在追问下变形输出。此处作为发送前的最后一道硬过滤，
 * 命中即替换为等长掩码，确保号码不进入聊天记录。
 */

/**
 * 把配置里的号码列表解析成去重后的纯数字串数组。
 *
 * @param {string|string[]|undefined} raw 逗号/分号/空白分隔的号码，或已是数组
 * @returns {string[]} 去重后的纯数字串，每项至少 4 位
 */
export function parsePrivateNumbers(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\s]+/)
  const seen = new Set()
  for (const part of parts) {
    const digits = String(part).replace(/\D/g, '')
    // 下限取 4 位：更短的片段会与"第 3 组""LV51"等正常内容大面积冲突
    if (digits.length >= 4) seen.add(digits)
  }
  return [...seen]
}

/**
 * 构造脱敏替换函数。
 *
 * 除完整号码外，另覆盖两类常见变形：号码嵌入更长数字串（末位追加一位），
 * 以及首位补 0 的手机号写法。
 *
 * @param {string|string[]|undefined} raw 待脱敏的号码
 * @returns {(text: string) => string} 替换函数
 */
export function createRedactor(raw) {
  const numbers = parsePrivateNumbers(raw)
  if (numbers.length === 0) return (text) => text

  // 长号优先匹配，避免短号先行命中后残留数字片段
  const sorted = numbers.slice().sort((a, b) => b.length - a.length)

  // 允许号码数字之间插入空格或连字符分组。
  // 匹配要求完整数字序列连续出现，不会与正常内容冲突。
  const spaced = sorted
    .map((n) => `0*[\\s-]*${n.split('').join('[\\s-]*')}`)
    .join('|')
  const pattern = new RegExp(sorted.map((n) => `0*${n}`).join('|'), 'g')
  const spacedPattern = new RegExp(spaced, 'g')

  return (text) => {
    if (typeof text !== 'string' || !text) return text
    return text
      .replace(spacedPattern, (matched) => '*'.repeat(matched.replace(/\D/g, '').length || matched.length))
      .replace(pattern, (matched) => '*'.repeat(matched.length))
  }
}