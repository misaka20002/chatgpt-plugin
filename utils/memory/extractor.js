/**
 * 记忆提取器：模型调用 + 服务端校验
 *
 * 服务端不信任模型输出，逐条重新校验：
 * 证据归属、作用域枚举、factKey/factValue 规范、置信度阈值（仅 add）、
 * 候选形状、长度与同批重复候选；个人事实必须有本人消息作为证据，
 * 群事实必须来自群管理公告或至少两名成员支持。
 * 内容层不做敏感/凭证过滤（见 AGENTS.md）。
 */

import { buildExtractionPrompt, EXTRACTOR_SYSTEM } from './prompt.js'
import { MemoryStore, canonicalFactKey, validateCandidateShape } from './store.js'

/**
 * 新增/更新类候选的最低置信度：**内部提取策略，不是用户配置**。
 *
 * 唯一来源（在线 MemoryTool、离线提炼、画像扫描共用），不要再去读
 * `Config.memoryGroupCapture.minConfidence`，也不要在这里另起一个 0.7。
 *
 * retract 不经过这个阈值：`validateCandidateShape` 会把 retract 的 confidence 规范化为 0，
 * 若一并比较，模型产出的每个 retract 都会以"置信度 0 低于阈值"被永久拒收（离线 retract 形同死代码）。
 * retract 的可信度来自「本人明确否定 + 证据归属校验」，与 add 的置信度不是同一回事。
 */
export const MEMORY_MIN_CONFIDENCE = 0.7

/** 中文为主的近似 token 估算：字符数 / 1.7 */
export function estimateTokens(text) {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk / 1.2 + other / 4)
}

/**
 * 按 token 上限切分消息行（相邻窗回带尾部重叠，防止跨窗问答断裂）
 * @param {Array<Object>} rows
 * @param {number} tokenLimit
 * @returns {{chunks: Array<Array<Object>>, skipped: Array<Object>}}
 */
export function partitionRowsByTokens(rows, tokenLimit = 30000) {
  const chunks = []
  const skipped = []
  let current = []
  let currentTokens = 0
  for (const row of rows) {
    const rowTokens = estimateTokens(row.text || '') + 4
    if (rowTokens > tokenLimit) {
      skipped.push(row)
      continue
    }
    if (current.length > 0 && currentTokens + rowTokens > tokenLimit) {
      // 回带尾部重叠行（不超过 tokenLimit 的 10%）
      const overlap = []
      let overlapTokens = 0
      for (let i = current.length - 1; i >= 0; i--) {
        const t = estimateTokens(current[i].text || '') + 4
        if (overlapTokens + t > Math.max(400, tokenLimit * 0.1)) break
        overlap.unshift(current[i])
        overlapTokens += t
      }
      chunks.push(current)
      current = [...overlap]
      currentTokens = overlapTokens
    }
    current.push(row)
    currentTokens += rowTokens
  }
  if (current.length > 0) chunks.push(current)
  return { chunks, skipped }
}

/**
 * 证据归属校验（模型输出不可信，服务端复检）
 * @param {Object} candidate 候选（含 subjectId/speakerId/scope/evidenceMessageIds）
 * @param {Object} evidenceMap { messageId: {groupId, senderId, senderName, role, time} }
 * @param {Object} [ctx] 服务端可信上下文，`{ isBotMaster }`：Bot 主人等同群主/管理员。
 *        只能由调用方从事件上下文（`e.isMaster`）传入，**绝不来自模型 candidate**；
 *        这是"谁传谁授权"的字段，新增调用点必须先确认来源可信。离线每日提炼不传该字段。
 * @returns {{ok: boolean, reason: string}}
 */
