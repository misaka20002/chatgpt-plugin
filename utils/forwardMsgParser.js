/**
 * 合并转发（聊天记录）读取器
 *
 * 职责：
 * 1. 从事件里找出「合并转发」的 id —— CQ 码、信标、JSON 卡片三条来源
 * 2. 把 CQ:forward 改写成信标，避免被「清除非 at 的 CQ 码」正则整段删掉
 * 3. 按 id 向协议端拉取转发内容，递归展开嵌套，格式化成模型可读文本
 *
 * 设计约束（对应 docs/adr/0007-quoted-forward-resolution.md）：
 * - 只在读取侧工作，不改动 parseSourceImg / processCQMessage 的既有语义
 * - 一切异常向外收敛成 `{ ok:false, ... }`，绝不让主对话链路崩掉
 * - 节点数、字符数、图片数、递归层数、接口超时全部有上限
 * - 图片只取地址、不在这里下载；识图是可选增强，失败不影响正文
 */

import { Config } from './config.js'

/** 缓存条数上限：转发内容短时间内不会变，留 100 条足够覆盖连问场景 */
const CACHE_MAX_ENTRIES = 100
/** 缓存存活时间：10 分钟 */
const CACHE_TTL_MS = 10 * 60 * 1000
/** 递归层数硬上限：协议端嵌套再深也只展开到这一层，防止调用链爆炸 */
export const FORWARD_MAX_DEPTH = 3
/** 单张图片识别的独立超时：识图天生比文本慢，但不该拖住整条回复 */
const IMAGE_RECOGNIZE_TIMEOUT_MS = 8000
/** 拉取失败后的重试次数（不含首次） */
const FETCH_RETRY_TIMES = 2
/** 重试间隔 */
const FETCH_RETRY_DELAY_MS = 400
/** forwardId 长度上限：协议端的 message_id 不会这么长，超了基本是脏数据 */
const FORWARD_ID_MAX_LEN = 128
/** forwardMaxImages 缺省值；0 是合法值（表示不取图），不能用 || 吞掉 */
const DEFAULT_MAX_IMAGES = 4

/**
 * 解析「转发内最多几张图」的配置值。
 *
 * 抽出来是因为 apps/chat.js 与 utils/common.js 都要用同一口径：
 * 0 有业务语义（不取图），必须显式判 `>= 0`，不能写成 `Config.x || 4` 把它吞成 4。
 *
 * @returns {number} 非负整数上限
 */
export function resolveForwardImageLimit() {
  const raw = Number(Config.forwardMaxImages)
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_MAX_IMAGES
}

/** 缓存：cacheKey -> { expires, value }，Map 的插入顺序天然可当 LRU 用 */
const cache = new Map()

/** 统一的告警出口：logger 在部分单测环境里不存在，不能让它反过来炸掉流程 */
function warn(message) {
  try {
    if (typeof logger !== 'undefined' && typeof logger.warn === 'function') {
      logger.warn(`[ChatGPT][ForwardReader] ${message}`)
    }
  } catch (err) {
    /* 日志失败不影响主流程 */
  }
}

/** 结构性信息走 info，便于线上排查「为什么没读到」 */
function info(message) {
  try {
    if (typeof logger !== 'undefined' && typeof logger.info === 'function') {
      logger.info(`[ChatGPT][ForwardReader] ${message}`)
    }
  } catch (err) {
    /* 同上 */
  }
}

