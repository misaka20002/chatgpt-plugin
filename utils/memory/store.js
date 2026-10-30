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
const SCOPE_LOCK = (scope, ownerId, groupId) => `${PREFIX}:scopeLock:${scope}:${ownerId}:${groupId || '-'}`

const SCOPES = ['user', 'user_group', 'group']
const KINDS = ['identity', 'preference', 'relationship', 'plan', 'group_rule', 'experience', 'episode']

/** 单值槽位：新值替换旧值；其余（如 preference.*）多值共存 */
export function isSingleValueFact(factKey) {
  return factKey === 'communication.style' || /^(?:identity|profile|group_role|plan)\./.test(factKey)
}

/**
 * factKey 别名表：只收「语义确定等价」的**完整 factKey**。
 *
 * 为什么需要：模型在在线（MemoryTool）与离线（每日提炼）两条链路上可能给同一事实取不同的
 * 槽位名，而 canonicalFactKey 只校验形状、不做语义判断，于是 profile.job 与 profile.occupation
 * 会各自建槽位、并存且互不覆盖（isSingleValueFact 只保证"同一个 key 单值替换"）。
 *
 * 必须映射完整键，不要写成后缀替换（endsWith('.job')）——那会误伤 plan.job / preference.job /
 * group.event.job 这类语义不同的槽位。
 *
 * 维护原则：保持保守，只加真实观察到漂移且语义等价的键，避免服务端"自作聪明"合并不同含义的槽位。
 * 注意：别名只影响**新写入**（add/retract 都经 validateCandidateShape → canonicalFactKey），
 * 不会自动迁移 Redis 里已存在的旧槽位数据。
 */
const FACT_KEY_ALIASES = Object.freeze({
  'profile.job': 'profile.occupation',
  'identity.sex': 'identity.gender',
  'identity.birthday': 'identity.birth_date',
})

/** factKey 规范化：小写、非法字符转点、必须形如 a.b，再把已知别名归一到 canonical 槽位 */
export function canonicalFactKey(factKey) {
  if (typeof factKey !== 'string') return ''
  const key = factKey.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '.').replace(/\.+/g, '.').replace(/^[^a-z]+/, '')
  if (!/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/.test(key)) return ''
  return FACT_KEY_ALIASES[key] || key
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
 * manual 是存储层预留的来源标记，不代表插件已经开放「主人手动新增/修改/锁定记忆」。
 * 当前管理指令仅支持查看、删除、清空等操作，没有把新记忆写成 source='manual' 的生产入口；
 * 需求方已明确本轮不新增手动写入/修改功能，后续不要误报为已实现。
 * 若历史数据存在 source='manual'：模型 retract、单值替换不能覆盖它，关闭来源群时仅移除证据。
 * Memory_Tool（包括主人在智能对话中要求记录）和 profile-scan 均为模型派生记忆，
 * 不属于 manual，仍须允许按后续事实正常更新或撤回。
 * 凌晨独立压缩同样不得自动归档 manual；手工管理删除仍按原权限执行。
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
 * operation 归一化：只接受 add / retract / ignore，其余一律判非法。
 *
 * 历史写法 `candidate.operation === 'retract' ? 'retract' : 'add'` 会把模型的拼写错误
 * （如 "remove" / "delete"）静默解释成"新增事实"，语义完全相反。
 */
function normalizeOperation(value) {
  if (value === undefined || value === null || value === '' || value === 'add') return 'add'
  if (value === 'retract') return 'retract'
  if (value === 'ignore') return 'ignore'
  return null
}

/**
 * 服务端校验候选的通用字段（不依赖证据归属的静态校验）
 * @returns {{ok: boolean, reason?: string, data?: Object}}
 */
