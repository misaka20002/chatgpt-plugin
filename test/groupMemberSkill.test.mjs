/**
 * 群友 Nuwa Skill 的纯逻辑用例（utils/groupMemberSkill.js）
 *
 * 覆盖 token 预算、抽样、切块、合并去重、媒体时间线还原、已存事实选择、
 * 质量自检与生成物结构。这里不碰 Config / Redis / 子模型：这些都是纯函数，
 * 直接 import 就能跑。
 *
 * 运行：npm run test:nuwa
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  GROUP_MEMBER_SKILL_LIMITS,
  chunkEvidenceRecords,
  countEvidenceTokens,
  createMediaTimelineFromRawRows,
  createRetryFeedback,
  mergeMessageRecords,
  planSampleCollection,
  prepareEvidenceRecords,
  renderSkillMarkdown,
  selectMemoryFacts,
  checkSkillQuality,
  splitLocalRawRows,
  validateSynthesis
} from '../utils/groupMemberSkill.js'
import { estimateTokens } from '../utils/tokenEstimate.js'

const record = (index, text) => ({
  evidence_id: `M${String(index).padStart(4, '0')}`,
  date: '2026-01-01',
  time: index,
  text
})

describe('token 估算', () => {
  test('中文、英文与混合文本的估算口径一致', () => {
    assert.equal(estimateTokens(''), 0)
    assert.equal(estimateTokens('你好世界'), 4) // 4 / 1.2 → 3.34 → 4
    assert.equal(estimateTokens('hello'), 2) // 5 / 4 → 1.25 → 2
    assert.equal(estimateTokens('你好abc'), 3) // 1.67 + 0.75 → 2.42 → 3
  })

  test('混合文本按两类字符加权', () => {
    assert.equal(estimateTokens('混合 text 内容'), 5)
  })
})

describe('抽样', () => {
  test('预算内原样保留全部记录', () => {
    const records = [record(1, 'a'), record(2, 'b'), record(3, 'c')]
    const prepared = prepareEvidenceRecords(records, [], { ...GROUP_MEMBER_SKILL_LIMITS, maxInputTokens: 100000 })
    assert.equal(prepared.length, 3)
    assert.deepEqual(prepared.map(item => item.evidence_id), ['M0001', 'M0002', 'M0003'])
  })

  test('超预算时减少条数但保留首尾消息', () => {
    const records = Array.from({ length: 10 }, (_, index) => ({
      time: index,
      text: '中'.repeat(100)
    }))
    const prepared = prepareEvidenceRecords(records, [], { ...GROUP_MEMBER_SKILL_LIMITS, maxInputTokens: 300 })
    assert.ok(prepared.length < records.length)
    assert.equal(prepared[0].time, 0)
    assert.equal(prepared.at(-1).time, 9)
    assert.ok(countEvidenceTokens(prepared) <= 300)
  })

  test('单条消息仍按 2000 字截断', () => {
    const prepared = prepareEvidenceRecords([{ time: 1, text: '字'.repeat(3000) }], [], GROUP_MEMBER_SKILL_LIMITS)
    assert.equal(prepared[0].text.length, 2000)
  })
})

describe('切块', () => {
  test('预算内只有一块', () => {
    const chunks = chunkEvidenceRecords([record(1, '短'), record(2, '短')], 50000)
    assert.equal(chunks.length, 1)
  })

  test('超预算切成多块且每块不超过预算', () => {
    const records = Array.from({ length: 10 }, (_, index) => record(index + 1, '中'.repeat(100)))
    const chunks = chunkEvidenceRecords(records, 250)
    assert.ok(chunks.length > 1)
    for (const chunk of chunks) {
      assert.ok(countEvidenceTokens(chunk) <= 250)
    }
  })

  test('单条本身超预算时仍单独成块而不是被丢弃', () => {
    const huge = record(1, '中'.repeat(2000))
    const chunks = chunkEvidenceRecords([huge, record(2, '短')], 100)
    assert.equal(chunks.length, 2)
    assert.equal(chunks[0].length, 1)
    assert.equal(chunks[0][0].text.length, 2000)
  })
})

describe('记录合并', () => {
  test('本地与历史重叠的消息只保留一条', () => {
    const local = [{ message_id: '1', content_hash: 'h1', time: 2, text: '同一句' }]
    const history = [{ message_id: '1', time: 2, text: '同一句' }, { message_id: '2', time: 3, text: '另一句' }]
    const merged = mergeMessageRecords(local, history, 10)
    assert.equal(merged.length, 2)
    assert.deepEqual(merged.map(item => item.message_id), ['1', '2'])
  })

  test('没有消息 ID 时按文本去重', () => {
    const merged = mergeMessageRecords(
      [{ time: 1, text: '重复' }],
      [{ time: 2, text: '重复' }, { time: 3, text: '新的' }],
      10
    )
    assert.deepEqual(merged.map(item => item.text), ['重复', '新的'])
  })

  test('结果按时间升序并截到请求条数，保留最近的', () => {
    const local = [{ message_id: '1', time: 1, text: 'a' }]
    const history = [{ message_id: '2', time: 2, text: 'b' }, { message_id: '3', time: 3, text: 'c' }]
    const merged = mergeMessageRecords(local, history, 2)
    assert.deepEqual(merged.map(item => item.message_id), ['2', '3'])
  })
})

describe('样本采集决策', () => {
  test('去重后达到 30 条才跳过历史扫描', () => {
    const unique = Array.from({ length: 30 }, (_, index) => ({ message_id: String(index), time: index, text: `消息${index}` }))
    const plan = planSampleCollection(unique, 500, GROUP_MEMBER_SKILL_LIMITS)
    assert.equal(plan.useLocalOnly, true)
    assert.equal(plan.remaining, 470)
  })

  test('30 条重复文本去重后不足，必须回退历史扫描', () => {
    const duplicates = Array.from({ length: 30 }, () => ({ time: 1, text: '同一句' }))
    const plan = planSampleCollection(duplicates, 500, GROUP_MEMBER_SKILL_LIMITS)
    assert.equal(plan.records.length, 1)
    assert.equal(plan.useLocalOnly, false)
    assert.equal(plan.remaining, 499)
  })
})

describe('媒体时间线还原', () => {
  test('从占位符推导媒体类型与图文混合', () => {
    const { media_records: media, target_message_records: messages } = createMediaTimelineFromRawRows([
      { time: 1, text: '[图片]' },
      { time: 2, text: '看这个[图片]' },
      { time: 3, text: '纯文字' },
      { time: 4, text: '[表情][语音]' }
    ])
    assert.equal(messages.length, 4)
    assert.deepEqual(messages.map(item => item.has_media), [true, true, false, true])
    assert.deepEqual(messages.map(item => item.has_text), [false, true, true, false])
    assert.equal(media.length, 4)
    assert.deepEqual(media.map(item => item.is_mixed), [false, true, false, false])
    assert.deepEqual(media.map(item => item.type), ['image', 'image', 'sticker', 'audio'])
  })

  test('只有占位符的行不进文本样本，但计入媒体统计', () => {
    const sample = splitLocalRawRows([
      { messageId: '1', contentHash: 'h1', time: 1, text: '[图片]' },
      { messageId: '2', contentHash: 'h2', time: 2, text: '看图[图片]' }
    ])
    assert.deepEqual(sample.records.map(item => item.message_id), ['2'])
    assert.equal(sample.media_records.length, 2)
    assert.equal(sample.target_message_records.length, 2)
  })
})

describe('已存个人事实选择', () => {
  const facts = [
    { status: 'active', text: 'A', factKey: 'k', importance: 0.9, confidence: 0.9, updatedAt: 1 },
    { status: 'archived', text: '已归档', factKey: 'k', importance: 1 },
    { status: 'active', text: '已过期', factKey: 'k', importance: 1, validTo: 100 },
    { status: 'active', text: 'A', factKey: 'k', importance: 0.2, confidence: 0.2, updatedAt: 2 }
  ]

  test('剔除归档与过期，并按 factKey + 文本去重', () => {
    const selected = selectMemoryFacts(facts, GROUP_MEMBER_SKILL_LIMITS, 1000)
    assert.deepEqual(selected.map(item => item.text), ['A'])
  })

  test('按重要性排序', () => {
    const selected = selectMemoryFacts([
      { status: 'active', text: '低', importance: 0.1 },
      { status: 'active', text: '高', importance: 0.8 }
    ], GROUP_MEMBER_SKILL_LIMITS, 1000)
    assert.deepEqual(selected.map(item => item.text), ['高', '低'])
  })

  test('超出条数或字符上限时截断', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({ status: 'active', text: `事实${index}`, importance: 1 - index / 10 }))
    const byCount = selectMemoryFacts(many, { ...GROUP_MEMBER_SKILL_LIMITS, maxFacts: 2 }, 1000)
    assert.equal(byCount.length, 2)
    const byChars = selectMemoryFacts(many, { ...GROUP_MEMBER_SKILL_LIMITS, maxFactChars: 4 }, 1000)
    assert.equal(byChars.length, 1)
  })
})

describe('质量自检', () => {
  const synthesis = {
    mental_models: [
      { name: 'm1', limitation: 'l1' },
      { name: 'm2', limitation: 'l2' },
      { name: 'm3', limitation: 'l3' }
    ],
    expression_dna: [{ dimension: 'd1' }, { dimension: 'd2' }, { dimension: 'd3' }],
    honest_boundaries: ['b1', 'b2', 'b3'],
    tensions: [{ name: 't1' }, { name: 't2' }]
  }

  test('合格产物全部通过', () => {
    assert.deepEqual(checkSkillQuality(synthesis), { passed: true, failed: [] })
  })

  test('缺少心智模型、表达 DNA、边界、张力时分别报出', () => {
    const failedItems = checkSkillQuality({
      ...synthesis,
      mental_models: [{ name: 'm1', limitation: 'l1' }],
      expression_dna: [{ dimension: 'd1' }],
      honest_boundaries: ['b1'],
      tensions: [{ name: 't1' }]
    }).failed.map(item => item.item)
    assert.deepEqual(failedItems, ['心智模型数量', '表达 DNA', '诚实边界', '内在张力'])
  })

  test('模型缺失效条件时单独报出', () => {
    const failed = checkSkillQuality({
      ...synthesis,
      mental_models: [...synthesis.mental_models.slice(0, 2), { name: 'm3' }]
    }).failed
    assert.deepEqual(failed.map(item => item.item), ['模型失效条件'])
  })

  test('修正反馈列出每一项失败', () => {
    const feedback = createRetryFeedback([{ item: '表达 DNA', detail: '仅 1 项' }])
    assert.match(feedback, /表达 DNA：仅 1 项/)
  })
})

describe('合成校验', () => {
  const evidenceRecords = [
    { evidence_id: 'M0001', text: 'a' },
    { evidence_id: 'M0002', text: 'b' }
  ]
  const mapResults = [{
    topics: [
      { name: '话题一', evidence_ids: ['M0001'] },
      { name: '话题二', evidence_ids: ['M0002'] }
    ]
  }]

  test('research_dimensions 丢弃空字段、截断超长与超量', () => {
    const raw = {
      mental_models: [{ name: 'm', summary: 's', application: 'a', limitation: 'l', evidence_ids: ['M0001', 'M0002'] }],
      research_dimensions: [
        { dimension: '维度一', focus: '关注点' },
        { dimension: '', focus: '无维度' },
        { dimension: '无关注点' },
        { dimension: 'D'.repeat(80), focus: 'F'.repeat(120) },
        { dimension: '维度四', focus: '关注点' },
        { dimension: '维度五', focus: '关注点' },
        { dimension: '维度六', focus: '关注点' }
      ]
    }
    const result = validateSynthesis(raw, mapResults, evidenceRecords, null)
    assert.ok(result.research_dimensions.length <= 5)
    assert.equal(result.research_dimensions.length, 5)
    assert.equal(result.research_dimensions[1].dimension.length, 60)
    assert.equal(result.research_dimensions[1].focus.length, 80)
  })

  test('七个心智模型全部保留，不被截到五个', () => {
    const raw = {
      mental_models: Array.from({ length: 7 }, (_, index) => ({
        name: `模型${index}`,
        summary: '一句话',
        application: '应用',
        limitation: '局限',
        evidence_ids: ['M0001', 'M0002']
      }))
    }
    const result = validateSynthesis(raw, mapResults, evidenceRecords, null)
    assert.equal(result.mental_models.length, 7)
  })
})

describe('生成物结构', () => {
  const synthesis = {
    summary: '一个用于测试的视角',
    mental_models: [{
      name: '模型一', summary: '一句话', application: '应用', limitation: '局限',
      confidence: 'medium', evidence_ids: ['M0001']
    }],
    heuristics: [],
    expression_dna: [],
    attributes: [],
    values: [],
    anti_patterns: [],
    tensions: [],
    research_dimensions: [{ dimension: '看成本', focus: '对比单位成本' }],
    honest_boundaries: []
  }
  const base = {
    skillName: 'group-member-test-perspective',
    displayName: '测试群友',
    synthesis,
    confidence: 'low',
    generatedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 42,
    timeRange: { start: '2025-12-01', end: '2025-12-31' }
  }

  test('包含角色扮演规则、两条输出纪律与回答工作流', () => {
    const markdown = renderSkillMarkdown(base)
    assert.match(markdown, /## 角色扮演规则（最重要）/)
    assert.match(markdown, /未表态主题标推断/)
    assert.match(markdown, /关键引用可分辨/)
    assert.match(markdown, /## 回答工作流（Agentic Protocol）/)
    assert.match(markdown, /## 身份卡/)
    assert.match(markdown, /看成本/)
    assert.doesNotMatch(markdown, /时间线/)
    assert.doesNotMatch(markdown, /智识谱系/)
  })

  test('没有研究维度时给出推导规则而不是具体维度', () => {
    const markdown = renderSkillMarkdown({
      ...base,
      synthesis: { ...synthesis, research_dimensions: [] }
    })
    assert.match(markdown, /不要泛泛“搜索相关信息”/)
  })

  test('自检未通过时在诚实边界标注未过项', () => {
    const markdown = renderSkillMarkdown({
      ...base,
      quality: { passed: false, failed: [{ item: '表达 DNA', detail: '仅 0 项' }] }
    })
    assert.match(markdown, /未通过以下自检项.*表达 DNA/)
  })
})
