/**
 * 指令地图：拉取、校验、落盘。
 *
 * 只测对外行为——给定一份索引与一组插件，本地应当出现什么、不该出现什么。
 * 网络用按 URL 分发的假 fetch 顶替，磁盘切到临时目录，因此不需要任何外部依赖。
 *
 * 运行：node --test test/commandMap.test.mjs
 */
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  syncMaps,
  readLocalMap,
  readLocalMeta,
  readIndex,
  loadEntries,
  listLocalPlugins,
  listInstalledPlugins,
  readMapState,
  shouldNotifyFailures,
  pruneUninstalled,
  suggestEntries,
  updateReport,
  statusReport,
  DEFAULT_INDEX_URL
} from '../utils/capability/map.js'
import { syncEnabled, delegateEnabled } from '../utils/capability/switches.js'

const INDEX_URL = 'https://raw.githubusercontent.com/Binbin-miao/command-maps/main/dist/index.json'
const BASE = 'https://raw.githubusercontent.com/Binbin-miao/command-maps/main/dist/'
const DIRECT = [{ name: 'direct', build: url => url }]

const sha256 = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

const mapText = (key, extra = {}) => JSON.stringify({
  schema: 2,
  plugin: { key, display: `插件-${key}`, summary: '一句话' },
  instructions: [
    { id: `${key}/a`, command: '#甲', summary: '甲指令', risk: 'q', permission: '' },
    { id: `${key}/b`, command: '#乙', summary: '乙指令', risk: 'w', permission: 'master' }
  ],
  ...extra
})

/** routes: { 完整 URL: 内容 | { status, body } }；未命中的一律 404 */
function fakeFetch (routes) {
  const calls = []
  const impl = async target => {
    calls.push(String(target))
    const hit = routes[String(target)]
    if (hit === undefined) {
      return { ok: false, status: 404, url: String(target), headers: { get: () => null }, text: async () => '' }
    }
    const body = typeof hit === 'string' ? hit : hit.body
    const status = typeof hit === 'string' ? 200 : hit.status
    return { ok: status >= 200 && status < 300, status, url: String(target), headers: { get: () => null }, text: async () => body }
  }
  impl.calls = calls
  return impl
}

const indexOf = (plugins, revision = 1) => JSON.stringify({ schema: 2, revision, plugins })

let cwd
let tmp

before(() => {
  cwd = process.cwd()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'command-map-'))
  process.chdir(tmp)
})

after(() => {
  process.chdir(cwd)
  fs.rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(path.join(tmp, 'data'), { recursive: true, force: true })
})

describe('读索引', () => {
  test('schema 不是 2 时拒绝，并说明只认 2', async () => {
    const body = JSON.stringify({ schema: 1, plugins: {} })
    await assert.rejects(
      () => readIndex({ indexUrl: INDEX_URL, fetchImpl: fakeFetch({ [INDEX_URL]: body }) }),
      /只认 2/
    )
  })

  test('缺少 plugins 时拒绝', async () => {
    const body = JSON.stringify({ schema: 2 })
    await assert.rejects(
      () => readIndex({ indexUrl: INDEX_URL, fetchImpl: fakeFetch({ [INDEX_URL]: body }) }),
      /缺少 plugins/
    )
  })

  test('返回的不是 JSON 时拒绝', async () => {
    await assert.rejects(
      () => readIndex({ indexUrl: INDEX_URL, fetchImpl: fakeFetch({ [INDEX_URL]: '<html>首页</html>' }) }),
      /不是 JSON/
    )
  })
})

