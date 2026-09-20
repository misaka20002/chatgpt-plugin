/**
 * 第五轮代码审查针对性测试（不改源码；验证后并入正式测试）
 *
 * 覆盖本轮核对的链路接缝：
 *  1. MemoryTool minConfidence 在配置缺失（NaN）时回退 0.7（本轮发现并修复的 bug）
 *  2. P2-3 画像/提炼 prompt 的时间戳渲染（[YYYY-MM-DD HH:mm]）
 *  3. P2-5 runImmediate 未授权群拒绝 + 并发锁
 *  4. P2-1 补录到已跨过的空白日 → 自动创建 pending 任务并被处理
 *  5. P1-1 Memory_Tool 记忆关闭来源群时按派生记忆整体删除（isDerivedMemory 真实链路）
 */

import assert from 'node:assert/strict'

class MockRedis {
  constructor() { this.data = new Map() }
  async get(k) { const v = this.data.get(k); return typeof v === 'string' ? v : null }
  async set(k, v) { this.data.set(k, String(v)); return 'OK' }
  async del(...keys) { let n = 0; for (const k of keys) if (this.data.delete(k)) n++; return n }
  async expire() { return 1 }
  async exists(k) { return this.data.has(k) ? 1 : 0 }
  async hGetAll(k) { const v = this.data.get(k); return v instanceof Map ? Object.fromEntries([...v.entries()]) : {} }
  async hSet(k, ...a) {
    if (!(this.data.get(k) instanceof Map)) this.data.set(k, new Map())
    const m = this.data.get(k)
    if (a.length === 1 && typeof a[0] === 'object') { for (const [f, v] of Object.entries(a[0])) m.set(String(f), String(v)) }
    else { for (let i = 0; i < a.length; i += 2) m.set(String(a[i]), String(a[i + 1])) }
    return 1
  }
  async hDel(k, ...f) { const m = this.data.get(k); if (!(m instanceof Map)) return 0; let n = 0; for (const x of f) if (m.delete(String(x))) n++; return n }
  async sAdd(k, ...m) { if (!(this.data.get(k) instanceof Set)) this.data.set(k, new Set()); const s = this.data.get(k); let n = 0; for (const x of m) if (!s.has(String(x))) { s.add(String(x)); n++ } return n }
  async sRem(k, ...m) { const s = this.data.get(k); if (!(s instanceof Set)) return 0; let n = 0; for (const x of m) if (s.delete(String(x))) n++; return n }
  async sMembers(k) { const s = this.data.get(k); return s instanceof Set ? [...s] : [] }
  async zAdd(k, m, s) { if (!(this.data.get(k) instanceof Map)) this.data.set(k, new Map()); const z = this.data.get(k); if (m && typeof m === 'object') z.set(String(m.value), Number(m.score)); else z.set(String(m), Number(s)); return 1 }
  async zRange(k, a, b) { const z = this.data.get(k); if (!(z instanceof Map)) return []; return [...z.entries()].sort((x, y) => x[1] - y[1]).map(e => e[0]).slice(a, b === -1 ? undefined : b + 1) }
  async zRangeByScore(k, min, max) { const z = this.data.get(k); if (!(z instanceof Map)) return []; return [...z.entries()].filter(([, s]) => s >= min && s <= max).sort((x, y) => x[1] - y[1]).map(e => e[0]) }
  async zRem(k, ...m) { const z = this.data.get(k); if (!(z instanceof Map)) return 0; let n = 0; for (const x of m) if (z.delete(String(x))) n++; return n }
  *scanIterator({ MATCH = '*', COUNT = 1000 } = {}) { const escaped = MATCH.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'); const re = new RegExp(`^${escaped}$`); for (const key of this.data.keys()) if (re.test(key)) yield key }
}

const mockRedis = new MockRedis()
global.redis = mockRedis
if (!globalThis.logger) globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, trace() {}, log() {} }

