import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate, setTimeout as delay } from 'node:timers/promises'
import { normalizeGroupReplyConfig } from '../utils/groupReplyConfig.js'

const Config = { groupReply: {}, tts_First_person: '派蒙' }
const requests = [], replies = [], errors = []
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
globalThis.logger = { error: message => errors.push(message) }
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
  requests.length = replies.length = errors.length = 0
  Config.groupReply = normalizeGroupReplyConfig({ enabled: true, groups: [{ groupId: '100', switchOn: true }, { groupId: '200', switchOn: true }] })
  decision = async () => ({ text: '{"reply":false}' })
  respond = async (e, options) => {
    assert.equal(options.automatic, true)
    assert.equal(e.sender.role, 'member')
    await e.reply(e.msg)
  }
  muted = false
  mock.timers.reset()
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 })
})

test('全消息观察器放行多行消息；未启用的群、私聊、自身消息和指令不触发判断', async () => {
  const observer = new groupReplyObserver()
  assert.ok(observer.priority < 1144)
  assert.ok(new RegExp(observer.rule[0].reg).test('第一行\n第二行'))
  assert.equal(await observer.observe(event('私聊', { isGroup: false })), false)
  await observer.observe(event('未开启', { group_id: '300' }))
  await observer.observe(event('自己', { user_id: '999' }))
  await observer.observe(event('#命令'))
  await tick(10000)
  assert.equal(requests.length, 0)
  await observer.observe(event('普通\n消息'))
  await tick(10000)
  assert.equal(requests.length, 1, JSON.stringify(errors))
  assert.deepEqual(requests[0].data.bot, { id: '999', name: '派蒙' })
  assert.deepEqual(requests[0].data.history.map(m => m.text), ['自己', '#命令', '普通\n消息'])
})

test('默认 10 秒尾部防抖，每群独立，整批合并并保留每条候选消息', async () => {
  groupReply.observe(event('第一条'))
  await tick(6000)
  groupReply.observe(event('第二条'))
  groupReply.observe(event('另一群', { group_id: '200' }))
  await tick(6000)
  assert.equal(requests.length, 0)
  groupReply.observe(event('第三条'))
  await tick(4000)
  assert.equal(requests.length, 1, JSON.stringify(errors))
  assert.equal(requests[0].data.groupId, '200')
  await tick(6000)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].data.candidateIds.length, 3)
  assert.equal(replies.length, 0)
})

test('判断可选择合并窗口内较早的消息，使用原始事件身份并抑制重复事件', async () => {
  decision = async data => ({ text: JSON.stringify({ reply: true, messageId: data.candidateIds[0], sender: { role: 'owner' } }) })
  const first = event('需要回复的问题')
  groupReply.observe(first)
  groupReply.observe(first)
  first.msg = '后续插件改写'
  groupReply.observe(event('补充'))
  await tick(10000)
  assert.equal(requests[0].data.candidateIds.length, 2)
  assert.deepEqual(replies, ['需要回复的问题'])
})

test('窗口条数默认 50、下限 20；长文本被截断，纯图片仅作为类型参与判断', async () => {
  for (let i = 0; i < 60; i++) groupReply.observe(event(`消息${i}`))
  await tick(10000)
  assert.equal(requests[0].data.history.length, 50)
  assert.equal(requests[0].data.candidateIds.length, 50)
  Config.groupReply.historyCount = 1
  groupReply.observe(event('长'.repeat(4000)))
  groupReply.observe(event('', { message: [{ type: 'image', url: 'https://secret.example/image' }] }))
  await tick(10000)
  const history = requests[1].data.history
  assert.equal(history.length, 20)
  assert.equal(history.at(-2).text.length, 2000)
  assert.equal(history.at(-1).text, '[image]')
})

