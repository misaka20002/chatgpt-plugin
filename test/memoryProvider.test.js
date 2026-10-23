/**
 * 记忆提炼模型供应商（memoryGroupCapture.provider）行为测试
 *
 * - 锅巴字段：schema 存在、默认 'current'、保存后重载一致
 * - 读取端：dailyTask.cfg() 未配置→'current'、配置→取值、空值→'current'
 * - 提炼侧：指定供应商原样传递；失效经预检回退全局默认并告警；
 *           无回退空间（'current' 解析失败）与构造期错误都原样抛出，不吞错
 *
 * 均以子进程运行：配置在 import 阶段读盘（临时 cwd + 预置 config.json），
 * SubLLM 经 mock.module 替换（--experimental-test-module-mocks，与 test:memory 同款）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const moduleUrl = relative => new URL(relative, import.meta.url).href

/** 建临时 cwd 并预置含单个 api 供应商的 config.json（baseUrl 指向不可达端口，防真实出网） */
function makeCwd(prefix) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const configDir = path.join(cwd, 'plugins/chatgpt-plugin/config')
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
    providerConfigVersion: 1,
    modelProviders: {
      api: [{ id: 'prov-aaa', name: '测试模型A', apiKey: 'sk-x', openAiBaseUrl: 'http://127.0.0.1:9/v1', model: 'm-a' }],
      responses: [], claude: [], gemini: [],
    },
    defaultProviderId: 'prov-aaa',
    fallbackProviderId: '',
    imageProviderId: '', videoProviderId: '', geminiSearchProviderId: '', translateSource: '',
  }))
  return cwd
}

function runIn(cwd, script) {
  return execFileSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', script], { cwd, encoding: 'utf8', timeout: 20000 })
}

test('锅巴「提炼模型来源」：schema、默认 current、保存后重载一致', t => {
  const cwd = makeCwd('chatgpt-memory-provider-guoba-')
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const run = action => JSON.parse(runIn(cwd, `
    import { mock } from 'node:test'
    import assert from 'node:assert/strict'
    globalThis.logger = { error: console.error, warn() {}, info() {} }
    globalThis.redis = { get: async () => null }
    mock.module(${JSON.stringify(moduleUrl('../utils/tts.js'))}, { namedExports: { speakers: [], vits_emotion_map: [] } })
    mock.module(${JSON.stringify(moduleUrl('../utils/tts/microsoft-azure.js'))}, { namedExports: { supportConfigurations: [] } })
    const { supportGuoba } = await import(${JSON.stringify(moduleUrl('../guoba.support.js'))})
    const guoba = supportGuoba().configInfo
    ${action}
    process.stdout.write(JSON.stringify(await guoba.getConfigData()))
    process.exit(0)
  `))

  const saved = run(`
    const schema = guoba.schemas.find(s => s.field === 'memoryGroupCapture.provider')
    assert.ok(schema, '锅巴应有「提炼模型来源」字段')
    assert.equal(schema.label, '提炼模型来源')
    assert.equal(schema.component, 'Select')
    assert.deepEqual(schema.componentProps.options[0], { label: '跟随全局对话模型', value: 'current' })
    assert.deepEqual(schema.componentProps.options[1], { label: 'Chat API - 测试模型A', value: 'prov-aaa' })
    const initial = await guoba.getConfigData()
    assert.equal(initial.memoryGroupCapture.provider, 'current', '未配置时默认 current（跟随全局对话模型）')
    await guoba.setConfigData({ 'memoryGroupCapture.provider': 'prov-aaa' }, { Result: { ok() {}, error(message) { throw new Error(message) } } })
  `)
  assert.equal(saved.memoryGroupCapture.provider, 'prov-aaa')

  const reloaded = run('')
  assert.equal(reloaded.memoryGroupCapture.provider, 'prov-aaa', '保存后重载一致')
})


