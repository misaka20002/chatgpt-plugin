import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 代执行工具（工具缝：注入假索引与假执行器）。
 *
 * 这里要守住的是确认逻辑本身：q 档不打扰、w/a 档必须等一句「是」、
 * 换一条指令要重新确认、确认过就消费掉不重复执行。
 */

const ENTRIES = [
  { plugin: '三角洲', pluginKey: 'delta', command: '#三角洲战绩', description: '查战绩', permission: '', risk: 'q', keys: [] },
  { plugin: '三角洲', pluginKey: 'delta', command: '#三角洲开启推送', description: '开启推送', permission: '', risk: 'w', keys: [] },
  { plugin: '三角洲', pluginKey: 'delta', command: '#三角洲关闭推送', description: '关闭推送', permission: '', risk: 'w', keys: [] },
  { plugin: '椰奶', pluginKey: 'yenai', command: '#点赞', description: '为发送者或指定目标的QQ个人资料卡点赞', permission: '', risk: 'q', keys: [] }
]

const config = { enableCapabilityMap: true }
const executed = []
let executeResult = { ok: true }
let lastTarget = null

mock.module('../utils/config.js', { namedExports: { Config: config } })
mock.module('../utils/commandMap/indexLoader.js', {
  namedExports: { loadCommandIndex: () => ({ entries: ENTRIES, stats: {} }) }
})
mock.module('../utils/commandMap/execute.js', {
  namedExports: {
    findCommandEntry: (entries, command) => entries.find(entry => entry.command === command) || null,
    executeCommand: async (e, command, options) => {
      executed.push(command)
      lastTarget = options?.target || null
      return executeResult
    }
  }
})

const { RunPluginCommandTool } = await import('../utils/tools/RunPluginCommandTool.js')
const { resetPending } = await import('../utils/commandMap/confirm.js')
import { makeTrssEvent } from './helpers/trssEvent.mjs'

function makeEvent (userId = 10001, groupId = 555, extra = {}) {
  // 身份字段由共享夹具按宿主写法定义（不可写、不可配置）
  return makeTrssEvent({ userId, groupId, msg: '随便', message: [{ type: 'text', text: '随便' }], ...extra })
}

function run (command, e = makeEvent()) {
  return new RunPluginCommandTool().func({ command }, e)
}

test.beforeEach(() => {
  resetPending()
  executed.length = 0
  executeResult = { ok: true }
  lastTarget = null
  config.enableCapabilityMap = true
  globalThis.Bot = { pickMember: async (_groupId, userId) => ({ user_id: userId, is_admin: false }) }
})

test('查询类指令直接执行，不打扰用户', async () => {
  const text = await run('#三角洲战绩')
  assert.deepEqual(executed, ['#三角洲战绩'])
  assert.match(text, /已执行/)
})

test('有副作用的指令第一次只要求确认，不执行', async () => {
  const e = makeEvent()
  const text = await run('#三角洲开启推送', e)

  assert.deepEqual(executed, [])
  assert.match(text, /回复「是」/)
})

test('必须有人回「是」才执行：模型连调两次不算确认，确认后只执行一次', async () => {
  const e = makeEvent()

  const first = await run('#三角洲开启推送', e)
  assert.match(first, /回复「是」/)

  // 用户还没回「是」，模型在同一轮里再调一次：不能放行（防模型自确认）
  const again = await run('#三角洲开启推送', e)
  assert.match(again, /回复「是」/)
  assert.deepEqual(executed, [], '没有人回「是」就不能执行')

  // 用户回了「是」，再调才真正执行
  e.msg = '是'
  const text = await run('#三角洲开启推送', e)
  assert.match(text, /已执行/)
  assert.deepEqual(executed, ['#三角洲开启推送'])

  // 确认被消费后不能复用
  await run('#三角洲开启推送', e)
  assert.equal(executed.length, 1, '确认被消费后不能复用')
})

test('用户回的不是肯定回答时不执行，且待确认记录不丢', async () => {
  const e = makeEvent()
  await run('#三角洲开启推送', e)

  e.msg = '先别急，我再想想'
  const text = await run('#三角洲开启推送', e)
  assert.match(text, /回复「是」/)
  assert.deepEqual(executed, [], '没答「是」不能执行')

  // 记录没被消费掉：用户改口说「是」仍然能走
  e.msg = '好的'
  const ok = await run('#三角洲开启推送', e)
  assert.match(ok, /已执行/)
  assert.deepEqual(executed, ['#三角洲开启推送'])
})

