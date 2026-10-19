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
