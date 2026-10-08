import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { connectionVersion } from '../utils/providerProfiles.js'

// 执行真实 Core 和四种协议客户端，只隔离宿主、网络及工具的外部操作。
let toolExecutions = 0, respond
const requests = []
class FixtureTool {
  name = 'lookup'
  function() { return { name: this.name, description: '查询测试数据', parameters: { type: 'object', properties: {} } } }
  async func() { toolExecutions++; return '查询完成' }
}
const source = fs.readFileSync(new URL('../model/core.js', import.meta.url), 'utf8')
for (const [, name, path] of source.matchAll(/import \{ (\w+) \} from '(\.\.\/utils\/(?:tools|anythingllm)\/[^']+)'/g)) {
  if (name !== 'mergeTrustedToolArgs') mock.module(path, { namedExports: { [name]: FixtureTool } })
}
mock.module('../utils/common.js', { namedExports: {
  extractContentFromFile() {}, formatDate: () => '现在', parseSourceImg() {}, getMasterQQ: async () => [],
  getUin: e => e.self_id, getUserData: async () => ({}), normalizeChatMode: mode => mode, makeForwardMsg() {}
} })
mock.module('../../../lib/common/common.js', { defaultExport: { sleep: async () => {} } })
mock.module('../utils/mcp.js', { defaultExport: {} })
mock.module('../utils/paimonFuction.js', { namedExports: { getImageBase64() {}, splitString_Enter() {} } })
mock.module('../utils/face.js', { namedExports: { convertFacesAndCQCode: text => [text] } })
mock.module('../utils/toolForward.js', { namedExports: { sendToolCallForwardMsg() {} } })
mock.module('../utils/hostedTools.js', { namedExports: { getEnabledHostedBuiltinTools: () => [] } })
mock.module('../utils/proxy.js', { namedExports: { newFetch: async (url, options) => {
  const body = JSON.parse(options.body)
  requests.push(body)
  return Response.json(respond(body, requests.length))
} } })
globalThis.logger = { info() {}, debug() {}, warn() {}, error() {}, mark() {} }
globalThis.redis = { get: async () => null }
const { Config, providerDefaults } = await import('../utils/config.js')
Object.assign(Config.getConfig(), {
  smartMode: true, debug: false, enableGroupContext: false, enableMcp: false, enableDefaultMessageTriggerTool: false,
  chatgptBlockCount: 50, llm_maxToolRounds: 3, enableForceToolKeywords: false,
  modelProviders: Object.fromEntries(Object.entries(providerDefaults).map(([type, fields]) => [type, [{
    ...fields, id: type, name: type, claudeApiKey: 'fixture-key', geminiKey: 'fixture-key', apiKey: 'fixture-key', responsesApiKey: 'fixture-key',
    apiStream: false, model: 'gpt-4o-mini', geminiEnableGoogleSearch: false, geminiEnableCodeExecution: false
  }]])), defaultProviderId: 'api'
})
const { default: core } = await import('../model/core.js')
const event = { isGroup: false, self_id: '999', user_id: '123', sender: { user_id: '123', role: 'member' }, reply: async () => {} }
core.reply = event.reply
const messages = Array.from({ length: 48 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `历史消息${i}` }))
const call = { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }
const responses = {
  api: (text, tool) => ({ id: 'api-result', choices: [{ finish_reason: tool ? 'tool_calls' : 'stop', message: { role: 'assistant', content: text, ...(tool ? { tool_calls: [call] } : {}) } }] }),
  responses: (text, tool) => ({ id: tool ? 'response-tool' : 'response-final', output: tool
    ? [{ type: 'reasoning', id: 'reason', summary: [], encrypted_content: 'opaque' }, { type: 'function_call', call_id: call.id, name: 'lookup', arguments: '{}' }]
    : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }),
  claude: (text, tool) => ({ role: 'assistant', stop_reason: tool ? 'tool_use' : 'end_turn', content: tool ? [{ type: 'tool_use', id: call.id, name: 'lookup', input: {} }] : [{ type: 'text', text }] }),
  gemini: (text, tool) => ({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: tool ? [{ functionCall: { name: 'lookup', args: {} }, thoughtSignature: 'opaque' }] : [{ text }] } }] })
}
function requestMessages(type, body) {
  if (type === 'gemini') return body.contents
  if (type === 'responses') return body.input
  return body.messages.filter(m => m.role !== 'system')
}
function textOf(message) {
  if (message.parts) return message.parts.map(p => p.text || '').join('')
  return typeof message.content === 'string' ? message.content : message.content.map(p => p.text || '').join('')
}