/** 把 `&amp;` 之类的 HTML 实体还原，图片地址里几乎必然带它 */
function unescapeHtml(input) {
  return String(input ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&#44;/g, ',')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

/** 解析 CQ 码的参数字符串（形如 `,id=abc,foo=bar`） */
function parseCQParams(body) {
  const params = {}
  const text = String(body ?? '')
  for (const part of text.split(',')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) params[key] = unescapeHtml(value)
  }
  return params
}

/** 从 JSON 卡片段里挖出合并转发的 resid / id */
function extractIdsFromJsonSeg(seg) {
  const out = []
  let text = ''

  const payload = seg?.data ?? seg?.content
  if (typeof payload === 'string') {
    text = payload
  } else if (payload && typeof payload === 'object') {
    // 个别适配器已经把 JSON 解析成对象了
    const detail = payload?.meta?.detail ?? payload?.meta?.detail_1 ?? {}
    for (const key of ['resid', 'id', 'file']) {
      const value = detail?.[key]
      if (typeof value === 'string' && value.trim()) out.push(value.trim())
    }
    try {
      text = JSON.stringify(payload)
    } catch (err) {
      text = ''
    }
  }

  if (!text) return out
  text = unescapeHtml(text)

  // 只认「看起来像聊天记录」的卡片，避免把普通分享卡片里的 id 当转发 id
  const looksLikeForward = /com\.tencent\.multimsg|"forward"\s*:\s*true|聊天记录|chatrecord/i.test(text)
  const hasResid = /"resid"\s*:/.test(text)
  if (!looksLikeForward && !hasResid) return out

  for (const match of text.matchAll(/"resid"\s*:\s*"([^"]+)"/g)) {
    if (match[1] && match[1].trim()) out.push(match[1].trim())
  }
  return out
}

/** 从原始 CQ 字符串里挖出转发 id：既认 CQ 码，也认已经被改写过的信标 */
function extractIdsFromRawMessage(raw) {
  const out = []
  const text = unescapeHtml(raw)
  if (!text) return out

  for (const match of text.matchAll(/\[CQ:forward([^\]]*)\]/g)) {
    const params = parseCQParams(match[1])
    const id = params.id || params.file || params.resid
    if (id) out.push(id)
  }

  for (const match of text.matchAll(/<合并转发:id=([^>]+)>/g)) {
    const id = String(match[1] || '').split(/\s+/)[0].trim()
    if (id) out.push(id)
  }

  return out
}

/** 把一段可能是数组也可能是单对象的结果统一成数组 */
function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * 从事件里提取全部合并转发 id（去重，保持出现顺序）。
 *
 * 三个来源都要看，因为它们在不同适配器/不同消息形态下互斥出现：
 * - `e.message` 的 `forward` 段：TRSS 的 parseMsg 会把 CQ 码摊平成这种
 * - `e.message` 的 `json` 段：QQ 客户端转发的「聊天记录」卡片
 * - `e.raw_message`：原始 CQ 串，用户自己引用时常常只有这里还有 id
 *
 * @param {object} e 服务端事件
 * @returns {string[]} 去重后的 forwardId 数组，找不到时为空数组
 */
export function extractForwardIdsFromEvent(e) {
  const ids = []
  const push = (value) => {
    if (value === undefined || value === null) return
    const id = String(value).trim()
    if (!id) return
    if (id.length > FORWARD_ID_MAX_LEN) return
    if (!ids.includes(id)) ids.push(id)
  }

  for (const seg of asArray(e?.message)) {
    if (!seg || typeof seg !== 'object') continue
    const type = seg.type ?? seg?.data?.type

    if (type === 'forward') {
      push(seg.id ?? seg.message_id ?? seg?.data?.id ?? seg?.data?.message_id)
    } else if (type === 'json') {
      for (const id of extractIdsFromJsonSeg(seg)) push(id)
    }
  }

  for (const id of extractIdsFromRawMessage(e?.raw_message)) push(id)

  return ids
}

/**
 * 把 `[CQ:forward,id=xxx]` 改写成 `<合并转发:id=xxx>`。
 *
 * 为什么必须改：`processCQMessage` 用 `/\[CQ:(?!at\b)[^\]]*\]/g` 清掉所有非 at 的 CQ 码，
 * 转发段会被整段吃掉、连 id 都不剩。改成不含 `[CQ:` 前缀的信标后，
 * 那条正则匹配不到它，id 得以活到后续解析。
 *
 * @param {string} rawMessage 原始消息串
 * @returns {string} 改写后的串；没有转发段时原样返回
 */
