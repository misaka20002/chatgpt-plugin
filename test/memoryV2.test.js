/**
 * 智能模式 V2 记忆系统测试（Node 内置测试，无需额外依赖）
 *
 * 运行：npm run test:memory
 *
 * 覆盖验收点：
 * 1. 原子提取：失业日期/求职计划/喜欢角色/玩游戏原因 分别保存，不合并成聊天摘要
 * 2. 拒绝：他人转述、猜测、玩笑、Bot 消息、命令、敏感数据不入库
 * 3. 去重强化 / 单值替换 / 多值共存 / 明确否定撤回 / 有效期清理
 * 4. 多群来源：关闭一个群不误删其他来源确认的事实
 * 5. 任务幂等、失败重试、漏跑补提炼
 * 6. 旧记忆完全不可见，首次 V2 写入时被删除
 * 7. 总开关关闭 / 群未授权时不采集
 * 8. 端到端相关性召回
 */

import test from 'node:test'
import assert from 'node:assert/strict'

/* ================= Mock Redis（内存实现） ================= */

class MockRedis {
  constructor() {
    this.data = new Map() // key -> string | Set | Map(hash) | Map(zset)
  }

  async get(k) { const v = this.data.get(k); return typeof v === 'string' ? v : null }
  async set(k, v) { this.data.set(k, String(v)); return 'OK' }
  async del(...keys) { let n = 0; for (const k of keys) if (this.data.delete(k)) n++; return n }
  async expire(k, seconds) { this.data.set(`__ttl:${k}`, Date.now() + seconds * 1000); return 1 }
  async exists(k) { return this.data.has(k) ? 1 : 0 }

  async hGetAll(k) { const v = this.data.get(k); return v instanceof Map ? Object.fromEntries([...v.entries()]) : {} }
  async hSet(k, ...args) {
    if (!(this.data.get(k) instanceof Map)) this.data.set(k, new Map())
    const m = this.data.get(k)
    if (args.length === 1 && typeof args[0] === 'object') {
      for (const [f, val] of Object.entries(args[0])) m.set(String(f), String(val))
    } else {
      for (let i = 0; i < args.length; i += 2) m.set(String(args[i]), String(args[i + 1]))
    }
    return 1
  }
  async hDel(k, ...fields) {
    const m = this.data.get(k)
    if (!(m instanceof Map)) return 0
    let n = 0
    for (const f of fields) if (m.delete(String(f))) n++
    return n
  }

  async sAdd(k, ...members) {
    if (!(this.data.get(k) instanceof Set)) this.data.set(k, new Set())
    const s = this.data.get(k)
    let n = 0
    for (const m of members) if (!s.has(String(m))) { s.add(String(m)); n++ }
    return n
  }
  async sRem(k, ...members) {
    const s = this.data.get(k)
    if (!(s instanceof Set)) return 0
    let n = 0
    for (const m of members) if (s.delete(String(m))) n++
    return n
  }
  async sMembers(k) { const s = this.data.get(k); return s instanceof Set ? [...s] : [] }

  async zAdd(k, memberOrObj, score) {
    if (!(this.data.get(k) instanceof Map)) this.data.set(k, new Map())
    const z = this.data.get(k)
    if (memberOrObj && typeof memberOrObj === 'object' && !Array.isArray(memberOrObj)) {
      z.set(String(memberOrObj.value), Number(memberOrObj.score))
    } else {
      z.set(String(memberOrObj), Number(score))
    }
    return 1
  }
  async zRange(k, start, stop) {
    const z = this.data.get(k)
    if (!(z instanceof Map)) return []
    const sorted = [...z.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0])
    return sorted.slice(start, stop === -1 ? undefined : stop + 1)
  }
  async zRangeByScore(k, min, max) {
    const z = this.data.get(k)
    if (!(z instanceof Map)) return []
    return [...z.entries()].filter(([, s]) => s >= min && s <= max).sort((a, b) => a[1] - b[1]).map(e => e[0])
  }
  async zRem(k, ...members) {
    const z = this.data.get(k)
    if (!(z instanceof Map)) return 0
    let n = 0
    for (const m of members) if (z.delete(String(m))) n++
    return n
  }

  *scanIterator({ MATCH = '*', COUNT = 1000 } = {}) {
    const escaped = MATCH.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    const re = new RegExp(`^${escaped}$`)
    for (const key of this.data.keys()) {
      if (re.test(key)) yield key
    }
  }
}

/* ================= 测试环境准备 ================= */

const mockRedis = new MockRedis()
global.redis = mockRedis

// TRSS 运行环境中 logger 是全局变量；测试环境提供 stub
if (!globalThis.logger) {
  globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, trace() {}, log() {} }
}

const { MemoryStore, isSingleValueFact, canonicalFactKey, validateCandidateShape } = await import('../utils/memory/store.js')
const { runExtraction, validateEvidence, parseCandidates } = await import('../utils/memory/extractor.js')
const { buildMemoryPrompt, rankMemories, relevanceScore } = await import('../utils/memory/recall.js')
const { groupCapture } = await import('../utils/memory/capture.js')
const { DailyConsolidation, dayKey, dayToTs, nextDayKey, yesterdayKey, todayKey } = await import('../utils/memory/dailyTask.js')
const { Config } = await import('../utils/config.js')

// 直接修改内部配置对象（绕过 Proxy，避免写入 config.json）
function setConfig(patch) {
  Object.assign(Config.getConfig(), patch)
}
function resetConfig() {
  setConfig({
    enableMemory: true,
    maxMemoriesPerUser: 100,
    memoryMinImportance: 0.4,
    memoryContextLimit: 8,
    memoryGroupCapture: {
      groups: [{ groupId: '100', switchOn: true }],
      cronTime: '0 0 4 * * ? *',
      rawRetentionDays: 30,
      eventRetentionDays: 90,
      inputTokenLimit: 30000,
      outputTokenLimit: 4096,
      minConfidence: 0.7,
    },
  })
}
resetConfig()

/** 构造证据上下文 */
function mkEvidenceMap(groupId, rows) {
  const map = {}
  for (const r of rows) {
    map[r.messageId] = { groupId, senderId: r.senderId, senderName: r.senderName || '', role: r.role || '', time: r.time || 1700000000 }
  }
  return map
}

/** 快捷写入一条事实（模拟每日提炼通过校验的候选） */
async function writeFact(store, groupId, candidate, rows) {
  const evidenceMap = mkEvidenceMap(groupId, rows)
  const res = await store.applyFact({
    ...candidate,
    subjectId: candidate.scope === 'group' ? '' : (candidate.subjectId || rows[0].senderId),
    evidenceMessageIds: candidate.evidenceMessageIds || rows.map(r => r.messageId),
  }, {
    groupId,
    source: candidate.source || `group-window:${groupId}:2026-08-30`,
    evidenceMap,
    maxMemoriesPerUser: 100,
    eventRetentionDays: 90,
  })
  return { res, evidenceMap }
}

const clearStore = async () => { for (const k of [...mockRedis.data.keys()]) mockRedis.data.delete(k) }

/* ================= 用例 ================= */

test('原子提取：失业/求职/喜欢角色/玩游戏原因分别保存，不合并为聊天摘要', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const groupId = '100'
  const rows = [
    { messageId: 'm1', senderId: '10001', senderName: '玉玉', role: '', text: '我是上个月6月15号被裁的，准备下个月开始投简历找工作；我最喜欢的角色是雷电将军，就是因为她的传说任务剧情太震撼了才入坑原神的', time: 1780000000 },
  ]
  const evidenceMap = mkEvidenceMap(groupId, rows)

  // 规则型"模型"：读取真实组装的 prompt（含群原文与规则），根据原文关键词生成原子候选。
  // 证明提取器把原文传给了模型、输出被解析并通过服务端校验后写入——而非手工预拆结果。
  const fakeLLM = async (prompt) => {
    assert.match(prompt, /我是上个月6月15号被裁的/, 'prompt 应包含群聊原文')
    assert.ok(prompt.indexOf('我是上个月6月15号') > prompt.indexOf('任务：从群聊原文中提炼'), '规则应位于原文之前')
    const candidates = []
    if (prompt.includes('被裁') || prompt.includes('失业')) {
      candidates.push({ operation: 'add', scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'profile.employment_status', factValue: 'laid_off', text: '用户于 2026-06-15 失业', kind: 'identity', confidence: 0.9, importance: 0.8, evidenceMessageIds: ['m1'] })
    }
    if (prompt.includes('投简历') || prompt.includes('找工作')) {
      candidates.push({ operation: 'add', scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'plan.job_search', factValue: 'start_next_month', text: '用户计划 2026-08 开始投简历找工作', kind: 'plan', confidence: 0.85, importance: 0.7, validTo: '2026-12-31', evidenceMessageIds: ['m1'] })
    }
    if (prompt.includes('最喜欢的角色') || prompt.includes('雷电将军')) {
      candidates.push({ operation: 'add', scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'preference.favorite_character', factValue: 'raiden_shogun', text: '用户最喜欢的角色是雷电将军', kind: 'preference', confidence: 0.9, importance: 0.6, evidenceMessageIds: ['m1'] })
    }
    if (prompt.includes('入坑') || prompt.includes('传说任务')) {
      candidates.push({ operation: 'add', scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'preference.game_reason_genshin', factValue: 'raiden_legend_quest', text: '用户因为雷电将军传说任务剧情入坑原神', kind: 'preference', confidence: 0.8, importance: 0.6, evidenceMessageIds: ['m1'] })
    }
    return { text: JSON.stringify({ candidates }) }
  }

  const { candidates } = await runExtraction({
    rows: rows.map(r => ({ messageId: r.messageId, senderId: r.senderId, senderName: r.senderName, role: r.role, text: r.text })),
    ctx: { groupId, day: '2026-08-30', windowLabel: '2026-08-30 全天' },
    evidenceMap,
    cfg: { inputTokenLimit: 30000, outputTokenLimit: 4096, minConfidence: 0.7 },
    llm: fakeLLM,
  })
  assert.equal(candidates.length, 4, '应接受 4 条独立原子事实')

  const results = await store.applyCandidates(candidates, {
    groupId, day: '2026-08-30', source: `group-window:${groupId}:2026-08-30`, evidenceMap, maxMemoriesPerUser: 100, eventRetentionDays: 90,
  })
  assert.equal(results.filter(r => r.ok).length, 4)

  const recalled = await store.listRecallCandidates('10001', groupId)
  const byKey = Object.fromEntries(recalled.map(m => [m.factKey, m]))
  assert.ok(byKey['profile.employment_status'], '应保存失业日期')
  assert.match(byKey['profile.employment_status'].text, /2026-06-15/)
  assert.ok(byKey['plan.job_search'], '应保存求职计划')
  assert.ok(byKey['preference.favorite_character'], '应保存喜欢角色')
  assert.ok(byKey['preference.game_reason_genshin'], '应保存玩游戏原因')
  assert.equal(recalled.length, 4, '不得合并为聊天摘要')
})