describe('同步', () => {
  test('本地没有就下载，落盘后能读回同样的条数与展示名', async () => {
    const body = mapText('a-plugin')
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({
        'a-plugin': { file: 'maps/a-plugin.json', version: '0.0.1', sha256: sha256(body), bytes: Buffer.byteLength(body) }
      }),
      [`${BASE}maps/a-plugin.json`]: body
    })

    const result = await syncMaps({ indexUrl: INDEX_URL, plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })

    assert.equal(result.updated, 1)
    assert.equal(result.failed, 0)
    assert.equal(result.revision, 1)

    const map = readLocalMap('a-plugin')
    assert.equal(map.instructions.length, 2)
    assert.equal(map.plugin.display, '插件-a-plugin')
    assert.equal(readLocalMeta('a-plugin').version, '0.0.1')
  })

  test('版本相同就跳过，第二轮只发一次索引请求', async () => {
    const body = mapText('a-plugin')
    const routes = {
      [INDEX_URL]: indexOf({
        'a-plugin': { file: 'maps/a-plugin.json', version: '0.0.1', sha256: sha256(body) }
      }),
      [`${BASE}maps/a-plugin.json`]: body
    }
    const plugins = [{ key: 'a-plugin' }]

    await syncMaps({ indexUrl: INDEX_URL, plugins, fetchImpl: fakeFetch(routes), mirrors: DIRECT })

    const second = fakeFetch(routes)
    const result = await syncMaps({ indexUrl: INDEX_URL, plugins, fetchImpl: second, mirrors: DIRECT })

    assert.equal(result.updated, 0)
    assert.equal(result.upToDate, 1)
    assert.deepEqual(second.calls, [INDEX_URL])
  })

  test('云端没写 version 时按 sha256 判等，第二轮不重下', async () => {
    const body = mapText('a-plugin')
    const routes = {
      [INDEX_URL]: indexOf({ 'a-plugin': { file: 'maps/a-plugin.json', sha256: sha256(body) } }),
      [`${BASE}maps/a-plugin.json`]: body
    }
    const plugins = [{ key: 'a-plugin' }]

    await syncMaps({ indexUrl: INDEX_URL, plugins, fetchImpl: fakeFetch(routes), mirrors: DIRECT })

    const second = fakeFetch(routes)
    const result = await syncMaps({ indexUrl: INDEX_URL, plugins, fetchImpl: second, mirrors: DIRECT })

    assert.equal(result.updated, 0)
    assert.equal(result.upToDate, 1)
    assert.deepEqual(second.calls, [INDEX_URL])
  })

  test('哈希不符时拒收，且本地不留下任何文件', async () => {
    const body = mapText('a-plugin')
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({ 'a-plugin': { file: 'maps/a-plugin.json', sha256: 'deadbeef' } }),
      [`${BASE}maps/a-plugin.json`]: body
    })

    const result = await syncMaps({ indexUrl: INDEX_URL, plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })

    assert.equal(result.updated, 0)
    assert.equal(result.failed, 1)
    assert.match(result.errors[0], /内容哈希不符/)
    assert.equal(readLocalMap('a-plugin'), null)
    assert.equal(fs.existsSync(path.join(tmp, 'data', 'chatgpt', 'maps', 'a-plugin', 'entry.json')), false)
  })

  test('地图 schema 不是 2 时拒收', async () => {
    const body = JSON.stringify({ schema: 1, plugin: { key: 'a-plugin' }, instructions: [] })
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({ 'a-plugin': { file: 'maps/a-plugin.json', sha256: sha256(body) } }),
      [`${BASE}maps/a-plugin.json`]: body
    })

    const result = await syncMaps({ indexUrl: INDEX_URL, plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })

    assert.equal(result.failed, 1)
    assert.match(result.errors[0], /schema/)
    assert.equal(readLocalMap('a-plugin'), null)
  })

  test('正文写的不是这个插件时拒收（防止把 A 的地图装进 B 的目录）', async () => {
    const body = mapText('b-plugin')
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({ 'a-plugin': { file: 'maps/a-plugin.json', sha256: sha256(body) } }),
      [`${BASE}maps/a-plugin.json`]: body
    })

    const result = await syncMaps({ indexUrl: INDEX_URL, plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })

    assert.equal(result.failed, 1)
    assert.match(result.errors[0], /plugin\.key/)
    assert.equal(readLocalMap('a-plugin'), null)
  })

  test('索引的 file 指向别的主机时拒收，且不发起请求', async () => {
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({ 'a-plugin': { file: 'https://evil.example/map.json', sha256: 'x' } })
    })

    const result = await syncMaps({ indexUrl: INDEX_URL, plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })

    assert.equal(result.failed, 1)
    assert.match(result.errors[0], /索引目录之外/)
    assert.equal(fetchImpl.calls.length, 1)
  })

  test('一份失败不影响其余，索引里没有的插件归入缺失', async () => {
    const good = mapText('good-plugin')
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({
        'good-plugin': { file: 'maps/good-plugin.json', sha256: sha256(good) },
        'bad-plugin': { file: 'maps/bad-plugin.json', sha256: sha256('expected') }
      }),
      [`${BASE}maps/good-plugin.json`]: good,
      [`${BASE}maps/bad-plugin.json`]: mapText('bad-plugin')
    })

    const result = await syncMaps({
      indexUrl: INDEX_URL,
      plugins: [{ key: 'good-plugin' }, { key: 'bad-plugin' }, { key: 'ghost-plugin' }],
      fetchImpl,
      mirrors: DIRECT
    })

    assert.equal(result.updated, 1)
    assert.equal(result.failed, 1)
    assert.deepEqual(result.missing, ['ghost-plugin'])
    assert.equal(readLocalMap('good-plugin').instructions.length, 2)
    assert.equal(readLocalMap('bad-plugin'), null)
  })
})

