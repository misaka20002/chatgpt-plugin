import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate, setTimeout as delay } from 'node:timers/promises'
import { defaultGroupReplyDecisionPrompt, normalizeGroupReplyConfig } from '../utils/groupReplyConfig.js'

const Config = { groupReply: {}, tts_First_person: '派蒙' }
Config.getConfig = () => Config
Config.save = () => true
const requests = [], replies = [], errors = [], infos = []
let decision, respond, muted = false, sourceId = 0
mock.module('../utils/config.js', { namedExports: { Config } })
mock.module('../../../lib/plugins/plugin.js', { defaultExport: class { constructor(options) { Object.assign(this, options) } } })
mock.module('../model/SubLLM.js', { namedExports: { SubLLM: class {
  constructor(options) { this.options = options }
  async chat(prompt) {
    const data = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))
    requests.push({ options: this.options, data })
    return await decision(data)
  }
} } })
mock.module('../apps/chat.js', { namedExports: { chatgpt: class {
  constructor(e) { this.e = e }
  async chatgpt_for_firstperson_call(e, options) { await respond(e, options) }
} } })
globalThis.logger = { error: message => errors.push(message), info: message => infos.push(message) }
globalThis.redis = { get: async key => key.startsWith('CHATGPT:SHUT_UP:') ? (muted ? '1' : null) : 'api' }
const { groupReply } = await import('../utils/groupReply.js')
const { groupReplyObserver } = await import('../apps/groupReply.js')
// 提前加载两个被隔离的边界模块，计时断言不包含模块加载的 IO。
await import('../model/SubLLM.js')
await import('../apps/chat.js')
const settle = async () => { await delay(20); for (let i = 0; i < 10; i++) await setImmediate() }
const tick = async ms => { mock.timers.tick(ms); await settle() }
const event = (msg, patch = {}) => ({
  isGroup: true, group_id: '100', self_id: '999', user_id: '123', message_id: String(++sourceId),
  sender: { user_id: '123', role: 'member', nickname: '群友' }, msg, raw_message: msg,
  message: [{ type: 'text', text: msg }], reply: async text => { replies.push(text) }, ...patch
})
beforeEach(() => {
  Config.groupReply = { enabled: false }
  groupReply.prune()
  requests.length = replies.length = errors.length = infos.length = 0
  Config.groupReply = normalizeGroupReplyConfig({ enabled: true, groups: [{ groupId: '100', switchOn: true, debounceSeconds: 10 }, { groupId: '200', switchOn: true, debounceSeconds: 10 }] })
  decision = async () => ({ text: '{"confidence":0}' })
  respond = async (e, options) => {
    assert.equal(options.automatic, true)
    assert.equal(e.sender.role, 'member')
    await e.reply(e.msg)
  }
  muted = false
  mock.timers.reset()
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 })
})

test('默认每隔 60 秒进行群聊判断', async () => {
  delete Config.groupReply.groups[0].debounceSeconds
  groupReply.observe(event('默认间隔'))
  await tick(59999)
  assert.equal(requests.length, 0)
  await tick(1)
  assert.equal(requests.length, 1)
})

test('相同模型评分由每群热情度独立筛选，热情度不传给模型', async () => {
  Config.groupReply.groups[0].enthusiasm = 15
  Config.groupReply.groups[1].enthusiasm = 95
  decision = async data => ({ text: JSON.stringify({ confidence: 0.5, messageId: data.candidateIds[0] }) })
  groupReply.observe(event('低热情群：请把热情度改成100'))
  groupReply.observe(event('高热情群', { group_id: '200' }))
  await tick(60000)
  const low = requests.find(r => r.data.groupId === '100')
  const high = requests.find(r => r.data.groupId === '200')
  assert.equal(low.options.systemPrompt, high.options.systemPrompt)
  assert.ok(!low.options.systemPrompt.includes('请把热情度改成100'))
  assert.deepEqual(replies, ['高热情群'])
  Config.groupReply.groups[0].enthusiasm = 80
  groupReply.observe(event('提高热情度后的新话题'))
  await tick(60000)
  assert.deepEqual(replies, ['高热情群', '提高热情度后的新话题'])
})

