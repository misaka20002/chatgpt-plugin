/**
 * 群消息观察器：采集授权群的非 Bot 消息（含指令）
 * 富媒体内容（图片/表情/语音/视频/文件/卡片）不入库，但保留对应占位符标记，供提炼时理解上下文
 * 记录说话人、角色、时间和消息 ID；原文默认保留 30 天
 *
 * 文本与结构化段严格分离（两条互不影响的数据通道）：
 * - `text` 走 extractText*，只输出正文/占位符，供每日提炼使用——**其中 @、引用等一律不出现**，
 *   这是既有行为，改动它会直接改变提炼输入，故保持不变。
 * - `at`/`atAll`/`reply`/`forward`/`cards`/`poke` 走 extractStructured，作为独立字段落库，
 *   只做忠实记录、不参与 text，因此不会改变任何记忆提炼/召回结果。
 *
 * 记录层求全、提炼层收窄：指令消息（`#`/`/`/`／`/`＃` 开头）与无文本的结构化消息都会入库，
 * 但**都不会进入提炼输入**——前者靠 `isCommand` 标记，后者靠空 `text`，
 * 由 `dailyTask` 的 `raws.filter(r => !r.isCommand && r.text)` 统一过滤。
 */

import { Config } from '../config.js'
import { MemoryStore } from './store.js'
import { createHash } from 'node:crypto'

const DEFAULT_RETENTION_DAYS = 30
const BACKFILL_HOURS = 24
const BACKFILL_MAX_MESSAGES = 500

/** 常见多媒体占位符：替代对应段 / CQ 码（媒体内容本身不入库） */
const MEDIA_PLACEHOLDERS = {
  image: '[图片]', // image / flash（闪照）
  sticker: '[表情]', // face / mface / marketface / emoji / sticker
  video: '[视频]', // video / shortvideo
  audio: '[语音]', // record / audio / voice
  file: '[文件]', // file
}

/** 结构性段：不算富媒体，不生成占位符（text 段由调用方直接取文本） */
const STRUCTURAL_TYPES = new Set(['text', 'at', 'reply', 'forward', 'node'])

/** 卡片段类型：正文是第三方生成的 JSON/XML，可达数 KB，绝不可进 text */
const CARD_TYPES = new Set(['json', 'xml'])

/** 卡片占位符的来源兜底（同参考实现 group-insight 的 `link.source || '分享'`） */
const CARD_SOURCE_FALLBACK = '分享'

/**
 * 段类型 → 占位符文本（类型归一表与 Onebot11_MessageHistoryManager._extractMediaSegments.mediaType 一致；
 * 注意仅类型映射一致，消费语义不同：本文件把占位符拼入提炼文本，manager 只作媒体统计旁路、不进提炼输入。
 * 唯一例外是卡片 json/xml：本文件渲染成带来源的 `[小程序:来源]`/`[链接:来源]`，manager 仍归入 `other`）
 *
 * @param {string} type 段类型
 * @param {Object} [seg] 段本身（或 CQ 参数对象）；卡片靠它取来源，其余类型不需要
 * 结构性类型与未知类型返回 ''（保持忽略，避免噪音）
 */
export function mediaPlaceholder(type, seg) {
  const normalized = String(type || '').toLowerCase()
  if (!normalized || STRUCTURAL_TYPES.has(normalized)) return ''
  if (['image', 'flash'].includes(normalized)) return MEDIA_PLACEHOLDERS.image
  if (['face', 'mface', 'marketface', 'emoji', 'sticker'].includes(normalized)) return MEDIA_PLACEHOLDERS.sticker
  if (['video', 'shortvideo'].includes(normalized)) return MEDIA_PLACEHOLDERS.video
  if (['record', 'audio', 'voice'].includes(normalized)) return MEDIA_PLACEHOLDERS.audio
  if (normalized === 'file') return MEDIA_PLACEHOLDERS.file
  if (CARD_TYPES.has(normalized)) {
    // 卡片正文不进 text，但来源名很有价值（同 group-insight 的 `[小程序:哔哩哔哩]` 口径）：
    // 只区分 小程序 / 链接 两类，音乐与其他卡片都归入"链接"
    const card = summarizeCard({ type: normalized, data: seg || {} })
    const label = card.type === 'miniapp' ? '小程序' : '链接'
    return `[${label}:${card.source || CARD_SOURCE_FALLBACK}]`
  }
  return ''
}

