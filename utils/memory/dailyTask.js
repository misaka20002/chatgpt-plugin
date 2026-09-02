/**
 * 每日批量提炼任务（锅巴 EasyCron 配置，修改后重启生效）
 *
 * - 只处理已结束的北京时间自然日
 * - 断点游标：group policy 的 lastDailyEnd，逐日推进，漏跑自动补提炼
 * - 幂等：任务唯一（group+day），completed 且内容哈希一致则跳过
 * - 失败重试：指数退避 5min×2^(n-1)，上限 60min，最多 maxAttempts 次
 * - 崩溃恢复：running 超过 10 分钟重置为 pending
 */

import { Config } from '../config.js'
import { MemoryStore } from './store.js'
import { runExtraction, toPromptRows } from './extractor.js'
import { contentHash } from './capture.js'

const DEFAULT_CRON = '0 0 4 * * ? *'
const MAX_ATTEMPTS = 3
const MAX_WINDOWS_PER_SCAN = 2
const CRASH_TIMEOUT_MS = 10 * 60 * 1000

/* ================= 北京时间工具 ================= */

/** 北京时间偏移（中国无夏令时） */
const BJT_OFFSET = 8 * 3600 * 1000

/** 时间戳 → 北京时间 YYYY-MM-DD */
export function dayKey(ts) {
  const d = new Date(Number(ts) * 1000 + BJT_OFFSET)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** 北京时间 YYYY-MM-DD → 当日 00:00 时间戳（秒） */
export function dayToTs(day) {
  const [y, m, d] = day.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 1000) - BJT_OFFSET / 1000
}

export function nextDayKey(day) {
  return dayKey(dayToTs(day) + 86400)
}

export function yesterdayKey() {
  return dayKey(Math.floor(Date.now() / 1000) - 86400)
}

export function todayKey() {
  return dayKey(Math.floor(Date.now() / 1000))
}

/** 归一化 cron：只保留前 6 段（TRSS task 机制会 slice(0,6)），不可解析回退默认 */
export function normalizeCron(cron) {
  const raw = (cron || DEFAULT_CRON).trim()
  const parts = raw.split(/\s+/).slice(0, 6)
  if (parts.length === 5) parts.unshift('0') // 5 段（分 时 日 月 周）补秒
  const candidate = parts.join(' ')
  if (candidate.split(/\s+/).length !== 6) return '0 0 4 * * ?'
  // 简单字段校验：每段只能是数字/星/问号/逗号/斜杠/减号
  for (const p of candidate.split(/\s+/)) {
    if (!/^[*?0-9,\-/]+$/.test(p)) return '0 0 4 * * ?'
  }
  return candidate
}

export class DailyConsolidation {
  constructor(options = {}) {
    this.store = options.store || new MemoryStore()
    this.processing = false
  }

  cfg() {
    const g = Config.memoryGroupCapture || {}
    return {
      groups: g.groups || [],
      inputTokenLimit: Number(g.inputTokenLimit) || 30000,
      outputTokenLimit: Number(g.outputTokenLimit) || 4096,
      minConfidence: Number(g.minConfidence) || 0.7,
      rawRetentionDays: Number(g.rawRetentionDays) || 30,
      eventRetentionDays: Number(g.eventRetentionDays) || 90,
      maxAttempts: MAX_ATTEMPTS,
      use: null,
    }
  }

  /** 每日任务入口（EasyCron 触发）；overrideCfg 供测试/自定义覆盖 */
  async runDaily(overrideCfg = null) {
    if (!Config.enableMemory) return { skipped: true, reason: '总开关未启用' }
    if (this.processing) return { skipped: true, reason: '上次任务仍在执行' }
    this.processing = true
    try {
      const cfg = { ...this.cfg(), ...(overrideCfg || {}) }
      const groups = MemoryStore.authorizedGroups(cfg.groups)
      const report = { groups: [] }
      for (const g of groups) {
        const groupReport = await this.processGroupDaily(g.groupId, cfg)
        report.groups.push({ groupId: g.groupId, ...groupReport })
      }
      // 清理过期记忆
      const removed = await this.store.deleteExpired(30)
      report.expiredRemoved = removed
      logger?.info?.(`[MemoryV2] 每日提炼完成: ${JSON.stringify(report)}`)
      return report
    } finally {
      this.processing = false
    }
  }

