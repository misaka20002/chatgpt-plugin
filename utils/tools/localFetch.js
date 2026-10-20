/**
 * 本地抓取：给一个 URL，把页面正文取回来。
 *
 * 与托管提取（Exa / Parallel / Tavily）的分工：这条路不经过任何第三方，代价是站点看到的是
 * 本机出口 IP，反爬与登录墙一律读不到。它存在的意义是「什么 Key 都没有、也没装浏览器时，
 * 至少还能读一点」。
 *
 * 这里集中处理四件本地抓取特有的事：目标主机校验（私网拦截）、逐跳重定向、响应体边界、
 * 字符集判定。两个工具（搜索、网页读取）共用同一份实现，避免其中一份漏掉边界。
 */

import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { requestBinary, WebFetchError } from './webFetchTransport.js'
import { requireHttpUrl } from './webContent.js'
import { convertHTMLToMarkdown } from './htmlMarkdown.js'
import { stripTags } from './htmlText.js'

/** 响应体上限：与托管提取的 8 MiB 分开，本地抓取只需要正文，5 MiB 足够 */
const MAX_BYTES = 5 * 1024 * 1024

/** 整次抓取（含重定向）的总预算，不是每一跳的 */
const LOCAL_FETCH_TIMEOUT_MS = 30000

/** 最多跟随几跳重定向；每一跳都要重新校验目标主机 */
const MAX_REDIRECTS = 5

/** 从前多少字节里找 `<meta charset>`；声明总在文档很靠前的位置 */
const META_PROBE_BYTES = 4096

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** 只声明「想要什么」，不伪装具体的 Accept-Encoding / sec-ch-ua 指纹 */
const ACCEPT = 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5'

/**
 * 私网与保留地址段。模型可以把任意地址塞进 tool arguments，而这些结果是会发到群里的：
 * `http://127.0.0.1:6099` 就是 Yunzai 自己的管理面板。本地抓取没有中间人，必须自己拦。
 *
 * IPv6 侧按 128 位真实地址判定，不能只匹配字面写法：`::ffff:7f00:1` 与 `::ffff:127.0.0.1`
 * 是同一个地址；`::`、`fec0::/10`（已废弃的 site-local）、`ff00::/8`（组播）同样不可达外部。
 * 这条与 `docs/agent-guides/tools.md` 里既有的媒体地址校验口径一致。
 */
const BLOCKED_RANGES = new BlockList()
BLOCKED_RANGES.addSubnet('0.0.0.0', 8, 'ipv4')
BLOCKED_RANGES.addSubnet('10.0.0.0', 8, 'ipv4')
BLOCKED_RANGES.addSubnet('100.64.0.0', 10, 'ipv4')
BLOCKED_RANGES.addSubnet('127.0.0.0', 8, 'ipv4')
BLOCKED_RANGES.addSubnet('169.254.0.0', 16, 'ipv4')
BLOCKED_RANGES.addSubnet('172.16.0.0', 12, 'ipv4')
BLOCKED_RANGES.addSubnet('192.168.0.0', 16, 'ipv4')
BLOCKED_RANGES.addAddress('::', 'ipv6')
BLOCKED_RANGES.addAddress('::1', 'ipv6')
BLOCKED_RANGES.addSubnet('64:ff9b:1::', 48, 'ipv6')
BLOCKED_RANGES.addSubnet('fc00::', 7, 'ipv6')
BLOCKED_RANGES.addSubnet('fe80::', 10, 'ipv6')
BLOCKED_RANGES.addSubnet('fec0::', 10, 'ipv6')
BLOCKED_RANGES.addSubnet('ff00::', 8, 'ipv6')

/**
 * 把 IPv4-mapped 的 IPv6 还原成 IPv4（`::ffff:127.0.0.1` 与 `::ffff:7f00:1` 两种写法）。
 * 不还原就会漏掉整个 v4 私网——只查 IPv6 段时 `::ffff:127.0.0.1` 不命中任何一条。
 * @param {string} address
 * @returns {string} 还原后的 IPv4，非 mapped 地址返回空串
 */