test('拒绝：他人转述、猜测、低置信度、无证据不入库（内容不做过滤）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const groupId = '100'
  const rows = [
    { messageId: 'm1', senderId: '10001', senderName: 'A', role: '', text: '听说 10002 是女生', time: 1780000000 },
    { messageId: 'm2', senderId: '10002', senderName: 'B', role: '', text: '我的手机号是 13812345678', time: 1780000100 },
  ]
  const evidenceMap = mkEvidenceMap(groupId, rows)

  // 1. 他人转述：subjectId(10002) 不是证据 m1 的发送者
  const hearsay = { scope: 'user', subjectId: '10002', speakerId: '10002', factKey: 'identity.gender', factValue: 'female', text: '用户是女生', kind: 'identity', confidence: 0.8, importance: 0.5, evidenceMessageIds: ['m1'] }
  assert.equal(validateEvidence(hearsay, evidenceMap).ok, false, '他人转述必须拒绝')

  // 2. 猜测/玩笑：无证据 ID
  const noEvidence = { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.age', factValue: '25', text: '用户25岁', kind: 'identity', confidence: 0.8, importance: 0.5, evidenceMessageIds: [] }
  const shapeCheck = validateCandidateShape(noEvidence)
  assert.equal(shapeCheck.ok, false, '缺少证据必须拒绝')

  // 3. 低置信度：0.5 < 0.7
  const fakeLLM = async () => ({
    text: JSON.stringify({ candidates: [
      { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.nickname', factValue: 'x', text: '用户昵称x', kind: 'identity', confidence: 0.5, importance: 0.5, evidenceMessageIds: ['m1'] },
    ] }),
  })
  const lowConf = await runExtraction({
    rows: [{ messageId: 'm1', senderId: '10001', senderName: 'A', role: '', text: '嗯嗯' }],
    ctx: { groupId, day: '2026-08-30', windowLabel: 'x' },
    evidenceMap, cfg: { minConfidence: 0.7 }, llm: fakeLLM,
  })
  assert.equal(lowConf.candidates.length, 0, '低于置信度阈值必须拒绝')

  // 4. 服务端不做内容过滤：个人资料类与凭证类都按普通事实处理
  const applyCtx = { groupId, source: 'Memory_Tool', evidenceMap, maxMemoriesPerUser: 100, eventRetentionDays: 90 }
  const phoneCand = { scope: 'user', subjectId: '10002', speakerId: '10002', factKey: 'identity.phone', factValue: '13812345678', text: '用户的手机号是13812345678', kind: 'identity', confidence: 0.9, importance: 0.9, evidenceMessageIds: ['m2'] }
  assert.equal((await store.applyFact(phoneCand, applyCtx)).ok, true, '个人资料类正常写入')
  const codeCand = { scope: 'user', subjectId: '10002', speakerId: '10002', factKey: 'identity.note', factValue: 'code_123456', text: '用户的验证码是123456', kind: 'identity', confidence: 0.9, importance: 0.9, evidenceMessageIds: ['m2'] }
  assert.equal((await store.applyFact(codeCand, applyCtx)).ok, true, '凭证类也不按内容拦截（只由提示词层建议取舍）')
})

test('去重强化 / 单值替换 / 多值共存 / 明确否定撤回 / 有效期过滤', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const groupId = '100'
  const row1 = [{ messageId: 'm1', senderId: '10001', senderName: 'A', role: '', text: '我是男的', time: 1780000000 }]

  // 1. 首次写入 gender=male
  const first = await writeFact(store, groupId,
    { scope: 'user', factKey: 'identity.gender', factValue: 'male', text: '用户自述为男', kind: 'identity', confidence: 0.9, importance: 0.6 },
    row1)
  assert.equal(first.res.action, 'added')

  // 2. 相同事实重复（新证据消息 m2）→ 强化
  const row2 = [{ messageId: 'm2', senderId: '10001', senderName: 'A', role: '', text: '我是男的啊', time: 1780000100 }]
  const second = await writeFact(store, groupId,
    { scope: 'user', factKey: 'identity.gender', factValue: 'male', text: '用户自述为男', kind: 'identity', confidence: 0.9, importance: 0.6 },
    row2)
  assert.equal(second.res.action, 'reinforced', '同值重复应强化')
  let genderMem = await store.getMemory(second.res.memoryId)
  assert.ok(genderMem.confidence > 0.9, '置信度应提升')
  const evdAfterMerge = await mockRedis.sMembers(`CHATGPT:MEMORY:V2:evd:${second.res.memoryId}`)
  assert.equal(evdAfterMerge.length, 2, '证据应合并')

  // 3. 完全相同（同一证据）→ 幂等跳过
  const third = await writeFact(store, groupId,
    { scope: 'user', factKey: 'identity.gender', factValue: 'male', text: '用户自述为男', kind: 'identity', confidence: 0.9, importance: 0.6 },
    row2)
  assert.equal(third.res.action, 'skipped', '证据全同应幂等跳过')

  // 4. 单值冲突 → 替换
  const conflict = await writeFact(store, groupId,
    { scope: 'user', factKey: 'identity.gender', factValue: 'female', text: '用户自述为女', kind: 'identity', confidence: 0.95, importance: 0.6 },
    [{ messageId: 'm3', senderId: '10001', senderName: 'A', role: '', text: '其实我是女的', time: 1780000200 }])
  assert.equal(conflict.res.action, 'added', '单值冲突应写入新值')
  const genderRows = await store.listByScope({ scope: 'user', ownerId: '10001', groupId: '', includeArchived: true })
  const activeGender = genderRows.filter(m => m.status === 'active')
  const archivedGender = genderRows.filter(m => m.status === 'archived')
  assert.equal(activeGender.length, 1, '单值槽位只能有一个 active')
  assert.equal(activeGender[0].factValue, 'female')
  assert.ok(archivedGender.length >= 1, '旧值应归档')
  assert.equal(archivedGender[0].source, 'superseded')

  // 5. 多值偏好共存
  await writeFact(store, groupId,
    { scope: 'user', factKey: 'preference.favorite_character', factValue: 'raiden_shogun', text: '用户喜欢雷电将军', kind: 'preference', confidence: 0.9, importance: 0.5 },
    [{ messageId: 'm4', senderId: '10001', senderName: 'A', role: '', text: '我最喜欢雷电将军', time: 1780000300 }])
  await writeFact(store, groupId,
    { scope: 'user', factKey: 'preference.favorite_character', factValue: 'hutao', text: '用户也喜欢胡桃', kind: 'preference', confidence: 0.85, importance: 0.5 },
    [{ messageId: 'm5', senderId: '10001', senderName: 'A', role: '', text: '胡桃也很可爱', time: 1780000400 }])
  const charRows = await store.listByScope({ scope: 'user', ownerId: '10001', groupId: '' })
  const activeChars = charRows.filter(m => m.factKey === 'preference.favorite_character' && m.status === 'active')
  assert.equal(activeChars.length, 2, '多值偏好应共存')

  // 6. 明确否定 → 撤回
  const retract = await writeFact(store, groupId,
    { operation: 'retract', scope: 'user', factKey: 'preference.favorite_character', factValue: 'hutao', text: '用户不再喜欢胡桃', kind: 'preference', confidence: 0.9, importance: 0.5 },
    [{ messageId: 'm6', senderId: '10001', senderName: 'A', role: '', text: '我不喜欢胡桃了', time: 1780000500 }])
  assert.equal(retract.res.action, 'retracted', '明确否定应撤回')
  const afterRetract = await store.listByScope({ scope: 'user', ownerId: '10001', groupId: '' })
  const hutaoActive = afterRetract.filter(m => m.factKey === 'preference.favorite_character' && m.factValue === 'hutao' && m.status === 'active')
  assert.equal(hutaoActive.length, 0, '撤回后不应有 active')

  // 7. 有效期过滤：过期事实不参与召回
  await writeFact(store, groupId,
    { scope: 'user', factKey: 'plan.meeting', factValue: 'yesterday', text: '用户昨天开会', kind: 'episode', confidence: 0.9, importance: 0.5, validTo: '2026-01-01' },
    [{ messageId: 'm7', senderId: '10001', senderName: 'A', role: '', text: '昨天开会了', time: 1780000600 }])
  const recalled = await store.listRecallCandidates('10001', groupId)
  assert.ok(!recalled.some(m => m.factKey === 'plan.meeting'), '过期记忆不应召回')
})

test('多群来源：关闭一个群不误删其他来源确认的事实', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  // 同一事实：群 100 与群 200 均有证据
  const rA = [{ messageId: 'a1', senderId: '10001', senderName: 'A', role: '', text: '我在腾讯上班', time: 1780000000 }]
  const rB = [{ messageId: 'b1', senderId: '10001', senderName: 'A', role: '', text: '我又说了一遍我在腾讯', time: 1780001000 }]
  const first = await writeFact(store, '100',
    { scope: 'user', factKey: 'profile.occupation', factValue: 'tencent', text: '用户在腾讯工作', kind: 'identity', confidence: 0.9, importance: 0.7 },
    rA)
  const second = await writeFact(store, '200',
    { scope: 'user', factKey: 'profile.occupation', factValue: 'tencent', text: '用户在腾讯工作', kind: 'identity', confidence: 0.9, importance: 0.7 },
    rB)
  assert.equal(second.res.action, 'reinforced')

  // 仅群 100 支持的事实
  await writeFact(store, '100',
    { scope: 'user_group', factKey: 'group_role.release', factValue: 'weekly_release', text: '用户在本群负责每周发布版本', kind: 'identity', confidence: 0.9, importance: 0.6 },
    rA)

  // 关闭群 100
  const cleared = await store.clearGroup('100')
  assert.ok(cleared.memoryIds >= 2)

  // 跨群事实仍在（有其他来源证据）
  const occupationRows = await store.listByScope({ scope: 'user', ownerId: '10001', groupId: '' })
  const occupation = occupationRows.find(m => m.factKey === 'profile.occupation')
  assert.ok(occupation && occupation.status === 'active', '多群支持的事实应保留')
  const evd = await mockRedis.sMembers(`CHATGPT:MEMORY:V2:evd:${occupation.id}`)
  assert.ok(evd.every(e => !e.includes('"g":"100"')), '应只移除群100的证据')

  // 本群 user_group 记忆应删除
  const ugRows = await store.listByScope({ scope: 'user_group', ownerId: '10001', groupId: '100' })
  assert.equal(ugRows.filter(m => m.status === 'active').length, 0, '仅本群支持的事实应删除')

  // 群 100 原文应删除
  const raws = await store.getRawMessages('100', 0, Date.now() / 1000 + 999999)
  assert.equal(raws.length, 0)
})

