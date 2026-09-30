import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import template from 'art-template'
import { MemoryStore } from '../utils/memory/store.js'
import { buildAtGraph } from '../utils/memory/atGraph.js'

const config = { enableMemory: true, enableAtGraph: true, memoryGroupCapture: { groups: [{ groupId: '100', switchOn: true }] } }
let saves = 0
Object.defineProperties(config, {
  getConfig: { value: () => config },
  get_geminiModels: { value: () => [] },
  save: { value: () => { saves++; return true } }
})
mock.module('../utils/config.js', { namedExports: { Config: config } })
mock.module('../../../lib/plugins/plugin.js', { defaultExport: class { constructor(options) { Object.assign(this, options) } } })
let renderResult
let renderCalls
mock.module('../utils/common.js', { namedExports: { render: async (...args) => { renderCalls.push(args); return renderResult(...args) } } })
mock.module('../utils/tts.js', { namedExports: { speakers: [], vits_emotion_map: [] } })
mock.module('../utils/tts/microsoft-azure.js', { namedExports: { supportConfigurations: [] } })
// capture 的单例在模块加载时保存 Redis 引用；本套件不调用采集入口。
globalThis.redis = {}
const { atGraph } = await import('../apps/atGraph.js')
const { supportGuoba } = await import('../guoba.support.js')
const errors = []
globalThis.logger = { error: text => errors.push(text) }

const now = 1790780000
let serial = 0
const row = (senderId, at, patch = {}) => ({ groupId: '100', messageId: String(++serial), senderId, senderName: `成员${senderId}`, time: now - 100, at, ...patch })
const graph = rows => buildAtGraph({ rows, groupId: '100', targetId: '10001', botId: '99999', generatedAt: now })
let storedRows
let reads
const event = (patch = {}) => {
  const replies = []
  return { msg: '#at图谱', isGroup: true, group_id: '100', user_id: '10001', self_id: '99999', message: [], sender: { card: '小夏' }, reply: async value => { replies.push(value) }, replies, ...patch }
}

beforeEach(() => {
  config.enableMemory = true
  config.enableAtGraph = true
  saves = 0
  config.memoryGroupCapture.groups = [{ groupId: '100', switchOn: true }]
  renderCalls = []
  renderResult = async () => 'base64://图谱'
  errors.length = 0
  const time = Math.floor(Date.now() / 1000) - 100
  storedRows = [row('10001', ['10002'], { time }), row('10002', ['10001'], { time })]
  reads = []
  globalThis.redis = {
    get: async () => null,
    sendCommand: async command => { reads.push(command); return storedRows.map(r => r.messageId) },
    mGet: async keys => keys.map(k => JSON.stringify(storedRows.find(r => k.endsWith(`:${r.messageId}`))))
  }
})

test('统计明确的 @：去重、方向、双向，排除跨群/指令/Bot/自身，保留纯 @', () => {
  const one = row('10001', ['10002', '10002', '99999', '10001', 'all'])
  const rows = [
    one, one,
    row('10002', ['10001'], { senderName: '旧名字' }),
    row('10002', ['10001'], { senderName: '新名字', time: now - 10 }),
    row('10001', ['10003'], { text: '' }),
    row('10004', ['10001']),
    row('10001', ['10005'], { isCommand: true }),
    row('10001', ['10005'], { groupId: '别的群' }),
    row('99999', ['10001']),
    row('10006', undefined, { reply: { userId: '10001' }, poke: { userId: '10001' }, atAll: true }),
    row('10007', ['10001'], { time: now + 1 }),
    row('10007', ['10001'], { time: NaN })
  ]
  const result = graph(rows)
  assert.equal(result.outgoing, 2)
  assert.equal(result.incoming, 3)
  assert.equal(result.total, 5)
  assert.equal(result.partnerCount, 3)
  assert.equal(result.mutualCount, 1)
  assert.equal(result.incomingRank[0].name, '新名字')
  assert.deepEqual(result.composition.map(p => p.count), [1, 1, 1])
  assert.equal(result.nodes[0].total, 3)
  assert.equal(result.nodes[0].kind, 'mutual')
  assert.equal(JSON.stringify(result).includes('别的群'), false)
})