export function validateCandidateShape(candidate) {
  if (!candidate || typeof candidate !== 'object') return { ok: false, reason: '候选为空' }

  const scope = SCOPES.includes(candidate.scope) ? candidate.scope : null
  const kind = KINDS.includes(candidate.kind) ? candidate.kind : null
  const operation = normalizeOperation(candidate.operation)

  if (operation === null) return { ok: false, reason: `非法 operation: ${candidate.operation}` }
  if (operation === 'ignore') return { ok: false, reason: 'ignore' }
  if (!scope) return { ok: false, reason: `非法作用域: ${candidate.scope}` }
  // add 必须给出合法 kind：静默降级（例如 episode 拼成 episod）会让记忆失去应有的生命周期语义
  if (operation === 'add' && !kind) return { ok: false, reason: `非法 kind: ${candidate.kind}` }

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

  // 内容层面不做敏感/凭证过滤：本系统部署在私人授权群，记什么由使用者决定（见 AGENTS.md）
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

  /** 作用域级写入互斥：实时写入与夜间合并/归档共享此锁。 */
  async _withScopeLock(scope, ownerId, groupId, work) {
    const key = SCOPE_LOCK(scope, ownerId, groupId)
    const token = genMemoryId()
    let acquired = false
    for (let attempt = 0; attempt < 60; attempt++) {
      // 锁租约统一写 `{ NX, EX }`（AGENTS.md 跨模块不变式）；PX 与 EX 语义等价，
      // 但混用会让排查锁时长的人来回换算秒与毫秒。
      if (await this.redis.set(key, token, { NX: true, EX: 120 }) === 'OK') { acquired = true; break }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    if (!acquired) throw new Error('记忆作用域正被其他操作占用，请稍后重试')
    try {
      return await work()
    } finally {
      if (typeof this.redis.eval === 'function') {
        await this.redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", {
          keys: [key], arguments: [token],
        })
      } else if (await this.redis.get(key) === token) {
        // 单元测试 Redis mock；真实 Redis 必须通过上述原子 Lua 释放。
        await this.redis.del(key)
      }
    }
  }

  /* ================= 记忆写入 ================= */

  /**
   * 【ctx 可信字段约定】
   * `ctx` 是**服务端可信上下文**，`candidate` 是模型给的**不可信数据**，两者绝不能混。
   * 其中 `ctx.isBotMaster: true` 表示"本次写入由 Bot 主人发起"，效果等同于群主/管理员：
   * 群作用域（scope: 'group'）的候选只要有它就能用单条消息放行
   * （见 validateEvidenceOwnership 的 group 分支）。
   * 个人作用域仅 retract 可凭主人消息撤回他人事实；add 仍须本人证据，manual 保护不变。
   *
   * 因此这是"**谁传谁授权**"的字段：
   * - 新增任何调用 applyFact / applyCandidates 的地方，若要在 ctx 里带上它，
   *   该值**必须**取自服务端事件上下文（如 `e.isMaster`），
   *   绝不能来自模型参数（tool_calls.arguments）、候选对象或任何外部输入；
   * - 不要把 `isBotMaster`（或任何鉴权字段）写进 candidate —— 模型能构造 candidate，
   *   一旦混进去就等于把授权交给模型伪造。
   * - 目前唯一的生产调用点是 `utils/tools/MemoryTool.js`；
   *   `dailyTask` / `applyExtractedCandidates` / `profile-scan` 都不传，规则保持原样。
   */

  /**
   * 批量应用候选（同批合并 + 逐条写入）
   * @param {Array<Object>} candidates
   * @param {Object} ctx { groupId, day?, source, evidenceMap }（可信字段约定见上）
   * @returns {Promise<Array<Object>>} 每条候选的处理结果
   */
  async applyCandidates(candidates, ctx = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) return []
    const results = []
    const merged = new Map()

    // 同批精确去重始终执行，不受任何容量压缩阈值影响；operation/scope/主体/群/键/值一致才合并证据。
    // 不同 factKey 或 factValue 的语义相近事实，不能在此靠字符串相似度武断合并。
    for (const raw of candidates) {
      // 与 applyFact 共用同一套形状校验与归属推导：分组键必须等于真正落库的 owner/group，
      // 否则会出现"分组时算 A、写入时算 B"的重复条目。
      const resolved = this._resolveWriteTarget(raw, ctx)
      if (!resolved.ok) { results.push({ ok: false, candidate: raw, reason: resolved.reason }); continue }
      const { c, scope, ownerId, groupId } = resolved
      const token = `${c.operation}:${scope}:${ownerId}:${groupId}:${c.factKey}:${c.factValue}`
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
   * 由候选（不可信）与 ctx（可信）解析写入目标：形状校验 + 作用域归属推导。
   *
   * 加锁前需要锁键、锁内需要再复核，所以调用两次；规则只有这一份实现，
   * 避免两处各自推导 ownerId/groupId 时悄悄分叉。
   * @returns {{ok: true, c: Object, scope: string, ownerId: string, groupId: string} | {ok: false, reason: string}}
   */
  _resolveWriteTarget(candidate, ctx = {}) {
    const checked = validateCandidateShape(candidate)
    if (!checked.ok) return { ok: false, reason: checked.reason }
    const c = checked.data
    const scope = c.scope
    const ownerId = String(scope === 'group' ? (ctx.groupId || '') : (c.subjectId || ctx.subjectId || ''))
    const groupId = scope === 'user' ? '' : String(ctx.groupId || '')
    if (!ownerId) return { ok: false, reason: '记忆主体缺失' }
    // user_group / group 必须在群语境里：私聊（ctx.groupId 为空）写入会落到 `...:user_group:<uid>:-`，
    // 而 _insertMemory 只在有 groupId 时建 GRP 反向索引，clearUser 又靠扫 GRP:* 找 user_group →
    // 会出现"召回得到、清不掉"的孤儿数据
    if (scope !== 'user' && !groupId) return { ok: false, reason: `${scope} 作用域必须在群聊中使用` }
    return { ok: true, c, scope, ownerId, groupId }
  }

  /**
   * 应用单条候选（add/reinforce/update/retract 语义）
   * @param {Object} candidate 模型给出的候选（不可信）
   * @param {Object} ctx 服务端可信上下文；`ctx.isBotMaster` 的授权语义见上方"ctx 可信字段约定"
   * @returns {Promise<{ok: boolean, action: string, memoryId?: string, reason?: string}>}
   */
  async applyFact(candidate, ctx = {}) {
    try {
      const target = this._resolveWriteTarget(candidate, ctx)
      if (!target.ok) return { ok: false, action: 'invalid', reason: target.reason }
      const { scope, ownerId, groupId } = target
      return await this._withScopeLock(scope, ownerId, groupId, () => this._applyFactUnlocked(candidate, ctx))
    } catch (err) {
      logger?.error?.(`[MemoryV2] applyFact 失败: ${err.message}`)
      return { ok: false, action: 'error', reason: err.message }
    }
  }

  async _applyFactUnlocked(candidate, ctx = {}) {
    try {
      const redis = this.redis
      const now = nowMs()
      const target = this._resolveWriteTarget(candidate, ctx)
      if (!target.ok) return { ok: false, action: 'invalid', reason: target.reason }
      const c = target.c
      const ownerId = target.ownerId
      const groupId = target.groupId

      // 证据归属二次校验（即使 extractor 已校验，store 也不信任）
      const evidence = this._buildEvidence(c.evidenceMessageIds, ctx)
      if (c.operation === 'add' && evidence.length === 0) {
        return { ok: false, action: 'invalid', reason: '证据无法在上下文中定位' }
      }
      const ownership = this.validateEvidenceOwnership(c, evidence, ctx)
      if (!ownership.ok) {
        return { ok: false, action: 'invalid', reason: ownership.reason }
      }

      // 事件类有效期以"最新证据时间"为基准，而不是入库时间。
      // 补提炼 6 个月前的"我现在失业了"时，若以入库时间起算，会凭空多出从今天开始的保留期。
      const evidenceTimeSec = Math.max(0, ...evidence.map(ev => Number(ev.t) || 0))
      const eventTtlBase = evidenceTimeSec || nowSec()

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
        const reason = archived > 0 ? '' : targets.some(isManualMemory)
          ? '目标是手工确认记忆，不能通过模型撤回，请使用 #删除记忆 用户ID 记忆ID'
          : '无可撤回目标，请核对 subjectId、scope、factKey 和 factValue（须与已存记忆一致）'
        return { ok: true, action: archived > 0 ? 'retracted' : 'ignored', reason }
      }

      // ---- add ----
      // 0) 单值槽位若已被「手工确认」记忆占据且取值不同，模型不得替换。
      //    必须放在同值强化之前：否则"1 条 manual + 1 条 derived"时只会归档 derived 再插入新值，
      //    最终留下旧 manual + 新 derived 两个 active 值，单值语义被破坏。
      if (isSingleValueFact(c.factKey)) {
        const manualConflict = active.some(m => isManualMemory(m) && m.factValue !== c.factValue)
        if (manualConflict) return { ok: false, action: 'ignored', reason: '单值槽位被手工确认记忆占据，忽略新值' }
      }

      // 1) 全时精确去重：同主体、同作用域、同 factKey + factValue 时复用旧记忆，合并证据并强化。
      // 这条保障不依赖独立压缩触发条件；跨键语义重复交由离线提炼时的历史事实对照。
      const sameValue = active.find(m => m.factValue === c.factValue)
      if (sameValue) {
        const addedEvidence = await this._mergeEvidence(sameValue, evidence, ctx.groupId)
        if (addedEvidence === 0) {
          // 证据全部已存在 → 幂等跳过（不重复提高置信度）
          return { ok: true, action: 'skipped', memoryId: sameValue.id, reason: '证据已存在，幂等跳过' }
        }
        // 有新证据 = 用户再次确认：text 同步刷新（年龄自述日期之类不能停在旧文本），
        // episode/plan 的有效期按最新证据时间续期，显式 validTo 直接采用
        if (c.text) sameValue.text = c.text
        if (c.validTo) sameValue.validTo = c.validTo
        else if (sameValue.kind === 'episode' || sameValue.kind === 'plan') {
          sameValue.validTo = eventTtlBase + (ctx.eventRetentionDays ?? 90) * 86400
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

      // 3) 新增：实时与离线提炼均保留合格事实，不按 importance 淘汰。
      // 各作用域超过容量的 95% 才由凌晨独立压缩任务决定保留集合。
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
        validTo: c.validTo || ((c.kind === 'episode' || c.kind === 'plan') && !c.validTo ? eventTtlBase + (ctx.eventRetentionDays ?? 90) * 86400 : 0),
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
   * 个人事实新增必须有本人证据；主人管理撤回可以使用主人消息；群事实需主人/管理公告或多人支持。
   * @param {Object} [ctx] 服务端可信上下文，`{ isBotMaster }`：主人可发布群事实，也可管理撤回个人事实。
   *        只能由调用方从事件上下文（`e.isMaster`）传入，绝不来自模型 candidate；
   *        这是"谁传谁授权"的字段（授权语义与生产调用点见文件上方"ctx 可信字段约定"）。
   * @returns {{ok: boolean, reason: string}}
   */
  validateEvidenceOwnership(c, evidence, ctx = {}) {
    if (c.scope === 'user' || c.scope === 'user_group') {
      const senders = new Set(evidence.map(ev => ev.s).filter(Boolean))
      const subjectId = String(c.subjectId || '')
      if (!subjectId) return { ok: false, reason: '个人记忆缺少 subjectId' }
      if (c.operation === 'retract' && ctx.isBotMaster === true) {
        return senders.has(String(c.speakerId || ''))
          ? { ok: true, reason: '' }
          : { ok: false, reason: '主人撤回缺少实际发话人的消息证据' }
      }
      if (!senders.has(subjectId)) return { ok: false, reason: `个人事实必须有本人消息作为证据（subjectId ${subjectId} 不在证据发送者中，疑似转述/伪造）` }
      if (c.speakerId && String(c.speakerId) !== subjectId) return { ok: false, reason: 'speakerId 与 subjectId 不一致' }
      return { ok: true, reason: '' }
    }
    if (c.scope === 'group') {
      const senders = new Set(evidence.map(ev => ev.s).filter(Boolean))
      const authoritative = evidence.some(ev => ['owner', 'admin'].includes(String(ev.r || '').toLowerCase()))
      // Bot 主人（可信 ctx）等同群主/管理员：单条消息即可写群级事实
      if (ctx.isBotMaster === true || authoritative || senders.size >= 2) return { ok: true, reason: '' }
      return { ok: false, reason: `群事实必须来自 Bot 主人、群管理公告或至少两名成员支持（当前 ${senders.size} 人）` }
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
        // 证据来自其他群时也补建该群的 GRP 反向索引：clearGroup 靠它找到「曾在本群留下证据」
        // 的记忆，规则与 _insertMemory 一致。该索引只表示"与该群有过证据交集"，
        // 不参与召回、不改变跨群读取/写入权限（召回只读 idx:{scope}:{owner}:{gid}）。
        if (ev.g && ev.g !== groupId) await redis.sAdd(GRP(ev.g), memory.id)
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

  /** 当前有效记忆数：排除已归档和已经超过 validTo 的事实。 */
  async countActiveByScope(scope, ownerId, groupId = '') {
    const redis = this.redis
    const ids = await redis.sMembers(IDX(scope, ownerId, groupId))
    const now = nowSec()
    let count = 0
    for (const id of ids) {
      const m = await this._getMemory(id)
      // 已过期（validTo 过去）但仍在 30 天物理清理宽限期内的记忆不该占配额：
      // 它已不参与召回，却会挤掉仍有效的新记忆
      if (m && m.status === 'active' && !(m.validTo > 0 && m.validTo <= now)) count++
    }
    return count
  }

  /** 历史证据统计供 LLM 比较可靠性，不传私聊或群聊消息原文。 */
  async summarizeMemoryEvidence(memoryId) {
    const raw = await this.redis.sMembers(EVD(memoryId))
    const groups = new Set()
    const senders = new Set()
    let latest = 0
    let validCount = 0
    let corrupt = 0
    for (const value of raw) {
      try {
        const ev = JSON.parse(value)
        validCount++
        if (ev.g) groups.add(String(ev.g))
        if (ev.s) senders.add(String(ev.s))
        latest = Math.max(latest, Number(ev.t) || 0)
      } catch {
        // 单条证据损坏只丢它自己，统计仍要返回可用部分；计数后统一告警，
        // 逐条 logger 会在一次压缩里刷出成百条重复日志。
        corrupt++
      }
    }
    if (corrupt > 0) logger?.warn?.(`[MemoryV2] 记忆 ${memoryId} 有 ${corrupt} 条证据 JSON 损坏，已跳过统计`)
    return { count: validCount, groupCount: groups.size, senderCount: senders.size, lastEvidenceAt: latest }
  }

  /**
   * 读取作用域内有效记忆：排除已过期的 active 项，按 id 稳定排序。
   * 触发扫描、模型输入与压缩提交必须用同一顺序与同一过滤规则，
   * 否则逐条比对快照会因为「一边已过滤过期项」而假性 stale。
   */
  async _activeSortedByScope({ scope, ownerId, groupId }) {
    const now = nowSec()
    return (await this.listByScope({ scope, ownerId, groupId }))
      .filter(m => !(m.validTo > 0 && m.validTo <= now))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  }

  /** 列出有效记忆作用域。只扫描索引键，不按所有群成员发送请求。 */
  async listCompressionScopes({ maxMemoriesPerUser = 100, maxMemoriesPerGroup = 50 } = {}) {
    const result = []
    if (!this.redis.scanIterator) throw new Error('Redis 不支持作用域索引扫描')
    const seen = new Set()
    for await (const key of this.redis.scanIterator({ MATCH: `${PREFIX}:idx:*`, COUNT: 1000 })) {
      const prefix = `${PREFIX}:idx:`
      if (!String(key).startsWith(prefix)) continue
      const parts = String(key).slice(prefix.length).split(':')
      if (parts.length !== 3) continue
      const [scope, ownerId, gid] = parts
      if (!SCOPES.includes(scope) || !ownerId) continue
      const groupId = gid === '-' ? '' : gid
      if (scope === 'user' && groupId) continue
      if (scope !== 'user' && !groupId) continue
      if (scope === 'group' && ownerId !== groupId) continue
      if (seen.has(key)) continue
      seen.add(key)
      const capValue = scope === 'group' ? maxMemoriesPerGroup : maxMemoriesPerUser
      const cap = Number(capValue)
      if (!Number.isInteger(cap) || cap <= 0) continue
      // 已归档的旧项也保留在 idx 中；SCARD 是无假阴性的快速筛选，不能直接当有效数量。
      const indexedCount = typeof this.redis.sCard === 'function'
        ? await this.redis.sCard(key) : (await this.redis.sMembers(key)).length
      if (indexedCount <= cap * 0.95) continue
      const memories = (await this._activeSortedByScope({ scope, ownerId, groupId }))
        .filter(m => m.scope === scope && String(m.ownerId) === ownerId && String(m.groupId || '') === groupId)
      if (memories.length > cap * 0.95) {
        result.push({ scope, ownerId, groupId, cap, target: Math.floor(cap * 0.7), memories })
      }
    }
    return result
  }

  /** 每天每作用域最多尝试一次独立压缩 POST。Redis SET NX 防止重复调度或多进程重复请求。 */
  async claimCompressionAttempt(scope, ownerId, groupId = '') {
    const day = dayKeyOf(nowSec())
    const key = `${PREFIX}:compressionAttempt:${day}:${scope}:${ownerId}:${groupId || '-'}`
    return await this.redis.set(key, '1', { NX: true, EX: 2 * 86400 }) === 'OK'
  }

  /** 压缩归档使用原始 JSON 的 Redis 原子 CAS，防止并发实时更新时覆写事实。 */
  async _archiveCompressionIfSame(memory, reason, detail) {
    const key = `${PREFIX}:item:${memory.id}`
    const expected = JSON.stringify(memory)
    const archived = {
      ...memory,
      status: 'archived',
      source: reason,
      originalSource: memory.source,
      archiveReason: detail,
      archivedAt: nowSec(),
      updatedAt: nowMs(),
    }
    const next = JSON.stringify(archived)
    if (typeof this.redis.eval === 'function') {
      const script = "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2]); return 1"
      return Number(await this.redis.eval(script, { keys: [key], arguments: [expected, next] })) === 1
    }
    // 轻量单元测试 MockRedis 的回退。真实 node-redis 使用上面的 Redis 原子 CAS。
    if (await this.redis.get(key) !== expected) return false
    await this.redis.set(key, next)
    return true
  }

  /**
   * 模型给出完整保留清单；验证输入快照、身份、覆盖与 manual 后才进行归档。
   * 任一校验失败时不改动历史；LLM 不能自行扩大作用域、指定额外 ID 或写入新事实。
   */
  async applyCompressionPlan(scopeInfo, plan) {
    const { scope, ownerId, groupId } = scopeInfo
    try {
      return await this._withScopeLock(scope, ownerId, groupId, () => this._applyCompressionPlanUnlocked(scopeInfo, plan))
    } catch (err) {
      return { status: 'busy', reason: err.message }
    }
  }

  async _applyCompressionPlanUnlocked({ scope, ownerId, groupId, memories, partialScope = false }, plan) {
    if (!plan || !Array.isArray(plan.keepIds) || !Array.isArray(plan.mergePlans) || !Array.isArray(plan.archiveIds)) {
      return { status: 'invalid', reason: '压缩输出缺少 keepIds/mergePlans/archiveIds' }
    }
    const current = await this._activeSortedByScope({ scope, ownerId, groupId })
    // 分片压缩只能修改本片已提交给模型的 ID；同时复核这些 ID 的实际内容。
    const allowed = new Set(memories.map(m => m.id))
    const reviewed = partialScope ? current.filter(m => allowed.has(m.id)) : current
    if (reviewed.length !== memories.length || JSON.stringify(reviewed) !==
        JSON.stringify([...memories].sort((a, b) => String(a.id).localeCompare(String(b.id))))) {
      return { status: 'stale', reason: '本片历史记忆在模型请求期间发生变化，放弃归档' }
    }
    const existing = new Map(reviewed.map(m => [m.id, m]))
    const seen = new Set()
    const keep = new Set()
    const archive = new Map()
    const merges = []
    const mark = (id) => {
      if (typeof id !== 'string' || !existing.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    }
    for (const id of plan.keepIds) {
      if (!mark(id)) return { status: 'invalid', reason: '保留 ID 不合法或重复' }
      keep.add(id)
    }
    for (const item of plan.archiveIds) {
      if (!item || !mark(item.id) || typeof item.reason !== 'string' || item.reason.trim().length < 4 ||
          item.reason.length > 250 || isManualMemory(existing.get(item.id))) {
        return { status: 'invalid', reason: '归档 ID、理由或 manual 权限不合法' }
      }
      archive.set(item.id, { reason: item.reason })
    }
    for (const item of plan.mergePlans) {
      if (!item || !Array.isArray(item.removeIds) || item.removeIds.length === 0 ||
          typeof item.keepId !== 'string' || !keep.has(item.keepId) ||
          typeof item.reason !== 'string' || item.reason.trim().length < 4 || item.reason.length > 250) {
        return { status: 'invalid', reason: '合并结构、保留项或理由不合法' }
      }
      for (const id of item.removeIds) {
        if (!mark(id) || isManualMemory(existing.get(id))) {
          return { status: 'invalid', reason: '合并移除项不合法或受保护' }
        }
        const a = existing.get(item.keepId)
        const b = existing.get(id)
        // 合并成立的两个条件：同一个原子事实槽位（factKey 与 factValue 都相同），
        // 或同 kind 且正文去掉空白后完全一致（模型换了一套键名描述同一件事）。
        //
        // 已知代价（2026-10-23 与用户确认后接受）：跨 factKey 合并时保留项不继承被删项的
        // factKey/factValue，被删项的槽位随之消失——之后按该槽位撤回不会命中，需按保留项的键撤回。
        // 真正无损需要槽位别名/继承，属独立议题，不在压缩路径里临时发明。
        const sameSlot = a.factKey === b.factKey && a.factValue === b.factValue
        const sameText = a.kind === b.kind &&
          String(a.text || '').replace(/\s+/g, '') === String(b.text || '').replace(/\s+/g, '')
        if (!sameSlot && !sameText) {
          return { status: 'invalid', reason: '无法确认合并项是同一原子事实，保留原事实' }
        }
        merges.push({ keepId: item.keepId, removeId: id, reason: item.reason })
      }
    }
    if (seen.size !== existing.size) return { status: 'invalid', reason: '模型没有对所有历史记忆给出保留或归档决定' }

    // 不把 Redis 部分写入伪装成事务：每条写入前再核对当前值；并发发生时拒绝后续操作。
    // 此处是单作用域的保守执行器，先迁移重复证据再归档其来源记录。
    let changed = 0
    for (const action of merges) {
      const saved = await this._getMemory(action.keepId)
      const removed = await this._getMemory(action.removeId)
      if (JSON.stringify(saved) !== JSON.stringify(existing.get(action.keepId)) ||
          JSON.stringify(removed) !== JSON.stringify(existing.get(action.removeId))) {
        return { status: 'partial', reason: '合并期间记录更新，停止操作', changed }
      }
      const raw = await this.redis.sMembers(EVD(action.removeId))
      // 坏证据只丢它自己，但不能静默：合并是"迁移证据"，少一条就少一个来源。
      const evidence = []
      let corrupt = 0
      for (const value of raw) {
        try { evidence.push(JSON.parse(value)) } catch { corrupt++ }
      }
      if (corrupt > 0) logger?.warn?.(`[MemoryV2] 合并 ${action.removeId} 时有 ${corrupt} 条证据 JSON 损坏，已跳过`)
      await this._mergeEvidence(saved, evidence, '')
      if (!await this._archiveCompressionIfSame(removed, 'compressed_duplicate', action.reason)) {
        return { status: 'partial', reason: '迁移证据后源记录发生变化，已保留源记录', changed }
      }
      changed++
    }
    for (const [id, item] of archive) {
      const saved = await this._getMemory(id)
      if (JSON.stringify(saved) !== JSON.stringify(existing.get(id))) {
        return { status: 'partial', reason: '归档期间记录更新，停止操作', changed }
      }
      if (!await this._archiveCompressionIfSame(saved, 'compressed_capacity', item.reason)) {
        return { status: 'partial', reason: '归档时发现并发更新，已保留记录', changed }
      }
      changed++
    }
    return { status: 'applied', changed, reason: '' }
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
      for await (const key of redis.scanIterator({ MATCH: `${PREFIX}:compressionAttempt:*`, COUNT: 3000 })) keys.push(key)
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
   * - user 派生记忆（`group-window*` / `profile-scan` / `Memory_Tool`，见 `isDerivedMemory`）：
   *   仅本群证据 → 整条删除；多群证据 → 仅移除本群证据
   * - user 手工确认的记忆 → 仅移除本群证据，记忆本体保留
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
        const expireAt = m.archivedAt || m.validTo || Math.floor((m.updatedAt || 0) / 1000)
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
   * @param {Object} row { groupId, messageId, senderId, senderName, role, text, time, isCommand, contentHash,
   *                       at?, atAll?, reply?, forward?, cards?, poke? }
   *        结构化字段（@/引用/合并转发/卡片/戳一戳）可选，缺省时记录形状与旧数据一致
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
    // 结构化段：仅在确有内容时落库（旧记录无这些字段，读取方按缺省处理）
    if (Array.isArray(row.at) && row.at.length) payload.at = row.at.map(String)
    if (row.atAll) payload.atAll = true
    if (row.reply) payload.reply = row.reply
    if (row.forward) payload.forward = row.forward
    if (Array.isArray(row.cards) && row.cards.length) payload.cards = row.cards
    if (row.poke) payload.poke = row.poke
    await redis.set(key, JSON.stringify(payload))
    if (retentionDays > 0) await redis.expire(key, retentionDays * 86400)
    // score 统一为秒（与 getRawMessages 的秒级范围查询一致）
    await redis.zAdd(RAWIDX(gid), { score: Number(payload.time) || Math.floor(Date.now() / 1000), value: String(row.messageId) })
    // needs_reextract：补录/新消息改变了原文
    // - completed：窗口已提炼，需重提炼
    // - running：消息在模型生成期间到达，不在当前输入中，必须标记，完成后由下一轮重提炼
    //   （processWindow 开始运行时清脏、完成时不清脏，标记才会保留）
    // - 游标已跨过且无任务的空白日（历史补录）：直接创建待提炼任务，避免永久漏提炼
    //
    // 仅对「会进入提炼输入」的记录标脏：dailyTask 取行时按 `!r.isCommand && r.text` 过滤，
    // 所以无文本记录（纯 @ / 纯引用 / 戳一戳）与指令记录永远不会参与提炼，
    // 给它们标脏只会让同一个窗口白跑一次模型调用。
    if (payload.text && !payload.isCommand && payload.time) {
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

  /**
   * 按 id 批量取原文：索引存在但原文已过 TTL 的 key 直接跳过。
   *
   * 单次 mGet 的键数控制在 200，避免大群一次取太多把 Redis 阻塞。
   */
  async fetchRawRows(groupId, ids) {
    const gid = String(groupId)
    const rows = []
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200)
      const values = await this.redis.mGet(batch.map(mid => RAW(gid, mid)))
      for (let i = 0; i < values.length; i++) {
        // 索引的清理与原文 TTL 独立，过期的原文不能变成互动记录。
        if (values[i] === null) continue
        try {
          rows.push(JSON.parse(values[i]))
        } catch (err) {
          throw new Error(`[MemoryV2] 读取群 ${gid} 的原文 ${batch[i]} 失败`, { cause: err })
        }
      }
    }
    return rows
  }

  /** 图谱只读最近的保留记录：限制扫描量并分批取值，避免大群一次出图拖住 Redis。 */
  async getRecentRawMessages(groupId, endTime) {
    const gid = String(groupId)
    const limit = 20000
    // ZRANGE BYSCORE REV 要求 Redis >= 6.2；宿主仍可能使用 6.0。
    // node-redis v4 没有旧命令的快捷方法，用 sendCommand 保留同样的倒序、时间与条数边界。
    const ids = await this.redis.sendCommand([
      'ZREVRANGEBYSCORE', RAWIDX(gid), String(endTime), '-inf', 'LIMIT', '0', String(limit + 1)
    ])
    const rows = await this.fetchRawRows(gid, ids.slice(0, limit))
    return { rows, limited: ids.length > limit, limit }
  }

  /**
   * 按时间倒序分页读取原文（#女娲蒸馏 用它铺满整个保留期）。
   *
   * `endTime` 必须由调用方固定：区间内的偏移才稳定——扫描期间新到的消息时间戳更大，
   * 不会挤进这个区间，翻页也就不会重复或跳过。
   * 返回的 `count` 是本页 id 数（不是解析成功的行数），调用方据此判断是否最后一页。
   */
  async getRecentRawMessagesPage(groupId, endTime, offset, limit) {
    const gid = String(groupId)
    const start = Math.max(0, Math.floor(Number(offset) || 0))
    const size = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 0)))
    const ids = await this.redis.sendCommand([
      'ZREVRANGEBYSCORE', RAWIDX(gid), String(endTime), '-inf', 'LIMIT', String(start), String(size)
    ])
    if (ids.length === 0) return { rows: [], count: 0 }
    return { rows: await this.fetchRawRows(gid, ids), count: ids.length }
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