test('任务：幂等入队、失败重试退避、漏跑补提炼', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const baseCfg = { inputTokenLimit: 30000, outputTokenLimit: 4096, minConfidence: 0.7, maxAttempts: 3, rawRetentionDays: 30, eventRetentionDays: 90, use: null }
  const dc = new DailyConsolidation({ store })

  // 预置三天原文（北京时间自然日：大前天、前天、昨天）
  const d3 = yesterdayKey()
  const d2 = dayKey(dayToTs(d3) - 86400)
  const d1 = dayKey(dayToTs(d3) - 2 * 86400)
  for (const [i, day] of [d1, d2, d3].entries()) {
    const ts = dayToTs(day) + 3600
    await store.saveRawMessage({
      groupId: gid, messageId: `raw${i}`, senderId: '10001', senderName: 'A', role: '',
      text: `第${i}天：我叫玉玉，今年25岁，在腾讯上班`, time: ts, isCommand: false,
      contentHash: `h${i}`,
    }, 30)
  }

  // 1. 幂等入队
  assert.equal(await dc.ensureTask(gid, d1), true)
  assert.equal(await dc.ensureTask(gid, d1), false, '重复入队应幂等')

  // 2. runDaily 补提炼：游标推进，漏跑的日子全部入队并处理（注入 fake LLM 返回空候选）
  const cfgOk = { ...baseCfg, llm: async () => ({ text: '{"candidates":[]}' }) }
  const run1 = await dc.runDaily(cfgOk)
  assert.ok(run1.groups.length >= 1, '应处理授权群')
  const tasks1 = await store.listTasks(gid)
  assert.equal(tasks1.length, 3, `漏跑应补提炼3个窗口，实际 ${tasks1.length}`)
  assert.equal(tasks1.filter(t => t.status === 'completed').length, 3)

  // 3. 再次运行不重复写入
  const run2 = await dc.runDaily(cfgOk)
  const tasks2 = await store.listTasks(gid)
  assert.equal(tasks2.length, 3, '再次运行不应新增窗口')

  // 4. 失败重试退避（真实 processWindow，注入抛错的 LLM；d3 是有原文的日期）
  const cfgFail = { ...baseCfg, llm: async () => { throw new Error('model timeout') } }
  await store.setTask(gid, d3, { status: 'pending', attemptCount: 0, nextAttemptAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() })
  const retry = await dc.processWindow(gid, d3, cfgFail)
  assert.equal(retry.status, 'retry', '失败应进入重试')
  const t1 = await store.getTask(gid, d3)
  assert.equal(t1.status, 'pending')
  assert.equal(t1.attemptCount, '1')
  assert.ok(Number(t1.nextAttemptAt) > Date.now(), '应有退避时间')

  // 5. 失败达上限 → failed；runImmediate 重置 failed 并重试成功
  await store.setTask(gid, '2026-08-02', { status: 'failed', error: 'max attempts', attemptCount: 3, updatedAt: Date.now() })
  const immediate = await dc.runImmediate(gid, cfgOk)
  assert.equal(immediate.ok, true)
  const failedTask = await store.getTask(gid, '2026-08-02')
  assert.equal(failedTask.status, 'completed', '失败任务应被重置并重试成功')
})

test('旧记忆：首次 V2 写入时删除旧 Hash，旧记忆不再可见', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  // 预置旧版 Hash
  await mockRedis.hSet('CHATGPT:MEMORY:USER:10001', 'old1', JSON.stringify({ id: 'old1', memoryType: 'user_profile', content: '旧记忆', importance: 9 }))
  assert.equal(await mockRedis.exists('CHATGPT:MEMORY:USER:10001'), 1)

  // 首次写入 V2 个人记忆
  await writeFact(store, '100',
    { scope: 'user', factKey: 'identity.nickname', factValue: 'yuyu', text: '用户昵称玉玉', kind: 'identity', confidence: 0.9, importance: 0.6 },
    [{ messageId: 'n1', senderId: '10001', senderName: 'A', role: '', text: '我叫玉玉', time: 1780000000 }])

  assert.equal(await mockRedis.exists('CHATGPT:MEMORY:USER:10001'), 0, '旧 Hash 应在首次 V2 写入时删除')
  // V2 召回不包含旧记忆
  const recalled = await store.listRecallCandidates('10001', '100')
  assert.ok(!recalled.some(m => m.id === 'old1'))
})

test('needs_reextract：补录新消息到已完成日会重新提炼，普通消息不触发', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const cfgOk = {
    inputTokenLimit: 30000, outputTokenLimit: 4096, minConfidence: 0.7, maxAttempts: 3,
    rawRetentionDays: 30, eventRetentionDays: 90, use: null,
    llm: async () => ({ text: '{"candidates":[]}' }),
  }
  const dc = new DailyConsolidation({ store })
  const day = yesterdayKey()
  const ts = dayToTs(day) + 3600

  // 1. 预置该日一条原文并完成提炼
  await store.saveRawMessage({ groupId: gid, messageId: 'r1', senderId: '10001', senderName: 'A', role: '', text: '我叫玉玉', time: ts, isCommand: false, contentHash: 'h1' }, 30)
  await dc.runDaily(cfgOk)
  let task = await store.getTask(gid, day)
  assert.equal(task.status, 'completed')

  // 2. 补录一条新消息到同一日 → 任务标记 needsReextract
  await store.saveRawMessage({ groupId: gid, messageId: 'r2', senderId: '10001', senderName: 'A', role: '', text: '我在腾讯上班', time: ts + 60, isCommand: false, contentHash: 'h2' }, 30)
  task = await store.getTask(gid, day)
  assert.equal(String(task.needsReextract), '1', 'completed 窗口应被标记重新提炼')

  // 3. ensureTask 应重新入队
  const requeued = await dc.ensureTask(gid, day)
  assert.equal(requeued, true, 'needsReextract 窗口应重新入队')
  task = await store.getTask(gid, day)
  assert.equal(task.status, 'pending', '应重置为 pending')
  assert.notEqual(String(task.needsReextract), '1', '重新入队后应清除标记')

  // 4. 再次提炼完成，标记不残留
  await dc.runDaily(cfgOk)
  task = await store.getTask(gid, day)
  assert.equal(task.status, 'completed')
  assert.notEqual(String(task.needsReextract), '1', '完成后不应残留 needsReextract')

  // 5. 正常新消息（非补录场景：任务已 completed 且当天是昨天）—— 相同日再写一条仍会标记（这是设计：任何新原文都会触发）
  //    但重复 runDaily 不应把未标记的 completed 任务重复入队
  const before = await store.listTasks(gid).then(t => t.length)
  const requeued2 = await dc.ensureTask(gid, day)
  assert.equal(requeued2, false, '无 needsReextract 的 completed 任务不应重复入队')
})

test('观察器：总开关关闭 / 群未授权时不采集；指令与 Bot 消息不采集', async () => {
  await clearStore()
  resetConfig()
  const store = new MemoryStore(mockRedis)
  const capture = groupCapture
  // 注入测试 store（观察器默认用全局 redis 的单例 store；这里改用它内部 store 指向 mock）
  capture.store = store

  const baseEvent = {
    isGroup: true, group_id: '100', user_id: '10001', time: 1780000000,
    message: [{ type: 'text', text: '今天天气不错' }],
    msg: '今天天气不错',
    sender: { role: 'member', card: '', nickname: 'A' },
    message_id: 'e1', self_id: '999',
  }

  // 总开关关闭
  setConfig({ enableMemory: false })
  await capture.observe({ ...baseEvent })
  assert.equal((await store.getRawMessages('100', 0, 1999999999)).length, 0, '总开关关闭不采集')

  // 开启但群未授权
  setConfig({ enableMemory: true, memoryGroupCapture: { ...Config.getConfig().memoryGroupCapture, groups: [{ groupId: '200', switchOn: true }] } })
  await capture.observe({ ...baseEvent })
  assert.equal((await store.getRawMessages('100', 0, 1999999999)).length, 0, '群未授权不采集')

  // 授权群 + 普通文本 → 采集
  setConfig({ enableMemory: true, memoryGroupCapture: { ...Config.getConfig().memoryGroupCapture, groups: [{ groupId: '100', switchOn: true }] } })
  await capture.observe({ ...baseEvent })
  assert.equal((await store.getRawMessages('100', 0, 1999999999)).length, 1, '授权群普通文本应采集')

  // 指令消息 → 不采集
  await capture.observe({ ...baseEvent, msg: '#我的记忆', message: [{ type: 'text', text: '#我的记忆' }], message_id: 'e2' })
  assert.equal((await store.getRawMessages('100', 0, 1999999999)).length, 1, '指令消息不采集')

  // Bot 自己的消息 → 不采集
  await capture.observe({ ...baseEvent, user_id: '999', message_id: 'e3' })
  assert.equal((await store.getRawMessages('100', 0, 1999999999)).length, 1, 'Bot 消息不采集')

  // 私聊 → 不采集
  await capture.observe({ ...baseEvent, isGroup: false, group_id: undefined, message_id: 'e4' })
  assert.equal((await store.getRawMessages('100', 0, 1999999999)).length, 1, '私聊不采集')
})

