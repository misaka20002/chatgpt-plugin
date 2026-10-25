import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { Response } from 'node-fetch'

globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, blue: text => text, cyan: text => text, red: text => text }
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
// 仅给指定测试地址返回小型媒体响应；保留真正的 URL 安全校验、识别函数和工具选路。
const mockMedia = {
  'https://1.1.1.1/routing-test.jpg': { data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg' },
  'https://1.1.1.1/routing-test.mp4': {
    data: Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex'),
    mime: 'video/mp4'
  }
}
mock.module('../utils/proxy.js', { namedExports: { newFetch: async (url, options) => {
  const fixture = mockMedia[url]
  if (!fixture) throw new Error('禁止真实网络')
  assert.equal(options.redirect, 'manual')
  assert.ok(options.agent, '真实媒体下载逻辑仍须固定已验证的连接目标')
  return new Response(fixture.data, {
    status: 200,
    headers: { 'content-type': fixture.mime, 'content-length': String(fixture.data.length) }
  })
} } })
const { Config, providerDefaults } = await import('../utils/config.js')
const cfg = Config.getConfig()
cfg.modelProviders = Object.fromEntries(Object.entries(providerDefaults).map(([type, values]) => [type, [{ ...values, id: `${type}-account`, name: '账号' }]]))
cfg.defaultProviderId = 'api-account'
const { recognitionResultsByGemini, recognitionResultsByCurrentModel } = await import('../utils/paimonFuction.js')
const { translate } = await import('../utils/translate.js')
const { GeminiSearchTool } = await import('../utils/tools/GeminiSearchTool.js')
const { RecognitionResultsByGeminiTool } = await import('../utils/tools/RecognitionResultsByGeminiTool.js')
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

test('按需识别工具通过真实识别函数把图片及视频交给配置的具体模型条目', async () => {
  const tool = new RecognitionResultsByGeminiTool()
  const original = {
    mediaRecognitionSource: cfg.mediaRecognitionSource,
    imageProviderId: cfg.imageProviderId,
    videoProviderId: cfg.videoProviderId
  }
  try {
    for (const source of ['Orignal', 'Gemini']) {
      cfg.mediaRecognitionSource = source
      for (const type of ['api', 'responses', 'claude', 'gemini']) {
        const chosenProviderId = `${type}-account`
        cfg.imageProviderId = chosenProviderId
        cfg.videoProviderId = ''
        const before = calls.length
        const result = await tool.func({ imageUrl: 'https://1.1.1.1/routing-test.jpg', question: '只描述图片' },
          { ...e, modelProviderId: 'api-account' })
        assert.match(result, /^\[Untrusted media content\./, `${source}/${chosenProviderId}: ${result}`)
        assert.match(result, /识别或翻译结果/)
        assert.equal(calls.length, before + 1, '工具必须只请求一个所选模型')
        assert.equal(calls.at(-1).config.provider, chosenProviderId,
          'SubLLM 必须使用配置的图片模型 ID，而非当前聊天模型')
        assert.equal(calls.at(-1).prompt, '只描述图片')
        assert.equal(calls.at(-1).options.media.mimeType, 'image/jpeg')
        assert.equal(calls.at(-1).options.media.data,
          mockMedia['https://1.1.1.1/routing-test.jpg'].data.toString('base64'))
      }
      cfg.imageProviderId = ''
      cfg.videoProviderId = 'gemini-account'
      const before = calls.length
      const result = await tool.func({ videoUrl: 'https://1.1.1.1/routing-test.mp4', question: '只描述视频' },
        { ...e, modelProviderId: 'api-account' })
      assert.match(result, /^\[Untrusted media content\./, `${source}/video: ${result}`)
      assert.equal(calls.length, before + 1)
      assert.equal(calls.at(-1).config.provider, 'gemini-account',
        '视频必须使用独立的 Gemini 视频识别条目')
      assert.equal(calls.at(-1).prompt, '只描述视频')
      assert.equal(calls.at(-1).options.media.mimeType, 'video/mp4')
      assert.equal(calls.at(-1).options.media.data,
        mockMedia['https://1.1.1.1/routing-test.mp4'].data.toString('base64'))
    }
  } finally {
    Object.assign(cfg, original)
  }
})
