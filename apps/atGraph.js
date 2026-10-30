import plugin from '../../../lib/plugins/plugin.js'
import { createHash, randomInt } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { Config } from '../utils/config.js'
import { render } from '../utils/common.js'
import { MemoryStore } from '../utils/memory/store.js'
import { extractStructured, getBotUin } from '../utils/memory/capture.js'
import { buildAtGraph } from '../utils/memory/atGraph.js'
import { loadAtGraphAvatars } from '../utils/atGraphAvatars.js'
import { GROUP_MEMBER_SKILL_LIMITS, isConfirmWord, parseDistillTarget } from '../utils/groupMemberSkill.js'
import { logError, logWarn, toRelativePath } from '../utils/nuwaLog.js'
import { findProvider, providerLabel } from '../utils/providerProfiles.js'

// 单进程内同步登记发起者，无需 Redis 往返；占用一直保留到图片发送结束。
const inFlightUsers = new Set()
// #女娲蒸馏 按群互斥：同群同时只允许一个蒸馏任务，finally 释放；重启即重置。
const inFlightGroups = new Set()
const girlDirectory = new URL('../resources/girls/', import.meta.url)

async function randomGirlImage() {
  // 每次生成重新扫描，新增同命名风格的素材无需重启；只读取目录内的普通 WebP 文件。
  const entries = await readdir(girlDirectory, { withFileTypes: true })
  const files = entries.filter(entry => entry.isFile() && /^girl\d*\.webp$/i.test(entry.name)).map(entry => entry.name)
  if (!files.length) throw new Error('AT图谱装饰图目录中没有 girl.webp 或 girl数字.webp 素材')
  const buffer = await readFile(new URL(files[randomInt(files.length)], girlDirectory))
  return `data:image/webp;base64,${buffer.toString('base64')}`
}

/* ================= #女娲蒸馏 ================= */

/**
 * 主人显式触发的群成员视角蒸馏。和 `#at图谱` 同属「从本群记忆里取数」的指令，
 * 所以放在同一个插件里；但它是重任务，入口与确认门都在服务端，模型看不到这条能力。
 */

const USAGE = [
  '用法：#女娲蒸馏 @某人（或 QQ 号）',
  '也可以在引用对方消息后直接发 #女娲蒸馏。',
  '只在群聊可用、仅 Bot 主人；会先说明代价与注意事项，回 Y 才开始。'
].join('\n')

const BUSY_MESSAGE = '本群已有蒸馏任务在跑，请等它结束。'

const REASON_HINTS = {
  'at-all': '不要 @全体，请指定一名成员。',
  'multi-at': '一次只能蒸馏一名成员。',
  conflict: '给了两个不同的目标（@ / 引用 / QQ 号），请只指定一个。',
  invalid: '参数只接受 QQ 号；要按昵称指定请用 @。',
  self: '不能蒸馏 Bot 自己。',
  missing: ''
}

function providerName(id) {
  try {
    const row = findProvider(Config.getConfig(), id)
    return row ? providerLabel(row) : String(id || '默认提供商')
  } catch (err) {
    logWarn(`解析提供商名称失败，直接打印 id: ${err.message || err}`)
    return String(id || '默认提供商')
  }
}

function retentionDays() {
  return Number(Config.memoryGroupCapture?.rawRetentionDays) || 30
}

/** 目标昵称：查不到就用 QQ 号，适配器不支持查询时不做「不是成员」的判定。 */
function memberDisplayName(member, targetId) {
  return String(member?.card || member?.nickname || targetId)
}