test('端到端召回：相关问题召回正确事实，无关对话不注入整份记忆', async () => {
  await clearStore()
  resetConfig()
  const store = new MemoryStore(mockRedis)
  const groupId = '100'
  const rows = [
    { messageId: 'm1', senderId: '10001', senderName: 'A', role: '', text: '我是上个月6月15号被裁的，准备下个月开始投简历', time: 1780000000 },
    { messageId: 'm2', senderId: '10001', senderName: 'A', role: '', text: '我最喜欢的角色是雷电将军，就是因为她的传说任务入坑的原神', time: 1780000100 },
    { messageId: 'm3', senderId: '10001', senderName: 'A', role: '', text: '我叫玉玉，今年25岁', time: 1780000200 },
  ]
  const evidenceMap = mkEvidenceMap(groupId, rows)
  const candidates = [
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'profile.employment_status', factValue: 'laid_off', text: '用户于 2026-06-15 失业', kind: 'identity', confidence: 0.9, importance: 0.8, evidenceMessageIds: ['m1'] },
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'plan.job_search', factValue: 'next_month', text: '用户计划 2026-08 开始投简历找工作', kind: 'plan', confidence: 0.85, importance: 0.7, validTo: '2030-01-01', evidenceMessageIds: ['m1'] },
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'preference.favorite_character', factValue: 'raiden_shogun', text: '用户最喜欢的角色是雷电将军', kind: 'preference', confidence: 0.9, importance: 0.6, evidenceMessageIds: ['m2'] },
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'preference.game_reason_genshin', factValue: 'legend_quest', text: '用户因雷电将军传说任务入坑原神', kind: 'preference', confidence: 0.8, importance: 0.6, evidenceMessageIds: ['m2'] },
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.nickname', factValue: 'yuyu', text: '用户昵称玉玉', kind: 'identity', confidence: 0.95, importance: 0.7, evidenceMessageIds: ['m3'] },
  ]
  await store.applyCandidates(candidates, { groupId, day: '2026-08-30', source: `group-window:${groupId}:2026-08-30`, evidenceMap, maxMemoriesPerUser: 100, eventRetentionDays: 90 })

  const e = { user_id: '10001', group_id: groupId }

  // 1. "我什么时候失业的" → 应召回失业事实
  const prompt1 = await buildMemoryPrompt(e, '我什么时候失业的', { store, config: { memoryContextLimit: 8, memoryMinImportance: 0.4 } })
  assert.match(prompt1, /失业/, '应召回失业事实')
  assert.match(prompt1, /不可信数据/, '应标记为不可信历史数据')

  // 2. "我打算什么时候找工作" → 应召回求职计划
  const prompt2 = await buildMemoryPrompt(e, '我打算什么时候开始找工作投简历', { store, config: { memoryContextLimit: 8, memoryMinImportance: 0.4 } })
  assert.match(prompt2, /投简历找工作|找工作计划/, '应召回求职计划')

  // 3. 无关对话 → 不注入整份记忆（无相关命中，且非 resident 画像）
  const prompt3 = await buildMemoryPrompt(e, '今天晚饭吃什么好呢', { store, config: { memoryContextLimit: 8, memoryMinImportance: 0.4 } })
  // 昵称是 resident 画像可常驻；但失业/角色/游戏原因不应出现
  assert.ok(!prompt3.includes('失业'), '无关对话不应注入失业记忆')
  assert.ok(!prompt3.includes('雷电将军'), '无关对话不应注入角色记忆')
  assert.ok(!prompt3.includes('入坑原神'), '无关对话不应注入游戏原因')
})