test('坏 JSON、字符串布尔值、越界目标与模型失败均不回复，后续消息仍可判断', async () => {
  for (const text of ['不是 JSON', '{"reply":"true"}', '{"reply":true,"messageId":"其他群编号"}']) {
    decision = async () => ({ text })
    groupReply.observe(event('测试'))
    await tick(10000)
  }
  decision = async () => { throw new Error('模型不可用') }
  groupReply.observe(event('失败'))
  await tick(10000)
  assert.equal(errors.length, 4)
  assert.equal(replies.length, 0)
  decision = async data => ({ text: JSON.stringify({ reply: true, messageId: data.candidateIds[0] }) })
  groupReply.observe(event('恢复'))
  await tick(10000)
  assert.deepEqual(replies, ['恢复'])
})

test('直接呼叫取消待判断批次，也使正在运行的判断失效', async () => {
  const direct = event('派蒙你好')
  groupReply.observe(direct)
  groupReply.markHandled(direct)
  await tick(10000)
  assert.equal(requests.length, 0)
  let resolve
  decision = data => new Promise(done => { resolve = () => done({ text: JSON.stringify({ reply: true, messageId: data.candidateIds[0] }) }) })
  groupReply.observe(event('普通问题'))
  await tick(10000)
  groupReply.markHandled(direct)
  resolve()
  await settle()
  assert.equal(replies.length, 0)
})

test('自主回复已开始发送时，晚到的直接呼叫与同消息重复事件不能再次接管', async () => {
  Config.groupReply.debounceSeconds = 0
  decision = async data => ({ text: JSON.stringify({ reply: true, messageId: data.candidateIds[0] }) })
  let completeSend
  const e = event('派蒙你好', {
    reply: text => { replies.push(text); return new Promise(resolve => { completeSend = resolve }) }
  })
  groupReply.observe(e)
  await tick(0)
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
  decision = async data => ({ text: JSON.stringify({ reply: true, messageId: data.candidateIds[0] }) })
  let finishGeneration
  respond = e => new Promise(resolve => { finishGeneration = async () => { await e.reply('自主回复'); resolve() } })
  const e = event('派蒙你好')
  groupReply.observe(e)
  await tick(10000)
  assert.equal(groupReply.markHandled(e), true)
  await e.reply('直接回复')
  await finishGeneration()
  await settle()
  assert.deepEqual(replies, ['直接回复'])
})

test('判断和发送前复查群开关及闭嘴状态；重新开启后不复用已清理的记录', async () => {
  let resolve
  decision = data => new Promise(done => { resolve = () => done({ text: JSON.stringify({ reply: true, messageId: data.candidateIds[0] }) }) })
  groupReply.observe(event('旧数据'))
  await tick(10000)
  Config.groupReply.groups[0].switchOn = false
  resolve()
  await settle()
  groupReply.prune()
  assert.equal(replies.length, 0)
  Config.groupReply.groups[0].switchOn = true
  decision = async data => ({ text: JSON.stringify({ reply: true, messageId: data.candidateIds[0] }) })
  respond = async e => { Config.groupReply.groups[0].switchOn = false; await e.reply('关闭后不发送') }
  groupReply.observe(event('新数据'))
  await tick(10000)
  assert.equal(requests[1].data.history.length, 1)
  assert.equal(replies.length, 0)
  Config.groupReply.groups[0].switchOn = true
  muted = true
  groupReply.observe(event('闭嘴中'))
  await tick(10000)
  assert.equal(requests.length, 2)
})

test('同群串行、跨机器人隔离；处理中新增消息仍会进入下一批，0 秒有效', async () => {
  Config.groupReply.debounceSeconds = 0
  let resolve
  decision = () => new Promise(done => { resolve = done })
  groupReply.observe(event('第一批'))
  await tick(0)
  const finish = resolve
  groupReply.observe(event('第二批'))
  await tick(1000)
  assert.equal(requests.length, 1, JSON.stringify(errors))
  groupReply.observe(event('其他机器人', { self_id: '888' }))
  await tick(0)
  assert.equal(requests.length, 2)
  resolve({ text: '{"reply":false}' })
  decision = async () => ({ text: '{"reply":false}' })
  finish({ text: '{"reply":false}' })
  await settle()
  await tick(0)
  assert.equal(requests.length, 3)
  assert.equal(requests[2].data.history.at(-1).text, '第二批')
})
