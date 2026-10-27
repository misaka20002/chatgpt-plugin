import path from 'node:path'

import { FRAMEWORK_LOADER_SPEC, PLUGINS_ROOT, SELF_PLUGIN_ROOT } from './paths.js'
import { listFiles, readTextFile, MAX_SOURCE_FILE_BYTES } from './fileRead.js'
import fs from 'node:fs'

/**
 * 取插件总表。
 *
 * 总表是框架加载完所有插件后留下的那张表：每个插件的 name / dsc / rule（已是 RegExp）。
 * 读它比解析别人源码准得多——注释掉的规则、条件不成立的分支都不会出现。
 *
 * 两个硬约束：
 *   1) 总表只有全部插件加载完才完整，所以本模块**不得**在插件 init() 阶段调用。
 *   2) `priority` 属框架内部字段，取不到时必须降级（源码粗提）并标记 degraded，不能静默报错。
 */

const MAX_FILES_PER_PLUGIN = 40
const LOG_PREFIX = '[Chatgpt][capability]'

/**
 * @typedef {{ reg: string, permission: string }} CapabilityRule
 * @typedef {{ key: string, name: string, dsc: string, dir: string, rules: CapabilityRule[] }} CapabilityPlugin
 * @typedef {{ degraded: boolean, plugins: CapabilityPlugin[] }} CapabilitySnapshot
 */

/**
 * @param {{ loader?: object, sourceScan?: () => Promise<CapabilityPlugin[]>, pluginsRoot?: string }} [options]
 *   loader / sourceScan / pluginsRoot 都是测试注入点：真实运行时三者都取默认值
 * @returns {Promise<CapabilitySnapshot>}
 */
export async function loadPluginSnapshot ({ loader, sourceScan, pluginsRoot = PLUGINS_ROOT } = {}) {
  const registry = loader || await loadFrameworkLoader()
  const fromRegistry = readFromLoader(registry, pluginsRoot)
  if (fromRegistry) return { degraded: false, plugins: fromRegistry }

  globalThis.logger?.warn?.(`${LOG_PREFIX} 未取到插件总表，降级为源码粗提（结果可能不完整）`)
  const plugins = sourceScan ? await sourceScan() : await readFromSource(pluginsRoot)
  return { degraded: true, plugins }
}

/** 取框架加载器单例；取不到返回 null（由调用方降级） */
export async function loadFrameworkLoader () {
  try {
    const mod = await import(FRAMEWORK_LOADER_SPEC)
    const loader = mod?.default ?? mod
    if (loader && Array.isArray(loader.priority)) return loader
  } catch (err) {
    globalThis.logger?.warn?.(`${LOG_PREFIX} 读取框架加载器失败：${err.message}`)
  }
  const guarded = globalThis.Bot?.loader
  if (guarded && Array.isArray(guarded.priority)) return guarded
  return null
}

/**
 * 从总表提取第三方插件。
 * @returns {CapabilityPlugin[] | null} null 表示这份 loader 不可用，调用方应降级
 */
function readFromLoader (loader, pluginsRoot) {
  if (!loader || !Array.isArray(loader.priority)) return null

  const plugins = []
  for (const item of loader.priority) {
    if (!item) continue
    const dir = resolvePluginDir(item, pluginsRoot)
    if (!dir || !isThirdParty(dir, pluginsRoot)) continue
    const instance = resolveInstance(item)
    plugins.push({
      key: String(item.key || path.basename(dir)),
      name: firstString(instance.name, item.name, path.basename(dir)),
      dsc: firstString(instance.dsc, ''),
      dir,
      rules: normalizeRules(instance.rule)
    })
  }
  return plugins
}

/**
 * 取插件实例。
 *
 * 不同版本的加载器把实例放在 `item.plugin`，也可能只留构造器 `item.class`
 * （本仓库 `apps/management.js` 就是 `new p.class()` 取 name/rule）——两种都认。
 * 构造失败不算致命：这个插件的信息拿不到，但不能连累其余插件。
 */
function resolveInstance (item) {
  if (item.plugin && typeof item.plugin === 'object') return item.plugin
  if (typeof item.class === 'function') {
    try {
      return new item.class()
    } catch (err) {
      globalThis.logger?.warn?.(`${LOG_PREFIX} 实例化插件 ${item.key || ''} 失败：${err.message}`)
    }
  }
  return {}
}

/**
 * 总表的 key 通常是插件目录名（也可能带子路径），拼成绝对目录用于判定归属。
 *
 * 目录在 `plugins/` 下找不到、却在 `lib/plugins/` 下存在时，说明是框架内置插件——
 * 指到 lib 那条路径上去，交给 isThirdParty 排除（框架自带指令不在收录范围）。
 */
