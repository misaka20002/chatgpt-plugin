import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProviders } from '../utils/providerProfiles.js'

let config, commits, prompts
const defaults = { api: {}, responses: {}, claude: {}, gemini: {} }
const Config = { getConfig: () => config, commit(candidate) { normalizeProviders(candidate, defaults); config = candidate; commits++ } }
mock.module('../utils/config.js', { namedExports: { Config } })
mock.module('../../../lib/plugins/plugin.js', { defaultExport: class { constructor(options) { Object.assign(this, options) } } })
const { ProviderManagement } = await import('../apps/providers.js')
const event = { isMaster: true, user_id: 1, msg: '#chatgpt切换模型', reply: async text => prompts.push(text) }
beforeEach(() => {
  commits = 0; prompts = []
  config = { modelProviders: { api: [{ id: 'a', name: '主', model: 'one' }, { id: 'b', name: '备用', model: 'two' }], gemini: [{ id: 'g', name: '谷歌' }], responses: [], claude: [] }, defaultProviderId: 'g', fallbackProviderId: '' }
})
function menu(answers, beforeAnswer = () => {}) {
  const instance = new ProviderManagement()
  instance.awaitContext = async (unused, timeout) => {
    assert.equal(timeout, 60)
    assert.equal(commits, 0)
    beforeAnswer()
    const msg = answers.shift()
    return msg === undefined ? null : { ...event, msg }
  }
  return instance
}

test('主备两步完成才保存，同协议列表排除主条目；0 可关闭备用', async () => {
  await menu(['1', '1']).switchProvider(event)
  assert.equal(commits, 1)
  assert.equal(config.defaultProviderId, 'a')
  assert.equal(config.fallbackProviderId, 'b')
  assert.doesNotMatch(prompts[1], /谷歌/)
  commits = 0
  await menu(['2', '0']).switchProvider(event)
  assert.equal(config.defaultProviderId, 'b')
  assert.equal(config.fallbackProviderId, '')
})

test('第二步取消、超时、无效数字或非主人均不改变主备', async () => {
  for (const answer of ['取消', undefined, '1abc', '99']) {
    await menu(['1', answer]).switchProvider(event)
    assert.equal(commits, 0)
    assert.equal(config.defaultProviderId, 'g')
  }
  await menu(['1', '1']).switchProvider({ ...event, isMaster: false })
  assert.equal(commits, 0)
})

test('等待中重排仍按原 ID 选择；删除后拒绝保存', async () => {
  let n = 0
  await menu(['1', '1'], () => { if (++n === 1) config.modelProviders.api.reverse() }).switchProvider(event)
  assert.equal(config.defaultProviderId, 'a')
  assert.equal(config.fallbackProviderId, 'b')
  commits = 0; n = 0
  await menu(['1', '1'], () => { if (++n === 2) config.modelProviders.api = [] }).switchProvider(event)
  assert.equal(commits, 0)
  assert.match(prompts.at(-1), /不存在/)
})

test('修改交互锁定起初条目，拒绝协议不匹配', async () => {
  config.defaultProviderId = 'a'
  Object.defineProperty(Config, 'defaultProviderId', { configurable: true, get: () => config.defaultProviderId })
  await menu(['new-model'], () => { config.defaultProviderId = 'b' }).editProvider({ ...event, msg: '#chatgpt设置模型' })
  assert.equal(config.modelProviders.api.find(row => row.id === 'a').model, 'new-model')
  assert.equal(config.modelProviders.api.find(row => row.id === 'b').model, 'two')
  commits = 0
  await menu(['ignored']).editProvider({ ...event, msg: '#chatgpt设置GeminiKey' })
  assert.equal(commits, 0)
  assert.match(prompts.at(-1), /不匹配/)
})

test('QQ 配置文件整体导入主备引用，校验失败及旧格式不会部分覆盖', async t => {
  mock.module('../utils/common.js', { namedExports: Object.fromEntries([
    'formatDuration', 'getAzureRoleList', 'getPublicIP', 'getUserReplySetting', 'getVitsRoleList', 'makeForwardMsg',
    'normalizeChatMode', 'parseDuration', 'renderUrl', 'randomString'
  ].map(name => [name, () => {}])) })
  mock.module('../utils/SydneyAIClient.js', { defaultExport: class {} })
  mock.module('../utils/tts.js', { namedExports: { convertSpeaker() {}, speakers: [] } })
  mock.module('../../../lib/plugins/loader.js', { defaultExport: {} })
  mock.module('../utils/tts/microsoft-azure.js', { namedExports: { supportConfigurations: [] } })
  mock.module('../utils/proxy.js', { namedExports: { newFetch() {} } })
  mock.module('../server/index.js', { namedExports: { createServer() {}, runServer() {}, stopServer() {} } })
  mock.module('../client/CopilotAIClient.js', { namedExports: { BingAIClient: class {} } })
  mock.module('../utils/hostedTools.js', { namedExports: { getHostedBuiltinToolReport() {}, getHostedToolProbeCandidates() {}, setHostedToolProbeResults() {} } })
  mock.module('../utils/paimonFuction.js', { namedExports: { hidePrivacyInfo: text => text } })
  let imported = { providerConfigVersion: 1, modelProviders: { api: [
    { id: 'new-main', name: '新主模型' }, { id: 'new-backup', name: '新备用' }
  ], responses: [], claude: [], gemini: [] }, defaultProviderId: 'new-main', fallbackProviderId: 'new-backup' }
  mock.module('node-fetch', { defaultExport: async () => Response.json({ chatConfig: imported }) })
  const { ChatgptManagement } = await import('../apps/management.js')
  const instance = Object.create(ChatgptManagement.prototype)
  instance.e = { message: [{ type: 'file', fid: 'fixture' }], friend: { getFileUrl: async () => 'https://fixture.invalid/config' } }
  instance.reply = async text => prompts.push(text)
  instance.finish = () => {}
  await instance.doImportConfig(instance.e)
  assert.equal(commits, 1)
  assert.equal(config.defaultProviderId, 'new-main')
  assert.equal(config.fallbackProviderId, 'new-backup')
  const saved = structuredClone(config)
  t.mock.method(console, 'error', () => {})
  imported = { ...saved, defaultProviderId: 'missing-id', debug: true }
  await instance.doImportConfig(instance.e)
  assert.equal(commits, 1)
  assert.deepEqual(config, saved)
  assert.match(prompts.at(-1), /不存在/)
  imported = { model: '旧模型', debug: true }
  await instance.doImportConfig(instance.e)
  assert.equal(commits, 1)
  assert.deepEqual(config, saved)
  assert.match(prompts.at(-1), /旧版配置/)
})