test('锅巴记忆召回模型：默认关闭、接口选项、保存与重载', t => {
  const cwd = makeCwd('chatgpt-memory-recall-provider-')
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const run = action => JSON.parse(runIn(cwd, `
    import { mock } from 'node:test'
    import assert from 'node:assert/strict'
    globalThis.logger = { error: console.error, warn() {}, info() {} }
    globalThis.redis = { get: async () => null }
    mock.module(${JSON.stringify(moduleUrl('../utils/tts.js'))}, { namedExports: { speakers: [], vits_emotion_map: [] } })
    mock.module(${JSON.stringify(moduleUrl('../utils/tts/microsoft-azure.js'))}, { namedExports: { supportConfigurations: [] } })
    const { supportGuoba } = await import(${JSON.stringify(moduleUrl('../guoba.support.js'))})
    const guoba = supportGuoba().configInfo
    ${action}
    process.stdout.write(JSON.stringify(await guoba.getConfigData()))
    process.exit(0)
  `))
  const saved = run(`
    const field = guoba.schemas.find(s => s.field === 'memoryRecallProvider')
    assert.equal(field.label, '记忆召回判断模型')
    // '' 之后紧跟「按权重导入」哨兵 'all'，再是跟随全局与已配置接口
    assert.deepEqual(field.componentProps.options.map(o => o.value), ['', 'all', 'current', 'prov-aaa'])
    // 召回条数上限不再有"达到个人容量就全量注入"的语义，文案必须改成推荐值
    const limitField = guoba.schemas.find(s => s.field === 'memoryContextLimit')
    assert.match(limitField.bottomHelpMessage, /20 条以内/)
    assert.doesNotMatch(limitField.bottomHelpMessage, /全部注入|有权访问的所有记忆|跳过全部筛选/)
    assert.equal(limitField.componentProps.min, 5)
    // 记忆最低重要性阈值已整体删除（2026-10-24），面板不应再暴露该字段
    assert.equal(guoba.schemas.some(s => s.field === 'memoryMinImportance'), false)
    assert.equal((await guoba.getConfigData()).memoryRecallProvider, '')
    // 'all' 是召回模式哨兵，不能被 provider 引用校验当成不存在的提供商
    await guoba.setConfigData({ memoryRecallProvider: 'all' }, {
      Result: { ok() {}, error(message) { throw new Error(message) } }
    })
  `)
  assert.equal(saved.memoryRecallProvider, 'all', '哨兵值必须能保存')
  assert.equal(run('').memoryRecallProvider, 'all', '哨兵值必须能通过加载校验')
  const savedApi = run(`
    await guoba.setConfigData({ memoryRecallProvider: 'prov-aaa', memoryContextLimit: 100, maxMemoriesPerUser: 100 }, {
      Result: { ok() {}, error(message) { throw new Error(message) } }
    })
  `)
  assert.equal(savedApi.memoryRecallProvider, 'prov-aaa')
  assert.equal(savedApi.memoryContextLimit, 100)
  assert.equal(savedApi.maxMemoriesPerUser, 100)
  assert.equal(run('').memoryRecallProvider, 'prov-aaa')
  assert.equal(run(`
    await guoba.setConfigData({ memoryRecallProvider: '' }, { Result: { ok() {}, error(message) { throw new Error(message) } } })
  `).memoryRecallProvider, '')
  assert.equal(run('').memoryRecallProvider, '')
})

