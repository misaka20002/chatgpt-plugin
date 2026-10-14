import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

// 只隔离宿主与发送边界，执行真实的过滤、分片与降级逻辑
const Config = {
  forwardToolRoundText: true,
  blockWords: [],
  enableRobotAt: false,
  isProcessCQAtCode: false,
  removeCQCodeFocus: false
}
let forwardImpl = async (e, messages, title) => ({ forward: messages, title })
mock.module('../utils/config.js', { namedExports: { Config } })
mock.module('../utils/common.js', { namedExports: { makeForwardMsg: (e, messages, title) => forwardImpl(e, messages, title) } })
globalThis.logger = { info() {}, warn() {}, error() {}, debug() {} }
const { sendToolRoundTextForwardMsg } = await import('../utils/toolForward.js')

function createEvent() {
  const replies = []
  return {
    replies,
    e: { reply: async (msg, ...rest) => { replies.push({ msg, rest }) } }
  }
}

test('默认开启：工具轮回复以合并转发单独外发', async () => {
  Config.forwardToolRoundText = true
  Config.blockWords = []
  const { e, replies } = createEvent()
  await sendToolRoundTextForwardMsg(e, [{ text: '哦，我先查一下', provider: 'Gemini', round: 1 }], '工具轮回复')
  assert.equal(replies.length, 1)
  assert.equal(replies[0].msg.title, '工具轮回复')
  assert.deepEqual(replies[0].msg.forward, ['[第1轮 · Gemini] 哦，我先查一下'])
})

test('开关关闭时不外发', async () => {
  Config.forwardToolRoundText = false
  const { e, replies } = createEvent()
  await sendToolRoundTextForwardMsg(e, [{ text: '哦，我先查一下', provider: 'Gemini', round: 1 }], '工具轮回复')
  assert.equal(replies.length, 0)
  Config.forwardToolRoundText = true
})

test('屏蔽词命中时不外发', async () => {
  Config.blockWords = ['敏感']
  const { e, replies } = createEvent()
  await sendToolRoundTextForwardMsg(e, [{ text: '这是敏感内容', provider: 'Gemini', round: 1 }], '工具轮回复')
  assert.equal(replies.length, 0)
  Config.blockWords = []
})

test('合并转发失败时降级为提示而非裸发正文', async () => {
  const original = forwardImpl
  forwardImpl = async () => { throw new Error('fixture failure') }
  const { e, replies } = createEvent()
  await sendToolRoundTextForwardMsg(e, [{ text: '哦，我先查一下', provider: 'Gemini', round: 1 }], '工具轮回复')
  forwardImpl = original
  assert.equal(replies.length, 1)
  assert.equal(typeof replies[0].msg, 'string')
  assert.ok(replies[0].msg.includes('合并转发发送失败'))
  assert.ok(!replies[0].msg.includes('我先查一下'))
})

test('空输入与无事件对象时静默返回', async () => {
  const { e, replies } = createEvent()
  await sendToolRoundTextForwardMsg(e, [], '工具轮回复')
  await sendToolRoundTextForwardMsg(undefined, [{ text: 'x' }], '工具轮回复')
  await sendToolRoundTextForwardMsg(e, [{ text: '   ' }], '工具轮回复')
  await sendToolRoundTextForwardMsg(e, [{ round: 1 }], '工具轮回复')
  assert.equal(replies.length, 0)
})