test('工具链：Memory_Tool 服务端补充证据，伪造归属被拒绝', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const groupId = '100'

  // 模型伪造 subjectId 为他人：服务端强制使用当前用户
  const evidenceMap = mkEvidenceMap(groupId, [{ messageId: 't1', senderId: '10001', senderName: 'A', role: '', text: '我25岁', time: 1780000000 }])
  // 通过 applyFact 传入用户伪造的 subjectId（等价 Memory_Tool 中服务端覆盖前的情况被校验）
  const fakeOwner = await store.applyFact({
    scope: 'user', subjectId: '99999', speakerId: '99999', factKey: 'identity.age', factValue: '25',
    text: '用户25岁', kind: 'identity', confidence: 0.9, importance: 0.6, evidenceMessageIds: ['t1'],
  }, { groupId, source: 'Memory_Tool', evidenceMap, maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  assert.equal(fakeOwner.ok, false, '伪造 subjectId 必须被证据归属校验拒绝')

  // 群级事实：无管理员角色（role=member 单条证据）→ 拒绝
  const groupCand = {
    scope: 'group', factKey: 'group.rule.weekly_meeting', factValue: 'monday_20_00',
    text: '群每周一晚八点开会', kind: 'group_rule', confidence: 0.9, importance: 0.6,
    evidenceMessageIds: ['t2'],
  }
  const evidenceMap2 = mkEvidenceMap(groupId, [{ messageId: 't2', senderId: '10001', senderName: 'A', role: 'member', text: '我们每周一开会', time: 1780000000 }])
  const groupRes = await store.applyFact(groupCand, { groupId, source: 'Memory_Tool', evidenceMap: evidenceMap2, maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  assert.equal(groupRes.ok, false, '非管理员的群级事实应拒绝')

  // 管理员公告 → 通过
  const evidenceMap3 = mkEvidenceMap(groupId, [{ messageId: 't3', senderId: '10001', senderName: 'A', role: 'owner', text: '以后每周一晚八点开例会', time: 1780000000 }])
  const adminRes = await store.applyFact({ ...groupCand, evidenceMessageIds: ['t3'] }, { groupId, source: 'Memory_Tool', evidenceMap: evidenceMap3, maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  assert.equal(adminRes.ok, true, '管理员公告的群级事实应通过')
})

test('召回排序：相关性优先于重要性', async () => {
  // 用非常驻画像键的高重要性无关记忆，验证"相关度优先"
  const highImportance = { factKey: 'preference.coffee', factValue: 'hand_brew', text: '用户喜欢手冲咖啡', scope: 'user', status: 'active', importance: 0.9, confidence: 0.9 }
  const relevant = { factKey: 'preference.favorite_character', factValue: 'raiden_shogun', text: '用户最喜欢的角色是雷电将军', scope: 'user', status: 'active', importance: 0.5, confidence: 0.9 }
  const ranked = rankMemories([highImportance, relevant], '我最喜欢什么角色', { limit: 8, minImportance: 0 })
  assert.equal(ranked[0], relevant, '相关问题应优先召回相关记忆而非高重要性无关记忆')
  const rel = relevanceScore(relevant, ['喜欢', '角色'])
  assert.ok(rel > 0)
})

test('游标不跳天：连续 runDaily 覆盖连续自然日（P1-1 回归）', async () => {
  await clearStore()
  resetConfig()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const cfgOk = {
    inputTokenLimit: 30000, outputTokenLimit: 4096, minConfidence: 0.7, maxAttempts: 3,
    rawRetentionDays: 30, eventRetentionDays: 90, use: null,
    llm: async () => ({ text: '{"candidates":[]}' }),
  }
  const dc = new DailyConsolidation({ store })
  const yesterday = yesterdayKey()
  const dayBefore = dayKey(dayToTs(yesterday) - 86400)
  const today = todayKey()

  // 第 1 天：只有前天有原文 → 处理前天
  await store.saveRawMessage({ groupId: gid, messageId: 'r0', senderId: '10001', senderName: 'A', role: '', text: '我叫玉玉', time: dayToTs(dayBefore) + 3600, isCommand: false, contentHash: 'h0' }, 30)
  await dc.runDaily(cfgOk)
  assert.equal((await store.getTask(gid, dayBefore))?.status, 'completed', '前天应被处理')

  // 第 2 天：昨天有原文 → 昨天必须被处理（游标不能跳过）
  await store.saveRawMessage({ groupId: gid, messageId: 'r1', senderId: '10001', senderName: 'A', role: '', text: '我在腾讯上班', time: dayToTs(yesterday) + 3600, isCommand: false, contentHash: 'h1' }, 30)
  await dc.runDaily(cfgOk)
  assert.equal((await store.getTask(gid, yesterday))?.status, 'completed', '昨天应被处理（不得跳天）')
  const tasks = await store.listTasks(gid)
  assert.ok(tasks.some(t => t.day === dayBefore) && tasks.some(t => t.day === yesterday), '两天窗口都应存在')

  // 第 3 天：今天有原文 → 明天 runDaily 时应处理今天（无原文时游标停在昨天，不写 today）
  await store.saveRawMessage({ groupId: gid, messageId: 'r2', senderId: '10001', senderName: 'A', role: '', text: '今天的新消息', time: dayToTs(today) + 3600, isCommand: false, contentHash: 'h2' }, 30)
  const policy = await store.getPolicy(gid)
  assert.ok(policy.lastDailyEnd !== today, '游标不应提前推进到今天')
})

test('profile-scan 是派生记忆：可被撤回、可被替换（P1-4 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const row = [{ messageId: 'p1', senderId: '10001', senderName: 'A', role: '', text: '我在腾讯上班', time: 1780000000 }]

  // 画像工具写入（source=profile-scan）
  const first = await writeFact(store, gid,
    { scope: 'user', factKey: 'profile.occupation', factValue: 'tencent', text: '用户在腾讯工作', kind: 'identity', confidence: 0.9, importance: 0.7 },
    row)
  // 写入时 source 由 writeFact 默认为 group-window，改为 profile-scan 重新写入
  const mem = await store.getMemory(first.res.memoryId)
  await mockRedis.set(`CHATGPT:MEMORY:V2:item:${first.res.memoryId}`, JSON.stringify({ ...mem, source: 'profile-scan' }))

  // 单值替换应生效（不被视为手工确认）
  const conflict = await writeFact(store, gid,
    { scope: 'user', factKey: 'profile.occupation', factValue: 'bytedance', text: '用户跳槽到字节', kind: 'identity', confidence: 0.95, importance: 0.7 },
    [{ messageId: 'p2', senderId: '10001', senderName: 'A', role: '', text: '我跳槽去字节了', time: 1780000100 }])
  const rows2 = await store.listByScope({ scope: 'user', ownerId: '10001', groupId: '', includeArchived: true })
  const active = rows2.filter(m => m.status === 'active' && m.factKey === 'profile.occupation')
  assert.equal(active.length, 1)
  assert.equal(active[0].factValue, 'bytedance', 'profile-scan 旧值应被替换')
  const archived = rows2.find(m => m.factKey === 'profile.occupation' && m.status === 'archived')
  assert.equal(archived?.source, 'superseded')

  // 撤回应生效（Memory_Tool retract 可撤回 profile-scan 事实）
  await clearStore()
  const first2 = await writeFact(store, gid,
    { scope: 'user', factKey: 'identity.nickname', factValue: 'yuyu', text: '用户昵称玉玉', kind: 'identity', confidence: 0.9, importance: 0.6 },
    [{ messageId: 'p3', senderId: '10001', senderName: 'A', role: '', text: '我叫玉玉', time: 1780000000 }])
  const mem2 = await store.getMemory(first2.res.memoryId)
  await mockRedis.set(`CHATGPT:MEMORY:V2:item:${first2.res.memoryId}`, JSON.stringify({ ...mem2, source: 'profile-scan' }))
  const retract = await writeFact(store, gid,
    { operation: 'retract', scope: 'user', factKey: 'identity.nickname', factValue: 'yuyu', text: '用户不再叫玉玉', kind: 'identity', confidence: 0.9, importance: 0.6 },
    [{ messageId: 'p4', senderId: '10001', senderName: 'A', role: '', text: '别叫我玉玉了', time: 1780000100 }])
  assert.equal(retract.res.action, 'retracted', 'profile-scan 记忆应可被撤回')
})

test('过期 active 记忆超过宽限期被物理删除（P1-5 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const past = new Date(Date.now() - 200 * 86400 * 1000).toISOString().slice(0, 10)
  const r = await writeFact(store, gid,
    { scope: 'user', factKey: 'plan.meeting', factValue: 'done', text: '用户昨天开会', kind: 'plan', confidence: 0.9, importance: 0.5, validTo: past },
    [{ messageId: 'e1', senderId: '10001', senderName: 'A', role: '', text: '昨天开会了', time: 1780000000 }])
  assert.equal(r.res.action, 'added')
  // 记忆仍是 active（validTo 过去），但超过宽限期后应被物理删除
  const removed = await store.deleteExpired(30)
  assert.ok(removed >= 1, `应删除过期 active 记忆，实际 ${removed}`)
  assert.equal(await store.getMemory(r.res.memoryId), null, '过期计划应被物理删除')
})

test('校验加固：confidence>1 拒绝、非法 validTo 拒绝、plan 缺 validTo 默认事件保留期（P2-3 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const row = [{ messageId: 'v1', senderId: '10001', senderName: 'A', role: '', text: '消息', time: 1780000000 }]
  const evidenceMap = mkEvidenceMap(gid, row)
  const base = { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.age', factValue: '25', text: '用户25岁', kind: 'identity', evidenceMessageIds: ['v1'] }

  // confidence > 1 拒绝
  const badConf = await store.applyFact({ ...base, confidence: 1.5, importance: 0.5 }, { groupId: gid, source: 'Memory_Tool', evidenceMap, maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  assert.equal(badConf.ok, false, 'confidence>1 应拒绝')

  // 非法 validTo 拒绝（而非当永久）
  const badValidTo = await store.applyFact({ ...base, factKey: 'preference.x', factValue: 'y', confidence: 0.9, importance: 0.5, validTo: 'not-a-date' }, { groupId: gid, source: 'Memory_Tool', evidenceMap, maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  assert.equal(badValidTo.ok, false, '非法 validTo 应拒绝')

  // plan 缺 validTo → 默认 eventRetentionDays（90 天），不永久保存
  const plan = await store.applyFact({ ...base, factKey: 'plan.trip', factValue: 'summer', text: '用户计划夏天旅行', kind: 'plan', confidence: 0.85, importance: 0.6 }, { groupId: gid, source: 'Memory_Tool', evidenceMap, maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  assert.equal(plan.ok, true)
  const planMem = await store.getMemory(plan.memoryId)
  assert.ok(planMem.validTo > 0, 'plan 缺 validTo 应有默认有效期')
  assert.ok(planMem.validTo <= Math.floor(Date.now() / 1000) + 100 * 86400, 'plan 有效期应在事件保留期范围内')
})

test('模型自标 sensitivity 已移除：标 sensitive 不再拒写，字段不落库', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const row = [{ messageId: 's1', senderId: '10001', senderName: 'A', role: '', text: '消息', time: 1780000000 }]
  const evidenceMap = mkEvidenceMap(gid, row)
  const base = { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.note', factValue: 'plain', text: '用户的备注是普通内容', kind: 'identity', confidence: 0.9, importance: 0.5, evidenceMessageIds: ['s1'] }
  const ctx = { groupId: gid, source: 'Memory_Tool', evidenceMap, maxMemoriesPerUser: 100, eventRetentionDays: 90 }

  // 模型参数里的 sensitivity 不再有任何放行/拒绝效果（该功能已移除，恒为 normal）
  const marked = await store.applyFact({ ...base, sensitivity: 'sensitive' }, ctx)
  assert.equal(marked.ok, true, '模型自标 sensitive 不再拒写')
  assert.equal((await store.getMemory(marked.memoryId)).sensitivity, undefined, 'sensitivity 不落库')

  const normal = await store.applyFact({ ...base, factKey: 'identity.note2', sensitivity: 'normal' }, ctx)
  assert.equal(normal.ok, true, 'normal 正常写入')
})

test('factKey 别名归一化：完整别名映射到同一槽位，且不做后缀替换', async () => {
  // 1. 表驱动：别名命中（含大小写/非法字符处理后命中）
  assert.equal(canonicalFactKey('profile.job'), 'profile.occupation')
  assert.equal(canonicalFactKey('Profile.Job'), 'profile.occupation')
  assert.equal(canonicalFactKey('identity.sex'), 'identity.gender')
  assert.equal(canonicalFactKey('identity.birthday'), 'identity.birth_date')
  assert.equal(canonicalFactKey('profile.occupation'), 'profile.occupation', 'canonical 键不得被改写')

  // 2. 只做完整键映射，绝不做通用后缀替换
  for (const key of ['plan.job', 'preference.job', 'group.event.job', 'profile.job.title', 'profile.jobs']) {
    assert.equal(canonicalFactKey(key), key, `${key} 不应被别名表改写`)
  }

  // 3. 端到端：别名写入与 canonical 写入必须落同一槽位（单值替换，不并存）
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const ctxOf = (messageId, text) => ({
    groupId: gid,
    source: 'Memory_Tool',
    evidenceMap: mkEvidenceMap(gid, [{ messageId, senderId: '10001', senderName: 'A', role: '', text, time: 1780000000 }]),
    maxMemoriesPerUser: 100,
    eventRetentionDays: 90,
  })
  const base = { scope: 'user', subjectId: '10001', speakerId: '10001', kind: 'identity', confidence: 0.9, importance: 0.7 }

  const viaAlias = await store.applyFact({ ...base, factKey: 'profile.job', factValue: 'programmer', text: '用户是程序员', evidenceMessageIds: ['k1'] }, ctxOf('k1', '我是程序员'))
  assert.equal(viaAlias.ok, true)
  assert.equal((await store.getMemory(viaAlias.memoryId)).factKey, 'profile.occupation', '别名写入应落到 canonical 槽位')

  const viaCanonical = await store.applyFact({ ...base, factKey: 'profile.occupation', factValue: 'teacher', text: '用户是老师', evidenceMessageIds: ['k2'] }, ctxOf('k2', '我改行当老师了'))
  assert.equal(viaCanonical.ok, true)

  const rows = await store.listByScope({ scope: 'user', ownerId: '10001', groupId: '', includeArchived: true })
  assert.equal(rows.filter(m => m.factKey === 'profile.occupation' && m.status === 'active').length, 1, '两处写入必须落同一单值槽位，不得并存')
  assert.equal(rows.some(m => m.factKey === 'profile.job'), false, '不得留下 profile.job 槽位')

  // 4. 别名撤回应命中同一个 canonical 槽位
  const retract = await store.applyFact({ ...base, operation: 'retract', factKey: 'profile.job', factValue: 'teacher', text: '用户不再当老师', evidenceMessageIds: ['k3'] }, ctxOf('k3', '我不当老师了'))
  assert.equal(retract.action, 'retracted', '别名撤回应命中 canonical 槽位')
})

test('user_group 也受记忆上限约束（P2-4 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  // 上限设为 3
  for (let i = 1; i <= 4; i++) {
    const r = await writeFact(store, gid,
      { scope: 'user_group', factKey: `preference.item${i}`, factValue: `v${i}`, text: `用户在本群偏好${i}`, kind: 'preference', confidence: 0.9, importance: 0.1 + i * 0.1 },
      [{ messageId: `ug${i}`, senderId: '10001', senderName: 'A', role: '', text: `本群偏好${i}`, time: 1780000000 + i }])
  }
  // 默认上限 100，直接调 applyFact 验证上限逻辑（用 ctx.maxMemoriesPerUser=3）
  await clearStore()
  const evidenceMap = mkEvidenceMap(gid, [{ messageId: 'u1', senderId: '10001', senderName: 'A', role: '', text: 'x', time: 1780000000 }])
  for (let i = 1; i <= 4; i++) {
    await store.applyFact(
      { scope: 'user_group', subjectId: '10001', speakerId: '10001', factKey: `preference.i${i}`, factValue: `v${i}`, text: `偏好${i}`, kind: 'preference', confidence: 0.9, importance: 0.2, evidenceMessageIds: ['u1'] },
      { groupId: gid, source: 'Memory_Tool', evidenceMap, maxMemoriesPerUser: 3, eventRetentionDays: 90 },
    )
  }
  const ug = await store.listByScope({ scope: 'user_group', ownerId: '10001', groupId: gid })
  assert.equal(ug.length, 3, `user_group 应限制在 3 条，实际 ${ug.length}`)
})

test('@目标成员召回：主人完整召回，非主人不泄露对方跨群 user 记忆', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const mk = (sender, factKey, factValue, text, mid) => ({
    scope: 'user', subjectId: sender, speakerId: sender, factKey, factValue, text,
    kind: 'identity', confidence: 0.9, importance: 0.8, evidenceMessageIds: [mid],
  })
  const evd1 = mkEvidenceMap(gid, [{ messageId: 'a1', senderId: '10001', role: '', time: 1780000000 }])
  const evd2 = mkEvidenceMap(gid, [{ messageId: 'b1', senderId: '10002', role: '', time: 1780000000 }])
  await store.applyCandidates([mk('10001', 'identity.nickname', 'yuyu', '用户昵称玉玉', 'a1')], { groupId: gid, day: 'x', source: 'group-window', evidenceMap: evd1, maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  await store.applyCandidates([mk('10002', 'identity.nickname', 'xiaoyu', '用户昵称小鱼', 'b1')], { groupId: gid, day: 'x', source: 'group-window', evidenceMap: evd2, maxMemoriesPerUser: 100, eventRetentionDays: 90 })

  // 主人 @10002 问昵称 → 完整召回（含跨群 user）
  const eMaster = { user_id: '10001', group_id: gid, isMaster: true, message: [{ type: 'at', qq: '10002' }] }
  const promptMaster = await buildMemoryPrompt(eMaster, '他叫什么名字', { store, config: { memoryContextLimit: 8, memoryMinImportance: 0.4 } })
  assert.match(promptMaster, /小鱼/, '主人应召回被@成员的记忆')
  assert.ok(!promptMaster.includes('玉玉'), '不应注入提问者自己的昵称')

  // 非主人 @10002 → 不泄露对方跨群 user 记忆（昵称是 user 作用域）
  const eMember = { user_id: '10001', group_id: gid, isMaster: false, message: [{ type: 'at', qq: '10002' }] }
  const promptMember = await buildMemoryPrompt(eMember, '他叫什么名字', { store, config: { memoryContextLimit: 8, memoryMinImportance: 0.4 } })
  assert.ok(!promptMember.includes('小鱼'), '非主人 @他人不应召回对方跨群 user 记忆')

  // @机器人（self_id）→ 不切换主体，仍召回提问者本人
  const eBot = { user_id: '10001', group_id: gid, self_id: '999', message: [{ type: 'at', qq: '999' }] }
  const promptBot = await buildMemoryPrompt(eBot, '我叫什么名字', { store, config: { memoryContextLimit: 8, memoryMinImportance: 0.4 } })
  assert.match(promptBot, /玉玉/, '@机器人不应切换主体，应召回提问者本人')
})

test('Memory_Tool 事实可被单值替换与撤回（P1-1 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const row1 = [{ messageId: 'a1', senderId: '10001', senderName: 'A', role: '', text: '我在腾讯上班', time: 1780000000 }]
  const evd1 = mkEvidenceMap(gid, row1)

  // Memory_Tool 写入职业
  const first = await store.applyFact(
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'profile.occupation', factValue: 'tencent', text: '用户在腾讯工作', kind: 'identity', confidence: 0.9, importance: 0.7, evidenceMessageIds: ['a1'] },
    { groupId: gid, source: 'Memory_Tool', evidenceMap: evd1, maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  assert.equal(first.ok, true)

  // 换工作 → 单值替换必须生效（不被手工保护锁死）
  const evd2 = mkEvidenceMap(gid, [{ messageId: 'a2', senderId: '10001', senderName: 'A', role: '', text: '我跳槽去字节了', time: 1780000100 }])
  const second = await store.applyFact(
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'profile.occupation', factValue: 'bytedance', text: '用户跳槽到字节', kind: 'identity', confidence: 0.95, importance: 0.7, evidenceMessageIds: ['a2'] },
    { groupId: gid, source: 'Memory_Tool', evidenceMap: evd2, maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  assert.equal(second.ok, true, 'Memory_Tool 单值替换应生效')
  const rows = await store.listByScope({ scope: 'user', ownerId: '10001', groupId: '', includeArchived: true })
  const active = rows.filter(m => m.status === 'active' && m.factKey === 'profile.occupation')
  assert.equal(active.length, 1)
  assert.equal(active[0].factValue, 'bytedance')
  const archived = rows.find(m => m.factKey === 'profile.occupation' && m.status === 'archived')
  assert.equal(archived?.source, 'superseded')

  // 明确否定 → 撤回必须生效
  const evd3 = mkEvidenceMap(gid, [{ messageId: 'a3', senderId: '10001', senderName: 'A', role: '', text: '我不在字节了', time: 1780000200 }])
  const retract = await store.applyFact(
    { operation: 'retract', scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'profile.occupation', factValue: 'bytedance', text: '用户不再在字节工作', kind: 'identity', confidence: 0.9, importance: 0.7, evidenceMessageIds: ['a3'] },
    { groupId: gid, source: 'Memory_Tool', evidenceMap: evd3, maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  assert.equal(retract.action, 'retracted', 'Memory_Tool 事实应可被撤回')
})

test('running 窗口期间到达的新消息最终被重提炼（P1-3 竞态回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '100'
  const dc = new DailyConsolidation({ store })
  const day = yesterdayKey()
  const ts = dayToTs(day) + 3600

  // 预置消息并完成第一次提炼
  await store.saveRawMessage({ groupId: gid, messageId: 'm1', senderId: '10001', senderName: 'A', role: '', text: '我叫玉玉', time: ts, isCommand: false, contentHash: 'h1' }, 30)
  const cfgOk = {
    inputTokenLimit: 30000, outputTokenLimit: 4096, minConfidence: 0.7, maxAttempts: 3,
    rawRetentionDays: 30, eventRetentionDays: 90, use: null,
    llm: async () => ({ text: '{"candidates":[]}' }),
  }
  await dc.runDaily(cfgOk)
  assert.equal((await store.getTask(gid, day)).status, 'completed')

  // 模拟"running 期间新消息到达"：直接给任务置 running 再写消息（等价模型生成期间）
  await store.setTask(gid, day, { status: 'running', attemptCount: 1, nextAttemptAt: '', updatedAt: Date.now() })
  await store.saveRawMessage({ groupId: gid, messageId: 'm2', senderId: '10001', senderName: 'A', role: '', text: '我在腾讯上班', time: ts + 60, isCommand: false, contentHash: 'h2' }, 30)
  const task = await store.getTask(gid, day)
  assert.equal(String(task.needsReextract), '1', 'running 期间到达的消息应标脏')

  // 任务"完成"（不清脏）→ 下一轮 runDaily 的 requeueDirtyTasks 重提炼
  await store.setTask(gid, day, { status: 'completed', contentHash: 'x', resultJson: '{}', updatedAt: Date.now() })
  const report = await dc.runDaily(cfgOk)
  assert.ok(report.groups[0].requeuedDirty >= 1, '脏标记应触发重提炼')
  const task2 = await store.getTask(gid, day)
  assert.equal(task2.status, 'completed')
  assert.notEqual(String(task2.needsReextract), '1', '重提炼后标记应清除')
})

test('hasUserMemories 覆盖其他群 user_group（P1-4 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  // 只在群 200 有 user_group 记忆
  const evd = { b1: { groupId: '200', senderId: '10001', senderName: '', role: '', time: 1780000000 } }
  await store.applyFact(
    { scope: 'user_group', subjectId: '10001', speakerId: '10001', factKey: 'group_role.release', factValue: 'weekly', text: '用户在群200负责发布', kind: 'identity', confidence: 0.9, importance: 0.6, evidenceMessageIds: ['b1'] },
    { groupId: '200', source: 'group-window:200:x', evidenceMap: evd, maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  // listRecallCandidates（当前群 100）查不到
  assert.equal((await store.listRecallCandidates('10001', '100')).length, 0)
  // hasUserMemories 应能发现
  assert.equal(await store.hasUserMemories('10001'), true, '其他群的 user_group 也应被预检发现')
  assert.equal(await store.hasUserMemories('99999'), false, '无记忆用户返回 false')
})

test('group 作用域写入不误删同号用户旧 Hash（P1-5 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  // 假设某用户 QQ 恰好等于群号 100
  await mockRedis.hSet('CHATGPT:MEMORY:USER:100', 'old', 'v')
  const evd = { g1: { groupId: '100', senderId: '10001', senderName: '', role: 'owner', time: 1780000000 } }
  await store.applyFact(
    { scope: 'group', factKey: 'group.rule.meeting', factValue: 'monday', text: '群每周一开会', kind: 'group_rule', confidence: 0.9, importance: 0.6, evidenceMessageIds: ['g1'] },
    { groupId: '100', source: 'group-window:100:x', evidenceMap: evd, maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  assert.equal(await mockRedis.exists('CHATGPT:MEMORY:USER:100'), 1, 'group 写入不应删除同号用户的旧 Hash')

  // 个人作用域写入仍应删除旧 Hash
  const evd2 = { u1: { groupId: '100', senderId: '10001', senderName: '', role: '', time: 1780000000 } }
  await store.applyFact(
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.nickname', factValue: 'yuyu', text: '用户昵称玉玉', kind: 'identity', confidence: 0.9, importance: 0.6, evidenceMessageIds: ['u1'] },
    { groupId: '100', source: 'Memory_Tool', evidenceMap: evd2, maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  assert.equal(await mockRedis.exists('CHATGPT:MEMORY:USER:10001'), 0, '个人写入应删除本人旧 Hash')
})

test('MemoryTool 应用 minConfidence 拒绝低置信度候选（P2-2 回归）', async () => {
  await clearStore()
  const { MemoryTool } = await import('../utils/tools/MemoryTool.js')
  const tool = new MemoryTool()
  const e = { message_id: 'mt1', user_id: '10001', group_id: '100', time: 1780000000, isGroup: true, isMaster: false, sender: { role: 'member' } }
  const ret = await tool.func({
    candidates: [{
      scope: 'user', factKey: 'identity.age', factValue: '25', text: '用户25岁',
      kind: 'identity', confidence: 0.1, importance: 0.6,
    }],
  }, e)
  assert.match(ret, /置信度/, `低置信度应被拒绝: ${ret}`)
  assert.match(ret, /0\.7/, '拒绝信息应包含阈值')
})

test('stripCQCode 清除 OneBot CQ 码（P2-4 回归）', async () => {
  const { stripCQCode } = await import('../utils/memory/capture.js')
  assert.equal(stripCQCode('看这个 [CQ:image,file=x.jpg] 和 [CQ:face,id=1] 图片'), '看这个 和 图片')
  assert.equal(stripCQCode('纯文本 [CQ:at,qq=1]'), '纯文本')
  assert.equal(stripCQCode('[CQ:record,file=a]'), '')
})

test('富媒体消息以占位符提取（媒体内容不入库只留痕迹）', async () => {
  const { extractTextFromEvent, extractTextFromHistoryMsg, mediaPlaceholder } = await import('../utils/memory/capture.js')
  // 段数组：图文混合 → 文本 + 占位符
  assert.equal(
    extractTextFromEvent({ message: [{ type: 'text', text: '看看这个' }, { type: 'image', file: 'x.jpg' }, { type: 'text', text: '可爱' }] }),
    '看看这个[图片]可爱'
  )
  // 段数组：纯图片消息 → 占位符（不再整条丢弃）
  assert.equal(extractTextFromEvent({ message: [{ type: 'image', file: 'x.jpg' }] }), '[图片]')
  // 纯文本消息不受影响
  assert.equal(extractTextFromEvent({ message: [{ type: 'text', text: 'hi' }] }), 'hi')
  // 段数组：常见多媒体各自占位
  assert.equal(extractTextFromEvent({ message: [{ type: 'face', id: 1 }] }), '[表情]')
  assert.equal(extractTextFromEvent({ message: [{ type: 'record', file: 'a.silk' }] }), '[语音]')
  assert.equal(extractTextFromEvent({ message: [{ type: 'video', file: 'v.mp4' }, { type: 'text', text: '视频' }] }), '[视频]视频')
  assert.equal(extractTextFromEvent({ message: [{ type: 'file', file: 'z.zip' }] }), '[文件]')
  assert.equal(extractTextFromEvent({ message: [{ type: 'flash', file: 'f.jpg' }] }), '[图片]')
  // at/reply 等结构段不算富媒体，不产生占位符（纯 at 消息仍视为无文本）
  assert.equal(extractTextFromEvent({ message: [{ type: 'at', qq: '123' }, { type: 'text', text: '你好' }] }), '你好')
  assert.equal(extractTextFromEvent({ message: [{ type: 'reply', id: '1' }] }), '')
  // mediaPlaceholder 归一化边界
  assert.equal(mediaPlaceholder('Image'), '[图片]')
  assert.equal(mediaPlaceholder('shortvideo'), '[视频]')
  assert.equal(mediaPlaceholder('marketface'), '[表情]')
  assert.equal(mediaPlaceholder('voice'), '[语音]')
  assert.equal(mediaPlaceholder('mface'), '[表情]')
  assert.equal(mediaPlaceholder('emoji'), '[表情]')
  assert.equal(mediaPlaceholder('json'), '')
  assert.equal(mediaPlaceholder('at'), '')
  assert.equal(mediaPlaceholder(''), '')
  // 历史 message 字符串：富媒体 CQ 码转占位符，at 等结构性 CQ 码删除
  assert.equal(extractTextFromHistoryMsg({ message: '看 [CQ:image,file=x.jpg] 和 [CQ:face,id=1] 图' }), '看 [图片] 和 [表情] 图')
  assert.equal(extractTextFromHistoryMsg({ message: '哈哈 [CQ:record,file=a.silk] [CQ:at,qq=1]' }), '哈哈 [语音]')
  // 历史 raw_message 兜底：纯媒体消息
  assert.equal(extractTextFromHistoryMsg({ raw_message: '[CQ:image,file=a.jpg]' }), '[图片]')
  // 历史段数组：媒体占位
  assert.equal(
    extractTextFromHistoryMsg({ message: [{ type: 'text', text: '菜单' }, { type: 'image', data: { file: 'a.png' } }] }),
    '菜单[图片]'
  )
})

/* ================= 第十轮加固回归（审查 P1/P2） ================= */

test('事件有效期以「最新证据时间」为基准：补提炼旧消息不会凭空续期（P1-4 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '300'
  const nowS = Math.floor(Date.now() / 1000)
  const oldTs = nowS - 200 * 86400
  const ctxOf = rows => ({ groupId: gid, source: 'Memory_Tool', evidenceMap: mkEvidenceMap(gid, rows), maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  const cand = { factKey: 'profile.employment_status', factValue: 'unemployed', text: '用户当前处于失业状态', kind: 'episode', confidence: 0.9, importance: 0.7 }

  const oldRes = await store.applyFact(
    { ...cand, scope: 'user', subjectId: '10001', speakerId: '10001', evidenceMessageIds: ['o1'] },
    ctxOf([{ messageId: 'o1', senderId: '10001', senderName: 'A', role: '', text: '我现在失业了', time: oldTs }]),
  )
  assert.equal(oldRes.ok, true)
  const oldMem = await store.getMemory(oldRes.memoryId)
  assert.equal(oldMem.validTo, oldTs + 90 * 86400, '有效期应以证据时间为基准，而不是入库时间')
  assert.ok(oldMem.validTo < nowS, '200 天前的证据 + 90 天保留期 → 应为已过期')
  const recalled = await store.listRecallCandidates('10001', gid, {})
  assert.equal(recalled.some(m => m.id === oldRes.memoryId), false, '已过期事件不应参与召回')

  // 对照：换个用户用最新证据写同一事实 → 未过期
  const recentTs = nowS - 3600
  const freshRes = await store.applyFact(
    { ...cand, scope: 'user', subjectId: '10002', speakerId: '10002', evidenceMessageIds: ['o2'] },
    ctxOf([{ messageId: 'o2', senderId: '10002', senderName: 'B', role: '', text: '我现在失业了', time: recentTs }]),
  )
  assert.equal((await store.getMemory(freshRes.memoryId)).validTo, recentTs + 90 * 86400)
})

test('同值强化按最新证据续期并刷新 text，显式 validTo 优先（P2-5 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '301'
  const nowS = Math.floor(Date.now() / 1000)
  const oldTs = nowS - 200 * 86400
  const ctxOf = rows => ({ groupId: gid, source: 'Memory_Tool', evidenceMap: mkEvidenceMap(gid, rows), maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  const base = { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'profile.employment_status', factValue: 'unemployed', kind: 'episode', confidence: 0.9, importance: 0.7 }

  const first = await store.applyFact(
    { ...base, text: '用户当前处于失业状态', evidenceMessageIds: ['q1'] },
    ctxOf([{ messageId: 'q1', senderId: '10001', senderName: 'A', role: '', text: '我现在失业了', time: oldTs }]),
  )
  assert.ok((await store.getMemory(first.memoryId)).validTo < nowS, '首次写入即已过期')

  const recentTs = nowS - 1800
  const second = await store.applyFact(
    { ...base, text: '用户仍在寻找工作', evidenceMessageIds: ['q2'] },
    ctxOf([{ messageId: 'q2', senderId: '10001', senderName: 'A', role: '', text: '我还在找工作中', time: recentTs }]),
  )
  assert.equal(second.action, 'reinforced')
  const mem = await store.getMemory(first.memoryId)
  assert.equal(mem.text, '用户仍在寻找工作', '强化应刷新 text')
  assert.equal(mem.validTo, recentTs + 90 * 86400, '强化应按最新证据时间续期')
  assert.ok(mem.validTo > nowS, '续期后不再是过期状态')

  const third = await store.applyFact(
    { ...base, text: '用户仍在寻找工作', validTo: '2031-01-01', evidenceMessageIds: ['q3'] },
    ctxOf([{ messageId: 'q3', senderId: '10001', senderName: 'A', role: '', text: '我下个月入职', time: nowS - 60 }]),
  )
  assert.equal(third.action, 'reinforced')
  assert.equal((await store.getMemory(first.memoryId)).validTo, Math.floor(Date.parse('2031-01-01') / 1000), '显式 validTo 应直接采用')
})

test('单值槽位手工记忆保护：manual+derived 混合时不得只归档 derived 后并存（P2-7 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '302'
  const now = Date.now()
  const synthetic = (id, factValue, source) => ({
    id, scope: 'user', ownerId: '10001', groupId: '', kind: 'identity', factKey: 'identity.age',
    factValue, text: '用户年龄', tags: [], importance: 0.8, confidence: 0.9, status: 'active', source,
    validTo: 0, createdAt: now, updatedAt: now,
  })
  // 生产路径目前无法产生 source: 'manual'（全仓无写入点），这里直接合成"混合槽位"锁定防御逻辑
  await store._insertMemory(synthetic('m_manual', '25', 'manual'), [], '')
  await store._insertMemory(synthetic('m_derived', '26', 'Memory_Tool'), [], '')

  const res = await store.applyFact(
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.age', factValue: '27', text: '用户27岁', kind: 'identity', confidence: 0.9, importance: 0.7, evidenceMessageIds: ['h1'] },
    { groupId: gid, source: 'Memory_Tool', evidenceMap: mkEvidenceMap(gid, [{ messageId: 'h1', senderId: '10001', senderName: 'A', role: '', text: '我今年27岁', time: Math.floor(now / 1000) }]), maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  assert.equal(res.ok, false, '手工记忆占据单值槽位时必须拒绝')
  assert.equal(res.action, 'ignored')
  const rows = await store.listByScope({ scope: 'user', ownerId: '10001', groupId: '', includeArchived: true })
  assert.equal(rows.filter(m => m.status === 'active').length, 2, '不得只归档 derived 后留下 manual+derived 并存')
  assert.equal(rows.some(m => m.factValue === '27'), false, '冲突新值不得写入')
})

test('严格校验：未知 operation / 非法 kind 一律拒绝，不再静默降级（P1-3 回归）', () => {
  const base = { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.age', factValue: '25', text: '用户25岁', confidence: 0.9, importance: 0.5, evidenceMessageIds: ['x'] }

  assert.equal(validateCandidateShape({ ...base, kind: 'identity' }).ok, true, '缺省 operation 视为 add')
  assert.equal(validateCandidateShape({ ...base, kind: 'identity', operation: 'add' }).ok, true)
  const badOp = validateCandidateShape({ ...base, kind: 'identity', operation: 'remove' })
  assert.equal(badOp.ok, false, '未知 operation 不得被当成 add')
  assert.match(String(badOp.reason), /非法 operation/)
  assert.equal(validateCandidateShape({ ...base, kind: 'identity', operation: 'delete' }).ok, false)

  const badKind = validateCandidateShape({ ...base, kind: 'episod' })
  assert.equal(badKind.ok, false, '非法 kind 不得降级为 preference')
  assert.match(String(badKind.reason), /非法 kind/)
  assert.equal(validateCandidateShape({ ...base, kind: undefined }).ok, false, 'add 缺 kind 应拒绝')
  assert.equal(validateCandidateShape({ ...base, kind: 'episode' }).ok, true)

  assert.equal(
    validateCandidateShape({ scope: 'user', subjectId: '10001', factKey: 'identity.age', operation: 'retract', evidenceMessageIds: ['x'] }).ok,
    true,
    'retract 不要求 kind',
  )
})

test('私聊不得写 user_group：避免空 groupId 索引产生的孤儿数据（P2-8 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const res = await store.applyFact(
    { scope: 'user_group', subjectId: '10001', speakerId: '10001', factKey: 'group_role.release', factValue: 'weekly', text: '用户负责每周发版', kind: 'identity', confidence: 0.9, importance: 0.6, evidenceMessageIds: ['p1'] },
    { groupId: '', source: 'Memory_Tool', evidenceMap: mkEvidenceMap('', [{ messageId: 'p1', senderId: '10001', senderName: 'A', role: '', text: '我在这个群负责发版', time: 1780000000 }]), maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  assert.equal(res.ok, false, '无 groupId 时不得写 user_group')
  assert.match(String(res.reason), /必须在群聊中使用/)
})

test('配额统计与淘汰排除已过期记忆（次级生命周期问题回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '303'
  const nowS = Math.floor(Date.now() / 1000)
  const ctxOf = rows => ({ groupId: gid, source: 'Memory_Tool', evidenceMap: mkEvidenceMap(gid, rows), maxMemoriesPerUser: 100, eventRetentionDays: 90 })
  const row = ts => [{ messageId: 'z' + ts, senderId: '10001', senderName: 'A', role: '', text: '安排', time: ts }]

  const expiredRes = await store.applyFact(
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'plan.trip', factValue: 'tokyo', text: '用户计划去东京', kind: 'plan', confidence: 0.9, importance: 0.95, validTo: '2020-01-01', evidenceMessageIds: ['z' + (nowS - 10)] },
    ctxOf(row(nowS - 10)),
  )
  assert.equal(expiredRes.ok, true)
  assert.equal(await store._countActiveByScope('user', '10001', ''), 0, '已过期记忆不占 maxMemoriesPerUser 配额')

  const aliveRes = await store.applyFact(
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'preference.color', factValue: 'blue', text: '用户喜欢蓝色', kind: 'preference', confidence: 0.9, importance: 0.1, evidenceMessageIds: ['z' + (nowS - 5)] },
    ctxOf(row(nowS - 5)),
  )
  assert.equal(aliveRes.ok, true)
  assert.equal(await store._countActiveByScope('user', '10001', ''), 1)

  await store._evictLowest('user', '10001', '')
  assert.ok(await store.getMemory(expiredRes.memoryId), '已过期记忆不参与淘汰竞争（交给清理任务）')
  assert.equal(await store.getMemory(aliveRes.memoryId), null, '应淘汰未过期里分最低的记忆')
})

test('提炼分片：被拒项不进断点且脱敏、越界证据被拒、坏 schema 不算空结果（P1-1/6/10 回归）', async () => {
  await clearStore()
  const gid = '304'
  const rows = [
    { messageId: 'c1', senderId: '10001', senderName: 'A', role: '', text: '我的备注是 PLAINTEXT_MARKER_123456', time: 1780000000 },
    { messageId: 'c2', senderId: '10001', senderName: 'A', role: '', text: '我今年25岁', time: 1780000100 },
  ]
  const evidenceMap = mkEvidenceMap(gid, rows)
  const jsonLLM = obj => async () => ({ text: JSON.stringify(obj) })
  const run = (llm, chunkRows) => runExtraction({
    rows: chunkRows,
    ctx: { groupId: gid, day: 'd', windowLabel: 'x' },
    evidenceMap,
    cfg: {},
    llm,
  })

  // 1) 被拒项必须脱敏（断点会被持久化到 task hash）：用低于阈值的置信度触发拒绝，text/factValue 放可识别串
  const lowConf = await run(jsonLLM({ candidates: [
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.note', factValue: 'PLAINTEXT_MARKER_123456', text: '用户的备注是 PLAINTEXT_MARKER_123456', kind: 'identity', confidence: 0.1, importance: 0.9, evidenceMessageIds: ['c1'] },
  ] }), [{ messageId: 'c1', senderId: '10001', senderName: 'A', role: '', text: '我的备注是 PLAINTEXT_MARKER_123456' }])
  assert.equal(lowConf.candidates.length, 0, '低于置信度阈值不得进入断点')
  assert.equal(lowConf.rejected.length, 1)
  assert.equal(lowConf.rejected[0].text, undefined, '拒绝项不得保留 text')
  assert.equal(lowConf.rejected[0].factValue, undefined, '拒绝项不得保留 factValue')
  assert.equal(lowConf.rejected[0].factKey, 'identity.note', '保留可诊断的 factKey')
  assert.ok(!JSON.stringify(lowConf.rejected).includes('PLAINTEXT_MARKER_123456'), '断点数据不得出现原文')

  // 2) 越界证据：引用同窗口其他分片（本片看不到）的消息 → 拒绝
  const cross = await run(jsonLLM({ candidates: [
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.age', factValue: '25', text: '用户25岁', kind: 'identity', confidence: 0.9, importance: 0.6, evidenceMessageIds: ['c2'] },
  ] }), [{ messageId: 'c1', senderId: '10001', senderName: 'A', role: '', text: '嗯嗯' }])
  assert.equal(cross.candidates.length, 0, '引用本片之外的消息必须拒绝')
  assert.match(String(cross.rejected[0]?.reason), /证据/)

  // 3) 坏 schema 不能被当成"确实没有记忆"
  assert.equal(parseCandidates(JSON.stringify({ candidate: [] })).ok, false, '{"candidate":[]} 应判失败')
  assert.equal(parseCandidates(JSON.stringify({ candidates: {} })).ok, false, '{"candidates":{}} 应判失败')
  assert.equal(parseCandidates(JSON.stringify({ candidates: [] })).ok, true, '空数组合法')
})

test('Bot 主人等同群主/管理员：isBotMaster 走可信 ctx，三层对齐（P2-9 回归）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const { MemoryTool } = await import('../utils/tools/MemoryTool.js')
  const tool = new MemoryTool()
  const groupCand = [{ scope: 'group', factKey: 'group.rule.weekly_meeting', factValue: 'monday_20_00', text: '群每周一晚八点开会', kind: 'group_rule', confidence: 0.9, importance: 0.6 }]
  const base = { group_id: '400', message_id: 'g1', time: 1780000000, isGroup: true }

  // 1) 普通群员：第一层就拒绝
  const member = { ...base, user_id: '10001', isMaster: false, sender: { role: 'member', card: 'A', nickname: 'A' } }
  const memberRet = await tool.func({ candidates: groupCand }, member)
  assert.match(String(memberRet), /群级事实仅限群主/)

  // 2) 伪造无效：非主人即使把 isBotMaster/masterAuthorized 塞进模型参数也拦下（授权只看 e）
  const forged = await tool.func({ candidates: groupCand.map(c => ({ ...c, isBotMaster: true, masterAuthorized: true })), isBotMaster: true }, member)
  assert.match(String(forged), /群级事实仅限群主/, '模型参数不能伪造授权')

  // 3) Bot 主人（本群 role 只是 member）：三层都应放行
  const master = { ...base, message_id: 'g2', user_id: '10000', isMaster: true, sender: { role: 'member', card: 'M', nickname: 'M' } }
  const masterRet = await tool.func({ candidates: groupCand }, master)
  assert.match(String(masterRet), /记忆已更新/, `主人写群级事实应成功: ${masterRet}`)

  // 4) 群主/管理员（非主人）：走证据 role 授权，保持原行为
  const owner = { ...base, message_id: 'g3', user_id: '10001', isMaster: false, sender: { role: 'owner', card: 'O', nickname: 'O' } }
  const ownerRet = await tool.func({ candidates: [{ ...groupCand[0], factKey: 'group.rule.by_owner' }] }, owner)
  assert.match(String(ownerRet), /记忆已更新/, `群主写群级事实应成功: ${ownerRet}`)

  // 5) 离线链路不传 isBotMaster → 单成员证据仍被拒（规则未放宽）
  const offline = await store.applyFact(
    { scope: 'group', speakerId: '10002', factKey: 'group.rule.solo', factValue: 'x', text: '群规则', kind: 'group_rule', confidence: 0.9, importance: 0.5, evidenceMessageIds: ['w3'] },
    {
      groupId: '400',
      source: 'group-window:400:d',
      evidenceMap: { w3: { groupId: '400', senderId: '10002', senderName: 'B', role: 'member', time: 1780000200 } },
      maxMemoriesPerUser: 100,
      eventRetentionDays: 90,
    },
  )
  assert.equal(offline.ok, false, '离线链路不得因 isBotMaster 改动而放宽')
  assert.match(String(offline.reason), /Bot 主人、群管理公告|两名成员/)
})

test('群事实证据规则：单成员非管理证据必须被拒（与主人身份无关）', async () => {
  await clearStore()
  const store = new MemoryStore(mockRedis)
  const gid = '400'
  const single = await store.applyFact(
    { scope: 'group', speakerId: '10002', factKey: 'group.rule.solo', factValue: 'x', text: '群规则', kind: 'group_rule', confidence: 0.9, importance: 0.5, evidenceMessageIds: ['w3'] },
    {
      groupId: gid,
      source: 'group-window:400:d',
      evidenceMap: { w3: { groupId: gid, senderId: '10002', senderName: 'B', role: 'member', time: 1780000200 } },
      maxMemoriesPerUser: 100,
      eventRetentionDays: 90,
    },
  )
  assert.equal(single.ok, false, '单成员且非管理证据的群事实必须被拒')
  assert.match(String(single.reason), /两名成员|管理公告/)

  // 两名成员共同支持 → 允许
  const two = await store.applyFact(
    { scope: 'group', speakerId: '10002', factKey: 'group.rule.pair', factValue: 'y', text: '群规则', kind: 'group_rule', confidence: 0.9, importance: 0.5, evidenceMessageIds: ['w4', 'w5'] },
    {
      groupId: gid,
      source: 'group-window:400:d',
      evidenceMap: {
        w4: { groupId: gid, senderId: '10002', senderName: 'B', role: 'member', time: 1780000300 },
        w5: { groupId: gid, senderId: '10003', senderName: 'C', role: 'member', time: 1780000400 },
      },
      maxMemoriesPerUser: 100,
      eventRetentionDays: 90,
    },
  )
  assert.equal(two.ok, true, '两名成员支持应允许写入')
})