export function validateEvidence(candidate, evidenceMap = {}, ctx = {}) {
  const ids = Array.isArray(candidate.evidenceMessageIds) ? candidate.evidenceMessageIds : []
  const evidence = ids.map(id => evidenceMap[String(id)]).filter(Boolean)
  if (evidence.length === 0) return { ok: false, reason: '证据消息未在上下文中找到' }

  const senders = new Set(evidence.map(e => String(e.senderId)).filter(Boolean))
  const roles = evidence.map(e => String(e.role || '').toLowerCase())

  if (candidate.scope === 'user' || candidate.scope === 'user_group') {
    const subjectId = String(candidate.subjectId || '')
    if (!subjectId) return { ok: false, reason: '个人记忆缺少 subjectId' }
    // 个人事实必须有本人消息作为证据
    if (!senders.has(subjectId)) return { ok: false, reason: `subjectId ${subjectId} 不是任何证据消息的发送者（他人转述/伪造）` }
    // 若给出 speakerId，必须等于 subjectId
    if (candidate.speakerId && String(candidate.speakerId) !== subjectId) {
      return { ok: false, reason: 'speakerId 与 subjectId 不一致' }
    }
    return { ok: true, reason: '' }
  }

  // group：Bot 主人、群主/管理员公告，或至少两名不同成员支持
  const hasAuthoritative = roles.some(r => ['owner', 'admin'].includes(r))
  if (ctx.isBotMaster === true || hasAuthoritative || senders.size >= 2) return { ok: true, reason: '' }
  return { ok: false, reason: `群记忆需要 Bot 主人、群管理公告或至少两名成员支持（当前 ${senders.size} 人）` }
}

/**
 * 组装模型输入消息行
 * @param {Array<Object>} raws 原文记录
 */
export function toPromptRows(raws) {
  return raws.map(r => ({
    messageId: r.messageId,
    senderId: r.senderId,
    senderName: r.senderName,
    role: r.role,
    text: r.text,
    time: r.time,
    replyTo: null,
    atUsers: [],
  }))
}

/**
 * 执行一次提炼：调用模型并校验候选
 * @param {Object} options
 * @param {Array<Object>} options.rows 消息行
 * @param {Object} options.ctx { groupId, day, windowLabel, source }
 * @param {Object} options.evidenceMap
 * @param {Object} options.cfg { inputTokenLimit, use,
 *                                chunkRetries, chunkRetryBackoffMs }
 *                                （最低置信度不在此处：固定用 MEMORY_MIN_CONFIDENCE）
 * @param {Function} [options.llm] 可注入的模型调用函数（测试用），默认走 SubLLM
 * @param {Array<Object>} [options.resumeChunks] 断点续跑：已完成分片 [{key, accepted, rejected}]，
 *                                                命中时跳过模型调用直接复用其结果（只重试失败片）
 * @param {Function} [options.onChunkProgress] 每成功一片回调全量已完成片（调用方用于持久化断点）
 * @returns {Promise<{candidates: Array, skipped: Array, usage: Object}>}
 */
