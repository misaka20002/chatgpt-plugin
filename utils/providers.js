import { Config } from './config.js'
import { findProvider, MODEL_FIELDS, PROVIDER_FIELDS, connectionVersion } from './providerProfiles.js'

export function resolveProvider(id = Config.defaultProviderId, source = Config.getConfig()) {
  const reference = id === 'current' ? source.defaultProviderId : id
  const row = findProvider(source, reference)
  if (!row) throw new Error('模型提供商未配置或已删除，请在锅巴重新选择')
  return structuredClone(row)
}

/** 请求独占的配置视图；不从其他条目补取连接或模型参数。 */
export function providerConfig(row, source = Config.getConfig()) {
  const config = { ...structuredClone(source), ...structuredClone(row) }
  Object.defineProperty(config, 'getGeminiKey', { get() {
    const keys = String(config.geminiKey || '').split(/[,，;]/).map(key => key.trim()).filter(Boolean)
    return keys[Math.floor(Math.random() * keys.length)] || ''
  } })
  return config
}

export function currentProviderType() { return resolveProvider().type }
export function currentProviderId() { return Config.defaultProviderId }
export function currentProviderConfig() { return providerConfig(resolveProvider()) }
export function providerModel(row) { return row[MODEL_FIELDS[row.type]] || '' }
export function providerConversationKey(row, scope) {
  return `CHATGPT:CONVERSATIONS_V2:${row.id}:${connectionVersion(row)}:${scope}`
}

export function updateProvider(id, changes) {
  const candidate = structuredClone(Config.getConfig())
  const found = resolveProvider(id, candidate)
  const row = candidate.modelProviders[found.type].find(row => row.id === id)
  for (const [field, value] of Object.entries(changes)) {
    if (!PROVIDER_FIELDS[found.type].includes(field)) throw new Error('该设置不属于当前模型提供商')
    row[field] = value
  }
  Config.commit(candidate)
}
