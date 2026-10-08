import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

// 隔离媒体、持久化与模型边界，执行真实聊天入口和 abstractChat。
mock.module('../../../lib/plugins/plugin.js', { defaultExport: class {} })
mock.module('../../../lib/common/common.js', { defaultExport: {} })
mock.module('../utils/tts/microsoft-azure.js', { defaultExport: {} })
mock.module('../utils/common.js', { namedExports: {
  completeJSON() {}, formatDate() {}, formatDate2() {}, generateAudio() {}, getDefaultReplySetting() {},
  getImageOcrText() {}, parseSourceImg: async () => false, getUin: e => e.self_id,
  getUserData: async () => ({ mode: 'responses' }), getUserReplySetting: async () => ({}),
  isImage() {}, makeForwardMsg() {}, normalizeChatMode: mode => mode, randomString() {}, render() {}, renderUrl() {}
} })
mock.module('../utils/conversation.js', { namedExports: { deleteConversation() {}, getConversations() {}, getLatestMessageIdByConversationId() {} } })
mock.module('../utils/tts.js', { namedExports: { convertSpeaker() {}, speakers: [] } })
mock.module('../utils/face.js', { namedExports: { convertFacesAndCQCode: text => [text] } })
mock.module('../model/conversation.js', { namedExports: { ConversationManager: class {}, originalValues: {} } })
mock.module('../utils/proxy.js', { namedExports: { getProxy() {} } })
mock.module('../utils/chat.js', { namedExports: { generateSuggestedResponse() {} } })
mock.module('../utils/postprocessors/BasicProcessor.js', { namedExports: { collectProcessors: () => [] } })
mock.module('../utils/paimonFuction.js', { namedExports: {
  hidePrivacyInfo: text => text, removeCQCode() {}, recognitionResultsByGemini() {},
  convertSentenceToArray() {}, extractCharacterName() {}, splitString_Enter() {}, processCQMessage: text => text
} })
mock.module('../utils/chatCooldown.js', { defaultExport: { check: async () => ({ canChat: true }), end() {} } })
const requests = []
let scriptedResponse
mock.module('../model/core.js', { defaultExport: {
  async sendMessage(...args) { requests.push(args); return scriptedResponse ? scriptedResponse(...args) : { noMsg: true } }
} })
const Config = { defaultProviderId: 'responses', modelProviders: { api: [], responses: [{ id: 'responses', name: '默认' }], gemini: [], claude: [] }, chat_for_First_person: false, smartMode: true, enableGroupContext: false, whitelist: [], blacklist: [], promptBlockWords: [] }
Config.getConfig = () => Object.fromEntries(Object.entries(Config).filter(([, value]) => typeof value !== 'function'))
mock.module('../utils/config.js', { namedExports: { Config } })
globalThis.Bot = { uin: [] }
globalThis.redis = { get: async () => null }
globalThis.logger = { info() {}, error(error) { throw error } }
const { chatgpt } = await import('../apps/chat.js')
const { groupReply } = await import('../utils/groupReply.js')

test('自主回复复用正常聊天入口和全局提供商，不传禁用工具参数，仍受黑名单约束', async () => {
  const e = {
    isGroup: true, group_id: '100', group: { group_id: '100' }, self_id: '999', user_id: '123',
    sender: { user_id: '123', role: 'member' }, msg: '开放话题', raw_message: '开放话题', message: [],
    message_id: 'selected-message', seq: 101
  }
  const chat = Object.create(chatgpt.prototype)
  chat.e = e
  await chat.chatgpt_for_firstperson_call(e, { automatic: true })
  assert.equal(requests.length, 1)
  const [prompt, , use, target, options] = requests[0]
  assert.equal(prompt, '开放话题')
  assert.equal(use, 'responses')
  assert.equal(target, e)
  assert.equal(target.message_id, 'selected-message')
  assert.equal(target.seq, 101)
  assert.deepEqual(options.settings, { enableGroupContext: true, groupContextFromLatest: true })
  assert.equal(Config.enableGroupContext, false)
  assert.equal(options?.disableTools, undefined)
  assert.equal(options?.enableSmart, undefined)
  assert.equal(Config.smartMode, true)
  Config.blacklist = ['^123']
  await chat.chatgpt_for_firstperson_call(e, { automatic: true })
  assert.equal(requests.length, 1)
})