/** 匹配 OneBot CQ 码（字符串形态消息用，第二组为参数串） */
const CQ_TAG_REGEX = /\[CQ:([A-Za-z]+)((?:,[^\]]*)?)\]/g

/** 字符串消息中富媒体 CQ 码替换为占位符；at/reply 等结构性码与未知码删除 */
function replaceMediaCQ(text) {
  return String(text).replace(CQ_TAG_REGEX, (match, type, params) => {
    const normalized = String(type || '').toLowerCase()
    // 卡片要从 CQ 参数里取来源，其它类型只需类型本身
    return CARD_TYPES.has(normalized)
      ? mediaPlaceholder(normalized, parseCQParams(params))
      : mediaPlaceholder(type)
  })
}

/** 从字符串形态消息提取文本：富媒体 CQ 码转占位符，其余 CQ 码清除后压缩空白 */
function extractTextFromString(text) {
  return stripCQCode(replaceMediaCQ(text)).trim()
}

/** 获取 Bot 自身 QQ（避免依赖 common.js 的重依赖链） */
export function getBotUin(e) {
  if (e?.self_id) return String(e.self_id)
  if (e?.bot?.uin) return String(e.bot.uin)
  return ''
}

/**
 * 判断是否为云崽指令
 *
 * 除半角 `#` 与 `/`、全角 `／` 外，还包含全角 `＃`：`loader.dealText` 会把 `＃` 归一成 `#`
 * 用于规则匹配（即 `＃帮助` 是能真正触发的指令）。文本改用段数组后不再经过该归一，
 * 故这里必须自己覆盖，否则全角指令会被当普通消息采集。
 * 注意**不含 `井`**：它同样是框架支持的指令前缀，但也是正常的汉字首字（如"井盖"），
 * 收紧成指令会误伤普通消息。
 */
export function isCommandText(text) {
  if (!text) return false
  return /^[#/／＃]/.test(text.trimStart())
}

/** 段数组 → 文本：text 段原样，其余段按占位符表处理（结构段与未知类型为空） */
function extractTextFromSegments(segments) {
  return segments
    .map(s => {
      if (s?.type === 'text') return s.text || s.data?.text || ''
      return mediaPlaceholder(s?.type, s)
    })
    .join('')
    .trim()
}

/**
 * 从云崽事件提取纯文本（富媒体段以占位符标记，at/reply 等结构段忽略）
 *
 * **以段数组 `e.message` 为准，`e.msg` 只作兜底**（同参考实现 group-insight 的 `for (const msg of e.message)`）：
 * 段数组是适配器原始输入、逐段保留原文；`e.msg` 是 `loader.dealEvent` 的二次加工产物，
 * 它既按段 trim、做段首归一（`/`→`#`、`＃`/`井`→`#`、`＊`/`※`→`*`），
 * 又会把卡片原文（`typeof i.data === "string" ? i.data : JSON.stringify(i.data)`，
 * 可达数 KB 的第三方 JSON/XML）直接拼进来。改用段数组同时解决「文字被加工」与「卡片污染 text」两件事：
 * 段路径下卡片只留 `[链接:来源]` / `[小程序:来源]` 占位符，卡片详细信息走 `cards` 结构化字段。
 */
export function extractTextFromEvent(e) {
  if (Array.isArray(e?.message)) return extractTextFromSegments(e.message)
  if (e?.msg && typeof e.msg === 'string') return extractTextFromString(e.msg)
  return ''
}

/** 从历史消息提取纯文本：兼容 OneBot 段数组、message 字符串与 raw_message（富媒体转占位符，其余 CQ 码清除） */
export function extractTextFromHistoryMsg(msg) {
  if (!msg) return ''
  // 部分适配器返回 message 为字符串
  if (typeof msg.message === 'string') return extractTextFromString(msg.message)
  const segments = Array.isArray(msg.message) ? msg.message : (msg.segments || [])
  const text = extractTextFromSegments(segments)
  if (text) return text
  // 兜底：raw_message（含 [CQ:image,...] 等码，此处富媒体转占位符、其余清除）
  if (typeof msg.raw_message === 'string') return extractTextFromString(msg.raw_message)
  return ''
}

/** 清除 OneBot CQ 码（[CQ:type,params]），仅保留纯文本并压缩残留空白 */
export function stripCQCode(text) {
  return String(text).replace(/\[CQ:[^\]]*\]/g, '').replace(/[ \t]{2,}/g, ' ').trim()
}