export async function runExtraction({ rows, ctx, evidenceMap, cfg = {}, llm, resumeChunks = [], onChunkProgress }) {
  const inputTokenLimit = cfg.inputTokenLimit || 30000
  // 每片模型调用失败后的即时重试次数（网络瞬时故障快速吸收）；退避 2s×2^(n-1)
  const chunkRetries = Number(cfg.chunkRetries) || 2
  const chunkRetryBackoffMs = Number(cfg.chunkRetryBackoffMs) || 2000

  const { chunks, skipped } = partitionRowsByTokens(rows, inputTokenLimit)
  const resumeByKey = new Map((resumeChunks || []).map(c => [c.key, c]))

  const accepted = []
  const rejected = []
  const done = [] // 全量已完成片（含 resume 复用的），传给 onChunkProgress 持久化
  let llmClient = null // SubLLM 惰性构造一次，所有分片/重试复用

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const key = chunkKey(chunk)
    const prior = resumeByKey.get(key)
    // 断点续跑：该片此前已成功，跳过模型调用直接复用其结果。
    // 信任前提：resumeChunks 只由本进程 onChunkProgress 写入（task.chunksDone），
    // 其 accepted 已过服务端校验（证据归属/置信度），此处不再重复校验。
    if (prior) {
      accepted.push(...(prior.accepted || []))
      rejected.push(...(prior.rejected || []))
      done.push(prior)
      continue
    }

    const windowLabel = `${ctx.windowLabel || ctx.day || 'unknown'}（分片 ${i + 1}/${chunks.length}）`
    const prompt = buildExtractionPrompt({
      groupId: ctx.groupId,
      windowLabel,
      rows: chunk,
    })

    // 片级结果独立：某一片反复失败只影响本片，成功片结果由 onChunkProgress 持久化，
    // 窗口级重试时 resumeChunks 命中即跳过，避免整窗重跑浪费已成功片的模型调用
    const chunkAccepted = []
    const chunkRejected = []
    let lastError = null
    for (let attempt = 0; attempt <= chunkRetries; attempt++) {
      if (attempt > 0) await sleepMs(chunkRetryBackoffMs * 2 ** (attempt - 1))
      try {
        let text = ''
        if (typeof llm === 'function') {
          const result = await llm(prompt)
          text = result.text
        } else {
          if (!llmClient) {
            const { SubLLM, useToProvider } = await import('../../model/SubLLM.js')
            const use = cfg.use || (await redis.get('CHATGPT:USE')) || 'api'
            llmClient = new SubLLM({
              provider: useToProvider(use),
              systemPrompt: EXTRACTOR_SYSTEM,
              temperature: 0.2,
              timeoutMs: 180000,
            })
          }
          const result = await llmClient.chat(prompt)
          text = result.text
        }

        // ---- 服务端校验（模型输出不可信，片内完成；断点续跑时整片结果复用） ----
        const parsed = parseCandidates(text)
        if (!parsed.ok) throw new Error(`提炼输出解析失败: ${parsed.reason}`)
        // 本片证据表：模型只应引用本片输入里的消息；越界引用（同窗口其他分片的真实消息）必须拒绝
        const chunkEvidenceMap = pickEvidenceForRows(evidenceMap, chunk)
        for (const raw of parsed.candidates) {
          // 1) 形状校验前置：不合格候选不得进入断点数据
          const shapeCheck = validateCandidateShape(raw)
          if (!shapeCheck.ok) {
            chunkRejected.push(sanitizeRejectedCandidate(raw, shapeCheck.reason))
            continue
          }
          const candidate = shapeCheck.data
          // 2) 证据归属（仅限本片可见的消息）
          const evidenceCheck = validateEvidence(candidate, chunkEvidenceMap)
          if (!evidenceCheck.ok) {
            chunkRejected.push(sanitizeRejectedCandidate(candidate, evidenceCheck.reason))
            continue
          }
          // 3) 置信度阈值：只约束 add/更新类候选。retract 的 confidence 被规范化成 0，
          //    参与比较会导致"明确否定"永远被拒收（它的可信度由明确否定语义 + 证据归属保证；
          //    实时 MemoryTool 另有删除权限门，离线提炼不看权限，这条阈值只保证 add 的质量）
          const confidence = Number(candidate.confidence)
          if (candidate.operation !== 'retract' && (!Number.isFinite(confidence) || confidence < MEMORY_MIN_CONFIDENCE)) {
            chunkRejected.push(sanitizeRejectedCandidate(candidate, `置信度 ${candidate.confidence} 低于阈值 ${MEMORY_MIN_CONFIDENCE}`))
            continue
          }
          chunkAccepted.push({
            ...candidate,
            subjectId: candidate.scope === 'group' ? undefined : String(candidate.subjectId || ''),
          })
        }
        lastError = null
        break
      } catch (err) {
        // 4xx（除 429）等确定性错误：重试无意义，立即失败不消耗片内重试次数
        if (!isRetryableLLMError(err)) throw err
        lastError = err
        if (attempt < chunkRetries) continue // 可重试错误按退避重试
      }
    }
    // 片内可重试错误耗尽仍失败：只抛本片错误（已成功片已通过 onChunkProgress 持久化）
    if (lastError) throw lastError

    accepted.push(...chunkAccepted)
    rejected.push(...chunkRejected)
    done.push({ key, accepted: chunkAccepted, rejected: chunkRejected })
    if (typeof onChunkProgress === 'function') await onChunkProgress(done)
  }

  return { candidates: accepted, rejected, skipped, usage: { chunks: chunks.length } }
}

/**
 * 判断模型调用错误是否值得重试：
 * - 网络类（node-fetch 系 code / fetch failed）/ 429 限流 / 5xx 服务端错误 → 可重试
 * - 明确的其他 4xx（鉴权失败、模型不存在、请求非法等）→ 重试无意义，短路直接失败
 * - 未知错误保守按可重试处理
 */
export function isRetryableLLMError(err) {
  if (!err) return true
  // 从常见库的字段提取 HTTP 状态：err.status / statusCode / response.status / cause 链
  let status = Number(err?.status ?? err?.statusCode ?? NaN)
  if (!Number.isFinite(status)) status = Number(err?.response?.status ?? NaN)
  if (!Number.isFinite(status)) status = Number(err?.cause?.response?.status ?? NaN)
  if (Number.isFinite(status) && status >= 400) return status === 429 || status >= 500
  const code = String(err?.code || '')
  if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR)/.test(code)) return true
  if (err instanceof TypeError || /fetch failed|network error|socket hang up/i.test(String(err?.message || ''))) return true
  return true
}

