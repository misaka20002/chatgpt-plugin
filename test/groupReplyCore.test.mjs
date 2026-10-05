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
let remainingContextFailures = 0
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
      requests.push({ provider, prompt, options: { ...options }, clientOptions: this.options, tools: this.tools })
      if (remainingContextFailures > 0) {
        remainingContextFailures--
        throw new Error('请求失败：context_length_exceeded')
      }
      return { text: '正常回复', id: 'id' }
    }
  } } })
}
globalThis.logger = { info() {}, debug() {}, warn() {}, error() {}, mark() {} }
globalThis.redis = { get: async () => null, set: async () => 'OK' }
const { Config } = await import('../utils/config.js')
Object.assign(Config.getConfig(), {
  tts_First_person: '测试称呼', smartMode: true, debug: false, enableGroupContext: false, claudeApiKey: 'test-key',
  geminiEnableGoogleSearch: true, geminiEnableCodeExecution: true, groupContextLength: 20
})
const { default: core } = await import('../model/core.js')
const { SubLLM } = await import('../model/SubLLM.js')
const { msgHistoryMgr } = await import('../model/Onebot11_MessageHistoryManager.js')
const event = { isGroup: true, group_id: '100', self_id: '999', user_id: '123', sender: { user_id: '123', role: 'member' }, reply() {} }

function groupHistoryFixture() {
  const historyCalls = []
  const selected = { ...event, message_id: 'selected-message', seq: 101, time: 1, raw_message: '你们知道啥情况吗' }
  // 被选消息已落在最新窗口之外，仍应完整读取最新窗口，不能挤掉新消息来补旧事件。
  const latest = Array.from({ length: Config.groupContextLength }, (_, index) => ({
    message_id: `latest-${index}`, time: index + 2, sender: { ...event.sender }, raw_message: `最近消息${index}`
  }))
  latest.at(-2).raw_message = '蓝牙耳机'
  latest.at(-1).raw_message = '打游戏突然没声音了，但是麦克风还能用'
  selected.group = {
    group_id: selected.group_id, name: '测试群', pickMember: () => ({ card: '派蒙' }),
    async getChatHistory(seq, count) {
      historyCalls.push({ seq, count })
      if (seq === 0) return latest.slice(-count)
      return Array.from({ length: count }, (_, index) => ({
        message_id: `old-${index}`, time: 0, sender: { ...event.sender }, raw_message: '之前的无关话题'
      }))
    }
  }
  return { selected, latest, historyCalls }
}

for (const provider of ['api', 'responses', 'claude', 'gemini']) {
  test(`${provider} 自主回复使用群内最新补充信息，普通回复仍从原消息读取记录`, async () => {
    const { selected, latest, historyCalls } = groupHistoryFixture()
    await core.sendMessage(selected.raw_message, {}, provider, selected, {
      enableSmart: false, settings: { enableGroupContext: true, groupContextFromLatest: true }
    })
    const request = requests.at(-1)
    const system = request.options.system || request.options.systemMessage || request.options.instructions
    assert.equal(request.prompt, selected.raw_message)
    assert.match(system, /蓝牙耳机/)
    assert.match(system, /打游戏突然没声音了，但是麦克风还能用/)
    assert.match(system, /messageId: latest-0/)
    assert.doesNotMatch(system, /messageId: selected-message/)
    assert.deepEqual(historyCalls, [{ seq: 0, count: latest.length }])
    assert.equal(selected.message_id, 'selected-message')
    assert.equal(selected.seq, 101)

    await core.sendMessage(selected.raw_message, {}, provider, selected, {
      enableSmart: false, settings: { enableGroupContext: true }
    })
    const normalRequest = requests.at(-1)
    const normalSystem = normalRequest.options.system || normalRequest.options.systemMessage || normalRequest.options.instructions
    assert.match(normalSystem, /messageId: selected-message/)
    assert.doesNotMatch(normalSystem, /蓝牙耳机/)
    assert.deepEqual(historyCalls.at(-1), { seq: 101, count: latest.length - 1 })
  })

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

test('最新群记录为空或条数为零时，不把被引用的旧消息补进上下文', async () => {
  const { selected, historyCalls } = groupHistoryFixture()
  assert.deepEqual(await msgHistoryMgr.getGroupHistoryContext(selected, 0, { fromLatest: true }), [])
  assert.deepEqual(historyCalls, [])
  selected.group.getChatHistory = async () => []
  assert.deepEqual(await msgHistoryMgr.getGroupHistoryContext(selected, 20, { fromLatest: true }), [])
  assert.equal(selected.message_id, 'selected-message')
})

for (const provider of ['api', 'responses']) {
  test(`${provider} 上下文超限重试仍读取最新记录并保留引用身份`, async t => {
    const { selected, historyCalls } = groupHistoryFixture()
    const requestStart = requests.length
    remainingContextFailures = 2
    t.after(() => { remainingContextFailures = 0 })
    await core.sendMessage(selected.raw_message, {}, provider, selected, {
      enableSmart: false, settings: { enableGroupContext: true, groupContextFromLatest: true }
    })
    assert.deepEqual(historyCalls, [20, 15, 10].map(count => ({ seq: 0, count })))
    for (const request of requests.slice(requestStart)) {
      assert.match(request.options.systemMessage || request.options.instructions, /打游戏突然没声音了，但是麦克风还能用/)
    }
    assert.equal(selected.message_id, 'selected-message')
    assert.equal(selected.seq, 101)
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
