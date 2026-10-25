/**
 * CQ 码参数的实体还原（与 aiocqhttp 的 unescape 对齐）
 *
 * NapCat 下发的 `raw_message` 是 CQ 码字符串，参数里的 `&` 被转义成 `&amp;`：
 * `[CQ:image,...,url=...&amp;rkey=...]`。原样拿去请求会被腾讯 CDN 判为 invalid rkey（HTTP 400）。
 *
 * 实体替换顺序：`&#44;` / `&#91;` / `&#93;` 在前、`&amp;` 在最后——顺序反了会把字面量
 * `&amp;#44;` 误还原成逗号。`base64://` 与 `data:` 是直传负载，不做解码。
 *
 * 单独成模块是为了让「只做地址比较」的调用方（如引用图来源判定）不必拉起媒体下载链路的依赖。
 *
 * @param {string} s CQ 码里的参数原文
 * @returns {string} 还原后的文本
 */
export function unescapeCqCode(s) {
  if (typeof s !== 'string' || s.indexOf('&') === -1) return s
  if (s.startsWith('base64://') || s.startsWith('data:')) return s
  return s
    .replace(/&#0*44;/g, ',')
    .replace(/&#0*91;/g, '[')
    .replace(/&#0*93;/g, ']')
    .replace(/&amp;/gi, '&')
}

/**
 * 处理 raw_message 中的 CQ 码
 * - 删除所有非 CQ:at 的 CQ 码
 * - keepForward 为 true 时额外保留 [CQ:forward,id=...]，供「读取合并转发」工具使用
 * - 如果传入的 qq 号与某个 CQ:at 中的 qq 匹配，删除第一个匹配到的 CQ:at
 *
 * 只做字符串处理，放在本模块而非媒体/客户端链路里：调用方（apps/chat.js）与测试都不必拉起
 * 整条 provider 依赖。
 *
 * @param {string} rawMessage - 原始消息字符串
 * @param {string} targetQQ - （可选）要匹配并删除的 QQ 号，删除第一个匹配到的 CQ:at （用于 At Bot 启动的对话）
 * @param {{keepForward?: boolean}} [options] keepForward 保留合并转发 CQ 码（只在工具开启时）
 * @returns {string} 处理后的消息字符串
 */
export function processCQMessage(rawMessage, targetQQ, { keepForward = false } = {}) {
  // 删除所有非 CQ:at 的 CQ 码；工具开启时连 forward 一起保留，模型才有 id 可传
  let result = keepForward
    ? rawMessage.replace(/\[CQ:(?!at\b|forward\b)[^\]]*\]/g, '')
    : rawMessage.replace(/\[CQ:(?!at\b)[^\]]*\]/g, '')
  // 找到第一个 qq 匹配的 CQ:at，删除它
  if (targetQQ !== undefined && targetQQ !== null) {
    const qqStr = String(targetQQ)
    // 匹配 CQ:at，捕获其中的 qq 字段
    const cqAtRegex = /\[CQ:at,qq=(\d+)[^\]]*\]/g
    let firstMatchDeleted = false
    result = result.replace(cqAtRegex, (match, qq) => {
      if (!firstMatchDeleted && qq === qqStr) {
        firstMatchDeleted = true
        return '' // 删除第一个匹配到的
      }
      return match // 其余保留
    })
  }
  // 清理多余空格
  result = result.replace(/\s+/g, ' ').trim()
  return result
}
