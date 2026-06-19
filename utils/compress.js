import { unzipSync } from 'fflate'
import path from 'node:path'
import fs from 'node:fs'
import { newFetch } from './proxy.js'

/**
 * 下载 ZIP 并解压到目标目录。
 * 用 fflate.unzipSync() 解析 ZIP 中央目录，返回文件名→Uint8Array 映射。
 * 自动过滤 ../../../ 路径穿越。
 *
 * @param {string} url ZIP 下载地址
 * @param {string} destDir 解压目标目录
 * @param {Object} [opts]
 * @param {Object} [opts.headers={}] 请求头
 * @param {number} [opts.timeoutMs=60000] 超时毫秒
 * @returns {Promise<Array<{name: string, size: number}>>} 已解压的文件列表（不含目录）
 */
export async function fetchAndExtractZip(url, destDir, { headers = {}, timeoutMs = 60000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await newFetch(url, { headers, signal: controller.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`)

    const buf = Buffer.from(await res.arrayBuffer())
    const files = unzipSync(new Uint8Array(buf))

    const baseResolved = path.resolve(destDir)
    const extracted = []

    for (const [entryPath, content] of Object.entries(files)) {
      // 移除 zip 顶层目录（如 skills-main/）
      const slashIdx = entryPath.indexOf('/')
      const relPath = slashIdx !== -1 ? entryPath.slice(slashIdx + 1) : entryPath
      if (!relPath) continue

      const targetPath = path.join(destDir, relPath)
      const resolved = path.resolve(targetPath)
      if (!resolved.startsWith(baseResolved + path.sep)) {
        throw new Error(`path traversal blocked: ${entryPath}`)
      }

      if (relPath.endsWith('/')) {
        fs.mkdirSync(resolved, { recursive: true })
      } else {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, Buffer.from(content))
        extracted.push({ name: relPath, size: content.length })
      }
    }
    return extracted
  } finally {
    clearTimeout(timer)
  }
}
