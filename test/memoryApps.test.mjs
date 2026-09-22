/**
 * apps 层契约测试：TRSS 插件薄胶水
 *
 * 运行：node --experimental-test-module-mocks --test test/memoryApps.test.mjs
 *
 * 覆盖点（都是 memoryV2.test.js 触不到的层级）：
 * 1. 观察器 rule 必须匹配任何消息文本，含多行/空串——`'^.*$'` 会静默丢掉所有含换行的消息
 * 2. 查看记忆的编号必须是「updatedAt 降序 + id 升序」全序，与底层返回顺序无关
 * 3. 展示的第 N 条必须就是 `#删除记忆 … N` 实际删除的那一条
 *
 * mock 原则：只 mock 边界（TRSS 插件基类、store 工厂、转发消息构造、capture/dailyTask），
 * 被测的排序、编号、正则匹配全部执行真实生产代码——排序逻辑绝不能出现在 mock 里。
 */
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {} }

/** TRSS 插件基类 stub：只保留被测代码实际调用的 reply / awaitContext */
class PluginStub {
  constructor(options = {}) {
    Object.assign(this, options)
  }

  async reply() {}

  async awaitContext() {
    return { msg: '是' } // 二次确认一律通过
  }
}
mock.module('../../../lib/plugins/plugin.js', { defaultExport: PluginStub })

/** 转发消息构造 stub：回传可检查的结构，不依赖真实渲染 */
const forwards = []
mock.module('../utils/common.js', {
  namedExports: {
    makeForwardMsg: async (e, messages, title) => {
      const forward = { title, messages }
      forwards.push(forward)
      return forward
    },
  },
})

/** store 工厂 stub：listRecallCandidates 按队列吐数据，用于模拟 Redis Set 的不稳定顺序 */
const storeCalls = { deleted: [] }
let recallQueue = []
mock.module('../utils/memory/v2.js', {
  namedExports: {
    getStore: () => ({
      listRecallCandidates: async () => recallQueue.shift() ?? [],
      deleteMemory: async (id) => {
        storeCalls.deleted.push(id)
        return true
      },
    }),
  },
})

mock.module('../utils/memory/dailyTask.js', {
  namedExports: {
    normalizeCron: () => '0 0 4 * * ? *',
    dailyConsolidation: {},
    DailyConsolidation: class {},
  },
})

mock.module('../utils/memory/capture.js', {
  namedExports: {
    groupCapture: { observe: async () => {}, observePoke: async () => {} },
  },
})

const { memoryGroupObserver } = await import('../apps/memoryGroupObserver.js')
const { memoryManage } = await import('../apps/memoryManage.js')
const { Config } = await import('../utils/config.js')

Config.getConfig().enableMemory = true

/** 构造事件：记录 reply，供断言确认提示内容 */
const mkEvent = (msg, patch = {}) => {
  const replies = []
  const e = {
    msg,
    user_id: '10001',
    group_id: '100',
    isGroup: true,
    message: [],
    self_id: '999',
    reply: async (m) => { replies.push(String(m)) },
    replies,
    ...patch,
  }
  return e
}

/** 从展示出的转发内容里取出编号顺序（formatMemory 末行是 `ID：<id>`） */
const idsOf = (forward) => forward.messages.map(m => m.match(/ID：(\S+)/)[1])

const memory = (id, updatedAt, text) => ({
  id,
  updatedAt,
  text,
  kind: 'identity',
  scope: 'user',
  factKey: 'identity.name',
  factValue: id,
  confidence: 0.9,
  importance: 0.5,
  source: 'group-window:100:2026-09-20',
})

