import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractThinkTags, isToolMonologue, normalizeModelText } from '../utils/thinking.js'

test('extractThinkTags 剥离 <think>/<thinking> 标签并保序', () => {
  assert.deepEqual(extractThinkTags('<think>想一想</think>正文'), { text: '正文', thinking: '想一想' })
  assert.deepEqual(extractThinkTags('<thinking>甲</thinking>中间<thinking>乙</thinking>后面'), { text: '中间后面', thinking: '甲\n乙' })
  assert.deepEqual(extractThinkTags('没有标签'), { text: '没有标签', thinking: '' })
})

test('extractThinkTags 处理未闭合与孤立标签', () => {
  assert.deepEqual(extractThinkTags('正文<think>没写完'), { text: '正文', thinking: '没写完' })
  assert.deepEqual(extractThinkTags('正文</think>继续'), { text: '正文继续', thinking: '' })
  assert.deepEqual(extractThinkTags('<think>  </think>正文'), { text: '正文', thinking: '' })
  assert.deepEqual(extractThinkTags(undefined), { text: '', thinking: '' })
  assert.deepEqual(extractThinkTags(''), { text: '', thinking: '' })
})

test('isToolMonologue 命中英文自述句式', () => {
  assert.equal(isToolMonologue("wait, I should call recognize_media ... Let's call recognize_media!", ['recognize_media']), true)
  assert.equal(isToolMonologue('Let me check that.', []), true)
  assert.equal(isToolMonologue('I should search for more details', []), true)
})

test('isToolMonologue 命中正文点名的真实工具名', () => {
  assert.equal(isToolMonologue('现在轮到 lookup 出场', ['lookup']), true)
  // 词边界匹配：send 不应命中 sending 这类词，避免误杀正常工具轮正文
  assert.equal(isToolMonologue('我正在 sending 一个请求', ['send']), false)
})

test('isToolMonologue 不误杀中文前置语与普通回复，但识别显式工具动词', () => {
  assert.equal(isToolMonologue('稍等一下，我查查', []), false)
  assert.equal(isToolMonologue('好的，我马上告诉你结果', []), false)
  assert.equal(isToolMonologue('我来调用查询工具查一下', []), true)
})

test('normalizeModelText 仅在工具轮重归类独白，标签剥离始终生效', () => {
  const monologue = normalizeModelText("wait, I should call lookup ... Let's call lookup!", { toolNames: ['lookup'], inToolRound: true })
  assert.equal(monologue.text, '')
  assert.match(monologue.thinking, /Let's call lookup/)

  const normal = normalizeModelText('我先查一下', { toolNames: ['lookup'], inToolRound: true })
  assert.deepEqual(normal, { text: '我先查一下', thinking: '' })

  const notToolRound = normalizeModelText('wait, I should call lookup', { toolNames: ['lookup'], inToolRound: false })
  assert.deepEqual(notToolRound, { text: 'wait, I should call lookup', thinking: '' })

  const tagged = normalizeModelText('<think>想想</think>好的', { inToolRound: true })
  assert.deepEqual(tagged, { text: '好的', thinking: '想想' })
})