/** 直接往本地写一份地图，用来构造「不通过同步」的边界情况 */
function writeRawEntry (key, payload) {
  writeRawDir(encodeURIComponent(key), payload)
}

/** 按目录名原样写入——目录名被改坏时也要能造出来 */
function writeRawDir (segment, payload) {
  const dir = path.join(tmp, 'data', 'chatgpt', 'maps', segment)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify(payload), 'utf8')
}

describe('拍平', () => {
  test('一条指令一条记录，字段够查询、提示词与代执行用', async () => {
    const body = JSON.stringify({
      schema: 2,
      plugin: { key: 'a-plugin', display: '签到插件', summary: '每日签到' },
      instructions: [
        {
          id: 'a/sign',
          command: '#签到',
          aliases: ['#打卡'],
          keywords: ['签到', '打卡', '#签到'],
          title: '每日签到',
          summary: '给当前群签到',
          risk: 'w',
          permission: 'master',
          params: [{ name: '时长', required: true, example: '30分钟' }],
          example: '#签到 30分钟',
          what: '给当前群签到并记录时长',
          preconditions: ['只有主人能签', '  ', 42],
          pitfalls: ['每天只能签一次'],
          failures: [{ symptom: '回「签到失败」', cause: '群未开启' }, '纯文本失败描述'],
          edgeCases: ['私聊不可用'],
          timing: '同步',
          cost: '不花钱'
        }
      ]
    })
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({ 'a-plugin': { file: 'maps/a-plugin.json', sha256: sha256(body) } }),
      [`${BASE}maps/a-plugin.json`]: body
    })
    await syncMaps({ indexUrl: INDEX_URL, plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })

    const { entries, stats } = loadEntries()

    assert.equal(entries.length, 1)
    assert.equal(stats.plugins, 1)
    const entry = entries[0]
    assert.equal(entry.plugin, '签到插件')
    assert.equal(entry.pluginKey, 'a-plugin')
    assert.equal(entry.pluginSummary, '每日签到')
    assert.equal(entry.command, '#签到')
    assert.equal(entry.description, '给当前群签到')
    assert.equal(entry.risk, 'w')
    assert.equal(entry.permission, 'master')
    assert.equal(entry.ex, '#签到 30分钟')
    assert.match(entry.args, /时长/)
    assert.match(entry.args, /30分钟/)
    // 写法本身也在关键词里，且重复项只留一份
    assert.deepEqual(entry.keys, ['#签到', '每日签到', '#打卡', '签到', '打卡'])
    // 前置条件 / 坑 / 失败表现这些「该不该用」的依据不能丢，非字符串项要被过滤掉
    assert.deepEqual(entry.preconditions, ['只有主人能签'])
    assert.deepEqual(entry.pitfalls, ['每天只能签一次'])
    assert.deepEqual(entry.failures, ['回「签到失败」 → 群未开启', '纯文本失败描述'])
    assert.deepEqual(entry.edgeCases, ['私聊不可用'])
    assert.equal(entry.what, '给当前群签到并记录时长')
    assert.equal(entry.timing, '同步')
    assert.equal(entry.cost, '不花钱')
  })

  test('多份地图的条数相加与各自条数一致', () => {
    writeRawEntry('one', {
      meta: { key: 'one' },
      map: {
        schema: 2,
        plugin: { key: 'one', display: '甲' },
        instructions: [{ command: '#1' }, { command: '#2' }, { command: '#3' }]
      }
    })
    writeRawEntry('two', {
      meta: { key: 'two' },
      map: {
        schema: 2,
        plugin: { key: 'two', display: '乙' },
        instructions: [{ command: '#4' }, { command: '#5' }]
      }
    })

    const { entries, stats } = loadEntries()

    assert.equal(entries.length, 5)
    assert.deepEqual(stats, { plugins: 2, commands: 5 })
    assert.equal(entries.filter(entry => entry.pluginKey === 'one').length, 3)
    assert.equal(entries.filter(entry => entry.pluginKey === 'two').length, 2)
  })

  test('只有写法、没有标题别名关键词时，关键词退化为写法本身', () => {
    writeRawEntry('bare', {
      meta: { key: 'bare' },
      map: {
        schema: 2,
        plugin: { key: 'bare', display: '光杆' },
        instructions: [{ command: '#光杆' }]
      }
    })

    const { entries } = loadEntries()

    assert.equal(entries.length, 1)
    assert.deepEqual(entries[0].keys, ['#光杆'])
    assert.equal(entries[0].description, '')
    assert.equal(entries[0].pluginSummary, '')
  })

  test('缺展示名时退回插件 key', async () => {
    writeRawEntry('bare-plugin', {
      meta: { key: 'bare-plugin' },
      map: {
        schema: 2,
        plugin: { key: 'bare-plugin' },
        instructions: [{ command: '#甲' }]
      }
    })

    const { entries } = loadEntries()

    assert.equal(entries.length, 1)
    assert.equal(entries[0].plugin, 'bare-plugin')
  })

  test('展示名是空白串时也退回插件 key', () => {
    writeRawEntry('blank-display', {
      meta: { key: 'blank-display' },
      map: {
        schema: 2,
        plugin: { key: 'blank-display', display: '   ' },
        instructions: [{ command: '#甲' }]
      }
    })

    const { entries } = loadEntries()

    assert.equal(entries[0].plugin, 'blank-display')
  })

  test('风险档缺失或写了不认识的值时按最危险的一档算', () => {
    writeRawEntry('risk', {
      meta: { key: 'risk' },
      map: {
        schema: 2,
        plugin: { key: 'risk', display: '风险' },
        instructions: [
          { command: '#缺' },
          { command: '#怪', risk: 'whatever' },
          { command: '#空', risk: '' },
          { command: '#大', risk: 'A' },
          { command: '#查', risk: 'q' }
        ]
      }
    })

    const { entries } = loadEntries()
    const riskOf = command => entries.find(entry => entry.command === command).risk

    assert.equal(riskOf('#缺'), 'a')
    assert.equal(riskOf('#怪'), 'a')
    assert.equal(riskOf('#空'), 'a')
    assert.equal(riskOf('#大'), 'a')
    assert.equal(riskOf('#查'), 'q')
  })

  test('没有写法的指令被跳过', async () => {
    writeRawEntry('no-command', {
      meta: { key: 'no-command' },
      map: {
        schema: 2,
        plugin: { key: 'no-command', display: '空写法' },
        instructions: [{ summary: '只能意会' }, { command: '#有' }]
      }
    })

    const { entries } = loadEntries()

    assert.equal(entries.length, 1)
    assert.equal(entries[0].command, '#有')
  })

  test('坏文件与旧版本文件被跳过，不抛错', async () => {
    const dir = path.join(tmp, 'data', 'chatgpt', 'maps', 'broken')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'entry.json'), '{ 不是 JSON', 'utf8')

    writeRawEntry('old-schema', {
      meta: { key: 'old-schema' },
      map: { schema: 1, plugin: { key: 'old-schema' }, instructions: [{ command: '#旧' }] }
    })

    const { entries, stats } = loadEntries()

    assert.equal(entries.length, 0)
    assert.equal(stats.plugins, 0)
  })

  test('目录名解码不了时只丢那一份，其余照常返回', () => {
    // %zz 不是合法的百分号转义；直接拿它当目录名，模拟目录被手动改坏
    writeRawDir('bad%zz', {
      meta: {},
      map: { schema: 2, plugin: { key: 'x' }, instructions: [{ command: '#坏' }] }
    })
    writeRawEntry('good', {
      meta: { key: 'good' },
      map: { schema: 2, plugin: { key: 'good', display: '好的' }, instructions: [{ command: '#好' }] }
    })

    const { entries, stats } = loadEntries()

    assert.equal(entries.length, 1)
    assert.equal(entries[0].command, '#好')
    assert.equal(stats.plugins, 1)
    assert.deepEqual(listLocalPlugins(), ['good'])
  })

  test('空目录返回空表，不抛错', () => {
    fs.rmSync(path.join(tmp, 'data'), { recursive: true, force: true })

    const { entries, stats } = loadEntries()

    assert.deepEqual(entries, [])
    assert.equal(stats.plugins, 0)
    assert.deepEqual(listLocalPlugins(), [])
  })
})

