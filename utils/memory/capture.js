/**
 * 群消息观察器：仅采集授权群的非指令、非 Bot 纯文本
 * 富媒体内容（图片/表情/语音/视频/文件）不入库，但保留对应占位符标记，供提炼时理解上下文
 * 记录说话人、角色、时间和消息 ID；原文默认保留 30 天
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

/**
 * 段类型 → 占位符文本（类型归一表与 Onebot11_MessageHistoryManager._extractMediaSegments.mediaType 一致；
 * 注意仅类型映射一致，消费语义不同：本文件把占位符拼入提炼文本，manager 只作媒体统计旁路、不进提炼输入）
 * 结构性类型与未知类型返回 ''（保持忽略，避免噪音）
 */
export function mediaPlaceholder(type) {
  const normalized = String(type || '').toLowerCase()
  if (!normalized || STRUCTURAL_TYPES.has(normalized)) return ''
  if (['image', 'flash'].includes(normalized)) return MEDIA_PLACEHOLDERS.image
  if (['face', 'mface', 'marketface', 'emoji', 'sticker'].includes(normalized)) return MEDIA_PLACEHOLDERS.sticker
  if (['video', 'shortvideo'].includes(normalized)) return MEDIA_PLACEHOLDERS.video
  if (['record', 'audio', 'voice'].includes(normalized)) return MEDIA_PLACEHOLDERS.audio
  if (normalized === 'file') return MEDIA_PLACEHOLDERS.file
  return ''
}

/** 匹配 OneBot CQ 码（字符串形态消息用） */
const CQ_TAG_REGEX = /\[CQ:([A-Za-z]+)(?:,[^\]]*)?\]/g

/** 字符串消息中富媒体 CQ 码替换为占位符；at/reply 等结构性码与未知码删除 */
function replaceMediaCQ(text) {
  return String(text).replace(CQ_TAG_REGEX, (match, type) => mediaPlaceholder(type))
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

/** 判断是否为云崽指令（# / 开头） */
export function isCommandText(text) {
  if (!text) return false
  return /^[#/／]/.test(text.trimStart())
}

/** 从云崽事件提取纯文本（富媒体段以占位符标记，at/reply 等结构段忽略） */
export function extractTextFromEvent(e) {
  if (e.msg && typeof e.msg === 'string') return extractTextFromString(e.msg)
  if (Array.isArray(e.message)) {
    return e.message
      .map(s => {
        if (s.type === 'text') return s.text || s.data?.text || ''
        return mediaPlaceholder(s.type)
      })
      .join('')
      .trim()
  }
  return ''
}

/** 从历史消息提取纯文本：兼容 OneBot 段数组、message 字符串与 raw_message（富媒体转占位符，其余 CQ 码清除） */
export function extractTextFromHistoryMsg(msg) {
  if (!msg) return ''
  // 部分适配器返回 message 为字符串
  if (typeof msg.message === 'string') return extractTextFromString(msg.message)
  const segments = Array.isArray(msg.message) ? msg.message : (msg.segments || [])
  const text = segments
    .map(s => {
      if (s.type === 'text') return s.text || s.data?.text || ''
      return mediaPlaceholder(s.type)
    })
    .join('')
  if (text.trim()) return text.trim()
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

export class GroupCapture {
  constructor(options = {}) {
    this.store = options.store || new MemoryStore()
  }

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
      if (!text || isCommandText(text)) return false

      await this.store.saveRawMessage({
        groupId: String(e.group_id),
        messageId: String(e.message_id ?? e.seq ?? `t${e.time || Date.now()}`),
        senderId: String(e.user_id),
        senderName: e.sender?.card || e.sender?.nickname || '',
        role: e.sender?.role || '',
        text: text.slice(0, 2000),
        time: Math.floor(Number(e.time) || Date.now() / 1000),
        isCommand: false,
        contentHash: contentHash(text),
      }, this.retentionDays())
      return false
    } catch (err) {
      logger?.error?.(`[MemoryV2] 观察器采集失败: ${err.message}`)
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
        if (!text || isCommandText(text)) continue
        const messageId = String(msg.message_id ?? msg.seq ?? `t${time}`)
        await this.store.saveRawMessage({
          groupId: gid,
          messageId,
          senderId,
          senderName: msg.sender?.card || msg.sender?.nickname || '',
          role: msg.sender?.role || '',
          text: text.slice(0, 2000),
          time,
          isCommand: false,
          contentHash: contentHash(text),
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
