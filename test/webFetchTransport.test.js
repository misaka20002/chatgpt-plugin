/**
 * webFetchTransport 单元测试
 *
 * 这是 Exa / Parallel / Tavily 三条读取路径共用的传输层，资源边界与失败语义都在这里。
 * 只通过两个生产入口（`requestText` / `callMcpTool`）测试，不导出内部函数——接缝与
 * 工具测试保持一致。
 *
 * 覆盖点：
 *  1. 字节上限：Content-Length 声明值与流式累计值两处都拦，超限时取消响应体
 *  2. 重定向：固定 redirect: 'manual'，3xx 直接失败（否则认证头会被带去别的域名）
 *  3. 失败归一：超时与环境错误都转成带上下文的错误消息
 *  4. MCP：SSE / 纯 JSON / isError / 非消息
 *
 * 运行：npm run test:tools（或 node --test test/webFetchTransport.test.js）
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const { callMcpTool, requestText } = await import('../utils/tools/webFetchTransport.js')

const realFetch = globalThis.fetch
const ENDPOINT = 'https://api.example.com/x'

afterEach(() => {
  globalThis.fetch = realFetch
})

const streamResponse = (chunkSize, { headers = {}, cancel } = {}) => new Response(new ReadableStream({
  pull(controller) {
    controller.enqueue(new Uint8Array(chunkSize))
  },
  cancel
}), { status: 200, headers })

const jsonResponse = (payload, { status = 200 } = {}) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json' }
})

/* ================= 字节上限 ================= */

describe('字节上限', () => {
  test('Content-Length 声明超限：直接拒绝，不读 body', async () => {
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.close() } }), {
      status: 200,
      headers: { 'content-length': String(8 * 1024 * 1024 + 1) }
    })

    await assert.rejects(() => requestText(ENDPOINT, {}, { timeoutMs: 1000 }), /响应体过大（Content-Length/)
  })

  test('无声明长度的流式响应：累计超限时中断并取消读取', async () => {
    let cancelled = false
    globalThis.fetch = async () => streamResponse(2048, { cancel: () => { cancelled = true } })

    await assert.rejects(
      () => requestText(ENDPOINT, {}, { timeoutMs: 1000, maxBytes: 1024 }),
      /响应体超过上限 1024 字节/
    )
    assert.equal(cancelled, true)
  })

  test('未超限时按 utf8 解码', async () => {
    globalThis.fetch = async () => new Response('中文正文', { status: 200 })

    const { status, body } = await requestText(ENDPOINT, {}, { timeoutMs: 1000, maxBytes: 1024 })

    assert.equal(status, 200)
    assert.equal(body, '中文正文')
  })
})

/* ================= 重定向与失败归一 ================= */

describe('重定向与失败归一', () => {
  test('3xx 拒绝跟随，且请求固定为 manual', async () => {
    let seen
    globalThis.fetch = async (url, options) => {
      seen = options
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })
    }

    await assert.rejects(() => requestText(ENDPOINT, {}, { timeoutMs: 1000 }), /意外的重定向（HTTP 302）/)
    assert.equal(seen.redirect, 'manual')
  })

  test('超时：按传入的秒数报错', async () => {
    globalThis.fetch = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }

    await assert.rejects(() => requestText(ENDPOINT, {}, { timeoutMs: 1000 }), /请求超时（1 秒）/)
  })

  test('网络错误：把 undici 的 cause 带进消息', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
    }

    await assert.rejects(() => requestText(ENDPOINT, {}, { timeoutMs: 1000 }), /请求失败：fetch failed（ECONNRESET）/)
  })

  test('HTTP 非 2xx 时返回状态与响应体，交给调用方决定语义', async () => {
    globalThis.fetch = async () => jsonResponse({ error: 'nope' }, { status: 402 })

    const { status, ok, body } = await requestText(ENDPOINT, {}, { timeoutMs: 1000 })

    assert.equal(status, 402)
    assert.equal(ok, false)
    assert.equal(body, '{"error":"nope"}')
  })
})

/* ================= MCP 调用 ================= */

describe('MCP 调用', () => {
  const call = extra => callMcpTool({
    url: ENDPOINT,
    tool: 'web_fetch',
    args: { urls: ['https://example.com'] },
    timeoutMs: 1000,
    ...extra
  })

  test('SSE：从 data 帧取第一条文本结果', async () => {
    globalThis.fetch = async () => new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'hello' }] } })}\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    )

    assert.equal(await call(), 'hello')
  })

  test('纯 JSON 响应', async () => {
    globalThis.fetch = async () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'plain' }] } })

    assert.equal(await call(), 'plain')
  })

  test('isError：按失败抛出，带上服务端文本', async () => {
    globalThis.fetch = async () => jsonResponse({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'Input validation error' }], isError: true }
    })

    await assert.rejects(() => call(), /Input validation error/)
  })

  test('不是 JSON-RPC 消息：按失败抛出', async () => {
    globalThis.fetch = async () => new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } })

    await assert.rejects(() => call(), /不是 MCP JSON-RPC 消息/)
  })

  test('429：带状态码抛出，供调用方加"填 Key"提示', async () => {
    globalThis.fetch = async () => jsonResponse({}, { status: 429 })

    await assert.rejects(() => call(), err => err.status === 429 && /HTTP 429/.test(err.message))
  })
})