describe('默认源', () => {
  test('默认地址就是文档里写的那个——被改错时这里必须红', () => {
    assert.equal(
      DEFAULT_INDEX_URL,
      'https://raw.githubusercontent.com/Binbin-miao/command-maps/main/dist/index.json'
    )
    // 其余用例都拿这个常量当路由键，改坏了它们会一起红
    assert.equal(INDEX_URL, DEFAULT_INDEX_URL)
  })

  test('不传地址时自动用默认源', async () => {
    const { index } = await readIndex({ fetchImpl: fakeFetch({ [DEFAULT_INDEX_URL]: indexOf({}) }) })

    assert.equal(index.schema, 2)
  })
})

describe('同步状态', () => {
  test('成功后记下版本、缺失清单与时间', async () => {
    const body = mapText('a-plugin')
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({ 'a-plugin': { file: 'maps/a-plugin.json', sha256: sha256(body) } }, 7),
      [`${BASE}maps/a-plugin.json`]: body
    })

    await syncMaps({
      indexUrl: INDEX_URL,
      plugins: [{ key: 'a-plugin' }, { key: 'ghost-plugin' }],
      fetchImpl,
      mirrors: DIRECT
    })

    const state = readMapState()
    assert.equal(state.revision, 7)
    assert.deepEqual(state.missing, ['ghost-plugin'])
    assert.equal(state.failures, 0)
    assert.equal(state.lastRunAt, state.lastOkAt)
    assert.ok(!Number.isNaN(new Date(state.lastRunAt).getTime()))
  })

  test('索引拉不下来时不抛，失败计数累加并落盘', async () => {
    const fetchImpl = fakeFetch({})

    const first = await syncMaps({ plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })
    assert.equal(first.ok, false)
    assert.equal(first.indexFailed, true)
    assert.equal(first.failures, 1)
    assert.match(first.errors[0], /不可用/)
    assert.equal(readMapState().failures, 1)

    const second = await syncMaps({ plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })
    assert.equal(second.failures, 2)
    assert.equal(readMapState().failures, 2)
    // 一次都没成功过，lastOkAt 仍为空
    assert.equal(readMapState().lastOkAt, '')
  })

  test('有该下的却一份都没下成，算这一轮失败', async () => {
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({ 'a-plugin': { file: 'maps/a-plugin.json', sha256: 'deadbeef' } }),
      [`${BASE}maps/a-plugin.json`]: mapText('a-plugin')
    })

    const result = await syncMaps({ indexUrl: INDEX_URL, plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })

    assert.equal(result.ok, false)
    assert.equal(result.failures, 1)
  })

  test('部分成功也算成功，计数归零', async () => {
    const good = mapText('good-plugin')
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({
        'good-plugin': { file: 'maps/good-plugin.json', sha256: sha256(good) },
        'bad-plugin': { file: 'maps/bad-plugin.json', sha256: sha256('expected') }
      }),
      [`${BASE}maps/good-plugin.json`]: good,
      [`${BASE}maps/bad-plugin.json`]: mapText('bad-plugin')
    })

    const result = await syncMaps({
      indexUrl: INDEX_URL,
      plugins: [{ key: 'good-plugin' }, { key: 'bad-plugin' }],
      fetchImpl,
      mirrors: DIRECT
    })

    assert.equal(result.ok, true)
    assert.equal(result.failures, 0)
    assert.equal(readMapState().failures, 0)
  })

  test('状态文件坏掉时当作从没同步过，不拦任何事', () => {
    fs.mkdirSync(path.join(tmp, 'data', 'chatgpt'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'data', 'chatgpt', 'map-state.json'), '{ 不是 JSON', 'utf8')

    const state = readMapState()

    assert.equal(state.revision, 0)
    assert.equal(state.failures, 0)
    assert.deepEqual(state.missing, [])
  })

  test('连续失败到 3 的倍数才提醒', () => {
    assert.equal(shouldNotifyFailures(0), false)
    assert.equal(shouldNotifyFailures(1), false)
    assert.equal(shouldNotifyFailures(2), false)
    assert.equal(shouldNotifyFailures(3), true)
    assert.equal(shouldNotifyFailures(4), false)
    assert.equal(shouldNotifyFailures(6), true)
    assert.equal(shouldNotifyFailures(undefined), false)
  })
})

