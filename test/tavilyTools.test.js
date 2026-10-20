/**
 * Tavily 两个工具的测试（票 03）
 *
 * 覆盖点：
 *  1. 提取：20000 上限（原为 2000）、截断标记与 start 续读、Provider/URL/Title 头与不可信声明
 *  2. 提取的失败语义：failed_results 非空时抛出（带失败 URL 与原因）、空结果、非 http(s) 不发请求
 *  3. 提取的既有行为：extract_depth 取值校验、缺 Key 报错、请求字段未新增
 *  4. 搜索：不可信声明、20000 总长封顶、q 参数与请求字段不变、原有摘要文案与空结果文案不变
 *
 * 这两个文件沿用 `throw` 风格（与仓库多数工具的 `return 'Error: …'` 不同），
 * 所以失败用例断言 rejects，而不是返回文本。
 *
 * 运行：npm run test:tools（或 node --test test/tavilyTools.test.js）
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.logger) {
  globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, trace() {}, log() {} }
}

const { TavilyExtractTool } = await import('../utils/tools/TavilyExtractTool.js')
const { TavilyTool } = await import('../utils/tools/TavilyTool.js')
const { Config } = await import('../utils/config.js')
const { MAX_CONTENT_CHARS, UNTRUSTED_NOTICE } = await import('../utils/tools/webContent.js')

const PAGE_URL = 'https://example.com/article'
const realFetch = globalThis.fetch
const realConsoleError = console.error
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

const jsonResponse = payload => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' }
})

const extract = opts => new TavilyExtractTool().func(opts)
const search = opts => new TavilyTool().func(opts)

beforeEach(() => {
  fetchCalls = []
  setConfig({ tavilyKey: 'tvly-test' })
  // 这两个工具在失败路径上会 console.error，测试里静音
  console.error = () => {}
})

afterEach(() => {
  globalThis.fetch = realFetch
  console.error = realConsoleError
})

/* ================= Tavily 提取 ================= */

