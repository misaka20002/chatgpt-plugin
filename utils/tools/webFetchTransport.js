/**
 * 托管网页提取服务的传输层。
 *
 * Exa 与 Parallel 的公开 MCP 都走 Streamable HTTP：POST 一次 JSON-RPC `tools/call`，
 * 响应可能是纯 JSON（Parallel）也可能是 SSE（Exa）；Exa 配了 Key 时改走 REST `/contents`。
 * 两条路的共同点（响应体字节上限、拒绝跟随重定向、超时归一、错误显式）集中在这里，
 * 避免两个工具各写一遍导致其中一份漏掉资源边界。
 */

import { clipForError } from './webContent.js'

/**
 * 响应体字节上限。Parallel 的 `full_content` 会返回整页（实测 Node 文档 80 万字符），
 * 256 KiB 那种搜索工具的口径在这里会直接误杀正常页面，所以放到 8 MiB。
 */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/** 传输层自己的错误：消息已带好上下文，上层不要再拼一次 */
export class WebFetchError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number }} [meta] HTTP 状态码（拿不到响应时为 0）
   */
  constructor(message, { status = 0 } = {}) {
    super(message)
    this.name = 'WebFetchError'
    this.status = status
  }
}


/**
 * 取消尚未消费的响应体，否则连接不能及时复用。
 * @param {Response} response
 */
async function cancelBody(response) {
  try {
    await response.body?.cancel()
  } catch {
    // body 已被消费或已锁定时 cancel 会抛，属于预期情况
  }
}

/**
 * 流式读取响应体并限制字节数：Content-Length 声明值与实际累计值两处都拦
 * （chunked / SSE 响应拿不到声明值）。
 * @param {Response} response
 * @param {number} [maxBytes]
 * @returns {Promise<Buffer>}
 */
async function readBytesLimited(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelBody(response)
    throw new WebFetchError(`响应体过大（Content-Length ${declared} 字节 > 上限 ${maxBytes}）`)
  }
  if (!response.body) {
    return Buffer.alloc(0)
  }
  const reader = response.body.getReader()
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new WebFetchError(`响应体超过上限 ${maxBytes} 字节，已中断读取`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * 找出响应体里的 JSON-RPC 消息：服务端可以直接回 JSON，也可以回 SSE
 * （逐行 `data: {...}`）。与 opencode 的 parseResponse 同一思路：先整段当 JSON，不行再找帧。
 * @param {string} body
 * @returns {object|null}
 */
function parseMcpMessage(body) {
  const candidates = [body.trim()]
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('data:')) candidates.push(line.slice(5).trim())
  }
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue
    try {
      const message = JSON.parse(candidate)
      if (message?.result || message?.error) return message
    } catch {
      // SSE 流里可能夹着非 JSON 的帧，跳过继续找
    }
  }
  return null
}

/**
 * 发一次请求并读完响应体（带超时与字节上限）。
 *
 * `redirect` 固定为 `manual`：这两个端点不需要重定向，而自动跟随会把 x-api-key /
 * Authorization 原样带去另一个域名。
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ timeoutMs: number, maxBytes?: number }} limits
 * @returns {Promise<{ status: number, ok: boolean, body: string }>}
 */
export async function requestText(url, options, { timeoutMs, maxBytes = MAX_RESPONSE_BYTES }) {
  const { status, ok, body } = await requestBinary(url, options, { timeoutMs, maxBytes })
  if (status >= 300 && status < 400) {
    throw new WebFetchError(`返回了意外的重定向（HTTP ${status}），已拒绝跟随`, { status })
  }
  return { status, ok, body: body.toString('utf8') }
}

/**
 * 发一次请求并读完响应体，返回原始字节与 `content-type`。
 *
 * 与 `requestText` 的差别只有两点：不解码（调用方要按 charset 自己解），以及 3xx **不抛错也不跟随**——
 * 本地抓取必须逐跳重新校验目标主机（私网拦截），跟随由调用方的循环负责。
 *
 * `onHeaders` 在读完响应头、读 body 之前调用：本地读取用它按 `content-type` 提前拒掉 PDF
 * 这类内容，否则要把整个文件下完才发现不该读。
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ timeoutMs: number, maxBytes?: number, onHeaders?: (meta: { status: number, ok: boolean, contentType: string }) => void }} limits
 * @returns {Promise<{ status: number, ok: boolean, contentType: string, location: string, body: Buffer }>}
 */
export async function requestBinary(url, options, { timeoutMs, maxBytes = MAX_RESPONSE_BYTES, onHeaders }) {
  let response
  let body
  try {
    response = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    })
    const contentType = response.headers.get('content-type') || ''
    if (response.status >= 300 && response.status < 400) {
      await cancelBody(response)
      return {
        status: response.status,
        ok: false,
        contentType,
        location: response.headers.get('location') || '',
        body: Buffer.alloc(0)
      }
    }
    if (onHeaders) {
      try {
        // 3xx 已在上面返回，这里 meta 里不可能带 location
        onHeaders({ status: response.status, ok: response.ok, contentType })
      } catch (err) {
        await cancelBody(response)
        throw err
      }
    }
    body = await readBytesLimited(response, maxBytes)
  } catch (err) {
    if (err instanceof WebFetchError) throw err
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new WebFetchError(`请求超时（${timeoutMs / 1000} 秒）`)
    }
    const cause = err?.cause?.code || err?.cause?.message
    throw new WebFetchError(`请求失败：${err?.message || err}${cause ? `（${cause}）` : ''}`)
  }
  return {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type') || '',
    location: '',
    body
  }
}

/**
 * 调用一次托管 MCP 工具，返回第一条文本结果。
 *
 * 所有失败都抛 WebFetchError：HTTP 非 2xx、429、JSON-RPC error、`isError`、
 * 不是 MCP 消息。调用方据此返回 `Error: …`，不能把失败文本当成页面正文。
 * @param {{ url: string, tool: string, args: object, headers?: object, timeoutMs: number, maxBytes?: number }} request
 * @returns {Promise<string>}
 */
export async function callMcpTool({ url, tool, args, headers = {}, timeoutMs, maxBytes }) {
  const { status, ok, body } = await requestText(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'chatgpt-plugin',
      ...headers
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })
  }, { timeoutMs, maxBytes })

  const message = parseMcpMessage(body)
  if (status === 429) {
    throw new WebFetchError('触发限流（HTTP 429）', { status })
  }
  if (!ok) {
    const detail = message?.error?.message
    throw new WebFetchError(`HTTP ${status}${detail ? `：${clipForError(detail)}` : ''}`, { status })
  }
  if (!message) {
    throw new WebFetchError('返回的内容不是 MCP JSON-RPC 消息', { status })
  }
  if (message.error) {
    throw new WebFetchError(`服务端报错：${clipForError(message.error.message || JSON.stringify(message.error))}`, { status })
  }
  const content = Array.isArray(message.result?.content) ? message.result.content : []
  const text = content.find(item => typeof item?.text === 'string' && item.text.trim())?.text ?? ''
  if (message.result?.isError) {
    throw new WebFetchError(`服务端报错：${clipForError(text || '未知错误')}`, { status })
  }
  return text
}