describe('本机插件', () => {
  const root = () => path.join(tmp, 'plugins')

  test('只认带 package.json 或 index.js 的目录，跳过 Yunzai 内置目录与隐藏目录', () => {
    fs.rmSync(root(), { recursive: true, force: true })
    for (const name of ['miao-plugin', 'Atlas', 'bujidao', 'example', 'system', 'other', 'adapter', '.git', 'no-pkg']) {
      fs.mkdirSync(path.join(root(), name), { recursive: true })
    }
    for (const name of ['miao-plugin', 'Atlas', 'example', 'system', 'other', 'adapter']) {
      fs.writeFileSync(path.join(root(), name, 'package.json'), '{"name":"x"}', 'utf8')
    }
    // bujidao 这种插件不发 package.json，只有 index.js——按 package.json 判定会把它整个漏掉，
    // 而它的 #签到 恰恰是最常被代执行的一条（线上实例：地图里没有签到，AI 只能回「查不到」）
    fs.writeFileSync(path.join(root(), 'bujidao', 'index.js'), 'export {}', 'utf8')
    fs.writeFileSync(path.join(root(), 'README.md'), 'not a plugin', 'utf8')

    assert.deepEqual(listInstalledPlugins(root()), ['Atlas', 'bujidao', 'miao-plugin'])
  })

  test('插件目录不存在时返回空表，不抛错', () => {
    assert.deepEqual(listInstalledPlugins(path.join(tmp, 'no-such-dir')), [])
  })
})