test('截取图中节点不截断统计；同分排行稳定，空数据不产生 NaN', () => {
  const rows = Array.from({ length: 23 }, (_, i) => row('10001', [String(20000 + i)]))
  const result = graph(rows)
  assert.equal(result.total, 23)
  assert.equal(result.nodes.length, 18)
  assert.equal(result.hiddenCount, 5)
  assert.equal(result.affectionRank.length, 5)
  assert.deepEqual(graph([...rows].reverse()), result)
  const empty = graph([])
  assert.equal(empty.total, 0)
  assert.equal(empty.rangeLabel, '暂无保留记录')
  assert.ok(!JSON.stringify(empty).includes('NaN'))
  assert.ok(result.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.width)))
})

test('好感度在本地计算：主动频次与双向均衡加分，纯被动为零', () => {
  const rows = []
  for (let i = 0; i < 40; i++) {
    rows.push(row('10001', ['10002', '10003']))
    rows.push(row('10002', ['10001']))
    rows.push(row('10004', ['10001']))
  }
  const result = graph(rows)
  assert.deepEqual(result.affectionRank.map(p => [p.id, p.score]), [['10002', 91], ['10003', 61], ['10004', 0]])
})

test('存储查询有上限、按最新时间倒序、分批读取，并跳过已过期原文', async () => {
  const calls = []
  const ids = Array.from({ length: 20001 }, (_, i) => String(i))
  const redis = {
    sendCommand: async command => { calls.push(command); return ids },
    mGet: async keys => {
      assert.ok(keys.length <= 200)
      return keys.map(key => key.endsWith(':0') ? null : JSON.stringify({ messageId: key.split(':').at(-1) }))
    }
  }
  const result = await new MemoryStore(redis).getRecentRawMessages('100', now)
  assert.deepEqual(calls, [['ZREVRANGEBYSCORE', 'CHATGPT:MEMORY:V2:rawIdx:100', String(now), '-inf', 'LIMIT', '0', '20001']])
  assert.equal(result.limited, true)
  assert.equal(result.rows.length, 19999)
  assert.equal(result.rows.at(-1).messageId, '19999')
})

test('存储损坏或 Redis 失败不能假装正常的空图谱', async () => {
  const redis = { sendCommand: async () => ['坏记录'], mGet: async () => ['{'] }
  await assert.rejects(new MemoryStore(redis).getRecentRawMessages('100', now), /群 100 的原文 坏记录 失败/)
  redis.mGet = async () => { throw new Error('连接中断') }
  await assert.rejects(new MemoryStore(redis).getRecentRawMessages('100', now), /连接中断/)
})

test('指令先于聊天执行，支持大小写，拒绝未授权群和私聊，不读取数据', async () => {
  const app = new atGraph()
  assert.ok(app.priority > -1011 && app.priority < 1144)
  const rule = new RegExp(app.rule[0].reg)
  for (const msg of ['#at图谱', '#AT图谱', '#艾特图谱', '#at图谱 10002']) assert.ok(rule.test(msg))
  assert.equal(rule.test('看看#at图谱'), false)
  for (const e of [event({ isGroup: false }), event({ group_id: '200' })]) {
    assert.equal(await app.graph(e), true)
    assert.equal(e.replies.length, 1)
  }
  config.enableMemory = false
  await app.graph(event())
  assert.equal(reads.length, 0)
  assert.equal(renderCalls.length, 0)
})