test('锅巴个人/群公共记忆容量：独立默认值、最小值、相邻顺序及持久化', t => {
  const cwd = makeCwd('chatgpt-memory-capacity-config-')
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const run = action => JSON.parse(runIn(cwd, `
    import { mock } from 'node:test'
    import assert from 'node:assert/strict'
    globalThis.logger = { error: console.error, warn() {}, info() {} }
    globalThis.redis = { get: async () => null }
    mock.module(${JSON.stringify(moduleUrl('../utils/tts.js'))}, { namedExports: { speakers: [], vits_emotion_map: [] } })
    mock.module(${JSON.stringify(moduleUrl('../utils/tts/microsoft-azure.js'))}, { namedExports: { supportConfigurations: [] } })
    const { supportGuoba } = await import(${JSON.stringify(moduleUrl('../guoba.support.js'))})
    const guoba = supportGuoba().configInfo
    ${action}
    process.stdout.write(JSON.stringify(await guoba.getConfigData()))
    process.exit(0)
  `))
  const saved = run(`
    const pos = guoba.schemas.findIndex(s => s.field === 'maxMemoriesPerUser')
    assert.ok(pos >= 0)
    assert.equal(guoba.schemas[pos].componentProps.min, 50)
    assert.equal(guoba.schemas[pos + 1].field, 'maxMemoriesPerGroup')
    assert.equal(guoba.schemas[pos + 1].label, '群公共最大记忆数量')
    assert.equal(guoba.schemas[pos + 1].componentProps.min, 20)
    const cfg = await guoba.getConfigData()
    assert.equal(cfg.maxMemoriesPerUser, 100)
    assert.equal(cfg.maxMemoriesPerGroup, 50)
    await guoba.setConfigData({ maxMemoriesPerGroup: 65 }, {
      Result: { ok() {}, error(message) { throw new Error(message) } }
    })
  `)
  assert.equal(saved.maxMemoriesPerGroup, 65)
  assert.equal(run('').maxMemoriesPerGroup, 65)
})

test('读取端：dailyTask.cfg() 未配置默认 current、配置后取值、空值回退 current', t => {
  const cwd = makeCwd('chatgpt-memory-provider-cfg-')
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const out = JSON.parse(runIn(cwd, `
    globalThis.logger = { error: console.error, warn() {}, info() {} }
    globalThis.redis = { get: async () => null }
    globalThis.Bot = { uin: [] }
    const { Config } = await import(${JSON.stringify(moduleUrl('../utils/config.js'))})
    const { DailyConsolidation } = await import(${JSON.stringify(moduleUrl('../utils/memory/dailyTask.js'))})
    const dc = new DailyConsolidation()
    // 1) 文件里没有 provider → 默认 'current'（跟随全局对话模型）
    const useDefault = dc.cfg().use
    // 2) 配置具体供应商 → 读取该值
    Config.memoryGroupCapture.provider = 'prov-aaa'
    const useConfigured = dc.cfg().use
    // 3) 空值 → 回退 'current'
    Config.memoryGroupCapture.provider = ''
    const useEmpty = dc.cfg().use
    process.stdout.write(JSON.stringify({ useDefault, useConfigured, useEmpty }))
    process.exit(0)
  `))
  assert.equal(out.useDefault, 'current', '未配置时默认 current')
  assert.equal(out.useConfigured, 'prov-aaa', '配置后读取该供应商')
  assert.equal(out.useEmpty, 'current', '空值回退 current')
})