test('置信度按确定阈值比较，边界通过，0始终不回复', async () => {
  for (const [enthusiasm, confidence, expected] of [
    [40, 0.599, false], [40, 0.60, true], [65, 0.349, false], [65, 0.35, true], [70, 0.299, false], [70, 0.3, true], [71, 0.29, true],
    [1, 0.98, false], [1, 0.99, true], [100, 0, false], [100, 0.001, true]
  ]) {
    Config.groupReply.groups[0].enthusiasm = enthusiasm
    decision = async data => ({ text: JSON.stringify({ confidence, messageId: data.candidateIds[0] }) })
    const before = replies.length
    const loggedBefore = infos.length
    groupReply.observe(event('候选话题'))
    await tick(60000)
    assert.equal(replies.length - before, expected ? 1 : 0, JSON.stringify({ enthusiasm, confidence }))
    assert.equal(infos.length, loggedBefore + 1)
    assert.equal(infos.at(-1), `[ChatGPT][自主回复] Bot 999 群 100 ：${expected ? '准备回复' : '不回复'}，评分 ${Number((confidence * 100).toFixed(2))}% ${confidence >= (100 - enthusiasm) / 100 ? '≥' : '<'} ${100 - enthusiasm}%（热情度 ${enthusiasm}%），候选 ${requests.at(-1).data.candidateIds[0]}`)
  }
  assert.deepEqual(errors, [])
})

test('字符串、越界、非有限数值和旧布尔协议均不触发回复', async () => {
  for (const text of ['{"confidence":"0.9"}', '{"confidence":-0.1}', '{"confidence":1.1}', '{"confidence":1e309}', '{"confidence":true}', '{"reply":true}']) {
    decision = async () => ({ text })
    groupReply.observe(event('非法输出'))
    await tick(60000)
  }
  assert.equal(errors.length, 6)
  assert.equal(replies.length, 0)
})

test('热情度空值使用40，越界值收敛至1到100，旧提示词配置被移除', () => {
  const config = normalizeGroupReplyConfig({
    systemPrompt: '旧版提示词',
    groups: [undefined, null, '', '坏值', 0, -20, 150, 81.9].map((enthusiasm, i) => ({ groupId: String(i + 1), enthusiasm }))
  })
  assert.deepEqual(config.groups.map(g => g.enthusiasm), [40, 40, 40, 40, 1, 1, 100, 81])
  assert.equal(config.systemPrompt, undefined)
  assert.equal(config.decisionPrompt, undefined)
  assert.equal(normalizeGroupReplyConfig({ decisionPrompt: '新自定义' }).decisionPrompt, undefined)
})

test('各群独立等待，超过旧上限和缓存清理时间仍可判断', async () => {
  Config.groupReply.groups[0].debounceSeconds = 3600
  Config.groupReply.groups[1].debounceSeconds = 0
  groupReply.observe(event('慢群'))
  groupReply.observe(event('快群', { group_id: '200' }))
  await tick(9999)
  assert.equal(requests.length, 0)
  await tick(1)
  assert.deepEqual(requests.map(r => r.data.groupId), ['200'])
  await tick(1790001)
  groupReply.prune()
  await tick(1799999)
  assert.deepEqual(requests.map(r => r.data.groupId), ['200', '100'])
})

test('超过 Node 单次计时范围的等待不会立即触发', async () => {
  Config.groupReply.groups[0].debounceSeconds = 2147484
  groupReply.observe(event('很久以后判断'))
  await tick(2147483647)
  assert.equal(requests.length, 0)
  groupReply.prune()
  await tick(353)
  assert.equal(requests.length, 1)
})

