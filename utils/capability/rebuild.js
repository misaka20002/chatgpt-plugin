import { Config } from '../config.js'
import { FRAMEWORK_CONFIG_SPEC, CAPABILITY_FORMAT_VERSION } from './paths.js'
import { loadPluginSnapshot } from './registry.js'
import { collectConfigHints } from './configScan.js'
import { buildCapabilityEntries, renderCapabilityForm } from './form.js'
import { auditCapabilityEntries } from './audit.js'
import { readCapabilityState, saveCapabilityState, isCapabilityStale } from './store.js'

/**
 * 重建编排：取表 → 补配置线索 → 合并 → 审核翻译 → 通过才落盘。
 *
 * 失败路径的规矩：
 *   - 有历史通过版本 → 继续用它，新版本作废。
 *   - 没有历史版本 → 不注入任何目录（静默降级），只私聊主人一条告警。
 *   - 失败后进入冷却期，避免「每轮对话都重烧一次审核」。
 */

const LOG_PREFIX = '[Chatgpt][capability]'

/** 失败冷却：审核不通过或重建抛错后，这么久内不再自动重试（手动刷新不受限） */
const FAILURE_COOLDOWN_MS = 30 * 60 * 1000

/** 告警冷却：主人最多一小时收一条 */
const ALERT_COOLDOWN_MS = 60 * 60 * 1000

let inFlight = null
let lastFailureAt = 0
let lastAlertAt = 0

/**
 * 拿到可用的能力状态；过期则重建并等待结果。
 *
 * 只给**显式命令**用（主人手动刷新）：它需要一个确定的结果来回报。
 * 对话路径不要用它——扫描 + 审核可能要一两分钟，不能卡住正在进行的对话，
 * 那种场景用 startCapabilityRebuild() 在后台跑，本轮用旧数据。
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ meta: object, form: string } | null>}
 */
export async function ensureCapabilityState ({ force = false } = {}) {
  const current = readCapabilityState()
  if (!force && current && !isCapabilityStale(current.meta)) return current
  return await startCapabilityRebuild({ force })
}

/**
 * 启动一次重建（已有在跑则复用同一个 promise），不等待完成即返回。
 *
 * @param {{ force?: boolean }} [options] force 跳过失败冷却，供手动刷新使用
 * @returns {Promise<{ meta: object, form: string } | null>}
 */
export function startCapabilityRebuild ({ force = false } = {}) {
  if (inFlight) return inFlight
  if (!force && Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) {
    return Promise.resolve(readCapabilityState())
  }

  inFlight = rebuild()
    .catch(err => {
      lastFailureAt = Date.now()
      globalThis.logger?.warn?.(`${LOG_PREFIX} 重建失败，沿用旧版本：${err.message}`)
      return readCapabilityState()
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

async function rebuild () {
  const startedAt = Date.now()
  const snapshot = await loadPluginSnapshot()
  const hints = await collectConfigHints(snapshot)
  const baseEntries = buildCapabilityEntries(snapshot, hints)
  const previous = readCapabilityState()

  // 一个第三方插件都没扫到：不覆盖旧版本，也不告警（可能机器上确实只装了本插件）
  if (!baseEntries.length) {
    globalThis.logger?.mark?.(`${LOG_PREFIX} 未发现第三方插件，跳过重建`)
    return previous
  }

  const audited = await auditCapabilityEntries(baseEntries, {
    provider: Config.capabilityAuditProvider || undefined,
    model: Config.capabilityAuditModel || undefined,
    concurrency: Config.capabilityAuditConcurrency,
    onProgress: (done, total) => {
      globalThis.logger?.mark?.(`${LOG_PREFIX} 审核进度 ${done}/${total} 批`)
    }
  })
  const auditMs = Date.now() - startedAt
  globalThis.logger?.mark?.(
    `${LOG_PREFIX} ${baseEntries.length} 条指令分 ${audited.batches} 批审核，耗时 ${(auditMs / 1000).toFixed(1)}s，并发 ${Config.capabilityAuditConcurrency || 3}`
  )

  if (!audited.approved) {
    lastFailureAt = Date.now()
    const summary = audited.issues.slice(0, 5).join('；')
    globalThis.logger?.warn?.(`${LOG_PREFIX} 审核未通过：${summary}`)
    if (!previous) {
      await notifyMaster([
        '能力表单首次生成未通过审核，已停止注入：AI 现在不知道任何插件功能（安全优先）。',
        `问题：${summary || '未知'}`
      ])
    }
    return previous
  }

  const generatedAt = new Date().toISOString()
  const rendered = renderCapabilityForm(audited.entries, {
    generatedAt,
    degraded: snapshot.degraded,
    limit: Config.capabilityDirectoryLimit
  })

  const meta = {
    version: CAPABILITY_FORMAT_VERSION,
    generatedAt,
    durationMs: Date.now() - startedAt,
    auditBatches: audited.batches,
    degraded: snapshot.degraded,
    approved: true,
    pluginCount: rendered.pluginCount,
    entryCount: rendered.entryCount,
    listedCount: rendered.listedCount,
    listedEntryCount: rendered.listedEntryCount,
    unlistedPlugins: rendered.unlistedPlugins,
    directory: rendered.directory,
    entries: audited.entries.map(entry => ({
      plugin: entry.plugin,
      pluginKey: entry.pluginKey,
      command: entry.command,
      description: entry.description,
      pluginDsc: entry.pluginDsc,
      permission: entry.permission,
      reg: entry.reg
    }))
  }

  saveCapabilityState({ form: rendered.form, meta })
  // 成功即解除失败冷却，否则「失败一次 → 修好 → 30 分钟内不许重建」会误伤
  lastFailureAt = 0
  globalThis.logger?.mark?.(
    `${LOG_PREFIX} 能力表已更新：${meta.pluginCount} 个插件类 / ${meta.entryCount} 条指令，总耗时 ${(meta.durationMs / 1000).toFixed(1)}s${meta.degraded ? '（降级）' : ''}`
  )
  return { meta, form: rendered.form }
}

/** 供命令层判断「这次刷新到底有没有换新表」 */
export function capabilityGeneratedAt () {
  return readCapabilityState()?.meta?.generatedAt || ''
}

/**
 * 私聊主人告警。合并成一条、带冷却，避免反复轰炸。
 * 拿不到主人号或发送失败时只写日志——告警是尽力而为，不能因为告警失败把重建也拖垮。
 */
async function notifyMaster (lines) {
  const now = Date.now()
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return
  lastAlertAt = now

  const text = ['【ChatGPT-Plugin 能力表告警】', ...lines].join('\n')
  try {
    const mod = await import(FRAMEWORK_CONFIG_SPEC)
    const masterQQ = mod?.default?.masterQQ || mod?.masterQQ || []
    const masters = (Array.isArray(masterQQ) ? masterQQ : [masterQQ]).map(Number).filter(Boolean)
    const bot = globalThis.Bot
    if (!masters.length || !bot?.pickFriend) {
      globalThis.logger?.warn?.(`${LOG_PREFIX} 无法私聊主人，告警降级为日志：${text}`)
      return
    }
    for (const qq of masters.slice(0, 3)) {
      const friend = await bot.pickFriend(qq)
      await friend?.sendMsg?.(text)
    }
  } catch (err) {
    globalThis.logger?.warn?.(`${LOG_PREFIX} 告警发送失败：${err.message}`)
  }
}
