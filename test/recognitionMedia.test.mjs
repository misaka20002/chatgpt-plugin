/**
 * 本地辅助验证（随仓库入库）：按需内容识别工具的来源选择与失败语义
 *
 * 运行：node --experimental-test-module-mocks --test test/recognitionMedia.test.mjs
 *
 * 覆盖点：
 * 1. 内容识别来源=模型内置：当前模型识别成功 -> 直接返回，不调用 Gemini
 * 2. question 作为显式 prompt 传给识别实现（不再借 e.msg 偷渡）
 * 3. 内容识别来源=模型内置：当前模型抛错 -> 回退 Gemini
 * 4. Gemini 最终失败 -> 工具返回 'Error: ...'（沿用仓库统一写法，且不包装成识别结果）
 * 5. 内容识别来源=Gemini：直接调用 Gemini，不调用当前模型
 * 6. 未提供媒体参数 -> 返回参数错误
 * 7. 识别结果带「不可信媒体内容」包装且有长度上限
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
  geminiImpl: async () => 'Gemini结果'
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
      state.calls.push('gemini')
      state.lastArgs = args
      state.lastOptions = args[4]
      return state.geminiImpl()
    }
  }
})

const { Config } = await import('../utils/config.js')
const { RecognitionResultsByGeminiTool } = await import('../utils/tools/RecognitionResultsByGeminiTool.js')

const cfg = Config.getConfig()
const tool = new RecognitionResultsByGeminiTool()
const fakeE = { sender: { user_id: '10001' }, msg: '原始问题' }

const UNTRUSTED_PREFIX = '[Untrusted media content.'

function reset({ source, geminiKey = 'test-gemini-key', currentModel, gemini } = {}) {
  cfg.mediaRecognitionSource = source
  cfg.geminiKey = geminiKey
  state.calls = []
  state.lastArgs = null
  state.lastOptions = null
  state.currentModelImpl = currentModel || (async () => '当前模型结果')
  state.geminiImpl = gemini || (async () => 'Gemini结果')
}

test('模型内置：当前模型识别成功时直接返回，不调用 Gemini', async () => {
  reset({ source: 'Orignal' })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)

  assert.ok(result.startsWith(UNTRUSTED_PREFIX), '结果必须带不可信标记')
  assert.ok(result.includes('当前模型结果'))
  assert.deepEqual(state.calls, ['current'])
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

test('模型内置：当前模型抛错时回退 Gemini', async () => {
  reset({
    source: 'Orignal',
    currentModel: async () => { throw new Error('当前模型不支持图片输入') }
  })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)

  assert.ok(result.includes('Gemini结果'))
  assert.deepEqual(state.calls, ['current', 'gemini'])
})

test('Gemini 最终失败时返回 Error: 前缀，不伪装成识别结果', async () => {
  reset({
    source: 'Gemini',
    gemini: async () => { throw new Error('识别出错：Gemini key 无效') }
  })

  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)

  assert.match(result, /^Error: /)
  assert.ok(!result.startsWith(UNTRUSTED_PREFIX), '失败结果不能被包装成识别内容')
})

test('模型内置：当前模型失败且 Gemini 也失败时同样返回 Error:', async () => {
  reset({
    source: 'Orignal',
    currentModel: async () => { throw new Error('当前模型不支持图片输入') },
    gemini: async () => { throw new Error('Gemini 请求失败') }
  })

  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)

  assert.match(result, /^Error: /)
  assert.deepEqual(state.calls, ['current', 'gemini'])
})

test('内容识别来源=Gemini：直接使用 Gemini，不调用当前模型', async () => {
  reset({
    source: 'Gemini',
    currentModel: async () => { throw new Error('不应被调用') }
  })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)

  assert.ok(result.includes('Gemini结果'))
  assert.deepEqual(state.calls, ['gemini'])
})

test('QQ 头像参数在没有 URL 时被转换为头像地址', async () => {
  reset({ source: 'Gemini' })
  await tool.func({ qq: '10086' }, fakeE)

  assert.equal(state.lastArgs[1][0], 'https://q1.qlogo.cn/g?b=qq&s=160&nk=10086')
})

test('未提供任何媒体参数时返回参数错误', async () => {
  reset({ source: 'Orignal' })

  const result = await tool.func({}, fakeE)

  assert.match(result, /^Error: Either imageUrl, videoUrl, or qq number is required/)
  assert.deepEqual(state.calls, [])
})

test('识别结果被截断到长度上限', async () => {
  reset({ source: 'Gemini', gemini: async () => 'x'.repeat(5000) })
  const result = await tool.func({ imageUrl: 'https://example.com/a.jpg' }, fakeE)

  const body = result.slice(result.indexOf('\n') + 1)
  assert.equal(body.length, 4000)
})
