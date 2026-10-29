/**
 * 代执行：把指令交回框架派发。
 *
 * 测的是「会不会派发」与「派发出去的事件长什么样」，不是「指令执行结果」——
 * 后者是插件与框架的责任，这里只保证不越权、不擅自动手、不臆造。
 *
 * 运行：npm run test:command-map
 */
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

if (!globalThis.logger) {
  globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, trace() {}, log() {} }
}

const { loadEntries, resolveCommand, UPDATE_COMMAND } = await import('../utils/capability/map.js')
const { CommandRunTool, setCommandDispatcher } = await import('../utils/tools/CommandRunTool.js')

let cwd
let tmp

before(() => {
  cwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'command-run-'))
  process.chdir(tmp)
})

after(() => {
  process.chdir(cwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(path.join(tmp, 'data'), { recursive: true, force: true })
  setCommandDispatcher(null)
})

function writeMap(key, plugin, instructions) {
  const dir = path.join(tmp, 'data', 'chatgpt', 'maps', encodeURIComponent(key))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify({
    meta: { key },
    map: { schema: 2, plugin: { key, ...plugin }, instructions }
  }), 'utf8')
}

function seed() {
  writeMap('sign', { display: '签到插件', summary: '每日签到' }, [
    { command: '#签到', aliases: ['#打卡'], summary: '给当前群签到', risk: 'w', permission: 'master' },
    { command: '#签到排名', summary: '看本月签到榜', risk: 'q' },
    { command: '#查积分', aliases: ['#积分'], summary: '查自己的积分', risk: 'q' },
    { command: '#签到设置', summary: '改签到设置', risk: 'w', permission: 'master' },

  ])
  writeMap('music', { display: '点歌插件', summary: '点歌' }, [
    { command: '#点歌', summary: '按关键词点歌', risk: 'q' },
    { command: '#点歌 起风了', summary: '直接点这首', risk: 'q' }
  ])
}

/** 记录派发出去的事件；result 决定派发器的返回值，传 Error 则抛出 */
function spyDispatcher(result = true) {
  const calls = []
  setCommandDispatcher(async event => {
    // 代执行借用原事件、执行完还原，所以这里要拍派发瞬间的快照
    calls.push({
      msg: event.msg,
      raw_message: event.raw_message,
      message: JSON.parse(JSON.stringify(event.message || [])),
      only_reply_at: event.only_reply_at,
      isMaster: event.isMaster,
      group_id: event.group_id,
      user_id: event.user_id,
      __commandMapNested: event.__commandMapNested
    })
    if (result instanceof Error) throw result
    if (result === false) return false
    // 真实插件办成事会自己发消息；不回话的派发在工具眼里等于没办成
    await event.reply('插件回话')
    return result
  })
  return calls
}

/** 派发出去的最后一段文本，也就是真正要执行的指令 */
const lastText = call => (call.message.at(-1) || {}).text

const asker = (over = {}) => ({
  isMaster: false,
  isGroup: true,
  group_id: 'g-1',
  user_id: 1001,
  message_id: 'm-1',
  msg: '帮我签个到',
  sender: { card: '小明', nickname: '小明', user_id: 1001 },
  reply: async () => {},
  ...over
})

/** 用户又发了一条消息（确认发生在下一轮） */
const nextTurn = over => asker({ message_id: 'm-2', msg: '好的', ...over })

const tool = new CommandRunTool()

