import { randomUUID, createHash } from 'node:crypto'

export const PROVIDER_LABELS = { api: 'Chat API', responses: 'Responses API', claude: 'Claude', gemini: 'Gemini' }
export const PROVIDER_FIELDS = {
  api: ['apiKey', 'openAiBaseUrl', 'model', 'promptPrefixOverride', 'temperature', 'reasoningEffort', 'apiMaxToken', 'maxModelTokens', 'apiStream'],
  responses: ['responsesApiKey', 'responsesApiBaseUrl', 'responsesModel', 'responsesSystemPrompt', 'responsesTemperature', 'responsesReasoningEffort', 'responsesApiMaxToken', 'responsesMaxModelTokens', 'responsesStore', 'responsesFileSearchVectorStoreIds', 'responsesFileSearchMaxNumResults'],
  claude: ['claudeApiKey', 'claudeApiBaseUrl', 'claudeApiModel', 'claudeSystemPrompt', 'claudeApiTemperature', 'claudeApiMaxToken'],
  gemini: ['geminiKey', 'geminiBaseUrl', 'geminiModel', 'geminiPrompt', 'gemini_temperature', 'geminiThinkingLevel', 'geminiMaxOutputTokens', 'geminiEnableGoogleSearch', 'geminiEnableCodeExecution']
}
export const MODEL_FIELDS = { api: 'model', responses: 'responsesModel', claude: 'claudeApiModel', gemini: 'geminiModel' }
export const KEY_FIELDS = { api: 'apiKey', responses: 'responsesApiKey', claude: 'claudeApiKey', gemini: 'geminiKey' }
export const URL_FIELDS = { api: 'openAiBaseUrl', responses: 'responsesApiBaseUrl', claude: 'claudeApiBaseUrl', gemini: 'geminiBaseUrl' }
export const PROMPT_FIELDS = { api: 'promptPrefixOverride', responses: 'responsesSystemPrompt', claude: 'claudeSystemPrompt', gemini: 'geminiPrompt' }
export const emptyProviders = () => ({ api: [], responses: [], claude: [], gemini: [] })

export function listProviders(config) {
  return Object.keys(PROVIDER_FIELDS).flatMap(type => (config.modelProviders?.[type] || []).map(row => ({ ...row, type })))
}

export function findProvider(config, id) {
  return listProviders(config).find(row => row.id === id)
}

export function providerLabel(row) {
  return `${PROVIDER_LABELS[row.type]} - ${row.name}`
}

export function connectionVersion(row) {
  return createHash('sha256').update(JSON.stringify([row.type, row[URL_FIELDS[row.type]], row[KEY_FIELDS[row.type]], row[MODEL_FIELDS[row.type]]])).digest('hex').slice(0, 16)
}

