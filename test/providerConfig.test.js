import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const url = new URL('../utils/config.js', import.meta.url).href
function fixture(t, input) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-config-'))
  const dir = path.join(cwd, 'plugins/chatgpt-plugin/config')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify(input))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  return { file, dir, run: (action = '') => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    globalThis.logger = { info() {}, error() {}, warn() {} }
    globalThis.redis = { get: async () => 'gemini' }
    const { Config, providerDefaults } = await import(${JSON.stringify(url)})
    ${action}
    process.stdout.write(JSON.stringify(Config.getConfig()))
  `], { cwd, encoding: 'utf8', timeout: 10000 })) }
}

test('旧配置备份落盘、专用模型拆分、重启稳定；旧失败回退只留备份', t => {
  const old = { geminiKey: 'fixture-key', geminiModel: 'main', gemini_vqa_model: 'small', geminiSearchModel: 'small', gemini_fallbackModel: 'old-backup', translateSource: 'gemini', groupReply: { provider: 'current', model: 'old-judge' }, responsesStore: false }
  const f = fixture(t, old)
  const first = f.run()
  const second = f.run()
  assert.deepEqual(first, second)
  assert.equal(first.modelProviders.gemini.length, 2)
  assert.equal(first.modelProviders.gemini[0].name, '默认')
  assert.equal(first.modelProviders.gemini[1].name, '默认-内容识别与搜索')
  assert.equal(first.defaultProviderId, first.modelProviders.gemini[0].id)
  assert.equal(first.imageProviderId, first.translateSource)
  assert.equal(first.imageProviderId, first.videoProviderId)
  assert.equal(first.imageProviderId, first.geminiSearchProviderId)
  assert.equal(first.fallbackProviderId, '')
  assert.equal(first.groupReply.provider, 'current')
  assert.equal(first.groupReply.model, undefined)
  assert.equal(first.geminiKey, undefined)
  const backups = fs.readdirSync(f.dir).filter(name => name.includes('providers-backup'))
  assert.equal(backups.length, 1)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, backups[0]), 'utf8')), old)
  assert.equal(first.modelProviders.responses[0].responsesStore, false)
})

test('固定判断模型迁移；改名保留引用，同类重名与跨协议备用拒绝且不部分保存', t => {
  const f = fixture(t, { groupReply: { provider: 'responses', model: 'judge' } })
  const state = f.run(`
    const saved = structuredClone(Config.getConfig())
    const invalid = structuredClone(saved)
    invalid.defaultProviderId = invalid.modelProviders.api[0].id
    invalid.fallbackProviderId = invalid.modelProviders.gemini[0].id
    assert.throws(() => Config.commit(invalid), /同一协议/)
    assert.deepEqual(Config.getConfig(), saved)
    const candidate = structuredClone(saved)
    candidate.modelProviders.gemini[0].name = '我的账号'
    Config.commit(candidate)
    const duplicate = structuredClone(candidate)
    duplicate.modelProviders.gemini.push({ ...duplicate.modelProviders.gemini[0], id: 'another-id' })
    assert.throws(() => Config.commit(duplicate), /重复/)
    const removed = structuredClone(candidate)
    removed.modelProviders.responses = []
    assert.throws(() => Config.commit(removed), /先改选/)
  `)
  assert.equal(state.modelProviders.responses.find(row => row.id === state.groupReply.provider).responsesModel, 'judge')
  assert.equal(f.run().modelProviders.gemini[0].name, '我的账号')
})

test('解除引用后可清空，保存失败不改变内存或磁盘', t => {
  const f = fixture(t, {})
  f.run(`
    const candidate = structuredClone(Config.getConfig())
    candidate.defaultProviderId = candidate.imageProviderId = candidate.videoProviderId = candidate.geminiSearchProviderId = candidate.translateSource = ''
    candidate.modelProviders = { api: [], responses: [], claude: [], gemini: [] }
    Config.commit(candidate)
    const before = fs.readFileSync('plugins/chatgpt-plugin/config/config.json', 'utf8')
    const rename = fs.renameSync
    fs.renameSync = () => { throw new Error('模拟磁盘故障') }
    assert.throws(() => Config.commit({ ...candidate, debug: !candidate.debug }), /保存失败/)
    fs.renameSync = rename
    assert.equal(Config.debug, candidate.debug)
    assert.equal(fs.readFileSync('plugins/chatgpt-plugin/config/config.json', 'utf8'), before)
  `)
  assert.deepEqual(f.run().modelProviders, { api: [], responses: [], claude: [], gemini: [] })
})

test('迁移备份失败时不覆盖原配置', t => {
  const f = fixture(t, { geminiKey: 'fixture-secret' })
  const before = fs.readFileSync(f.file, 'utf8')
  // 同名备份文件无法预知时间，使用只读配置路径上的 copyFile 边界故障。
  const code = `import fs from 'node:fs'; globalThis.logger={error(){},warn(){},info(){}}; globalThis.redis={get:async()=> 'gemini'}; fs.copyFileSync=()=>{throw new Error('backup-failed')}; await import(${JSON.stringify(url)})`
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: path.resolve(f.dir, '../../..'), stdio: 'pipe' }), /backup-failed/)
  assert.equal(fs.readFileSync(f.file, 'utf8'), before)
})

test('已有表单但缺少版本时不补回旧来源或默认条目，显式开启官网续聊保留', t => {
  const modelProviders = { api: [], responses: [{ id: 'my-responses', name: '我的账号', responsesStore: true }], claude: [], gemini: [] }
  const f = fixture(t, { modelProviders, defaultProviderId: 'my-responses' })
  const first = f.run()
  assert.equal(first.providerConfigVersion, 1)
  assert.equal(first.defaultProviderId, 'my-responses')
  assert.equal(first.translateSource, '')
  assert.deepEqual(first.modelProviders.gemini, [])
  assert.equal(first.modelProviders.responses[0].responsesStore, true)
  assert.deepEqual(f.run(), first)
})
