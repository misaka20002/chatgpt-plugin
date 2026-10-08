import { newFetch } from './proxy.js'
import { KEY_FIELDS, URL_FIELDS, providerLabel } from './providerProfiles.js'

const DEFAULT_URLS = {
  api: 'https://api.openai.com/v1', responses: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com'
}
const MAX_BYTES = 4 * 1024 * 1024
const MAX_PAGES = 20

/** 查询所选条目的目录，仅返回名称，不保存列表或修改聊天配置。 */
export async function fetchProviderModels(row) {
  const { type } = row
  if (!DEFAULT_URLS[type]) throw new Error('不支持的模型提供商协议')
  const keys = String(row[KEY_FIELDS[type]] || '').trim()
  const keyList = ['claude', 'gemini'].includes(type) ? keys.split(/[,，;]/).map(key => key.trim()).filter(Boolean) : [keys]
  const apiKey = keyList[Math.floor(Math.random() * keyList.length)]
  if (!apiKey) throw new Error(`${providerLabel(row)} 尚未配置密钥`)
  const baseUrl = String(row[URL_FIELDS[type]] || DEFAULT_URLS[type]).trim().replace(/\/+$/, '')
  const endpoint = new URL(`${baseUrl}${type === 'gemini' ? '/v1beta/models' : type === 'claude' ? '/v1/models' : '/models'}`)
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('模型提供商地址需要使用 http 或 https')
  const headers = { Accept: 'application/json' }
  if (type === 'gemini') headers['x-goog-api-key'] = apiKey
  else if (type === 'claude') Object.assign(headers, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' })
  else headers.Authorization = `Bearer ${apiKey}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000)
  const models = new Set(), seenPages = new Set()
  let cursor = '', received = 0
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(endpoint)
      if (type === 'gemini') {
        url.searchParams.set('pageSize', '1000')
        if (cursor) url.searchParams.set('pageToken', cursor)
      } else if (type === 'claude') {
        url.searchParams.set('limit', '1000')
        if (cursor) url.searchParams.set('after_id', cursor)
      }
      const response = await newFetch(url.href, { headers, redirect: 'error', signal: controller.signal })
      if (!response.ok) {
        controller.abort()
        throw new Error(`模型目录请求失败：HTTP ${response.status}，请检查账号权限及接口是否支持模型列表`)
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && received + declared > MAX_BYTES) { controller.abort(); throw new Error('模型目录超过大小限制') }
      if (!response.body) throw new Error('模型目录响应为空')
      const chunks = []
      for await (const chunk of response.body) {
        received += chunk.byteLength
        if (received > MAX_BYTES) { controller.abort(); throw new Error('模型目录超过大小限制') }
        chunks.push(Buffer.from(chunk))
      }
      let data
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch (err) { throw new Error('模型目录不是有效的 JSON', { cause: err }) }
      const entries = type === 'gemini' ? data?.models : data?.data
      if (!Array.isArray(entries)) throw new Error('模型目录格式错误')
      for (const item of entries) {
        if (type === 'gemini' && Array.isArray(item?.supportedGenerationMethods) && !item.supportedGenerationMethods.includes('generateContent')) continue
        const rawName = type === 'gemini' ? item?.name : item?.id
        const name = typeof rawName === 'string' ? (type === 'gemini' ? rawName.replace(/^models\//, '') : rawName).trim() : ''
        if (name && name.length <= 256 && !/[\s[\]]/.test(name)) models.add(name)
      }
      cursor = type === 'gemini' ? data.nextPageToken : type === 'claude' && data.has_more ? data.last_id : ''
      if (type === 'claude' && data.has_more && !cursor) throw new Error('模型目录缺少下一页游标')
      if (!cursor) {
        if (!models.size) throw new Error('接口未返回可用的模型名称')
        return [...models]
      }
      if (typeof cursor !== 'string' || seenPages.has(cursor)) throw new Error('模型目录分页重复或无效')
      seenPages.add(cursor)
    }
    throw new Error('模型目录超出分页限制')
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('获取模型目录超时，请稍后重试')
    throw err
  } finally { clearTimeout(timeout) }
}
