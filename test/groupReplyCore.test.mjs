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
mock.module('../utils/proxy.js', { namedExports: { async newFetch() { return { ok: true } } } })
mock.module('../utils/hostedTools.js', { namedExports: { getEnabledHostedBuiltinTools: () => [{ requestTool: { type: 'web_search', name: 'web_search' } }] } })
const requests = []
let remainingContextFailures = 0
let scriptedReply
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
      if (scriptedReply) { await this.options.fetch('https://fixture.invalid', {}); return scriptedReply(this.options, options, provider) }
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
const { Config, providerDefaults } = await import('../utils/config.js')
Object.assign(Config.getConfig(), {
  tts_First_person: '测试称呼', smartMode: true, debug: false, enableGroupContext: false, claudeApiKey: 'test-key',
  geminiEnableGoogleSearch: true, geminiEnableCodeExecution: true, groupContextLength: 20
})
Object.assign(Config.getConfig(), {
  modelProviders: Object.fromEntries(Object.entries(providerDefaults).map(([type, fields]) => [type, [{ ...fields, id: type, name: type, claudeApiKey: 'test-key', geminiKey: 'test-key', apiKey: 'test-key', responsesApiKey: 'test-key' }]])),
  defaultProviderId: 'api'
})
Object.assign(Config.getConfig().modelProviders.gemini[0], { geminiEnableGoogleSearch: true, geminiEnableCodeExecution: true })
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
    assert.deepEqual(request.prompt, provider === 'responses' ? [{ role: 'user', content: selected.raw_message }] : selected.raw_message)
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

for (const type of ['api', 'responses', 'claude', 'gemini']) {
  test(`${type} 同协议备用使用独立连接和生成参数，沿用主提示词并携带本地历史`, async () => {
    const { MODEL_FIELDS, KEY_FIELDS, URL_FIELDS, PROMPT_FIELDS } = await import('../utils/providerProfiles.js')
    const raw = Config.getConfig()
    const primary = raw.modelProviders[type][0]
    const backup = { ...primary, id: `${type}-backup`, name: '备用', [MODEL_FIELDS[type]]: 'backup-model', [KEY_FIELDS[type]]: 'backup-key', [URL_FIELDS[type]]: 'https://backup.invalid/v1', [PROMPT_FIELDS[type]]: '不应采用的备用人设' }
    raw.modelProviders[type].push(backup)
    raw.fallbackProviderId = backup.id
    const before = requests.length
    scriptedReply = (client, options) => {
      const model = client.model || client.completionParams?.model || options.completionParams?.model
      if (model !== 'backup-model') throw new Error('账号额度不足')
      return { text: '备用完成', id: 'backup-response' }
    }
    try {
      const result = await core.sendMessage('接着说', { messages: [{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '旧回答' }], previousResponseId: 'main-remote-id', actualProviderId: primary.id }, primary.id, event, { enableSmart: false, allowFallback: true })
      assert.equal(result.actualProviderId, backup.id)
      const attempts = requests.slice(before)
      assert.equal(attempts.length, 3)
      const last = attempts.at(-1)
      assert.equal(last.clientOptions.apiKey || last.clientOptions.key, 'backup-key')
      assert.equal(last.clientOptions.apiBaseUrl || last.clientOptions.baseUrl, 'https://backup.invalid/v1')
      const system = request => request.options.system || request.options.systemMessage || request.options.instructions
      assert.equal(system(last), system(attempts[0]))
      assert.doesNotMatch(system(last), /不应采用/)
      if (type === 'responses') {
        assert.equal(last.options.previousResponseId, undefined)
        assert.equal(last.prompt[1].content, '旧回答')
      } else {
        const history = await last.clientOptions.getMessageById(last.options.parentMessageId)
        assert.equal(history.text, '旧回答')
      }
    } finally {
      scriptedReply = undefined
      raw.modelProviders[type].pop()
      raw.fallbackProviderId = ''
    }
  })
}

test('并发请求各用自己的账号快照，不受期间全局切换影响', async () => {
  const raw = Config.getConfig()
  const original = structuredClone(raw.modelProviders.api)
  const oldDefault = raw.defaultProviderId
  raw.modelProviders.api[0].model = 'first-model'
  raw.modelProviders.api[0].apiKey = 'first-key'
  raw.modelProviders.api.push({ ...raw.modelProviders.api[0], id: 'second', name: '第二账号', model: 'second-model', apiKey: 'second-key' })
  let unblock, started
  const waiting = new Promise(resolve => { started = resolve })
  const barrier = new Promise(resolve => { unblock = resolve })
  scriptedReply = async client => {
    const model = client.completionParams.model
    if (model === 'first-model') { started(); await barrier }
    return { text: `${model}/${client.apiKey}` }
  }
  try {
    const first = core.sendMessage('甲', {}, 'api', event, { enableSmart: false })
    await waiting
    raw.defaultProviderId = 'second'
    raw.modelProviders.api[0].apiKey = 'changed-key'
    const second = await core.sendMessage('乙', {}, 'second', event, { enableSmart: false })
    unblock()
    assert.equal((await first).text, 'first-model/first-key')
    assert.equal(second.text, 'second-model/second-key')
  } finally {
    unblock()
    scriptedReply = undefined
    raw.modelProviders.api = original
    raw.defaultProviderId = oldDefault
  }
})

test('Responses 关闭官网续聊时传本地历史，开启时仅复用同条目同连接版本的 ID', async () => {
  const { connectionVersion } = await import('../utils/providerProfiles.js')
  const row = Config.getConfig().modelProviders.responses[0]
  const oldStore = row.responsesStore
  const conversation = { messages: [{ role: 'user', content: '前一问' }, { role: 'assistant', content: '前一答' }], actualProviderId: row.id, actualProviderVersion: connectionVersion({ ...row, type: 'responses' }), previousResponseId: 'remote-id' }
  try {
    row.responsesStore = true
    await core.sendMessage('新问题', conversation, row.id, event, { disableTools: true })
    assert.equal(requests.at(-1).options.previousResponseId, 'remote-id')
    assert.equal(requests.at(-1).prompt, '新问题')
    await core.sendMessage('新问题', { ...conversation, actualProviderVersion: '旧连接' }, row.id, event, { disableTools: true })
    assert.equal(requests.at(-1).options.previousResponseId, undefined)
    assert.equal(requests.at(-1).prompt[1].content, '前一答')
    row.responsesStore = false
    await core.sendMessage('新问题', conversation, row.id, event, { disableTools: true })
    assert.equal(requests.at(-1).options.store, false)
    assert.equal(requests.at(-1).options.previousResponseId, undefined)
    assert.equal(requests.at(-1).prompt[1].content, '前一答')
  } finally { row.responsesStore = oldStore }
})

test('主条目缺少密钥在请求前失败，不尝试备用；Responses 内置工具执行后不重试空回复', async () => {
  const row = Config.getConfig().modelProviders.responses[0]
  const key = row.responsesApiKey
  const before = requests.length
  try {
    row.responsesApiKey = ''
    await assert.rejects(core.sendMessage('问题', {}, row.id, event, { allowFallback: true, enableSmart: false }), /尚未配置密钥/)
    assert.equal(requests.length, before)
    row.responsesApiKey = key
    scriptedReply = () => ({ text: '', responseOutput: [{ type: 'web_search_call', status: 'completed' }] })
    await core.sendMessage('搜索', {}, row.id, event, { allowFallback: true, enableSmart: false })
    assert.equal(requests.length, before + 1)
  } finally { row.responsesApiKey = key; scriptedReply = undefined }
})