export function contentHash(text) {
  return createHash('sha1').update(String(text)).digest('hex').slice(0, 16)
}

/**
 * 兜底 messageId：适配器没给 message_id/seq 时必须进程内唯一。
 *
 * 原文的 Redis key 就是 `groupId + messageId`，所以 ID 撞了就是**静默覆盖**：
 * 秒级的 `t${time}` 让同一秒的多条消息互相覆盖，`Date.now()` 毫秒级也挡不住
 * 同一毫秒内的多次 notice（如戳一戳连点）。这里用单调自增计数保证唯一，
 * 再加一段进程启动时生成的随机串，避免进程重启后与上一轮的同秒 ID 相撞。
 */
const FALLBACK_ID_RUN = Math.random().toString(36).slice(2, 6)
let fallbackIdSeq = 0
export function fallbackMessageId(prefix, timeSec) {
  fallbackIdSeq += 1
  return `${prefix}${timeSec || Math.floor(Date.now() / 1000)}-${FALLBACK_ID_RUN}${fallbackIdSeq.toString(36)}`
}

/* ================= 结构化段：@ / 引用回复 / 合并转发 / 卡片 / 戳一戳 ================= */

/** 单条记录的结构化字段上限（防超长卡片或 @全体展开刷爆原文） */
const STRUCTURED_LIMITS = { at: 20, cards: 3, title: 120, url: 300, id: 64 }

const cut = (value, max) => String(value ?? '').slice(0, max)

/** CQ 参数值反转义（OneBot 对 , [ ] & 做实体编码） */
function decodeCQParam(value) {
  return String(value)
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&amp;/g, '&')
}

/** CQ 码参数串（含前导逗号，如 `,qq=1,id=2`）→ 参数对象；供段数组/字符串两条路径共用 */
function parseCQParams(paramStr) {
  const data = {}
  for (const kv of String(paramStr || '').split(',')) {
    const i = kv.indexOf('=')
    if (i <= 0) continue
    data[kv.slice(0, i)] = decodeCQParam(kv.slice(i + 1))
  }
  return data
}

/**
 * 把 OneBot 段数组或 CQ 码字符串统一成 [{type, data}]。
 * 仅结构化解析使用：与 extractText* 的媒体归一表刻意分开，避免二者语义互相牵制。
 */
function normalizeSegments(source) {
  if (Array.isArray(source)) {
    return source.map(s => ({ type: String(s?.type || '').toLowerCase(), data: s || {} }))
  }
  if (typeof source !== 'string' || !source) return []
  const out = []
  // 从 canonical 定义克隆一份：pattern 只有一个来源（不会改一处忘另一处），
  // 同时拿到独立的 lastIndex——带 /g 的 RegExp 在 exec 循环与 replace 之间共享 lastIndex，
  // 是两个调用点不能共用同一实例的原因；这里不需要额外的工厂函数。
  const re = new RegExp(CQ_TAG_REGEX)
  let m
  while ((m = re.exec(source))) {
    out.push({ type: m[1].toLowerCase(), data: parseCQParams(m[2]) })
  }
  return out
}

/**
 * 取段字段：兼容 Yunzai 展开后的段（`{type,qq}`）与 OneBot 原始 data 包装（`{type,data:{qq}}`）。
 * 不做任何类型转换，取不到返回 undefined。
 */