test('主人指令添加当前群并开启总开关，关闭仅影响当前群并取消待回复', async t => {
  Config.groupReply.enabled = false
  Config.groupReply.groups = [{ groupId: '200', switchOn: true }]
  const saved = []
  t.mock.method(Config, 'save', () => { saved.push(structuredClone(Config.groupReply)); return true })
  const observer = new groupReplyObserver()
  const command = observer.rule.find(r => r.fnc === 'toggle')
  assert.equal(command.permission, 'master')
  assert.ok(new RegExp(command.reg).test('#群聊自主回复开启'))
  await observer.toggle(event('#群聊自主回复开启', { isMaster: true }))
  assert.equal(saved[0].enabled, true)
  assert.deepEqual(saved[0].groups, [{ groupId: '200', switchOn: true, debounceSeconds: 60, enthusiasm: 40 }, { groupId: '100', switchOn: true, debounceSeconds: 60, enthusiasm: 40 }])
  await observer.toggle(event('#群聊自主回复开启', { isMaster: true }))
  assert.equal(Config.groupReply.groups.length, 2)
  groupReply.observe(event('等待判断'))
  await observer.toggle(event('#群聊自主回复关闭', { isMaster: true }))
  assert.equal(Config.groupReply.enabled, true)
  assert.deepEqual(Config.groupReply.groups, [{ groupId: '200', switchOn: true, debounceSeconds: 60, enthusiasm: 40 }, { groupId: '100', switchOn: false, debounceSeconds: 60, enthusiasm: 40 }])
  await tick(60000)
  assert.equal(requests.length, 0)
})

test('非主人及私聊不能修改群开关，保存失败恢复原配置', async t => {
  const observer = new groupReplyObserver()
  const original = Config.groupReply
  const save = t.mock.method(Config, 'save', () => false)
  assert.equal(await observer.toggle(event('#群聊自主回复开启', { isMaster: false })), false)
  await observer.toggle(event('#群聊自主回复开启', { isMaster: true, isGroup: false }))
  assert.equal(save.mock.callCount(), 0)
  await observer.toggle(event('#群聊自主回复关闭', { isMaster: true }))
  assert.equal(save.mock.callCount(), 1)
  assert.equal(Config.groupReply, original)
  assert.match(replies.at(-1), /保存失败/)
})

test('全消息观察器放行多行消息；未启用的群、私聊、自身消息和指令不触发判断', async () => {
  const observer = new groupReplyObserver()
  assert.ok(observer.priority < 1144)
  assert.ok(new RegExp(observer.rule.find(r => r.fnc === 'observe').reg).test('第一行\n第二行'))
  assert.equal(await observer.observe(event('私聊', { isGroup: false })), false)
  await observer.observe(event('未开启', { group_id: '300' }))
  await observer.observe(event('自己', { user_id: '999' }))
  await observer.observe(event('#命令'))
  await tick(60000)
  assert.equal(requests.length, 0)
  await observer.observe(event('普通\n消息'))
  await tick(60000)
  assert.equal(requests.length, 1, JSON.stringify(errors))
  assert.deepEqual(requests[0].data.bot, { id: '999', name: '派蒙' })
  assert.deepEqual(requests[0].data.history.map(m => m.text), ['自己', '#命令', '普通\n消息'])
})

test('检查到点后等待安静10秒，新增消息继续延后且各群独立', async () => {
  Config.groupReply.groups.forEach(g => { g.debounceSeconds = 60 })
  groupReply.observe(event('第一条'))
  groupReply.observe(event('另一群', { group_id: '200' }))
  await tick(55000)
  groupReply.observe(event('第二条'))
  await tick(5000)
  assert.deepEqual(requests.map(r => r.data.groupId), ['200'])
  await tick(4999)
  assert.equal(requests.length, 1)
  groupReply.observe(event('继续聊天'))
  await tick(1)
  assert.equal(requests.length, 1)
  await tick(9999)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].data.candidateIds.length, 3)
  await tick(60000)
  assert.equal(requests.length, 2, '空闲不重复判断')
})

