/**
 * Bot 响应白名单闸（utils/botReplyWhitelist.js）
 *
 * 空列表 = 全部放行（老配置升级后无感）；非空 = 只放行命中的账号；
 * 取不到账号身份时 fail-open——拦下来会让整个插件对所有消息静默，代价高于多号抢答。
 *
 * 配置只在内存里替换，不落盘：Config.getConfig() 返回的就是运行中的那个对象。
 *
 * 运行：npm run test:config（或 node --test test/botReplyWhitelist.test.mjs）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const logs = []
globalThis.logger = {
  info: (...args) => logs.push(args.join(' ')),
  mark() {},
  warn() {},
  debug() {},
  error() {}
}
globalThis.redis = { get: async () => null }

const { Config } = await import('../utils/config.js')
const { eventBotId, isBotReplyAllowed } = await import('../utils/botReplyWhitelist.js')

function withWhitelist(list, run) {
  const config = Config.getConfig()
  const original = config.botReplyWhitelist
  config.botReplyWhitelist = list
  try {
    return run()
  } finally {
    config.botReplyWhitelist = original
  }
}

const groupEvent = fields => ({ isGroup: true, group_id: 10001, ...fields })

test('空列表表示未启用：所有账号都放行，且不写日志', () => {
  logs.length = 0
  withWhitelist([], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 111 })), true)
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 })), true)
  })
  assert.deepEqual(logs, [])
})

test('命中的账号放行', () => {
  logs.length = 0
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 111 }), { label: '对话' }), true)
  })
  assert.deepEqual(logs, [])
})

test('配置里存成数字也照样命中（手工改过 config.json 的情况）', () => {
  withWhitelist([111], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 111 })), true)
  })
})

test('未命中的账号被拦下，并留下带账号的日志', () => {
  logs.length = 0
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 }), { label: '对话' }), false)
  })
  assert.equal(logs.length, 1)
  assert.match(logs[0], /^\[ChatGPT\]\[Bot响应白名单\]/)
  assert.match(logs[0], /222/)
})

test('self_id 缺失时退到 bot.uin 判定', () => {
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ bot: { uin: 111 } })), true)
    assert.equal(isBotReplyAllowed(groupEvent({ bot: { uin: 222 } })), false)
  })
})

test('取不到账号身份时放行（fail-open），并留一条带前缀的线索', () => {
  logs.length = 0
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({})), true)
  })
  assert.equal(logs.length, 1)
  assert.match(logs[0], /^\[ChatGPT\]\[Bot响应白名单\]/)
})

test('silent 不写日志：自主回复的准入对每条群消息都会跑', () => {
  logs.length = 0
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 }), { silent: true }), false)
    assert.equal(isBotReplyAllowed(groupEvent({}), { silent: true }), true)
  })
  assert.deepEqual(logs, [])
})

test('只有空白条目的列表按未启用处理，不会把全插件静默掉', () => {
  withWhitelist(['', '   '], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 })), true)
  })
})

test('非数组（手工改坏的配置）按未启用处理', () => {
  withWhitelist('111', () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 })), true)
  })
})

test('eventBotId 优先 self_id，其次 bot.uin，都没有时为空串', () => {
  assert.equal(eventBotId({ self_id: 111, bot: { uin: 222 } }), '111')
  assert.equal(eventBotId({ bot: { uin: 222 } }), '222')
  assert.equal(eventBotId({}), '')
})
