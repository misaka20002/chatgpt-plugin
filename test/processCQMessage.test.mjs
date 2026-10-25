/**
 * 输入侧 CQ 清理：工具开启时保留合并转发的 CQ 码，其余行为不变。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.logger = { info() {}, warn() {}, error() {}, mark() {} }

const { processCQMessage } = await import('../utils/cqCode.js')

const RAW = '[CQ:at,qq=10000] 看这个 [CQ:forward,id=abc123] [CQ:image,file=x.jpg]'

test('默认（工具关闭）仍移除 forward 在内的所有非 at CQ 码', () => {
  assert.equal(processCQMessage(RAW, '10000'), '看这个')
})

test('工具开启时保留 forward 的 CQ 码', () => {
  assert.equal(
    processCQMessage(RAW, '10000', { keepForward: true }),
    '看这个 [CQ:forward,id=abc123]'
  )
})

test('保留 forward 不影响 at 的既有处理', () => {
  const raw = '[CQ:at,qq=20000] 你好 [CQ:forward,id=abc]'
  assert.equal(processCQMessage(raw, '10000', { keepForward: true }), '[CQ:at,qq=20000] 你好 [CQ:forward,id=abc]')
})