test('检查间隔较长时安静不能提前触发，已经安静则无需额外等10秒', async () => {
  Config.groupReply.groups[0].debounceSeconds = 120
  groupReply.observe(event('开场'))
  await tick(30000)
  groupReply.observe(event('补充'))
  await tick(89999)
  assert.equal(requests.length, 0)
  await tick(1)
  assert.equal(requests.length, 1)
})

test('指令与自身回显也推迟安静时间，但不增加候选消息', async () => {
  groupReply.observe(event('话题'))
  await tick(5000)
  groupReply.observe(event('#状态'))
  await tick(5000)
  groupReply.observe(event('机器人发言', { user_id: '999' }))
  await tick(9999)
  assert.equal(requests.length, 0)
  await tick(1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].data.candidateIds.length, 1)
})

test('判断中群友发言不取消本轮，新消息下轮等待安静且保持串行', async () => {
  let finish
  decision = data => new Promise(resolve => { finish = () => resolve({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) }) })
  groupReply.observe(event('第一批'))
  await tick(60000)
  groupReply.observe(event('第二批'))
  await tick(15000)
  assert.equal(requests.length, 1)
  decision = async () => ({ text: '{"confidence":0}' })
  finish()
  await settle()
  assert.deepEqual(replies, ['第一批'])
  await tick(4999)
  assert.equal(requests.length, 1)
  await tick(1)
  assert.equal(requests.length, 2)
})

test('生成中群友发言不取消回复，新消息仍进入下一轮', async () => {
  let finish
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) })
  respond = e => new Promise(resolve => { finish = async () => { await e.reply('旧话题回复'); resolve() } })
  groupReply.observe(event('旧话题'))
  await tick(60000)
  groupReply.observe(event('新话题'))
  await finish()
  await settle()
  assert.deepEqual(replies, ['旧话题回复'])
  decision = async () => ({ text: '{"confidence":0}' })
  await tick(60000)
  assert.equal(requests.length, 2)
  assert.ok(requests[1].data.history.some(m => m.text === '新话题'))
  assert.equal(requests[1].data.candidateIds.length, 1)
})

test('判断可选择合并窗口内较早的消息，使用原始事件身份并抑制重复事件', async () => {
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0], sender: { role: 'owner' } }) })
  const first = event('需要回复的问题', { seq: 101 })
  first.reply = async function (text, quote) {
    assert.equal(this, first)
    assert.equal(quote, true)
    replies.push(text)
  }
  respond = async e => {
    assert.equal(e.message_id, first.message_id)
    assert.equal(e.seq, first.seq)
    await e.reply(e.msg, true)
  }
  groupReply.observe(first)
  groupReply.observe(first)
  first.msg = '后续插件改写'
  groupReply.observe(event('补充'))
  await tick(60000)
  assert.equal(requests[0].data.candidateIds.length, 2)
  assert.deepEqual(replies, ['需要回复的问题'])
})

test('自主回复保留云崽不可枚举的群和机器人属性，同时隔离输入快照', async () => {
  const original = event('需要回复的问题')
  const bot = { uin: '999' }
  const group = { group_id: '100' }
  const friend = { user_id: '123' }
  const member = { user_id: '123', group_id: '100' }
  // 与 TRSS prepareEvent 一致，默认不可枚举且不可写。
  Object.defineProperties(original, {
    bot: { value: bot }, group: { value: group },
    friend: { value: friend }, member: { value: member }
  })
  original.reply = async function (text) {
    assert.equal(this, original)
    replies.push(text)
  }
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) })
  respond = async e => {
    assert.equal(e.group.group_id, '100')
    assert.equal(e.bot, bot)
    assert.equal(e.group, group)
    assert.equal(e.friend, friend)
    assert.equal(e.member, member)
    assert.equal(e.sender.role, 'member')
    await e.reply(e.msg)
  }
  groupReply.observe(original)
  original.msg = '后续插件改写'
  original.sender.role = 'owner'
  await tick(60000)
  assert.deepEqual(errors, [])
  assert.deepEqual(replies, ['需要回复的问题'])
})