describe('回执', () => {
  const result = (over = {}) => ({
    ok: true,
    revision: 42,
    scanned: 33,
    updated: 3,
    upToDate: 26,
    missing: ['DF-Plugin'],
    failed: 0,
    errors: [],
    failures: 0,
    ...over
  })

  test('更新回执说清版本、本机插件、成几份败几份、缺哪些', () => {
    const lines = updateReport(result()).join('\n')

    assert.match(lines, /地图版本：42/)
    assert.match(lines, /本机插件 33 个/)
    assert.match(lines, /更新 3 份/)
    assert.match(lines, /已是最新 26 份/)
    assert.match(lines, /失败 0 份/)
    assert.match(lines, /地图仓还没收录：DF-Plugin/)
  })

  test('没事可做时也说一句，不给出空白回执', () => {
    const lines = updateReport(result({ updated: 0, upToDate: 29, missing: [] })).join('\n')

    assert.match(lines, /没有需要更新的内容/)
    assert.ok(!lines.includes('地图仓还没收录'))
  })

  test('失败太多时只列前 5 条，避免刷屏', () => {
    const errors = Array.from({ length: 8 }, (_, i) => `p${i}: 网络不通`)
    const lines = updateReport(result({ updated: 0, failed: 8, errors })).join('\n')

    assert.equal(lines.split('\n').filter(line => line.startsWith('- ')).length, 5)
    assert.match(lines, /另有 3 条/)
  })

  test('索引没拉下来时回执说实话，不写成「失败 1 份」', () => {
    const lines = updateReport({
      ok: false,
      indexFailed: true,
      revision: 0,
      scanned: 33,
      updated: 0,
      upToDate: 0,
      missing: [],
      failed: 1,
      errors: ['地图下载失败（1 个源都不可用）：direct: fetch failed'],
      failures: 1
    }).join('\n')

    assert.match(lines, /没有检查任何地图/)
    assert.match(lines, /fetch failed/)
    assert.ok(!lines.includes('失败 1 份'))
  })

  test('状态回执给出六个关键项与两个开关', () => {
    const lines = statusReport(
      { revision: 42, lastOkAt: '2026-10-29T05:00:00Z', lastRunAt: '2026-10-29T06:00:00Z', failures: 2, missing: ['A', 'B'] },
      { plugins: 29, commands: 1177 },
      { sync: true, delegate: false }
    ).join('\n')

    assert.match(lines, /地图版本：42/)
    assert.match(lines, /缓存：29 个插件、1177 条指令/)
    assert.match(lines, /最近成功：2026-10-29T05:00:00Z/)
    assert.match(lines, /连续失败：2 次/)
    assert.match(lines, /地图仓还没收录：A、B/)
    assert.match(lines, /同步开，代执行关/)
  })

  test('从没成功同步过时状态如实说，不假装有版本', () => {
    const lines = statusReport(
      { revision: 0, lastOkAt: '', lastRunAt: '', failures: 0, missing: [] },
      { plugins: 0, commands: 0 },
      { sync: false, delegate: false }
    ).join('\n')

    assert.match(lines, /还没成功同步过/)
    assert.match(lines, /最近成功：无/)
    assert.match(lines, /地图仓还没收录：无/)
    assert.match(lines, /同步关，代执行关/)
  })
})