function resolvePluginDir (item, pluginsRoot) {
  const raw = firstString(item.key, item.name, '')
  if (!raw) return null
  if (path.isAbsolute(raw)) return path.resolve(raw)
  // 框架内置插件的 key 带 lib/ 前缀，直接落到 lib 下，交给 isThirdParty 排除
  if (/^lib[\\/]/.test(raw)) return path.resolve(pluginsRoot, raw)

  const segment = raw.split(/[\\/]/).filter(Boolean)[0]
  if (!segment) return null

  const candidate = path.resolve(pluginsRoot, segment)
  if (fs.existsSync(candidate)) return candidate
  const frameworkCandidate = path.resolve(pluginsRoot, 'lib', 'plugins', segment)
  if (fs.existsSync(frameworkCandidate)) return frameworkCandidate
  return candidate
}

/** 第三方 = 在插件目录内、不在框架 lib 下、且不是本插件自己 */
function isThirdParty (dir, pluginsRoot) {
  const resolved = path.resolve(dir)
  const self = path.resolve(SELF_PLUGIN_ROOT)
  const root = path.resolve(pluginsRoot)
  if (resolved === self) return false
  if (path.basename(resolved) === path.basename(self)) return false
  if (resolved.includes(`${path.sep}lib${path.sep}plugins${path.sep}`)) return false
  return resolved === root || resolved.startsWith(root + path.sep)
}

function normalizeRules (rules) {
  if (!Array.isArray(rules)) return []
  const out = []
  for (const rule of rules) {
    const reg = regSource(rule?.reg)
    if (!reg) continue
    out.push({
      reg,
      permission: firstString(rule?.permission, '')
    })
  }
  return out
}

/**
 * RegExp 取 source；字符串原样。
 *
 * 刻意不拼 flags：source 里本身就有 `#`，拼上 `/i` 之类会让「还原用户写法」分不清边界，
 * 而 flags 对最终用途（告诉用户打什么）毫无价值。
 */
function regSource (reg) {
  if (reg instanceof RegExp) return reg.source
  if (typeof reg === 'string') return reg.trim()
  return ''
}

function firstString (...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return typeof values[values.length - 1] === 'string' ? values[values.length - 1] : ''
}

/**
 * 降级路径：扫第三方插件的应用目录，正则粗提 name / dsc / reg。
 * 准确性不如总表（模板字符串拼出来的正则提不出来），所以快照一定带 degraded。
 */
async function readFromSource (pluginsRoot) {
  let entries = []
  try {
    entries = await fs.promises.readdir(pluginsRoot, { withFileTypes: true })
  } catch (err) {
    globalThis.logger?.warn?.(`${LOG_PREFIX} 读取插件目录失败：${err.message}`)
    return []
  }

  const plugins = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(pluginsRoot, entry.name)
    if (!isThirdParty(dir, pluginsRoot)) continue
    const plugin = await scanPluginDir(dir, entry.name)
    if (plugin) plugins.push(plugin)
  }
  return plugins
}

async function scanPluginDir (dir, key) {
  const files = await listSourceFiles(dir)
  if (!files.length) return null

  let name = key
  let dsc = ''
  const rules = []

  for (const file of files) {
    const text = await readTextFile(file, MAX_SOURCE_FILE_BYTES)
    if (!text) continue
    if (name === key) {
      const found = text.match(/\bname:\s*['"`]([^'"`]{1,60})['"`]/)
      if (found) name = found[1]
    }
    if (!dsc) {
      const found = text.match(/\bdsc:\s*['"`]([^'"`]{1,200})['"`]/)
      if (found) dsc = found[1]
    }
    for (const rule of extractRules(text)) rules.push(rule)
  }

  if (!rules.length) return null
  return { key, name, dsc, dir, rules }
}

async function listSourceFiles (dir) {
  const appFiles = await listFiles(path.join(dir, 'apps'), name => name.endsWith('.js'))
  if (appFiles.length) return appFiles.slice(0, MAX_FILES_PER_PLUGIN)

  // 没有 apps 目录的插件，退到根目录的几个入口文件
  const rootFiles = await listFiles(dir, name => ['index.js', 'app.js', 'main.js'].includes(name))
  return rootFiles.slice(0, MAX_FILES_PER_PLUGIN)
}

const REG_PATTERN = /reg:\s*(?:\/((?:\\.|[^/\\\n])+)\/[a-z]*|'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`)/g
const PERMISSION_PATTERN = /permission:\s*['"`]([^'"`]{1,20})['"`]/

function extractRules (text) {
  const rules = []
  REG_PATTERN.lastIndex = 0
  let match
  while ((match = REG_PATTERN.exec(text))) {
    const reg = (match[1] || match[2] || match[3] || match[4] || '').trim()
    if (!reg) continue
    // 权限位与 reg 同处一个 rule 对象里，往后找最近的 permission 作为近似
    const after = text.slice(match.index, match.index + 400)
    const permission = after.match(PERMISSION_PATTERN)?.[1] || ''
    rules.push({ reg, permission })
  }
  return rules
}