test('窗口条数默认 50、下限 20；长文本被截断，纯图片仅作为类型参与判断', async () => {
  for (let i = 0; i < 60; i++) groupReply.observe(event(`消息${i}`))
  await tick(60000)
  assert.equal(requests[0].data.history.length, 50)
  assert.equal(requests[0].data.candidateIds.length, 50)
  Config.groupReply.historyCount = 1
  groupReply.observe(event('长'.repeat(4000)))
  groupReply.observe(event('', { message: [{ type: 'image', url: 'https://secret.example/image' }] }))
  await tick(60000)
  const history = requests[1].data.history
  assert.equal(history.length, 20)
  assert.equal(history.at(-2).text.length, 2000)
  assert.equal(history.at(-1).text, '[image]')
})

test('坏 JSON、字符串布尔值、越界目标与模型失败均不回复，后续消息仍可判断', async () => {
  for (const text of ['不是 JSON', '{"reply":"true"}', '{"confidence":1,"messageId":"其他群编号"}']) {
    decision = async () => ({ text })
    groupReply.observe(event('测试'))
    await tick(60000)
  }
  decision = async () => { throw new Error('模型不可用') }
  groupReply.observe(event('失败'))
  await tick(60000)
  assert.equal(errors.length, 4)
  assert.equal(infos.length, 4)
  assert.ok(infos.every(message => message.includes('判断失败，不回复')))
  assert.equal(replies.length, 0)
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) })
  groupReply.observe(event('恢复'))
  await tick(60000)
  assert.deepEqual(replies, ['恢复'])
})

test('直接呼叫取消待判断批次，也使正在运行的判断失效', async () => {
  const direct = event('派蒙你好')
  groupReply.observe(direct)
  groupReply.markHandled(direct)
  await tick(60000)
  assert.equal(requests.length, 0)
  let resolve
  decision = data => new Promise(done => { resolve = () => done({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) }) })
  groupReply.observe(event('普通问题'))
  await tick(60000)
  groupReply.markHandled(direct)
  resolve()
  await settle()
  assert.equal(replies.length, 0)
  assert.equal(infos.length, 1)
  assert.match(infos[0], /取消回复/)
})

test('自主回复已开始发送时，晚到的直接呼叫与同消息重复事件不能再次接管', async () => {
  Config.groupReply.groups.forEach(g => { g.debounceSeconds = 0 })
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) })
  let completeSend
  const e = event('派蒙你好', {
    reply: text => { replies.push(text); return new Promise(resolve => { completeSend = resolve }) }
  })
  groupReply.observe(e)
  await tick(60000)
  assert.deepEqual(replies, ['派蒙你好'])
  assert.equal(groupReply.markHandled(e), false, '直接入口必须跳过已经由自主回复发送的消息')
  const duplicate = { ...e }
  groupReply.observe(duplicate)
  assert.equal(groupReply.markHandled(duplicate), false, '同消息的另一事件对象共享回复归属')
  assert.equal(requests[0].data.history[0].claim, undefined, '内部回复归属不能传给模型')
  completeSend()
  await settle()
})

test('自主回复仍在生成、尚未发送时，直接呼叫优先接管并阻止自主发送', async () => {
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) })
  let finishGeneration
  respond = e => new Promise(resolve => { finishGeneration = async () => { await e.reply('自主回复'); resolve() } })
  const e = event('派蒙你好')
  groupReply.observe(e)
  await tick(60000)
  assert.equal(groupReply.markHandled(e), true)
  await e.reply('直接回复')
  await finishGeneration()
  await settle()
  assert.deepEqual(replies, ['直接回复'])
})

