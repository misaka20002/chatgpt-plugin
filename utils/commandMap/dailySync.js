import { Config } from '../config.js'
import { FRAMEWORK_CONFIG_SPEC } from '../capability/paths.js'
import { readCapabilityState } from '../capability/store.js'
import { readLocalRevision } from './mapStore.js'
import { readIndex, syncPatches } from './sync.js'

/**
 * 每日检查指令地图有没有新版。默认行为，没有开关：开了能力地图就每天检查一次。
 *
 * 成本控制是这一层的全部意义：索引几十 KB，比一个整数就知道要不要干活；
 * 只有云端 `revision` 比本地大时才去下载补丁，平时每天就一次索引请求。
 *
 * 只同步「本机已装插件」的补丁——能力表里出现过的 pluginKey 就是本机装了什么。
 * 没生成过能力表就不动：没有骨架，补丁拉回来也挂不上。
 */

const LOG_PREFIX = '[Chatgpt][commandMap]'

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   pull?: Function,
 *   notify?: (text: string) => Promise<void>|void
 * }} [options]
 * @returns {Promise<{ skipped?: string, updated?: number, failed?: number, revision?: number }>}
 */
export async function dailyMapSync ({ fetchImpl, pull, notify = notifyOwner } = {}) {
  if (!Config.enableCapabilityMap) return { skipped: 'capability-off' }

  const indexUrl = String(Config.commandMapIndexUrl || '').trim()
  if (!indexUrl) return { skipped: 'no-index-url' }

  const state = readCapabilityState()
  const pluginKeys = [...new Set((state?.meta?.entries || []).map(entry => entry.pluginKey).filter(Boolean))]
  if (!pluginKeys.length) return { skipped: 'no-capability' }

  const { index, base } = await readIndex({ indexUrl, fetchImpl })
  const cloud = Number(index.revision) || 0
  const local = readLocalRevision()

  // cloud 为 0 说明对面还是没版本号的老索引：判断不了，直接同步一次（同步完会记下 0）
  if (cloud && local >= cloud) {
    globalThis.logger?.mark?.(`${LOG_PREFIX} 每日检查：已是新版（本地 ${local} / 云端 ${cloud}），跳过`)
    return { skipped: 'up-to-date', revision: cloud }
  }

  const result = await syncPatches({ indexUrl, pluginKeys, fetchImpl, pull, preloaded: { index, base } })
  globalThis.logger?.mark?.(
    `${LOG_PREFIX} 每日同步 ${local} → ${result.revision}：更新 ${result.updated} 份 ／ 失败 ${result.failed} 份`
  )

  if (result.updated > 0) {
    const lines = [`指令地图已更新到版本 ${result.revision}：${result.updated} 份补丁。`]
    if (result.failed) lines.push(`失败 ${result.failed} 份：${result.errors.slice(0, 3).join('；')}（明天会重试）`)
    try {
      await notify(lines.join('\n'))
    } catch (err) {
      globalThis.logger?.warn?.(`${LOG_PREFIX} 更新通知发送失败：${err.message}`)
    }
  }

  return { updated: result.updated, failed: result.failed, revision: result.revision }
}

/**
 * 私聊主人。拿不到主人号或发送失败时只写日志——通知是尽力而为，
 * 不能因为通知失败把同步结果也吞掉。
 * @param {string} text
 */
async function notifyOwner (text) {
  try {
    const mod = await import(FRAMEWORK_CONFIG_SPEC)
    const masterQQ = mod?.default?.masterQQ || mod?.masterQQ || []
    const masters = (Array.isArray(masterQQ) ? masterQQ : [masterQQ]).map(Number).filter(Boolean)
    const bot = globalThis.Bot
    if (!masters.length || !bot?.pickFriend) {
      globalThis.logger?.warn?.(`${LOG_PREFIX} 无法私聊主人，通知降级为日志：${text}`)
      return
    }
    for (const qq of masters.slice(0, 3)) {
      const friend = await bot.pickFriend(qq)
      await friend?.sendMsg?.(text)
    }
  } catch (err) {
    globalThis.logger?.warn?.(`${LOG_PREFIX} 通知主人失败：${err.message}`)
  }
}
