import path from 'node:path'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { AbstractTool } from './AbstractTool.js'
import { SubLLM } from '../../model/SubLLM.js'
import { msgHistoryMgr } from '../../model/Onebot11_MessageHistoryManager.js'
import { getUserData } from '../common.js'
import {
  GROUP_MEMBER_SKILL_LIMITS,
  buildSkillZipBuffer,
  calculateStyleStats,
  chunkEvidenceRecords,
  createDefaultSkillName,
  createMapPrompt,
  createSynthesisPrompt,
  getTimeRange,
  hashIdentifier,
  parseJsonResponse,
  prepareEvidenceRecords,
  redactDirectIdentifiers,
  renderEvidenceMarkdown,
  renderSkillMarkdown,
  sanitizeDisplayName,
  validateGroupMemberSkillAccess,
  validateSkillName,
  validateSynthesis
} from '../groupMemberSkill.js'

const MAP_SYSTEM_PROMPT = `你是人物思维框架的证据提取器。只能依据给定聊天证据工作，严格输出 JSON。区分明确自述、行为信号和模型推断；不得编造证据 ID、事实或上下文。`

const SYNTHESIS_SYSTEM_PROMPT = `你是 Nuwa 风格的人物视角蒸馏器。目标是提炼 HOW they think，而不是堆砌原话。严格执行跨话题复现、生成力、区别度三重验证，保留矛盾和局限，只输出 JSON。`

