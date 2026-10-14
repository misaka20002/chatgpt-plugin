import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createAttemptHistory, runProviderFallback } from '../utils/providerFallback.js'
import { createToolForwardMock } from './fixtures/toolForwardMock.mjs'

// 仅替换宿主、媒体发送和网络边界，执行四种协议客户端的真实响应解析。
const Config = { geminiMaxOutputTokens: 1024, gemini_temperature: 0.3, llm_maxToolRounds: 3 }
mock.module('../utils/config.js', { namedExports: { Config } })
mock.module('../utils/common.js', { namedExports: { makeForwardMsg() {} } })
mock.module('../utils/paimonFuction.js', { namedExports: { splitString_Enter() {} } })
// toolForward 统一测试桩（fixtures/toolForwardMock.mjs）：该模块新增导出只需改工厂一处
const toolForwardMock = createToolForwardMock()
mock.module('../utils/toolForward.js', { namedExports: toolForwardMock.namedExports })
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

// ===== 思维链识别（各 provider → thinking_text，由 forwardReasoning 开关决定是否转发）=====

/** 构造 SSE 流式响应，供 OpenAI 兼容流式思维链用例使用 */
function sseResponse(chunks) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

test('Gemini 思考 part 拆分为 thinking_text，不再与正文拼接', async () => {
  const client = createClient('gemini', async () => Response.json({
    candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [
      { text: '思考中：先分析问题', thought: true },
      { text: '正式回复内容' }
    ] } }]
  }))
  const result = await client.sendMessage('问题', {})
  assert.equal(result.text, '正式回复内容')
  assert.equal(result.thinking_text, '思考中：先分析问题')
})

test('Gemini 工具轮不把思考当工具间回复，思考跨轮累积到 thinking_text', async () => {
  const history = createAttemptHistory('gemini')
  const replies = []
  toolForwardMock.forwardCalls.length = 0
  let calls = 0
  const client = new CustomGoogleGeminiClient({
    key: 'fixture-key', model: 'fixture-model', config: Config, ...history,
    e: {
      user_id: '123', sender: { user_id: '123', role: 'member' },
      reply: async (msg) => { replies.push(Array.isArray(msg) ? msg.join('') : msg) }
    },
    fetch: async () => {
      calls++
      const parts = calls === 1
        ? [{ text: '第一轮思考', thought: true }, { text: '我先查一下' }, { functionCall: { name: 'lookup', args: {} } }]
        : [{ text: '第二轮思考', thought: true }, { text: '查到了答案' }]
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts } }] })
    }
  })
  client.addTools([{
    name: 'lookup',
    function: () => ({ name: 'lookup', description: '查询', parameters: { type: 'object', properties: {} } }),
    func: async () => '查询完成'
  }])
  const result = await client.sendMessage('查一下', {})
  assert.equal(calls, 2)
  assert.equal(result.text, '查到了答案')
  assert.equal(result.thinking_text, '第一轮思考第二轮思考')
  // 工具轮文本以合并转发立即单独外发，不再裸发群消息
  assert.deepEqual(toolForwardMock.forwardCalls.flat().map(x => x.text), ['我先查一下'])
  assert.deepEqual(replies, [])
})

test('Gemini 工具轮独白重归类为 thinking，不作为工具轮回复外发', async () => {
  const history = createAttemptHistory('gemini')
  const replies = []
  toolForwardMock.forwardCalls.length = 0
  let calls = 0
  const client = new CustomGoogleGeminiClient({
    key: 'fixture-key', model: 'fixture-model', config: Config, ...history,
    e: {
      user_id: '123', sender: { user_id: '123', role: 'member' },
      reply: async (msg) => { replies.push(Array.isArray(msg) ? msg.join('') : msg) }
    },
    fetch: async () => {
      calls++
      const parts = calls === 1
        ? [{ text: "(wait, I should call lookup ...). Let's call lookup!" }, { functionCall: { name: 'lookup', args: {} } }]
        : [{ text: '查到了答案' }]
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts } }] })
    }
  })
  client.addTools([{
    name: 'lookup',
    function: () => ({ name: 'lookup', description: '查询', parameters: { type: 'object', properties: {} } }),
    func: async () => '查询完成'
  }])
  const result = await client.sendMessage('查一下', {})
  assert.equal(result.text, '查到了答案')
  assert.equal(toolForwardMock.forwardCalls.length, 0)
  assert.match(result.thinking_text, /Let's call lookup/)
  assert.deepEqual(replies, [])
})

test('Claude 工具轮文本立即单独外发，思考跨轮并入 thinking_text', async () => {
  const history = createAttemptHistory('claude')
  const replies = []
  toolForwardMock.forwardCalls.length = 0
  let calls = 0
  const client = new ClaudeAPIClient({
    key: 'fixture-key', model: 'fixture-model', config: Config, ...history,
    e: {
      user_id: '123', sender: { user_id: '123', role: 'member' },
      reply: async (msg) => { replies.push(Array.isArray(msg) ? msg.join('') : msg) }
    },
    fetch: async () => {
      calls++
      const content = calls === 1
        ? [{ type: 'thinking', thinking: '第一轮思考' }, { type: 'text', text: '我先查一下' }, { type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} }]
        : calls === 2
          ? [{ type: 'thinking', thinking: '第二轮思考' }, { type: 'text', text: '再查一次' }, { type: 'tool_use', id: 'tool-2', name: 'lookup', input: {} }]
          : [{ type: 'thinking', thinking: '第三轮思考' }, { type: 'text', text: '查到了答案' }]
      return Response.json({ id: 'fixture-msg', role: 'assistant', stop_reason: calls < 3 ? 'tool_use' : 'end_turn', content })
    }
  })
  client.addTools([{
    name: 'lookup',
    function: () => ({ name: 'lookup', description: '查询', parameters: { type: 'object', properties: {} } }),
    func: async () => '查询完成'
  }])
  const result = await client.sendMessage('查一下', {})
  assert.equal(calls, 3)
  assert.equal(result.text, '查到了答案')
  assert.equal(result.thinking_text, '第一轮思考第二轮思考第三轮思考')
  // 每一个工具轮的文本都以合并转发立即单独外发，不再被丢弃
  assert.deepEqual(toolForwardMock.forwardCalls.flat().map(x => x.text), ['我先查一下', '再查一次'])
  assert.deepEqual(replies, [])
})

