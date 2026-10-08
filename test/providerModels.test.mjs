import { test, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { KEY_FIELDS, URL_FIELDS } from '../utils/providerProfiles.js'

let config, network, requests, replies, forwards
const Config = { getConfig: () => config, commit() { assert.fail('查询模型列表不能保存配置') } }
mock.module('../utils/config.js', { namedExports: { Config } })
mock.module('../utils/proxy.js', { namedExports: { newFetch: async (url, options) => {
  requests.push({ url, options })
  return network(url, options)
} } })
mock.module('../../../lib/plugins/plugin.js', { defaultExport: class { constructor(options) { Object.assign(this, options) } } })
mock.module('../utils/common.js', { namedExports: { makeForwardMsg: async (event, messages, title) => {
  forwards.push({ messages, title }); return { type: 'forward', messages }
} } })
const { fetchProviderModels } = await import('../utils/providerModels.js')
const { ProviderManagement } = await import('../apps/providers.js')
const row = (type, id = type) => ({ type, id, name: `我的${id}`, [KEY_FIELDS[type]]: `${id}-key`, [URL_FIELDS[type]]: `https://${id}.invalid/proxy` })
const event = { isMaster: true, user_id: 1, msg: '#chatgpt获取可用模型', reply: async text => replies.push(text) }
const directory = names => Response.json({ models: names.map(name => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] })) })
beforeEach(() => {
  requests = []; replies = []; forwards = []
  config = { defaultProviderId: 'api', fallbackProviderId: '', modelProviders: Object.fromEntries(['api', 'responses', 'claude', 'gemini'].map(type => [type, [row(type)]])) }
  network = async () => directory(['gemini-fixture'])
})

test('四协议按条目地址和认证请求模型目录，不使用全局账号，也不在 URL 中携带密钥', async () => {
  for (const type of ['api', 'responses', 'claude', 'gemini']) {
    network = async () => type === 'gemini' ? directory(['custom-model']) : Response.json({ data: [{ id: 'custom-model' }] })
    assert.deepEqual(await fetchProviderModels(row(type)), ['custom-model'])
    const { url, options } = requests.at(-1)
    assert.equal(new URL(url).pathname, `/proxy${type === 'gemini' ? '/v1beta' : type === 'claude' ? '/v1' : ''}/models`)
    assert.equal(new URL(url).hostname, `${type}.invalid`)
    assert.ok(!url.includes(`${type}-key`))
    assert.equal(options.headers[type === 'gemini' ? 'x-goog-api-key' : type === 'claude' ? 'x-api-key' : 'Authorization'], ['api', 'responses'].includes(type) ? `Bearer ${type}-key` : `${type}-key`)
    if (type === 'claude') assert.equal(options.headers['anthropic-version'], '2023-06-01')
    assert.equal(options.redirect, 'error')
  }
})

test('Gemini 和 Claude 读取完整分页、去重；Gemini 排除不支持对话的模型', async () => {
  network = async () => requests.length === 1
    ? Response.json({ models: [{ name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'page+2' })
    : Response.json({ models: [{ name: 'models/gemini-a' }, { name: 'models/custom-b' }] })
  assert.deepEqual(await fetchProviderModels(row('gemini')), ['gemini-a', 'custom-b'])
  assert.equal(requests.length, 2)
  assert.equal(new URL(requests[1].url).searchParams.get('pageToken'), 'page+2')
  requests = []
  network = async () => requests.length === 1
    ? Response.json({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'cursor-a' })
    : Response.json({ data: [{ id: 'claude-a' }, { id: 'claude-b' }], has_more: false })
  assert.deepEqual(await fetchProviderModels(row('claude')), ['claude-a', 'claude-b'])
  assert.equal(requests.length, 2)
  assert.equal(new URL(requests[1].url).searchParams.get('after_id'), 'cursor-a')
})

test('HTTP、格式、分页和响应边界失败不返回不完整目录，正文读取超时也能正确提示', async () => {
  const cases = [
    [() => new Response('unauthorized', { status: 401 }), /HTTP 401/],
    [() => new Response('not found', { status: 404 }), /HTTP 404/],
    [() => new Response('not JSON'), /有效的 JSON/],
    [() => Response.json({ error: 'failed' }), /格式错误/],
    [() => directory([]), /未返回/],
    [() => Response.json({ models: [], nextPageToken: 'repeat' }), /分页重复/],
    [() => Response.json({ models: [], nextPageToken: `${requests.length}` }), /分页限制/],
    [() => new Response('{}', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }), /大小限制/],
    [() => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(3 * 1024 * 1024))
      controller.enqueue(new Uint8Array(2 * 1024 * 1024))
      controller.close()
    } })), /大小限制/],
    [() => new Response(new ReadableStream({ start(controller) { controller.error(new DOMException('aborted', 'AbortError')) } })), /超时/]
  ]
  for (const [fetch, error] of cases) {
    requests = []; network = fetch
    await assert.rejects(fetchProviderModels(row('gemini')), error)
  }
  network = async () => Response.json({ data: [{ id: 'claude-a' }], has_more: true })
  await assert.rejects(fetchProviderModels(row('claude')), /缺少下一页/)
})

