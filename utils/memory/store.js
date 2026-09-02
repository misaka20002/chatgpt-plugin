/**
 * 智能模式 V2 记忆存储层（Redis）
 *
 * 数据模型：
 * - 记忆本体        CHATGPT:MEMORY:V2:item:{memoryId}          String(JSON)
 * - 作用域索引      CHATGPT:MEMORY:V2:idx:{scope}:{ownerId}:{groupId}   Set<memoryId>
 * - 槽位索引        CHATGPT:MEMORY:V2:slot:{scope}:{ownerId}:{groupId}:{factKey} Set<memoryId>
 * - 证据集合        CHATGPT:MEMORY:V2:evd:{memoryId}           Set<JSON {g,m,s,t}>
 * - 群来源反向索引  CHATGPT:MEMORY:V2:grp:{groupId}            Set<memoryId>
 * - 原文            CHATGPT:MEMORY:V2:raw:{groupId}:{messageId} String(JSON) TTL
 * - 原文时间索引    CHATGPT:MEMORY:V2:rawIdx:{groupId}          ZSet(messageId, time)
 * - 提炼任务        CHATGPT:MEMORY:V2:task:{groupId}:{day}     Hash
 * - 群运行时策略    CHATGPT:MEMORY:V2:policy:{groupId}         Hash
 * - 元信息          CHATGPT:MEMORY:V2:meta                     Hash
 */

import { validateMemoryWrite } from './sensitive.js'

const PREFIX = 'CHATGPT:MEMORY:V2'
const IDX = (scope, ownerId, groupId) => `${PREFIX}:idx:${scope}:${ownerId}:${groupId || '-'}`
const SLOT = (scope, ownerId, groupId, factKey) => `${PREFIX}:slot:${scope}:${ownerId}:${groupId || '-'}:${factKey}`
const EVD = (memoryId) => `${PREFIX}:evd:${memoryId}`
const GRP = (groupId) => `${PREFIX}:grp:${groupId}`
const RAW = (groupId, messageId) => `${PREFIX}:raw:${groupId}:${messageId}`
const RAWIDX = (groupId) => `${PREFIX}:rawIdx:${groupId}`
const TASK = (groupId, day) => `${PREFIX}:task:${groupId}:${day}`
const POLICY = (groupId) => `${PREFIX}:policy:${groupId}`
const META = `${PREFIX}:meta`

const SCOPES = ['user', 'user_group', 'group']
const KINDS = ['identity', 'preference', 'relationship', 'plan', 'group_rule', 'experience', 'episode']

/** 单值槽位：新值替换旧值；其余（如 preference.*）多值共存 */
export function isSingleValueFact(factKey) {
  return factKey === 'communication.style' || /^(?:identity|profile|group_role|plan)\./.test(factKey)
}

/** factKey 规范化：小写、非法字符转点、必须形如 a.b */
export function canonicalFactKey(factKey) {
  if (typeof factKey !== 'string') return ''
  const key = factKey.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '.').replace(/\.+/g, '.').replace(/^[^a-z]+/, '')
  if (!/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/.test(key)) return ''
  return key
}