async function resolveCurrentUse(e) {
  try {
    const userData = await getUserData(e.user_id)
    const selected = userData?.mode === 'default' ? null : userData?.mode
    if (selected) return selected
  } catch (err) {
    globalThis.logger?.warn?.(`[GroupMemberSkillTool] 读取用户模型模式失败: ${err.message || err}`)
  }
  try {
    return await globalThis.redis?.get?.('CHATGPT:USE') || 'api'
  } catch {
    return 'api'
  }
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
    try {
      const result = await subLLM.chat(prompt)
      return parseJsonResponse(result?.text)
    } catch (err) {
      lastError = err
      globalThis.logger?.warn?.(`[GroupMemberSkillTool] ${label} 第 ${attempt}/2 次失败: ${err.message || err}`)
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

async function writeSkillPackage({ skillName, skillMarkdown, evidenceMarkdown, report, groupId, targetId }) {
  const groupHash = hashIdentifier(groupId)
  const userHash = hashIdentifier(`${groupId}:${targetId}`)
  const runRoot = path.join(
    process.cwd(),
    'data',
    'chatgpt',
    'nuwa-skills',
    groupHash,
    userHash,
    makeRunTimestamp()
  )
  const stagingDir = path.join(runRoot, `.${skillName}.tmp`)
  const skillDir = path.join(runRoot, skillName)
  const referenceDir = path.join(stagingDir, 'references')
  await mkdir(referenceDir, { recursive: true })

  await Promise.all([
    writeFile(path.join(stagingDir, 'SKILL.md'), skillMarkdown, 'utf8'),
    writeFile(path.join(referenceDir, 'evidence.md'), evidenceMarkdown, 'utf8'),
    writeFile(path.join(referenceDir, 'generation-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  ])
  await rename(stagingDir, skillDir)

  const zipBuffer = await buildSkillZipBuffer(skillName, skillMarkdown, evidenceMarkdown, report)
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
        description: 'Maximum target messages to analyze, 30-500. Default 500.'
      }
    },
    required: ['target_id']
  }

  description = 'Generate a portable Nuwa-style Agent Skill from a group member\'s past chat messages. Only call when the Bot master explicitly asks to distill a member in the current group. The tool sends a ZIP attachment and may take several minutes.'

  func = async function (opts, e) {
    const accessError = validateGroupMemberSkillAccess(e)
    if (accessError) return accessError

    const targetId = String(opts?.target_id || '').trim()
    if (!/^\d+$/.test(targetId)) {
      return 'Error: target_id must be a valid QQ number.'
    }

    const requestedCount = opts?.max_msg_count === undefined ? GROUP_MEMBER_SKILL_LIMITS.maxMessages : Number(opts.max_msg_count)
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

    try {
      const member = await resolveGroupMember(e, targetId)
      if (!member) return 'Error: the target user is not a member of the current group.'
      const displayName = sanitizeDisplayName(redactDirectIdentifiers(
        member.card || member.nickname || '群友',
        [targetId, e.group_id, e.user_id]
      ))

      const history = await msgHistoryMgr.getUserMessageRecords(e, targetId, {
        maxTargetMessages: requestedCount,
        maxScannedMessages: GROUP_MEMBER_SKILL_LIMITS.maxScannedMessages
      })
      const evidenceRecords = prepareEvidenceRecords(history.records, [targetId, e.group_id, e.user_id])
      if (evidenceRecords.length < GROUP_MEMBER_SKILL_LIMITS.minMessages) {
        return `数据不足：仅找到 ${evidenceRecords.length} 条有效脱敏文本，至少需要 ${GROUP_MEMBER_SKILL_LIMITS.minMessages} 条，未生成 Skill。`
      }

      const chunks = chunkEvidenceRecords(evidenceRecords)
      const use = await resolveCurrentUse(e)
      const mapLLM = new SubLLM({
        provider: use,
        systemPrompt: MAP_SYSTEM_PROMPT,
        maxTokens: 3072,
        temperature: 0.2,
        timeoutMs: 120000
      })
      const synthesisLLM = new SubLLM({
        provider: use,
        systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
        maxTokens: 6144,
        temperature: 0.2,
        timeoutMs: 180000
      })

      const mapped = await mapWithConcurrency(chunks, 2, (chunk, index) => {
        return callJsonWithRetry(mapLLM, createMapPrompt(chunk, index, chunks.length), `Map ${index + 1}`)
      })
      const minimumSuccessfulChunks = Math.ceil(chunks.length / 2)
      if (mapped.results.length < minimumSuccessfulChunks) {
        throw new Error(`分块提取失败过多（成功 ${mapped.results.length}/${chunks.length}），未生成 Skill`)
      }

      const confidence = evidenceRecords.length >= GROUP_MEMBER_SKILL_LIMITS.fullConfidenceMessages && mapped.errors.length === 0
        ? 'medium'
        : 'low'
      const styleStats = calculateStyleStats(evidenceRecords)
      const rawSynthesis = await callJsonWithRetry(
        synthesisLLM,
        createSynthesisPrompt(mapped.results, styleStats, confidence),
        'Synthesis'
      )
      const synthesis = validateSynthesis(rawSynthesis, mapped.results, evidenceRecords)
      const timeRange = getTimeRange(evidenceRecords)
      const generatedAt = new Date().toISOString()
      const skillMarkdown = renderSkillMarkdown({
        skillName,
        displayName,
        synthesis,
        confidence,
        generatedAt,
        messageCount: evidenceRecords.length,
        timeRange
      })
      const evidenceMarkdown = renderEvidenceMarkdown(evidenceRecords, synthesis.used_evidence_ids, displayName)
      const report = {
        generated_at: generatedAt,
        skill_name: skillName,
        display_name: displayName,
        confidence,
        collected_message_count: history.records.length,
        analyzed_message_count: evidenceRecords.length,
        scanned_group_message_count: history.scanned_messages,
        time_range: timeRange,
        filtering: history.filtered,
        chunks: {
          total: chunks.length,
          successful: mapped.results.length,
          failed: mapped.errors.length
        },
        style_statistics: styleStats,
        output_counts: {
          mental_models: synthesis.mental_models.length,
          heuristics: synthesis.heuristics.length,
          expression_rules: synthesis.expression_dna.length,
          attributes: synthesis.attributes.length,
          values: synthesis.values.length,
          anti_patterns: synthesis.anti_patterns.length,
          tensions: synthesis.tensions.length
        },
        validation: synthesis.validation,
        warnings: [
          '本产物基于群聊样本推断，不代表本人确认事实。',
          ...(confidence === 'low' ? ['样本量或分块完整性不足，整体置信度为 low。'] : []),
          ...(mapped.errors.length > 0 ? [`有 ${mapped.errors.length} 个分块分析失败，结果基于其余分块生成。`] : [])
        ]
      }

      const artifact = await writeSkillPackage({
        skillName,
        skillMarkdown,
        evidenceMarkdown,
        report,
        groupId: e.group_id,
        targetId
      })
      const attachment = await sendPackageAttachment(e, artifact)

      return JSON.stringify({
        success: true,
        sample_count: evidenceRecords.length,
        confidence,
        mental_model_count: synthesis.mental_models.length,
        heuristic_count: synthesis.heuristics.length,
        attachment_sent: attachment.sent,
        attachment_type: attachment.type,
        attachment_error: attachment.error || undefined,
        artifact_path: artifact.runRoot
      })
    } catch (err) {
      globalThis.logger?.error?.(`[GroupMemberSkillTool] 生成失败: ${err.stack || err.message || err}`)
      return `Error: Failed to generate group member skill: ${err.message || String(err)}`
    }
  }
}
