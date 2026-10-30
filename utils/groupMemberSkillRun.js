import path from 'node:path'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { Config } from './config.js'
import { SubLLM } from '../model/SubLLM.js'
import { msgHistoryMgr } from '../model/Onebot11_MessageHistoryManager.js'
import { logError, logInfo, logWarn, toRelativePath } from './nuwaLog.js'
import { MemoryStore } from './memory/store.js'
import {
  GROUP_MEMBER_SKILL_LIMITS,
  buildSkillZipBuffer,
  calculateStyleStats,
  checkSkillQuality,
  chunkEvidenceRecords,
  countEvidenceTokens,
  createMediaBehaviorProfile,
  createDefaultSkillName,
  createMapPrompt,
  createRetryFeedback,
  createSynthesisPrompt,
  getTimeRange,
  hashIdentifier,
  mergeMessageRecords,
  parseJsonResponse,
  planSampleCollection,
  prepareEvidenceRecords,
  redactDirectIdentifiers,
  renderEvidenceMarkdown,
  renderMediaPatternsMarkdown,
  renderSkillMarkdown,
  sanitizeDisplayName,
  selectMemoryFacts,
  splitLocalRawRows,
  validateSynthesis
} from './groupMemberSkill.js'

/**
 * #女娲蒸馏 的执行段：取样 → 脱敏 → 分块提炼 → 合成自检 → 打包落盘。
 *
 * 与指令层分离：这里只管产出文件与统计，不决定发到哪个会话、也不组装给用户看的文案。
 * 失败一律 throw，由指令层决定怎么回复（数据不足、目标不是群成员分别带 code）。
 */

const MAP_SYSTEM_PROMPT = `你是人物思维框架的证据提取器。只能依据给定聊天证据工作，严格输出 JSON。区分明确自述、行为信号和模型推断；不得编造证据 ID、事实或上下文。`

const SYNTHESIS_SYSTEM_PROMPT = `你是 Nuwa 风格的人物视角蒸馏器。目标是提炼 HOW they think，而不是堆砌原话。严格执行跨话题复现、生成力、区别度三重验证，保留矛盾和局限，只输出 JSON。`

const LOCAL_PAGE_SIZE = 2000

/** 指令层用同一个 id 拼「模型：xxx」那一行，避免两处各算一次。 */
export function resolveDistillProviderId(e) {
  return e?.modelProviderId || Config.defaultProviderId
}

/**
 * 查群成员对象。指令层用它取昵称、执行段用它确认身份。
 *
 * `known: false` 表示适配器没有查询能力，调用方不要据此判定「不是群成员」。
 */
export async function lookupGroupMember(e, targetId) {
  const numericId = Number(targetId)
  try {
    const memberMap = await e.group?.getMemberMap?.()
    if (memberMap && typeof memberMap.get === 'function') {
      const member = memberMap.get(numericId) || memberMap.get(String(targetId))
      if (member) return { known: true, member }
    }
  } catch (err) {
    logWarn(`获取群成员列表失败，尝试单成员查询: ${err.message || err}`)
  }

  if (typeof e.bot?.pickMember !== 'function' && typeof e.bot?.getGroupMemberInfo !== 'function') {
    return { known: false, member: null }
  }

  try {
    const member = await e.bot?.pickMember?.(e.group_id, numericId, true)
      || await e.bot?.getGroupMemberInfo?.(e.group_id, numericId, true)
    if (!member) return { known: true, member: null }
    return String(member.user_id ?? targetId) === String(targetId)
      ? { known: true, member }
      : { known: true, member: null }
  } catch (err) {
    logWarn(`查询群成员失败: ${err.message || err}`)
    return { known: false, member: null }
  }
}

