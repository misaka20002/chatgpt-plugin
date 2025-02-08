/**
 * 过滤
 * @param msg
 */
export function filterResponseChunk (msg) {
  if (!msg || typeof msg !== 'string') {
    return false
  }
  if (!msg.trim()) {
    return false
  }
  if (msg.trim() === '```') {
    return false
  }
  if (msg.trim() === '<EMPTY>') {
    return false
  }
  msg = trimSpecific(msg, '<EMPTY>')
  return msg
}

export function customSplitRegex (text, regex, limit) {
  const result = []
  let match
  let lastIndex = 0
  const globalRegex = new RegExp(regex, 'g')

  while ((match = globalRegex.exec(text)) !== null) {
    if (result.length < limit - 1) {
      result.push(text.slice(lastIndex, match.index))
      lastIndex = match.index + match[0].length
    } else {
      break
    }
  }

  // 添加剩余部分
  result.push(text.slice(lastIndex))
  return result
}

export function trimSpecific (str, marker) {
  let trimmedStr = str.trim()

  const regex = new RegExp(`^${marker}|${marker}$`, 'g')

  return trimmedStr.replace(regex, '').trim()
}