describe('开关判定', () => {
  test('地图默认开，只有显式关掉才停', () => {
    assert.equal(syncEnabled({}), true)
    assert.equal(syncEnabled({ enableCommandMapSync: true }), true)
    assert.equal(syncEnabled({ enableCommandMapSync: false }), false)
  })

  test('代执行默认关，必须显式打开', () => {
    assert.equal(delegateEnabled({}), false)
    assert.equal(delegateEnabled({ enableCommandMapDelegate: true }), true)
    assert.equal(delegateEnabled({ enableCommandMapDelegate: false }), false)
    assert.equal(delegateEnabled({ enableCommandMapDelegate: 'true' }), false)
  })

  test('没有配置对象时按默认值算，不抛错', () => {
    assert.equal(syncEnabled(), true)
    assert.equal(delegateEnabled(), false)
  })
})

describe('清理已卸载的插件', () => {
  const entry = key => ({ meta: { key }, map: { schema: 2, plugin: { key }, instructions: [{ command: '#甲' }] } })

  test('本机没有的插件，缓存跟着删掉', () => {
    writeRawEntry('gone', entry('gone'))
    writeRawEntry('keep', entry('keep'))

    const removed = pruneUninstalled(['keep'])

    assert.deepEqual(removed, ['gone'])
    assert.equal(readLocalMap('gone'), null)
    assert.equal(readLocalMap('keep').plugin.key, 'keep')
  })

  test('插件列表为空时一律不动——扫不到目录与一个都没装长得一样', () => {
    writeRawEntry('keep', entry('keep'))

    assert.deepEqual(pruneUninstalled([]), [])
    assert.equal(readLocalMap('keep').plugin.key, 'keep')
  })

  test('同步时顺手清掉，并在结果里报出来', async () => {
    writeRawEntry('ghost', entry('ghost'))
    const body = mapText('a-plugin')
    const fetchImpl = fakeFetch({
      [INDEX_URL]: indexOf({ 'a-plugin': { file: 'maps/a-plugin.json', sha256: sha256(body) } }),
      [`${BASE}maps/a-plugin.json`]: body
    })

    const result = await syncMaps({ indexUrl: INDEX_URL, plugins: [{ key: 'a-plugin' }], fetchImpl, mirrors: DIRECT })

    assert.deepEqual(result.removed, ['ghost'])
    assert.equal(readLocalMap('ghost'), null)
  })
})

describe('打错字时的建议', () => {
  const seedNear = () => {
    writeRawEntry('sign', {
      meta: { key: 'sign' },
      map: {
        schema: 2,
        plugin: { key: 'sign', display: '签到插件' },
        instructions: [{ command: '#签到', keywords: ['签到'] }, { command: '#点歌' }]
      }
    })
    return loadEntries().entries
  }

  test('差一个字也能想到正确写法', () => {
    const near = suggestEntries(seedNear(), '#签道')

    assert.ok(near.some(entry => entry.command === '#签到'))
  })

  test('完全不沾边时不给建议，免得乱指', () => {
    assert.deepEqual(suggestEntries(seedNear(), '造火箭'), [])
  })

  test('一个字都不够猜，直接不给', () => {
    assert.deepEqual(suggestEntries(seedNear(), '签'), [])
  })

  test('重复写法只建议一次', () => {
    const near = suggestEntries(seedNear(), '#签到')
    assert.equal(near.filter(entry => entry.command === '#签到').length, 1)
  })
})