function segField(seg, ...keys) {
  for (const k of keys) {
    const v = seg?.data?.[k] ?? seg?.data?.data?.[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

/**
 * 单行标签净化：卡片来源名是第三方可控内容，会被拼进 `text`（即提炼模型输入）。
 * 只清理会破坏行结构 / 提示词框架的字符，**不做字符白名单**——否则中文、日文的
 * 应用名与来源名会被误伤。换行尤其危险：提炼提示词每行形如 `[id] qq(nick)：text`，
 * 一个换行就能让占位符凭空造出第二条"看起来像消息"的行；方括号会提前闭合 `[链接:…]`。
 */
function sanitizeInlineLabel(value, max = STRUCTURED_LIMITS.title) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ') // 控制字符 + 行分隔符（含 \r \n \t）
    .replace(/[[\]]/g, '')
    .trim()
    .slice(0, max)
}

/**
 * 卡片摘要：只保留 类型/来源/标题/URL，不落卡片原文。
 * 解析失败（多为 xml 卡片）时退化为少量属性正则，仍不保存全文。
 */
function summarizeCard(seg) {
  // OneBot 把卡片给成字符串，但部分适配器已解析成对象。对象必须直接使用：
  // 走 String() 会变成 "[object Object]"，JSON.parse 必然失败，卡片信息整体丢成默认值。
  const payload = segField(seg, 'data', 'value')
  const parsedPayload = payload !== null && typeof payload === 'object' ? payload : null
  const rawText = parsedPayload ? '' : decodeCQParam(payload ?? '')
  const pick = re => decodeCQParam(String(rawText).match(re)?.[1] || '')
  let type = seg.type === 'xml' ? 'xml' : 'json'
  let source = ''
  let title = ''
  let url = ''
  try {
    const j = parsedPayload ?? JSON.parse(rawText)
    const app = String(j?.app || '')
    const meta = j?.meta || {}
    const first = meta.news || meta.detail_1 || meta.music || meta.detail || Object.values(meta)[0] || {}
    type = app === 'com.tencent.miniapp_01' ? 'miniapp'
      : (j?.view === 'music' || meta?.music) ? 'music'
        : (j?.view === 'news' || app === 'com.tencent.tuwen.lua') ? 'link'
          : 'json'
    // 小程序卡片字段语义与分享卡不同：title 是应用名（当来源用）、desc 才是内容标题
    if (type === 'miniapp') {
      source = first.title || app
      title = first.desc || j?.prompt || ''
    } else {
      source = first.tag || app
      title = first.title || first.desc || j?.prompt || ''
    }
    url = first.jumpUrl || first.qqdocurl || first.url || ''
  } catch {
    title = pick(/\b(?:brief|summary)="([^"]*)"/i)
    url = pick(/\burl="([^"]*)"/i)
  }
  return {
    type,
    // 来源名会进 text，必须单行化；title/url 目前只落 cards、不进提示词，保持原样截断
    source: sanitizeInlineLabel(source),
    title: cut(title, STRUCTURED_LIMITS.title),
    url: cut(url, STRUCTURED_LIMITS.url),
  }
}

/**
 * 解析结构化段（不产生、也不修改任何文本）。
 *
 * @被 @ 的目标忠实记录，**包含 Bot 自身**，不在此层做业务过滤——排除 Bot 属于消费方语义
 * （如 recall.js 的 getMentionedUserId），记录层保持完整。
 * @param {Array|string} source 段数组 / CQ 码字符串 / raw_message
 * @returns {{at: string[], atAll: boolean, reply: Object|null, forward: Object|null, cards: Array<Object>, poke: Object|null}}
 */
