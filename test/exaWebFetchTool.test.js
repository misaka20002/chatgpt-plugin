/**
 * ExaWebFetchTool 单元测试
 *
 * 覆盖点：
 *  1. 两条通道的选择与请求形状：无 Key 走 MCP `web_fetch_exa`（不带认证头）、有 Key 走 REST
 *     `/contents`（Key 只在 x-api-key 头）；两条通道都按 start + 20000 申请
 *  2. 响应形态：MCP 的 SSE 帧、MCP 文本本身是 JSON、REST 的 results[]
 *  3. 回填边界：20000 截断、截断标记里的续读偏移、空正文、越界 start
 *  4. 失败必须显式：402 / 429 / 5xx / isError / statuses 报错 / 空结果 / 免费额度限流提示
 *  5. 输入边界：缺 url、非 http(s)、内嵌凭证时直接报错且不发请求
 *
 * 运行：npm run test:tools（或 node --test test/exaWebFetchTool.test.js）
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.logger) {
  globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, trace() {}, log() {} }
}

const { ExaWebFetchTool } = await import('../utils/tools/ExaWebFetchTool.js')
const { Config } = await import('../utils/config.js')
const { MAX_CONTENT_CHARS, UNTRUSTED_NOTICE } = await import('../utils/tools/webContent.js')

const MCP_ENDPOINT = 'https://mcp.exa.ai/mcp'
const REST_ENDPOINT = 'https://api.exa.ai/contents'
const PAGE_URL = 'https://example.com/article'
const EXA_RATE_LIMIT_NOTICE = "You've hit Exa's free MCP rate limit. To continue using without limits, create your own Exa API key."

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

/** Exa MCP 的真实形态：SSE（event: message + data 帧） */
const sseResponse = message => new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
  status: 200,
  headers: { 'content-type': 'text/event-stream' }
})

const mcpResult = (text, extra = {}) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }], ...extra } })

const read = (opts = { url: PAGE_URL }) => new ExaWebFetchTool().func(opts)

/** 拆出返回文本里的标题行与正文（正文含截断标记） */
function split(result) {
  const marker = result.indexOf('\n\n')
  return { head: result.slice(0, marker), body: result.slice(marker + 2) }
}

beforeEach(() => {
  fetchCalls = []
  setConfig({ exaApiKey: '' })
})

afterEach(() => {
  globalThis.fetch = realFetch
})

/* ================= 通道选择与请求形状 ================= */

describe('通道选择与请求形状', () => {
  test('无 Key：走 MCP，不带认证头；输出带来源、地址、标题与不可信声明', async () => {
    stubFetch(() => sseResponse(mcpResult('# Title\n\nhello world')))

    const result = await read()

    assert.deepEqual(fetchCalls.map(call => call.url), [MCP_ENDPOINT])
    const { options, body } = fetchCalls[0]
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers['x-api-key'], undefined)
    assert.equal(options.headers.Authorization, undefined)
    assert.deepEqual(body, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'web_fetch_exa', arguments: { urls: [PAGE_URL], maxCharacters: MAX_CONTENT_CHARS } }
    })
    assert.ok(result.startsWith(`Web page content from Exa for ${PAGE_URL} (${UNTRUSTED_NOTICE}):\nTitle: (untitled)\n\n`))
    assert.ok(result.includes('hello world'))
  })

  test('有 Key：走 REST，Key 只在 x-api-key 头、不进 URL；请求体按 start + 20000 申请', async () => {
    setConfig({ exaApiKey: ' exa-secret ' })
    stubFetch(() => jsonResponse({ results: [{ url: PAGE_URL, title: 'REST 标题', text: 'rest body' }] }))

    const result = await read()

    assert.deepEqual(fetchCalls.map(call => call.url), [REST_ENDPOINT])
    const { url, options, body } = fetchCalls[0]
    assert.ok(!url.includes('exa-secret'))
    assert.equal(options.headers['x-api-key'], 'exa-secret')
    assert.equal(options.headers.Authorization, undefined)
    assert.deepEqual(body, { urls: [PAGE_URL], text: { maxCharacters: MAX_CONTENT_CHARS } })
    assert.ok(result.includes('Title: REST 标题'))
    assert.ok(result.includes('rest body'))
  })

  test('MCP 文本本身是 JSON 时，取 results[0] 的 title 与 text', async () => {
    stubFetch(() => sseResponse(mcpResult(JSON.stringify({ results: [{ url: PAGE_URL, title: 'JSON 标题', text: 'json body' }] }))))

    const result = await read()

    assert.ok(result.includes('Title: JSON 标题'))
    assert.ok(result.includes('json body'))
    assert.ok(!result.includes('{"results"'))
  })

  test('MCP 返回纯 JSON-RPC（非 SSE）时同样能解析', async () => {
    stubFetch(() => jsonResponse(mcpResult('plain body')))

    const result = await read()

    assert.ok(result.includes('plain body'))
  })
})

/* ================= 回填边界 ================= */