function mappedIPv4(address) {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  if (dotted) return dotted[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address)
  if (!hex) return ''
  const high = parseInt(hex[1], 16)
  const low = parseInt(hex[2], 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

function isBlockedAddress(address) {
  const family = isIP(address)
  if (!family) return false
  if (family === 6) {
    const v4 = mappedIPv4(address)
    if (v4) return isBlockedAddress(v4)
    return BLOCKED_RANGES.check(address, 'ipv6')
  }
  return BLOCKED_RANGES.check(address, 'ipv4')
}

/**
 * 校验目标主机不落在私网段。
 *
 * 域名要解析后再判：只按字面量判断时，`http://internal.example.com` 这种内网域名会直接放行。
 * 解析发生在请求之前，与 fetch 自己的解析是两次——这挡不住 DNS rebinding，但把「模型随手填一个
 * localhost 别名」这条最常见的路子堵死了。
 * @param {URL} url
 */
async function assertPublicTarget(url) {
  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new WebFetchError(`拒绝访问私网地址：${hostname}`)
    }
    return
  }
  let addresses
  try {
    addresses = await lookup(hostname, { all: true })
  } catch (err) {
    throw new WebFetchError(`域名解析失败：${hostname}（${err?.code || err?.message || '未知原因'}）`)
  }
  if (!addresses.length) {
    throw new WebFetchError(`域名解析失败：${hostname}`)
  }
  const blocked = addresses.find(item => isBlockedAddress(item.address))
  if (blocked) {
    throw new WebFetchError(`拒绝访问私网地址：${hostname} → ${blocked.address}`)
  }
}

function mimeOf(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase()
}

function isTextualMime(mime) {
  if (!mime) return true
  return mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime.endsWith('+json') ||
    mime === 'application/xml' ||
    mime.endsWith('+xml') ||
    mime === 'application/javascript' ||
    mime === 'application/x-javascript'
}

function charsetFromContentType(contentType) {
  const matched = /charset=["']?([\w-]+)/i.exec(String(contentType || ''))
  return matched ? matched[1].toLowerCase() : ''
}

function charsetFromMeta(bytes) {
  const head = bytes.subarray(0, META_PROBE_BYTES).toString('latin1')
  const matched = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)
  return matched ? matched[1].toLowerCase() : ''
}

/**
 * 按 charset 解码；标了不支持的标签（比如站点手写的 `charset=x-gbk`）就退回 utf-8。
 * @param {Buffer} bytes
 * @param {string} label
 * @returns {string}
 */
function decodeBytes(bytes, label) {
  if (label) {
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      // 不认识的标签：继续用 utf-8，不要因为一个拼错的 charset 就整页失败
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * 取 `<title>`。要在转换前从原始 HTML 里拿——`htmlMarkdown.js` 会丢掉 `<head>`。
 * 实体解码与搜索结果页共用 `htmlText.js`，否则标题里的 `&mdash;` 会原样进契约头。
 * @param {string} html
 * @returns {string}
 */
function titleOf(html) {
  const matched = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!matched) return ''
  return stripTags(matched[1]).slice(0, 200)
}

/**
 * 跟随重定向地发一次 GET，返回最后一跳的字节与 `content-type`。
 *
 * `validate` 是每一跳都要跑的钩子：本地读取用它拦私网，搜索引擎用它时不需要（地址由插件拼，
 * 不含模型输入）。重定向的跟随放在这里而不是 fetch 的 `redirect: 'follow'`，就是为了让钩子
 * 有机会看到中间跳。
 * @param {string} url
 * @param {{ headers?: object, timeoutMs: number, maxBytes?: number, validate?: (url: URL) => Promise<void>, onHeaders?: (meta: { status: number, ok: boolean, contentType: string }) => void }} options
 */
async function requestFollowing(url, { headers = {}, timeoutMs, maxBytes = MAX_BYTES, validate, onHeaders } = {}) {
  let current = url
  const deadline = Date.now() + timeoutMs
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (validate) {
      await validate(new URL(current))
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new WebFetchError(`请求超时（${timeoutMs / 1000} 秒）`)
    }
    const response = await requestBinary(current, { headers }, { timeoutMs: remaining, maxBytes, onHeaders })
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) {
        throw new WebFetchError(`站点返回了 HTTP ${response.status} 重定向但没有给出 Location`, { status: response.status })
      }
      current = new URL(response.location, current).href
      continue
    }
    return { ...response, url: current }
  }
  throw new WebFetchError(`重定向超过 ${MAX_REDIRECTS} 跳，已放弃`)
}