export function extractStructured(source) {
  const result = { at: [], atAll: false, reply: null, forward: null, cards: [], poke: null }
  for (const seg of normalizeSegments(source)) {
    switch (seg.type) {
      case 'at': {
        const qq = String(segField(seg, 'qq', 'user_id') ?? '')
        if (!qq) break
        // [CQ:at,qq=all] 记为 @全体，不展开成员列表（展开需要额外接口调用）
        if (qq === 'all') { result.atAll = true; break }
        if (result.at.length < STRUCTURED_LIMITS.at && !result.at.includes(qq)) result.at.push(qq)
        break
      }
      case 'reply': {
        const messageId = cut(segField(seg, 'id', 'message_id', 'seq') ?? '', STRUCTURED_LIMITS.id)
        const userId = cut(segField(seg, 'qq', 'user_id') ?? '', STRUCTURED_LIMITS.id)
        if (messageId || userId) result.reply = { messageId, userId }
        break
      }
      case 'forward':
      case 'node': {
        // 只记「存在合并转发」与外层 ID，不拉取内层内容（避免额外接口调用与隐私面扩大）
        result.forward = { id: cut(segField(seg, 'id', 'message_id') ?? '', STRUCTURED_LIMITS.id) }
        break
      }
      case 'json':
      case 'xml': {
        if (result.cards.length < STRUCTURED_LIMITS.cards) result.cards.push(summarizeCard(seg))
        break
      }
      case 'poke': {
        result.poke = { userId: cut(segField(seg, 'qq', 'user_id', 'target_id') ?? '', STRUCTURED_LIMITS.id) }
        break
      }
    }
  }
  return result
}

/** 结构化段是否含可记录内容（决定无文本消息是否入库） */
export function hasStructuredContent(structured) {
  return !!(structured && (structured.at.length || structured.atAll || structured.reply || structured.forward || structured.cards.length || structured.poke))
}

/** 结构化段 → 原文记录字段（无内容时不产出，旧记录体积与形状不变） */
export function structuredFields(structured) {
  const out = {}
  if (structured.at.length) out.at = structured.at
  if (structured.atAll) out.atAll = true
  if (structured.reply) out.reply = structured.reply
  if (structured.forward) out.forward = structured.forward
  if (structured.cards.length) out.cards = structured.cards
  if (structured.poke) out.poke = structured.poke
  return out
}

/**
 * 空文本记录的结构化指纹。
 * 纯 @ / 引用 / 戳一戳的 text 为空，直接用 text 做 contentHash 会让所有这类记录退化成
 * 同一个空串哈希；改用结构化内容作为指纹。
 */
export function structuredSignature(structured) {
  const parts = []
  if (structured.at.length) parts.push(`at:${structured.at.join('|')}`)
  if (structured.atAll) parts.push('atall')
  if (structured.reply) parts.push(`reply:${structured.reply.messageId}:${structured.reply.userId}`)
  if (structured.forward) parts.push(`forward:${structured.forward.id}`)
  for (const c of structured.cards) parts.push(`card:${c.type}:${c.source}:${c.title}:${c.url}`)
  if (structured.poke) parts.push(`poke:${structured.poke.userId}`)
  return parts.join(';')
}

export class GroupCapture {
  constructor(options = {}) {
    this.store = options.store || new MemoryStore()
  }

  /**
   * 原文保留天数。
   * 注意这里用 `|| 默认值` 兜底：锅巴面板对该项设了 `min: 1`，**0 不是允许的用户值**，
   * 所以「0=永久」只是 `store.saveRawMessage` 这层 API 的能力，采集层不会走到。
   */
  retentionDays() {
    return Number(Config.memoryGroupCapture?.rawRetentionDays) || DEFAULT_RETENTION_DAYS
  }

  isAuthorized(groupId) {
    return MemoryStore.isGroupAuthorized(Config.memoryGroupCapture?.groups, groupId)
  }

