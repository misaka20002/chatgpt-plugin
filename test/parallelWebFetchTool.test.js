/**
 * ParallelWebFetchTool 单元测试
 *
 * 覆盖点：
 *  1. 请求形状：Parallel MCP 的 `web_fetch`、`full_content: true`、`session_id`；配了 Key 才带 Bearer
 *  2. 正文拼装：`results[0].excerpts` 按空行拼接；标题缺失时给占位
 *  3. 会话标识：32 位十六进制、同一群稳定、不同群不同、不含真实群号；与联网搜索共用同一份实现
 *  4. 失败必须显式：per-URL errors、空 results、429（提示可配 Key）、超时 90 秒
 *  5. 回填边界：20000 截断与 start 续读与其他读取工具一致；非法 URL 不发请求
 *
 * 运行：npm run test:tools（或 node --test test/parallelWebFetchTool.test.js）
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.logger) {
  globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, trace() {}, log() {} }
}

const { ParallelWebFetchTool } = await import('../utils/tools/ParallelWebFetchTool.js')
const { Config } = await import('../utils/config.js')
const { MAX_CONTENT_CHARS, UNTRUSTED_NOTICE } = await import('../utils/tools/webContent.js')

const ENDPOINT = 'https://search.parallel.ai/mcp'
const PAGE_URL = 'https://example.com/article'
const GROUP_ID = 736450001
const event = { group_id: GROUP_ID, user_id: 20002 }

const realFetch = globalThis.fetch
let fetchCalls = []

function setConfig(patch) {
  Object.assign(Config.getConfig(), patch)
}

function stubFetch(handler) {
  globalThis.fetch = async (url, options) => {
    const call = { url: String(url), options, body: options?.body ? JSON.parse(options.body) : undefined }
    fetchCalls.push(call)
    return handler(call)
  }
}

const jsonResponse = (payload, { status = 200 } = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' }
})

const mcpResult = (text, extra = {}) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }], ...extra } })

/** Parallel 的真实形态：纯 JSON，正文是字符串化的 JSON */
const pageResponse = payload => jsonResponse(mcpResult(JSON.stringify(payload)))

const read = (opts = { url: PAGE_URL }, e = event) => new ParallelWebFetchTool().func(opts, e)

beforeEach(() => {
  fetchCalls = []
  setConfig({ parallelApiKey: '' })
})

afterEach(() => {
  globalThis.fetch = realFetch
})

/* ================= 请求形状与正文拼装 ================= */

describe('请求形状与正文拼装', () => {
  test('调用 web_fetch，带 full_content 与 session_id；未配 Key 不带认证头', async () => {
    stubFetch(() => pageResponse({ results: [{ url: PAGE_URL, title: 'Title', excerpts: ['hello'] }] }))

    const result = await read()

    assert.deepEqual(fetchCalls.map(call => call.url), [ENDPOINT])
    const { options, body } = fetchCalls[0]
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(body.method, 'tools/call')
    assert.equal(body.params.name, 'web_fetch')
    assert.deepEqual(body.params.arguments.urls, [PAGE_URL])
    assert.equal(body.params.arguments.full_content, true)
    assert.match(body.params.arguments.session_id, /^[0-9a-f]{32}$/)
    assert.ok(result.startsWith(`Web page content from Parallel for ${PAGE_URL} (${UNTRUSTED_NOTICE}):\nTitle: Title\n\n`))
    assert.ok(result.includes('hello'))
  })

  test('配了 Key 时带 Bearer；Key 不进 URL', async () => {
    setConfig({ parallelApiKey: ' par-secret ' })
    stubFetch(() => pageResponse({ results: [{ url: PAGE_URL, title: 'T', excerpts: ['b'] }] }))

    await read()

    const { url, options } = fetchCalls[0]
    assert.equal(options.headers.Authorization, 'Bearer par-secret')
    assert.ok(!url.includes('par-secret'))
  })

  test('excerpts 按空行拼接；标题缺失时给占位', async () => {
    stubFetch(() => pageResponse({ results: [{ url: PAGE_URL, excerpts: ['first', 'second'] }] }))

    const result = await read()

    assert.ok(result.includes('Title: (untitled)'))
    assert.ok(result.includes('first\n\nsecond'))
  })

  test('session_id 同一群稳定、不同群不同、不含真实群号', async () => {
    stubFetch(() => pageResponse({ results: [{ url: PAGE_URL, excerpts: ['x'] }] }))

    await read({ url: PAGE_URL }, event)
    await read({ url: PAGE_URL }, event)
    await read({ url: PAGE_URL }, { group_id: GROUP_ID + 1 })

    const ids = fetchCalls.map(call => call.body.params.arguments.session_id)
    assert.equal(ids[1], ids[0])
    assert.notEqual(ids[2], ids[0])
    for (const id of ids) {
      assert.match(id, /^[0-9a-f]{32}$/)
      assert.ok(!id.includes(String(GROUP_ID)))
    }
  })
})