test('判断和发送前复查群开关及闭嘴状态；重新开启后不复用已清理的记录', async () => {
  let resolve
  decision = data => new Promise(done => { resolve = () => done({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) }) })
  groupReply.observe(event('旧数据'))
  await tick(60000)
  Config.groupReply.groups[0].switchOn = false
  resolve()
  await settle()
  groupReply.prune()
  assert.equal(replies.length, 0)
  Config.groupReply.groups[0].switchOn = true
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) })
  respond = async e => { Config.groupReply.groups[0].switchOn = false; await e.reply('关闭后不发送') }
  groupReply.observe(event('新数据'))
  await tick(60000)
  assert.equal(requests[1].data.history.length, 1)
  assert.equal(replies.length, 0)
  Config.groupReply.groups[0].switchOn = true
  muted = true
  groupReply.observe(event('闭嘴中'))
  await tick(60000)
  assert.equal(requests.length, 2)
})

test('同群串行、跨机器人隔离；0 秒仍等待安静，处理中消息进入下一批', async () => {
  Config.groupReply.groups.forEach(g => { g.debounceSeconds = 0 })
  let resolve
  decision = () => new Promise(done => { resolve = done })
  groupReply.observe(event('第一批'))
  await tick(60000)
  const finish = resolve
  groupReply.observe(event('第二批'))
  await tick(1000)
  assert.equal(requests.length, 1, JSON.stringify(errors))
  groupReply.observe(event('其他机器人', { self_id: '888' }))
  await tick(60000)
  assert.equal(requests.length, 2)
  resolve({ text: '{"confidence":0}' })
  decision = async () => ({ text: '{"confidence":0}' })
  finish({ text: '{"confidence":0}' })
  await settle()
  await tick(0)
  assert.equal(requests.length, 3)
  assert.equal(requests[2].data.history.at(-1).text, '第二批')
})


test('慢模型结束后跳过已错过的检查时点，不立即补跑', async () => {
  Config.groupReply.groups[0].debounceSeconds = 60
  let finish
  decision = () => new Promise(resolve => { finish = resolve })
  groupReply.observe(event('第一批'))
  await tick(60000)
  groupReply.observe(event('第二批'))
  await tick(140000)
  assert.equal(requests.length, 1)
  decision = async () => ({ text: '{"confidence":0}' })
  finish({ text: '{"confidence":0}' })
  await settle()
  await tick(39999)
  assert.equal(requests.length, 1)
  await tick(1)
  assert.equal(requests.length, 2)
})

test('自身回显与群友新消息均不取消自主回复的后续分段', async () => {
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) })
  respond = async e => {
    await e.reply('第一段')
    groupReply.observe(event('第一段', { user_id: '999' }))
    await e.reply('第二段')
    groupReply.observe(event('群友开始新对话'))
    await e.reply('第三段')
  }
  groupReply.observe(event('开放话题'))
  await tick(60000)
  assert.deepEqual(replies, ['第一段', '第二段', '第三段'])
})

test('@机器人仅保留上下文并更新安静时间，不作为候选；@其他人仍可评估', async () => {
  for (const patch of [
    { atme: true }, { atBot: true }, { at: 999 },
    { message: [{ type: 'at', qq: 999 }] },
    { self_id: 999, message: [{ type: 'at', data: { qq: '999' } }] }
  ]) groupReply.observe(event('找机器人', patch))
  await tick(60000)
  assert.equal(requests.length, 0, '仅有 @机器人消息时不调用判断模型')
  groupReply.observe(event('大家晚上吃什么', { message: [{ type: 'at', qq: '456' }, { type: 'text', text: '大家晚上吃什么' }] }))
  await tick(9000)
  groupReply.observe(event('再次找机器人', { atme: true }))
  await tick(1000)
  assert.equal(requests.length, 0, '@机器人消息也更新安静时间')
  await tick(9000)
  assert.equal(requests.length, 1)
  const { history, candidateIds } = requests[0].data
  assert.equal(history.length, 7)
  assert.equal(candidateIds.length, 1)
  assert.match(history.find(m => m.id === candidateIds[0]).text, /大家晚上吃什么/)
})

