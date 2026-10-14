/**
 * 模型输出归一化：把「思考标签」与「工具轮独白」从正文中剥离，重新归类到 thinking 通道，
 * 避免模型的内心独白被当成正文外发到群消息。
 *
 * 参考 AstrBot 在 provider 层做兼容性归一化的做法（openai_source.py 的 <think> 标签剥离）：
 * 中转协议常把思考塞进普通 text（而不是 thought/reasoning 字段），只能在解析层消化，不污染上层。
 *
 * 纯函数、零依赖，便于独立单测。
 */

/** 配对思考块：<think>...</think> / <thinking>...</thinking>（大小写不敏感） */
const PAIRED_THINK_RE = /<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/gi
/** 未闭合的开放块：流被截断 / 模型漏写闭合标签时，把尾部整体视为思考 */
const OPEN_THINK_RE = /<(?:think|thinking)>([\s\S]*)$/i
/** 残留的孤立闭合/开放标签 */
const STRAY_THINK_TAG_RE = /<\/?(?:think|thinking)>/gi

/**
 * 按词边界判断正文里是否点名了某个工具名（工具名含正则元字符时先转义）。
 * 用裸 includes 会让 send 命中 sending 这类词，误杀正常工具轮正文。
 */
function includesToolName(text, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(text)
}

/**
 * 抽取 <think>/<thinking> 标签内容，返回正文与思考
 * @param {unknown} raw
 * @returns {{ text: string, thinking: string }}
 */
export function extractThinkTags(raw) {
  if (typeof raw !== 'string' || !raw) {
    return { text: '', thinking: '' }
  }

  const thinkingParts = []
  let text = raw.replace(PAIRED_THINK_RE, (_, content) => {
    if (content && content.trim()) {
      thinkingParts.push(content.trim())
    }
    return ''
  })

  // 未闭合的尾部开放块：余下内容归入思考，避免标签残留进正文
  const open = text.match(OPEN_THINK_RE)
  if (open) {
    if (open[1] && open[1].trim()) {
      thinkingParts.push(open[1].trim())
    }
    text = text.slice(0, open.index)
  }

  // 剥离孤立标签（例如只有一个 </think> 的情况）
  text = text.replace(STRAY_THINK_TAG_RE, '').trim()

  return {
    text,
    thinking: thinkingParts.join('\n')
  }
}

/**
 * 判断一段工具轮文本是否为「模型自述调度过程」的独白（而非给用户看的话）。
 * 仅应在该响应确实带工具调用（inToolRound）时启用，避免误杀正常对话。
 * @param {string} text
 * @param {string[]} toolNames 本轮真实存在的工具名
 * @returns {boolean}
 */
export function isToolMonologue(text, toolNames = []) {
  if (typeof text !== 'string') {
    return false
  }
  const normalized = text.trim()
  if (!normalized) {
    return false
  }

  // 正文点名了本轮真实存在的工具：视为调度独白。用词边界匹配，避免 send → sending 这类误杀
  if (Array.isArray(toolNames) && toolNames.some(name => name && includesToolName(normalized, name))) {
    return true
  }

  // 英文自述句式：wait / hmm / let me
  if (/\b(?:wait|hmm+|let me)\b/i.test(normalized)) {
    return true
  }
  // 英文自述句式：I should call ... / I need to use ...
  if (/\bi(?:'m| am|'ll| will| shall| should| need to| have to| must| can|'m going to| am going to)\b[\s\S]{0,32}\b(?:call|use|invoke|search|check|look|query|fetch|run|find)\b/i.test(normalized)) {
    return true
  }
  // 英文自述句式：Let's call ...
  if (/\blet'?s\s+(?:call|use|invoke|search|check|look|query|fetch|run|find)\b/i.test(normalized)) {
    return true
  }

  // 中文只认显式工具动词（如「调用查询工具」），不认「我查查」这类正常口语
  if (/(?:调用|使用)[^\n]{0,10}(?:工具|函数|接口|能力|搜索)/.test(normalized)) {
    return true
  }

  return false
}

/**
 * 归一化工具轮文本：先剥思考标签，再把「自述调度」的独白重归类进 thinking。
 * 命中独白时 text 置空——内容不丢失，只是改走 thinking 通道。
 * @param {unknown} raw
 * @param {{ toolNames?: string[], inToolRound?: boolean }} options
 * @returns {{ text: string, thinking: string }}
 */
export function normalizeModelText(raw, { toolNames = [], inToolRound = false } = {}) {
  const { text, thinking } = extractThinkTags(raw)
  let finalText = text
  let finalThinking = thinking

  if (inToolRound && finalText && isToolMonologue(finalText, toolNames)) {
    finalThinking = finalThinking ? `${finalThinking}\n${finalText}` : finalText
    finalText = ''
  }

  return { text: finalText, thinking: finalThinking }
}
