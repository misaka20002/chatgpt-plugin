/**
 * 指令地图的查询侧：提示词清单、匹配规则、查询工具。
 *
 * 只测对外行为——给一份地图目录，提示词该长什么样、查一个词该回哪几条、工具该说什么话。
 * 全程不发网络请求：任何一次联网都会让这里的假 fetch 计数非零。
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

const { loadEntries, searchEntries, buildPromptAddon, UPDATE_COMMAND } = await import('../utils/capability/map.js')
const { CommandLookupTool } = await import('../utils/tools/CommandLookupTool.js')

let cwd
let tmp

before(() => {
  cwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'command-lookup-'))
  process.chdir(tmp)
})

after(() => {
  process.chdir(cwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(path.join(tmp, 'data'), { recursive: true, force: true })
})

function writeMap(key, plugin, instructions) {
  const dir = path.join(tmp, 'data', 'chatgpt', 'maps', encodeURIComponent(key))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify({
    meta: { key },
    map: { schema: 2, plugin: { key, ...plugin }, instructions }
  }), 'utf8')
}

/** 两份插件、三条指令的常用底图 */
function seed() {
  writeMap('sign', { display: '签到插件', summary: '每日签到与排名' }, [
    {
      command: '#签到',
      aliases: ['#打卡'],
      keywords: ['签到'],
      summary: '给当前群签到',
      risk: 'w',
      permission: 'master',
      example: '#签到',
      what: '把当前群这一天的签到记上',
      returns: '签到卡片图片',
      timing: '同步，秒回',
      cost: '不花钱',
      preconditions: ['说话的人必须是主人', 'Bot 要在线'],
      pitfalls: ['每天只能签一次', '群里没开启签到时会静默失败'],
      failures: [{ symptom: '回「签到失败」', cause: '群未开启签到功能' }],
      edgeCases: ['私聊里不能用'],
      scenarios: ['每天打卡领积分'],
      vs: [{ command: '#签到排名', diff: '那个只看榜不签到' }],
      related: ['#签到排名'],
      enabled_by_default: false,
      implemented_in: 'bujidao'
    },
    { command: '#签到排名', keywords: ['排名'], summary: '看本月签到榜', risk: 'q' }
  ])
  writeMap('music', { display: '点歌插件', summary: '网易云点歌' }, [
    { command: '#点歌', keywords: ['点歌', '音乐'], summary: '按关键词点一首歌', risk: 'q' }
  ])
}

describe('提示词清单', () => {
  test('本地没有地图时返回空串，不报错', () => {
    const { entries } = loadEntries()
    assert.equal(buildPromptAddon({ entries }), '')
  })

  test('每个插件一行，含插件名、一句话与条数，且不含单条指令细节', () => {
    seed()
    const { entries } = loadEntries()

    const addon = buildPromptAddon({ entries })

    assert.match(addon, /签到插件：每日签到与排名（2 条）/)
    assert.match(addon, /点歌插件：网易云点歌（1 条）/)
    // 单条写法不该出现在提示词里——那是查询工具的活
    assert.ok(!addon.includes('#签到'))
    assert.ok(!addon.includes('给当前群签到'))
  })

  test('条数多的插件排在前面', () => {
    seed()
    const addon = buildPromptAddon({ entries: loadEntries().entries })

    assert.ok(addon.indexOf('签到插件') < addon.indexOf('点歌插件'))
  })

  test('代执行关着时明说不能替用户执行', () => {
    seed()
    const off = buildPromptAddon({ entries: loadEntries().entries, delegated: false })

    assert.match(off, /不能替他执行/)
    assert.ok(!off.includes('commandRun'))
  })

  test('代执行开着时改为引导执行，并区分名片点赞与贴表情', () => {
    seed()
    const on = buildPromptAddon({ entries: loadEntries().entries, delegated: true })

    assert.match(on, /commandRun/)
    assert.match(on, /emojiLike/)
    assert.ok(!on.includes('不能替他执行'))
  })

  test('插件没有一句话时只写名字与条数', () => {
    writeMap('bare', { display: '光杆插件' }, [{ command: '#甲' }])
    const addon = buildPromptAddon({ entries: loadEntries().entries })

    assert.match(addon, /- 光杆插件（1 条）/)
  })
})