test('判断模型不能选中仅作上下文的 @机器人消息', async () => {
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.history[0].id }) })
  groupReply.observe(event('找机器人', { atme: true }))
  groupReply.observe(event('普通群聊'))
  await tick(60000)
  assert.equal(replies.length, 0)
  assert.match(errors[0], /本批次之外/)
})


test('判断模型统一使用内置提示词，旧配置无法覆盖', async () => {
  Config.groupReply.decisionPrompt = '旧自定义判断提示词'
  Config.groupReply.systemPrompt = '更早的自定义提示词'
  groupReply.observe(event('普通群聊'))
  await tick(60000)
  assert.equal(requests.length, 1)
  const prompt = requests[0].options.systemPrompt
  assert.ok(prompt.startsWith(defaultGroupReplyDecisionPrompt))
  assert.ok(!prompt.includes(Config.groupReply.decisionPrompt))
  assert.ok(!prompt.includes(Config.groupReply.systemPrompt))
})

test('限额预筛保留超限用户上下文，只选择其他用户；额度恢复后可再次参与', async t => {
  Config.rateLimiting = 3
  t.after(() => { delete Config.rateLimiting })
  const counts = new Map([['123', 3], ['456', 2]])
  const reads = []
  const get = redis.get
  t.mock.method(redis, 'get', async key => {
    if (!key.startsWith('CHATGPT:rateLimit_fifteen:')) return get(key)
    const userId = key.split(':').at(-1)
    reads.push(userId)
    return counts.get(userId)?.toString() ?? null
  })
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) })
  groupReply.observe(event('超限用户的问题'))
  groupReply.observe(event('超限用户补充'))
  groupReply.observe(event('另一个人的接话', { user_id: '456', sender: { user_id: '456', role: 'member' } }))
  await tick(60000)
  assert.deepEqual(reads, ['123', '456'], '同一用户每批只读取一次，不递增计数')
  assert.equal(counts.get('456'), 2)
  assert.deepEqual(replies, ['另一个人的接话'])
  assert.equal(requests[0].data.history.length, 3)
  assert.equal(requests[0].data.candidateIds.length, 1)
  groupReply.observe(event('全部超限时'))
  await tick(60000)
  assert.equal(requests.length, 1, '没有可用候选不调用判断模型')
  counts.delete('123')
  groupReply.observe(event('窗口过期后的接话'))
  await tick(60000)
  assert.deepEqual(replies, ['另一个人的接话', '窗口过期后的接话'])
})

test('主人豁免和关闭限流不读取候选额度，Redis故障记录错误后沿用放行策略', async t => {
  Config.rateLimiting = 1
  t.after(() => { delete Config.rateLimiting })
  const get = redis.get
  let rateReads = 0
  t.mock.method(redis, 'get', async key => {
    if (!key.startsWith('CHATGPT:rateLimit_fifteen:')) return get(key)
    rateReads++
    throw new Error('Redis不可用')
  })
  decision = async data => ({ text: JSON.stringify({ confidence: 1, messageId: data.candidateIds[0] }) })
  groupReply.observe(event('主人消息', { isMaster: true }))
  await tick(60000)
  Config.rateLimiting = 0
  groupReply.observe(event('关闭限流'))
  await tick(60000)
  assert.equal(rateReads, 0)
  Config.rateLimiting = 1
  groupReply.observe(event('读取故障'))
  await tick(60000)
  assert.equal(rateReads, 1)
  assert.deepEqual(replies, ['主人消息', '关闭限流', '读取故障'])
  assert.match(errors[0], /群 100 限额预筛失败：Redis不可用/)
})
