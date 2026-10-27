import crypto from 'node:crypto'
import fs from 'node:fs'

import { normalizePatch } from './patch.js'
import { patchPath, savePatch as savePatchToDisk } from './mapStore.js'

/**
 * 地图补丁的下载：镜像链 + 哈希校验。
 *
 * 直连 GitHub 是**间歇性**可用，所以按序重试；但每一环都当不可信管道——
 * 实测里有镜像返回 200 而内容是自家首页，也有中转站改写下载内容。
 * 所以「拿到 200」不算成功，**哈希对上才算**。
 */

/** 单源超时：超过就换下一个，不陪一个死源耗着 */
const DEFAULT_TIMEOUT_MS = 15000

/**
 * 镜像链。顺序按实测吞吐与可用性排；`build` 返回 null 表示这个源处理不了这种 URL。
 * @type {Array<{ name: string, build: (url: string) => string | null }>}
 */
export const MIRRORS = [
  { name: 'direct', build: url => url },
  { name: 'gh-proxy.at9.net', build: url => `https://gh-proxy.at9.net/${url}` },
  { name: 'gh.xmly.dev', build: url => `https://gh.xmly.dev/${url}` },
  { name: 'cors.isteed.cc', build: url => `https://cors.isteed.cc/${url}` },
  { name: 'jsDelivr', build: jsdelivrUrl }
]

/**
 * jsDelivr 只认 `<owner>/<repo>@<ref>/<path>` 这种形状，其余 URL 它代理不了。
 * @param {string} url
 * @returns {string | null}
 */
function jsdelivrUrl (url) {
  const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url)
  if (!match) return null
  const [, owner, repo, ref, file] = match
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${file}`
}

/**
 * 内容哈希，用于和索引里声明的值比对。
 * @param {string} text
 * @returns {string}
 */
export function sha256 (text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 按镜像链取一份「哈希对得上」的文本。
 *
 * @param {string} url 原始 raw 地址
 * @param {{
 *   sha256?: string,
 *   requireHash?: boolean 索引文件自身没有哈希时置 false（由调用方做结构校验）
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   mirrors?: typeof MIRRORS,
 *   onMiss?: (mirror: string, reason: string) => void
 * }} [options]
 * @returns {Promise<{ text: string, source: string }>}
 */
export async function fetchVerified (url, { sha256: expected = '', requireHash = true, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, mirrors = MIRRORS, onMiss } = {}) {
  const failures = []

  for (const mirror of mirrors) {
    const target = mirror.build(url)
    if (!target) continue

    let text = ''
    try {
      text = await fetchText(target, { fetchImpl, timeoutMs })
    } catch (err) {
      failures.push(`${mirror.name}: ${err.message}`)
      onMiss?.(mirror.name, err.message)
      continue
    }

    if (expected) {
      if (sha256(text) !== expected) {
        // 200 但内容不是我们要的那份：可能是镜像首页，也可能被改写
        failures.push(`${mirror.name}: 内容哈希不符`)
        onMiss?.(mirror.name, '内容哈希不符')
        continue
      }
    } else if (requireHash) {
      // 没有声明哈希就无法判断内容是否被改写，这种补丁不收：宁可不装地图，也不装一份来路不明的
      failures.push(`${mirror.name}: 索引未声明 sha256`)
      onMiss?.(mirror.name, '索引未声明 sha256')
      continue
    }

    return { text, source: mirror.name }
  }

  throw new Error(`地图下载失败（${failures.length} 个源都不可用）：${failures.join('；')}`)
}

/**
 * 拉一份补丁并落盘。命中本地缓存时完全不联网。
 *
 * @param {{ pluginKey: string, fingerprint: string, url: string, sha256?: string }} target
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, mirrors?: typeof MIRRORS, readCache?: Function, save?: Function }} [options]
 * @returns {Promise<{ patch: object, source: string }>}
 */
export async function pullPatch (target, {
  fetchImpl,
  timeoutMs,
  mirrors,
  readCache = defaultReadCache,
  save = savePatchToDisk
} = {}) {
  if (!target.sha256) throw new Error('缺少 sha256，拒绝下载未经校验的地图')
  const cached = readCache(target)
  if (cached) return { patch: cached, source: 'cache' }

  const { text, source } = await fetchVerified(target.url, { sha256: target.sha256, fetchImpl, timeoutMs, mirrors })

  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`${source} 返回的不是 JSON`)
  }

  const patch = normalizePatch(raw)
  if (!patch) throw new Error(`${source} 返回的地图形状不合法`)

  save(patch)
  return { patch, source }
}

/**
 * 默认缓存读取：同插件 + 同指纹的文件存在即命中。
 * @param {{ pluginKey: string, fingerprint: string }} target
 * @returns {object | null}
 */
function defaultReadCache (target) {
  try {
    const file = patchPath(target.pluginKey, target.fingerprint)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return normalizePatch(raw)
  } catch {
    return null
  }
}

/**
 * 带超时的文本下载。顺手做一道「看起来不像文本」的粗筛——
 * 二进制或极短响应不必进到哈希那一步。
 * @param {string} target
 * @param {{ fetchImpl: typeof fetch, timeoutMs: number }} options
 * @returns {Promise<string>}
 */
async function fetchText (target, { fetchImpl, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(target, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    if (!text.trim()) throw new Error('响应为空')
    return text
  } finally {
    clearTimeout(timer)
  }
}