async function callJsonWithRetry(subLLM, prompt, label) {
  let lastError
  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now()
    try {
      const result = await subLLM.chat(prompt)
      return parseJsonResponse(result?.text)
    } catch (err) {
      lastError = err
      logWarn(`${label}：第 ${attempt}/2 次失败，耗时 ${Date.now() - startedAt}ms: ${err.message || err}`)
    }
  }
  throw lastError || new Error(`${label} 失败`)
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length)
  const errors = []
  let cursor = 0

  async function run() {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = await worker(items[index], index)
      } catch (error) {
        errors.push({ index, error })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return { results: results.filter(Boolean), errors }
}

function makeRunTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '').replace('.', '-')
}

/**
 * 按时间倒序分页扫本地原文，直到保留期起点或扫描上限。
 *
 * 固定 endTime 让偏移稳定（扫描期间新到的消息时间戳更大，不在区间内）；
 * 页码滑过保留期起点就停，不必把窗口外的旧消息全取出来。
 */
async function scanLocalRows(store, groupId, endTime, startTime, targetId) {
  const rows = []
  let scanned = 0
  const maxRows = GROUP_MEMBER_SKILL_LIMITS.maxLocalScannedMessages

  for (let offset = 0; offset < maxRows; offset += LOCAL_PAGE_SIZE) {
    const pageSize = Math.min(LOCAL_PAGE_SIZE, maxRows - offset)
    const { rows: pageRows, count } = await store.getRecentRawMessagesPage(groupId, endTime, offset, pageSize)
    scanned += count

    let oldest = Infinity
    for (const row of pageRows) {
      const time = Number(row?.time) || 0
      if (time < oldest) oldest = time
      if (String(row?.senderId) !== targetId) continue
      if (!row?.text || row?.isCommand) continue
      if (time < startTime) continue
      rows.push(row)
    }

    if (oldest < startTime) break
    if (count < pageSize) break
  }

  return { rows, scanned }
}

/**
 * 本地采集样本：只在本群已授权记忆采集时读取。
 *
 * 原文按保留期分页扫满（见 scanLocalRows），不再只取最近 20000 条；
 * 事实只取本群 `user_group` 作用域。
 */
async function collectLocalSample(e, targetId) {
  const empty = { facts: [], rows: [], scanned: 0, authorized: false }
  if (!Config.enableMemory) return empty
  const groups = Array.isArray(Config.memoryGroupCapture?.groups) ? Config.memoryGroupCapture.groups : []
  if (!MemoryStore.isGroupAuthorized(groups, e.group_id)) return empty

  try {
    const store = new MemoryStore()
    const facts = selectMemoryFacts(await store.listByScope({
      scope: 'user_group',
      ownerId: targetId,
      groupId: String(e.group_id)
    }))
    const retentionDays = Number(Config.memoryGroupCapture?.rawRetentionDays) || 30
    const end = Math.floor(Date.now() / 1000)
    const start = end - retentionDays * 86400
    const { rows, scanned } = await scanLocalRows(store, String(e.group_id), end, start, targetId)
    return { facts, rows, scanned, authorized: true }
  } catch (err) {
    logWarn(`读取本地记忆样本失败，回退历史扫描: ${err.message || err}`)
    return { ...empty, failed: true }
  }
}

/** 上一次为同一成员生成的 SKILL.md，用于增量更新；找不到返回空串。 */
async function findPreviousSkill(groupId, targetId) {
  const base = path.join(
    process.cwd(),
    'data',
    'chatgpt',
    'nuwa-skills',
    hashIdentifier(groupId),
    hashIdentifier(`${groupId}:${targetId}`)
  )
  let runs
  try {
    runs = await readdir(base, { withFileTypes: true })
  } catch (err) {
    // 目录不存在＝从未生成过，属正常路径；其他错误（权限、IO）要留痕，但不应阻断本次生成。
    if (err?.code !== 'ENOENT') logWarn(`读取历史产物目录失败: ${err.message || err}`)
    return ''
  }

  const timestamps = runs
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort()
    .reverse()

  for (const timestamp of timestamps) {
    let entries
    try {
      entries = await readdir(path.join(base, timestamp), { withFileTypes: true })
    } catch (err) {
      if (err?.code !== 'ENOENT') logWarn(`读取产物目录失败: ${err.message || err}`)
      continue
    }
    for (const entry of entries.filter(item => item.isDirectory() && !item.name.startsWith('.'))) {
      try {
        const text = await readFile(path.join(base, timestamp, entry.name, 'SKILL.md'), 'utf8')
        if (text) return text.slice(0, 12000)
      } catch (err) {
        // 该目录没有 SKILL.md（上次失败）是预期情况；其他读取错误同样只告警，继续找更早的一次。
        if (err?.code !== 'ENOENT') logWarn(`读取上次 SKILL.md 失败: ${err.message || err}`)
        continue
      }
    }
  }
  return ''
}