describe('回填边界', () => {
  test('超过 20000 字符：截断并给出下一次的 start', async () => {
    stubFetch(() => sseResponse(mcpResult('a'.repeat(25000))))

    const result = await read()

    const { body } = split(result)
    assert.equal(body.length, MAX_CONTENT_CHARS + `\n[truncated to ${MAX_CONTENT_CHARS} characters; continue with start=${MAX_CONTENT_CHARS}]`.length)
    assert.ok(result.endsWith(`\n[truncated to ${MAX_CONTENT_CHARS} characters; continue with start=${MAX_CONTENT_CHARS}]`))
  })

  test('start 续读：按 start + 20000 申请，正文从偏移处开始，尾段不再有标记', async () => {
    stubFetch(() => sseResponse(mcpResult('a'.repeat(25000))))

    const result = await read({ url: PAGE_URL, start: MAX_CONTENT_CHARS })

    assert.equal(fetchCalls[0].body.params.arguments.maxCharacters, MAX_CONTENT_CHARS * 2)
    const { body } = split(result)
    assert.equal(body.length, 5000)
    assert.ok(!result.includes('[truncated'))
  })

  test('start 不是数字或为负时按 0 处理', async () => {
    stubFetch(() => sseResponse(mcpResult('abc')))

    const negative = await read({ url: PAGE_URL, start: -5 })
    const garbage = await read({ url: PAGE_URL, start: 'abc' })

    assert.equal(fetchCalls[0].body.params.arguments.maxCharacters, MAX_CONTENT_CHARS)
    assert.equal(fetchCalls[1].body.params.arguments.maxCharacters, MAX_CONTENT_CHARS)
    assert.ok(negative.includes('abc'))
    assert.ok(garbage.includes('abc'))
  })

  test('空正文按失败返回', async () => {
    stubFetch(() => sseResponse(mcpResult('   ')))

    assert.match(await read(), /^Error: 页面没有可读文本$/)
  })

  test('start 超出正文长度按失败返回', async () => {
    stubFetch(() => sseResponse(mcpResult('abc')))

    assert.match(await read({ url: PAGE_URL, start: 10 }), /^Error: start 10 超出正文长度/)
  })
})

/* ================= 失败必须显式 ================= */

describe('失败必须显式，不能当成页面正文', () => {
  const cases = [
    ['REST 402（额度/Key 不可用）', { key: 'exa-key' }, () => jsonResponse({ error: 'payment required' }, { status: 402 }), /^Error: Exa 网页读取失败（HTTP 402/],
    ['REST 429', { key: 'exa-key' }, () => jsonResponse({}, { status: 429 }), /触发限流（HTTP 429）/],
    ['REST 500', { key: 'exa-key' }, () => jsonResponse({ error: 'internal' }, { status: 500 }), /HTTP 500/],
    ['REST statuses 报错且没有结果', { key: 'exa-key' }, () => jsonResponse({ results: [], statuses: [{ id: PAGE_URL, status: 'error', error: 'CRAWL_NOT_FOUND' }] }), /CRAWL_NOT_FOUND/],
    ['REST 空结果且没有失败明细', { key: 'exa-key' }, () => jsonResponse({ results: [] }), /没有返回页面内容/],
    ['MCP isError', {}, () => sseResponse(mcpResult('MCP error -32602: Input validation error', { isError: true })), /Input validation error/],
    ['MCP JSON-RPC error', {}, () => sseResponse({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'internal' } }), /internal/],
    ['MCP HTTP 429', {}, () => jsonResponse({}, { status: 429 }), /触发限流（HTTP 429）/],
    ['MCP 免费额度限流提示（HTTP 200 普通结果）', {}, () => sseResponse(mcpResult(EXA_RATE_LIMIT_NOTICE)), /免费额度已触发限流/],
    ['MCP 空文本', {}, () => sseResponse(mcpResult('')), /页面没有可读文本/],
    ['不是 MCP 消息的 HTML 错误页', {}, () => new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } }), /不是 MCP JSON-RPC 消息/],
    ['超时', {}, () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }, /请求超时（30 秒）/],
    ['重定向被拒绝', {}, () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }), /意外的重定向（HTTP 302）/]
  ]

  for (const [name, { key }, handler, reason] of cases) {
    test(name, async () => {
      if (key) setConfig({ exaApiKey: key })
      stubFetch(handler)

      const result = await read()

      assert.match(result, /^Error: /)
      assert.match(result, reason)
    })
  }

  test('正常正文里提到 "free MCP rate limit" 不会被误判', async () => {
    stubFetch(() => sseResponse(mcpResult("How to avoid Exa's free MCP rate limit\n\nbody")))

    const result = await read()

    assert.ok(result.startsWith('Web page content from Exa'))
  })
})

/* ================= 输入边界 ================= */

describe('输入边界', () => {
  const invalid = [
    ['缺 url', {}],
    ['空串', { url: '   ' }],
    ['非字符串', { url: 42 }],
    ['file:// 协议', { url: 'file:///etc/passwd' }],
    ['ftp:// 协议', { url: 'ftp://example.com/a' }],
    ['内嵌用户名密码', { url: 'https://user:pass@example.com/a' }],
    ['不是合法 URL', { url: 'not-a-url' }]
  ]

  for (const [name, opts] of invalid) {
    test(`${name}：直接报错且不发请求`, async () => {
      stubFetch(() => sseResponse(mcpResult('should not be reached')))

      const result = await read(opts)

      assert.match(result, /^Error: /)
      assert.equal(fetchCalls.length, 0)
    })
  }
})
