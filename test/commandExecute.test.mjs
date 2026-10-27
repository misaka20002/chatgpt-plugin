import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { executeCommand, findRuleByCall } from '../utils/commandMap/execute.js'
import { makeTrssEvent, makeFailingMemberTarget } from './helpers/trssEvent.mjs'

/**
 * 代执行（真实调用链，但插件与加载器都是假的）。
 *
 * 要钉住的是四件事：写法不存在就不执行、权限由框架判而不是我们判、
 * 执行完原事件一个字段都不许变、以及「插件返回 false」要和框架一样换下一条规则。
 *
 * 假加载器的 deal() 照抄框架的语义：先用消息段重建 e.msg，再按优先级找匹配规则，
 * 插件返回 false 就继续下一条。
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

function makeLoader ({ permission = true, rules = null } = {}) {
  const priority = rules || [
    { key: 'sign', plugin: { name: '签到插件', rule: [{ reg: /^#签到$/, fnc: 'sign' }] }, class: FakePlugin }
  ]

  const loader = {
    priority,
    filtEvent: () => true,
    filtPermission: () => permission,
    async deal (e) {
      // 框架的 dealEvent：e.msg 由消息段重建
      e.msg = ''
      for (const seg of e.message || []) {
        if (seg.type === 'text') e.msg += seg.text
      }
      // 框架的 accept 阶段：先让插件认领/规范化消息
      for (const item of priority) {
        const proto = item.class?.prototype
        if (!proto || typeof proto.accept !== 'function') continue
        const res = await Object.assign(new item.class(e), { e }).accept(e)
        if (res === 'return') return
        if (res) break
      }
      for (const item of priority) {
        for (const rule of item.plugin.rule) {
          if (!rule.reg.test(e.msg)) continue
          if (!loader.filtPermission(e, rule)) {
            e.reply('暂无权限，只有主人才能操作')
            return
          }
          const instance = Object.assign(new item.class(e), { e })
          const res = await instance[rule.fnc](e)
          if (res === false) continue
          return
        }
      }
    }
  }
  return loader
}

function makeEvent ({ isMaster = false } = {}) {
  // 身份字段由共享夹具按宿主写法定义（不可写、不可配置）
  return makeTrssEvent({ isMaster, msg: '帮我签个到', message: [{ type: 'text', text: '帮我签个到' }] })
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

  test('匹配一切的空正则不算「本机有这条指令」', () => {
    const loader = makeLoader({
      rules: [{ key: 'x', plugin: { name: 'X', rule: [{ reg: /(?:)/, fnc: 'run' }] }, class: FakePlugin }]
    })
    assert.equal(findRuleByCall('#签到', { loader, e: makeEvent() }), null)
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

  test('消息第一段是 at 时，指令文本仍然写对', async () => {
    calls.length = 0
    const e = makeEvent()
    // 真实群里第一条消息段通常是 at：框架不看 at 段的 text
    e.message = [{ type: 'at', qq: '591272224' }, { type: 'text', text: '给他点个赞' }]
    const result = await executeCommand(e, '#签到', { loader: makeLoader() })

    assert.equal(result.ok, true)
    assert.equal(calls[0].msg, '#签到')
  })

  test('写法不存在时不执行任何处理函数', async () => {
    calls.length = 0
    const result = await executeCommand(makeEvent(), '#不存在的指令', { loader: makeLoader() })

    assert.deepEqual(result, { ok: false, reason: 'not-found' })
    assert.equal(calls.length, 0)
  })

  test('以他人身份执行时，权限按被 @ 者算（主人身份不得绕过）', async () => {
    calls.length = 0
    // 只允许主人：切换身份后 isMaster 必为 false，所以这条必须被拒
    const loader = makeLoader({ permission: false })
    const e = makeEvent({ isMaster: true })

    const result = await executeCommand(e, '#签到', {
      loader,
      target: { userId: 20002, member: { is_admin: false, is_owner: false } }
    })

    assert.equal(result.ok, false)
    assert.equal(calls.length, 0, '被 @ 的普通成员不能借主人身份执行')
    assert.equal(e.isMaster, true, '执行后必须还原发起者身份')
    assert.equal(e.sender.user_id, 10001)
  })

  test('框架拒绝权限时不执行，并把拒绝交给框架自己回', async () => {
    calls.length = 0
    const e = makeEvent()
    const result = await executeCommand(e, '#签到', { loader: makeLoader({ permission: false }) })

    assert.equal(result.ok, false)
    assert.equal(calls.length, 0)
    assert.deepEqual(e.replies, ['暂无权限，只有主人才能操作'])
  })

  test('插件抛错时如实返回，不谎报成功', async () => {
    class Broken { constructor (e) { this.e = e } async panic () { throw new Error('render 崩了') } }
    const loader = makeLoader({
      rules: [{ key: 'x', plugin: { name: 'X', rule: [{ reg: /^#崩$/, fnc: 'panic' }] }, class: Broken }]
    })
    globalThis.logger = { mark: () => {}, warn: () => {} }
    const result = await executeCommand(makeEvent(), '#崩', { loader })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'handler-error')
    assert.match(result.message, /render 崩了/)
  })

  test('插件返回 false 时像框架那样交给下一条匹配规则', async () => {
    const order = []
    class Refuse { async run () { order.push('refuse'); return false } }
    class Accept { async run (e) { order.push('accept'); await e.reply('接住了') } }
    const loader = makeLoader({
      rules: [
        { key: 'a', plugin: { name: 'A', rule: [{ reg: /^#点赞$/, fnc: 'run' }] }, class: Refuse },
        { key: 'b', plugin: { name: 'B', rule: [{ reg: /^#点赞$/, fnc: 'run' }] }, class: Accept }
      ]
    })
    const e = makeEvent()
    const result = await executeCommand(e, '#点赞', { loader })

    assert.deepEqual(order, ['refuse', 'accept'])
    assert.equal(result.ok, true)
    assert.deepEqual(e.replies, ['接住了'])
  })

  test('所有插件都拒绝时如实返回失败，不谎报成功', async () => {
    class Refuse { async run () { return false } }
    const loader = makeLoader({
      rules: [{ key: 'a', plugin: { name: 'A', rule: [{ reg: /^#点赞$/, fnc: 'run' }] }, class: Refuse }]
    })
    const result = await executeCommand(makeEvent(), '#点赞', { loader })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no-effect')
  })

  test('回话发送失败时不算成功', async () => {
    class SendFail {
      constructor (e) {
        this.e = e
        this.rule = [{ reg: /^#崩$/, fnc: 'run' }]
      }

      async run (e) { await e.reply('给你赞了10下，记得回我') }
    }
    const loader = makeLoader({
      rules: [{ key: 'x', plugin: { name: 'X', rule: [{ reg: /^#崩$/, fnc: 'run' }] }, class: SendFail }]
    })
    const e = makeEvent()
    // 框架的 reply 把发送失败包成 { error: [...] }，没有 message_id
    e.reply = async () => ({ error: [new Error('群消息发送失败')] })

    const result = await executeCommand(e, '#崩', { loader })
    assert.equal(result.ok, false, '话没送到群里就不能报成功')
    assert.equal(result.reason, 'no-effect')
  })

  test('读取被 @ 者资料失败时如实返回，不裸抛到上层', async () => {
    const target = makeFailingMemberTarget(20002, new Error('群成员查询失败'))

    const result = await executeCommand(makeEvent(), '#签到', { loader: makeLoader(), target })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'handler-error')
    assert.match(result.message, /群成员查询失败/)
  })
})

/**
 * accept 阶段的劫持（2026-10-28 线上真实故障）。
 *
 * 框架 deal() 的顺序是「先 accept，再按规则匹配」。accept 里的插件会改写 e.msg，
 * 把消息换成自己的规范写法。线上「点赞」是角色「班尼特」的别名，genshin 的 role.js
 * 看到就把「#点赞」改写成「#角色详情」，结果点赞插件根本没被叫醒。
 */