function buildConfirmText({ name, targetId, provider, days }) {
  return [
    '🧬 女娲蒸馏 · 即将开始',
    `目标：${name}（${targetId}）`,
    `模型：${provider}（当前默认对话提供商）`,
    `样本：优先本群记忆采集的原文（当前保留 ${days} 天）与已存个人事实；`,
    '      不足 30 条时回退扫描本群最近 20000 条消息',
    `      最多取 ${GROUP_MEMBER_SKILL_LIMITS.defaultMessages} 条，超出时按时间等距抽样`,
    '脱敏：QQ、群号、手机号、@ 对象在送进模型前替换为占位符',
    '蒸馏：单块 50k token、总量上限 150k，最多 3 块，块间并发 2 路',
    '产物：SKILL.md + 证据索引 + 生成报告，打包为 ZIP',
    '────────────────',
    '⚠️ 注意事项',
    '· 产物是基于群聊样本的框架推断，不代表本人确认，也不能当成本人发言',
    `· 会消耗「${provider}」接口额度：样本少时通常 1–3 万输入 token，样本多时最多约 15 万`,
    `· 覆盖范围受两个上限约束：原文保留期（${days} 天）与最多 ${GROUP_MEMBER_SKILL_LIMITS.maxLocalScannedMessages} 条原文；群极活跃时只覆盖最近那段`,
    '· 全程约 1–5 分钟（块数多时更长），期间不要重复触发；同群同一时间只允许一个任务',
    '· 只读本群、只读该成员；跨群记忆与群公共记忆不参与',
    '· 本群未授权记忆采集时改用群历史接口扫描：更慢，且受接口限流影响',
    '· 产物落盘在 data/chatgpt/nuwa-skills/ 下，ZIP 默认发到你的私聊',
    '回复 Y 开始，回复其他内容取消（180 秒内有效；是 / 确认 亦可）'
  ].join('\n')
}

/**
 * 投递产物：私聊优先，抛错才回退当前群；都失败再退 SKILL.md。
 * 两级都不成时返回失败，由摘要说明「附件发送失败」并给产物目录。
 */
async function deliverArtifact(e, artifact) {
  const segmentFile = globalThis.segment?.file
  if (!segmentFile) return { sent: false, where: null, error: '当前适配器不支持发送文件' }

  const friend = e.bot?.pickFriend?.(e.user_id)
  if (typeof friend?.sendFile === 'function') {
    try {
      await friend.sendFile(artifact.zipPath, artifact.zipName)
      return { sent: true, where: 'private' }
    } catch (err) {
      logWarn(`私聊发送 ZIP 失败，回退当前群: ${err.message || err}`)
    }
  }

  try {
    await e.reply(segmentFile(artifact.zipPath, artifact.zipName))
    return { sent: true, where: 'group' }
  } catch (zipError) {
    logWarn(`群内发送 ZIP 失败，回退 SKILL.md: ${zipError.message || zipError}`)
    try {
      await e.reply(segmentFile(artifact.skillPath, 'SKILL.md'))
      return { sent: true, where: 'group', error: zipError.message || String(zipError) }
    } catch (markdownError) {
      return { sent: false, where: null, error: markdownError.message || String(markdownError) }
    }
  }
}

function buildSummary(result, delivery) {
  const s = result.summary
  const lines = [
    '🧬 女娲蒸馏完成',
    `样本：${s.sampleCount} 条（候选 ${s.candidateCount} 条，${s.usedLocalOnly ? '本地记忆' : '本地 + 历史扫描'}）｜置信度 ${s.confidence}`,
    `产物：心智模型 ${s.mentalModelCount} 个、启发式 ${s.heuristicCount} 条、表达 DNA ${s.expressionRuleCount} 项`,
    `自检：${s.qualityPassed ? '通过' : `未通过（${s.qualityFailed.join('、')}）`}`,
    `耗时：${Math.round(s.elapsedMs / 1000)} 秒｜输入约 ${Math.round(s.inputTokens / 1000)}k token｜${s.chunkCount} 块`,
    `目录：${toRelativePath(result.artifact.runRoot)}`
  ]
  if (delivery.sent) {
    lines.push(delivery.where === 'private' ? 'ZIP：已私聊发送' : 'ZIP：已发到本群（私聊发送失败）')
  } else {
    lines.push(`附件发送失败：${delivery.error}`)
  }
  return lines.join('\n')
}