/** factValue 规范化：去空白标点、小写、截断 */
export function normalizedFactValue(factValue) {
  if (factValue === undefined || factValue === null) return ''
  return String(factValue).replace(/[\s，。,.、！!？?；;：:"'“”‘’（）()【】\[\]《》<>~-]/g, '').toLowerCase().slice(0, 160)
}

/** 生成记忆 ID */
export function genMemoryId() {
  return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)
}

const nowSec = () => Math.floor(Date.now() / 1000)
const nowMs = () => Date.now()

/** 时间戳（秒）→ 北京时间 YYYY-MM-DD（与 dailyTask.dayKey 保持一致，避免循环依赖） */
function dayKeyOf(tsSec) {
  const d = new Date(Number(tsSec) * 1000 + 8 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * 手工维护的记忆（manual，主人通过管理指令/维护流程写入）：
 * 不受模型 retract 与单值替换影响；关闭来源群时只移除证据、保留记忆。
 * Memory_Tool 是模型在普通自述场景自动调用的写入来源，不属于手工确认：
 * 用户换工作/明确否定时，必须可被新值替换、可被 retract 撤回。
 * profile-scan（画像工具模型自动提取）同样不属于手工确认。
 */
function isManualMemory(memory) {
  return memory.source === 'manual'
}

/**
 * 模型自动派生的记忆（每日提炼 / 画像扫描 / 对话工具 Memory_Tool）：
 * 关闭来源群时可整体删除（仅本群证据时），防止留下无证据的"僵尸记忆"
 */
function isDerivedMemory(memory) {
  return String(memory.source).startsWith('group-window') || memory.source === 'profile-scan' || memory.source === 'Memory_Tool'
}

/**
 * 服务端校验候选的通用字段（不依赖证据归属的静态校验）
 * @returns {{ok: boolean, reason?: string, data?: Object}}
 */
export function validateCandidateShape(candidate) {
  if (!candidate || typeof candidate !== 'object') return { ok: false, reason: '候选为空' }

  const scope = SCOPES.includes(candidate.scope) ? candidate.scope : null
  const kind = KINDS.includes(candidate.kind) ? candidate.kind : null
  const operation = candidate.operation === 'retract' ? 'retract' : (candidate.operation === 'ignore' ? 'ignore' : 'add')

  if (operation === 'ignore') return { ok: false, reason: 'ignore' }
  if (!scope) return { ok: false, reason: `非法作用域: ${candidate.scope}` }

  const factKey = canonicalFactKey(candidate.factKey)
  if (!factKey) return { ok: false, reason: `非法 factKey: ${candidate.factKey}` }
  if (operation === 'retract') {
    return {
      ok: true,
      data: {
        scope, kind: kind || 'identity', operation, factKey, factValue: normalizedFactValue(candidate.factValue),
        text: '', confidence: 0, importance: 0, sensitivity: 'normal', validTo: 0,
        evidenceMessageIds: (Array.isArray(candidate.evidenceMessageIds) ? candidate.evidenceMessageIds : []).map(String),
        subjectId: candidate.subjectId, speakerId: candidate.speakerId,
      },
    }
  }

  const text = typeof candidate.text === 'string' ? candidate.text.trim() : ''
  if (!text) return { ok: false, reason: 'text 为空' }
  if (text.length > 500) return { ok: false, reason: `text 超长(${text.length}>500)` }

  const factValue = normalizedFactValue(candidate.factValue)
  if (!factValue) return { ok: false, reason: `factValue 为空: ${candidate.factValue}` }

  const confidence = Number(candidate.confidence)
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) return { ok: false, reason: `非法置信度: ${candidate.confidence}` }

  const importance = Number(candidate.importance)
  if (!Number.isFinite(importance) || importance < 0 || importance > 1) return { ok: false, reason: `非法重要性: ${candidate.importance}` }

  let validTo = 0
  // truthy 检查：0（数字）/ 空串 / null / undefined 一律视为"无有效期"，避免 Date.parse(0)→2000-01-01
  if (candidate.validTo) {
    let t = null
    if (typeof candidate.validTo === 'number' && Number.isFinite(candidate.validTo)) {
      // 已是规范化后的秒级时间戳（applyCandidates 合并后的内部值），直接接受
      t = candidate.validTo * 1000
    } else {
      t = Date.parse(candidate.validTo)
    }
    if (t === null || Number.isNaN(t) || t <= 0) return { ok: false, reason: `非法 validTo: ${candidate.validTo}` }
    validTo = Math.floor(t / 1000)
  }

  const evidenceMessageIds = Array.isArray(candidate.evidenceMessageIds) && candidate.evidenceMessageIds.length > 0
    ? candidate.evidenceMessageIds.filter(id => id !== undefined && id !== null && id !== '').map(String)
    : []
  if (operation === 'add' && evidenceMessageIds.length === 0) return { ok: false, reason: '缺少证据消息 ID' }
  if (evidenceMessageIds.length > 8) return { ok: false, reason: `证据过多(${evidenceMessageIds.length}>8)` }

  // 敏感信息复检（模型 sensitivity 字段不可信）
  const sensitiveCheck = validateMemoryWrite(text, factValue)
  if (!sensitiveCheck.ok) return { ok: false, reason: `敏感信息: ${sensitiveCheck.reason}` }
  if (candidate.sensitivity === 'sensitive') return { ok: false, reason: '模型标记为敏感' }

  return {
    ok: true,
    data: {
      scope, kind: kind || 'preference', operation, factKey, factValue, text, confidence, importance,
      sensitivity: 'normal', validTo, evidenceMessageIds,
      subjectId: candidate.subjectId, speakerId: candidate.speakerId,
    },
  }
}

export class MemoryStore {
  constructor(redisClient) {
    this.redis = redisClient || global.redis
    if (!this.redis) throw new Error('MemoryStore: 无可用 redis 客户端')
  }

  /* ================= 记忆写入 ================= */

  /**
   * 批量应用候选（同批合并 + 逐条写入）
   * @param {Array<Object>} candidates
   * @param {Object} ctx { groupId, day?, source, evidenceMap }
   * @returns {Promise<Array<Object>>} 每条候选的处理结果
   */
  async applyCandidates(candidates, ctx = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) return []
    const results = []
    const merged = new Map()

    // 同批合并：operation:scope:owner:group:factKeyToken → 证据并集
    for (const raw of candidates) {
      const checked = validateCandidateShape(raw)
      if (!checked.ok) { results.push({ ok: false, candidate: raw, reason: checked.reason }); continue }
      const c = checked.data
      const ownerId = c.scope === 'group' ? ctx.groupId : c.subjectId
      const groupId = c.scope === 'user' ? '' : ctx.groupId
      const token = `${c.operation}:${c.scope}:${ownerId}:${groupId}:${c.factKey}:${c.factValue}`
      if (!merged.has(token)) merged.set(token, { ...c, subjectId: ownerId, evidenceMessageIds: [] })
      const target = merged.get(token)
      for (const id of c.evidenceMessageIds) if (!target.evidenceMessageIds.includes(id)) target.evidenceMessageIds.push(id)
    }

    for (const c of merged.values()) {
      const result = await this.applyFact(c, ctx)
      results.push(result)
    }
    return results
  }

  /**
   * 应用单条候选（add/reinforce/update/retract 语义）
   * @returns {Promise<{ok: boolean, action: string, memoryId?: string, reason?: string}>}
   */
  async applyFact(candidate, ctx = {}) {
    try {
      const redis = this.redis
      const now = nowMs()
      const checked = validateCandidateShape(candidate)
      if (!checked.ok) return { ok: false, action: 'invalid', reason: checked.reason }
      const c = checked.data

      const ownerId = String(c.scope === 'group' ? ctx.groupId : (c.subjectId || ctx.subjectId || ''))
      if (!ownerId) return { ok: false, action: 'invalid', reason: '缺少 ownerId(subjectId)' }
      const groupId = c.scope === 'user' ? '' : String(ctx.groupId || '')

      // 证据归属二次校验（即使 extractor 已校验，store 也不信任）
      const evidence = this._buildEvidence(c.evidenceMessageIds, ctx)
      if (c.operation === 'add' && evidence.length === 0) {
        return { ok: false, action: 'invalid', reason: '证据无法在上下文中定位' }
      }
      const ownership = this.validateEvidenceOwnership(c, evidence)
      if (!ownership.ok) {
        return { ok: false, action: 'invalid', reason: ownership.reason }
      }

      // 槽位现有行
      const slotIds = await redis.sMembers(SLOT(c.scope, ownerId, groupId, c.factKey))
      const existing = []
      for (const id of slotIds) {
        const m = await this._getMemory(id)
        if (m) existing.push(m)
      }
      const active = existing.filter(m => m.status === 'active')

      // ---- retract：明确否定 → 撤回 ----
      if (c.operation === 'retract') {
        const targets = active.filter(m => !c.factValue || m.factValue === c.factValue)
        let archived = 0
        for (const t of targets) {
          if (isManualMemory(t)) continue // 手工确认的记忆不受模型撤回影响
          await this._archive(t, 'retracted', now)
          archived++
        }
        return { ok: true, action: archived > 0 ? 'retracted' : 'ignored', reason: archived > 0 ? '' : '无可撤回目标' }
      }

      // ---- add ----
      // 1) 同值强化（合并证据 + 置信度提升）
      const sameValue = active.find(m => m.factValue === c.factValue)
      if (sameValue) {
        const addedEvidence = await this._mergeEvidence(sameValue, evidence, ctx.groupId)
        if (addedEvidence === 0) {
          // 证据全部已存在 → 幂等跳过（不重复提高置信度）
          return { ok: true, action: 'skipped', memoryId: sameValue.id, reason: '证据已存在，幂等跳过' }
        }
        sameValue.confidence = Math.min(1, (sameValue.confidence || 0) + 0.04)
        sameValue.lastConfirmedAt = now
        sameValue.updatedAt = now
        await this._saveMemory(sameValue)
        return { ok: true, action: 'reinforced', memoryId: sameValue.id }
      }

      // 2) 单值槽位冲突 → 替换（归档旧值）
      if (isSingleValueFact(c.factKey) && active.length > 0) {
        const archivables = active.filter(m => !isManualMemory(m))
        if (archivables.length === 0) {
          return { ok: false, action: 'ignored', reason: '单值槽位被手工确认记忆占据，忽略新值' }
        }
        for (const t of archivables) await this._archive(t, 'superseded', now)
      }

      // 3) 新增
      // 个人记忆上限检查（user 与 user_group 均限制，防止多群画像无限增长）
      if (c.scope === 'user' || c.scope === 'user_group') {
        const cap = Number(ctx.maxMemoriesPerUser) || 100
        const count = await this._countActiveByScope(c.scope, ownerId, groupId)
        if (count >= cap) await this._evictLowest(c.scope, ownerId, groupId)
      }

      const memory = {
        id: genMemoryId(),
        scope: c.scope,
        ownerId,
        groupId,
        kind: c.kind,
        factKey: c.factKey,
        factValue: c.factValue,
        text: c.text,
        tags: c.tags || [],
        importance: c.importance,
        confidence: c.confidence,
        status: 'active',
        source: ctx.source || 'Memory_Tool',
        validTo: c.validTo || ((c.kind === 'episode' || c.kind === 'plan') && !c.validTo ? nowSec() + (ctx.eventRetentionDays ?? 90) * 86400 : 0),
        createdAt: now,
        updatedAt: now,
        lastConfirmedAt: now,
      }
      await this._insertMemory(memory, evidence, ctx.groupId)
      // 旧 Hash 清理只针对个人作用域：group 作用域的 ownerId 是群号，
      // 群号与某个 QQ 号碰撞时会误删 CHATGPT:MEMORY:USER:<群号> 对应用户的旧记忆
      if (c.scope !== 'group') await this._purgeLegacyOnce(ownerId)
      return { ok: true, action: 'added', memoryId: memory.id }
    } catch (err) {
      logger?.error?.(`[MemoryV2] applyFact 失败: ${err.message}`)
      return { ok: false, action: 'error', reason: err.message }
    }
  }

  /** 由证据 ID 列表构造证据对象（{g,m,s,t,r}），并从上下文定位 */
  _buildEvidence(messageIds, ctx) {
    const map = ctx.evidenceMap || {}
    const out = []
    for (const id of messageIds) {
      const row = map[id]
      if (row) {
        out.push({ g: String(row.groupId || ctx.groupId || ''), m: String(id), s: String(row.senderId || ''), t: Number(row.time) || 0, r: String(row.role || '') })
      } else if (ctx.fallbackEvidence) {
        out.push({ g: String(ctx.groupId || ''), m: String(id), s: String(ctx.fallbackEvidence.senderId || ''), t: Number(ctx.fallbackEvidence.time) || 0, r: String(ctx.fallbackEvidence.role || '') })
      }
    }
    return out
  }

  /**
   * 证据归属校验（服务端不信任任何调用方）
   * 个人事实必须有本人消息作为证据；群事实必须来自管理公告或至少两名成员
   * @returns {{ok: boolean, reason: string}}
   */
  validateEvidenceOwnership(c, evidence) {
    if (c.scope === 'user' || c.scope === 'user_group') {
      const senders = new Set(evidence.map(ev => ev.s).filter(Boolean))
      const subjectId = String(c.subjectId || '')
      if (!subjectId) return { ok: false, reason: '个人记忆缺少 subjectId' }
      if (!senders.has(subjectId)) return { ok: false, reason: `个人事实必须有本人消息作为证据（subjectId ${subjectId} 不在证据发送者中，疑似转述/伪造）` }
      if (c.speakerId && String(c.speakerId) !== subjectId) return { ok: false, reason: 'speakerId 与 subjectId 不一致' }
      return { ok: true, reason: '' }
    }
    if (c.scope === 'group') {
      const senders = new Set(evidence.map(ev => ev.s).filter(Boolean))
      const authoritative = evidence.some(ev => ['owner', 'admin'].includes(String(ev.r || '').toLowerCase()))
      if (senders.size >= 2 || authoritative) return { ok: true, reason: '' }
      return { ok: false, reason: `群事实必须来自群管理公告或至少两名成员支持（当前 ${senders.size} 人）` }
    }
    return { ok: false, reason: `未知作用域 ${c.scope}` }
  }

  /**
   * 合并证据到记忆（幂等）
   * @returns {number} 新增证据数量
   */
  async _mergeEvidence(memory, evidence, groupId) {
    const redis = this.redis
    const evdKey = EVD(memory.id)
    const existing = await redis.sMembers(evdKey)
    const existingSet = new Set(existing)
    let added = 0
    const grpKey = groupId ? GRP(groupId) : ''
    for (const ev of evidence) {
      const serialized = JSON.stringify(ev)
      if (!existingSet.has(serialized)) {
        await redis.sAdd(evdKey, serialized)
        added++
        if (grpKey) await redis.sAdd(grpKey, memory.id)
      }
    }
    return added
  }

  async _insertMemory(memory, evidence, groupId) {
    const redis = this.redis
    await redis.set(`${PREFIX}:item:${memory.id}`, JSON.stringify(memory))
    await redis.sAdd(IDX(memory.scope, memory.ownerId, memory.groupId), memory.id)
    await redis.sAdd(SLOT(memory.scope, memory.ownerId, memory.groupId, memory.factKey), memory.id)
    if (groupId) await redis.sAdd(GRP(groupId), memory.id)
    for (const ev of evidence) {
      await redis.sAdd(EVD(memory.id), JSON.stringify(ev))
      if (ev.g) await redis.sAdd(GRP(ev.g), memory.id)
    }
  }

  async _archive(memory, reason, now = nowMs()) {
    const redis = this.redis
    memory.status = 'archived'
    memory.source = reason
    memory.updatedAt = now
    await redis.set(`${PREFIX}:item:${memory.id}`, JSON.stringify(memory))
    // 槽位索引中保留 archived 记录用于追溯，召回时过滤 status
  }

  async _saveMemory(memory) {
    await this.redis.set(`${PREFIX}:item:${memory.id}`, JSON.stringify(memory))
  }

  async _getMemory(id) {
    const raw = await this.redis.get(`${PREFIX}:item:${id}`)
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  async _countActiveByScope(scope, ownerId, groupId) {
    const redis = this.redis
    const ids = await redis.sMembers(IDX(scope, ownerId, groupId))
    let count = 0
    for (const id of ids) {
      const m = await this._getMemory(id)
      if (m && m.status === 'active') count++
    }
    return count
  }

  /** 按 重要性×时间衰减 淘汰最低分（user 作用域） */
  async _evictLowest(scope, ownerId, groupId) {
    const redis = this.redis
    const ids = await redis.sMembers(IDX(scope, ownerId, groupId))
    const now = nowMs()
    let lowest = null
    let lowestScore = Infinity
    for (const id of ids) {
      const m = await this._getMemory(id)
      if (!m || m.status !== 'active') continue
      const ageDays = (now - m.createdAt) / 86400000
      const decay = Math.max(0.1, 1 - (ageDays / 30) * 0.1)
      const score = (m.importance || 0) * decay
      if (score < lowestScore) { lowestScore = score; lowest = m }
    }
    if (lowest) await this._deleteMemory(lowest)
  }

  /* ================= 记忆读取 ================= */

  async getMemory(id) { return this._getMemory(id) }

  /**
   * 按作用域列出记忆
   * @param {Object} q { scope, ownerId, groupId, status, includeArchived }
   */
  async listByScope(q = {}) {
    const redis = this.redis
    const ids = await redis.sMembers(IDX(q.scope, q.ownerId, q.groupId || ''))
    const out = []
    for (const id of ids) {
      const m = await this._getMemory(id)
      if (!m) continue
      if (q.status && m.status !== q.status) continue
      if (q.includeArchived !== true && m.status !== 'active') continue
      out.push(m)
    }
    return out
  }

  /**
   * 召回候选：本人 user + 本群 group + 本群 user_group(本人)
   * 已过滤过期记忆
   * @param {Object} [options] { excludeUser } 非主人 @他人时排除跨群 user，仅召回对方本群事实
   */
  async listRecallCandidates(userId, groupId, options = {}) {
    const redis = this.redis
    const now = nowSec()
    const groups = []
    if (!options.excludeUser) groups.push({ scope: 'user', ownerId: String(userId), groupId: '' })
    groups.push({ scope: 'user_group', ownerId: String(userId), groupId: String(groupId || '') })
    groups.push({ scope: 'group', ownerId: String(groupId || ''), groupId: String(groupId || '') })
    const out = []
    for (const g of groups) {
      if (!g.ownerId) continue
      const ids = await redis.sMembers(IDX(g.scope, g.ownerId, g.groupId))
      for (const id of ids) {
        const m = await this._getMemory(id)
        if (!m || m.status !== 'active') continue
        if (m.validTo && m.validTo > 0 && m.validTo <= now) continue
        out.push(m)
      }
    }
    return out
  }

  /**
   * 列出某群全部 active 的 user_group 记忆（按群反向索引，避免全库扫描）
   * @param {string} groupId
   */
  async listUserGroupByGroup(groupId) {
    const gid = String(groupId)
    const ids = await this.redis.sMembers(GRP(gid))
    const out = []
    for (const id of ids) {
      const m = await this._getMemory(id)
      if (m && m.scope === 'user_group' && m.status === 'active') out.push(m)
    }
    return out
  }

  /* ================= 管理 ================= */

  /** 删除一条记忆（含索引/证据/群反向索引） */
  async _deleteMemory(memory) {
    const redis = this.redis
    const evdKey = EVD(memory.id)
    const evds = await redis.sMembers(evdKey)
    for (const ev of evds) {
      try {
        const parsed = JSON.parse(ev)
        if (parsed.g) await redis.sRem(GRP(parsed.g), memory.id)
      } catch { /* ignore */ }
    }
    if (memory.groupId) await redis.sRem(GRP(memory.groupId), memory.id)
    await redis.del(evdKey)
    await redis.sRem(IDX(memory.scope, memory.ownerId, memory.groupId), memory.id)
    await redis.sRem(SLOT(memory.scope, memory.ownerId, memory.groupId, memory.factKey), memory.id)
    await redis.del(`${PREFIX}:item:${memory.id}`)
  }

  async deleteMemory(id) {
    const m = await this._getMemory(id)
    if (!m) return false
    await this._deleteMemory(m)
    return true
  }

  /** 清空某用户全部记忆（user 与所有群的 user_group） */
  async clearUser(userId) {
    const redis = this.redis
    const uid = String(userId)
    const ids = new Set()
    const userScopeIds = await redis.sMembers(IDX('user', uid, ''))
    userScopeIds.forEach(id => ids.add(id))
    // 遍历群反向索引，找出该用户在各群的 user_group 记忆
    if (redis.scanIterator) {
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:grp:*`, COUNT: 1000 })) {
        const gids = await redis.sMembers(key)
        for (const id of gids) {
          const m = await this._getMemory(id)
          if (m && m.scope === 'user_group' && String(m.ownerId) === uid) ids.add(id)
        }
      }
    }
    for (const id of ids) {
      const m = await this._getMemory(id)
      if (m) await this._deleteMemory(m)
    }
    await this._purgeLegacyOnce(uid)
    return true
  }

  /** 清空全部 V2 记忆 + 残留旧 Hash */
  async clearAll() {
    const redis = this.redis
    const keys = []
    for await (const key of redis.scanIterator ? redis.scanIterator({ MATCH: `${PREFIX}:item:*`, COUNT: 3000 }) : []) keys.push(key)
    // 兼容无 scanIterator 的 mock
    if (redis.scanIterator) {
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:evd:*`, COUNT: 3000 })) keys.push(key)
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:idx:*`, COUNT: 3000 })) keys.push(key)
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:slot:*`, COUNT: 3000 })) keys.push(key)
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:grp:*`, COUNT: 3000 })) keys.push(key)
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:task:*`, COUNT: 3000 })) keys.push(key)
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:raw:*`, COUNT: 3000 })) keys.push(key)
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:rawIdx:*`, COUNT: 3000 })) keys.push(key)
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:policy:*`, COUNT: 3000 })) keys.push(key)
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:meta`, COUNT: 3000 })) keys.push(key)
      // 旧 Hash
      for await (const key of redis.scanIterator({ MATCH: 'CHATGPT:MEMORY:USER:*', COUNT: 3000 })) keys.push(key)
    }
    const unique = [...new Set(keys)]
    for (let i = 0; i < unique.length; i += 500) {
      await redis.del(...unique.slice(i, i + 500))
    }
    return unique.length
  }

  /** 首次为某用户写入 V2 个人记忆时删除旧 Hash（幂等） */
  async _purgeLegacyOnce(userId) {
    if (!userId) return
    const redis = this.redis
    const legacyKey = `CHATGPT:MEMORY:USER:${userId}`
    if (await redis.exists(legacyKey)) {
      await redis.del(legacyKey)
      logger?.info?.(`[MemoryV2] 已删除旧版记忆 Hash: ${legacyKey}`)
    }
  }

  async purgeLegacyForUser(userId) {
    await this._purgeLegacyOnce(String(userId))
  }

  /** 列出残留的旧版记忆 Hash key（CHATGPT:MEMORY:USER:*），供 #清空所有记忆 使用 */
  async listLegacyHashKeys() {
    const redis = this.redis
    const keys = []
    if (redis.scanIterator) {
      for await (const key of redis.scanIterator({ MATCH: 'CHATGPT:MEMORY:USER:*', COUNT: 3000 })) keys.push(key)
    }
    return keys
  }

  /**
   * 判断用户是否存在任何 V2 记忆（user 全局 + 所有群的 user_group，含已过期未清理的 active）
   * 用于 #清空我的记忆 / #清空他的记忆 的预检——listRecallCandidates 只覆盖当前群与未过期，会漏报
   */
  async hasUserMemories(userId) {
    const redis = this.redis
    const uid = String(userId)
    const userScopeIds = await redis.sMembers(IDX('user', uid, ''))
    if (userScopeIds.length > 0) return true
    if (redis.scanIterator) {
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:grp:*`, COUNT: 1000 })) {
        const ids = await redis.sMembers(key)
        for (const id of ids) {
          const m = await this._getMemory(id)
          if (m && m.scope === 'user_group' && String(m.ownerId) === uid) return true
        }
      }
    }
    return false
  }

  /**
   * 关闭某群记忆：来源级清理
   * - 删除该群原文、任务、运行时策略
   * - user_group/group 且 groupId=该群 → 整条删除
   * - user 派生记忆（group-window）仅本群证据 → 整条删除；多群证据 → 仅移除本群证据
   * - user 手工/工具记忆 → 仅移除本群证据
   */
  async clearGroup(groupId) {
    const redis = this.redis
    const gid = String(groupId)

    // 1. 原文 + 原文索引
    const rawIds = await redis.zRange(RAWIDX(gid), 0, -1)
    for (const mid of rawIds) await redis.del(RAW(gid, mid))
    await redis.del(RAWIDX(gid))

    // 2. 任务
    const taskKeys = []
    if (redis.scanIterator) {
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:task:${gid}:*`, COUNT: 1000 })) taskKeys.push(key)
    }
    for (const k of taskKeys) await redis.del(k)

    // 3. 运行时策略
    await redis.del(POLICY(gid))

    // 4. 记忆（遍历群反向索引）
    const memoryIds = await redis.sMembers(GRP(gid))
    for (const id of memoryIds) {
      const m = await this._getMemory(id)
      if (!m) { await redis.sRem(GRP(gid), id); continue }
      const evds = await redis.sMembers(EVD(id))
      const otherEvd = evds.filter(ev => {
        try { return JSON.parse(ev).g !== gid } catch { return true }
      })
      const isGroupScoped = (m.scope === 'group' || m.scope === 'user_group') && String(m.groupId) === gid
      const isDerived = isDerivedMemory(m)
      if (isGroupScoped || (m.scope === 'user' && isDerived && otherEvd.length === 0)) {
        await this._deleteMemory(m)
      } else {
        // 只移除该群证据
        for (const ev of evds) {
          try {
            const parsed = JSON.parse(ev)
            if (parsed.g === gid) await redis.sRem(EVD(id), ev)
          } catch { /* ignore */ }
        }
        await redis.sRem(GRP(gid), id)
      }
    }
    await redis.del(GRP(gid))
    return { rawCleaned: rawIds.length, memoryIds: memoryIds.length }
  }

  /** 删除过期记忆（archived 超过宽限期 / validTo 过期超过宽限期） */
  async deleteExpired(graceDays = 30) {
    const redis = this.redis
    const now = nowSec()
    const ids = []
    if (redis.scanIterator) {
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:item:*`, COUNT: 3000 })) {
        ids.push(key.split(':').pop())
      }
    }
    let removed = 0
    for (const id of ids) {
      const m = await this._getMemory(id)
      if (!m) continue
      if (m.status !== 'active') {
        // archived 的记忆：validTo（秒）或 updatedAt（毫秒→秒）超过宽限期则删除
        const expireAt = m.validTo || Math.floor((m.updatedAt || 0) / 1000)
        if (expireAt && expireAt <= now - graceDays * 86400) {
          await this._deleteMemory(m); removed++
        }
      } else if (m.validTo && m.validTo > 0 && m.validTo <= now - graceDays * 86400) {
        // active 但 validTo 已过期超过宽限期（过期计划/事件）：不再召回，物理清理，
        // 避免永久占用 Redis、记忆上限与索引
        await this._deleteMemory(m); removed++
      }
    }
    return removed
  }

  /* ================= 统计 ================= */

  async stats() {
    const redis = this.redis
    let total = 0
    const byScope = { user: 0, user_group: 0, group: 0 }
    const byKind = {}
    const ids = []
    if (redis.scanIterator) {
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:item:*`, COUNT: 3000 })) {
        ids.push(key.split(':').pop())
      }
    }
    for (const id of ids) {
      const m = await this._getMemory(id)
      if (!m || m.status !== 'active') continue
      total++
      byScope[m.scope] = (byScope[m.scope] || 0) + 1
      byKind[m.kind] = (byKind[m.kind] || 0) + 1
    }
    return { total, byScope, byKind }
  }

  /* ================= 原文 ================= */

  /**
   * 保存一条群消息原文
   * @param {Object} row { groupId, messageId, senderId, senderName, role, text, time, isCommand, contentHash }
   * @param {number} retentionDays 保留天数（0=永久）
   */
  async saveRawMessage(row, retentionDays = 30) {
    const redis = this.redis
    const gid = String(row.groupId)
    const key = RAW(gid, row.messageId)
    const payload = {
      messageId: String(row.messageId),
      senderId: String(row.senderId),
      senderName: row.senderName || '',
      role: row.role || '',
      text: row.text || '',
      time: Number(row.time) || 0,
      isCommand: !!row.isCommand,
      contentHash: row.contentHash || '',
      groupId: gid,
    }
    await redis.set(key, JSON.stringify(payload))
    if (retentionDays > 0) await redis.expire(key, retentionDays * 86400)
    // score 统一为秒（与 getRawMessages 的秒级范围查询一致）
    await redis.zAdd(RAWIDX(gid), { score: Number(payload.time) || Math.floor(Date.now() / 1000), value: String(row.messageId) })
    // needs_reextract：补录/新消息改变了原文
    // - completed：窗口已提炼，需重提炼
    // - running：消息在模型生成期间到达，不在当前输入中，必须标记，完成后由下一轮重提炼
    //   （processWindow 开始运行时清脏、完成时不清脏，标记才会保留）
    // - 游标已跨过且无任务的空白日（历史补录）：直接创建待提炼任务，避免永久漏提炼
    if (payload.time) {
      const day = dayKeyOf(payload.time)
      const task = await redis.hGetAll(TASK(gid, day))
      if (task && (task.status === 'completed' || task.status === 'running')) {
        await redis.hSet(TASK(gid, day), { needsReextract: '1', updatedAt: Date.now() })
      } else if (!task || Object.keys(task).length === 0) {
        const policy = await redis.hGetAll(POLICY(gid))
        if (policy.lastDailyEnd && day <= String(policy.lastDailyEnd)) {
          await redis.hSet(TASK(gid, day), {
            status: 'pending', attemptCount: 0, needsReextract: '',
            nextAttemptAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
          })
        }
      }
    }
  }

  /** 取某群指定时间范围（秒）内的原文，按时间升序 */
  async getRawMessages(groupId, startTime, endTime) {
    const redis = this.redis
    const gid = String(groupId)
    const ids = await redis.zRangeByScore(RAWIDX(gid), startTime, endTime)
    const out = []
    for (const mid of ids) {
      const raw = await redis.get(RAW(gid, mid))
      if (!raw) continue
      try { out.push(JSON.parse(raw)) } catch { /* ignore */ }
    }
    out.sort((a, b) => a.time - b.time)
    return out
  }

  /** 最近一条原文的时间（用于确定首日游标） */
  async getRawTimeRange(groupId) {
    const redis = this.redis
    const gid = String(groupId)
    const all = await redis.zRange(RAWIDX(gid), 0, -1)
    if (all.length === 0) return null
    let min = Infinity, max = 0
    for (const mid of all) {
      const raw = await redis.get(RAW(gid, mid))
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw)
        if (parsed.time < min) min = parsed.time
        if (parsed.time > max) max = parsed.time
      } catch { /* ignore */ }
    }
    if (!Number.isFinite(min)) return null
    return { minTime: min, maxTime: max }
  }

  /** 清理过期的原文与索引（保留期内无需处理） */
  async cleanupExpiredRaw(groupId, retentionDays) {
    if (retentionDays <= 0) return 0
    const redis = this.redis
    const cutoff = Date.now() / 1000 - retentionDays * 86400
    const ids = await redis.zRangeByScore(RAWIDX(String(groupId)), 0, cutoff)
    let removed = 0
    for (const mid of ids) {
      await redis.del(RAW(String(groupId), mid))
      await redis.zRem(RAWIDX(String(groupId)), mid)
      removed++
    }
    return removed
  }

  /* ================= 提炼任务 ================= */

  async getTask(groupId, day) {
    const raw = await this.redis.hGetAll(TASK(String(groupId), String(day)))
    if (!raw || Object.keys(raw).length === 0) return null
    return raw
  }

  async setTask(groupId, day, fields) {
    const key = TASK(String(groupId), String(day))
    const entries = {}
    for (const [k, v] of Object.entries(fields)) entries[k] = String(v ?? '')
    await this.redis.hSet(key, entries)
    return key
  }

  async deleteTask(groupId, day) {
    await this.redis.del(TASK(String(groupId), String(day)))
  }

  async listTasks(groupId) {
    const redis = this.redis
    const out = []
    if (redis.scanIterator) {
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:task:${String(groupId)}:*`, COUNT: 1000 })) {
        const day = key.split(':').pop()
        const t = await this.getTask(groupId, day)
        if (t) out.push({ groupId: String(groupId), day, ...t })
      }
    }
    out.sort((a, b) => (a.day < b.day ? -1 : 1))
    return out
  }

  /* ================= 群策略 ================= */

  async getPolicy(groupId) {
    const raw = await this.redis.hGetAll(POLICY(String(groupId)))
    return raw && Object.keys(raw).length > 0 ? raw : {}
  }

  async setPolicy(groupId, fields) {
    const key = POLICY(String(groupId))
    const entries = {}
    for (const [k, v] of Object.entries(fields)) entries[k] = String(v ?? '')
    if (Object.keys(entries).length > 0) await this.redis.hSet(key, entries)
    return key
  }

  /** 授权群列表（来自 Config.memoryGroupCapture.groups） */
  static authorizedGroups(groups) {
    return (Array.isArray(groups) ? groups : [])
      .filter(g => g && g.groupId && g.switchOn)
      .map(g => ({ groupId: String(g.groupId), switchOn: true }))
  }

  static isGroupAuthorized(groups, groupId) {
    return MemoryStore.authorizedGroups(groups).some(g => g.groupId === String(groupId))
  }
}
