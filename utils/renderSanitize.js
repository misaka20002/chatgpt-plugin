/**
 * 截图用模板的「渲染前清洗」：模型生成的 HTML（可能含外部输入）在交给无头 Chromium 出图之前，
 * 先把整类会执行脚本、内嵌别的文档、或能绕开渲染端 CSP 的标签删掉。
 *
 * 为什么需要这一层，而不只靠渲染端的 CSP：
 * - `<meta http-equiv="refresh">` 能让渲染页自己导航到任意地址，而渲染器用的是
 *   `waitUntil: 'networkidle0'`，会等对方页面加载完再把**对方页面**截下来发出去
 *   （等于"把任意网页当渲染图发出去"）。CSP 里没有能在 meta 中生效的"禁止导航"指令
 *   （`default-src` 不兜底导航，`navigate-to` 从未落地），所以这条只能靠删标签。
 * - `<link rel="preconnect|dns-prefetch">` 是连接提示，同样不受 CSP 各 fetch 指令约束。
 * 内层文档的 charset 由模板自己生成，模型输出不需要任何 meta，整类删除无副作用。
 *
 * 已知取舍：清洗在**原始字符串**上做，不区分 fenced code block，所以模型在代码块里示范
 * `<script>` 之类的原文也会被删掉。这是有意的 fail-closed 选择——按 markdown 结构解析再放行
 * 等于把"围栏识别正确"变成安全前提，一旦识别有偏差就是绕过；内容少一行比多一次远程请求划算。
 *
 * @param {string} html
 * @returns {string}
 */

/** 可执行 / 可嵌入外部文档的标签，属纵深防御：渲染端 CSP 也已关掉脚本与子文档 */
const ACTIVE_TAGS = ['script', 'iframe', 'object', 'embed']

/** 空元素（没有闭合标签，只删标签本身）：能绕开渲染端 CSP 的请求/导航类标签 */
const REQUEST_TAGS = ['meta', 'link', 'base']

export function stripActiveMarkup (html) {
  let cleaned = String(html ?? '')
  for (const tag of ACTIVE_TAGS) {
    cleaned = cleaned
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '')
      .replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '')
  }
  for (const tag of REQUEST_TAGS) {
    cleaned = cleaned.replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '')
  }
  return cleaned
}

export { ACTIVE_TAGS, REQUEST_TAGS }