const { MemoryStore } = await import('../utils/memory/store.js')
const { MemoryTool } = await import('../utils/tools/MemoryTool.js')
const { DailyConsolidation, dayKey, dayToTs, yesterdayKey, todayKey } = await import('../utils/memory/dailyTask.js')
const { buildExtractionPrompt } = await import('../utils/memory/prompt.js')
const { Config } = await import('../utils/config.js')
const { extractUserProfile } = await import('../utils/memory/profile.js')
const { UserProfileTool } = await import('../utils/tools/UserProfileTool.js')

// 直接改内部配置（绕过 Proxy 写文件）
function setConfig(patch) { Object.assign(Config.getConfig(), patch) }
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

const clearStore = async () => { for (const k of [...mockRedis.data.keys()]) mockRedis.data.delete(k) }

let pass = 0, fail = 0
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`) }
  catch (err) { fail++; console.log(`  ❌ ${name}\n     ${err.message}`) }
}

console.log('【1. MemoryTool minConfidence NaN 回退（本轮修复）】')
await check('memoryGroupCapture 缺失时阈值回退 0.7，低置信度被拒', async () => {
  mockRedis.data.clear()
  setConfig({ memoryGroupCapture: undefined })
  try {
    const tool = new MemoryTool()
    const e = { message_id: 'm1', user_id: '10001', group_id: '100', time: 1780000000, isGroup: true, isMaster: false, sender: { role: 'member' } }
    const ret = await tool.func({ candidates: [{ scope: 'user', factKey: 'identity.age', factValue: '25', text: '用户25岁', kind: 'identity', confidence: 0.1, importance: 0.6 }] }, e)
    assert.match(ret, /置信度/, `配置缺失时也应拒绝低置信度: ${ret}`)
  } finally {
    // 必须放在 finally：断言失败时也要恢复配置，否则后续依赖 memoryGroupCapture 的用例会连环失败
    setConfig({
      memoryGroupCapture: {
        groups: [{ groupId: '100', switchOn: true }], cronTime: '0 0 4 * * ? *', rawRetentionDays: 30,
        eventRetentionDays: 90, inputTokenLimit: 30000, outputTokenLimit: 4096, minConfidence: 0.7,
      },
    })
  }
})

console.log('【2. P2-3 时间戳渲染】')
await check('buildExtractionPrompt 渲染 [YYYY-MM-DD HH:mm]（北京时间）', async () => {
  const prompt = buildExtractionPrompt({
    groupId: '100', windowLabel: '2026-09-01 全天',
    rows: [{ messageId: 'm1', senderId: '10001', senderName: 'A', role: '', text: '我叫玉玉', time: 1780000000 }],
  })
  // 1780000000 秒 → UTC 2026-05-28T20:26:40 → 北京时间 2026-05-29 04:26
  assert.match(prompt, /\[2026-05-29 04:26\]/, `应渲染时间标签: ${prompt.slice(-80)}`)
  // 无 time 时不渲染时间标签（注意消息 ID 方括号 [m2] 属于正常格式，需用时间格式正则判断）
  const prompt2 = buildExtractionPrompt({ groupId: '100', windowLabel: 'x', rows: [{ messageId: 'm2', senderId: '1', text: 'hi' }] })
  assert.ok(!/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/.test(prompt2), '无 time 时不渲染时间标签')
})

console.log('【3. P2-5 runImmediate 授权与并发锁】')
await check('未授权群 → 拒绝且不处理', async () => {
  mockRedis.data.clear()
  const store = new MemoryStore(mockRedis)
  const dc = new DailyConsolidation({ store })
  const res = await dc.runImmediate('999')
  assert.equal(res.ok, false)
  assert.match(res.message, /未开启记忆采集/)
})
await check('processing 锁：runDaily 执行中 runImmediate 被拒', async () => {
  mockRedis.data.clear()
  const store = new MemoryStore(mockRedis)
  const dc = new DailyConsolidation({ store })
  dc.processing = true // 模拟 runDaily 正在执行
  const res = await dc.runImmediate('100', { inputTokenLimit: 30000, outputTokenLimit: 4096, minConfidence: 0.7, maxAttempts: 3, rawRetentionDays: 30, eventRetentionDays: 90, use: null, groups: [{ groupId: '100', switchOn: true }] })
  assert.equal(res.ok, false)
  assert.match(res.message, /正在执行|稍后/)
  dc.processing = false
})

console.log('【4. P2-1 补录到已跨过的空白日 → 自动创建任务并处理】')
await check('lastDailyEnd 已过 + 补录历史 → 创建 pending 并被处理', async () => {
  mockRedis.data.clear()
  const store = new MemoryStore(mockRedis)
  const dc = new DailyConsolidation({ store })
  const gid = '100'
  const cfg = {
    inputTokenLimit: 30000, outputTokenLimit: 4096, minConfidence: 0.7, maxAttempts: 3,
    rawRetentionDays: 30, eventRetentionDays: 90, use: null,
    llm: async () => ({ text: '{"candidates":[]}' }),
    groups: [{ groupId: gid, switchOn: true }],
  }
  // 先处理昨天（游标推进到昨天）
  const ts = dayToTs(yesterdayKey()) + 3600
  await store.saveRawMessage({ groupId: gid, messageId: 'r1', senderId: '10001', senderName: 'A', role: '', text: '消息', time: ts, isCommand: false, contentHash: 'h' }, 30)
  await dc.runDaily(cfg)
  const policy = await store.getPolicy(gid)
  assert.equal(policy.lastDailyEnd, yesterdayKey())

  // 补录前天（早于游标，无任务）→ saveRawMessage 应自动创建 pending
  const dayBefore = dayKey(dayToTs(yesterdayKey()) - 86400)
  await store.saveRawMessage({ groupId: gid, messageId: 'r0', senderId: '10001', senderName: 'A', role: '', text: '补录历史', time: dayToTs(dayBefore) + 3600, isCommand: false, contentHash: 'h0' }, 30)
  const task = await store.getTask(gid, dayBefore)
  assert.ok(task && task.status === 'pending', `补录空白日应自动创建 pending 任务: ${JSON.stringify(task)}`)

  // 下一轮 runDaily 应处理该任务
  await dc.runDaily(cfg)
  const task2 = await store.getTask(gid, dayBefore)
  assert.equal(task2.status, 'completed', '补录的历史日应被处理')
})

console.log('【5. P1-1 Memory_Tool 记忆关闭来源群按派生删除】')
await check('Memory_Tool user 记忆仅本群证据 → 关闭群整体删除', async () => {
  mockRedis.data.clear()
  const store = new MemoryStore(mockRedis)
  const evd = { t1: { groupId: '100', senderId: '10001', senderName: '', role: '', time: 1780000000 } }
  const r = await store.applyFact(
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.age', factValue: '25', text: '用户25岁', kind: 'identity', confidence: 0.9, importance: 0.6, evidenceMessageIds: ['t1'] },
    { groupId: '100', source: 'Memory_Tool', evidenceMap: evd, maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  assert.equal(r.ok, true)
  const cleared = await store.clearGroup('100')
  // Memory_Tool 是派生记忆：仅本群证据 → 应整体删除
  assert.equal(await store.getMemory(r.memoryId), null, 'Memory_Tool 记忆关闭群后应整体删除')
})

console.log('【6. enableUserProfileHistoryScan 开关（历史扫描控制，第六轮）】')
await check('scanHistory=false + 无已存 → 提示且不调用 getChatHistory', async () => {
  mockRedis.data.clear()
  let historyCalled = false
  const e = { group_id: '100', isGroup: true, seq: 0, message_id: 'cur', group: { getChatHistory: async () => { historyCalled = true; return [] } } }
  const res = await extractUserProfile(e, '10001', { scanHistory: false, store: new MemoryStore(mockRedis) })
  assert.equal(res.ok, false)
  assert.match(res.message, /已存画像/, `应提示无已存画像: ${res.message}`)
  assert.equal(historyCalled, false, '关闭扫描不得调用 getChatHistory')
})

await check('scanHistory=false + 有已存 → 返回画像且不扫描', async () => {
  mockRedis.data.clear()
  const store = new MemoryStore(mockRedis)
  const evd = { s1: { groupId: '100', senderId: '10001', senderName: '', role: '', time: 1780000000 } }
  await store.applyFact(
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.nickname', factValue: 'yuyu', text: '用户昵称玉玉', kind: 'identity', confidence: 0.9, importance: 0.8, evidenceMessageIds: ['s1'] },
    { groupId: '100', source: 'Memory_Tool', evidenceMap: evd, maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  let historyCalled = false
  const e = { group_id: '100', isGroup: true, seq: 0, message_id: 'cur', group: { getChatHistory: async () => { historyCalled = true; return [] } } }
  const res = await extractUserProfile(e, '10001', { scanHistory: false, store })
  assert.equal(res.ok, true)
  assert.match(res.message, /已存画像/, `应返回已存画像: ${res.message}`)
  assert.ok(res.profile.facts.length >= 1, '应包含已存事实')
  assert.equal(historyCalled, false, '关闭扫描不得调用 getChatHistory')
})

await check('Config 全局关闭（真实链路无 options 覆盖）', async () => {
  mockRedis.data.clear()
  Config.getConfig().enableUserProfileHistoryScan = false
  let historyCalled = false
  const e = { group_id: '100', isGroup: true, seq: 0, message_id: 'cur', group: { getChatHistory: async () => { historyCalled = true; return [] } } }
  const res = await extractUserProfile(e, '10001', { store: new MemoryStore(mockRedis) })
  assert.equal(historyCalled, false, 'Config 关闭时真实链路不得扫描')
  assert.match(res.message, /已存画像|暂无已存/)
  Config.getConfig().enableUserProfileHistoryScan = true
})

await check('缺失（默认）→ 仍扫描', async () => {
  mockRedis.data.clear()
  const cfg = Config.getConfig()
  delete cfg.enableUserProfileHistoryScan
  let historyCalled = false
  const e = { group_id: '100', isGroup: true, seq: 0, message_id: 'cur', group: { getChatHistory: async () => { historyCalled = true; return [] } } }
  const res = await extractUserProfile(e, '10001', { store: new MemoryStore(mockRedis) })
  assert.equal(historyCalled, true, '默认应扫描')
  assert.match(res.message, /未找到|历史文本消息/)
  Config.getConfig().enableUserProfileHistoryScan = true
})

await check('UserProfileTool.func 真实链路：Config 关闭时只读已存', async () => {
  mockRedis.data.clear()
  const store = new MemoryStore(mockRedis)
  const evd = { s2: { groupId: '100', senderId: '10001', senderName: '', role: '', time: 1780000000 } }
  await store.applyFact(
    { scope: 'user', subjectId: '10001', speakerId: '10001', factKey: 'identity.age', factValue: '25', text: '用户25岁', kind: 'identity', confidence: 0.9, importance: 0.8, evidenceMessageIds: ['s2'] },
    { groupId: '100', source: 'Memory_Tool', evidenceMap: evd, maxMemoriesPerUser: 100, eventRetentionDays: 90 },
  )
  Config.getConfig().enableUserProfileHistoryScan = false
  const tool = new UserProfileTool()
  let historyCalled = false
  const e = {
    group_id: '100', isGroup: true, user_id: '10001', isMaster: false, sender: { role: 'member' },
    seq: 0, message_id: 'cur',
    group: { getChatHistory: async () => { historyCalled = true; return [] } },
  }
  const ret = await tool.func({ target_id: '10001' }, e)
  assert.match(ret, /已存画像/, `func 应返回已存画像: ${ret}`)
  assert.match(ret, /25岁|年龄/, `画像应含已存事实: ${ret}`)
  assert.equal(historyCalled, false, 'func 真实链路关闭时不得扫描历史')
  Config.getConfig().enableUserProfileHistoryScan = true
})

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
