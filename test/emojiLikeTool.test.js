/**
 * 贴表情工具（EmojiLikeTool）测试
 *
 * 覆盖点：
 *  1. `face` 精确命中：点名哪个表情就贴哪个 id，且文案不冒充情绪随机。
 *  2. `emotion` 仍走随机池：枚举里每个值都能贴成功，贴出的是数字 id。
 *  3. 名字写错时的兜底：`face` 不在目录里但 `emotion` 合法 → 继续贴 + 在工具返回里说明回落，
 *     不白耗一轮；两条都不成立才返回 `Error: …`，且一个接口都不碰。
 *  4. 枚举与数据不脱节：schema 的 enum 逐个真跑一遍（写错键名会直接失败），12 个表情名映射到 12 个不同 id。
 *  5. 目标消息顺序：显式 messageId > 引用消息 > 当前消息。
 *  6. 适配器不支持时给可操作的提示，而不是抛出。
 *
 * 运行：npm run test:tools（或 node --test test/emojiLikeTool.test.js）
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// TRSS 运行环境中 logger 是全局变量；测试环境提供 stub
if (!globalThis.logger) {
  globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, trace() {}, log() {} }
}

const { EmojiLikeTool } = await import('../utils/tools/EmojiLikeTool.js')

/* ================= 测试桩 ================= */

function makeEvent({ messageId = 'm-current', sourceMessageId, supports = true } = {}) {
  const calls = []
  const e = {
    message_id: messageId,
    source_message_id: sourceMessageId,
    group: supports ? { setEmojiLike: async (mid, id) => { calls.push([mid, id]) } } : undefined
  }
  return { e, calls }
}

const tool = new EmojiLikeTool()

/* ================= 用例 ================= */

describe('EmojiLikeTool', () => {
  test('face 点名：贴的就是目录里的 id', async () => {
    const { e, calls } = makeEvent()
    const result = await tool.func({ face: '玫瑰' }, e)

    assert.deepEqual(calls, [['m-current', 63]])
    assert.match(result, /face "玫瑰"/)
    assert.match(result, /<EMPTY>/)
    assert.doesNotMatch(result, /fell back/)
  })

  test('face 优先于 emotion：同时给两个也不随机', async () => {
    const { e, calls } = makeEvent()
    await tool.func({ face: '握手', emotion: 'sad' }, e)

    assert.deepEqual(calls, [['m-current', 78]])
  })

  test('未知 face + 合法 emotion：继续贴并说明回落', async () => {
    const { e, calls } = makeEvent()
    const result = await tool.func({ face: '滑稽', emotion: 'happy' }, e)

    assert.equal(calls.length, 1)
    assert.equal(typeof calls[0][1], 'number')
    assert.match(result, /fell back to emotion "happy"/)
  })

  test('两条都无效：返回 Error 且不调用接口', async () => {
    const { e, calls } = makeEvent()
    const result = await tool.func({ face: '滑稽', emotion: 'hapy' }, e)

    assert.match(result, /^Error: /)
    assert.deepEqual(calls, [])
  })

  test('什么都不给：返回 Error 且不调用接口', async () => {
    const { e, calls } = makeEvent()
    const result = await tool.func({}, e)

    assert.match(result, /^Error: /)
    assert.deepEqual(calls, [])
  })

  test('emotion 枚举逐个可贴，且落在数字 id 上', async () => {
    for (const emotion of tool.parameters.properties.emotion.enum) {
      const { e, calls } = makeEvent()
      const result = await tool.func({ emotion }, e)

      assert.deepEqual(calls.length, 1, `${emotion} 应贴出一个表情`)
      assert.equal(typeof calls[0][1], 'number')
      assert.match(result, /Successfully reacted/)
    }
  })

  test('face 枚举逐个可贴，12 个名字对应 12 个不同 id', async () => {
    const ids = new Set()
    for (const face of tool.parameters.properties.face.enum) {
      const { e, calls } = makeEvent()
      await tool.func({ face }, e)

      assert.equal(calls.length, 1, `${face} 应贴出一个表情`)
      ids.add(calls[0][1])
    }
    assert.equal(ids.size, tool.parameters.properties.face.enum.length)
  })

  test('目标消息：显式参数 > 引用消息 > 当前消息', async () => {
    const explicit = makeEvent({ sourceMessageId: 'm-source' })
    await tool.func({ emotion: 'like', messageId: 'm-given' }, explicit.e)
    assert.equal(explicit.calls[0][0], 'm-given')

    const quoted = makeEvent({ sourceMessageId: 'm-source' })
    await tool.func({ emotion: 'like' }, quoted.e)
    assert.equal(quoted.calls[0][0], 'm-source')

    const current = makeEvent()
    await tool.func({ emotion: 'like' }, current.e)
    assert.equal(current.calls[0][0], 'm-current')
  })

  test('原型链上的键不算有效参数', async () => {
    const { e, calls } = makeEvent()
    const result = await tool.func({ face: 'constructor', emotion: 'toString' }, e)

    assert.match(result, /^Error: /)
    assert.deepEqual(calls, [])
  })

  test('适配器不支持贴表情：给提示而不是抛出', async () => {
    const { e } = makeEvent({ supports: false })
    const result = await tool.func({ emotion: 'happy' }, e)

    assert.match(result, /does not support emoji reactions/)
  })

  test('贴失败与「不支持」区分开：接口报错要露出原因', async () => {
    const { e } = makeEvent()
    e.group.setEmojiLike = async () => { throw new Error('message not found') }
    const result = await tool.func({ emotion: 'happy' }, e)

    assert.match(result, /^Error: Failed to react with emoji: message not found/)
    assert.doesNotMatch(result, /does not support/)
  })
})
