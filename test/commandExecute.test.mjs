import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { executeCommand, findRuleByCall } from '../utils/commandMap/execute.js'

/**
 * 代执行（真实调用链，但插件与加载器都是假的）。
 *
 * 要钉住的是三件事：写法不存在就不执行、权限由框架判而不是我们判、
 * 伪造消息时身份字段一个都不许变。
 */

const calls = []

class FakePlugin {
  constructor (e) {
    this.e = e
    this.rule = [{ reg: /^#签到$/, fnc: 'sign' }]
  }

  async sign (e) {
    calls.push({ msg: e.msg, text: e.message?.[0]?.text, isMaster: e.isMaster, user: e.sender?.user_id })
    await e.reply('签到成功')
  }
}

function makeLoader ({ permission = true } = {}) {
  return {
    priority: [
      { key: 'sign', plugin: { name: '签到插件', rule: [{ reg: /^#签到$/, fnc: 'sign' }] }, class: FakePlugin }
    ],
    filtEvent: () => true,
    filtPermission: () => permission
  }
}

function makeEvent () {
  const replies = []
  return {
    msg: '帮我签个到',
    message: [{ type: 'text', text: '帮我签个到' }],
    isMaster: false,
    sender: { user_id: 10001 },
    group_id: 555,
    reply: async text => replies.push(text),
    replies
  }
}

describe('存在性校验', () => {
  test('能匹配到具体规则', () => {
    const hit = findRuleByCall('#签到', { loader: makeLoader(), e: makeEvent() })
    assert.equal(hit.rule.fnc, 'sign')
  })

  test('写法不存在时返回 null，不猜任何兜底', () => {
    assert.equal(findRuleByCall('#不存在的指令', { loader: makeLoader(), e: makeEvent() }), null)
  })

  test('加载器不可用时返回 null 而不是抛异常', () => {
    assert.equal(findRuleByCall('#签到', { loader: null }), null)
  })
})

describe('执行', () => {
  test('改文本、不改身份，并调用到处理函数', async () => {
    calls.length = 0
    const e = makeEvent()
    const result = await executeCommand(e, '#签到', { loader: makeLoader() })

    assert.equal(result.ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].msg, '#签到')
    assert.equal(calls[0].text, '#签到')
    assert.equal(calls[0].isMaster, false)
    assert.equal(calls[0].user, 10001)
    assert.deepEqual(e.replies, ['签到成功'])
  })

  test('写法不存在时不执行任何处理函数', async () => {
    calls.length = 0
    const result = await executeCommand(makeEvent(), '#不存在的指令', { loader: makeLoader() })

    assert.deepEqual(result, { ok: false, reason: 'not-found' })
    assert.equal(calls.length, 0)
  })

  test('框架拒绝权限时不执行，并把拒绝交给框架自己回', async () => {
    calls.length = 0
    const result = await executeCommand(makeEvent(), '#签到', { loader: makeLoader({ permission: false }) })

    assert.deepEqual(result, { ok: false, reason: 'no-permission' })
    assert.equal(calls.length, 0)
  })

  test('每次执行留一条可追溯的日志', async () => {
    const marks = []
    const original = globalThis.logger
    globalThis.logger = { mark: text => marks.push(text), warn: () => {} }
    try {
      await executeCommand(makeEvent(), '#签到', { loader: makeLoader() })
    } finally {
      globalThis.logger = original
    }
    assert.equal(marks.length, 1)
    assert.match(marks[0], /执行 #签到 by 10001 in 555/)
  })
})