function menu(answer, onAnswer = () => {}) {
  const instance = new ProviderManagement()
  instance.awaitContext = async (unused, timeout) => {
    assert.equal(timeout, 60)
    onAnswer()
    return answer === undefined ? null : { ...event, msg: answer }
  }
  return instance
}

test('指令列出全部条目，数字选取指定账号查询并提示自行填写；不会保存或切换主备', async () => {
  const before = structuredClone(config)
  const app = menu('4')
  await app.availableModels(event)
  for (const type of ['Chat API', 'Responses API', 'Claude', 'Gemini']) assert.ok(replies[0].includes(type))
  assert.equal(requests.length, 1)
  assert.equal(new URL(requests[0].url).hostname, 'gemini.invalid')
  assert.match(replies.at(-1), /gemini-fixture/)
  assert.match(replies.at(-1), /填入锅巴/)
  assert.deepEqual(config, before)
  assert.ok(app.rule.some(r => r.reg.test(event.msg) && r.fnc === 'availableModels' && r.permission === 'master'))
  assert.equal(app.task, undefined)
})

test('菜单按稳定 ID 查询；重排不选错，删除或缺少密钥会取消请求', async () => {
  config.modelProviders.gemini.push(row('gemini', 'other'))
  await menu('4', () => config.modelProviders.gemini.reverse()).availableModels(event)
  assert.equal(new URL(requests.at(-1).url).hostname, 'gemini.invalid')
  requests = []
  await menu('4', () => { config.modelProviders.gemini = [] }).availableModels(event)
  assert.equal(requests.length, 0)
  assert.match(replies.at(-1), /已删除/)
  config.modelProviders.api[0].apiKey = ''
  await menu('1').availableModels(event)
  assert.equal(requests.length, 0)
  assert.match(replies.at(-1), /尚未配置密钥/)
})

test('非主人、其他用户代答、取消、超时和无效序号不查询', async () => {
  for (const answer of ['取消', '0', undefined, '1abc', '99']) await menu(answer).availableModels(event)
  await menu('4').availableModels({ ...event, isMaster: false })
  const app = menu('4')
  app.awaitContext = async () => ({ ...event, user_id: 2, msg: '4' })
  await app.availableModels(event)
  assert.equal(requests.length, 0)
})

test('长列表合并转发完整名称，查询失败如实提示，不要求保存配置', async () => {
  const models = Array.from({ length: 180 }, (_, i) => `custom-long-model-name-${i}`)
  network = async () => directory(models)
  await menu('4').availableModels(event)
  assert.equal(forwards.length, 1)
  assert.ok(forwards[0].messages.length < 90)
  const shown = forwards[0].messages.slice(1, -1).flatMap(chunk => chunk.trim().split('\n'))
  assert.deepEqual(shown, models)
  network = async () => new Response('', { status: 403 })
  await menu('4').availableModels(event)
  assert.match(replies.at(-1), /未完成.*HTTP 403/)
})
