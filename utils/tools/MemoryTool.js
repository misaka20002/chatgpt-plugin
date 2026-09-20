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
        description: '原子记忆列表。每条只表达一个独立事实，不要写聊天摘要、推测或多事实合并内容。',
        items: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['add', 'retract'],
              description: 'add 新增或更新事实；retract 撤回用户明确否定或纠正的事实。默认 add。'
            },
            scope: {
              type: 'string',
              enum: ['user', 'user_group', 'group'],
              description: 'user：跨群个人事实；user_group：仅当前群有效的个人事实；group：群规则、共同计划或公共事实。'
            },
            factKey: {
              type: 'string',
              description: '稳定事实槽位，小写英文点分命名，只描述事实类型，不含具体值。常用前缀：identity.*、profile.*、preference.*、communication.style、group_role.*、relationship.*、plan.*、experience.*、episode.*、group.rule.*、group.event.*。'
            },
            factValue: {
              type: 'string',
              description: '简短规范值，用于去重和更新。如 25、software_engineer、raiden_shogun。'
            },
            text: {
              type: 'string',
              description: '第三人称原子事实文本，只写事实本身，必要时保留日期、时间和因果关系。'
            },
            kind: {
              type: 'string',
              enum: ['identity', 'preference', 'relationship', 'plan', 'group_rule', 'experience', 'episode'],
              description: '事实类型。'
            },
            confidence: {
              type: 'number',
              description: '可信度 0-1。明确自述通常 0.85-0.98；较弱证据 0.70-0.84；低于 0.70 不要提交。'
            },
            importance: {
              type: 'number',
              description: '对未来对话的价值 0-1，与可信度无关。'
            },
            validTo: {
              type: 'string',
              description: '可选，YYYY-MM-DD。临时状态、阶段性计划或会过期的事实填写；长期事实留空。'
            }
          },
          required: ['scope', 'factKey', 'factValue', 'text', 'kind', 'confidence', 'importance']
        }
      }
    },
    required: ['candidates']
  }

  description = '新增、更新或撤回长期原子记忆。适用于用户明确自述的身份信息、家庭与关系、工作与单位、居住场所、长期偏好、重要计划、经历和事件，以及对既有事实的明确纠正或否定。保留用户给出的具体信息（单位、地点、称谓、时间），不要泛化成笼统结论。每条只记录一个事实；只记录有直接证据的内容；不要保存聊天摘要、人格推测、低置信度信息，以及密码、验证码、Token/API Key、Cookie 这类登录凭证。'

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
    // Bot 主人等同于群主/管理员：即使 ta 在本群的 role 只是 member，也应能写群级事实。
    // 该标志只来自服务端事件上下文 e，绝不写进 candidate（candidate 是模型的不可信数据）。
    const isBotMaster = !!e.isMaster

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
      // operation 只接受 add / retract：历史写法把任何非 retract 值都当 add，
      // 模型写 "remove"/"delete" 会被静默解释成"新增事实"，语义相反
      const rawOperation = raw?.operation
      if (rawOperation !== undefined && rawOperation !== null && rawOperation !== '' &&
        rawOperation !== 'add' && rawOperation !== 'retract') {
        output.push({ ok: false, candidate: { factKey: raw?.factKey, scope: raw?.scope }, reason: `非法 operation: ${rawOperation}` })
        continue
      }

      // 强制服务端归属：subjectId/speakerId/evidenceMessageIds 由服务端补充
      const candidate = {
        ...raw,
        operation: rawOperation === 'retract' ? 'retract' : 'add',
        subjectId: userId,
        speakerId: userId,
        evidenceMessageIds: [messageId],
      }

      // 群事实：必须有管理权限（单条消息无法满足"两名成员支持"，走管理员公告通道）
      if (candidate.scope === 'group' && !isAuthoritative && !isBotMaster) {
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

      const evidenceCheck = validateEvidence(candidate, evidenceMap, { isBotMaster })
      if (!evidenceCheck.ok) {
        output.push({ ok: false, candidate: { factKey: candidate.factKey, scope: candidate.scope }, reason: evidenceCheck.reason })
        continue
      }

      const result = await store.applyFact(candidate, {
        groupId,
        source: 'Memory_Tool',
        evidenceMap,
        isBotMaster, // 可信 ctx：只来自 e（见 store.js「ctx 可信字段约定」）；candidate 里不存在同名受信字段
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
