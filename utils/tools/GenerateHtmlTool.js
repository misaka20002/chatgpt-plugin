import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AbstractTool } from './AbstractTool.js'
import { render } from '../common.js'
import { SubLLM } from '../../model/SubLLM.js'
import { resolveCurrentChatProvider } from '../paimonFuction.js'
import { HTML_DESIGN_SYSTEM_PROMPT } from '../htmlDesignSkill.js'
// 清洗逻辑与 mathRender 模板共用同一份实现（理由见 utils/renderSanitize.js）
import { stripActiveMarkup } from '../renderSanitize.js'

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
 * 把标题转成可安全落盘的文件名主干：去掉路径分隔符与 Windows 非法字符，折叠空白，限定长度。
 * 标题由模型给定，可能带 `/`、`..` 之类的目录成分，不做清洗就等于让模型选写入路径。
 * @param {string} name
 * @returns {string} 清洗后可能为空串，调用方需回退默认名
 */
export function sanitizeHtmlFileName (name) {
  return String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // 首部的点会被当成相对路径（`..` / `.git`），尾部的点与空格在 Windows 上会被静默截断
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 48)
    .replace(/[.\s]+$/, '')
}

/**
 * 把要发给用户的 HTML 源码落盘。
 * 发送文件走的是本地路径（`segment.file(local_path, name)`），所以必须真的写一份出来；
 * 落盘名带时间戳避免同名覆盖，发给用户的显示名则用清洗后的标题。
 * @param {string} html
 * @param {string} title
 * @returns {Promise<{filePath: string, fileName: string}>}
 */
export async function writeHtmlSourceFile (html, title) {
  const base = sanitizeHtmlFileName(title) || 'html'
  const dir = path.join(process.cwd(), 'data', 'chatgpt', 'htmlRender')
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${base}-${Date.now()}.html`)
  await writeFile(filePath, html, 'utf8')
  return { filePath, fileName: `${base}.html` }
}

/**
 * 把 HTML 源码作为文件发给用户（仅在模型显式要求时调用）。
 *
 * 失败**不算工具失败**：图片已经发出去了，文件发不出去（适配器不支持 / 上传失败）只降级为
 * 一句说明回填给模型，避免它以为文件已发出而向用户宣称"文件已发送"。
 *
 * @param {object} e 事件上下文
 * @param {string} html 已清洗的源码
 * @param {string} title 显示用标题
 * @returns {Promise<string>} 追加到工具结果里的说明
 */
async function sendHtmlSourceFile (e, html, title) {
  if (!e?.reply || !globalThis.segment?.file) {
    return ' The HTML source file was NOT sent: the current adapter provides no file sending.'
  }

  try {
    const { filePath, fileName } = await writeHtmlSourceFile(html, title)
    await e.reply(globalThis.segment.file(filePath, fileName))
    return ' The raw HTML source file was also sent to the user as an attachment.'
  } catch (error) {
    logger.warn(`[HTML渲染] HTML 源文件发送失败: ${error?.message || error}`)
    return ` The HTML source file was NOT sent (${error?.message || error}).`
  }
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
      },
      send_html_file: {
        type: 'boolean',
        description: `Set to true ONLY when the user explicitly asks for the HTML source itself.`
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
2. Do NOT repeat the image's content in your final reply: the image is the answer. After the tool succeeds, either say nothing or send one very short confirmation.
3. Set "send_html_file": true only when the user explicitly asks for the HTML file / source; otherwise leave it out and only the image is sent.`

  func = async (opts, e) => {
    const request = typeof opts.request === 'string' ? opts.request.trim() : ''
    const title = typeof opts.title === 'string' ? opts.title.trim() : ''
    // 默认 false：不额外发源码文件，保持"只发图"的既有行为
    const sendHtmlFile = opts.send_html_file === true

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

      // 发出去的源码与渲染用的是同一份清洗结果：用户下载到的文件就是出图时真正渲染的内容，
      // 不会因为"文件里还留着 script/iframe" 而把渲染端删掉的东西又塞回给用户。
      const htmlSource = stripActiveMarkup(html)

      const img = await render(e, 'chatgpt-plugin', 'htmlRender/index', {
        html: htmlSource,
        title: title || 'HTML 视觉图'
      }, { retType: 'base64' })

      if (!img) {
        return 'Error: Failed to render the HTML card image.'
      }

      // 图片是主要产物；模型显式要求源码时再补发一份 .html 文件
      await e.reply(img, true)

      const fileNote = sendHtmlFile
        ? await sendHtmlSourceFile(e, htmlSource, title || 'HTML 视觉图')
        : ''

      return `Successfully generated and sent the HTML card image to the user.${fileNote} The image is the answer: do not repeat its content, and keep your final reply empty or to one very short confirmation.`
    } catch (error) {
      logger.error(`[HTML渲染] 生成失败: ${error?.message || error}`)
      return `Error generating HTML card image: ${error?.message || error}`
    }
  }
}
