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
  { plugin: '三角洲', pluginKey: 'delta', command: '#三角洲关闭推送', description: '关闭推送', permission: '', risk: 'w', keys: [] }
]

const config = { enablePluginCommand: true }
const executed = []
let executeResult = { ok: true }

mock.module('../utils/config.js', { namedExports: { Config: config } })
mock.module('../utils/commandMap/indexLoader.js', {
  namedExports: { loadCommandIndex: () => ({ entries: ENTRIES, stats: {} }) }
})
mock.module('../utils/commandMap/execute.js', {
  namedExports: {
    findCommandEntry: (entries, command) => entries.find(entry => entry.command === command) || null,
    executeCommand: async (e, command) => {
      executed.push(command)
      return executeResult
    }
  }
})

const { RunPluginCommandTool } = await import('../utils/tools/RunPluginCommandTool.js')
const { resetPending } = await import('../utils/commandMap/confirm.js')

function makeEvent (userId = 10001, groupId = 555) {
  return { sender: { user_id: userId }, group_id: groupId, msg: '随便' }
}

function run (command, e = makeEvent()) {
  return new RunPluginCommandTool().func({ command }, e)
}

test.beforeEach(() => {
  resetPending()
  executed.length = 0
  executeResult = { ok: true }
  config.enablePluginCommand = true
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

test('确认后再发同一指令才真正执行，且只执行一次', async () => {
  const e = makeEvent()
  await run('#三角洲开启推送', e)
  const text = await run('#三角洲开启推送', e)
  assert.deepEqual(executed, ['#三角洲开启推送'])
  assert.match(text, /已执行/)

  await run('#三角洲开启推送', e)
  assert.equal(executed.length, 1, '确认被消费后不能复用')
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
  config.enablePluginCommand = false
  const text = await run('#三角洲战绩')
  assert.match(text, /已关闭/)
  assert.deepEqual(executed, [])
})

test('缺少消息上下文时拒绝，不执行裸指令', async () => {
  const text = await new RunPluginCommandTool().func({ command: '#三角洲战绩' }, null)
  assert.match(text, /缺少消息上下文/)
  assert.deepEqual(executed, [])
})
