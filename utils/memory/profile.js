/**
 * 用户画像后端
 *
 * userProfile 工具由 enableMemory 自动注册，使用与每日提炼完全相同的
 * 提取器与 V2 存储：扫描群历史时写入精确事实，返回结构化画像，
 * 不再输出"外向、活跃、幽默"等无证据概括。
 */

import { Config } from '../config.js'
import { msgHistoryMgr } from '../../model/Onebot11_MessageHistoryManager.js'
import { MemoryStore } from './store.js'
import { runExtraction } from './extractor.js'

const FACTKEY_LABELS = {
  'identity.name': '姓名',
  'identity.nickname': '昵称',
  'identity.gender': '性别',
  'identity.pronouns': '称谓',
  'identity.birth_date': '生日',
  'identity.age': '年龄',
  'identity.qq_nickname': 'QQ昵称',
  'identity.group_card': '群名片',
  'profile.occupation': '职业',
  'profile.education': '学历',
  'profile.employment_status': '就业状态',
  'preference.favorite_character': '喜欢的角色',
  'communication.style': '交流风格',
}

const PREFERENCE_LABELS = {
  'preference.favorite_character': '喜欢的角色',
}

/**
 * 扫描目标用户群历史并提取精确事实写入 V2
 * @param {Object} e 云崽事件（群聊）
 * @param {string} targetId
 * @param {Object} [options] { llm, maxTargetMessages, store } 测试可注入模型调用器
 * @returns {Promise<{ok: boolean, message: string, profile?: Object}>}
 */
export async function extractUserProfile(e, targetId, options = {}) {
  const gid = String(e.group_id)
  const tid = String(targetId)

  // 历史扫描开关：默认跟随 Config.enableUserProfileHistoryScan，测试可用 options.scanHistory 覆盖
  const scanEnabled = options.scanHistory ?? Config.enableUserProfileHistoryScan !== false
  if (!scanEnabled) {
    // 关闭扫描：只读已存 V2 画像，不调用 msgHistoryMgr、无副作用
    const store = options.store || new MemoryStore()
    const profile = await buildProfileView(tid, gid, store)
    if (profile.facts.length === 0) {
      return { ok: false, message: `用户 ${tid} 暂无已存画像记忆（历史扫描已关闭，可在锅巴开启"画像扫描群历史"后重新分析）。` }
    }
    return { ok: true, message: `返回用户 ${tid} 的已存画像（历史扫描已关闭，未补充新事实）。`, profile }
  }

  const recordsResult = await msgHistoryMgr.getUserMessageRecords(e, tid, {
    maxTargetMessages: Math.min(Math.max(Number(options.maxTargetMessages) || 200, 1), 500),
    maxScannedMessages: 5000,
  })
  const records = recordsResult.records || []
  if (records.length === 0) {
    return { ok: false, message: `未找到用户 ${tid} 的历史文本消息，无法提取画像。` }
  }

  // 证据：扫描历史中该用户本人消息（含 message_id）
  const evidenceMap = {}
  for (const r of records) {
    evidenceMap[String(r.message_id)] = {
      groupId: gid,
      senderId: tid,
      senderName: '',
      role: '',
      time: Number(r.time) || 0,
    }
  }

  const rows = records.map(r => ({
    messageId: String(r.message_id),
    senderId: tid,
    senderName: '',
    role: '',
    text: String(r.text).slice(0, 500),
    time: Number(r.time) || 0, // 带上消息时间，模型才能可靠换算"上个月/明天/今年 N 岁"等相对时间
  }))

  const cfg = Config.memoryGroupCapture || {}
  const { candidates, rejected } = await runExtraction({
    rows,
    ctx: { groupId: gid, day: 'profile-scan', windowLabel: `历史消息扫描（${records.length} 条）` },
    evidenceMap,
    llm: options.llm, // 测试注入
    cfg: {
      inputTokenLimit: Number(cfg.inputTokenLimit) || 30000,
      outputTokenLimit: Number(cfg.outputTokenLimit) || 4096,
      minConfidence: Number(cfg.minConfidence) || 0.7,
    },
  })

  const store = options.store || new MemoryStore()
  const results = await store.applyCandidates(candidates, {
    groupId: gid,
    day: 'profile-scan',
    source: 'profile-scan',
    evidenceMap,
    maxMemoriesPerUser: Number(Config.maxMemoriesPerUser) || 100,
    eventRetentionDays: Number(cfg.eventRetentionDays) || 90,
  })
  const accepted = results.filter(r => r.ok).length

  const profile = await buildProfileView(tid, gid, store)
  return {
    ok: true,
    message: `已基于 ${records.length} 条历史消息提取用户画像（有效事实 ${accepted} 条，拒绝 ${rejected.length} 条）。`,
    profile,
  }
}

/** 将 V2 记忆组装为结构化画像（仅个人事实：user + user_group，不含群公共记忆） */
export async function buildProfileView(userId, groupId, store = new MemoryStore()) {
  const userMems = await store.listByScope({ scope: 'user', ownerId: String(userId), groupId: '' })
  const ugMems = groupId
    ? await store.listByScope({ scope: 'user_group', ownerId: String(userId), groupId: String(groupId) })
    : []
  const memories = [...userMems, ...ugMems].filter(m => m.status === 'active')
  const lines = []
  const seen = new Set()
  for (const m of memories) {
    const label = FACTKEY_LABELS[m.factKey] || m.factKey
    const key = `${m.factKey}:${m.factValue}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push({ label, text: m.text, factKey: m.factKey, factValue: m.factValue })
  }
  return { userId, groupId, facts: lines }
}

/** 渲染结构化画像文本 */
export function formatProfileView(profile) {
  if (!profile || !profile.facts || profile.facts.length === 0) {
    return '（暂无已提取的精确事实）'
  }
  const lines = profile.facts.map(f => `- ${f.label}：${f.text}`)
  return lines.join('\n')
}

/** 供工具描述引用 */
export { PREFERENCE_LABELS }