test('OpenAI 兼容非流式思维链按 reasoning_content → reasoning → reasoning_details 兜底', async () => {
  const cases = [
    [{ role: 'assistant', content: '答案', reasoning_content: '思考A' }, '思考A'],
    [{ role: 'assistant', content: '答案', reasoning: '思考B' }, '思考B'],
    [{ role: 'assistant', content: '答案', reasoning_details: [
      { type: 'reasoning.text', text: '思考C1' },
      { type: 'reasoning.summary', summary: '思考C2' },
      { type: 'reasoning.encrypted', data: 'ignored' }
    ] }, '思考C1\n思考C2']
  ]
  for (const [message, expected] of cases) {
    const client = createClient('api', async () => Response.json({ id: 'x', choices: [{ finish_reason: 'stop', message }] }))
    const result = await client.sendMessage('问题', {})
    assert.equal(result.text, '答案')
    assert.equal(result.thinking_text, expected)
  }
})

test('OpenAI 兼容流式按 delta.reasoning_content / delta.reasoning 累积思维链', async () => {
  const client = createClient('api', async () => sseResponse([
    { id: 'x', choices: [{ delta: { role: 'assistant' } }] },
    { id: 'x', choices: [{ delta: { reasoning_content: '思考一' } }] },
    { id: 'x', choices: [{ delta: { content: '正' } }] },
    { id: 'x', choices: [{ delta: { reasoning: '思考二' } }] },
    { id: 'x', choices: [{ delta: { content: '文' } }] }
  ]))
  const result = await client.sendMessage('问题', { stream: true })
  assert.equal(result.text, '正文')
  assert.equal(result.thinking_text, '思考一思考二')
})

test('Responses 思维链 summary 优先，content.reasoning_text 兜底', async () => {
  const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '答案' }] }
  const cases = [
    [[{ type: 'reasoning', id: 'r1', summary: [{ type: 'summary_text', text: '摘要1' }] }, message], '摘要1'],
    [[{ type: 'reasoning', id: 'r2', summary: ['摘要2'] }, message], '摘要2'],
    [[{ type: 'reasoning', id: 'r3', summary: [], content: [{ type: 'reasoning_text', text: '原始CoT' }] }, message], '原始CoT']
  ]
  for (const [output, expected] of cases) {
    const client = createClient('responses', async () => Response.json({ id: 'resp', output }))
    const result = await client.sendMessage('问题', {})
    assert.equal(result.text, '答案')
    assert.equal(result.thinking_text, expected)
  }
})

// ===== 连接级重试：responses / claude 与 openai / gemini 对齐（最多 3 次、每次间隔 60 秒）=====

test('Responses 与 Claude 连接错误按 3×60s 重试：三次失败后恢复，穷尽上限如实抛错', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)) }
  const payloads = {
    responses: { id: 'r', output: [{ type: 'message', content: [{ type: 'output_text', text: '恢复' }] }] },
    claude: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: '恢复' }] }
  }
  for (const [type, payload] of Object.entries(payloads)) {
    let calls = 0
    const client = createClient(type, async () => {
      calls++
      if (calls < 4) {
        const error = new Error('socket hang up')
        error.code = 'ECONNRESET'
        throw error
      }
      return Response.json(payload)
    })
    const run = client.sendMessage('问题', {})
    await flush()
    assert.equal(calls, 1, type)
    t.mock.timers.tick(59999)
    await flush()
    assert.equal(calls, 1, `${type} 未满 60 秒不得重试`)
    t.mock.timers.tick(1)
    await flush()
    assert.equal(calls, 2, type)
    t.mock.timers.tick(60000)
    await flush()
    assert.equal(calls, 3, type)
    t.mock.timers.tick(60000)
    await flush()
    assert.equal(calls, 4, type)
    assert.equal((await run).text, '恢复')
  }
  for (const type of Object.keys(payloads)) {
    let calls = 0
    const client = createClient(type, async () => {
      calls++
      const error = new Error('socket hang up')
      error.code = 'ECONNRESET'
      throw error
    })
    const run = assert.rejects(client.sendMessage('问题', {}), /socket hang up/)
    for (let i = 0; i < 3; i++) {
      await flush()
      t.mock.timers.tick(60000)
    }
    await flush()
    await run
    assert.equal(calls, 4, `${type} 重试上限为 3 次`)
  }
})

test('Responses 与 Claude HTTP 状态错误立即失败，不进入连接级重试', async () => {
  for (const type of ['responses', 'claude']) {
    let calls = 0
    let outcome = ''
    const client = createClient(type, async () => {
      calls++
      return new Response('bad request', { status: 400 })
    })
    const run = client.sendMessage('问题', {}).then(() => { outcome = 'resolved' }, () => { outcome = 'rejected' })
    for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(outcome, 'rejected', `${type} HTTP 状态错误应立即抛错`)
    assert.equal(calls, 1, type)
    await run
  }
})
