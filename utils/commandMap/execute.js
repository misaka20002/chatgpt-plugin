import { FRAMEWORK_LOADER_SPEC } from '../capability/paths.js'
import { commandKey } from './patch.js'

/**
 * 代执行：把拼好的指令发进框架原生的消息分发。
 *
 * 两条硬约束：
 *   1. **权限交给框架**。这里只负责"路线对不对"，不改 `isMaster`、不换发送者，
 *      让 `loader.filtPermission` 用它自己那套规则放行或拒绝（ADR-0001）。
 *   2. **存在性校验先于执行**。地图可能来自别人的 fork，写法在你装的版本里未必存在；
 *      跑一遍真实匹配是唯一能拦住"调用不存在的指令"的闸门。
 */

const LOG_PREFIX = '[Chatgpt][commandMap]'

/**
 * 在插件优先级链上找第一个能匹配这条写法的规则。
 * @param {string} call 完整指令写法
 * @param {{ loader: object, e?: object }} options
 * @returns {{ item: object, rule: object } | null}
 */
export function findRuleByCall (call, { loader, e } = {}) {
  if (!loader || !Array.isArray(loader.priority) || !call) return null

  for (const item of loader.priority) {
    const plugin = resolvePlugin(item)
    if (!plugin || !Array.isArray(plugin.rule)) continue
    for (const rule of plugin.rule) {
      if (!rule?.reg) continue
      if (rule.event && typeof loader.filtEvent === 'function' && !loader.filtEvent(e, rule)) continue
      if (!safeTest(rule.reg, call)) continue
      return { item, rule }
    }
  }
  return null
}

/**
 * 执行一条指令。
 *
 * @param {object} e 真实消息事件（不被替换，只改文本）
 * @param {string} call 完整指令写法
 * @param {{ loader?: object }} [options]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function executeCommand (e, call, { loader } = {}) {
  const resolved = loader || await loadFrameworkLoader()
  if (!resolved) return { ok: false, reason: 'no-loader' }

  const hit = findRuleByCall(call, { loader: resolved, e })
  if (!hit) return { ok: false, reason: 'not-found' }

  // 权限判定就这一处：框架的 filtPermission 自己会回「暂无权限」，我们不重复判、也不放行
  if (typeof resolved.filtPermission === 'function' && !resolved.filtPermission(e, hit.rule)) {
    globalThis.logger?.mark?.(`${LOG_PREFIX} 拒绝 ${call} by ${userIdOf(e)} in ${groupIdOf(e)}（权限不足）`)
    return { ok: false, reason: 'no-permission' }
  }

  globalThis.logger?.mark?.(`${LOG_PREFIX} 执行 ${call} by ${userIdOf(e)} in ${groupIdOf(e)}`)

  const restore = forgeMessage(e, call)
  try {
    const plugin = instantiate(hit.item, e)
    const handler = plugin?.[hit.rule.fnc]
    if (typeof handler !== 'function') return { ok: false, reason: 'no-handler' }
    await handler.call(plugin, e)
    return { ok: true }
  } finally {
    // 消息文本必须还原：e 会继续被后续流程使用，留着伪造文本会让别的插件再匹配一次
    restore()
  }
}

/**
 * 改文本、不动身份。`e.msg` 决定正则匹配，`e.message[0].text` 是插件读原文时最常看的地方。
 * @param {object} e
 * @param {string} call
 * @returns {() => void} 还原函数
 */
function forgeMessage (e, call) {
  const originalMsg = e.msg
  const first = Array.isArray(e.message) ? e.message[0] : null
  const originalText = first && typeof first === 'object' ? first.text : undefined
  const originalSegment = first && typeof first === 'object' ? null : first

  e.msg = call
  if (Array.isArray(e.message) && e.message.length) {
    if (first && typeof first === 'object') first.text = call
    else e.message[0] = { type: 'text', text: call }
  }

  return () => {
    e.msg = originalMsg
    if (!Array.isArray(e.message) || !e.message.length) return
    if (first && typeof first === 'object') {
      if (originalText === undefined) delete first.text
      else first.text = originalText
    } else if (originalSegment !== null) {
      e.message[0] = originalSegment
    }
  }
}

function userIdOf (e) {
  return e?.sender?.user_id || e?.user_id || ''
}

function groupIdOf (e) {
  return e?.group_id || e?.group?.group_id || 'private'
}

function resolvePlugin (item) {
  if (item?.plugin && Array.isArray(item.plugin.rule)) return item.plugin
  if (typeof item?.class === 'function') {
    try {
      const instance = new item.class({})
      if (instance && Array.isArray(instance.rule)) return instance
    } catch {
      return null
    }
  }
  return null
}

function instantiate (item, e) {
  if (typeof item?.class === 'function') {
    try {
      return Object.assign(new item.class(e), { e })
    } catch (err) {
      globalThis.logger?.warn?.(`${LOG_PREFIX} 实例化插件失败：${err.message}`)
    }
  }
  return item?.plugin || null
}

function safeTest (reg, call) {
  try {
    return reg instanceof RegExp ? reg.test(call) : new RegExp(reg).test(call)
  } catch {
    return false
  }
}

async function loadFrameworkLoader () {
  try {
    const mod = await import(FRAMEWORK_LOADER_SPEC)
    const loader = mod?.default ?? mod
    if (loader && Array.isArray(loader.priority)) return loader
  } catch (err) {
    globalThis.logger?.warn?.(`${LOG_PREFIX} 读取框架加载器失败：${err.message}`)
  }
  return globalThis.Bot?.loader || null
}

/** 按写法在索引里找条目；查不到返回 null，由调用方决定降级策略 */
export function findCommandEntry (entries, call) {
  const key = commandKey(call)
  return (entries || []).find(entry => commandKey(entry.command) === key) || null
}
