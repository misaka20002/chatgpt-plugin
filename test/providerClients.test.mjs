import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createAttemptHistory, runProviderFallback } from '../utils/providerFallback.js'

// 仅替换宿主、媒体发送和网络边界，执行四种协议客户端的真实响应解析。
const Config = { geminiMaxOutputTokens: 1024, gemini_temperature: 0.3, llm_maxToolRounds: 3 }
mock.module('../utils/config.js', { namedExports: { Config } })
mock.module('../utils/common.js', { namedExports: { makeForwardMsg() {} } })
mock.module('../utils/paimonFuction.js', { namedExports: { splitString_Enter() {} } })
mock.module('../utils/toolForward.js', { namedExports: { sendToolCallForwardMsg() {} } })
mock.module('../utils/face.js', { namedExports: { convertFacesAndCQCode: text => [text] } })
mock.module('../utils/proxy.js', { namedExports: { newFetch() { throw new Error('不应请求真实网络') } } })
globalThis.logger = { info() {}, warn() {}, error() {}, debug() {} }
const { ChatGPTAPI } = await import('../utils/openai/chatgpt-api.js')
const { ResponsesAPI } = await import('../utils/openai/responses-api.js')
const { ClaudeAPIClient } = await import('../client/ClaudeAPIClient.js')
const { CustomGoogleGeminiClient } = await import('../client/CustomGoogleGeminiClient.js')

const refusals = {
  api: { id: 'a', choices: [{ message: { role: 'assistant', refusal: '拒绝回答' }, finish_reason: 'stop' }] },
  responses: { id: 'r', output: [{ type: 'message', content: [{ type: 'refusal', refusal: '拒绝回答' }] }] },
  claude: { role: 'assistant', stop_reason: 'refusal', content: [{ type: 'text', text: '拒绝回答' }] },
  gemini: { candidates: [{ finishReason: 'SAFETY', content: { role: 'model', parts: [{ text: '' }] } }] }
}

function createClient(type, fetch, onToolStart = () => {}) {
  const options = { apiKey: 'fixture-key', key: 'fixture-key', fetch, onToolStart, config: Config,
    model: 'fixture-model', ...createAttemptHistory(type), maxModelTokens: 8192, maxResponseTokens: 1024 }
  if (type === 'api') return new ChatGPTAPI({ ...options, completionParams: { model: 'gpt-4o-mini' } })
  if (type === 'responses') return new ResponsesAPI(options)
  if (type === 'claude') return new ClaudeAPIClient(options)
  return new CustomGoogleGeminiClient(options)
}

test('四协议明确拒绝均停止整轮重试，Gemini 空文本安全拦截也不回退', async () => {
  for (const [type, body] of Object.entries(refusals)) {
    let calls = 0
    const run = runProviderFallback({ id: 'main' }, { id: 'backup' }, async (row, state) => {
      const client = createClient(type, async () => { calls++; state.requested = true; return Response.json(body) })
      return client.sendMessage('问题', {})
    })
    if (type === 'gemini') await assert.rejects(run, /模型拒绝回答/)
    else assert.equal((await run).refused, true)
    assert.equal(calls, 1, type)
  }
})

test('Gemini 与 Claude 原生工具响应标记为已执行，不因空正文再次请求', async () => {
  const payloads = {
    gemini: { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: '' }] }, groundingMetadata: { webSearchQueries: ['测试查询'] } }] },
    claude: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'server_tool_use', id: 'tool', name: 'web_search', input: {} }] }
  }
  for (const [type, body] of Object.entries(payloads)) {
    let calls = 0, tools = 0
    await runProviderFallback({ id: 'main' }, { id: 'backup' }, async (row, state) => {
      const client = createClient(type, async () => { calls++; state.requested = true; return Response.json(body) }, () => { tools++; state.irreversible = true })
      return client.sendMessage('搜索', {})
    })
    assert.equal(calls, 1, type)
    assert.equal(tools, 1, type)
  }
})

test('Gemini 使用条目温度，显式 0 不被默认值覆盖', async () => {
  const bodies = []
  const client = createClient('gemini', async (url, options) => {
    bodies.push(JSON.parse(options.body))
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: '回答' }] } }] })
  })
  await client.sendMessage('问题')
  await client.sendMessage('问题', { temperature: 0 })
  assert.equal(bodies[0].generationConfig.temperature, 0.3)
  assert.equal(bodies[1].generationConfig.temperature, 0)
})
