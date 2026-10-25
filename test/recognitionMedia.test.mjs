/**
 * 按需内容识别工具回归：独立选择图片/视频提供商、配置缺失和失败语义。
 *
 * 运行：node --experimental-test-module-mocks --test test/recognitionMedia.test.mjs
 * 通过工具公开的 func 边界观察调用；普通聊天的 mediaRecognitionSource 不能左右该工具。
 */
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

globalThis.logger = { info() { }, warn() { }, error() { }, mark() { }, debug() { } }
globalThis.redis = { get: async () => 'api', set: async () => 'OK', exists: async () => 0 }
globalThis.Bot = {}
globalThis.segment = {}

const state = {
  calls: [],
  lastArgs: null,
  lastOptions: null,
  currentModelImpl: async () => '当前模型结果',
  recognizeImpl: async () => '指定提供商结果'
}

mock.module('../utils/paimonFuction.js', {
  namedExports: {
    hidePrivacyInfo: (text) => text,
    recognitionResultsByCurrentModel: async (...args) => {
      state.calls.push('current')
      state.lastArgs = args
      state.lastOptions = args[4]
      return state.currentModelImpl()
    },
    recognitionResultsByGemini: async (...args) => {
      state.calls.push('configured')
      state.lastArgs = args
      state.lastOptions = args[4]
      return state.recognizeImpl()
    }
  }
})

const { Config, providerDefaults } = await import('../utils/config.js')
const { RecognitionResultsByGeminiTool } = await import('../utils/tools/RecognitionResultsByGeminiTool.js')

const cfg = Config.getConfig()
const tool = new RecognitionResultsByGeminiTool()
const fakeE = { sender: { user_id: '10001' }, msg: '原始问题' }

const UNTRUSTED_PREFIX = '[Untrusted media content.'

function reset({ source = 'Orignal', currentModel, recognize, imageProviderId = 'api-image', videoProviderId = 'gemini-video' } = {}) {
  cfg.mediaRecognitionSource = source
  cfg.modelProviders = {
    api: [
      { ...providerDefaults.api, id: 'api-chat', name: '对话模型' },
      { ...providerDefaults.api, id: 'api-image', name: '图片模型' }
    ],
    responses: [{ ...providerDefaults.responses, id: 'responses-image', name: '图片模型' }],
    claude: [{ ...providerDefaults.claude, id: 'claude-image', name: '图片模型' }],
    gemini: [{ ...providerDefaults.gemini, id: 'gemini-video', name: '视频模型' }]
  }
  cfg.defaultProviderId = 'api-chat'
  cfg.imageProviderId = imageProviderId
  cfg.videoProviderId = videoProviderId
  state.calls = []
  state.lastArgs = null
  state.lastOptions = null
  state.currentModelImpl = currentModel || (async () => '当前模型结果')
  state.recognizeImpl = recognize || (async () => '指定提供商结果')
}

test('两种普通聊天来源下工具始终只用指定图片识别模型，而不先尝试当前对话模型', async () => {
  for (const source of ['Orignal', 'Gemini']) {
    reset({ source, currentModel: async () => { throw new Error('工具不应该调用当前对话模型') } })
    const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, { ...fakeE, modelProviderId: 'api-chat' })
    assert.ok(result.startsWith(UNTRUSTED_PREFIX), '结果必须带不可信标记')
    assert.ok(result.includes('指定提供商结果'))
    assert.deepEqual(state.calls, ['configured'], '工具不得因为普通聊天配置不同就调用当前模型')
  }
})

test('question 作为显式 prompt 传给识别实现，而不是被 e.msg 顶掉', async () => {
  reset({ source: 'Orignal' })
  await tool.func({ imageUrl: 'https://example.com/a.jpg', question: '只识别图片里的文字' }, fakeE)

  assert.equal(state.lastOptions.prompt, '只识别图片里的文字')
  assert.equal(state.lastOptions.throwOnError, true)
  assert.equal(state.lastOptions.untrustedSource, true)
  assert.equal(state.lastArgs[0].msg, '原始问题', '不应改写原始事件对象')
})

test('question 为空串时不会把 e.msg 顶上来当识别要求', async () => {
  reset({ source: 'Orignal' })
  await tool.func({ imageUrl: 'https://example.com/a.jpg', question: '' }, fakeE)

  assert.equal(state.lastOptions.prompt, '')
  assert.equal(state.lastArgs[0].msg, '原始问题', '不应改写原始事件对象')
})

test('指定识别模型失败后直接返回 Error，不调用当前对话模型或其他提供商', async () => {
  reset({
    currentModel: async () => { throw new Error('不允许回退当前对话模型') },
    recognize: async () => { throw new Error('所选提供商请求失败') }
  })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)

  assert.match(result, /^Error: 所选提供商请求失败/)
  assert.deepEqual(state.calls, ['configured'])
})