  /**
   * 处理单个群的每日提炼
   * @param {string} groupId
   * @param {Object} cfg
   * @param {Object} [options] { includeToday: boolean } 立即提取时允许处理今天
   */
  async processGroupDaily(groupId, cfg, options = {}) {
    const store = this.store
    const gid = String(groupId)

    // 1. 清理过期原文
    await store.cleanupExpiredRaw(gid, cfg.rawRetentionDays)

    // 2. 崩溃恢复
    await this.recoverCrashedTasks(gid)

    // 3. 断点游标推进，入队已结束自然日
    const policy = await store.getPolicy(gid)
    let cursor = policy.lastDailyEnd || null
    if (!cursor) {
      const range = await store.getRawTimeRange(gid)
      if (!range) {
        // 无任何原文：不推进游标（保持空），下次从首条消息所在日重新定位，
        // 避免历史补录（如 #群记忆开启 补录 24h）的消息因游标已越过而被永久跳过
        return { queued: 0, lastDailyEnd: policy.lastDailyEnd || '' }
      }
      cursor = dayKey(range.minTime)
    } else {
      cursor = nextDayKey(cursor)
    }

    const bound = options.includeToday ? todayKey() : yesterdayKey()
    let queued = 0
    let guard = 0
    // lastDailyEnd 语义 = 已入队的最后一天；lastProcessed 只记录"实际有内容处理"的最后一天：
    // 无原文的空日不推进游标，之后补录到该日的消息仍会在后续扫描中被覆盖，避免漏提炼
    let lastProcessed = null
    while (cursor <= bound && guard < 400) {
      const dayStart = dayToTs(cursor)
      const dayRows = await store.getRawMessages(gid, dayStart, dayStart + 86400 - 1)
      if (dayRows.length > 0) {
        if (await this.ensureTask(gid, cursor)) queued++
        lastProcessed = cursor
      }
      cursor = nextDayKey(cursor)
      guard++
    }
    // 只在实际处理过内容时才推进游标；否则保持原值（空日/区间外不推进，下次仍可覆盖）
    const newCursor = lastProcessed || policy.lastDailyEnd || ''
    if (newCursor) await store.setPolicy(gid, { lastDailyEnd: newCursor })

    // 3.5 消化悬空的 needsReextract 标记（游标范围外的 dirty 任务，如"立即提取后又有新消息"的今天）
    const requeuedDirty = await this.requeueDirtyTasks(gid)

    // 4. 处理到期任务（分批串行，直到本轮全部消化，保证补提炼即时性）
    const processed = []
    for (let round = 0; round < 10; round++) {
      const batch = await this.processDueWindows(gid, cfg)
      processed.push(...batch)
      if (batch.length === 0) break
    }
    return { queued, requeuedDirty, processed, lastDailyEnd: newCursor }
  }

  /**
   * 将 completed 且 needsReextract=1 的任务重新入队
   * 覆盖游标范围之外的脏标记（例如 #立即提取群记忆 处理完当天后又有新消息）
   */
  async requeueDirtyTasks(groupId) {
    const tasks = await this.store.listTasks(groupId)
    let requeued = 0
    for (const t of tasks) {
      if (t.status === 'completed' && String(t.needsReextract) === '1') {
        if (await this.ensureTask(groupId, t.day)) requeued++
      }
    }
    return requeued
  }