export function rewriteForwardCQToBeacon(rawMessage) {
  const text = String(rawMessage ?? '')
  if (!text || !text.includes('[CQ:forward')) return text

  return text.replace(/\[CQ:forward([^\]]*)\]/g, (whole, body) => {
    const params = parseCQParams(body)
    const id = params.id || params.file || params.resid
    if (!id) return whole
    return `<合并转发:id=${id}>`
  })
}

/** 校验并规范化 forwardId */
function normalizeForwardId(forwardId) {
  if (forwardId === undefined || forwardId === null) return ''
  if (typeof forwardId !== 'string' && typeof forwardId !== 'number') return ''
  const id = String(forwardId).trim()
  if (id.length < 1 || id.length > FORWARD_ID_MAX_LEN) return ''
  if (/\s/.test(id)) return ''
  return id
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 给不确定会返回的协议调用套超时；超时后原 Promise 被丢弃，不影响后续重试 */
function withTimeout(promise, timeoutMs, label = 'forward-api') {
  let timer = null
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** 把各种可能的返回外壳摊平成消息数组 */
function extractMessages(res) {
  if (!res) return null
  const candidates = [
    res?.data?.messages,
    res?.data?.chapters,
    res?.messages,
    Array.isArray(res?.data) ? res.data : null,
    Array.isArray(res) ? res : null
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate
  }
  return null
}

/** 依次尝试多种协议调用方式，任何一种拿到数据就返回 */
function buildFetchers(e, id) {
  return [
    async () => (e?.bot?.sendApi ? await e.bot.sendApi('get_forward_msg', { message_id: id }) : null),
    async () => (e?.bot?.sendApi ? await e.bot.sendApi('get_forward_msg', { id }) : null),
    async () => (e?.bot?.getForwardMsg ? await e.bot.getForwardMsg(id) : null),
    async () => (typeof e?.getForwardMsg === 'function' ? await e.getForwardMsg(id) : null)
  ]
}

/**
 * 拉取单层转发内容。
 *
 * 重试策略：整体最多重试 2 次（间隔 400ms），每轮内部按 4 种调用方式依次尝试。
 * 这样既能扛住网络抖动，也能兼容不同适配器暴露的方法名差异。
 */
async function fetchOneLayer(e, id) {
  const timeoutMs = Number(Config.forwardApiTimeoutMs) > 0 ? Number(Config.forwardApiTimeoutMs) : 5000
  const fetchers = buildFetchers(e, id)
  // 不吞错：每轮每次失败都留痕，最后统一上报一次。空 catch 会让「为什么拉不到」彻底失明。
  let lastError = ''

  for (let attempt = 0; attempt <= FETCH_RETRY_TIMES; attempt++) {
    if (attempt > 0) await sleep(FETCH_RETRY_DELAY_MS)

    for (let i = 0; i < fetchers.length; i++) {
      try {
        const res = await withTimeout(fetchers[i](), timeoutMs, `get_forward_msg#${i}`)
        const messages = extractMessages(res)
        if (messages) return messages
        lastError = `第${i + 1}种调用未返回消息数组`
      } catch (err) {
        // 单个方式失败不打断，继续试下一种，但把原因留下
        lastError = err?.message || String(err)
      }
    }
  }

  if (lastError) warn(`拉取失败 forwardId=${id}，最后一次原因: ${lastError}`)
  return null
}

/** 时间戳格式化：兼容秒级、毫秒级与已经是可读字符串三种情况 */
function formatTime(value) {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return '未知时间'
    if (!/^\d+$/.test(text)) return text
  }
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return '未知时间'
  const ms = num > 1e12 ? num : num * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '未知时间'
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 取图片地址：url 优先，其次 file；base64 一律不当作可读地址返回 */
function pickImageUrl(seg) {
  const candidates = [seg?.url, seg?.file, seg?.data?.url, seg?.data?.file]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const value = unescapeHtml(candidate).trim()
    if (!value) continue
    if (value.startsWith('base64://')) continue
    return value
  }
  return ''
}

/** 取发送者信息，兼容 sender 包裹与顶层平铺两种结构 */
function pickSender(node) {
  const sender = node?.sender && typeof node.sender === 'object' ? node.sender : node
  const id = sender?.user_id ?? sender?.uin ?? sender?.qq ?? node?.user_id ?? ''
  const name = sender?.card || sender?.nickname || sender?.name || (id ? String(id) : '未知')
  return { id: String(id || ''), name: String(name || '未知') }
}

/**
 * 渲染单个节点，产出符合「群聊上下文颗粒度」的一行。
 *
 * 段处理规则与现有上下文保持一致：文本直取、at 带 QQ 号、图片带真实地址、
 * 视频/语音/文件只留类型标记（不下载、不识别，避免解析阶段就吃 token）。
 */
function renderNode(node, depth, ctx) {
  const { id: senderId, name: senderName } = pickSender(node)
  const timeText = formatTime(node?.time)
  const segments = Array.isArray(node?.message)
    ? node.message
    : Array.isArray(node?.content)
      ? node.content
      : []

  const parts = []
  const forwardIds = []

  for (const raw of segments) {
    if (!raw) continue
    const seg = typeof raw === 'object' ? raw : { type: 'text', text: String(raw) }
    const type = seg.type ?? seg?.data?.type

    if (type === 'text') {
      const text = seg.text ?? seg?.data?.text ?? ''
      if (text) parts.push(unescapeHtml(text))
    } else if (type === 'at') {
      const qq = seg.qq ?? seg?.data?.qq ?? ''
      const name = seg.name ?? seg?.data?.name ?? ''
      parts.push(`@${name || qq || '某人'}(${qq || ''})`)
    } else if (type === 'reply') {
      const replyId = seg.id ?? seg?.data?.id ?? ''
      parts.push(`[回复:${replyId}]`)
    } else if (type === 'image') {
      const url = pickImageUrl(seg)
      if (url) {
        ctx.collectImage(url)
        parts.push(`[图片: ${url}]`)
      } else {
        parts.push('[图片]')
      }
    } else if (type === 'video') {
      parts.push('[视频]')
    } else if (type === 'record') {
      parts.push('[语音]')
    } else if (type === 'file') {
      const fileName = seg.name ?? seg.file ?? seg?.data?.name ?? seg?.data?.file ?? '未知文件'
      parts.push(`[文件:${fileName}]`)
    } else if (type === 'forward') {
      const nestedId = seg.id ?? seg.message_id ?? seg?.data?.id ?? seg?.data?.message_id
      if (nestedId !== undefined && nestedId !== null && String(nestedId).trim()) {
        forwardIds.push(String(nestedId).trim())
      }
    } else if (type === 'json') {
      for (const nid of extractIdsFromJsonSeg(seg)) forwardIds.push(nid)
    } else if (type === 'face') {
      parts.push('[表情]')
    }
  }

  const msgText = parts.join('').replace(/\s+/g, ' ').trim()
  const line = `[L${depth}] 【${senderName}】（qq：${senderId || '未知'}，时间：${timeText}） 说：${msgText || '[空消息]'}`

  return { line, forwardIds }
}

/** 缓存读：命中即续期（LRU 语义），过期的顺手清掉 */
function readCache(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expires <= Date.now()) {
    cache.delete(key)
    return null
  }
  cache.delete(key)
  cache.set(key, hit)
  return hit.value
}