describe('解析写法', () => {
  test('整串精确命中', () => {
    seed()
    const { entry, args } = resolveCommand(loadEntries().entries, '#签到排名')

    assert.equal(entry.command, '#签到排名')
    assert.equal(args, '')
  })

  test('带参数时命中前面的写法，参数原样留下', () => {
    seed()
    const { entry, args } = resolveCommand(loadEntries().entries, '#查积分 2')

    assert.equal(entry.command, '#查积分')
    assert.equal(args, '2')
  })

  test('多条前缀都能对上时取最长的那条', () => {
    seed()
    const { entry, args } = resolveCommand(loadEntries().entries, '#点歌 起风了 陈奕迅')

    assert.equal(entry.command, '#点歌 起风了')
    assert.equal(args, '陈奕迅')
  })

  test('只报别名时用正式写法', () => {
    seed()
    const { entry } = resolveCommand(loadEntries().entries, '#积分')

    assert.equal(entry.command, '#查积分')
  })

  test('两条指令同名时并成一条，档位取最严的', () => {
    seed()
    writeMap('other', { display: '另一个签到' }, [{ command: '#签到', summary: '别处的签到', risk: 'q' }])

    const { entry } = resolveCommand(loadEntries().entries, '#签到')

    // 本来的 #签到 是 master + 有副作用，另一个是只读；合并后必须按最严的算
    assert.equal(entry.command, '#签到')
    assert.equal(entry.risk, 'w')
    assert.equal(entry.permission, 'master')
  })

  test('对不上就明说没找到', () => {
    seed()
    const { entry, reason } = resolveCommand(loadEntries().entries, '#造火箭')

    assert.equal(entry, null)
    assert.equal(reason, 'not-found')
  })

  test('空串不解析', () => {
    seed()
    assert.equal(resolveCommand(loadEntries().entries, '  ').reason, 'empty')
  })
})