test('聊天记忆日志按实际注入条目计数，不能把非空召回显示为零条', async (t) => {
  const { MemoryStore } = await import('../utils/memory/store.js')
  const candidates = [
    { factKey: 'identity.nickname', factValue: '小玉', text: '用户昵称小玉' },
    { factKey: 'preference.coffee', factValue: 'hand_brew', text: '用户偏好手冲咖啡' },
    { factKey: 'preference.sport', factValue: 'basketball', text: '用户爱打篮球' }
  ].map(m => ({ ...m, scope: 'user', ownerId: '123', status: 'active', importance: 0.8, confidence: 0.9 }))
  // 只替换存储边界，真实执行召回筛选、正文格式化和聊天入口日志。
  t.mock.method(MemoryStore.prototype, 'listRecallCandidates', async () => candidates)
  const logs = []
  t.mock.method(globalThis.logger, 'info', message => logs.push(message))
  const previousEnableMemory = Config.enableMemory
  Config.enableMemory = true
  t.after(() => { Config.enableMemory = previousEnableMemory })
  requests.length = 0
  const e = {
    isGroup: true, group_id: '100', self_id: '999', user_id: '123',
    sender: { user_id: '123', role: 'member' }, msg: '咖啡怎么冲', message: []
  }
  const chat = Object.create(chatgpt.prototype)
  chat.e = e
  await chat.abstractChat(e, e.msg, 'responses', false, { automatic: true })
  assert.equal(requests.length, 1)
  const [prompt] = requests[0]
  assert.match(prompt, /用户昵称小玉/)
  assert.match(prompt, /用户偏好手冲咖啡/)
  assert.doesNotMatch(prompt, /用户爱打篮球/)
  assert.deepEqual(logs.filter(message => message.startsWith('[Memory]')), [
    '[Memory] 为用户 123 召回了 2 条相关记忆'
  ])
})

test('自主回复消耗共享限额并复查，直接呼叫超限后不转自主回复，权限拦截仍生效', async t => {
  const previous = { ...Config }
  t.after(() => {
    for (const key of Object.keys(Config)) delete Config[key]
    Object.assign(Config, previous)
    groupReply.prune()
  })
  Object.assign(Config, {
    rateLimiting: 1, blacklist: [], whitelist: [], chat_for_First_person: true,
    groupReply: { enabled: true, groups: [{ groupId: '100', switchOn: true }] }
  })
  let count = 0
  const expirations = []
  const rateCalls = []
  let blocked = false, muted = false
  t.mock.method(redis, 'get', async key => {
    if (key.startsWith('CHATGPT:rateLimit')) rateCalls.push(key)
    if (key.startsWith('CHATGPT:SHUT_UP:')) return muted ? '1' : null
    if (key.startsWith('CHATGPT:blockUser:')) return blocked ? '{}' : null
    return null
  })
  redis.incr = async key => { rateCalls.push(key); return ++count }
  redis.expire = async (...args) => { expirations.push(args) }
  t.after(() => { delete redis.incr; delete redis.expire })
  const e = {
    isGroup: true, group_id: '100', group: { group_id: '100' }, self_id: '999', user_id: '123',
    sender: { user_id: '123', role: 'member' }, msg: '开放话题', raw_message: '开放话题',
    message: [], message_id: 'rate-limit-message', reply: async () => {}
  }
  const chat = Object.create(chatgpt.prototype)
  chat.e = e
  requests.length = 0
  await chat.chatgpt_for_firstperson_call(e, { automatic: true })
  assert.equal(requests.length, 1)
  assert.deepEqual(rateCalls, ['CHATGPT:rateLimit_fifteen:123'])
  assert.equal(count, 1)
  assert.deepEqual(expirations, [['CHATGPT:rateLimit_fifteen:123', 900]])
  // 预筛之后额度也可能被并发请求用完，正式入口必须再次拒绝。
  await chat.chatgpt_for_firstperson_call(e, { automatic: true })
  assert.equal(requests.length, 1)
  assert.equal(count, 2)

  for (const kind of ['at', 'command', 'name']) {
    const direct = { ...e, message_id: kind, msg: kind === 'command' ? '#chat 问题' : '派蒙问题', atme: kind === 'at' }
    chat.e = direct
    chat.toggleMode = kind === 'command' ? 'command' : 'at'
    groupReply.observe({ ...e, message_id: `pending-${kind}` })
    groupReply.observe(direct)
    if (kind === 'name') await chat.chatgpt_for_firstperson_call(direct)
    else await chat.chatgpt(direct)
    assert.equal(requests.length, 1, `${kind} 超限不调用模型`)
    assert.equal(groupReply.groups.get('999:100').pending.size, 0, `${kind} 不留自主回复候选`)
  }
  assert.equal(count, 5)
  chat.e = e
  Config.rateLimiting = 0
  Config.blacklist = ['^123']
  await chat.chatgpt_for_firstperson_call(e, { automatic: true })
  Config.blacklist = []
  Config.whitelist = ['^456']
  await chat.chatgpt_for_firstperson_call(e, { automatic: true })
  Config.whitelist = []
  blocked = true
  await chat.chatgpt_for_firstperson_call(e, { automatic: true })
  blocked = false
  muted = true
  await chat.chatgpt_for_firstperson_call(e, { automatic: true })
  assert.equal(requests.length, 1)
  assert.equal(count, 5)
})