test('所选提供商失败不被伪装为识别结果', async () => {
  reset({ source: 'Gemini', recognize: async () => { throw new Error('测试账号密钥无效') } })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)
  assert.match(result, /^Error: /)
  assert.ok(!result.startsWith(UNTRUSTED_PREFIX), '失败不能包装成正常的媒体描述')
  assert.deepEqual(state.calls, ['configured'])
})

test('所选提供商返回空内容时直接报错，不生成只有不可信标记的假成功', async () => {
  reset({ recognize: async () => '  ' })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)
  assert.match(result, /^Error: 识别结果为空/)
  assert.deepEqual(state.calls, ['configured'])
})

test('同时提供图像和视频时视频优先，仅检查指定视频提供商', async () => {
  reset({ imageProviderId: '' })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg', videoUrl: 'https://example.com/b.mp4' }, fakeE)
  assert.ok(result.includes('指定提供商结果'))
  assert.deepEqual(state.lastArgs[1], ['https://example.com/a.jpg'])
  assert.deepEqual(state.lastArgs[2], ['https://example.com/b.mp4'])
  assert.deepEqual(state.calls, ['configured'])
})

test('QQ 头像参数在没有 URL 时被转换为头像地址', async () => {
  reset({ source: 'Gemini' })
  await tool.func({ qq: '10086' }, fakeE)

  assert.equal(state.lastArgs[1][0], 'https://q1.qlogo.cn/g?b=qq&s=160&nk=10086')
  assert.deepEqual(state.calls, ['configured'])
})

test('图片与视频提供商各自独立：只配置对应类型就能识别', async () => {
  reset({ imageProviderId: 'claude-image', videoProviderId: '' })
  const image = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)
  assert.match(image, /指定提供商结果/)
  assert.deepEqual(state.calls, ['configured'])

  reset({ imageProviderId: '', videoProviderId: 'gemini-video' })
  const video = await tool.func({ videoUrl: 'https://example.com/b.mp4' }, fakeE)
  assert.match(video, /指定提供商结果/)
  assert.deepEqual(state.calls, ['configured'])
})

test('指定提供商缺失、无效或 current 时按媒体类型明确报错，不发生模型请求', async () => {
  const cases = [
    [{ imageUrl: 'https://example.com/a.jpg' }, { imageProviderId: '' }, /未配置图片识别模型提供商/],
    [{ qq: '10086' }, { imageProviderId: '' }, /未配置图片识别模型提供商/],
    [{ videoUrl: 'https://example.com/a.mp4' }, { videoProviderId: '' }, /未配置视频识别模型提供商/],
    [{ imageUrl: 'https://example.com/a.jpg' }, { imageProviderId: 'current' }, /图片识别.*不能设置为 current/],
    [{ videoUrl: 'https://example.com/a.mp4' }, { videoProviderId: 'current' }, /视频识别.*不能设置为 current/],
    [{ imageUrl: 'https://example.com/a.jpg' }, { imageProviderId: 'deleted-provider' }, /模型提供商未配置或已删除/],
    [{ videoUrl: 'https://example.com/a.mp4' }, { videoProviderId: 'claude-image' }, /视频识别只能使用 Gemini/]
  ]
  for (const [input, config, expected] of cases) {
    reset(config)
    const result = await tool.func(input, fakeE)
    assert.match(result, /^Error: /, JSON.stringify(input))
    assert.match(result, expected)
    assert.deepEqual(state.calls, [], '配置有误时不允许下载媒体后才尝试其他模型')
  }
})

test('明确选择了与聊天模型相同的真实提供商 ID 时仍可识别', async () => {
  reset({ imageProviderId: 'api-chat' })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' },
    { ...fakeE, modelProviderId: 'api-chat' })
  assert.match(result, /指定提供商结果/)
  assert.deepEqual(state.calls, ['configured'])
})

test('图片识别保持支持四种协议的具体提供商 ID', async () => {
  for (const imageProviderId of ['api-image', 'responses-image', 'claude-image', 'gemini-video']) {
    reset({ imageProviderId, videoProviderId: '' })
    const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)
    assert.match(result, /指定提供商结果/)
    assert.deepEqual(state.calls, ['configured'])
  }
})

test('未提供任何媒体参数时返回参数错误', async () => {
  reset({ source: 'Orignal' })

  const result = await tool.func({}, fakeE)

  assert.match(result, /^Error: Either imageUrl, videoUrl, or qq number is required/)
  assert.deepEqual(state.calls, [])
})

test('识别结果被截断到长度上限', async () => {
  reset({ source: 'Gemini', recognize: async () => 'x'.repeat(5000) })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)

  const body = result.slice(result.indexOf('\n') + 1)
  assert.equal(body.length, 4000)
})
