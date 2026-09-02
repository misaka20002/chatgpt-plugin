import { AbstractTool } from './AbstractTool.js'
import { MemoryStore } from '../memory/store.js'
import { validateEvidence } from '../memory/extractor.js'
import { Config } from '../config.js'

/**
 * Tool: 记忆写入/撤回工具（V2）
 *
 * 批量原子事实接口：每条候选只表达一个可独立更新的事实。
 * 当前消息 ID、用户 ID、群 ID 与证据由服务端补充，模型不能伪造证据。
 * 服务端重新校验：作用域、证据归属、factKey/factValue 规范、置信度、
 * 敏感信息与重复候选。
 */
export class MemoryTool extends AbstractTool {
  name = 'Memory_Tool'

  parameters = {
    properties: {
      candidates: {
        type: 'array',
        description: '待写入或撤回的原子事实列表。每条候选只包含一个可独立更新的事实，禁止聊天摘要与人格推测。',
        items: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['add', 'retract'],
              description: 'add 写入新事实；retract 撤回用户明确否定/推翻的既有事实。默认 add。'
            },
            scope: {
              type: 'string',
              enum: ['user', 'user_group', 'group'],
              description: 'user 跨群稳定的个人事实；user_group 仅当前群成立的个人事实；group 群规则/共同计划/公共经历（仅群主/管理员可写）。'
            },
            factKey: {
              type: 'string',
              description: '稳定事实槽位，小写英文点分命名，如 identity.gender / identity.age / profile.occupation / preference.favorite_character / preference.coffee / plan.job_search / group.rule.weekly_meeting。禁止中文与具体取值。'
            },
            factValue: {
              type: 'string',
              description: '简短规范值，用于去重与修订，如 male / 25 / raiden_shogun。'
            },
            text: {
              type: 'string',
              description: '第三人称原子事实文本，保留日期、计划时间与因果关系，不包含聊天过程。如"用户于 2026-06-15 失业"。'
            },
            kind: {
              type: 'string',
              enum: ['identity', 'preference', 'relationship', 'plan', 'group_rule', 'experience', 'episode'],
              description: '事实类型。'
            },
            confidence: {
              type: 'number',
              description: '置信度 0-1。用户本人清晰自述 0.85-0.98；较弱 0.70-0.84；低于 0.70 不要输出。'
            },
            importance: {
              type: 'number',
              description: '对未来对话的价值 0-1（不代表置信度）。'
            },
            validTo: {
              type: 'string',
              description: '可选，ISO 日期。计划/临时状态/事件必须填写；稳定事实留空。'
            }
          },
          required: ['scope', 'factKey', 'factValue', 'text', 'kind', 'confidence', 'importance']
        }
      }
    },
    required: ['candidates']
  }

  description = '写入或撤回原子记忆事实。当用户明确自述个人信息（姓名/昵称/性别/年龄/生日/职业/学历）、长期兴趣偏好、重要计划、事件结论（如"我上个月失业了""我打算下个月开始找工作""我最喜欢的角色是X""我因为X入坑了某游戏"）或明确否定既有事实时调用。约束：每条候选只写一个事实；只记录本人明确自述或有充分证据的内容；不保存聊天摘要、密码、验证码、Token、支付信息、证件号、手机号和精确住址。'

  func = async function (opts, e) {
    const { candidates } = opts
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return 'Error: candidates 数组不能为空'
    }
    if (candidates.length > 20) {
      return 'Error: 单次最多写入 20 条候选'
    }

    const messageId = e.message_id ?? e.seq ?? `t${e.time || Date.now()}`
    const userId = String(e.user_id)
    const groupId = e.group_id ? String(e.group_id) : ''
    const role = String(e.sender?.role || '').toLowerCase()
    const isAuthoritative = ['owner', 'admin'].includes(role)

    // 服务端补充证据：当前消息（模型不能伪造证据）
    const evidenceMap = {
      [messageId]: {
        groupId,
        senderId: userId,
        senderName: e.sender?.card || e.sender?.nickname || '',
        role: e.sender?.role || '',
        time: Math.floor(Number(e.time) || Date.now() / 1000),
      },
    }

    const store = new MemoryStore()
    const output = []

    for (const raw of candidates) {
      // 强制服务端归属：subjectId/speakerId/evidenceMessageIds 由服务端补充
      const candidate = {
        ...raw,
        operation: raw.operation === 'retract' ? 'retract' : 'add',
        subjectId: userId,
        speakerId: userId,
        evidenceMessageIds: [messageId],
        sensitivity: raw.sensitivity || 'normal',
      }

      // 群事实：必须有管理权限（单条消息无法满足"两名成员支持"，走管理员公告通道）
      if (candidate.scope === 'group' && !isAuthoritative && !e.isMaster) {
        output.push({ ok: false, candidate: { factKey: candidate.factKey, scope: candidate.scope }, reason: '群级事实仅限群主/管理员或 Bot 主人写入' })
        continue
      }

      // 置信度阈值：与每日提炼一致应用配置的 minConfidence（默认 0.7），拒绝低质量候选
      // 注意用 || 而非 ??：Number(undefined)=NaN，?? 不处理 NaN 会导致配置缺失时阈值失效
      const minConfidence = Number(Config.memoryGroupCapture?.minConfidence) || 0.7
      if (candidate.operation !== 'retract' && Number(candidate.confidence) < minConfidence) {
        output.push({ ok: false, candidate: { factKey: candidate.factKey, scope: candidate.scope }, reason: `置信度 ${candidate.confidence} 低于阈值 ${minConfidence}` })
        continue
      }

      const evidenceCheck = validateEvidence(candidate, evidenceMap)
      if (!evidenceCheck.ok) {
        output.push({ ok: false, candidate: { factKey: candidate.factKey, scope: candidate.scope }, reason: evidenceCheck.reason })
        continue
      }

      const result = await store.applyFact(candidate, {
        groupId,
        source: 'Memory_Tool',
        evidenceMap,
        maxMemoriesPerUser: Number(Config.maxMemoriesPerUser) || 100,
        eventRetentionDays: Number(Config.memoryGroupCapture?.eventRetentionDays) || 90,
      })
      output.push(result)
    }

    const accepted = output.filter(r => r.ok).length
    const detail = output
      .filter(r => !r.ok)
      .map(r => `${r.candidate?.factKey || ''}: ${r.reason}`)
      .join('；')

    logger.info(`[MemoryV2] Memory_Tool 写入 ${output.length} 条候选，成功 ${accepted} 条: ${detail}`)

    if (accepted === 0) {
      return `Memory write rejected: ${detail || '所有候选均未通过校验'}`
    }
    return `记忆已更新：成功 ${accepted} 条。${detail ? `被拒绝 ${output.length - accepted} 条（${detail}）` : ''}`
  }
}
