/**
 * HTML 片段 → 纯文本：解实体、去标签、压空白。
 *
 * 两个调用点看着无关，需要的是同一份实体表：搜索结果页的标题/摘要（三个引擎的 HTML 拼法
 * 各不相同，转义写法却是同一套），以及整页的 `<title>`。各写一份就会一份认 `&mdash;`、
 * 另一份把它原样吐给模型——而网页标题里这个破折号非常常见。
 *
 * 只负责片段：完整的 HTML→Markdown 在 `htmlMarkdown.js`（opencode 的移植），它要整份文档、
 * 有块级语义，两者不要混用。
 */

/**
 * 数值实体：落在 Unicode 范围外或代理区段时给空串，不要造出半个字符。
 * @param {number} code
 * @returns {string}
 */
function safeFromCodePoint(code) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10FFFF) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/**
 * 解 HTML 实体。
 *
 * 命名实体只列搜索结果页里真会出现的那些，其余交给数值实体；补一份完整的命名实体表不值得，
 * 漏掉的极少数会原样出现在摘要里，不影响可读性。
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeFromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => safeFromCodePoint(Number(code)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;|&emsp;|&thinsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

/**
 * 去标签 + 解实体 + 把连续空白压成一个空格。
 * @param {string} html
 * @returns {string}
 */
export function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}