/** 缓存写：超过条数上限时淘汰最久未使用的一条 */
function writeCache(key, value) {
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value })
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/**
 * 对图片做可选识别，结果只作为文本补充。
 *
 * 这里刻意不复用主对话的识别入口：转发里的图片地址来自第三方内容，
 * 必须按不可信来源处理；且单张失败不能连累其它张，更不能影响正文。
 */
async function describeImages(e, urls) {
  const descriptions = []
  if (!urls.length) return descriptions

  let recognitionResultsByGemini
  try {
    const mod = await import('./paimonFuction.js')
    recognitionResultsByGemini = mod?.recognitionResultsByGemini
  } catch (err) {
    warn(`图片识别模块加载失败，跳过识图: ${err?.message || err}`)
    return descriptions
  }
  if (typeof recognitionResultsByGemini !== 'function') return descriptions

  for (const url of urls) {
    try {
      const text = await withTimeout(
        recognitionResultsByGemini(e, [url], [], undefined, { untrustedSource: true }),
        IMAGE_RECOGNIZE_TIMEOUT_MS,
        'image-recognize'
      )
      const cleaned = String(text ?? '').trim()
      if (!cleaned) continue
      if (cleaned.startsWith('识别出错')) {
        warn(`图片识别返回失败: ${cleaned.slice(0, 120)}`)
        continue
      }
      descriptions.push({ url, text: cleaned })
    } catch (err) {
      warn(`图片识别异常: ${err?.message || err}`)
    }
  }

  return descriptions
}

