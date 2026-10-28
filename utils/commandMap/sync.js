import { fetchVerified, pullPatch } from './fetchMap.js'

/**
 * 地图同步：拉索引 → 挑出本机已装的插件 → 逐份拉补丁。
 *
 * 索引本身就是「地图仓库的门牌」，它自己没有哈希可校，所以这里对索引只做结构校验：
 * 能解析、`schema === 1`、`plugins` 是对象。单份地图则必须过哈希（见 fetchMap）。
 */

/**
 * @typedef {{ file: string, fingerprint?: string, sha256?: string }} MapIndexEntry
 */

/**
 * 拉索引并按需下载补丁。
 *
 * @param {{
 *   indexUrl: string,
 *   pluginKeys: string[],
 *   fetchImpl?: typeof fetch,
 *   pull?: typeof pullPatch
 * }} options
 * @returns {Promise<{ updated: number, skipped: number, failed: number, errors: string[], sources: Record<string, string> }>}
 */
export async function syncPatches ({ indexUrl, pluginKeys, fetchImpl, pull = pullPatch }) {
  const base = indexUrl.replace(/[^/]+$/, '')
  const { text, source } = await fetchVerified(indexUrl, { requireHash: false, fetchImpl })

  let index
  try {
    index = JSON.parse(text)
  } catch {
    throw new Error(`${source} 返回的索引不是 JSON`)
  }
  if (!index || Number(index.schema) !== 1 || !index.plugins || typeof index.plugins !== 'object') {
    throw new Error(`索引结构不合法（来自 ${source}）`)
  }

  const wanted = new Set(pluginKeys || [])
  const result = { updated: 0, skipped: 0, failed: 0, errors: [], sources: {} }

  for (const [pluginKey, entry] of Object.entries(index.plugins)) {
    if (!wanted.has(pluginKey)) {
      result.skipped += 1
      continue
    }
    const file = typeof entry?.file === 'string' ? entry.file : ''
    if (!file) {
      result.failed += 1
      result.errors.push(`${pluginKey}: 索引里没有 file`)
      continue
    }

    const url = file.startsWith('http') ? file : `${base}${file}`
    // 索引本身没有签名，所以至少要把它能指向的范围收窄到「同一个 https 源」
    if (!url.startsWith('https://') || new URL(url).host !== new URL(indexUrl).host) {
      result.failed += 1
      result.errors.push(`${pluginKey}: 地图地址必须与索引同源的 https`)
      continue
    }

    try {
      const pulled = await pull({
        pluginKey,
        fingerprint: entry.fingerprint || '',
        url,
        sha256: entry.sha256 || ''
      })
      result.updated += 1
      result.sources[pluginKey] = pulled.source
    } catch (err) {
      result.failed += 1
      result.errors.push(`${pluginKey}: ${err.message}`)
    }
  }

  return result
}
