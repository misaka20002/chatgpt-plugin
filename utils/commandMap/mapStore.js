import fs from 'node:fs'
import path from 'node:path'

import { normalizePatch } from './patch.js'

/**
 * 地图补丁的本地缓存。
 *
 * 布局：`data/chatgpt/commandMaps/<插件>/<指纹>.json`
 * 按指纹分文件，插件升级后旧补丁不会被覆盖，命中新指纹时直接用新的；旧文件留给人工清理。
 */

/** 补丁目录：与能力表同级的另一个子目录，天生不在插件仓库的版本控制里 */
export function commandMapDir () {
  return path.join(process.cwd(), 'data', 'chatgpt', 'commandMaps')
}

export function patchPath (pluginKey, fingerprint) {
  return path.join(commandMapDir(), safeSegment(pluginKey), `${safeSegment(fingerprint) || 'unknown'}.json`)
}

/** 路径段净化：地图来自远端，`pluginKey` 里的 `..` 或分隔符不能带出缓存目录 */
function safeSegment (value) {
  return String(value ?? '').replace(/[\\/]/g, '_').replace(/\.{2,}/g, '_').trim() || ''
}

/**
 * 读全部已缓存补丁。单个文件坏掉不影响其余文件——这正是「一份脏数据不该毁掉整张表」的落点。
 * @returns {Array<object>}
 */
export function readAllPatches () {
  const root = commandMapDir()
  let pluginDirs = []
  try {
    pluginDirs = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())
  } catch {
    return []
  }

  const patches = []
  for (const dir of pluginDirs) {
    const pluginDir = path.join(root, dir.name)
    let files = []
    try {
      files = fs.readdirSync(pluginDir).filter(name => name.endsWith('.json'))
    } catch {
      continue
    }
    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(pluginDir, file), 'utf8'))
        const patch = normalizePatch(raw)
        if (patch) patches.push(patch)
      } catch {
        // 坏文件跳过；下次拉取会覆盖它
      }
    }
  }
  return patches
}

/**
 * 把补丁写回成文件形状：只保留 schema/plugin/commands，其余字段一概丢弃。
 * @param {{ key: string, fingerprint: string, commands: Map<string, object> }} patch
 * @returns {object}
 */
function toPatchFile (patch) {
  const commands = {}
  for (const [command, value] of patch.commands) commands[command] = value
  return {
    schema: 1,
    plugin: { key: patch.key, fingerprint: patch.fingerprint },
    commands
  }
}

/**
 * 落盘一份补丁。
 * @param {{ key: string, fingerprint: string, commands: Map<string, object> }} patch
 * @returns {boolean}
 */
export function savePatch (patch) {
  const file = patchPath(patch.key, patch.fingerprint)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 只写允许的字段：远端送来的 call/what 一律不落盘（ADR-0002：补丁不带写法与描述）
    fs.writeFileSync(file, `${JSON.stringify(toPatchFile(patch), null, 2)}\n`, 'utf8')
    return true
  } catch (err) {
    globalThis.logger?.warn?.(`[Chatgpt][commandMap] 补丁落盘失败：${err.message}`)
    return false
  }
}