export class atGraph extends plugin {
  constructor() {
    super({
      name: 'ChatGPT-Plugin AT图谱',
      dsc: '从本群记忆原文统计 @ 互动并直接出图（#at图谱）；主人专用 #女娲蒸馏 从群友群聊记录蒸馏 Agent Skill',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#(?:[aA][tT]|艾特)图谱(?:\\s*[\\s\\S]*)?$', fnc: 'graph' },
        { reg: '^#女娲蒸馏', fnc: 'distill', permission: 'master' }
      ]
    })
  }

  async graph(e) {
    if (!e.isGroup || !e.group_id) {
      await e.reply('请在已开启群记忆的群聊中使用 #at图谱。', true)
      return true
    }
    if (Config.enableAtGraph === false) {
      await e.reply('AT图谱已关闭，请主人在锅巴「智能模式 记忆设置」中开启「启用 AT 图谱」。', true)
      return true
    }
    const gid = String(e.group_id)
    const authorized = () => Config.enableMemory && MemoryStore.isGroupAuthorized(Config.memoryGroupCapture?.groups, gid)
    if (!authorized()) {
      await e.reply('AT图谱需要启用记忆系统并授权本群采集，请主人启用后在本群使用 #群记忆开启。', true)
      return true
    }
    const botId = getBotUin(e)
    const mentions = extractStructured(e.message ?? e.raw_message ?? e.msg)
    const targets = mentions.at.filter(id => id !== botId)
    const suffix = String(e.msg || '').replace(/^#(?:at|艾特)图谱/i, '').trim()
    if (mentions.atAll || targets.length > 1 || (suffix && !/^\d{5,20}$/.test(suffix))) {
      await e.reply('用法：#at图谱 查看自己；#at图谱 @某人（或 QQ 号）查看该成员在本群的互动。\n好感度固定展示前 5 位，一次只能查看一人的图谱。', true)
      return true
    }
    if (targets.length && suffix && targets[0] !== suffix) {
      await e.reply('请只指定一个图谱对象：@某人或填写 QQ 号。', true)
      return true
    }
    const selected = targets[0] || suffix || String(e.user_id)
    const targetId = selected === botId ? String(e.user_id) : selected
    const requesterId = String(e.user_id)
    if (inFlightUsers.has(requesterId)) {
      await e.reply('你的 AT图谱正在生成，请等待完成后再试。', true)
      return true
    }
    inFlightUsers.add(requesterId)
    try {
      const generatedAt = Math.floor(Date.now() / 1000)
      const snapshot = await new MemoryStore().getRecentRawMessages(gid, generatedAt)
      const graph = buildAtGraph({
        ...snapshot, groupId: gid, targetId, botId, generatedAt,
        targetName: targetId === String(e.user_id) ? e.sender?.card || e.sender?.nickname : '',
        groupName: e.group_name || e.group?.name || e.group?.info?.group_name
      })
      if (!graph.total) {
        await e.reply(`${graph.target.name} 在本群当前保留的记录中还没有可统计的 @ 互动${snapshot.limited ? `（本次仅检查最近 ${snapshot.limit} 条记录）` : ''}。\n只统计明确的成员 @，不含指令、机器人、自我 @、@全体、引用和戳一戳；旧记录未保存的 @ 无法补算。`, true)
        return true
      }
      // 本地素材转成 data URI，保持模板不开放 file: 图片读取的边界。
      const [avatars, girlImage] = await Promise.all([loadAtGraphAvatars(graph), randomGirlImage()])
      // 同群不同用户可并发，模板文件也按发起者隔离；同一用户后续请求复用文件。
      const img = await render(e, 'chatgpt-plugin', 'atGraph/index', {
        ...graph, avatars, girlImage, saveId: `at-${createHash('sha256').update(JSON.stringify([gid, requesterId])).digest('hex').slice(0, 16)}`
      }, { retType: 'base64' })
      if (!img) throw new Error('渲染器未返回图片')
      // 读取和截图期间可能关闭群采集；发送前再次检查实时授权。
      if (Config.enableAtGraph === false || !authorized()) {
        await e.reply('AT图谱开关或本群记忆采集已关闭，本次图谱已取消。', true)
        return true
      }
      const sent = await e.reply(img, true)
      if (sent === false) throw new Error('图片发送失败')
    } catch (err) {
      logger.error(`[MemoryV2] AT图谱生成失败（群 ${gid}，成员 ${targetId}）：${err.stack || err.message}`)
      await e.reply('AT图谱生成失败，请稍后重试；具体原因已记录到日志。', true)
    } finally {
      inFlightUsers.delete(requesterId)
    }
    return true
  }

  /** #女娲蒸馏：解析目标 → 讲清代价 → 确认 → 执行 → 投递 */
  async distill(e) {
    if (!e.isGroup || !e.group_id) {
      await this.reply('此指令仅在群聊中可用。', true)
      return true
    }
    if (!Config.enableGroupMemberSkillTool) {
      await this.reply('女娲蒸馏已关闭，请主人在锅巴「智能模式 记忆设置」中开启「指令-女娲蒸馏」。', true)
      return true
    }

    const groupId = String(e.group_id)
    if (inFlightGroups.has(groupId)) {
      await this.reply(BUSY_MESSAGE, true)
      return true
    }

    const structured = extractStructured(e.message ?? e.raw_message ?? e.msg)
    const suffix = String(e.msg ?? '').replace(/^#女娲蒸馏/, '').trim()
    const parsed = parseDistillTarget({
      at: structured.at,
      atAll: structured.atAll,
      replyUserId: structured.reply?.userId,
      text: suffix,
      selfId: String(e.self_id ?? '')
    })
    if (!parsed.ok) {
      const hint = REASON_HINTS[parsed.reason] || ''
      await this.reply(hint ? `${hint}\n${USAGE}` : USAGE, true)
      return true
    }

    const targetId = parsed.targetId
    // 执行段会拉起 SubLLM 与各 provider 客户端：它在工作流里首次用到时才加载（成员查询就要用到），
    // `#at图谱` 的启动路径不碰它。载入失败按「本次蒸馏失败」处理，不让异常直接冒到框架层。
    let distillModule
    try {
      distillModule = await import('../utils/groupMemberSkillRun.js')
    } catch (err) {
      logError(`蒸馏模块载入失败: ${err.stack || err.message || err}`)
      await this.reply('蒸馏模块载入失败，具体原因已记录到日志。', true)
      return true
    }
    const { lookupGroupMember, resolveDistillProviderId, runGroupMemberDistill } = distillModule
    const lookup = await lookupGroupMember(e, targetId)
    if (lookup.known && !lookup.member) {
      await this.reply('目标不是本群成员，已取消。', true)
      return true
    }

    const provider = providerName(resolveDistillProviderId(e))
    const days = retentionDays()
    await this.reply(buildConfirmText({
      name: memberDisplayName(lookup.member, targetId),
      targetId,
      provider,
      days
    }), true, { recallMsg: 100 })

    const next = await this.awaitContext(false, 180)
    if (!next) {
      await this.reply('确认超时，已取消。', true, { recallMsg: 100 })
      return true
    }
    if (!isConfirmWord(next.msg)) {
      await this.reply('已取消。', true, { recallMsg: 100 })
      return true
    }
    // 180 秒里开关可能被关掉；确认之后以实时值为准。
    if (!Config.enableGroupMemberSkillTool) {
      await this.reply('开关已关闭，本次取消。', true, { recallMsg: 100 })
      return true
    }
    if (inFlightGroups.has(groupId)) {
      await this.reply(BUSY_MESSAGE, true, { recallMsg: 100 })
      return true
    }

    inFlightGroups.add(groupId)
    try {
      await this.reply('开始蒸馏，约 1–5 分钟，期间请不要重复触发。', true)
      const result = await runGroupMemberDistill(e, {
        targetId,
        requestedCount: GROUP_MEMBER_SKILL_LIMITS.defaultMessages
      })
      const delivery = await deliverArtifact(e, result.artifact)
      await this.reply(buildSummary(result, delivery), true)
    } catch (err) {
      const dir = err.artifactDir ? `\n产物目录：${err.artifactDir}` : ''
      if (err.code === 'INSUFFICIENT_SAMPLES') {
        await this.reply(`数据不足：${err.message}，未生成 Skill。${dir}`, true)
      } else if (err.code === 'NOT_MEMBER') {
        await this.reply('目标不是本群成员，已取消。', true)
      } else {
        logError(`蒸馏失败（群 ${groupId}，目标 ${targetId}）：${err.stack || err.message || err}`)
        await this.reply(`蒸馏失败：${err.message || err}${dir}`, true)
      }
    } finally {
      inFlightGroups.delete(groupId)
    }
    return true
  }
}