async function prepareRunDir(groupId, targetId, skillName) {
  const runRoot = path.join(
    process.cwd(),
    'data',
    'chatgpt',
    'nuwa-skills',
    hashIdentifier(groupId),
    hashIdentifier(`${groupId}:${targetId}`),
    makeRunTimestamp()
  )
  const skillDir = path.join(runRoot, skillName)
  const researchDir = path.join(skillDir, 'references', 'research')
  await mkdir(researchDir, { recursive: true })
  return { runRoot, skillDir, researchDir }
}

async function writeGenerationReport(skillDir, report) {
  try {
    const referenceDir = path.join(skillDir, 'references')
    await mkdir(referenceDir, { recursive: true })
    await writeFile(path.join(referenceDir, 'generation-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  } catch (err) {
    logWarn(`写入失败报告出错: ${err.message || err}`)
  }
}

async function writeSkillPackage({ runRoot, skillDir, skillMarkdown, evidenceMarkdown, mediaProfile, report, researchFiles, skillName }) {
  const referenceDir = path.join(skillDir, 'references')
  const mediaIndex = mediaProfile?.media_index || []
  const mediaPatternsMarkdown = renderMediaPatternsMarkdown(mediaProfile)
  await mkdir(referenceDir, { recursive: true })

  await Promise.all([
    writeFile(path.join(skillDir, 'SKILL.md'), skillMarkdown, 'utf8'),
    writeFile(path.join(referenceDir, 'evidence.md'), evidenceMarkdown, 'utf8'),
    writeFile(path.join(referenceDir, 'generation-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(path.join(referenceDir, 'media-index.json'), `${JSON.stringify(mediaIndex, null, 2)}\n`, 'utf8'),
    writeFile(path.join(referenceDir, 'media-patterns.md'), mediaPatternsMarkdown, 'utf8')
  ])
  const zipBuffer = await buildSkillZipBuffer(skillName, skillMarkdown, evidenceMarkdown, report, mediaIndex, mediaPatternsMarkdown, researchFiles)
  const zipPath = path.join(runRoot, `${skillName}.zip`)
  await writeFile(zipPath, zipBuffer)

  return {
    runRoot,
    skillDir,
    skillPath: path.join(skillDir, 'SKILL.md'),
    zipPath,
    zipName: `${skillName}.zip`
  }
}

function distillError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * 蒸馏一名群成员。产物落盘并返回路径，不发消息。
 *
 * @returns {Promise<{skillMarkdown: string, artifact: object, summary: object}>}
 */
export async function runGroupMemberDistill(e, {
  targetId,
  requestedCount = GROUP_MEMBER_SKILL_LIMITS.defaultMessages
} = {}) {
  const numericTarget = String(targetId ?? '').trim()
  if (!/^\d+$/.test(numericTarget)) throw distillError('BAD_TARGET', 'targetId 不是合法的 QQ 号')

  let skillName = createDefaultSkillName(e.group_id, numericTarget)

  let skillDir = ''
  let chunkProgress = null
  const jobStartedAt = Date.now()

  try {
    logInfo(`开始生成群友 Skill（目标消息上限 ${requestedCount}，本地扫描上限 ${GROUP_MEMBER_SKILL_LIMITS.maxLocalScannedMessages}，群扫描上限 ${GROUP_MEMBER_SKILL_LIMITS.maxScannedMessages}）`)
    const { member } = await lookupGroupMember(e, numericTarget)
    if (!member) throw distillError('NOT_MEMBER', '目标用户不是本群成员')
    const displayName = sanitizeDisplayName(redactDirectIdentifiers(
      member.card || member.nickname || '群友',
      [numericTarget, e.group_id, e.user_id]
    ))

    const sampleStartedAt = Date.now()
    const local = await collectLocalSample(e, numericTarget)
    const localSample = splitLocalRawRows(local.rows)
    let history = null
    let mediaInputs = {
      media_records: localSample.media_records,
      target_message_records: localSample.target_message_records
    }

    const plan = planSampleCollection(localSample.records, requestedCount, GROUP_MEMBER_SKILL_LIMITS)
    let mergedRecords = plan.records
    let candidateCount = plan.candidateCount
    if (plan.useLocalOnly) {
      logInfo(`本地样本充足，跳过历史扫描：候选 ${plan.candidateCount} 条，抽样后 ${plan.records.length} 条，扫描群原文 ${local.scanned} 条，已存事实 ${local.facts.length} 条，耗时 ${Date.now() - sampleStartedAt}ms`)
    } else {
      history = await msgHistoryMgr.getUserMessageRecords(e, numericTarget, {
        maxTargetMessages: Math.max(1, plan.remaining),
        maxScannedMessages: GROUP_MEMBER_SKILL_LIMITS.maxScannedMessages
      })
      mergedRecords = mergeMessageRecords(plan.records, history.records, requestedCount)
      candidateCount += history.records.length
      if (history.media_records.length > 0 || history.target_message_records.length > 0) {
        mediaInputs = { media_records: history.media_records, target_message_records: history.target_message_records }
      }
      const reason = local.failed
        ? '本地记忆样本读取失败'
        : local.authorized ? `本地去重后仅 ${plan.records.length} 条` : '本群未授权记忆采集'
      logInfo(`回退历史扫描（${reason}）：扫描群消息 ${history.scanned_messages} 条，目标消息 ${history.records.length} 条，合并后 ${mergedRecords.length} 条，耗时 ${Date.now() - sampleStartedAt}ms`)
    }

    const evidenceRecords = prepareEvidenceRecords(mergedRecords, [numericTarget, e.group_id, e.user_id])
    const mediaProfile = createMediaBehaviorProfile(mediaInputs.media_records, mediaInputs.target_message_records)
    if (evidenceRecords.length < GROUP_MEMBER_SKILL_LIMITS.minMessages) {
      throw distillError('INSUFFICIENT_SAMPLES', `仅找到 ${evidenceRecords.length} 条有效脱敏文本，至少需要 ${GROUP_MEMBER_SKILL_LIMITS.minMessages} 条`)
    }

    const chunks = chunkEvidenceRecords(evidenceRecords, GROUP_MEMBER_SKILL_LIMITS.chunkTokens, GROUP_MEMBER_SKILL_LIMITS.maxChunks)
    const chunkTokens = chunks.map(chunk => countEvidenceTokens(chunk))
    // 先读上一次产物再建本次运行目录：否则新目录会排在时间戳列表最前面，白读一次空的 SKILL.md。
    const previousSkill = await findPreviousSkill(e.group_id, numericTarget)
    const run = await prepareRunDir(e.group_id, numericTarget, skillName)
    skillDir = run.skillDir
    const researchFiles = {}
    const use = resolveDistillProviderId(e)
    // 不设 maxTokens：跟随 provider 的「回复内容最大Token数」。这两个阶段的产物都是 JSON，
    // 真被截断会被 callJsonWithRetry 的 JSON 校验抓住并重试，不需要自己再设一层上限。
    const mapLLM = new SubLLM({
      provider: use,
      systemPrompt: MAP_SYSTEM_PROMPT,
      temperature: 0.2,
      timeoutMs: 180000
    })
    const synthesisLLM = new SubLLM({
      provider: use,
      systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
      temperature: 0.2,
      timeoutMs: 180000
    })
    logInfo(`开始子LLM蒸馏：${chunks.length} 个分块（约 ${chunkTokens.join('/')} token），最多并发 2 个，provider=${mapLLM.provider}，model=${mapLLM.model || 'provider-default'}`)

    const mapStartedAt = Date.now()
    const mapped = await mapWithConcurrency(chunks, 2, async (chunk, index) => {
      const chunkMediaProfile = createMediaBehaviorProfile(
        mediaInputs.media_records,
        mediaInputs.target_message_records,
        { start: chunk[0]?.time || 0, end: chunk.at(-1)?.time || Number.MAX_SAFE_INTEGER }
      )
      const parsed = await callJsonWithRetry(mapLLM, createMapPrompt(chunk, index, chunks.length, chunkMediaProfile), `Map ${index + 1}`)
      const fileName = `chunk-${String(index + 1).padStart(2, '0')}.json`
      const payload = `${JSON.stringify(parsed, null, 2)}\n`
      researchFiles[fileName] = payload
      try {
        await writeFile(path.join(run.researchDir, fileName), payload, 'utf8')
      } catch (err) {
        logWarn(`分块 ${index + 1} 结果落盘失败: ${err.message || err}`)
      }
      return parsed
    })
    const minimumSuccessfulChunks = Math.ceil(chunks.length / 2)
    chunkProgress = {
      total: chunks.length,
      successful: mapped.results.length,
      failed: mapped.errors.length,
      tokens: chunkTokens
    }
    if (mapped.results.length < minimumSuccessfulChunks) {
      throw distillError('CHUNK_FAILED', `分块提取失败过多（成功 ${mapped.results.length}/${chunks.length}）`)
    }

    const confidence = evidenceRecords.length >= GROUP_MEMBER_SKILL_LIMITS.fullConfidenceMessages && mapped.errors.length === 0
      ? 'medium'
      : 'low'
    const styleStats = calculateStyleStats(evidenceRecords)
    const synthesisOptions = { facts: local.facts, previousSkill }
    const rawSynthesis = await callJsonWithRetry(
      synthesisLLM,
      createSynthesisPrompt(mapped.results, styleStats, confidence, mediaProfile, synthesisOptions),
      'Synthesis'
    )
    let synthesis = validateSynthesis(rawSynthesis, mapped.results, evidenceRecords, mediaProfile)
    let quality = checkSkillQuality(synthesis)
    if (!quality.passed) {
      logWarn(`质量自检未通过（${quality.failed.map(item => item.item).join('、')}），重跑一次合成`)
      try {
        const retryRaw = await callJsonWithRetry(
          synthesisLLM,
          createSynthesisPrompt(mapped.results, styleStats, confidence, mediaProfile, {
            ...synthesisOptions,
            retryFeedback: createRetryFeedback(quality.failed)
          }),
          'Synthesis-Retry'
        )
        const retrySynthesis = validateSynthesis(retryRaw, mapped.results, evidenceRecords, mediaProfile)
        const retryQuality = checkSkillQuality(retrySynthesis)
        if (retryQuality.failed.length < quality.failed.length) {
          synthesis = retrySynthesis
          quality = retryQuality
        }
      } catch (err) {
        logWarn(`自检重跑失败，沿用首轮结果: ${err.message || err}`)
      }
    }

    const timeRange = getTimeRange(evidenceRecords)
    const generatedAt = new Date().toISOString()
    const skillMarkdown = renderSkillMarkdown({
      skillName,
      displayName,
      synthesis,
      confidence,
      generatedAt,
      messageCount: evidenceRecords.length,
      timeRange,
      quality
    })
    const evidenceMarkdown = renderEvidenceMarkdown(evidenceRecords, synthesis.used_evidence_ids, displayName)
    const report = {
      generated_at: generatedAt,
      skill_name: skillName,
      display_name: displayName,
      confidence,
      collected_message_count: mergedRecords.length,
      analyzed_message_count: evidenceRecords.length,
      scanned_group_message_count: history ? history.scanned_messages : local.scanned,
      time_range: timeRange,
      filtering: history?.filtered || {},
      input_tokens_estimate: countEvidenceTokens(evidenceRecords),
      multimedia: {
        statistics: mediaProfile.statistics,
        pattern_evidence_ids: mediaProfile.patterns.map(pattern => pattern.evidence_id),
        eligible_skill_guidance_evidence_ids: mediaProfile.eligible_skill_guidance.map(item => item.evidence_id),
        raw_media_sent_to_sub_llm: false
      },
      chunks: {
        total: chunks.length,
        successful: mapped.results.length,
        failed: mapped.errors.length,
        tokens: chunkTokens
      },
      style_statistics: styleStats,
      quality: {
        passed: quality.passed,
        failed: quality.failed
      },
      output_counts: {
        mental_models: synthesis.mental_models.length,
        heuristics: synthesis.heuristics.length,
        expression_rules: synthesis.expression_dna.length,
        attributes: synthesis.attributes.length,
        values: synthesis.values.length,
        anti_patterns: synthesis.anti_patterns.length,
        tensions: synthesis.tensions.length,
        research_dimensions: synthesis.research_dimensions.length
      },
      validation: synthesis.validation,
      warnings: [
        '本产物基于群聊样本推断，不代表本人确认事实。',
        ...(confidence === 'low' ? ['样本量或分块完整性不足，整体置信度为 low。'] : []),
        ...(mapped.errors.length > 0 ? [`有 ${mapped.errors.length} 个分块分析失败，结果基于其余分块生成。`] : []),
        ...(!quality.passed ? [`质量自检未通过：${quality.failed.map(item => `${item.item}（${item.detail}）`).join('；')}。`] : [])
      ]
    }

    const artifact = await writeSkillPackage({
      runRoot: run.runRoot,
      skillDir: run.skillDir,
      skillMarkdown,
      evidenceMarkdown,
      mediaProfile,
      report,
      researchFiles,
      skillName
    })

    logInfo(`生成完成：总耗时 ${Date.now() - jobStartedAt}ms，Map ${Date.now() - mapStartedAt}ms（成功 ${mapped.results.length}/${chunks.length}），模型 ${synthesis.mental_models.length}，自检=${quality.passed ? '通过' : '未通过'}`)

    return {
      skillMarkdown,
      artifact,
      summary: {
        sampleCount: evidenceRecords.length,
        candidateCount,
        confidence,
        mentalModelCount: synthesis.mental_models.length,
        heuristicCount: synthesis.heuristics.length,
        expressionRuleCount: synthesis.expression_dna.length,
        qualityPassed: quality.passed,
        qualityFailed: quality.failed.map(item => item.item),
        inputTokens: countEvidenceTokens(evidenceRecords),
        chunkCount: chunks.length,
        scannedMessages: history ? history.scanned_messages : local.scanned,
        usedLocalOnly: !history,
        elapsedMs: Date.now() - jobStartedAt
      }
    }
  } catch (err) {
    logError(`生成失败: ${err.stack || err.message || err}`)
    // 失败发生在建目录之前（历史接口报错、本地读取异常）时也补一个运行目录：
    // 否则最常见的一类失败在磁盘上什么都不留，无法判断是取数问题还是合成问题。
    if (!skillDir) {
      try {
        skillDir = (await prepareRunDir(e.group_id, numericTarget, skillName)).skillDir
      } catch (dirError) {
        logWarn(`创建失败产物目录出错: ${dirError.message || dirError}`)
      }
    }
    if (skillDir) {
      await writeGenerationReport(skillDir, {
        status: 'failed',
        generated_at: new Date().toISOString(),
        skill_name: skillName,
        error: err.message || String(err),
        ...(chunkProgress ? { chunks: chunkProgress } : {})
      })
      // 产物目录只回报相对路径：绝对路径会带着本机用户名进对话。
      err.artifactDir = toRelativePath(skillDir)
    }
    throw err
  }
}
