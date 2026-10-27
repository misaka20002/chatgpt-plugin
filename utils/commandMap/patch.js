import crypto from 'node:crypto'

import { normalize } from './text.js'

/**
 * 地图补丁的解析与合并。
 *
 * 补丁只带「关键词 / 参数说明 / 示例 / 风险档 / 交互标记」——写法和描述来自能力表，
 * 两份全量数据必然漂移。所以这里的合并方向是单向的：能力表是骨架，补丁往骨架上挂肉。
 */

/** 风险档：只影响确认强度，不参与权限放行 */
const RISK_VALUES = new Set(['q', 'w', 'a'])

/** 规范化写法，作为补丁的键 */
export function commandKey (command) {
  return normalize(command)
}

/**
 * 写法集合的指纹。用于判断补丁是否还对得上当前版本。
 * @param {string[]} commands
 * @returns {string}
 */
export function buildFingerprint (commands) {
  const sorted = [...new Set((commands || []).map(commandKey).filter(Boolean))].sort()
  return crypto.createHash('sha1').update(sorted.join('\n')).digest('hex').slice(0, 12)
}

/**
 * 校验并规范化一份补丁。形状不对一律返回 null——宁可这条插件没有关键词，也不要半份脏数据。
 * @param {unknown} raw
 * @returns {{ key: string, fingerprint: string, commands: Map<string, object> } | null}
 */
export function normalizePatch (raw) {
  if (!raw || typeof raw !== 'object') return null
  if (Number(raw.schema) !== 1) return null
  const plugin = raw.plugin
  if (!plugin || typeof plugin.key !== 'string' || !plugin.key.trim()) return null

  const commands = new Map()
  const source = raw.commands && typeof raw.commands === 'object' ? raw.commands : {}
  for (const [command, value] of Object.entries(source)) {
    const key = commandKey(command)
    if (!key || !value || typeof value !== 'object') continue
    const keys = Array.isArray(value.keys)
      ? value.keys.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
      : []
    const args = value.args && typeof value.args === 'object' ? value.args : {}
    const risk = RISK_VALUES.has(value.risk) ? value.risk : ''
    commands.set(key, {
      keys,
      args,
      ex: typeof value.ex === 'string' ? value.ex : '',
      risk,
      interactive: value.interactive === true
    })
  }

  return {
    key: plugin.key.trim(),
    fingerprint: typeof plugin.fingerprint === 'string' ? plugin.fingerprint : '',
    commands
  }
}

/**
 * 把能力表条目与补丁合并成召回索引。
 *
 * 失配规则：补丁里有、能力表里没有的写法 → 丢弃该条并计入 `staleCount`（不整份回退）；
 * 能力表里有、补丁里没有的指令 → 保留，关键词退化为「写法 + 描述」，风险档按权限位推断。
 *
 * @param {{ entries: Array<object>, patches?: Array<object> }} input
 * @returns {{ entries: Array<object>, staleCount: number, patchPlugins: number }}
 */
export function mergeIndex ({ entries, patches = [] } = {}) {
  const byPlugin = new Map()
  for (const patch of patches) {
    if (!patch?.commands?.size) continue
    byPlugin.set(patch.key, patch)
  }

  const used = new Map()
  const merged = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    const pluginKey = entry.pluginKey || ''
    const key = commandKey(entry.command)
    const patch = pluginKey ? byPlugin.get(pluginKey) : null
    const patched = key ? patch?.commands.get(key) : null
    if (patched) used.set(`${pluginKey}\u0000${key}`, true)

    const keys = patched?.keys?.length
      ? patched.keys
      : [entry.command, entry.description].filter(item => typeof item === 'string' && item.trim())

    merged.push({
      plugin: entry.plugin || '',
      pluginKey,
      command: entry.command || '',
      description: entry.description || '',
      permission: entry.permission || '',
      hasPatch: Boolean(patched),
      keys,
      args: patched?.args || {},
      ex: patched?.ex || '',
      risk: patched?.risk || inferRisk(entry.permission),
      interactive: patched?.interactive === true
    })
  }

  let staleCount = 0
  for (const [pluginKey, patch] of byPlugin) {
    for (const key of patch.commands.keys()) {
      if (!used.has(`${pluginKey}\u0000${key}`)) staleCount += 1
    }
  }

  return { entries: merged, staleCount, patchPlugins: byPlugin.size }
}

/**
 * 没有补丁时按权限位推断风险档：需要管理权限的指令默认写成 w，其余按只读处理。
 * 这是保守方向——把只读误判成写只会多问一句，反过来会少问一句。
 * @param {string} permission
 * @returns {'q' | 'w'}
 */
function inferRisk (permission) {
  return permission ? 'w' : 'q'
}