test('提炼供应商：指定原样传递、失效经预检回退全局默认并告警', t => {
  const cwd = makeCwd('chatgpt-memory-provider-extract-')
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const out = JSON.parse(runIn(cwd, `
    import { mock } from 'node:test'
    import assert from 'node:assert/strict'
    const warns = []
    globalThis.logger = { error: console.error, info() {}, warn: (...a) => warns.push(a.join(' ')) }
    globalThis.redis = { get: async () => null }
    globalThis.Bot = { uin: [] }
    const constructed = []
    mock.module(${JSON.stringify(moduleUrl('../model/SubLLM.js'))}, { namedExports: { SubLLM: class {
      constructor (options) {
        constructed.push(options.provider)
        this.provider = options.provider
      }
      async chat () { return { text: '{"candidates":[]}' } }
    } } })
    const { runExtraction } = await import(${JSON.stringify(moduleUrl('../utils/memory/extractor.js'))})
    const rows = [{ messageId: 'm1', senderId: 'u1', senderName: '测试', role: 'member', text: '你好' }]
    const evidenceMap = { m1: { groupId: '100', senderId: 'u1', senderName: '测试', role: 'member', time: 1792136000 } }
    const run = use => runExtraction({
      rows,
      ctx: { groupId: '100', day: '2026-10-15', windowLabel: '2026-10-15 全天' },
      evidenceMap,
      cfg: { inputTokenLimit: 30000, use },
    })
    await run('prov-aaa')
    await run('prov-gone')
    await run('current')
    await run(undefined)
    process.stdout.write(JSON.stringify({ constructed, warns }))
    process.exit(0)
  `))

  assert.deepEqual(out.constructed, ['prov-aaa', 'prov-aaa', 'current', 'prov-aaa'],
    '存在的条目原样传递；失效条目经预检回退默认（不构造失效条目）；current 与未配置走默认')
  assert.equal(out.warns.length, 1, '仅在失效回退时告警一次')
  assert.match(out.warns[0], /prov-gone/)
  assert.match(out.warns[0], /回退全局默认/)
})

test('提炼供应商：无回退空间与构造期错误都原样抛出，不吞错', t => {
  const cwd = makeCwd('chatgpt-memory-provider-nofallback-')
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const out = JSON.parse(runIn(cwd, `
    import { mock } from 'node:test'
    import assert from 'node:assert/strict'
    const warns = []
    globalThis.logger = { error: console.error, info() {}, warn: (...a) => warns.push(a.join(' ')) }
    globalThis.redis = { get: async () => null }
    globalThis.Bot = { uin: [] }
    const constructed = []
    mock.module(${JSON.stringify(moduleUrl('../model/SubLLM.js'))}, { namedExports: { SubLLM: class {
      constructor (options) {
        constructed.push(options.provider)
        throw new Error('构造期错误（模拟）')
      }
      async chat () { return { text: '{"candidates":[]}' } }
    } } })
    const { Config } = await import(${JSON.stringify(moduleUrl('../utils/config.js'))})
    const { runExtraction } = await import(${JSON.stringify(moduleUrl('../utils/memory/extractor.js'))})
    const rows = [{ messageId: 'm1', senderId: 'u1', senderName: '测试', role: 'member', text: '你好' }]
    const evidenceMap = { m1: { groupId: '100', senderId: 'u1', senderName: '测试', role: 'member', time: 1792136000 } }
    const run = use => runExtraction({ rows, ctx: { groupId: '100', day: '2026-10-15', windowLabel: '2026-10-15 全天' }, evidenceMap, cfg: { inputTokenLimit: 30000, use, chunkRetryBackoffMs: 1 } })

    // 场景 A：'current' 解析失败（全局默认本身无效）→ 无回退空间，预检即抛，不发生构造
    Config.getConfig().defaultProviderId = 'prov-gone'
    let threwA = null
    try { await run('current') } catch (err) { threwA = String(err.message) }
    const constructedAfterA = constructed.length

    // 场景 B：预检通过但构造期抛错 → 不回退，原样抛出
    Config.getConfig().defaultProviderId = 'prov-aaa'
    let threwB = null
    try { await run('prov-aaa') } catch (err) { threwB = String(err.message) }

    process.stdout.write(JSON.stringify({ warns, constructed, constructedAfterA, threwA, threwB }))
    process.exit(0)
  `))

  assert.match(out.threwA || '', /未配置或已删除/, '场景 A：解析失败原样抛出')
  assert.equal(out.constructedAfterA, 0, '场景 A：预检即拦，不发生构造')
  assert.match(out.threwB || '', /构造期错误（模拟）/, '场景 B：构造期错误原样抛出')
  assert.ok(out.constructed.every(p => p === 'prov-aaa'), '场景 B：构造的都是 prov-aaa，未回退到别的条目')
  assert.deepEqual(out.warns, [], '两个场景都不产生回退告警')
})
