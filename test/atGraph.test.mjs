import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as crypto from 'node:crypto'
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
let avatarResult
let avatarCalls
let readDirectory
let readGirlFile
let pickGirlIndex
mock.module('node:fs/promises', { namedExports: { ...fsPromises, readdir: (...args) => readDirectory(...args), readFile: (...args) => readGirlFile(...args) } })
mock.module('node:crypto', { namedExports: { ...crypto, randomInt: (...args) => pickGirlIndex(...args) } })
mock.module('../utils/common.js', { namedExports: { render: async (...args) => { renderCalls.push(args); return renderResult(...args) } } })
mock.module('../utils/atGraphAvatars.js', { namedExports: { loadAtGraphAvatars: async graph => { avatarCalls.push(graph); return avatarResult(graph) } } })
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
  avatarCalls = []
  avatarResult = async () => ({})
  readDirectory = fsPromises.readdir
  readGirlFile = fsPromises.readFile
  pickGirlIndex = crypto.randomInt
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

test('最近收到的 @ 按时间选择发送者和正文，复用本群与有效互动过滤', () => {
  const latest = row('10003', ['10001', '10001'], { senderName: '小星🌟', time: now - 10, text: '一起看看这张图？\n[图片]' })
  const excluded = { time: now - 1, text: '不应展示这条消息' }
  const rows = [
    row('10002', ['10001'], { time: now - 30, text: '更早的呼唤' }), latest, latest,
    row('10004', ['10001'], { ...excluded, groupId: '200' }),
    row('10004', ['10001'], { ...excluded, isCommand: true }),
    row('99999', ['10001'], excluded), row('10001', ['10001'], excluded),
    row('10001', ['10004'], excluded), row('10004', ['all'], excluded),
    row('10004', undefined, { ...excluded, reply: { userId: '10001' }, poke: { userId: '10001' } }),
    row('10004', ['10001'], { ...excluded, time: now + 1 })
  ]
  const result = graph(rows)
  assert.deepEqual(result.latestMention, { id: '10003', name: '小星🌟', initials: '小星', text: latest.text,
    timeLabel: '2026-09-30 22:53', truncated: false })
  assert.deepEqual(graph([...rows].reverse()).latestMention, result.latestMention)
  assert.equal(JSON.stringify(result).includes('不应展示这条消息'), false)
  assert.equal(buildAtGraph({ rows, groupId: '100', targetId: '10004', botId: '99999', generatedAt: now }).latestMention.id, '10001')
})