describe('匹配', () => {
  test('按插件名给整批指令', () => {
    seed()
    const { mode, matches, total } = searchEntries(loadEntries().entries, '签到插件')

    assert.equal(mode, 'plugin')
    assert.equal(total, 2)
    assert.deepEqual(matches.map(entry => entry.command).sort(), ['#签到', '#签到排名'])
  })

  test('展示名不带「插件」二字时，用户加「插件」后缀也能查到整批', () => {
    writeMap('yenai-plugin', { display: '椰奶', summary: '群管全家桶' }, [
      { command: '#状态', summary: '看状态', risk: 'q' },
      { command: '#点赞', summary: '名片赞', risk: 'q' }
    ])

    const { mode, total } = searchEntries(loadEntries().entries, '椰奶插件')

    assert.equal(mode, 'plugin')
    assert.equal(total, 2)
  })

  test('按插件 key 也能问到', () => {
    seed()
    const { mode, matches } = searchEntries(loadEntries().entries, 'music')

    assert.equal(mode, 'plugin')
    assert.equal(matches.length, 1)
  })

  test('按写法精确命中时排在最前', () => {
    seed()
    const { matches } = searchEntries(loadEntries().entries, '#签到')

    assert.equal(matches[0].command, '#签到')
  })

  test('按关键词命中别名与关键词字段', () => {
    seed()
    const entries = loadEntries().entries

    assert.equal(searchEntries(entries, '#打卡').matches[0].command, '#签到')
    assert.equal(searchEntries(entries, '音乐').matches[0].command, '#点歌')
  })

  test('口语化表达（带填充词或跨字量词）也能自适应命中核心指令，且通用短写法排第一', () => {
    seed()
    writeMap('yenai', { display: '椰奶' }, [
      { command: '#点赞', keywords: ['点赞', '赞我'], summary: '给名片点赞', risk: 'q' }
    ])
    writeMap('df', { display: '三角洲' }, [
      { command: '#三角洲改枪方案点赞 12', keywords: ['点赞'], summary: '改枪点赞', risk: 'w' }
    ])
    const entries = loadEntries().entries

    const signRes = searchEntries(entries, '帮我签个到')
    assert.ok(signRes.matches.length >= 1)
    assert.equal(signRes.matches[0].command, '#签到')

    const likeRes = searchEntries(entries, '给我点个赞')
    assert.ok(likeRes.matches.length >= 1)
    assert.equal(likeRes.matches[0].command, '#点赞')
  })

  test('匹配不到时返回 none，不是报错', () => {
    seed()
    const { mode, matches, total } = searchEntries(loadEntries().entries, '造火箭')

    assert.equal(mode, 'none')
    assert.deepEqual(matches, [])
    assert.equal(total, 0)
  })

  test('插件名只是沾边、指令有实打实命中时，按指令走', () => {
    // 真实数据里就有个叫「GT 手动签到」的插件：查「签到」不能只回它那三条
    writeMap('gt', { display: 'GT 手动签到（GT-Manual）' }, [
      { command: '#手动签到' },
      { command: '#GT重连ws' }
    ])
    writeMap('sign', { display: '签到插件' }, [{ command: '#签到', keywords: ['签到'] }])

    const { mode, matches } = searchEntries(loadEntries().entries, '签到')

    assert.equal(mode, 'command')
    assert.deepEqual(matches.map(entry => entry.command), ['#签到', '#手动签到'])
  })

  test('插件名只是沾边、指令没命中时才退回插件全表', () => {
    writeMap('gt', { display: 'GT 手动签到（GT-Manual）' }, [
      { command: '#手动签到' },
      { command: '#GT重连ws' }
    ])

    const { mode, matches, total } = searchEntries(loadEntries().entries, 'GT 手动')

    assert.equal(mode, 'plugin')
    assert.equal(total, 2)
    assert.equal(matches.length, 2)
  })

  test('展示名带括注时，按名字前半段也能问到', () => {
    writeMap('gt', { display: 'GT 手动签到（GT-Manual）' }, [{ command: '#手动签到' }])

    const { mode } = searchEntries(loadEntries().entries, 'gt 手动签到')

    assert.equal(mode, 'plugin')
  })

  test('空查询返回 none', () => {
    seed()
    assert.equal(searchEntries(loadEntries().entries, '   ').mode, 'none')
  })
})

