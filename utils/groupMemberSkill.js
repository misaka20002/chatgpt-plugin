import { createHash } from 'node:crypto'
import JSZip from 'jszip'

export const GROUP_MEMBER_SKILL_LIMITS = Object.freeze({
  minMessages: 30,
  fullConfidenceMessages: 100,
  maxMessages: 500, // 获取目标用户历史文字消息上限
  maxScannedMessages: 10000, // 群扫描历史消息上限
  maxInputChars: 60000,
  chunkChars: 12000,
  maxMessageChars: 2000
})

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ALLOWED_BASIS = new Set(['explicit', 'signal', 'inference'])
const ALLOWED_CONFIDENCE = new Set(['high', 'medium', 'low'])

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function oneLine(value, maxLength = 500) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function markdownText(value, maxLength = 500) {
  return oneLine(value, maxLength).replace(/([\\`*_[\]<>])/g, '\\$1')
}

function listText(value, fallback = '数据不足') {
  const text = markdownText(value)
  return text || fallback
}

export function hashIdentifier(value, length = 16) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length)
}

export function validateSkillName(value) {
  const name = String(value || '').trim()
  if (!name || name.length > 64 || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error('skill_name 必须为 1-64 位小写字母、数字或单连字符组合，且不能以连字符开头或结尾')
  }
  return name
}

export function createDefaultSkillName(groupId, targetId) {
  return `group-member-${hashIdentifier(`${groupId}:${targetId}`, 12)}-perspective`
}

export function sanitizeDisplayName(value) {
  return oneLine(value || '群友', 50).replace(/[<>]/g, '') || '群友'
}

export function validateGroupMemberSkillAccess(e) {
  if (!e?.isGroup || !e?.group_id || !e?.group) {
    return 'Error: generateGroupMemberSkill can only be used in a group chat.'
  }
  if (!e?.isMaster) {
    return 'Error: only the Bot master can generate group member skills.'
  }
  return null
}

export function redactDirectIdentifiers(value, directIdentifiers = []) {
  let text = String(value || '')
    .replace(/\[CQ:at,[^\]]*?qq=\d+[^\]]*\]/gi, '[提及]')
    .replace(/@[\w\-\u4e00-\u9fff]{1,32}/gu, '[提及]')

  for (const identifier of directIdentifiers) {
    const id = String(identifier || '').trim()
    if (!id) continue
    text = text.split(id).join('[身份标识]')
  }

  return text
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[手机号]')
    .replace(/(?<!\d)\d{5,12}(?!\d)/g, '[数字标识]')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatRecordDate(timestamp) {
  const numeric = Number(timestamp)
  if (!numeric) return '未知日期'
  const date = new Date(numeric * 1000)
  return Number.isNaN(date.getTime()) ? '未知日期' : date.toISOString().slice(0, 10)
}

function stratifiedSample(records, maxChars) {
  const totalChars = records.reduce((sum, record) => sum + record.text.length + 24, 0)
  if (totalChars <= maxChars) return records

  const averageSize = Math.max(1, totalChars / records.length)
  const targetCount = Math.max(1, Math.min(records.length, Math.floor(maxChars / averageSize)))
  const indexes = new Set()
  for (let i = 0; i < targetCount; i++) {
    indexes.add(Math.round(i * (records.length - 1) / Math.max(1, targetCount - 1)))
  }

  const sampled = []
  let usedChars = 0
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const record = records[index]
    const size = record.text.length + 24
    if (sampled.length > 0 && usedChars + size > maxChars) continue
    sampled.push(record)
    usedChars += size
  }
  return sampled
}

export function prepareEvidenceRecords(records, directIdentifiers = [], limits = GROUP_MEMBER_SKILL_LIMITS) {
  const prepared = asArray(records).map(record => ({
    time: Number(record?.time) || 0,
    date: formatRecordDate(record?.time),
    text: redactDirectIdentifiers(record?.text, directIdentifiers).slice(0, limits.maxMessageChars)
  })).filter(record => record.text)

  const sampled = stratifiedSample(prepared, limits.maxInputChars)
  return sampled.map((record, index) => ({
    ...record,
    evidence_id: `M${String(index + 1).padStart(4, '0')}`
  }))
}

export function chunkEvidenceRecords(records, maxChunkChars = GROUP_MEMBER_SKILL_LIMITS.chunkChars) {
  const chunks = []
  let chunk = []
  let chunkSize = 0

  for (const record of records) {
    const lineSize = record.text.length + record.evidence_id.length + record.date.length + 8
    if (chunk.length > 0 && chunkSize + lineSize > maxChunkChars) {
      chunks.push(chunk)
      chunk = []
      chunkSize = 0
    }
    chunk.push(record)
    chunkSize += lineSize
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

export function formatEvidenceForPrompt(records) {
  return records.map(record => `[${record.evidence_id}][${record.date}] ${record.text}`).join('\n')
}

export function calculateStyleStats(records) {
  const texts = records.map(record => record.text)
  const count = texts.length || 1
  const countMatching = regex => texts.filter(text => regex.test(text)).length
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
  const emojiCount = texts.reduce((sum, text) => sum + (text.match(/\p{Extended_Pictographic}/gu)?.length || 0), 0)

  return {
    message_count: texts.length,
    average_message_length: Number((totalChars / count).toFixed(1)),
    question_message_ratio: Number((countMatching(/[?？]/u) / count).toFixed(3)),
    exclamation_message_ratio: Number((countMatching(/[!！]/u) / count).toFixed(3)),
    first_person_message_ratio: Number((countMatching(/(?:^|[^你他她它])我/u) / count).toFixed(3)),
    emoji_per_100_messages: Number((emojiCount * 100 / count).toFixed(1))
  }
}

function roundedRatio(numerator, denominator) {
  return Number((numerator / Math.max(1, denominator)).toFixed(3))
}

/**
 * 从匿名媒体事件和目标用户消息时间线生成确定性的多媒体表达画像。
 * 画像只包含计数、类型与时间间隔，绝不包含媒体文件、URL 或段 data。
 */
export function createMediaBehaviorProfile(mediaRecords, targetMessageRecords, timeRange = null) {
  const isAfterStart = record => !timeRange || timeRange.start === undefined || timeRange.start === null || Number(record?.time) >= timeRange.start
  const isBeforeEnd = record => !timeRange || timeRange.end === undefined || timeRange.end === null || Number(record?.time) <= timeRange.end
  const inRange = record => !timeRange || (
    isAfterStart(record) && isBeforeEnd(record)
  )
  const media = asArray(mediaRecords).filter(inRange).map(record => ({
    media_id: oneLine(record?.media_id, 24),
    time: Number(record?.time) || 0,
    type: oneLine(record?.type, 24) || 'other',
    is_mixed: Boolean(record?.is_mixed)
  })).sort((a, b) => a.time - b.time)
  const messages = asArray(targetMessageRecords).filter(inRange).map(record => ({
    time: Number(record?.time) || 0,
    has_text: Boolean(record?.has_text),
    has_media: Boolean(record?.has_media)
  })).sort((a, b) => a.time - b.time)
  const total = messages.length
  const textMessages = messages.filter(record => record.has_text).length
  const mediaMessages = messages.filter(record => record.has_media).length
  const mixedMessages = messages.filter(record => record.has_text && record.has_media).length
  const mediaOnlyMessages = messages.filter(record => !record.has_text && record.has_media).length
  const textOnlyMessages = messages.filter(record => record.has_text && !record.has_media).length
  const byType = {}
  for (const record of media) byType[record.type] = (byType[record.type] || 0) + 1

  const burstRuns = []
  let run = []
  for (const record of messages) {
    const previous = run.at(-1)
    if (record.has_media && (!previous || record.time - previous.time <= 120)) {
      run.push(record)
    } else {
      if (run.length >= 3) burstRuns.push(run)
      run = record.has_media ? [record] : []
    }
  }
  if (run.length >= 3) burstRuns.push(run)

  const statistics = {
    target_message_count: total,
    text_message_count: textMessages,
    media_message_count: mediaMessages,
    text_only_message_count: textOnlyMessages,
    media_only_message_count: mediaOnlyMessages,
    mixed_message_count: mixedMessages,
    media_event_count: media.length,
    text_message_ratio: roundedRatio(textMessages, total),
    media_message_ratio: roundedRatio(mediaMessages, total),
    media_by_type: byType,
    media_burst_count: burstRuns.length,
    longest_media_burst: burstRuns.reduce((max, records) => Math.max(max, records.length), 0),
    time_range: {
      start: formatRecordDate(messages[0]?.time),
      end: formatRecordDate(messages.at(-1)?.time)
    }
  }
  const patterns = []
  const addPattern = (title, observation) => patterns.push({
    evidence_id: `MP${String(patterns.length + 1).padStart(4, '0')}`,
    dimension: '多媒体表达习惯',
    title,
    observation
  })

  if (total >= 10 && mediaMessages === 0) {
    addPattern('纯文字表达为主', `扫描窗口内 ${total} 条目标消息均未包含可识别多媒体段，${textMessages} 条包含文本。`)
  } else if (total >= 10 && statistics.text_message_ratio >= 0.75 && statistics.media_message_ratio <= 0.25) {
    addPattern('文字表达为主', `扫描窗口内 ${textMessages}/${total} 条目标消息包含文本，${mediaMessages}/${total} 条包含多媒体。`)
  } else if (total >= 10 && statistics.media_message_ratio >= 0.5) {
    addPattern('多媒体参与度较高', `扫描窗口内 ${mediaMessages}/${total} 条目标消息包含多媒体，其中 ${mixedMessages} 条为图文混合。`)
  }
  if (total >= 10 && mixedMessages >= Math.max(3, Math.ceil(total * 0.2))) {
    addPattern('常见图文混发', `扫描窗口内有 ${mixedMessages}/${total} 条目标消息同时包含文本与多媒体。`)
  }
  if (burstRuns.length >= 1) {
    addPattern('出现短时连续媒体发送', `扫描窗口内识别到 ${burstRuns.length} 段至少 3 条的连续媒体消息，最长 ${statistics.longest_media_burst} 条；相邻消息间隔不超过 2 分钟。`)
  }
  const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]
  if (topType && media.length >= 5 && topType[1] / media.length >= 0.6) {
    addPattern(`${topType[0]}占主要媒体类型`, `扫描窗口内识别到 ${media.length} 个媒体段，其中 ${topType[1]} 个类型为 ${topType[0]}。`)
  }

  return { statistics, patterns, media_index: media }
}

export function formatMediaProfileForPrompt(profile, includeEvidenceIds = false) {
  const normalized = profile || { statistics: {}, patterns: [] }
  return JSON.stringify({
    scope: '仅为本次群聊扫描窗口中的程序化统计；未提供任何媒体原文件、URL、标题或内容。',
    statistics: normalized.statistics,
    observed_patterns: asArray(normalized.patterns).map(pattern => ({
      ...(includeEvidenceIds ? { evidence_id: pattern.evidence_id } : {}),
      observation: pattern.observation
    }))
  })
}

export function renderMediaPatternsMarkdown(profile) {
  const statistics = profile?.statistics || {}
  const lines = [
    '# 脱敏多媒体表达模式',
    '',
    '本文件由程序从目标用户在本次扫描窗口中的匿名媒体事件计算得出；不包含图片、视频、表情、URL、文件 ID 或其他原始媒体内容。',
    '',
    '## 统计',
    '',
    `- 目标消息数：${statistics.target_message_count || 0}`,
    `- 含文本消息：${statistics.text_message_count || 0}`,
    `- 含多媒体消息：${statistics.media_message_count || 0}`,
    `- 纯文字 / 纯媒体 / 图文混合：${statistics.text_only_message_count || 0} / ${statistics.media_only_message_count || 0} / ${statistics.mixed_message_count || 0}`,
    `- 媒体段数：${statistics.media_event_count || 0}`,
    `- 媒体类型：${Object.entries(statistics.media_by_type || {}).map(([type, count]) => `${type}=${count}`).join('，') || '无'}`,
    `- 连续媒体发送：${statistics.media_burst_count || 0} 段，最长 ${statistics.longest_media_burst || 0} 条（相邻间隔不超过 2 分钟）`,
    '',
    '## 模式证据',
    ''
  ]
  const patterns = asArray(profile?.patterns)
  if (patterns.length === 0) lines.push('没有达到输出阈值的多媒体表达模式。', '')
  for (const pattern of patterns) lines.push(`### ${pattern.evidence_id}`, '', `- 观察：${markdownText(pattern.observation)}`, '')
  return lines.join('\n').trim() + '\n'
}

export function parseJsonResponse(value) {
  const text = String(value || '').trim()
  if (!text) throw new Error('模型返回了空内容')

  const candidates = [text]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {}
  }
  throw new Error('模型返回内容不是有效 JSON 对象')
}

export function createMapPrompt(records, chunkIndex, chunkCount, mediaProfile = null) {
  return `这是群聊中同一位用户的脱敏文本样本，第 ${chunkIndex + 1}/${chunkCount} 批。每条消息前有不可伪造的证据 ID。

请提取 HOW this person thinks，而不是复述聊天。允许分析健康、宗教、政治、性取向等属性，但必须区分 explicit（明确自述）、signal（行为信号）、inference（模型推断），并给出置信度和证据 ID。不要补充样本之外的事实。

只输出合法 JSON，结构如下：
{
  "topics": [{"name":"话题名","evidence_ids":["M0001"]}],
  "mental_models": [{"name":"名称","summary":"描述","application":"适用场景","limitation":"失效条件","evidence_ids":["M0001","M0002"]}],
  "heuristics": [{"name":"规则名","rule":"如果X则Y","evidence_ids":["M0001"]}],
  "expression_dna": [{"dimension":"句式/词汇/节奏/幽默/确定性/习惯","rule":"可执行风格规则","evidence_ids":["M0001"]}],
  "attributes": [{"name":"属性","assessment":"判断","basis":"explicit|signal|inference","confidence":"high|medium|low","evidence_ids":["M0001"]}],
  "values": [{"name":"价值观","description":"说明","evidence_ids":["M0001"]}],
  "anti_patterns": [{"name":"反模式","description":"明确反对或回避的模式","evidence_ids":["M0001"]}],
  "tensions": [{"name":"张力","description":"不能被强行调和的矛盾","evidence_ids":["M0001","M0002"]}]
}

本批对应的多媒体表达统计（仅为辅助上下文，不含媒体内容，且不得在本阶段 JSON 中引用或据此推断人格）：
${formatMediaProfileForPrompt(mediaProfile)}

要求：宁缺毋滥；只使用输入文本中存在的 M 开头证据 ID；没有发现的数组返回 []；不要使用 Markdown。

样本：
${formatEvidenceForPrompt(records)}`
}

export function createSynthesisPrompt(mapResults, styleStats, confidenceHint, mediaProfile = null) {
  return `你正在把多批群聊分析合成为可运行的人物视角 Skill。以下 JSON 都来自同一人的脱敏聊天样本。

Nuwa 三重验证：心智模型必须跨至少两个不同话题复现、能够推断新问题、具有区别度；否则只能作为启发式。保留矛盾，不要强行调和。允许分析敏感属性，但必须保留 explicit/signal/inference 和证据置信度。

确定性统计：${JSON.stringify(styleStats)}
多媒体表达画像（仅含程序化统计；MP 证据只能用于 expression_dna，且必须原样保持对应观察的行为边界，不得推断人格、偏好、能力或动机）：${formatMediaProfileForPrompt(mediaProfile, true)}
整体置信度提示：${confidenceHint}

只输出合法 JSON，结构如下：
{
  "summary":"这个视角的简短定位",
  "mental_models":[{"name":"名称","summary":"一句话","application":"何时使用","limitation":"何时失效","confidence":"high|medium|low","evidence_ids":["M0001","M0002"]}],
  "heuristics":[{"name":"名称","rule":"规则","confidence":"high|medium|low","evidence_ids":["M0001"]}],
  "expression_dna":[{"dimension":"维度","rule":"规则","evidence_ids":["M0001"]}],
  "attributes":[{"name":"属性","assessment":"判断","basis":"explicit|signal|inference","confidence":"high|medium|low","evidence_ids":["M0001"]}],
  "values":[{"name":"价值观","description":"说明","evidence_ids":["M0001"]}],
  "anti_patterns":[{"name":"反模式","description":"说明","evidence_ids":["M0001"]}],
  "tensions":[{"name":"张力","description":"说明","evidence_ids":["M0001","M0002"]}],
  "honest_boundaries":["具体局限"]
}

不得创造新的证据 ID；MP 证据只能出现在 expression_dna；不得把推断改写成明确事实，不要使用 Markdown。

分批分析结果：
${JSON.stringify(mapResults)}`
}

function validEvidenceIds(value, knownIds) {
  return [...new Set(asArray(value).map(String).filter(id => knownIds.has(id)))]
}

function normalizeConfidence(value, fallback = 'medium') {
  return ALLOWED_CONFIDENCE.has(value) ? value : fallback
}

function normalizeEvidenceItems(items, knownIds, fields) {
  return asArray(items).map(item => {
    const evidenceIds = validEvidenceIds(item?.evidence_ids, knownIds)
    if (evidenceIds.length === 0) return null
    const result = { evidence_ids: evidenceIds }
    for (const field of fields) {
      const maxLength = field === 'description' ? 75 : ['name', 'dimension'].includes(field) ? 60 : 65
      result[field] = oneLine(item?.[field], maxLength)
    }
    if (fields.some(field => !result[field])) return null
    return result
  }).filter(Boolean)
}

export function validateSynthesis(raw, mapResults, evidenceRecords, mediaProfile = null) {
  const knownIds = new Set(evidenceRecords.map(record => record.evidence_id))
  const mediaPatterns = new Map(asArray(mediaProfile?.patterns).map(pattern => [pattern.evidence_id, pattern]))
  const evidenceTopics = new Map()

  for (const mapResult of mapResults) {
    for (const topic of asArray(mapResult?.topics)) {
      const topicName = oneLine(topic?.name, 100)
      if (!topicName) continue
      for (const id of validEvidenceIds(topic?.evidence_ids, knownIds)) {
        if (!evidenceTopics.has(id)) evidenceTopics.set(id, new Set())
        evidenceTopics.get(id).add(topicName)
      }
    }
  }

  const mentalModels = []
  const downgradedHeuristics = []
  let droppedModels = 0

  for (const item of asArray(raw?.mental_models)) {
    const evidenceIds = validEvidenceIds(item?.evidence_ids, knownIds)
    const topics = new Set(evidenceIds.flatMap(id => [...(evidenceTopics.get(id) || [])]))
    const normalized = {
      name: oneLine(item?.name, 60),
      summary: oneLine(item?.summary, 65),
      application: oneLine(item?.application, 65),
      limitation: oneLine(item?.limitation, 65),
      confidence: normalizeConfidence(item?.confidence),
      evidence_ids: evidenceIds,
      topics: [...topics]
    }
    if (!normalized.name || !normalized.summary || !normalized.application || !normalized.limitation || evidenceIds.length < 2 || topics.size < 2) {
      droppedModels += 1
      if (normalized.name && normalized.summary && evidenceIds.length > 0) {
        downgradedHeuristics.push({
          name: normalized.name,
          rule: normalized.summary,
          confidence: 'low',
          evidence_ids: evidenceIds,
          downgraded_from_model: true
        })
      }
      continue
    }
    mentalModels.push(normalized)
  }

  const heuristics = [...downgradedHeuristics]
  for (const item of asArray(raw?.heuristics)) {
    const evidenceIds = validEvidenceIds(item?.evidence_ids, knownIds)
    if (!item?.name || !item?.rule || evidenceIds.length === 0) continue
    heuristics.push({
      name: oneLine(item.name, 60),
      rule: oneLine(item.rule, 65),
      confidence: normalizeConfidence(item.confidence),
      evidence_ids: evidenceIds
    })
  }

  const uniqueHeuristics = []
  const seenHeuristicNames = new Set()
  for (const item of heuristics) {
    const key = item.name.toLowerCase()
    if (seenHeuristicNames.has(key)) continue
    seenHeuristicNames.add(key)
    uniqueHeuristics.push(item)
  }

  const textExpressionDna = normalizeEvidenceItems(raw?.expression_dna, knownIds, ['dimension', 'rule'])
  const modelSelectedMediaPatternIds = new Set(
    asArray(raw?.expression_dna).flatMap(item => asArray(item?.evidence_ids).map(String))
      .filter(id => mediaPatterns.has(id))
  )
  const selectedMediaPatternIds = modelSelectedMediaPatternIds.size > 0
    ? modelSelectedMediaPatternIds
    : new Set(mediaPatterns.keys())
  const mediaExpressionDna = [...selectedMediaPatternIds].slice(0, 2).map(id => {
    const pattern = mediaPatterns.get(id)
    return {
      dimension: oneLine(`多媒体表达：${pattern.title}`, 60),
      rule: oneLine(pattern.observation, 65),
      evidence_ids: [id]
    }
  })
  const expressionDna = [...mediaExpressionDna, ...textExpressionDna].slice(0, 5)
  const attributes = asArray(raw?.attributes).map(item => {
    const evidenceIds = validEvidenceIds(item?.evidence_ids, knownIds)
    if (!item?.name || !item?.assessment || evidenceIds.length === 0) return null
    return {
      name: oneLine(item.name, 60),
      assessment: oneLine(item.assessment, 65),
      basis: ALLOWED_BASIS.has(item.basis) ? item.basis : 'inference',
      confidence: normalizeConfidence(item.confidence, 'low'),
      evidence_ids: evidenceIds
    }
  }).filter(Boolean).slice(0, 6)

  const usedEvidenceIds = new Set()
  const collectIds = items => items.forEach(item => item.evidence_ids.forEach(id => usedEvidenceIds.add(id)))
  const selectedMentalModels = mentalModels.slice(0, 5)
  const selectedHeuristics = uniqueHeuristics.slice(0, 6)
  const values = normalizeEvidenceItems(raw?.values, knownIds, ['name', 'description']).slice(0, 3)
  const antiPatterns = normalizeEvidenceItems(raw?.anti_patterns, knownIds, ['name', 'description']).slice(0, 3)
  const tensions = normalizeEvidenceItems(raw?.tensions, knownIds, ['name', 'description']).slice(0, 3)
  ;[selectedMentalModels, selectedHeuristics, expressionDna, attributes, values, antiPatterns, tensions].forEach(collectIds)

  return {
    summary: oneLine(raw?.summary, 100) || '基于群聊样本提炼的思维与表达视角',
    mental_models: selectedMentalModels,
    heuristics: selectedHeuristics,
    expression_dna: expressionDna,
    attributes,
    values,
    anti_patterns: antiPatterns,
    tensions,
    honest_boundaries: asArray(raw?.honest_boundaries).map(item => oneLine(item, 70)).filter(Boolean).slice(0, 4),
    used_evidence_ids: [...usedEvidenceIds],
    validation: {
      dropped_models: droppedModels,
      downgraded_models: downgradedHeuristics.length,
      known_evidence_count: knownIds.size,
      used_evidence_count: usedEvidenceIds.size
    }
  }
}

function evidenceLinks(ids) {
  return ids.map(id => {
    const source = id.startsWith('MP') ? 'references/media-patterns.md' : 'references/evidence.md'
    return `[${id}](${source}#${id.toLowerCase()})`
  }).join('、')
}

function renderEvidenceBackedList(items, descriptionField) {
  if (items.length === 0) return '- 数据不足\n'
  return items.map(item => `- **${markdownText(item.name)}**：${listText(item[descriptionField])}（证据：${evidenceLinks(item.evidence_ids)}）`).join('\n') + '\n'
}

export function renderSkillMarkdown({ skillName, displayName, synthesis, confidence, generatedAt, messageCount, timeRange }) {
  const description = oneLine(`${displayName}的群聊思维框架与表达方式。基于${messageCount}条脱敏聊天，提炼心智模型、决策启发式、表达DNA和属性倾向。用户要求用${displayName}的视角分析、判断或回应时使用；普通问题不要自动触发。`, 900)
  const lines = [
    '---',
    `name: ${skillName}`,
    'description: |',
    `  ${description}`,
    'metadata:',
    '  generated-by: chatgpt-plugin',
    '  source-type: private-group-chat',
    `  confidence: ${confidence}`,
    '---',
    '',
    `# ${markdownText(displayName)} · 群聊思维视角`,
    '',
    '> 本 Skill 是基于群聊样本的框架推断，不代表本人确认事实，也不是本人发言。',
    '',
    '## 激活与退出',
    '',
    `激活后，使用下列模型和表达规则，以“${markdownText(displayName)}在群聊中展现的视角”回应；不要声称自己就是本人。首次回应简短说明这是聊天样本推断。用户说“退出”“切回正常”时停止使用本视角。`,
    '',
    '## 回答工作流',
    '',
    '1. 判断问题涉及事实、价值判断还是行动选择；缺少事实时先说明信息缺口。',
    '2. 选择最相关的心智模型和启发式，不要机械套用所有规则。',
    '3. 区分本人明确自述、聊天行为信号和模型推断；推断不得伪装成事实。',
    '4. 按表达 DNA 输出，同时保留局限和内在矛盾。',
    '',
    '## 视角定位',
    '',
    synthesis.summary,
    '',
    '## 核心心智模型',
    ''
  ]

  if (synthesis.mental_models.length === 0) {
    lines.push('- 数据不足：没有候选模型通过跨话题证据验证。', '')
  } else {
    synthesis.mental_models.forEach((model, index) => {
      lines.push(
        `### ${index + 1}. ${markdownText(model.name)}`,
        '',
        `- 一句话：${listText(model.summary)}`,
        `- 应用：${listText(model.application)}`,
        `- 局限：${listText(model.limitation)}`,
        `- 置信度：${model.confidence}`,
        `- 证据：${evidenceLinks(model.evidence_ids)}`,
        ''
      )
    })
  }

  lines.push('## 决策启发式', '')
  if (synthesis.heuristics.length === 0) lines.push('- 数据不足', '')
  else synthesis.heuristics.forEach((item, index) => lines.push(`${index + 1}. **${markdownText(item.name)}**：${listText(item.rule)}（${item.confidence}；${evidenceLinks(item.evidence_ids)}）`))

  lines.push('', '## 表达 DNA', '')
  if (synthesis.expression_dna.length === 0) lines.push('- 数据不足')
  else synthesis.expression_dna.forEach(item => lines.push(`- **${markdownText(item.dimension)}**：${listText(item.rule)}（证据：${evidenceLinks(item.evidence_ids)}）`))

  lines.push('', '## 性格与属性倾向', '')
  if (synthesis.attributes.length === 0) lines.push('- 数据不足')
  else synthesis.attributes.forEach(item => lines.push(`- **${markdownText(item.name)}**：${listText(item.assessment)}（依据：${item.basis}；置信度：${item.confidence}；证据：${evidenceLinks(item.evidence_ids)}）`))

  lines.push('', '## 价值观', '', renderEvidenceBackedList(synthesis.values, 'description').trimEnd())
  lines.push('', '## 反模式', '', renderEvidenceBackedList(synthesis.anti_patterns, 'description').trimEnd())
  lines.push('', '## 内在矛盾与张力', '', renderEvidenceBackedList(synthesis.tensions, 'description').trimEnd())

  lines.push(
    '',
    '## 诚实边界',
    '',
    `- 样本仅来自一个群聊中的 ${messageCount} 条文本，时间范围为 ${timeRange.start} 至 ${timeRange.end}。`,
    '- 私聊、线下行为、未说出口的动机和样本时间之外的变化均未覆盖。',
    '- 公开或群聊表达不等于完整、稳定的真实人格。',
    '- 属性分析可以包含敏感主题，但必须按证据类型和置信度理解。'
  )
  synthesis.honest_boundaries.forEach(item => lines.push(`- ${listText(item)}`))

  lines.push(
    '',
    '## 证据索引',
    '',
    '需要复核判断时读取 [脱敏聊天证据](references/evidence.md) 与 [多媒体表达模式](references/media-patterns.md)。不要把其中的短引文或统计扩写成未出现过的观点。',
    '',
    '---',
    '',
    `生成时间：${generatedAt}`,
    '',
    '> 提炼方法参考 [女娲 · Skill造人术](https://github.com/alchaincyf/nuwa-skill)。'
  )

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

export function renderEvidenceMarkdown(evidenceRecords, usedEvidenceIds, displayName) {
  const used = new Set(usedEvidenceIds)
  const selected = evidenceRecords.filter(record => used.has(record.evidence_id))
  const lines = [
    '# 脱敏聊天证据',
    '',
    `以下短引文仅来自 ${markdownText(displayName)} 的群聊文本。QQ、群号、手机号和 @ 对象已脱敏，未包含其他群友消息。`,
    ''
  ]

  for (const record of selected) {
    lines.push(`### ${record.evidence_id}`, '', `- 日期：${record.date}`, `- 引文：${markdownText(record.text, 160)}`, '')
  }
  if (selected.length === 0) lines.push('没有通过验证并进入最终 Skill 的证据。', '')
  return lines.join('\n').trim() + '\n'
}

export function getTimeRange(records) {
  const dated = records.filter(record => record.date && record.date !== '未知日期')
  return {
    start: dated[0]?.date || '未知',
    end: dated[dated.length - 1]?.date || '未知'
  }
}

export async function buildSkillZipBuffer(skillName, skillMarkdown, evidenceMarkdown, report, mediaIndex = [], mediaPatternsMarkdown = '') {
  const validatedName = validateSkillName(skillName)
  const zip = new JSZip()
  zip.file(`${validatedName}/SKILL.md`, String(skillMarkdown))
  zip.file(`${validatedName}/references/evidence.md`, String(evidenceMarkdown))
  zip.file(`${validatedName}/references/generation-report.json`, `${JSON.stringify(report, null, 2)}\n`)
  zip.file(`${validatedName}/references/media-index.json`, `${JSON.stringify(mediaIndex, null, 2)}\n`)
  zip.file(`${validatedName}/references/media-patterns.md`, String(mediaPatternsMarkdown))
  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
}