for (const type of Object.keys(responses)) {
  test(`${type} 连续问答及工具回填完整保留用户历史，下一轮使用成功正文重建`, async () => {
    requests.length = 0; toolExecutions = 0
    respond = (body, n) => responses[type](n === 2 ? '工具后的回答' : '下一轮回答', n === 1)
    const original = structuredClone(messages)
    const first = await core.sendMessage('请查询', { messages }, type, event, { enableSmart: true })
    assert.equal(first.text, '工具后的回答')
    assert.equal(toolExecutions, 1)
    assert.equal(requests.length, 2)
    for (const request of requests) {
      const history = requestMessages(type, request)
      assert.deepEqual(history.slice(0, 48).map(textOf), messages.map(m => m.content))
      assert.equal(textOf(history[48]), '请查询')
    }
    const followup = requestMessages(type, requests[1])
    if (type === 'api') {
      assert.equal(followup[49].tool_calls[0].id, call.id)
      assert.equal(followup[50].tool_call_id, call.id)
      assert.equal(followup[50].content, '查询完成')
    } else if (type === 'claude') {
      assert.equal(followup[49].content[0].id, call.id)
      assert.equal(followup[50].content[0].tool_use_id, call.id)
      assert.equal(followup[50].content[0].content, '查询完成')
    } else if (type === 'gemini') {
      assert.equal(followup[49].parts[0].thoughtSignature, 'opaque')
      assert.equal(followup[50].parts[0].functionResponse.name, 'lookup')
      assert.match(JSON.stringify(followup[50]), /查询完成/)
      assert.ok(followup.every(m => Object.keys(m).every(key => ['role', 'parts'].includes(key))))
    } else {
      assert.equal(followup[49].encrypted_content, 'opaque')
      assert.equal(followup[50].call_id, call.id)
      assert.equal(followup[51].call_id, call.id)
      assert.equal(followup[51].output, '查询完成')
      assert.equal(requests[1].previous_response_id, undefined)
    }
    const nextHistory = [...messages, { role: 'user', content: '请查询' }, { role: 'assistant', content: first.text }]
    const next = await core.sendMessage('继续', { messages: nextHistory }, type, event, { enableSmart: false })
    assert.equal(next.text, '下一轮回答')
    assert.deepEqual(requestMessages(type, requests[2]).slice(0, 50).map(textOf), nextHistory.map(m => m.content))
    assert.deepEqual(messages, original)
  })
}

test('Responses 官网续聊只发送增量，工具回填使用本轮 ID；账号或版本变化时重建本地历史', async () => {
  const row = Config.getConfig().modelProviders.responses[0]
  row.responsesStore = true
  try {
    requests.length = 0; toolExecutions = 0
    respond = (body, n) => responses.responses('回答', n === 1)
    const conversation = { messages, previousResponseId: 'previous-turn', actualProviderId: row.id, actualProviderVersion: connectionVersion({ ...row, type: 'responses' }) }
    await core.sendMessage('继续', conversation, row.id, event, { enableSmart: true })
    assert.equal(requests[0].input, '继续')
    assert.equal(requests[0].previous_response_id, 'previous-turn')
    assert.equal(requests[1].previous_response_id, 'response-tool')
    assert.deepEqual(requests[1].input, [{ type: 'function_call_output', call_id: call.id, output: '查询完成' }])
    for (const changes of [{ actualProviderId: 'different-account' }, { actualProviderVersion: 'old-version' }]) {
      await core.sendMessage('继续', { ...conversation, ...changes }, row.id, event, { enableSmart: false })
      assert.equal(requests.at(-1).previous_response_id, undefined)
      assert.deepEqual(requests.at(-1).input.slice(0, 48), messages)
    }
  } finally { row.responsesStore = false }
})