describe('查询工具', () => {
  const tool = new CommandLookupTool()

  test('本地没有地图时指向更新指令，而不是假装知道', async () => {
    const reply = await tool.func({ query: '#签到' })

    assert.ok(reply.includes(UPDATE_COMMAND))
    assert.match(reply, /^Error: 本机还没有任何指令地图/)
  })

  test('缺查询词时说明要什么，并报出收录规模', async () => {
    seed()
    const reply = await tool.func({})

    assert.match(reply, /关键词/)
    assert.match(reply, /2 个插件、3 条指令/)
  })

  test('按插件名回整批，带上风险与权限', async () => {
    seed()
    const reply = await tool.func({ query: '签到插件' })

    assert.match(reply, /共有 2 条指令/)
    assert.match(reply, /#签到/)
    assert.match(reply, /#签到排名/)
    assert.match(reply, /风险：有副作用/)
    assert.match(reply, /权限：仅主人/)
  })

  test('按关键词回命中项', async () => {
    seed()
    const reply = await tool.func({ query: '音乐' })

    assert.match(reply, /#点歌/)
    assert.ok(!reply.includes('#签到排名'))
  })

  test('查不到时明确否定，并说明不代表不存在', async () => {
    seed()
    const reply = await tool.func({ query: '造火箭' })

    assert.match(reply, /^Error: 没查到/)
    assert.match(reply, /不代表这个功能不存在/)
  })

  test('参数写成非字符串也不炸', async () => {
    seed()
    const reply = await tool.func({ query: 42 })

    assert.match(reply, /没查到和「42」/)
  })

  test('问具体一条指令时带出前置、坑、失败表现、场景、易混区分与默认关闭状态', async () => {
    seed()
    const reply = await tool.func({ query: '#签到' })

    assert.match(reply, /前置：说话的人必须是主人/)
    assert.match(reply, /坑：每天只能签一次/)
    assert.match(reply, /失败长这样：回「签到失败」 → 群未开启签到功能/)
    assert.match(reply, /边界：私聊里不能用/)
    assert.match(reply, /做什么：把当前群这一天的签到记上/)
    assert.match(reply, /返回：签到卡片图片/)
    assert.match(reply, /场景：每天打卡领积分/)
    assert.match(reply, /区分：#签到排名（那个只看榜不签到）/)
    assert.match(reply, /关联：#签到排名/)
    assert.match(reply, /默认关闭/)
    assert.match(reply, /实际实现：bujidao/)
  })

  test('问一个插件时不展开细节，只给清单', async () => {
    seed()
    const reply = await tool.func({ query: '签到插件' })

    assert.match(reply, /#签到/)
    assert.ok(!reply.includes('每天只能签一次'))
  })

  test('查不到时以 Error 开头，不冒充成功', async () => {
    seed()
    const reply = await tool.func({ query: '造火箭' })

    assert.match(reply, /^Error: /)
  })

  test('打错字时给出相近写法，而不是只说没查到', async () => {
    seed()
    const reply = await tool.func({ query: '#签道' })

    assert.match(reply, /^Error: /)
    assert.match(reply, /相近的有/)
    assert.match(reply, /#签到/)
  })

  test('差得离谱时不乱给建议', async () => {
    seed()
    const reply = await tool.func({ query: '造火箭' })

    assert.ok(!reply.includes('相近的有'))
  })

  test('工具 schema 只要求一个查询词', () => {
    const schema = tool.function()

    assert.equal(schema.name, 'commandLookup')
    assert.deepEqual(schema.parameters.required, ['query'])
    assert.equal(schema.parameters.properties.query.type, 'string')
  })
})
