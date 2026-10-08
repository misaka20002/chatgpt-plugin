import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

globalThis.logger = { info() {}, warn() {}, error() {}, debug() {} }
globalThis.redis = { get: async () => null }
const calls = []
mock.module('../model/SubLLM.js', { namedExports: { SubLLM: class {
  constructor(options) { this.options = options }
  async chat(prompt, options) { calls.push({ config: this.options, prompt, options }); return { text: '识别或翻译结果' } }
} } })
mock.module('../client/CustomGoogleGeminiClient.js', { namedExports: { CustomGoogleGeminiClient: class {
  constructor(options) { this.options = options }
  async sendMessage(prompt, options) { calls.push({ config: this.options, prompt, options }); return { text: '搜索结果' } }
} } })
mock.module('../utils/proxy.js', { namedExports: { newFetch: async () => { throw new Error('禁止真实网络') } } })
const { Config, providerDefaults } = await import('../utils/config.js')
const cfg = Config.getConfig()
cfg.modelProviders = Object.fromEntries(Object.entries(providerDefaults).map(([type, values]) => [type, [{ ...values, id: `${type}-account`, name: '账号' }]]))
cfg.defaultProviderId = 'api-account'
const { recognitionResultsByGemini, recognitionResultsByCurrentModel } = await import('../utils/paimonFuction.js')
const { translate } = await import('../utils/translate.js')
const { GeminiSearchTool } = await import('../utils/tools/GeminiSearchTool.js')
const e = { sender: { user_id: 1 }, msg: '识别', user_id: 1 }

test('四类图片识别和翻译使用指定条目，不被全局账号覆盖', async () => {
  for (const type of ['api', 'responses', 'claude', 'gemini']) {
    cfg.imageProviderId = `${type}-account`
    await recognitionResultsByGemini(e, ['base64://QUJD'])
    assert.equal(calls.at(-1).config.provider, `${type}-account`)
    assert.equal(calls.at(-1).config.model, undefined)
    await translate('你好', '英', 'auto', `${type}-account`)
    assert.equal(calls.at(-1).config.provider, `${type}-account`)
    assert.match(calls.at(-1).config.systemPrompt, /translate/)
  }
})

test('视频必须使用独立 Gemini 条目，当前非 Gemini 模型明确失败', async () => {
  cfg.videoProviderId = 'claude-account'
  await assert.rejects(recognitionResultsByGemini(e, [], ['base64://QUJD'], undefined, { throwOnError: true }), /Gemini/)
  await assert.rejects(recognitionResultsByCurrentModel(e, [], ['base64://QUJD']), /不支持/)
  cfg.videoProviderId = 'gemini-account'
  await recognitionResultsByGemini(e, [], ['base64://QUJD'])
  assert.equal(calls.at(-1).config.provider, 'gemini-account')
})

test('Gemini 搜索独立选择账号和主模型，返回不可信数据标记', async () => {
  cfg.geminiSearchProviderId = 'gemini-account'
  Object.assign(cfg.modelProviders.gemini[0], { geminiKey: 'search-key', geminiModel: 'search-main-model', geminiBaseUrl: 'https://search.invalid' })
  const result = await new GeminiSearchTool().func({ query: '天气' })
  assert.match(result, /untrusted/)
  assert.equal(calls.at(-1).config.key, 'search-key')
  assert.equal(calls.at(-1).config.model, 'search-main-model')
  assert.equal(calls.at(-1).options.search, true)
})