  /**
   * 幂等入队：任务不存在则创建；
   * completed 且被标记 needsReextract（补录/新消息改变原文）→ 重新入队；
   * 其余情况跳过
   */
  async ensureTask(groupId, day) {
    const store = this.store
    const existing = await store.getTask(groupId, day)
    if (!existing) {
      await store.setTask(groupId, day, {
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return true
    }
    if (existing.status === 'completed' && String(existing.needsReextract) === '1') {
      await store.setTask(groupId, day, {
        status: 'pending',
        needsReextract: '',
        nextAttemptAt: Date.now(),
        updatedAt: Date.now(),
      })
      logger?.info?.(`[MemoryV2] 群 ${groupId} ${day} 原文已更新，重新入队提炼`)
      return true
    }
    return false
  }

  /** 崩溃恢复：running 超时重置为 pending */
  async recoverCrashedTasks(groupId) {
    const tasks = await this.store.listTasks(groupId)
    const now = Date.now()
    for (const t of tasks) {
      if (t.status === 'running' && now - Number(t.updatedAt || 0) > CRASH_TIMEOUT_MS) {
        await this.store.setTask(groupId, t.day, { status: 'pending', nextAttemptAt: now, updatedAt: now })
      }
    }
  }

  /** 处理到期任务（pending 且 nextAttemptAt<=now），每轮最多 N 个 */
  async processDueWindows(groupId, cfg) {
    const tasks = await this.store.listTasks(groupId)
    const due = tasks
      .filter(t => t.status === 'pending' && Number(t.nextAttemptAt || 0) <= Date.now())
      .slice(0, MAX_WINDOWS_PER_SCAN)
    const results = []
    for (const t of due) {
      const r = await this.processWindow(groupId, t.day, cfg)
      results.push({ day: t.day, ...r })
    }
    return results
  }

  /**
   * 处理单个日窗口
   * @returns {Promise<{status: string, candidates?: number, error?: string}>}
   */
  async processWindow(groupId, day, cfg) {
    const store = this.store
    const task = await store.getTask(groupId, day)
    if (!task || task.status !== 'pending') return { status: 'skipped' }
    if (Number(task.nextAttemptAt || 0) > Date.now()) return { status: 'waiting' }

    const attemptCount = Number(task.attemptCount || 0) + 1
    const maxAttempts = cfg.maxAttempts || MAX_ATTEMPTS
    // 运行开始时清脏：模型生成期间新到达的消息会由 saveRawMessage 重新标记，
    // 完成后保留脏标记，由下一轮 runDaily 的 requeueDirtyTasks 重提炼
    await store.setTask(groupId, day, { status: 'running', attemptCount, needsReextract: '', nextAttemptAt: '', updatedAt: Date.now() })

    try {
      const dayStart = dayToTs(day)
      const raws = await store.getRawMessages(String(groupId), dayStart, dayStart + 86400 - 1)
      const rows = raws.filter(r => !r.isCommand && r.text)
      if (rows.length === 0) {
        const hash = contentHash('')
        await store.setTask(groupId, day, { status: 'completed', contentHash: hash, resultJson: '{"candidates":0}', updatedAt: Date.now() })
        return { status: 'completed', candidates: 0 }
      }

      const evidenceMap = {}
      for (const r of rows) {
        evidenceMap[r.messageId] = { groupId: String(groupId), senderId: r.senderId, senderName: r.senderName, role: r.role, time: r.time }
      }

      const { candidates, rejected } = await runExtraction({
        rows: toPromptRows(rows),
        ctx: { groupId: String(groupId), day, windowLabel: `${day} 全天` },
        evidenceMap,
        llm: cfg.llm, // 测试注入/自定义提取调用
        cfg: {
          inputTokenLimit: cfg.inputTokenLimit,
          outputTokenLimit: cfg.outputTokenLimit,
          minConfidence: cfg.minConfidence,
          use: cfg.use,
        },
      })

      const results = await this.store.applyCandidates(candidates, {
        groupId: String(groupId),
        day,
        source: `group-window:${groupId}:${day}`,
        evidenceMap,
        maxMemoriesPerUser: Number(Config.maxMemoriesPerUser) || 100,
        eventRetentionDays: cfg.eventRetentionDays,
      })
      const accepted = results.filter(r => r.ok).length
      const hash = contentHash(rows.map(r => `${r.messageId}:${r.text}`).join('\n'))
      await store.setTask(groupId, day, {
        status: 'completed',
        contentHash: hash,
        // 不写 needsReextract：运行期间若到达新消息已由 saveRawMessage 标记，保留给下一轮重提炼
        resultJson: JSON.stringify({ candidates: results.length, accepted, rejected: rejected.length }),
        updatedAt: Date.now(),
      })
      return { status: 'completed', candidates: results.length, accepted, rejected: rejected.length }
    } catch (err) {
      const message = String(err?.message || err).slice(0, 500)
      if (attemptCount >= maxAttempts) {
        await store.setTask(groupId, day, { status: 'failed', error: message, updatedAt: Date.now() })
        return { status: 'failed', error: message }
      }
      const backoff = Math.min(60 * 60 * 1000, 5 * 60 * 1000 * 2 ** (attemptCount - 1))
      const nextAt = Date.now() + backoff
      await store.setTask(groupId, day, { status: 'pending', nextAttemptAt: nextAt, error: message.slice(0, 300), updatedAt: Date.now() })
      return { status: 'retry', nextAttemptAt: nextAt }
    }
  }

  /**
   * 立即提取：入队最近未处理窗口（含今天）+ 重置 failed + 立即处理
   * 仅限已授权采集的群；与 runDaily 共享 processing 并发锁，避免重复调用模型
   */
  async runImmediate(groupId, cfg = this.cfg()) {
    if (!Config.enableMemory) return { ok: false, message: '总开关未启用' }
    const gid = String(groupId)
    if (!MemoryStore.isGroupAuthorized(cfg.groups || Config.memoryGroupCapture?.groups, gid)) {
      return { ok: false, message: '本群未开启记忆采集，无法立即提取（可在锅巴"授权采集群"或群内 #群记忆开启 授权）' }
    }
    if (this.processing) return { ok: false, message: '每日提炼任务正在执行中，请稍后再试' }
    this.processing = true
    try {
      // 重置 failed 任务为 pending（失败重试）
      const tasks = await this.store.listTasks(gid)
      let retried = 0
      for (const t of tasks) {
        if (t.status === 'failed') {
          await this.store.setTask(gid, t.day, { status: 'pending', nextAttemptAt: Date.now(), error: '', updatedAt: Date.now() })
          retried++
        }
      }

      // 入队已结束日 + 今天（含补漏）；processGroupDaily 内部已消化到期任务与脏标记
      const report = await this.processGroupDaily(gid, cfg, { includeToday: true })
      const processedCount = (report.processed || []).length
      return { ok: true, message: `已触发提取：入队 ${report.queued} 个窗口，失败重试 ${retried} 个，脏标记重提炼 ${report.requeuedDirty || 0} 个，本轮处理 ${processedCount} 个窗口` }
    } finally {
      this.processing = false
    }
  }
}

export const dailyConsolidation = new DailyConsolidation()
