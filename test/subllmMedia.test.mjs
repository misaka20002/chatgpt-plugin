/**
 * 本地辅助验证（test/ 在 .gitignore 中、不入库）：SubLLM 的 media 多模态载荷构造
 *
 * 运行：node --experimental-test-module-mocks --test test/subllmMedia.test.mjs
 *
 * 覆盖点：
 * 1. openai(api) provider + media -> ChatGPTAPI.sendMessage 收到 [{text},{image_url}] 数组
 * 2. openai(api) provider 无 media -> 仍为纯字符串（回归保护）
 * 3. responses provider + media -> ResponsesAPI.sendMessage 收到 input_image 结构的 input
 * 4. gemini provider + media -> option.media = { mimeType, data }
 * 5. claude provider + media -> option.media = { mimeType, data }
 */
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

globalThis.logger = { info() { }, warn() { }, error() { }, mark() { }, debug() { } }
globalThis.redis = { get: async () => 'api', set: async () => 'OK', exists: async () => 0 }
globalThis.Bot = {}
globalThis.segment = {}

const calls = { openai: [], responses: [], gemini: [], claude: [] }

mock.module('../utils/openai/chatgpt-api.js', {
  namedExports: {
    ChatGPTAPI: class {
      constructor (opts) { this.opts = opts }
      async sendMessage (content, option) {
        calls.openai.push({ content, option })
        return { text: 'openai-text', id: 'id-openai' }
      }
    }
  }
})

mock.module('../utils/openai/responses-api.js', {
  namedExports: {
    ResponsesAPI: class {
      constructor (opts) { this.opts = opts }
      async sendMessage (input, opts) {
        calls.responses.push({ input, opts })
        return { text: 'responses-text', id: 'id-responses' }
      }
    }
  }
})

mock.module('../client/CustomGoogleGeminiClient.js', {
  namedExports: {
    CustomGoogleGeminiClient: class {
      constructor (opts) { this.opts = opts }
      async sendMessage (prompt, option) {
        calls.gemini.push({ prompt, option })
        return { text: 'gemini-text', id: 'id-gemini' }
      }
    }
  }
})

mock.module('../client/ClaudeAPIClient.js', {
  namedExports: {
    ClaudeAPIClient: class {
      constructor (opts) { this.opts = opts }
      async sendMessage (prompt, option) {
        calls.claude.push({ prompt, option })
        return { text: 'claude-text', id: 'id-claude' }
      }
    }
  }
})

mock.module('../utils/proxy.js', {
  namedExports: {
    newFetch: async () => { throw new Error('测试中不应发起真实网络请求') }
  }
})

const { SubLLM } = await import('../model/SubLLM.js')

const media = { mimeType: 'image/png', data: 'QUJD' }

test('openai(api) 携带 media 时构造 image_url 多模态 content', async () => {
  const llm = new SubLLM({ provider: 'api', apiKey: 'test-key' })
  const res = await llm.chat('看图', { media })

  assert.equal(res.text, 'openai-text')
  const { content } = calls.openai.at(-1)
  assert.ok(Array.isArray(content), 'content 应为多模态数组')
  assert.deepEqual(content[0], { type: 'text', text: '看图' })
  assert.deepEqual(content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } })
})

test('openai(api) 无 media 时保持纯字符串（回归）', async () => {
  const llm = new SubLLM({ provider: 'api', apiKey: 'test-key' })
  await llm.chat('纯文本', {})

  const { content } = calls.openai.at(-1)
  assert.equal(typeof content, 'string')
  assert.equal(content, '纯文本')
})

test('responses 携带 media 时构造 input_image 结构的 input', async () => {
  const llm = new SubLLM({ provider: 'responses', apiKey: 'test-key' })
  await llm.chat('看图', { media })

  const { input } = calls.responses.at(-1)
  assert.ok(Array.isArray(input), 'input 应为数组')
  assert.equal(input[0].role, 'user')
  assert.deepEqual(input[0].content[0], { type: 'input_text', text: '看图' })
  assert.deepEqual(input[0].content[1], { type: 'input_image', image_url: 'data:image/png;base64,QUJD' })
})

test('gemini 携带 media 时透传 option.media', async () => {
  const llm = new SubLLM({ provider: 'gemini', apiKey: 'test-key' })
  await llm.chat('看图', { media })

  const { option } = calls.gemini.at(-1)
  assert.deepEqual(option.media, { mimeType: 'image/png', data: 'QUJD' })
})

test('claude 携带 media 时透传 option.media', async () => {
  const llm = new SubLLM({ provider: 'claude', apiKey: 'test-key' })
  await llm.chat('看图', { media })

  const { option } = calls.claude.at(-1)
  assert.deepEqual(option.media, { mimeType: 'image/png', data: 'QUJD' })
})

test('构造时的 media 可被 chat 的 opts.media 覆盖，缺省 mimeType 回退 image/jpeg', async () => {
  const llm = new SubLLM({ provider: 'gemini', apiKey: 'test-key', media: { data: 'OLD' } })
  await llm.chat('看图', { media: { data: 'NEW' } })

  const { option } = calls.gemini.at(-1)
  assert.deepEqual(option.media, { mimeType: 'image/jpeg', data: 'NEW' })
})