/** 按深度优先顺序展开整棵转发树，边遍历边累计容量 */
async function buildTree(e, rootId, options) {
  const { maxDepth, maxNodes, maxChars, maxImages, recognizeImages } = options

  const lines = []
  const imageUrls = []
  const visited = new Set()
  let totalNodes = 0
  let totalChars = 0
  let truncated = false
  let fetchFailed = false
  /** 实际展开到的最深层级：单层转发要如实显示 1/3，而不是恒等于配置的 3 */
  let reachedDepth = 0

  const collectImage = (url) => {
    if (imageUrls.length >= maxImages) return
    if (imageUrls.includes(url)) return
    imageUrls.push(url)
  }

  // 队列元素：{ id, depth }；depth 从 1 开始，对应输出里的 [L1]
  const queue = [{ id: rootId, depth: 1 }]

  while (queue.length) {
    if (truncated) break

    const { id, depth } = queue.shift()
    if (visited.has(id)) continue
    visited.add(id)

    const messages = await fetchOneLayer(e, id)
    if (!messages) {
      fetchFailed = true
      lines.push(`[合并转发:id=${id} 内容拉取失败]`)
      continue
    }

    for (const node of messages) {
      if (totalNodes >= maxNodes || totalChars >= maxChars) {
        truncated = true
        break
      }

      const { line, forwardIds } = renderNode(node, depth, { collectImage })
      lines.push(line)
      totalNodes++
      totalChars += line.length + 1
      if (depth > reachedDepth) reachedDepth = depth

      if (!forwardIds.length) continue

      // 还会往下展开：要么入队，要么在到达层数上限时留一个明确的标记
      if (depth < maxDepth) {
        for (const nestedId of forwardIds) {
          if (!visited.has(nestedId)) queue.push({ id: nestedId, depth: depth + 1 })
        }
      } else {
        lines.push(`<嵌套合并转发:id=${forwardIds.join(',')} (已达${maxDepth}层上限)>`)
      }
    }
  }

  // 截断提示只算一次，正文与 text 共用，避免两处各拼一遍
  const truncateNote = truncated ? `\n...[合并转发内容过长，已截断，共 ${totalNodes} 条消息]` : ''
  const body = lines.join('\n') + truncateNote
  const parts = [body]

  // 识图是增强项：失败不影响正文，只影响 descriptions 是否为空
  const descriptions = recognizeImages ? await describeImages(e, imageUrls) : []

  if (descriptions.length) {
    parts.push(
      '\n【转发内图片识别结果】\n' +
        descriptions.map((item, index) => `${index + 1}. ${item.text}`).join('\n')
    )
  }

  // 即便没有识图，也把地址列出来：多模态链路或后续工具调用可以直接用
  if (imageUrls.length) {
    parts.push('\n【转发内图片地址】\n' + imageUrls.map((url, index) => `${index + 1}. ${url}`).join('\n'))
  }

  // body 在上方已随截断提示一起拼好（含截断提示、不含图片清单）：
  // 工具侧要自己组装「=== 包含图片列表 ===」段落，复用 text 会导致图片被列两遍
  return {
    ok: true,
    forwardId: rootId,
    text: parts.join('\n'),
    body,
    imageUrls,
    imageDescriptions: descriptions,
    totalNodes,
    truncated,
    fetchFailed,
    depth: reachedDepth || 1
  }
}