/* ================= 回填边界 ================= */

describe('回填边界', () => {
  test('超过 20000 字符：截断并给出下一次的 start', async () => {
    stubFetch(() => pageResponse({ results: [{ url: PAGE_URL, title: 'T', excerpts: ['a'.repeat(25000)] }] }))

    const result = await read()

    assert.ok(result.endsWith(`\n[truncated to ${MAX_CONTENT_CHARS} characters; continue with start=${MAX_CONTENT_CHARS}]`))
  })

  test('start 续读：正文从偏移处开始，尾段不再有标记', async () => {
    stubFetch(() => pageResponse({ results: [{ url: PAGE_URL, title: 'T', excerpts: ['a'.repeat(25000)] }] }))

    const result = await read({ url: PAGE_URL, start: MAX_CONTENT_CHARS })

    assert.equal(fetchCalls[0].body.params.arguments.full_content, true)
    assert.ok(result.endsWith('a'.repeat(5000)))
    assert.ok(!result.includes('[truncated'))
  })

  test('start 越界按失败返回', async () => {
    stubFetch(() => pageResponse({ results: [{ url: PAGE_URL, excerpts: ['abc'] }] }))

    assert.match(await read({ url: PAGE_URL, start: 99 }), /^Error: start 99 超出正文长度/)
  })

  test('excerpts 为空按失败返回', async () => {
    stubFetch(() => pageResponse({ results: [{ url: PAGE_URL, title: 'T', excerpts: [] }] }))

    assert.match(await read(), /^Error: 页面没有可读文本$/)
  })
})

/* ================= 失败必须显式 ================= */

describe('失败必须显式', () => {
  test('per-URL errors：带上 error_type 与 HTTP 状态码', async () => {
    stubFetch(() => pageResponse({ results: [], errors: [{ url: PAGE_URL, error_type: 'http_error', http_status_code: 403 }] }))

    const result = await read()

    assert.match(result, /^Error: Parallel 网页读取失败（Parallel 未能提取内容/)
    assert.match(result, /http_error（HTTP 403）/)
  })

  test('空 results 且没有 errors：按失败返回', async () => {
    stubFetch(() => pageResponse({ results: [], errors: [] }))

    assert.match(await read(), /没有返回页面内容/)
  })

  test('429：提示可配置 Parallel API Key', async () => {
    stubFetch(() => jsonResponse({}, { status: 429 }))

    const result = await read()

    assert.match(result, /^Error: Parallel 网页读取失败（触发限流（HTTP 429，可在锅巴填写 Parallel API Key/)
  })

  test('isError：按失败返回', async () => {
    stubFetch(() => jsonResponse(mcpResult('MCP error -32602: Input validation error', { isError: true })))

    assert.match(await read(), /Input validation error/)
  })

  test('返回文本不是 JSON：按失败返回', async () => {
    stubFetch(() => jsonResponse(mcpResult('not json')))

    assert.match(await read(), /不是预期的 JSON/)
  })

  test('超时按 90 秒口径报错', async () => {
    stubFetch(() => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') })

    assert.match(await read(), /请求超时（90 秒）/)
  })
})

/* ================= 输入边界 ================= */

describe('输入边界', () => {
  const invalid = [
    ['缺 url', {}],
    ['空串', { url: '' }],
    ['file:// 协议', { url: 'file:///etc/passwd' }],
    ['内嵌用户名密码', { url: 'https://user:pass@example.com/a' }],
    ['不是合法 URL', { url: 'not-a-url' }]
  ]

  for (const [name, opts] of invalid) {
    test(`${name}：直接报错且不发请求`, async () => {
      stubFetch(() => pageResponse({ results: [{ url: PAGE_URL, excerpts: ['x'] }] }))

      const result = await read(opts)

      assert.match(result, /^Error: /)
      assert.equal(fetchCalls.length, 0)
    })
  }
})