/** 等待（提取重试退避用；模块内纯函数，便于测试） */
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 分片内容稳定摘要（FNV-1a，不引 node:crypto）。
 * 断点续跑匹配键：partitionRowsByTokens 对相同 rows 确定性输出相同分片，故同一窗口
 * 重试时分区一致，可用内容摘要判断"哪几片已成功、哪一片失败需重试"。
 */
export function chunkKey(rows) {
  let h = 0x811c9dc5
  for (const r of rows) {
    const s = `${r.messageId}:${r.text || ''}`
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
  }
  return (h >>> 0).toString(36)
}

/**
 * 只保留本分片输入里真实存在的消息 ID 对应的证据。
 *
 * prompt 要求"只引用当前输入中真实存在的消息 ID"，但 dailyTask 传进来的是**整个日窗口**的
 * evidenceMap。若不按分片收窄，模型给出同一天另一个分片的真实 messageId 时服务端也会认可，
 * 尽管模型根本没看到那条消息正文。
 */
export function pickEvidenceForRows(evidenceMap = {}, rows = []) {
  const out = {}
  for (const row of rows) {
    const id = String(row?.messageId ?? '')
    if (!id) continue
    if (Object.prototype.hasOwnProperty.call(evidenceMap, id)) out[id] = evidenceMap[id]
  }
  return out
}

/**
 * 被拒候选只保留脱敏诊断（scope/factKey/reason）。
 *
 * 这里必须脱敏：`runExtraction` 的结果会经 `onChunkProgress` 持久化到 task hash（断点数据），
 * 被拒项的正文与取值没有任何理由跟着落库。若原样保存完整 raw，聊天原文会先一步写进 Redis，
 * 即使它最终没有成为 memory item，也会多留一份没人清理的副本。
 */
export function sanitizeRejectedCandidate(candidate, reason) {
  return {
    scope: typeof candidate?.scope === 'string' ? candidate.scope : '',
    factKey: canonicalFactKey(candidate?.factKey),
    reason: String(reason || ''),
  }
}

/**
 * 解析模型 JSON 输出（剥离 ```json 围栏）
 * @returns {{ok: boolean, candidates: Array, reason?: string}}
 */
export function parseCandidates(text) {
  if (!text || typeof text !== 'string') return { ok: false, candidates: [], reason: '空输出' }
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  // 定位第一个 { 与最后一个 }
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return { ok: false, candidates: [], reason: '输出不是 JSON 对象' }
  cleaned = cleaned.slice(start, end + 1)
  try {
    const parsed = JSON.parse(cleaned)
    // 必须真的是数组：`{"candidate":[...]}` / `{"candidates":{}}` 这类坏 schema 不能当成"确实没有记忆"，
    // 否则一次格式错误会让整个窗口直接 completed 且不再重试
    if (!Array.isArray(parsed?.candidates)) return { ok: false, candidates: [], reason: '输出缺少 candidates 数组' }
    return { ok: true, candidates: parsed.candidates }
  } catch (err) {
    return { ok: false, candidates: [], reason: err.message }
  }
}

/**
 * 将模型候选写入 V2 存储（含证据归属过滤）
 * @param {Array<Object>} candidates 已通过 runExtraction 校验的候选
 * @param {Object} ctx { groupId, day, source, evidenceMap, maxMemoriesPerUser, eventRetentionDays }
 * @param {MemoryStore} [store]
 * @returns {Promise<Array>} 处理结果
 */
export async function applyExtractedCandidates(candidates, ctx, store) {
  const s = store || new MemoryStore()
  const normalized = candidates.map(c => ({
    ...c,
    subjectId: c.scope === 'group' ? '' : (c.subjectId || ''),
    evidenceMessageIds: Array.isArray(c.evidenceMessageIds) ? c.evidenceMessageIds.map(String) : [],
  }))
  return s.applyCandidates(normalized, {
    groupId: ctx.groupId,
    day: ctx.day,
    source: ctx.source || `group-window:${ctx.groupId}:${ctx.day || 'x'}`,
    evidenceMap: ctx.evidenceMap,
    maxMemoriesPerUser: ctx.maxMemoriesPerUser,
    eventRetentionDays: ctx.eventRetentionDays,
  })
}