test('观察器 rule 必须匹配任何消息文本（含多行、空串）', async () => {
  const observer = new memoryGroupObserver({})
  const rule = observer.rule[0]

  // 与 loader 的匹配方式保持一致：字符串 reg 会被 new RegExp 转换后直接 test(e.msg)
  const re = new RegExp(rule.reg)
  assert.equal(re.test('普通消息'), true)
  assert.equal(re.test('第一行\n第二行'), true, "多行消息不能被 rule 丢掉（'^.*$' 在这里会返回 false）")
  assert.equal(re.test('尾随换行\n'), true)
  assert.equal(re.test('\n'), true)
  assert.equal(re.test(''), true)

  assert.equal(rule.fnc, 'observe')
  assert.equal(await observer.observe({}), false, '观察器不得拦截消息')
})

test('查看记忆：底层顺序任意变化时编号都是「updatedAt 降序 + id 升序」', async () => {
  const a = memory('m_a', 1000, 'A')
  const b = memory('m_b', 1000, 'B') // 与 a 同毫秒 → 必须靠 id 兜底才能稳定
  const c = memory('m_c', 2000, 'C')
  const expected = ['m_c', 'm_a', 'm_b']

  for (const order of [[b, c, a], [a, b, c], [c, b, a]]) {
    // 必须每次传**新数组**：生产代码是 `memories.sort(...)`，会原地改掉我们给出的数组。
    // 复用同一个 order 会让第二次调用拿到"已经被排好序"的输入，等于没测到底层乱序。
    forwards.length = 0
    recallQueue = [[...order]]

    const e = mkEvent('#我的记忆')
    await new memoryManage(e).myMemories(e)
    assert.deepEqual(idsOf(forwards.at(-1)), expected, `我的记忆：底层顺序 ${order.map(m => m.id).join(',')} 下编号必须一致`)

    forwards.length = 0
    recallQueue = [[...order]]

    const e2 = mkEvent('#他的记忆 10001')
    await new memoryManage(e2).otherMemories(e2)
    assert.deepEqual(idsOf(forwards.at(-1)), expected, `他的记忆：底层顺序 ${order.map(m => m.id).join(',')} 下编号必须一致`)
  }
})

test('按序号删除：展示的第 N 条就是实际删除的那条（底层顺序不同也不行）', async () => {
  const a = memory('m_a', 1000, 'A')
  const b = memory('m_b', 1000, 'B')
  const c = memory('m_c', 2000, 'C')

  // 展示侧：底层给出 b,c,a → 用户看到 1=m_c、2=m_a、3=m_b
  forwards.length = 0
  recallQueue = [[b, c, a]]
  const showEvent = mkEvent('#他的记忆 10001')
  await new memoryManage(showEvent).otherMemories(showEvent)
  const shown = idsOf(forwards.at(-1))
  assert.deepEqual(shown, ['m_c', 'm_a', 'm_b'])

  // 删除侧：底层这次给出完全不同的 c,b,a；用户删「2」。
  // 这个顺序是有意选的——它对两种错误实现都有判别力：
  //   忘记排序 → 按输入取下标得到 b；删掉 tie-breaker → 稳定排序保序同样得到 b。
  storeCalls.deleted.length = 0
  recallQueue = [[c, b, a]]
  const delEvent = mkEvent('#删除记忆 10001 2')
  await new memoryManage(delEvent).deleteMemory(delEvent)

  assert.deepEqual(storeCalls.deleted, [shown[1]], '按序号删除必须命中用户刚才看到的第 2 条')
  assert.equal(storeCalls.deleted[0], 'm_a')
  assert.ok(
    delEvent.replies.some(r => r.includes('内容：A')),
    `确认提示必须展示的是同一条记忆，实际提示：${JSON.stringify(delEvent.replies)}`
  )
})

test('按记忆 ID 删除不受编号顺序影响', async () => {
  const a = memory('m_a', 1000, 'A')
  const b = memory('m_b', 1000, 'B')

  storeCalls.deleted.length = 0
  recallQueue = [[b, a]]
  const e = mkEvent('#删除记忆 10001 m_b')
  await new memoryManage(e).deleteMemory(e)

  assert.deepEqual(storeCalls.deleted, ['m_b'])
})