describe('代执行', () => {
  test('本地没有地图时不做任何事，并指向更新指令', async () => {
    const calls = spyDispatcher()

    const reply = await tool.func({ command: '#签到' }, asker())

    assert.ok(reply.includes(UPDATE_COMMAND))
    assert.equal(calls.length, 0)
  })

  test('缺写法时要求补全', async () => {
    seed()
    const calls = spyDispatcher()

    const reply = await tool.func({}, asker())

    assert.match(reply, /完整写法/)
    assert.equal(calls.length, 0)
  })

  test('只读指令直接派发，事件以提问者身份、带着原会话', async () => {
    seed()
    const calls = spyDispatcher()

    const reply = await tool.func({ command: '#签到排名' }, asker())

    assert.equal(calls.length, 1)
    assert.equal(lastText(calls[0]), '#签到排名')
    // 框架会用 message 段重建 msg，所以这里只看段内容
    assert.equal(calls[0].group_id, 'g-1')
    assert.equal(calls[0].user_id, 1001)
    assert.equal(calls[0].isMaster, false)
    // 派发出去的事件必须带标记，避免嵌套回合再注册代执行
    assert.equal(calls[0].__commandMapNested, true)
    // 只关注主动 at 的群策略会拦下代执行：这条标记是它不被拦的前提
    assert.equal(calls[0].only_reply_at, true)
    assert.match(reply, /执行成功/)
  })

  test('一个别名指向不同写法时列出候选、一条都不执行', async () => {
    seed()
    writeMap('other', { display: '另一个打卡' }, [{ command: '#打打卡', aliases: ['#打卡'], summary: '别处的打卡', risk: 'q' }])
    const calls = spyDispatcher()

    const reply = await tool.func({ command: '#打卡' }, asker())

    assert.equal(calls.length, 0)
    assert.match(reply, /不止一条/)
    assert.match(reply, /#签到/)
    assert.match(reply, /#打打卡/)
  })

  test('没命中时说明没找到，不执行也不编造', async () => {
    seed()
    const calls = spyDispatcher()

    const reply = await tool.func({ command: '#造火箭' }, asker())

    assert.equal(calls.length, 0)
    assert.match(reply, /^Error: 没找到/)
    assert.match(reply, /什么都没执行/)
  })

  test('非主人也照样派发，权限交给框架与插件', async () => {
    seed()
    const calls = spyDispatcher()

    const reply = await tool.func({ command: '#签到' }, asker({ isMaster: false }))

    // 工具不预判权限：用提问者本人身份派发出去，够不够权限由框架判、由插件回话
    assert.equal(calls.length, 1)
    assert.equal(calls[0].isMaster, false)
    assert.ok(!reply.includes('主人专用'))
  })

  test('点赞签到这类直接执行，不问确认', async () => {
    seed()
    const calls = spyDispatcher()

    const reply = await tool.func({ command: '#签到' }, asker({ isMaster: true }))

    assert.equal(calls.length, 1)
    assert.equal(lastText(calls[0]), '#签到')
    assert.match(reply, /执行成功/)
    assert.ok(!reply.includes('confirm=true'))
  })

  test('回话发送失败不算成功', async () => {
    seed()
    setCommandDispatcher(async event => {
      await event.reply('图没发出去')
      return true
    })

    // 框架把发送失败包成 { error: [...] }
    const reply = await tool.func({ command: '#签到' }, asker({
      isMaster: true,
      reply: async () => ({ error: ['send failed'] })
    }))

    assert.match(reply, /^Error: /)
    assert.match(reply, /一个字都没回/)
  })

  test('框架回「暂无权限」不算成功', async () => {
    seed()
    setCommandDispatcher(async event => {
      // 框架 filtPermission 拒绝时的固定话术：这不是插件干活的回话
      await event.reply('暂无权限，只有群主才能操作')
      return true
    })

    const reply = await tool.func({ command: '#签到' }, asker({ isMaster: false }))

    assert.match(reply, /^Error: /)
    assert.match(reply, /权限/)
  })

  test('派发出去的事件保留 at 段', async () => {
    seed()
    const calls = spyDispatcher()

    await tool.func({ command: '#签到' }, asker({
      message: [{ type: 'at', qq: '10000' }, { type: 'text', text: '帮我签到' }]
    }))

    // 框架会用消息段重建 e.msg，at 段丢了会让「只回应 at」的规则匹配不上
    assert.equal(calls[0].message[0].type, 'at')
    assert.equal(calls[0].message.at(-1).text, '#签到')
  })

  test('派发了但插件没回话，如实说没办成', async () => {
    seed()
    setCommandDispatcher(async () => true)

    const reply = await tool.func({ command: '#签到' }, asker({ isMaster: true }))

    assert.match(reply, /^Error: /)
    assert.match(reply, /一个字都没回/)
  })

  test('插件走 group.sendMsg 发图，同样算办成', async () => {
    seed()
    // 不少插件绕开 e.reply 直接往 group 上发，只数 reply 会把这种当成没回话
    let sent = 0
    setCommandDispatcher(async event => {
      await event.group.sendMsg([{ type: 'image', file: 'sign.png' }])
      return true
    })

    const reply = await tool.func({ command: '#签到' }, asker({
      group: { sendMsg: async () => { sent += 1; return { message_id: 1 } } }
    }))

    assert.equal(sent, 1)
    assert.match(reply, /执行成功/)
  })

  test('两个出口各发一条时如实数两条', async () => {
    seed()
    setCommandDispatcher(async event => {
      await event.reply('签到成功')
      await event.group.sendMsg('明日再来')
      return true
    })

    const reply = await tool.func({ command: '#签到' }, asker({
      group: { sendMsg: async () => ({ message_id: 2 }) }
    }))

    assert.match(reply, /2 条/)
  })

  test('包裹不落在宿主共用的群对象上', async () => {
    seed()
    // 宿主的 Group 实例按群缓存、跨事件共用：改它会串台
    const group = { sendMsg: async () => ({ message_id: 4 }) }
    const before = group.sendMsg
    let seen = null
    setCommandDispatcher(async event => {
      seen = event.group
      await event.group.sendMsg('签到图')
      return true
    })

    await tool.func({ command: '#签到' }, asker({ group }))

    assert.equal(group.sendMsg, before)
    assert.equal(typeof seen?.sendMsg, 'function')
  })

  test('派发结束后事件与群对象都还原', async () => {
    seed()
    const group = { sendMsg: async () => ({ message_id: 5 }) }
    const event = asker({ group, reply: async () => {} })
    const beforeReply = event.reply
    spyDispatcher()

    await tool.func({ command: '#签到' }, event)

    assert.equal(event.group, group)
    assert.equal(event.reply, beforeReply)
  })

  test('宿主锁死 group 字段时退回包实例，用完还原', async () => {
    seed()
    // 框架用 Object.defineProperty 定义 e.group（不可写不可配置），直接赋值会抛
    const group = { sendMsg: async () => ({ message_id: 6 }) }
    const event = asker()
    Object.defineProperty(event, 'group', { value: group })
    const before = group.sendMsg
    setCommandDispatcher(async ev => {
      await ev.group.sendMsg('签到图')
      return true
    })

    const reply = await tool.func({ command: '#签到' }, event)

    assert.match(reply, /执行成功/)
    assert.equal(group.sendMsg, before)
  })

  test('group 只读来自原型链时也不能抛', async () => {
    seed()
    // 线上实测形状：delegated.group 是只读的，但查自有描述符查不到（值在原型链上）
    const group = { sendMsg: async () => ({ message_id: 7 }) }
    const proto = {}
    Object.defineProperty(proto, 'group', { value: group })
    const event = Object.assign(Object.create(proto), asker())
    const before = group.sendMsg
    setCommandDispatcher(async ev => {
      await ev.group.sendMsg('签到图')
      return true
    })

    const reply = await tool.func({ command: '#签到' }, event)

    assert.match(reply, /执行成功/)
    assert.equal(group.sendMsg, before)
  })

  test('群对象冻结时只少数一路，不抛错', async () => {
    seed()
    // 极端兜底：事件字段换不了、连实例也冻结。代执行必须照常跑完，只是数不到 group 这一路
    const group = Object.freeze({ sendMsg: async () => ({ message_id: 8 }) })
    const proto = {}
    Object.defineProperty(proto, 'group', { value: group })
    const event = Object.assign(Object.create(proto), asker())
    setCommandDispatcher(async ev => {
      await ev.group.sendMsg('签到图')
      return true
    })

    const reply = await tool.func({ command: '#签到' }, event)

    // 一路都没数到，如实报没回话——重点是没抛异常
    assert.match(reply, /^Error: /)
    assert.match(reply, /一个字都没回/)
  })

  test('发送里再套一层发送只数一条', async () => {
    seed()
    // 框架的 e.reply 本身就是 group.sendMsg 的副本：包两层的不能算成两条
    const group = { sendMsg: async () => ({ message_id: 3 }) }
    setCommandDispatcher(async event => {
      await event.reply('很长的一条，内部会被框架分段发送')
      return true
    })

    const reply = await tool.func({ command: '#签到' }, asker({
      group,
      reply: async msg => group.sendMsg(msg)
    }))

    assert.match(reply, /1 条/)
  })

  test('框架没认领这条指令时如实说，不当成成功', async () => {
    seed()
    spyDispatcher(false)

    const reply = await tool.func({ command: '#签到排名' }, asker())

    assert.match(reply, /^Error: .*没有插件认领/)
  })

  test('派发抛错时给人话，不把堆栈抖出来', async () => {
    seed()
    spyDispatcher(new Error('ECONNRESET at /root/secret/path.js:42'))

    const reply = await tool.func({ command: '#签到排名' }, asker())

    assert.match(reply, /^Error: .*执行时出错/)
    assert.ok(!reply.includes('ECONNRESET'))
    assert.ok(!reply.includes('/root/'))
  })

  test('带参数时按「写法 参数」派发', async () => {
    seed()
    const calls = spyDispatcher()

    await tool.func({ command: '#查积分 2' }, asker())

    assert.equal(lastText(calls[0]), '#查积分 2')
  })

  test('别名输入按正式写法派发', async () => {
    seed()
    const calls = spyDispatcher()

    await tool.func({ command: '#积分' }, asker())

    assert.equal(lastText(calls[0]), '#查积分')
  })

  test('schema 只有写法一个参数，没有确认这一步', () => {
    const schema = tool.function()

    assert.equal(schema.name, 'commandRun')
    assert.deepEqual(schema.parameters.required, ['command'])
    assert.deepEqual(Object.keys(schema.parameters.properties), ['command'])
  })
})