describe('tavily_website_extract', () => {
  test('正文上限 20000：截断并给出下一次的 start', async () => {
    stubFetch(() => jsonResponse({ results: [{ url: PAGE_URL, title: '长文', raw_content: 'a'.repeat(25000) }] }))

    const result = await extract({ url: PAGE_URL })

    assert.ok(result.startsWith(`Web page content from Tavily for ${PAGE_URL} (${UNTRUSTED_NOTICE}):\nTitle: 长文\n\n`))
    assert.ok(result.endsWith(`\n[truncated to ${MAX_CONTENT_CHARS} characters; continue with start=${MAX_CONTENT_CHARS}]`))
    assert.ok(!result.includes('=== 网页内容提取结果 ==='))
  })

  test('start 续读：正文从偏移处开始，尾段不再有标记', async () => {
    stubFetch(() => jsonResponse({ results: [{ url: PAGE_URL, title: 'T', raw_content: 'x'.repeat(100) + 'START-HERE' + 'y'.repeat(5000) }] }))

    const result = await extract({ url: PAGE_URL, start: 100 })

    assert.ok(result.includes('START-HERE'))
    assert.ok(result.endsWith('y'.repeat(5000)))
    assert.ok(!result.includes('[truncated'))
  })

  test('请求载荷只含 urls 与 extract_depth，不新增参数', async () => {
    stubFetch(() => jsonResponse({ results: [{ url: PAGE_URL, raw_content: 'body' }] }))

    await extract({ url: PAGE_URL, extract_depth: 'advanced' })

    assert.equal(fetchCalls[0].url, 'https://api.tavily.com/extract')
    assert.deepEqual(fetchCalls[0].body, { urls: [PAGE_URL], extract_depth: 'advanced' })
  })

  test('extract_depth 非法时退回 basic', async () => {
    stubFetch(() => jsonResponse({ results: [{ url: PAGE_URL, raw_content: 'body' }] }))

    await extract({ url: PAGE_URL, extract_depth: 'deep' })

    assert.equal(fetchCalls[0].body.extract_depth, 'basic')
  })

  test('failed_results 非空且没有 results：抛出并带上失败 URL 与原因', async () => {
    stubFetch(() => jsonResponse({ results: [], failed_results: [{ url: PAGE_URL, error: 'timeout' }] }))

    await assert.rejects(
      () => extract({ url: PAGE_URL }),
      err => /Tavily 未能提取内容/.test(err.message) && err.message.includes(PAGE_URL) && err.message.includes('timeout')
    )
  })

  test('failed_results 非空时即使带了 results 也按失败处理（单 URL 请求，明细必然针对本页）', async () => {
    stubFetch(() => jsonResponse({
      results: [{ url: PAGE_URL, raw_content: 'half page' }],
      failed_results: [{ url: PAGE_URL, error: 'crawl incomplete' }]
    }))

    await assert.rejects(() => extract({ url: PAGE_URL }), /crawl incomplete/)
  })

  test('正文为空：抛出（沿用本文件的 throw 风格）', async () => {
    stubFetch(() => jsonResponse({ results: [{ url: PAGE_URL, raw_content: '   ' }] }))

    await assert.rejects(() => extract({ url: PAGE_URL }), /没有可读文本/)
  })

  test('start 超出正文长度：抛出', async () => {
    stubFetch(() => jsonResponse({ results: [{ url: PAGE_URL, raw_content: 'abc' }] }))

    await assert.rejects(() => extract({ url: PAGE_URL, start: 10 }), /start 10 超出正文长度/)
  })

  test('start 超出可续读上限：抛出且不发请求', async () => {
    stubFetch(() => jsonResponse({ results: [{ url: PAGE_URL, raw_content: 'abc' }] }))

    await assert.rejects(() => extract({ url: PAGE_URL, start: 9_999_999 }), /超出可续读上限/)
    assert.equal(fetchCalls.length, 0)
  })

  test('空结果且没有失败明细：抛出', async () => {
    stubFetch(() => jsonResponse({ results: [] }))

    await assert.rejects(() => extract({ url: PAGE_URL }), /没有从 .* 提取到内容/)
  })

  test('非 http(s) 地址：抛出且不发请求', async () => {
    stubFetch(() => jsonResponse({ results: [{ raw_content: 'x' }] }))

    await assert.rejects(() => extract({ url: 'file:///etc/passwd' }), /只支持 http\(s\)/)
    assert.equal(fetchCalls.length, 0)
  })

  test('缺 Key：抛出且不发请求', async () => {
    setConfig({ tavilyKey: '' })
    stubFetch(() => jsonResponse({ results: [{ raw_content: 'x' }] }))

    await assert.rejects(() => extract({ url: PAGE_URL }), /Tavily API key is not configured/)
    assert.equal(fetchCalls.length, 0)
  })
})

/* ================= Tavily 搜索 ================= */

describe('tavily_search', () => {
  test('输出带不可信声明；q 参数、请求字段与原有摘要文案不变', async () => {
    stubFetch(() => jsonResponse({
      results: [{ title: '结果一', url: 'https://example.com/1', content: '摘要一' }],
      total_results: 1
    }))

    const result = await search({ q: '今天有什么新闻' })

    assert.ok(result.startsWith(`Web search results from Tavily (${UNTRUSTED_NOTICE}):\n`))
    assert.ok(result.includes('=== Tavily 搜索结果 ==='))
    assert.ok(result.includes('搜索关键词: 今天有什么新闻'))
    assert.ok(result.includes('1. 结果一\n链接: https://example.com/1\n摘要: 摘要一'))
    assert.ok(result.includes('💡 提示'))
    assert.deepEqual(fetchCalls[0].body, { query: '今天有什么新闻', max_results: 5, search_depth: 'basic', topic: 'general' })
  })

  test('总长超过 20000 时截断并加标记', async () => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      title: `结果${i}`,
      url: `https://example.com/${i}`,
      content: 'a'.repeat(2000)
    }))
    stubFetch(() => jsonResponse({ results }))

    const result = await search({ q: 'q' })

    assert.ok(result.endsWith(`\n[truncated to ${MAX_CONTENT_CHARS} characters]`))
    assert.ok(result.length < MAX_CONTENT_CHARS + 100)
  })

  test('没有结果时保持原有文案（无外部内容可声明）', async () => {
    stubFetch(() => jsonResponse({ results: [] }))

    assert.equal(await search({ q: '冷门问题' }), '未找到与"冷门问题"相关的搜索结果。')
  })
})