export function normalizeProviders(config, defaults) {
  const ids = new Set()
  for (const type of Object.keys(PROVIDER_FIELDS)) {
    const rows = config.modelProviders?.[type]
    if (!Array.isArray(rows)) throw new Error(`${PROVIDER_LABELS[type]} 配置必须是表单数组`)
    const names = new Set()
    config.modelProviders[type] = rows.map(input => {
      if (!input || typeof input !== 'object') throw new Error(`${PROVIDER_LABELS[type]} 配置格式错误`)
      const row = { ...structuredClone(defaults[type]), id: input.id || randomUUID(), name: String(input.name || '').trim() }
      if (!row.name || names.has(row.name)) throw new Error(`${PROVIDER_LABELS[type]} 名称不能为空或重复：${row.name}`)
      if (!/^[a-zA-Z0-9_-]+$/.test(row.id) || ids.has(row.id)) throw new Error('模型提供商 ID 无效或重复')
      names.add(row.name)
      ids.add(row.id)
      for (const field of PROVIDER_FIELDS[type]) {
        if (Object.hasOwn(input, field)) row[field] = structuredClone(input[field])
      }
      const model = MODEL_FIELDS[type]
      if (Array.isArray(row[model])) row[model] = row[model][0] || ''
      row[URL_FIELDS[type]] = String(row[URL_FIELDS[type]] ?? '').trim().replace(/\/+$/, '')
      return row
    })
  }
  const requireRef = (id, label, type) => {
    if (!id) return
    const row = findProvider(config, id)
    if (!row) throw new Error(`${label}引用的模型提供商不存在，请先改选再删除`)
    if (type && row.type !== type) throw new Error(`${label}只能选择 ${PROVIDER_LABELS[type]}`)
  }
  requireRef(config.defaultProviderId, '默认模型')
  requireRef(config.fallbackProviderId, '失败回退模型')
  if (config.fallbackProviderId) {
    const main = findProvider(config, config.defaultProviderId)
    const backup = findProvider(config, config.fallbackProviderId)
    if (!main || main.type !== backup.type || main.id === backup.id) throw new Error('失败回退模型必须与主模型属于同一协议，且不能选择主模型自身')
  }
  for (const [id, label, type] of [
    [config.imageProviderId, '图片识别'], [config.videoProviderId, '视频识别', 'gemini'],
    [config.geminiSearchProviderId, 'Gemini 原生搜索', 'gemini'],
    [config.translateSource === 'baidu' ? '' : config.translateSource, '翻译'],
    [config.groupReply?.provider === 'current' ? '' : config.groupReply?.provider, '群聊判断'],
    [config.sandboxSubAgentProvider === 'current' ? '' : config.sandboxSubAgentProvider, '子代理']
  ]) requireRef(id, label, type)
  return config
}

export function migrateProviders(config, defaults, oldUse = 'api') {
  if (config.providerConfigVersion === 1) return false
  // 新格式数组即使显式为空也不能被旧数据覆盖。
  if (config.modelProviders) {
    config.providerConfigVersion = 1
    return true
  }
  config.modelProviders = emptyProviders()
  const aliases = {}
  for (const type of Object.keys(PROVIDER_FIELDS)) {
    const row = { ...structuredClone(defaults[type]), id: randomUUID(), name: '默认' }
    for (const field of PROVIDER_FIELDS[type]) if (Object.hasOwn(config, field)) row[field] = config[field]
    config.modelProviders[type].push(row)
    aliases[type] = row.id
  }
  aliases.openai = aliases.api
  config.defaultProviderId = aliases[oldUse] || aliases.api
  config.fallbackProviderId = ''
  const cloneModel = (type, model, name) => {
    const base = config.modelProviders[type][0]
    if (!model || model === base[MODEL_FIELDS[type]]) return base.id
    const row = { ...structuredClone(base), id: randomUUID(), name, [MODEL_FIELDS[type]]: model }
    config.modelProviders[type].push(row)
    return row.id
  }
  const vqa = config.gemini_vqa_model || defaults.gemini.geminiModel
  const search = config.geminiSearchModel || defaults.gemini.geminiModel
  config.imageProviderId = cloneModel('gemini', vqa, vqa === search ? '默认-内容识别与搜索' : '默认-内容识别')
  config.videoProviderId = config.imageProviderId
  config.geminiSearchProviderId = vqa === search ? config.imageProviderId : cloneModel('gemini', search, '默认-搜索')
  config.translateSource = config.translateSource === 'baidu' ? 'baidu' : config.translateSource === 'gemini' ? config.imageProviderId : aliases[config.translateSource] || aliases.api
  const judge = config.groupReply || {}
  if (judge.provider && judge.provider !== 'current') {
    const type = judge.provider === 'openai' ? 'api' : judge.provider
    judge.provider = aliases[type] ? cloneModel(type, judge.model, '默认-群聊判断') : judge.provider
  }
  delete judge.model
  config.groupReply = judge
  if (config.sandboxSubAgentProvider && config.sandboxSubAgentProvider !== 'current') config.sandboxSubAgentProvider = aliases[config.sandboxSubAgentProvider] || config.sandboxSubAgentProvider
  config.providerConfigVersion = 1
  return true
}