test('备用成功写入主会话，下轮携带正文仍选主模型；连接修改及失败不覆盖历史', async t => {
  const { providerConversationKey, resolveProvider } = await import('../utils/providers.js')
  const { connectionVersion } = await import('../utils/providerProfiles.js')
  const previous = { ...Config }
  const saved = new Map()
  const writes = []
  t.mock.method(redis, 'get', async key => saved.get(key) || null)
  redis.set = async (key, value) => { writes.push(key); saved.set(key, value) }
  t.after(() => {
    delete redis.set
    scriptedResponse = undefined
    for (const key of Object.keys(Config)) delete Config[key]
    Object.assign(Config, previous)
  })
  Object.assign(Config, {
    defaultProviderId: 'main', fallbackProviderId: 'backup', enableMemory: false,
    modelProviders: { api: [], gemini: [], claude: [], responses: [
      { id: 'main', name: '主', responsesModel: 'main-model', responsesStore: false },
      { id: 'backup', name: '备用', responsesModel: 'backup-model', responsesStore: true }
    ] }, blockWords: [], promptBlockWords: []
  })
  const e = { user_id: '123', sender: { user_id: '123' }, msg: '第一问', message: [], isMaster: true }
  const chat = Object.create(chatgpt.prototype)
  const replies = []
  chat.e = e
  chat.reply = async value => replies.push(value)
  const key = providerConversationKey(resolveProvider(), '123')
  scriptedResponse = async () => ({ text: '备用回答', id: 'remote-backup', actualProviderId: 'backup', actualProviderVersion: connectionVersion(resolveProvider('backup')), actualStore: true })
  await chat.abstractChat(e, e.msg, undefined, false, { automatic: true })
  let history = JSON.parse(saved.get(key))
  assert.deepEqual(history.messages, [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '备用回答' }])
  assert.equal(history.actualProviderId, 'backup')
  assert.equal(history.previousResponseId, 'remote-backup')
  assert.deepEqual(replies.at(-1), ['备用回答'])

  scriptedResponse = async (prompt, conversation, id) => {
    assert.equal(id, 'main')
    assert.deepEqual(conversation.messages, history.messages)
    return { text: '主回答', actualProviderId: 'main', actualProviderVersion: connectionVersion(resolveProvider()), actualStore: false }
  }
  await chat.abstractChat(e, '第二问', undefined, false, { automatic: true })
  history = JSON.parse(saved.get(key))
  assert.equal(history.messages.length, 4)
  assert.equal(history.actualProviderId, 'main')
  assert.equal(history.previousResponseId, undefined)

  const completed = saved.get(key)
  scriptedResponse = async () => {
    Config.modelProviders.responses[0].responsesModel = 'changed-model'
    return { text: '旧请求迟到', actualProviderId: 'main' }
  }
  await chat.abstractChat(e, '第三问', undefined, false, { automatic: true })
  assert.equal(saved.get(key), completed)
  assert.equal(saved.has(providerConversationKey(resolveProvider(), '123')), false)
  assert.equal(writes.length, 2)

  scriptedResponse = async () => { throw new Error('全部尝试失败') }
  // 允许入口正常处理模型错误，其他断言仍执行真实持久化路径。
  t.mock.method(logger, 'error', () => {})
  await chat.abstractChat(e, '失败问题', undefined, false, { automatic: true })
  assert.equal(writes.length, 2)
  assert.match(replies.at(-1), /全部尝试失败/)
})
