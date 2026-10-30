import { Config } from '../config.js'
import path from 'node:path'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { AbstractTool } from './AbstractTool.js'
import { SubLLM } from '../../model/SubLLM.js'
import { msgHistoryMgr } from '../../model/Onebot11_MessageHistoryManager.js'
import { MemoryStore } from '../memory/store.js'
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
  validateGroupMemberSkillAccess,
  validateSkillName,
  validateSynthesis
} from '../groupMemberSkill.js'

const MAP_SYSTEM_PROMPT = `你是人物思维框架的证据提取器。只能依据给定聊天证据工作，严格输出 JSON。区分明确自述、行为信号和模型推断；不得编造证据 ID、事实或上下文。`

const SYNTHESIS_SYSTEM_PROMPT = `你是 Nuwa 风格的人物视角蒸馏器。目标是提炼 HOW they think，而不是堆砌原话。严格执行跨话题复现、生成力、区别度三重验证，保留矛盾和局限，只输出 JSON。`

async function resolveCurrentUse(e) {
  return e.modelProviderId || Config.defaultProviderId
}

async function resolveGroupMember(e, targetId) {
  const numericId = Number(targetId)
  try {
    const memberMap = await e.group?.getMemberMap?.()
    if (memberMap && typeof memberMap.get === 'function') {
      const member = memberMap.get(numericId) || memberMap.get(String(targetId))
      return member || null
    }
  } catch (err) {
    globalThis.logger?.warn?.(`[GroupMemberSkillTool] 获取群成员列表失败，尝试单成员查询: ${err.message || err}`)
  }

  try {
    const member = await e.bot?.pickMember?.(e.group_id, numericId, true)
      || await e.bot?.getGroupMemberInfo?.(e.group_id, numericId, true)
    if (member && String(member.user_id ?? targetId) === String(targetId)) return member
  } catch {}
  return null
}