/**
 * 去掉内联图片：`![alt](data:image/svg+xml;base64,…)` 这类。
 *
 * 很多站点的 logo/图标是内联 SVG，转换后是一整段 base64。模型看不了图片，这段却会实打实地
 * 挤掉正文——实测 `opencode.ai/zh` 的转换结果有 61% 是它、`cn.bing.com` 41%。转换器本身
 * 忠实保留（它不只是给本插件用），过滤放在这一层：对外输出是给模型读的。
 * @param {string} markdown
 * @returns {string}
 */
function stripInlineImages(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\(\s*data:[^)]*\)/g, '')
    .replace(/[ \t]+\n/g, '\n')
}

/**
 * 抓一页并转成 Markdown。
 *
 * 失败一律抛 `WebFetchError`，消息里带得上原因（HTTP 状态、超时、内容类型、私网拦截）。
 * 调用方据此返回 `Error: …`，不要把失败当成「这一页没有内容」。
 * @param {unknown} value 模型给的地址
 * @param {{ timeoutMs?: number }} [options] 搜索工具用它把「抓正文」压进自己的总预算
 * @returns {Promise<{ url: string, title: string, text: string, contentType: string }>}
 */
export async function fetchLocalPage(value, { timeoutMs = LOCAL_FETCH_TIMEOUT_MS } = {}) {
  const response = await requestFollowing(requireHttpUrl(value), {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: ACCEPT,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    },
    timeoutMs,
    validate: assertPublicTarget,
    // 在读 body 之前按 content-type 拦掉 PDF / 图片：等下载完 5 MiB 再报错是白花流量
    onHeaders: ({ status, contentType }) => {
      if (status < 200 || status >= 300) return
      const mime = mimeOf(contentType)
      if (!isTextualMime(mime)) {
        throw new WebFetchError(`不支持的内容类型：${mime}`, { status })
      }
    }
  })

  if (response.status === 403) {
    throw new WebFetchError('HTTP 403：站点拒绝访问（可能需要登录，或触发了反爬）', { status: 403 })
  }
  if (!response.ok) {
    throw new WebFetchError(`HTTP ${response.status}`, { status: response.status })
  }

  const mime = mimeOf(response.contentType)
  const charset = charsetFromContentType(response.contentType) || charsetFromMeta(response.body)
  const raw = decodeBytes(response.body, charset)
  const isHtml = mime === 'text/html' || mime === 'application/xhtml+xml' || /^\s*<(?:!doctype|html)/i.test(raw)
  if (!isHtml) {
    return { url: response.url, title: '', text: raw.trim(), contentType: mime }
  }

  return {
    url: response.url,
    title: titleOf(raw),
    text: stripInlineImages(convertHTMLToMarkdown(raw)).trim(),
    contentType: mime
  }
}

/**
 * 取一份 HTML 原文：不转 Markdown，**也不校验私网**。
 *
 * 名字里的 `Raw` 不只是「没转换」，更是「没设防」：它只给**地址由插件自己拼、不含模型输入**的
 * 固定端点用（目前是三个搜索引擎）。不要拿它去读模型给的 URL——那条路是 `fetchLocalPage`，
 * 它会在每一跳重定向上做私网拦截。
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: object }} [options]
 * @returns {Promise<{ url: string, status: number, contentType: string, text: string }>}
 */
export async function fetchRawHtml(url, { timeoutMs = LOCAL_FETCH_TIMEOUT_MS, headers = {} } = {}) {
  const response = await requestFollowing(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...headers
    },
    timeoutMs
  })
  if (!response.ok) {
    throw new WebFetchError(`HTTP ${response.status}`, { status: response.status })
  }
  const charset = charsetFromContentType(response.contentType) || charsetFromMeta(response.body)
  return {
    url: response.url,
    status: response.status,
    contentType: mimeOf(response.contentType),
    text: decodeBytes(response.body, charset)
  }
}
