/**
 * webFetchTransport 单元测试
 *
 * 这是 Exa / Parallel / Tavily 三条读取路径共用的传输层，资源边界与失败语义都在这里，
 * 所以单独测一层（不经过具体工具）：
 *  1. 字节上限：Content-Length 声明值与流式累计值两处都拦，超限时取消响应体
 *  2. 重定向：固定 redirect: 'manual'，3xx 直接失败（否则认证头会被带去别的域名）
 *  3. 失败归一：超时与环境错误都转成带上下文的错误消息
 *  4. MCP 解析：SSE / 纯 JSON / 非消息
 *
 * 运行：npm run test:tools（或 node --test test/webFetchTransport.test.js）
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const {
  MAX_RESPONSE_BYTES,
  parseMcpMessage,
  readBodyLimited,
  requestText
} = await import('../utils/tools/webFetchTransport.js')

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const streamResponse = (chunkSize, { headers = {} } = {}) => new Response(new ReadableStream({
  pull(controller) {
    controller.enqueue(new Uint8Array(chunkSize))
  }
}), { status: 200, headers })

/* ================= 字节上限 ================= */

describe('字节上限', () => {
  test('Content-Length 声明超限：直接拒绝，不读 body', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.close() } }), {
      status: 200,
      headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) }
    })

    await assert.rejects(() => readBodyLimited(response), /响应体过大（Content-Length/)
  })

  test('无声明长度的流式响应：累计超限时中断并取消读取', async () => {
    let cancelled = false
    const response = new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(2048))
      },
      cancel() {
        cancelled = true
      }
    }), { status: 200 })

    await assert.rejects(() => readBodyLimited(response, 1024), /响应体超过上限 1024 字节/)
    assert.equal(cancelled, true)
  })

  test('未超限时按 utf8 解码', async () => {
    const response = new Response('中文正文', { status: 200 })

    assert.equal(await readBodyLimited(response, 1024), '中文正文')
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

    await assert.rejects(() => requestText('https://api.example.com/x', {}, { timeoutMs: 1000 }), /意外的重定向（HTTP 302）/)
    assert.equal(seen.redirect, 'manual')
  })

  test('超时：按传入的秒数报错', async () => {
    globalThis.fetch = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }

    await assert.rejects(() => requestText('https://api.example.com/x', {}, { timeoutMs: 1000 }), /请求超时（1 秒）/)
  })

  test('网络错误：把 undici 的 cause 带进消息', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
    }

    await assert.rejects(() => requestText('https://api.example.com/x', {}, { timeoutMs: 1000 }), /请求失败：fetch failed（ECONNRESET）/)
  })
})

/* ================= MCP 消息解析 ================= */

describe('MCP 消息解析', () => {
  test('SSE：从 data 帧里取出 JSON-RPC 消息', () => {
    const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [] } })}\n\n`

    assert.deepEqual(parseMcpMessage(body)?.result, { content: [] })
  })

  test('纯 JSON 响应', () => {
    assert.deepEqual(parseMcpMessage(JSON.stringify({ jsonrpc: '2.0', error: { message: 'boom' } }))?.error, { message: 'boom' })
  })

  test('不是 JSON-RPC 消息时返回 null', () => {
    assert.equal(parseMcpMessage('<html>blocked</html>'), null)
    assert.equal(parseMcpMessage('{"foo":1}'), null)
  })
})