/**
 * 读取一条合并转发的完整内容。
 *
 * @param {object} e 服务端事件（用于拿 bot / 群对象 / 识别上下文）
 * @param {string|number} forwardId 合并转发 id
 * @param {object} [options]
 * @param {number} [options.maxDepth] 递归层数，内部强制夹到 1~3
 * @param {boolean} [options.recognizeImages] 是否对转发内图片做识别，默认 true
 * @returns {Promise<object>} 成功 `{ ok:true, text, imageUrls, ... }`；失败 `{ ok:false, error, fallbackText }`
 */
export async function readForwardMsgTree(e, forwardId, options = {}) {
  const id = normalizeForwardId(forwardId)
  if (!id) {
    return {
      ok: false,
      forwardId: String(forwardId ?? ''),
      error: '无效的合并转发ID',
      fallbackText: '[合并转发:id 无效，无法读取]'
    }
  }

  const rawDepth = Number(options.maxDepth ?? Config.forwardMaxDepth ?? 3)
  const maxDepth = Math.min(Math.max(1, Number.isFinite(rawDepth) ? Math.floor(rawDepth) : 3), FORWARD_MAX_DEPTH)

  const rawNodes = Number(Config.forwardMaxNodes ?? 60)
  const maxNodes = Number.isFinite(rawNodes) && rawNodes > 0 ? Math.floor(rawNodes) : 60

  const rawChars = Number(Config.forwardMaxChars ?? 6000)
  const maxChars = Number.isFinite(rawChars) && rawChars > 0 ? Math.floor(rawChars) : 6000

  const rawImages = Number(Config.forwardMaxImages ?? 4)
  const maxImages = Number.isFinite(rawImages) && rawImages >= 0 ? Math.floor(rawImages) : 4

  const recognizeImages = options.recognizeImages !== false

  // 缓存键要带上影响结果的全部参数，否则不同配置会互相污染
  const cacheKey = `${id}|d${maxDepth}|n${maxNodes}|c${maxChars}|i${maxImages}|r${recognizeImages ? 1 : 0}`
  const cached = readCache(cacheKey)
  if (cached) {
    info(`命中缓存 forwardId=${id}`)
    return { ...cached, fromCache: true }
  }

  try {
    const result = await buildTree(e, id, { maxDepth, maxNodes, maxChars, maxImages, recognizeImages })

    if (result.fetchFailed && !result.totalNodes) {
      const error = '转发内容拉取失败'
      warn(`${error} forwardId=${id}`)
      const failure = {
        ok: false,
        forwardId: id,
        error,
        fallbackText: `[合并转发:id=${id} 内容拉取失败]`
      }
      // 失败不进缓存：协议端抖动可能几十秒后就好了，锁住反而更难恢复
      return failure
    }

    writeCache(cacheKey, result)
    info(`读取成功 forwardId=${id} 节点=${result.totalNodes} 图片=${result.imageUrls.length} 截断=${result.truncated}`)
    return { ...result, fromCache: false }
  } catch (err) {
    const message = err?.message || String(err)
    warn(`读取异常 forwardId=${id}: ${message}`)
    return {
      ok: false,
      forwardId: id,
      error: message,
      fallbackText: `[合并转发:id=${id} 内容拉取失败]`
    }
  }
}