test('确认的是另一条指令时要重新确认', async () => {
  const e = makeEvent()
  await run('#三角洲开启推送', e) // 记住「开启推送」
  const text = await run('#三角洲关闭推送', e) // 换了指令：重新问

  assert.match(text, /回复「是」/)
  assert.deepEqual(executed, [])
})

test('不同用户的确认互不通用', async () => {
  const first = makeEvent(10001)
  const second = makeEvent(20002)
  await run('#三角洲开启推送', first)
  const text = await run('#三角洲开启推送', second)

  assert.match(text, /回复「是」/)
  assert.deepEqual(executed, [])
})

test('索引里查不到的写法按有副作用处理，先确认', async () => {
  const text = await run('#别人乱写的指令')
  assert.match(text, /回复「是」/)
  assert.deepEqual(executed, [])
})

test('执行失败时把原因说清楚，不说「已执行」', async () => {
  executeResult = { ok: false, reason: 'not-found' }
  const text = await run('#三角洲战绩')
  assert.match(text, /^Error: 本机没有能匹配/)
})

test('开关关闭时直接拒绝', async () => {
  config.enableCapabilityMap = false
  const text = await run('#三角洲战绩')
  assert.match(text, /已关闭/)
  assert.deepEqual(executed, [])
})

test('缺少消息上下文时拒绝，不执行裸指令', async () => {
  const text = await new RunPluginCommandTool().func({ command: '#三角洲战绩' }, null)
  assert.match(text, /缺少消息上下文/)
  assert.deepEqual(executed, [])
})


test('主人 @ 他人：以对方身份执行，且不再要求确认', async () => {
  const e = makeEvent(10001, 555, { isMaster: true, message: [{ type: 'at', qq: '20002' }, { type: 'text', text: '签到' }] })
  const text = await run('#三角洲开启推送', e)

  assert.deepEqual(executed, ['#三角洲开启推送'], 'w 档也应直接执行')
  assert.equal(lastTarget?.userId, '20002')
  assert.match(text, /以 20002 的身份/)
})

test('非主人 @ 他人：忽略 @，只操作自己', async () => {
  const e = makeEvent(10001, 555, { isMaster: false, message: [{ type: 'at', qq: '20002' }, { type: 'text', text: '签到' }] })
  await run('#三角洲战绩', e)

  assert.equal(lastTarget, null)
})

test('主人 @ 的机器人自己时不算目标', async () => {
  const e = makeEvent(10001, 555, { isMaster: true, selfId: '99999', message: [{ type: 'at', qq: '99999' }, { type: 'text', text: '签到' }] })
  await run('#三角洲战绩', e)

  assert.equal(lastTarget, null)
})

test('拿不到对方群身份时拒绝执行', async () => {
  globalThis.Bot = { pickMember: async () => null }
  const e = makeEvent(10001, 555, { isMaster: true, message: [{ type: 'at', qq: '20002' }, { type: 'text', text: '签到' }] })
  const text = await run('#三角洲战绩', e)

  assert.match(text, /^Error: 查不到 20002/)
  assert.deepEqual(executed, [])
})

test('插件报错时把原文交给模型解释，不谎报成功', async () => {
  executeResult = { ok: false, reason: 'handler-error', message: 'render failed at /root/TRSS-Yunzai/x.js' }
  const text = await run('#三角洲战绩')

  assert.match(text, /结果没有发出去/)
  assert.match(text, /render failed/)
  assert.match(text, /敏感信息/)
})

test('只给用户原话时自己匹配并执行，不需要模型先查写法', async () => {
  const e = makeEvent()
  const text = await new RunPluginCommandTool().func({ query: '三角洲战绩' }, e)

  assert.deepEqual(executed, ['#三角洲战绩'])
  assert.match(text, /已执行/)
})

test('原话匹配不到任何指令时如实说没有，不自作主张执行', async () => {
  const e = makeEvent()
  const text = await new RunPluginCommandTool().func({ query: '帮我放首完全不存在的东西' }, e)

  assert.deepEqual(executed, [])
  assert.match(text, /没有和/)
})

test('模型把参数拼进写法时，回退到已知写法再执行', async () => {
  const e = makeEvent()
  const text = await new RunPluginCommandTool().func({ command: '#点赞 3649682312' }, e)

  assert.deepEqual(executed, ['#点赞'])
  assert.match(text, /已执行/)
})