  /**
   * 消息观察入口（由观察器插件调用，返回 false 不拦截消息）
   * @param {Object} e 云崽消息事件
   */
  async observe(e) {
    try {
      if (!Config.enableMemory) return false
      if (!e?.isGroup || !e?.group_id) return false
      if (e.user_id === undefined || String(e.user_id) === getBotUin(e)) return false // Bot 自己
      if (!this.isAuthorized(e.group_id)) return false

      const text = extractTextFromEvent(e)
      // 指令消息照样入库（记录层求全），只打 isCommand 标记；
      // 提炼侧由 dailyTask 的 `raws.filter(r => !r.isCommand && r.text)` 统一排除
      const isCommand = isCommandText(text)

      // 结构化段单独成字段：@ / 引用回复 / 合并转发 / 卡片 / 戳一戳。
      // 优先取 e.message（Yunzai 展开后的段，带 qq/id）；e.msg 由 loader 构建且不含 at，仅作兜底。
      const structured = extractStructured(e.message ?? e.raw_message ?? e.msg)
      if (e.atall === true) structured.atAll = true
      // 纯 @ / 纯引用 / 纯戳一戳等无文本消息同样入库（text 留空），否则 @ 关系完全无从统计
      if (!text && !hasStructuredContent(structured)) return false

      await this.store.saveRawMessage({
        groupId: String(e.group_id),
        messageId: String(e.message_id ?? e.seq ?? fallbackMessageId('t', e.time)),
        senderId: String(e.user_id),
        senderName: e.sender?.card || e.sender?.nickname || '',
        role: e.sender?.role || '',
        text: text.slice(0, 2000),
        time: Math.floor(Number(e.time) || Date.now() / 1000),
        isCommand,
        contentHash: contentHash(text || structuredSignature(structured)),
        ...structuredFields(structured),
      }, this.retentionDays())
      return false
    } catch (err) {
      logger?.error?.(`[MemoryV2] 观察器采集失败: ${err.message}`)
      return false
    }
  }

  /**
   * 戳一戳记录入口（notice.group.poke，由独立观察器插件调用，返回 false 不拦截）
   *
   * TRSS 的戳一戳是 notice 事件而非消息段：operator_id 为发起者、target_id 为被戳者。
   * 记录里 senderId = 发起者、poke.userId = 目标（可能是 Bot 自身，忠实记录不做业务过滤）。
   * @param {Object} e 云崽 notice 事件
   */
  async observePoke(e) {
    try {
      if (!Config.enableMemory) return false
      if (!e?.group_id) return false
      if (!this.isAuthorized(e.group_id)) return false

      const operatorId = String(e.operator_id ?? e.user_id ?? '')
      const targetId = String(e.target_id ?? '')
      if (!operatorId || !targetId) return false
      if (operatorId === getBotUin(e)) return false // Bot 自己戳的

      const structured = { at: [], atAll: false, reply: null, forward: null, cards: [], poke: { userId: cut(targetId, STRUCTURED_LIMITS.id) } }
      await this.store.saveRawMessage({
        groupId: String(e.group_id),
        // notice 事件没有 message_id，必须用兜底 ID 保证唯一（同一毫秒连点也不能互相覆盖）
        messageId: fallbackMessageId('poke', e.time),
        senderId: operatorId,
        senderName: e.sender?.card || e.sender?.nickname || '',
        role: e.sender?.role || '',
        text: '',
        time: Math.floor(Number(e.time) || Date.now() / 1000),
        isCommand: false,
        contentHash: contentHash(structuredSignature(structured)),
        ...structuredFields(structured),
      }, this.retentionDays())
      return false
    } catch (err) {
      logger?.error?.(`[MemoryV2] 戳一戳采集失败: ${err.message}`)
      return false
    }
  }

