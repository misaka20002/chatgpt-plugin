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

test('Gemini 重建 50 条本地历史时仅发送协议字段，完整携带旧问答', async () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `历史消息${i}` }))
  const history = createAttemptHistory('gemini', messages)
  let request
  const client = new CustomGoogleGeminiClient({
    key: 'fixture-key', model: 'fixture-model', config: { ...Config, chatgptBlockCount: 50 }, ...history,
    fetch: async (url, options) => {
      request = JSON.parse(options.body)
      // Google Content 协议只接受 role、parts，不能混入插件自己的 text/content/链指针。
      const invalid = request.contents.some(message => Object.keys(message).some(key => !['role', 'parts'].includes(key)))
      if (invalid) return new Response('Unknown name in Content', { status: 400 })
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: '记得' }] } }] })
    }
  })
  const result = await client.sendMessage('继续', { parentMessageId: history.parentMessageId })
  assert.equal(result.text, '记得')
  assert.deepEqual(request.contents.slice(0, -1), messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })))
  assert.equal(request.contents.length, 51)
})

test('Gemini 工具回填保持完整历史链，不截断之前的用户上下文', async () => {
  const messages = [{ role: 'user', content: '我叫小明' }, { role: 'assistant', content: '记住了' }, { role: 'user', content: '我喜欢蓝色' }, { role: 'assistant', content: '好的' }]
  const history = createAttemptHistory('gemini', messages)
  const requests = []
  const client = new CustomGoogleGeminiClient({
    key: 'fixture-key', model: 'fixture-model', config: Config, ...history,
    e: { user_id: '123', sender: { user_id: '123', role: 'member' }, reply: async () => {} },
    fetch: async (url, options) => {
      requests.push(JSON.parse(options.body))
      const parts = requests.length === 1 ? [{ functionCall: { name: 'lookup', args: {} } }] : [{ text: '小明喜欢蓝色' }]
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts } }] })
    }
  })
  let called = 0
  client.addTools([{ name: 'lookup', function: () => ({ name: 'lookup', description: '查询', parameters: { type: 'object', properties: {} } }), func: async () => { called++; return '查询完成' } }])
  const result = await client.sendMessage('查完后说出我的名字和喜好', { parentMessageId: history.parentMessageId })
  assert.equal(result.text, '小明喜欢蓝色')
  assert.equal(called, 1)
  assert.equal(requests.length, 2)
  for (const request of requests) assert.deepEqual(request.contents.slice(0, 4).map(message => message.parts[0].text), messages.map(message => message.content))
  assert.ok((await history.getMessageById(history.parentMessageId)).parentMessageId)
})