async function callJsonWithRetry(subLLM, prompt, label) {
  let lastError
  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now()
    try {
      const result = await subLLM.chat(prompt)
      const parsed = parseJsonResponse(result?.text)
      return parsed
    } catch (err) {
      lastError = err
      globalThis.logger?.warn?.(`[GroupMemberSkillTool] ${label}：第 ${attempt}/2 次失败，耗时 ${Date.now() - startedAt}ms: ${err.message || err}`)
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
 * 本地采集样本：只在本群已授权记忆采集时读取。
 *
 * 原文走「最近原文」接口（20000 条上限），不按时间范围逐条查——大群一天就上万条，
 * 逐条 GET 会把 Redis 往返放大到不可接受。事实只取本群 `user_group` 作用域。
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
    const { rows } = await store.getRecentRawMessages(String(e.group_id), end)
    const mine = rows.filter(row => String(row?.senderId) === targetId
      && row?.text
      && !row?.isCommand
      && Number(row?.time) >= start)
    return { facts, rows: mine, scanned: rows.length, authorized: true }
  } catch (err) {
    globalThis.logger?.warn?.(`[GroupMemberSkillTool] 读取本地记忆样本失败，回退历史扫描: ${err.message || err}`)
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
    if (err?.code !== 'ENOENT') globalThis.logger?.warn?.(`[GroupMemberSkillTool] 读取历史产物目录失败: ${err.message || err}`)
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
      if (err?.code !== 'ENOENT') globalThis.logger?.warn?.(`[GroupMemberSkillTool] 读取产物目录失败: ${err.message || err}`)
      continue
    }
    for (const entry of entries.filter(item => item.isDirectory() && !item.name.startsWith('.'))) {
      try {
        const text = await readFile(path.join(base, timestamp, entry.name, 'SKILL.md'), 'utf8')
        if (text) return text.slice(0, 12000)
      } catch (err) {
        // 该目录没有 SKILL.md（上次失败）是预期情况；其他读取错误同样只告警，继续找更早的一次。
        if (err?.code !== 'ENOENT') globalThis.logger?.warn?.(`[GroupMemberSkillTool] 读取上次 SKILL.md 失败: ${err.message || err}`)
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
    globalThis.logger?.warn?.(`[GroupMemberSkillTool] 写入失败报告出错: ${err.message || err}`)
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

async function sendPackageAttachment(e, artifact) {
  if (!e?.reply || !globalThis.segment?.file) {
    return { sent: false, type: null, error: '当前适配器未提供文件发送接口' }
  }

  try {
    await e.reply(globalThis.segment.file(artifact.zipPath, artifact.zipName))
    return { sent: true, type: 'zip', error: null }
  } catch (zipError) {
    globalThis.logger?.warn?.(`[GroupMemberSkillTool] ZIP 发送失败，回退发送 SKILL.md: ${zipError.message || zipError}`)
    try {
      await e.reply(globalThis.segment.file(artifact.skillPath, 'SKILL.md'))
      return { sent: true, type: 'skill-md', error: zipError.message || String(zipError) }
    } catch (markdownError) {
      return { sent: false, type: null, error: markdownError.message || String(markdownError) }
    }
  }
}

export class GroupMemberSkillTool extends AbstractTool {
  name = 'generateGroupMemberSkill'

  parameters = {
    properties: {
      target_id: {
        type: 'string',
        description: 'The QQ number of the group member whose chat perspective skill should be generated.'
      },
      skill_name: {
        type: 'string',
        description: 'Optional Agent Skills name. Use only lowercase letters, numbers and single hyphens; maximum 64 characters.'
      },
      max_msg_count: {
        type: 'number',
        minimum: GROUP_MEMBER_SKILL_LIMITS.minMessages,
        maximum: GROUP_MEMBER_SKILL_LIMITS.maxMessages,
        description: `Maximum target messages to analyze, ${GROUP_MEMBER_SKILL_LIMITS.minMessages}-${GROUP_MEMBER_SKILL_LIMITS.maxMessages}. Default ${GROUP_MEMBER_SKILL_LIMITS.defaultMessages}.`
      }
    },
    required: ['target_id']
  }

  description = 'Generate a portable Nuwa-style Agent Skill from a group member\'s past chat messages. Only call when the Bot master explicitly asks to distill a member in the current group. Prefers samples already captured by the memory system in this group and falls back to chat history when unavailable. The tool sends a ZIP attachment, returns the generated SKILL.md for your review, and may take several minutes.'

  func = async function (opts, e) {
    const accessError = validateGroupMemberSkillAccess(e)
    if (accessError) return accessError

    const targetId = String(opts?.target_id || '').trim()
    if (!/^\d+$/.test(targetId)) {
      return 'Error: target_id must be a valid QQ number.'
    }

    const requestedCount = opts?.max_msg_count === undefined
      ? GROUP_MEMBER_SKILL_LIMITS.defaultMessages
      : Number(opts.max_msg_count)
    if (!Number.isInteger(requestedCount) || requestedCount < GROUP_MEMBER_SKILL_LIMITS.minMessages || requestedCount > GROUP_MEMBER_SKILL_LIMITS.maxMessages) {
      return `Error: max_msg_count must be an integer between ${GROUP_MEMBER_SKILL_LIMITS.minMessages} and ${GROUP_MEMBER_SKILL_LIMITS.maxMessages}.`
    }

    let skillName
    try {
      skillName = opts?.skill_name
        ? validateSkillName(opts.skill_name)
        : createDefaultSkillName(e.group_id, targetId)
    } catch (err) {
      return `Error: ${err.message}`
    }

    let skillDir = ''
    let chunkProgress = null
    const jobStartedAt = Date.now()
    try {
      globalThis.logger?.info?.(`[GroupMemberSkillTool] 开始生成群友 Skill（目标消息上限 ${requestedCount}，群扫描上限 ${GROUP_MEMBER_SKILL_LIMITS.maxScannedMessages}）`)
      const member = await resolveGroupMember(e, targetId)
      if (!member) return 'Error: the target user is not a member of the current group.'
      const displayName = sanitizeDisplayName(redactDirectIdentifiers(
        member.card || member.nickname || '群友',
        [targetId, e.group_id, e.user_id]
      ))

      const sampleStartedAt = Date.now()
      const local = await collectLocalSample(e, targetId)
      const localSample = splitLocalRawRows(local.rows)
      let history = null
      let mergedRecords = localSample.records
      let mediaInputs = {
        media_records: localSample.media_records,
        target_message_records: localSample.target_message_records
      }

      const plan = planSampleCollection(localSample.records, requestedCount, GROUP_MEMBER_SKILL_LIMITS)
      mergedRecords = plan.records
      if (plan.useLocalOnly) {
        globalThis.logger?.info?.(`[GroupMemberSkillTool] 本地样本充足，跳过历史扫描：目标消息 ${plan.records.length} 条，扫描群原文 ${local.scanned} 条，已存事实 ${local.facts.length} 条，耗时 ${Date.now() - sampleStartedAt}ms`)
      } else {
        history = await msgHistoryMgr.getUserMessageRecords(e, targetId, {
          maxTargetMessages: Math.max(1, plan.remaining),
          maxScannedMessages: GROUP_MEMBER_SKILL_LIMITS.maxScannedMessages
        })
        mergedRecords = mergeMessageRecords(plan.records, history.records, requestedCount)
        if (history.media_records.length > 0 || history.target_message_records.length > 0) {
          mediaInputs = { media_records: history.media_records, target_message_records: history.target_message_records }
        }
        const reason = local.failed
          ? '本地记忆样本读取失败'
          : local.authorized ? `本地去重后仅 ${plan.records.length} 条` : '本群未授权记忆采集'
        globalThis.logger?.info?.(`[GroupMemberSkillTool] 回退历史扫描（${reason}）：扫描群消息 ${history.scanned_messages} 条，目标消息 ${history.records.length} 条，合并后 ${mergedRecords.length} 条，耗时 ${Date.now() - sampleStartedAt}ms`)
      }

      const evidenceRecords = prepareEvidenceRecords(mergedRecords, [targetId, e.group_id, e.user_id])
      const mediaProfile = createMediaBehaviorProfile(mediaInputs.media_records, mediaInputs.target_message_records)
      if (evidenceRecords.length < GROUP_MEMBER_SKILL_LIMITS.minMessages) {
        return `数据不足：仅找到 ${evidenceRecords.length} 条有效脱敏文本，至少需要 ${GROUP_MEMBER_SKILL_LIMITS.minMessages} 条，未生成 Skill。`
      }

      const chunks = chunkEvidenceRecords(evidenceRecords)
      const chunkTokens = chunks.map(chunk => countEvidenceTokens(chunk))
      // 先读上一次产物再建本次运行目录：否则新目录会排在时间戳列表最前面，白读一次空的 SKILL.md。
      const previousSkill = await findPreviousSkill(e.group_id, targetId)
      const run = await prepareRunDir(e.group_id, targetId, skillName)
      skillDir = run.skillDir
      const researchFiles = {}
      const use = await resolveCurrentUse(e)
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
      globalThis.logger?.info?.(`[GroupMemberSkillTool] 开始子LLM蒸馏：${chunks.length} 个分块（约 ${chunkTokens.join('/')} token），最多并发 2 个，provider=${mapLLM.provider}，model=${mapLLM.model || 'provider-default'}`)

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
          globalThis.logger?.warn?.(`[GroupMemberSkillTool] 分块 ${index + 1} 结果落盘失败: ${err.message || err}`)
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
        throw new Error(`分块提取失败过多（成功 ${mapped.results.length}/${chunks.length}）`)
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
        globalThis.logger?.warn?.(`[GroupMemberSkillTool] 质量自检未通过（${quality.failed.map(item => item.item).join('、')}），重跑一次合成`)
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
          globalThis.logger?.warn?.(`[GroupMemberSkillTool] 自检重跑失败，沿用首轮结果: ${err.message || err}`)
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
      const attachment = await sendPackageAttachment(e, artifact)
      globalThis.logger?.info?.(`[GroupMemberSkillTool] 生成完成：总耗时 ${Date.now() - jobStartedAt}ms，Map ${Date.now() - mapStartedAt}ms（成功 ${mapped.results.length}/${chunks.length}），模型 ${synthesis.mental_models.length}，自检=${quality.passed ? '通过' : '未通过'}，附件=${attachment.sent ? attachment.type : '失败'}`)

      const resultSummary = {
        success: true,
        sample_count: evidenceRecords.length,
        confidence,
        mental_model_count: synthesis.mental_models.length,
        heuristic_count: synthesis.heuristics.length,
        quality_passed: quality.passed,
        quality_failed: quality.passed ? undefined : quality.failed.map(item => item.item),
        attachment_sent: attachment.sent,
        attachment_type: attachment.type,
        attachment_error: attachment.error || undefined,
        artifact_path: artifact.runRoot
      }

      return `${JSON.stringify(resultSummary)}

<generated_skill_md>
${skillMarkdown}
</generated_skill_md>

请基于你当前的人设，简短评价这份 SKILL.md：说出它最有意思的特征、一个可能的局限；不要复述完整内容，也不要泄露证据之外的聊天信息。`
    } catch (err) {
      globalThis.logger?.error?.(`[GroupMemberSkillTool] 生成失败: ${err.stack || err.message || err}`)
      // 失败发生在建目录之前（历史接口报错、本地读取异常）时也补一个运行目录：
      // 否则最常见的一类失败在磁盘上什么都不留，无法判断是取数问题还是合成问题。
      if (!skillDir) {
        try {
          skillDir = (await prepareRunDir(e.group_id, targetId, skillName)).skillDir
        } catch (dirError) {
          globalThis.logger?.warn?.(`[GroupMemberSkillTool] 创建失败产物目录出错: ${dirError.message || dirError}`)
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
      }
      // 产物目录只回报相对路径：绝对路径会带着本机用户名进对话。
      const suffix = skillDir
        ? `（产物目录：${path.relative(process.cwd(), skillDir).split(path.sep).join('/')}）`
        : ''
      return `Error: Failed to generate group member skill: ${err.message || String(err)}${suffix}`
    }
  }
}
