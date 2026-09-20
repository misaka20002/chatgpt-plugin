import { AbstractTool } from './AbstractTool.js'
import { render } from '../common.js'
import { SubLLM } from '../../model/SubLLM.js'
import { resolveCurrentChatProvider } from '../paimonFuction.js'
import { HTML_DESIGN_SYSTEM_PROMPT } from '../htmlDesignSkill.js'

/** 可执行 / 可嵌入外部文档的标签，属纵深防御：渲染端 iframe 已用 sandbox 关掉脚本 */
const ACTIVE_TAGS = ['script', 'iframe', 'object', 'embed']

/**
 * 空元素（没有闭合标签，只删标签本身）。它们不执行脚本，但能绕开渲染端的 CSP：
 * - `<meta http-equiv="refresh">` 让承载内容的 iframe 导航到任意地址。sandbox 的 navigation flag
 *   只禁止它导航**别的**浏览上下文，不禁止它导航自己；而 CSP 里没有能在 meta 中生效的
 *   "禁止导航"指令（`default-src` 不兜底导航），所以这条只能靠删标签。
 * - `<link rel="preconnect|dns-prefetch">` 是连接提示，同样不受 CSP 各 fetch 指令约束。
 * 内层文档的 charset 与 CSP meta 都由渲染端模板自己生成，模型输出不需要任何 meta，整类删除无副作用。
 */
const REQUEST_TAGS = ['meta', 'link']

/**
 * 去掉 <script> 等可执行/可嵌入标签，以及会绕开渲染端 CSP 的 <meta>/<link>，
 * 避免生成内容在截图用的 Chromium 里执行脚本、内嵌别的文档或主动发起请求。
 * @param {string} html
 * @returns {string}
 */
export function stripActiveMarkup (html) {
  let cleaned = html
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

/**
 * 从子代理回复里取出 HTML 源码：容忍代码围栏与前后解说文字。
 * @param {string} text
 * @returns {string} 取不到时返回空串
 */
export function extractHtmlSource (text) {
  const raw = String(text || '').trim()
  if (!raw) return ''

  // 丢掉开头的前言：从第一个标签起算
  const tagStart = raw.search(/<[a-zA-Z!/]/)
  if (tagStart < 0) return ''

  // 只有回复**确实**用围栏包了 HTML 时才允许把后面的 ``` 当结束围栏：要求第一个标签之前存在
  // 一条独立的围栏行（行首 ``` 且该行有换行结尾），光是"正文里出现过 ```"不算 —— 生成的 HTML
  // 本身就可能合法含三反引号（用 <pre> 展示 Markdown / 代码块 / 配置文件），误判会把正文整段砍掉。
  const prefix = raw.slice(0, tagStart)
  const isFenced = /(?:^|\r?\n)[ \t]*```[^\r\n]*\r?\n/.test(prefix)

  let out = raw.slice(tagStart)

  // 丢掉结尾的解说（有 </html> 时以它为准）
  const htmlEnd = out.toLowerCase().lastIndexOf('</html>')
  if (htmlEnd >= 0) return out.slice(0, htmlEnd + '</html>'.length).trim()

  if (isFenced) {
    const fenceEnd = out.lastIndexOf('```')
    if (fenceEnd >= 0) out = out.slice(0, fenceEnd)
  }

  return out.trim()
}

/**
 * 生成 HTML / SVG 视觉图（信息卡、示意图、流程图、UI 稿、矢量插画…）并渲染为图片发送的 LLM 工具
 */
export class GenerateHtmlTool extends AbstractTool {
  name = 'generate_html'

  parameters = {
    properties: {
      title: {
        type: 'string',
        description: 'The short title shown in the window title bar of the generated image, e.g. "AI 语音链路". Keep it within 16 characters.'
      },
      request: {
        type: 'string',
        description: `The complete design brief for the design sub-agent, written in Simplified Chinese.

For information/card images: include every piece of text and data that must appear (title, subtitle, section labels, facts, numbers, names, relations) plus the layout you want. The sub-agent cannot see this conversation, so anything you leave out shows as a placeholder instead of being invented.

For illustration / SVG / diagram requests: describe the subject, its pose or structure, the key visual elements that must be present, and the desired style. Do not invent facts, numbers or text that the user did not provide.`
      }
    },
    required: ['request']
  }

  description = `Generate a designed HTML image and send it to the user as an image.

Use it when the user asks for an HTML page / 网页 / 海报 / 信息图 / 可视化 / 架构图 / 链路图 / 流程图 / 对比表, or for SVG / 矢量插画 / 示意图 / 图标 / 用 HTML 或 SVG 画图, or when the answer is better explained by a rich visual (cards, chains, tables, timelines) than by plain text or Markdown. The image is rendered by a separate design sub-agent that owns the layout, so you only supply the brief.

The sub-agent draws with inline SVG: it can render real vector illustrations, not just cards. Never answer an illustration request with emoji, and never claim you cannot draw.

Prefer this tool for layout / information design and for illustrations and custom vector graphics; prefer the Markdown/math renderer for formulas, Mermaid diagrams and plain document-style rendering.

Rules:
1. Put the complete brief into "request": for cards, all text and data plus the layout; for illustrations, the subject, its structure or pose, must-have visual elements and the style. Facts the user did not give you will not be invented.
2. Do NOT repeat the image's content in your final reply: the image is the answer. After the tool succeeds, either say nothing or send one very short confirmation.`

  func = async (opts, e) => {
    const request = typeof opts.request === 'string' ? opts.request.trim() : ''
    const title = typeof opts.title === 'string' ? opts.title.trim() : ''

    if (!request) {
      return 'Error: request is required.'
    }

    try {
      // 与沙箱规划子代理同一语义：默认跟随当前用户正在使用的对话模型
      const provider = await resolveCurrentChatProvider(e)
      // 不在这里设 maxTokens：直接跟随 provider 的「回复内容最大Token数」配置（api / responses /
      // claude / gemini 四家都在锅巴可改）。历史上这里自设 8000，长 SVG 会先于 provider 上限被截断，
      // 表现是"背景画完了、主体没了"。
      const subLLM = new SubLLM({
        provider,
        systemPrompt: HTML_DESIGN_SYSTEM_PROMPT,
        timeoutMs: 600000
      })

      // 最后一句只说"设计"，不说"卡片"：纯插画/SVG 也是本工具的正式形态（设计 skill 第四节），
      // 收尾指令里出现"卡片"会把子代理往"套一层卡片"的方向带
      const response = await subLLM.chat(`内容简报：\n${request}\n\n请输出对应设计的单文件 HTML。`)
      const html = extractHtmlSource(response?.text)
      if (!html) {
        logger.warn(`[HTML渲染] 子代理(${provider})未返回 HTML: ${String(response?.text || '').slice(0, 200)}`)
        return 'Error: the design sub-agent did not return usable HTML source.'
      }

      const img = await render(e, 'chatgpt-plugin', 'htmlRender/index', {
        html: stripActiveMarkup(html),
        title: title || 'HTML 视觉图'
      }, { retType: 'base64' })

      if (!img) {
        return 'Error: Failed to render the HTML card image.'
      }

      // 只发出渲染后的图片
      await e.reply(img, true)

      return 'Successfully generated and sent the HTML card image to the user. The image is the answer: do not repeat its content, and keep your final reply empty or to one very short confirmation.'
    } catch (error) {
      logger.error(`[HTML渲染] 生成失败: ${error?.message || error}`)
      return `Error generating HTML card image: ${error?.message || error}`
    }
  }
}