  /**
   * 补录最近 24 小时历史消息（最多 500 条）
   * @param {Object} e 云崽消息事件（需要 e.group 与 e.seq）
   */
  async backfillHistory(e, options = {}) {
    const hours = options.hours ?? BACKFILL_HOURS
    const maxMessages = options.maxMessages ?? BACKFILL_MAX_MESSAGES
    if (!e?.group || !e?.group_id) return { collected: 0, scanned: 0, error: '非群聊上下文' }
    const gid = String(e.group_id)
    const botUin = getBotUin(e)
    const now = Math.floor(Date.now() / 1000)
    const cutoff = now - hours * 3600

    let cursor = e.seq || e.message_id || 0
    let collected = 0
    let scanned = 0
    let guard = 0

    while (scanned < maxMessages && guard < 40) {
      let batch = null
      try {
        batch = await e.group.getChatHistory(cursor, Math.min(50, maxMessages - scanned), true)
      } catch (err) {
        logger?.warn?.(`[MemoryV2] 补录历史拉取失败: ${err.message}`)
        break
      }
      if (!Array.isArray(batch) || batch.length === 0) break
      scanned += batch.length

      for (const msg of batch) {
        const time = Number(msg.time) || 0
        if (time < cutoff) continue
        const senderId = String(msg.user_id ?? msg.sender?.user_id ?? '')
        if (!senderId || senderId === botUin) continue
        const text = extractTextFromHistoryMsg(msg)
        // 与实时采集一致：指令消息照样入库，只打标记，提炼侧统一排除
        const isCommand = isCommandText(text)
        // 历史消息同样补结构化段：适配器常把 message 直接给成 CQ 码字符串，故与文本提取同源
        const structured = extractStructured(msg.message ?? msg.segments ?? msg.raw_message)
        if (!text && !hasStructuredContent(structured)) continue
        const messageId = String(msg.message_id ?? msg.seq ?? fallbackMessageId('t', time))
        await this.store.saveRawMessage({
          groupId: gid,
          messageId,
          senderId,
          senderName: msg.sender?.card || msg.sender?.nickname || '',
          role: msg.sender?.role || '',
          text: text.slice(0, 2000),
          time,
          isCommand,
          contentHash: contentHash(text || structuredSignature(structured)),
          ...structuredFields(structured),
        }, this.retentionDays())
        collected++
      }

      const first = batch[0]
      const next = first?.message_id ?? first?.seq
      if (next === undefined || next === null || String(next) === String(cursor)) break
      cursor = next
      guard++
    }

    logger?.info?.(`[MemoryV2] 群 ${gid} 补录完成: 扫描 ${scanned} 条, 入库 ${collected} 条`)
    return { collected, scanned }
  }

  /**
   * 开启群记忆：授权 + 补录最近 24h
   */
  async enableGroup(e) {
    const gid = String(e.group_id)
    if (!e.isGroup || !e.group_id) return { ok: false, message: '此操作仅在群聊中可用' }
    if (!Config.enableMemory) return { ok: false, message: '请先启用「智能模式 记忆设置」中的「启用记忆系统」总开关' }

    const groups = Array.isArray(Config.memoryGroupCapture?.groups) ? Config.memoryGroupCapture.groups : []
    const existed = groups.find(g => String(g.groupId) === gid)
    const next = existed
      ? groups.map(g => String(g.groupId) === gid ? { ...g, switchOn: true } : g)
      : [...groups, { groupId: gid, switchOn: true }]
    Config.memoryGroupCapture = { ...(Config.memoryGroupCapture || {}), groups: next }
    Config.save?.()

    // 补录最近 24 小时
    const backfill = await this.backfillHistory(e, { hours: 24, maxMessages: 500 })
    return { ok: true, message: `已开启本群记忆采集，并补录最近 24 小时（扫描 ${backfill.scanned} 条，入库 ${backfill.collected} 条）。\n可在锅巴「智能模式 记忆设置」查看/管理授权群。` }
  }

  /**
   * 关闭群记忆：取消授权 + 来源级清理
   */
  async disableGroup(e) {
    const gid = String(e.group_id)
    if (!e.isGroup || !e.group_id) return { ok: false, message: '此操作仅在群聊中可用' }
    const groups = Array.isArray(Config.memoryGroupCapture?.groups) ? Config.memoryGroupCapture.groups : []
    Config.memoryGroupCapture = {
      ...(Config.memoryGroupCapture || {}),
      groups: groups.map(g => String(g.groupId) === gid ? { ...g, switchOn: false } : g),
    }
    Config.save?.()

    const result = await this.store.clearGroup(gid)
    logger?.info?.(`[MemoryV2] 群 ${gid} 记忆已关闭并清理: ${JSON.stringify(result)}`)
    return { ok: true, message: `已关闭本群记忆采集，并完成来源级清理（清理原文/任务/证据，共处理记忆 ${result.memoryIds} 条）。` }
  }
}

export const groupCapture = new GroupCapture()