describe('accept 阶段不改写代执行的指令', () => {
  class Hijacker {
    constructor (e) {
      this.e = e
      this.rule = []
    }

    // 复刻 genshin/apps/role.js 的 accept：认领消息并换成自己的写法
    async accept (e) {
      if (!/^#(.*)$/.test(e.msg)) return
      e.msg = '#角色详情'
      return true
    }
  }

  class ZanPlugin {
    constructor (e) {
      this.e = e
      this.rule = [{ reg: /^#?((我要|给我)?(资料卡)?(点赞))$/, fnc: 'thumbUp' }]
    }

    async thumbUp (e) {
      calls.push({ msg: e.msg })
      await e.reply('给你赞了10下，记得回我')
    }
  }

  test('被 accept 改写指令时，规则匹配仍然拿到我们指定的写法', async () => {
    calls.length = 0
    const loader = makeLoader({
      rules: [
        { key: 'genshin', plugin: { name: 'genshin', rule: [] }, class: Hijacker },
        { key: 'yenai', plugin: { name: '椰奶点赞', rule: [{ reg: /^#?((我要|给我)?(资料卡)?(点赞))$/, fnc: 'thumbUp' }] }, class: ZanPlugin }
      ]
    })
    const e = makeEvent()
    const result = await executeCommand(e, '#点赞', { loader })

    assert.equal(result.ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].msg, '#点赞', '插件看到的必须是原指令，不是被改写后的')
    assert.deepEqual(e.replies, ['给你赞了10下，记得回我'])
  })

  test('代执行结束后原事件被还原', async () => {
    calls.length = 0
    const loader = makeLoader({
      rules: [{ key: 'yenai', plugin: { name: '椰奶点赞', rule: [{ reg: /^#点赞$/, fnc: 'thumbUp' }] }, class: ZanPlugin }]
    })
    const e = makeEvent()
    e.message = [{ type: 'at', qq: '591272224' }, { type: 'text', text: '给他点个赞' }]

    await executeCommand(e, '#点赞', { loader })

    assert.equal(e.msg, '帮我签个到')
    assert.deepEqual(e.message, [{ type: 'at', qq: '591272224' }, { type: 'text', text: '给他点个赞' }])
  })

  test('代执行结束后 accept 被还原，其它消息不受影响', async () => {
    const original = Hijacker.prototype.accept
    const loader = makeLoader({
      rules: [{ key: 'genshin', plugin: { name: 'genshin', rule: [] }, class: Hijacker }]
    })
    await executeCommand(makeEvent(), '#点赞', { loader })
    assert.equal(Hijacker.prototype.accept, original, 'accept 必须还原，不能污染全局')
  })
})