test('最近 @ 支持无正文与空记录，按字符和行数节选长内容', () => {
  assert.equal(graph([]).latestMention, null)
  assert.equal(graph([row('10001', ['10002'])]).latestMention, null)
  const older = row('10002', ['10001'], { time: now - 20, text: '旧正文' })
  for (const text of ['', undefined]) {
    const result = graph([older, row('10003', ['10001'], { time: now - 10, text })])
    assert.equal(result.latestMention.id, '10003')
    assert.equal(result.latestMention.text, '')
    assert.equal(result.latestMention.truncated, false)
  }
  const long = graph([row('10002', ['10001'], { text: '🌟'.repeat(401) })]).latestMention
  assert.equal(long.text, '🌟'.repeat(400))
  assert.equal(long.truncated, true)
  const lines = graph([row('10002', ['10001'], { text: Array(7).fill('你好').join('\r\n') })]).latestMention
  assert.equal(lines.text, Array(6).fill('你好').join('\n'))
  assert.equal(lines.truncated, true)
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

test('互动越多离中心越近，头像近大远小，密集、同分与悬殊频次下昵称及次数胶囊不相交', () => {
  for (const counts of [[61, 21, 8, 2, 2, 1], Array(18).fill(1), [1000, ...Array(17).fill(1)]]) {
    const rows = counts.flatMap((count, i) => Array.from({ length: count }, () => row('10001', [String(20000 + i)])))
    const result = graph(rows)
    const positions = result.nodes.map(n => {
      const pills = Object.values(n.pills)
      return { left: n.x + Math.min(-106, ...pills.map(p => p.x - p.width / 2)), right: n.x + Math.max(106, ...pills.map(p => p.x + p.width / 2)),
        top: n.y + Math.min(-n.avatarSize / 2, ...pills.map(p => p.y - 14)), bottom: n.y + n.avatarSize / 2 + n.nameGap + 76 }
    })
    assert.ok(result.nodes[0].avatarSize > result.nodes.at(-1).avatarSize, '外围头像必须比靠近中心的头像小')
    for (let i = 0; i < positions.length; i++) {
      const a = positions[i]
      const node = result.nodes[i]
      assert.ok(node.avatarSize >= 60 && node.avatarSize <= 112)
      if (i) assert.ok(node.avatarSize <= result.nodes[i - 1].avatarSize)
      const [endX, endY] = node.path.split(' ').slice(-2).map(Number)
      assert.ok(Math.abs(Math.hypot(node.x - endX, node.y - endY) - node.pills.sent.offset - node.pills.sent.projection - 7) < 0.1, '箭头须停在近侧胶囊外沿')
      const ux = (node.x - result.layout.center.x) / node.radius
      const uy = (node.y - result.layout.center.y) / node.radius
      assert.ok(node.pills.sent.x * ux + node.pills.sent.y * uy < 0, '主动次数须靠近中心')
      assert.ok(node.pills.received.x * ux + node.pills.received.y * uy > 0, '收到次数须远离中心')
      for (const pill of Object.values(node.pills)) assert.ok(Math.abs(pill.x * uy - pill.y * ux) < 0.01, '胶囊须沿中心到头像的径向放置')
      assert.ok(a.left >= 0 && a.right <= result.layout.width && a.top >= 0 && a.bottom <= result.layout.height)
      if (i && result.nodes[i].total < result.nodes[i - 1].total) assert.ok(result.nodes[i].radius > result.nodes[i - 1].radius)
      for (const b of positions.slice(i + 1)) assert.equal(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, false)
    }
  }
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
  assert.match(field.bottomHelpMessage, /#at图谱\[At群友\]/)
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

test('随机女孩素材每次扫描目录，新增编号自动参与抽取且忽略非素材项', async () => {
  const file = (name, regular = true) => ({ name, isFile: () => regular })
  const entries = [file('girl.webp'), file('girl05.webp'), file('notes.webp'), file('girl06.png'), file('girl07.webp', false)]
  const selected = []
  const poolSizes = []
  readDirectory = async (directory, options) => {
    assert.ok(directory.href.endsWith('/resources/girls/'))
    assert.equal(options.withFileTypes, true)
    return entries
  }
  readGirlFile = async url => { selected.push(url.pathname.split('/').at(-1)); return Buffer.from('测试素材') }
  pickGirlIndex = maximum => { poolSizes.push(maximum); return maximum - 1 }
  const app = new atGraph()
  await app.graph(event())
  entries.push(file('girl06.webp'))
  await app.graph(event())
  entries.push(file('girl100.webp'))
  await app.graph(event())
  assert.deepEqual(poolSizes, [2, 3, 4])
  assert.deepEqual(selected, ['girl05.webp', 'girl06.webp', 'girl100.webp'])
  assert.equal(renderCalls.length, 3)
  assert.equal(renderCalls.at(-1)[3].girlImage, `data:image/webp;base64,${Buffer.from('测试素材').toString('base64')}`)
})

test('素材目录为空时明确失败并释放占用，添加素材后可重试', async () => {
  readDirectory = async () => []
  const first = event()
  await new atGraph().graph(first)
  assert.match(first.replies.at(-1), /生成失败/)
  assert.match(errors.at(-1), /没有 girl.webp/)
  assert.equal(renderCalls.length, 0)
  readDirectory = fsPromises.readdir
  const retry = event()
  await new atGraph().graph(retry)
  assert.equal(retry.replies.at(-1), 'base64://图谱')
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

test('指令默认自己，兼容嵌套 @ 段、数字目标和 @Bot；展示对象对应的最近 @', async () => {
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
    assert.equal(data.latestMention.id, target === '10001' ? '10002' : '10001')
    assert.equal(data.rows, undefined)
    assert.match(data.girlImage, /^data:image\/webp;base64,/)
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

test('按发起者拦截重复请求，头像下载期间换目标或换群也不能重复生成', { timeout: 3000 }, async () => {
  let releaseAvatars, signalStarted
  const waiting = new Promise(resolve => { releaseAvatars = resolve })
  const started = new Promise(resolve => { signalStarted = resolve })
  avatarResult = async () => { signalStarted(); return waiting }
  config.memoryGroupCapture.groups.push({ groupId: '200', switchOn: true })
  const first = event()
  const pending = new atGraph().graph(first)
  await started
  try {
    for (const patch of [{}, { msg: '#at图谱 10002' }, { group_id: '200', user_id: 10001 }]) {
      const duplicate = event(patch)
      assert.equal(await new atGraph().graph(duplicate), true)
      assert.match(duplicate.replies[0], /正在生成/)
    }
    assert.equal(reads.length, 1, '重复请求不能再次读取群记录')
    assert.equal(avatarCalls.length, 1, '重复请求不能再次下载头像')
    assert.equal(renderCalls.length, 0)
  } finally {
    releaseAvatars({})
    await pending
  }
  assert.equal(first.replies.at(-1), 'base64://图谱')
  const retry = event()
  await new atGraph().graph(retry)
  assert.equal(retry.replies.at(-1), 'base64://图谱')
  assert.equal(renderCalls[1][3].saveId, renderCalls[0][3].saveId, '完成后重复使用同一个渲染文件')
})

test('同群不同发起者可同时查同一成员，超过两人仍放行且渲染文件互不覆盖', { timeout: 3000 }, async () => {
  let releaseRender
  const waiting = new Promise(resolve => { releaseRender = resolve })
  renderResult = async e => { await waiting; return `base64://${e.user_id}` }
  const callers = ['10001', '10002', '10003'].map(user_id => event({ user_id, msg: '#at图谱 10002' }))
  const pending = callers.map(e => new atGraph().graph(e))
  try {
    while (renderCalls.length < callers.length && !callers.some(e => e.replies.length)) await new Promise(resolve => setImmediate(resolve))
    assert.equal(renderCalls.length, callers.length)
    assert.equal(new Set(renderCalls.map(call => call[3].saveId)).size, callers.length, '同群渲染文件必须按发起者隔离')
    assert.deepEqual(renderCalls.map(call => call[3].target.id), ['10002', '10002', '10002'])
  } finally {
    releaseRender()
    await Promise.all(pending)
  }
  for (const e of callers) assert.deepEqual(e.replies, [`base64://${e.user_id}`])
})

test('发送完成前仍拦截重复请求，发送失败后可重试', { timeout: 3000 }, async () => {
  let releaseSend, signalStarted
  const waiting = new Promise(resolve => { releaseSend = resolve })
  const started = new Promise(resolve => { signalStarted = resolve })
  const first = event({ reply: async value => {
    if (value === 'base64://图谱') { signalStarted(); return waiting }
  } })
  const pending = new atGraph().graph(first)
  await started
  try {
    const duplicate = event()
    await new atGraph().graph(duplicate)
    assert.match(duplicate.replies[0], /正在生成/)
    assert.equal(renderCalls.length, 1)
  } finally {
    releaseSend(false)
    await pending
  }
  assert.match(errors.at(-1), /图片发送失败/)
  const retry = event()
  await new atGraph().graph(retry)
  assert.equal(retry.replies.at(-1), 'base64://图谱')
})

test('头像下载异常和无可统计记录均释放用户占用', async () => {
  avatarResult = async () => { throw new Error('头像处理失败') }
  const failed = event()
  await new atGraph().graph(failed)
  assert.match(failed.replies.at(-1), /生成失败/)
  avatarResult = async () => ({})
  const retry = event()
  await new atGraph().graph(retry)
  assert.equal(retry.replies.at(-1), 'base64://图谱')
  const originalRows = storedRows
  storedRows = []
  const empty = event()
  await new atGraph().graph(empty)
  assert.match(empty.replies.at(-1), /还没有可统计/)
  storedRows = originalRows
  const next = event()
  await new atGraph().graph(next)
  assert.equal(next.replies.at(-1), 'base64://图谱')
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

test('真实模板自动转义昵称、群名和最近 @ 正文，不把不可信文本当 HTML', () => {
  const attack = '<img src="https://invalid.test/x" onerror="alert(1)"><meta http-equiv="refresh">'
  const data = buildAtGraph({ rows: [row('10001', ['10002']), row('10002', ['10001'], { senderName: attack, text: attack })], groupId: '100', targetId: '10001', targetName: attack, groupName: attack, generatedAt: now })
  const html = template.render(readFileSync(new URL('../resources/atGraph/index.html', import.meta.url), 'utf8'), { ...data, pluResPath: '/resources' })
  assert.ok(html.includes('&#60;img'))
  assert.ok(html.includes('<blockquote class="mention-text">&#60;img'))
  assert.equal(/<img\b|<meta http-equiv="refresh"|onerror="alert/.test(html), false)
  assert.equal(html.includes('{{'), false)
})