test('锅巴图谱开关读写后立即控制同一个指令实例，面板移除画像扫描设置', async () => {
  const app = new atGraph()
  const panel = supportGuoba().configInfo
  const field = panel.schemas.find(item => item.field === 'enableAtGraph')
  assert.equal(field.component, 'Switch')
  assert.match(field.bottomHelpMessage, /#at图谱 @某人/)
  assert.equal(panel.schemas.some(item => item.field === 'enableUserProfileHistoryScan'), false)
  assert.equal((await panel.getConfigData()).enableAtGraph, true)
  const Result = { ok: () => true, error: message => { throw new Error(message) } }
  await panel.setConfigData({ enableAtGraph: false }, { Result })
  assert.equal((await panel.getConfigData()).enableAtGraph, false)
  for (const patch of [{}, { message: [{ type: 'at', qq: '10002' }] }]) {
    const e = event(patch)
    await app.graph(e)
    assert.match(e.replies[0], /AT图谱已关闭/)
  }
  assert.equal(reads.length, 0)
  assert.equal(renderCalls.length, 0)
  assert.equal(config.enableMemory, true)
  await panel.setConfigData({ enableAtGraph: true }, { Result })
  const e = event()
  await app.graph(e)
  assert.equal(e.replies.at(-1), 'base64://图谱')
  assert.equal(saves, 2)
})

test('图谱生成期间关闭独立开关会取消发送', async () => {
  renderResult = async () => {
    config.enableAtGraph = false
    return 'base64://图谱'
  }
  const e = event()
  await new atGraph().graph(e)
  assert.equal(renderCalls.length, 1)
  assert.match(e.replies[0], /已取消/)
  assert.equal(e.replies.includes('base64://图谱'), false)
})

test('指令默认自己，兼容嵌套 @ 段、数字目标和 @Bot；只渲染本群聚合信息', async () => {
  const app = new atGraph()
  for (const [patch, target] of [
    [{}, '10001'],
    [{ message: [{ type: 'at', qq: '10002' }] }, '10002'],
    [{ message: [{ type: 'at', data: { qq: '10002' } }] }, '10002'],
    [{ msg: '#at图谱 10002' }, '10002'],
    [{ message: [{ type: 'at', qq: '99999' }] }, '10001']
  ]) {
    const e = event(patch)
    assert.equal(await app.graph(e), true)
    assert.equal(e.replies.at(-1), 'base64://图谱')
    const [, key, page, data, options] = renderCalls.at(-1)
    assert.equal(key, 'chatgpt-plugin')
    assert.equal(page, 'atGraph/index')
    assert.equal(data.target.id, target)
    assert.equal(data.groupId, '100')
    assert.equal(data.rows, undefined)
    assert.equal(options.retType, 'base64')
  }
})

test('含糊目标与空数据给出说明，查询指令不会进入图谱统计', async () => {
  const app = new atGraph()
  for (const patch of [
    { message: [{ type: 'at', qq: 'all' }] },
    { message: [{ type: 'at', qq: '10002' }, { type: 'at', qq: '10003' }] },
    { msg: '#at图谱 10003', message: [{ type: 'at', qq: '10002' }] },
    { msg: '#at图谱 错误参数' },
    { msg: '#at图谱 前8' },
    { msg: '#at图谱 5' }
  ]) await app.graph(event(patch))
  assert.equal(reads.length, 0)
  storedRows = [row('10001', ['10002'], { isCommand: true })]
  const e = event()
  await app.graph(e)
  assert.match(e.replies[0], /还没有可统计/)
  assert.equal(renderCalls.length, 0)
})

test('并发互斥，渲染失败释放占用，授权撤销不再发图', async () => {
  let resolveRender
  renderResult = () => new Promise(resolve => { resolveRender = resolve })
  const app = new atGraph()
  const first = event()
  const pending = app.graph(first)
  while (!resolveRender) await new Promise(resolve => setImmediate(resolve))
  const second = event()
  await app.graph(second)
  assert.match(second.replies[0], /正在生成/)
  config.enableMemory = false
  resolveRender('base64://图谱')
  await pending
  assert.match(first.replies[0], /已取消/)
  config.enableMemory = true
  renderResult = async () => false
  const failed = event()
  await app.graph(failed)
  assert.match(failed.replies[0], /生成失败/)
  assert.match(errors[0], /渲染器未返回图片/)
  renderResult = async () => 'base64://重试图谱'
  const retry = event()
  await app.graph(retry)
  assert.equal(retry.replies[0], 'base64://重试图谱')
})

test('真实模板自动转义昵称和群名，不把不可信文本当 HTML', () => {
  const attack = '<img src="https://invalid.test/x" onerror="alert(1)"><meta http-equiv="refresh">'
  const data = buildAtGraph({ rows: [row('10001', ['10002']), row('10002', ['10001'], { senderName: attack })], groupId: '100', targetId: '10001', targetName: attack, groupName: attack, generatedAt: now })
  const html = template.render(readFileSync(new URL('../resources/atGraph/index.html', import.meta.url), 'utf8'), { ...data, pluResPath: '/resources' })
  assert.ok(html.includes('&#60;img'))
  assert.equal(/<img\b|<meta http-equiv="refresh"|onerror="alert/.test(html), false)
  assert.equal(html.includes('{{'), false)
})
