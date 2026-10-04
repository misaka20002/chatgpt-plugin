import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// 隔离工具、框架和 provider 边界；实际执行 Core 的各 provider 请求组装与 SubLLM 调用。
// 按 import 列表提供未使用工具的桩，避免导入整个宿主；这里不是源码断言。
const source = fs.readFileSync(new URL('../model/core.js', import.meta.url), 'utf8')
for (const [, name, path] of source.matchAll(/import \{ (\w+) \} from '(\.\.\/utils\/(?:tools|anythingllm)\/[^']+)'/g)) {
  if (name === 'mergeTrustedToolArgs') continue
  mock.module(path, { namedExports: { [name]: class { constructor() { throw new Error(`不应收集工具 ${name}`) } } } })
}
mock.module('../utils/common.js', { namedExports: {
  extractContentFromFile() {}, formatDate: () => '现在', parseSourceImg() {}, getMasterQQ: async () => [],
  getUin: e => e.self_id, getUserData: async () => ({}), normalizeChatMode: mode => mode
} })
mock.module('../../../lib/common/common.js', { defaultExport: {} })
mock.module('../utils/mcp.js', { defaultExport: {} })
mock.module('../utils/paimonFuction.js', { namedExports: { getImageBase64() {} } })
mock.module('../utils/toolForward.js', { namedExports: { sendToolCallForwardMsg() {} } })
mock.module('../utils/proxy.js', { namedExports: { newFetch() { throw new Error('禁止真实网络请求') } } })
mock.module('../utils/hostedTools.js', { namedExports: { getEnabledHostedBuiltinTools: () => [{ requestTool: { type: 'web_search', name: 'web_search' } }] } })
const requests = []
for (const [path, name, provider] of [
  ['../utils/openai/chatgpt-api.js', 'ChatGPTAPI', 'api'],
  ['../utils/openai/responses-api.js', 'ResponsesAPI', 'responses'],
  ['../client/ClaudeAPIClient.js', 'ClaudeAPIClient', 'claude'],
  ['../client/CustomGoogleGeminiClient.js', 'CustomGoogleGeminiClient', 'gemini']
]) {
  mock.module(path, { namedExports: { [name]: class {
    constructor(options) { this.options = options; this.tools = [] }
    addTools(tools) { this.tools.push(...tools) }
    async sendMessage(prompt, options) {
      requests.push({ provider, prompt, options, clientOptions: this.options, tools: this.tools })
      return { text: '正常回复', id: 'id' }
    }
  } } })
}
globalThis.logger = { info() {}, debug() {}, warn() {}, error() {}, mark() {} }
globalThis.redis = { get: async () => null, set: async () => 'OK' }
const { Config } = await import('../utils/config.js')
Object.assign(Config.getConfig(), {
  tts_First_person: '测试称呼', smartMode: true, debug: false, enableGroupContext: false, claudeApiKey: 'test-key',
  geminiEnableGoogleSearch: true, geminiEnableCodeExecution: true
})
const { default: core } = await import('../model/core.js')
const { SubLLM } = await import('../model/SubLLM.js')
const event = { isGroup: true, group_id: '100', self_id: '999', user_id: '123', sender: { user_id: '123', role: 'member' }, reply() {} }

for (const provider of ['api', 'responses', 'claude', 'gemini']) {
  test(`${provider} 显式禁用本地和内置 tools，保留普通提示词与模型参数`, async () => {
    const result = await core.sendMessage('问题', {}, provider, event, { disableTools: true })
    assert.equal(result.text, '正常回复')
    const request = requests.at(-1)
    assert.deepEqual(request.tools, [])
    assert.equal(request.options.completionParams?.tools, undefined)
    assert.equal(request.options.search || false, false)
    assert.equal(request.options.codeExecution || false, false)
    assert.equal(Config.smartMode, true)
    if (provider === 'api') assert.match(request.options.systemMessage, /^You are 测试称呼 /)
    assert.ok(request.options.system || request.options.systemMessage || request.options.instructions)
  })

  test(`${provider} 判断使用独立系统提示词且不带 tools`, async () => {
    await new SubLLM({ provider, model: 'judge-model', apiKey: 'test-key', systemPrompt: '只做判断' }).chat('记录')
    const request = requests.at(-1)
    assert.deepEqual(request.tools, [])
    assert.equal(request.options.completionParams?.tools, undefined)
    assert.equal(request.options.search || false, false)
    assert.equal(request.options.codeExecution || false, false)
    assert.equal(request.options.system || request.options.instructions || request.clientOptions.systemMessage, '只做判断')
  })
}

test('显式禁用工具后，正常调用仍可使用原有 provider 内置工具', async () => {
  for (const provider of ['responses', 'claude', 'gemini']) {
    await core.sendMessage('问题', {}, provider, event, { enableSmart: false })
    const request = requests.at(-1)
    if (provider === 'responses') assert.equal(request.options.completionParams.tools[0].type, 'web_search')
    if (provider === 'claude') assert.equal(request.tools[0].type, 'web_search')
    if (provider === 'gemini') {
      assert.equal(request.options.search, true)
      assert.equal(request.options.codeExecution, true)
    }
  }
})
