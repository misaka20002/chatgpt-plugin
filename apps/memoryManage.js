import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { makeForwardMsg } from '../utils/common.js'
import { getStore } from '../utils/memory/v2.js'
import { groupCapture } from '../utils/memory/capture.js'
import { dailyConsolidation, normalizeCron } from '../utils/memory/dailyTask.js'

const KIND_LABELS = {
  identity: '身份',
  preference: '偏好',
  relationship: '关系',
  plan: '计划',
  group_rule: '群规则',
  experience: '经历',
  episode: '事件'
}

const SCOPE_LABELS = {
  user: '🌐跨群个人',
  user_group: '👥本群个人',
  group: '🏘️群公共'
}

export class memoryManage extends plugin {
  constructor(e) {
    super({
      name: 'ChatGPT-Plugin 记忆管理',
      dsc: 'V2 记忆系统管理：查看、删除、清空记忆；群记忆采集指令与每日批量提炼',
      event: 'message',
      // 数字越小优先级越高（TRSS 升序调度）：500 < chat.js(1144)
      priority: 500,
      rule: [
        {
          reg: '^#我的记忆$',
          fnc: 'myMemories'
        },
        {
          reg: '^#群记忆$',
          fnc: 'groupMemories'
        },
        {
          reg: '^#群记忆开启$',
          fnc: 'enableGroupMemory',
          permission: 'master'
        },
        {
          reg: '^#群记忆关闭$',
          fnc: 'disableGroupMemory',
          permission: 'master'
        },
        {
          reg: '^#群记忆状态$',
          fnc: 'groupMemoryStatus',
          permission: 'master'
        },
        {
          reg: '^#立即提取群记忆$',
          fnc: 'extractGroupMemoryNow',
          permission: 'master'
        },
        {
          reg: '^#记忆任务运行$',
          fnc: 'runDailyDebug',
          permission: 'master'
        },
        {
          reg: '^#(他|她|TA|ta)的记忆',
          fnc: 'otherMemories',
          permission: 'master'
        },
        {
          reg: '^#清空(他|她|TA|ta)的记忆',
          fnc: 'clearOtherMemories',
          permission: 'master'
        },
        {
          reg: '^#清空我的记忆$',
          fnc: 'clearMyMemories'
        },
        {
          reg: '^#删除记忆',
          fnc: 'deleteMemory',
          permission: 'master'
        },
        {
          reg: '^#清空所有记忆$',
          fnc: 'clearAllMemories',
          permission: 'master'
        },
        {
          reg: '^#记忆统计',
          fnc: 'memoryStats',
          permission: 'master'
        },
        {
          reg: '^#记忆帮助$',
          fnc: 'memoryHelp',
          permission: 'master'
        }
      ]
    })

    this.task = {
      name: '记忆每日提炼',
      cron: normalizeCron(Config.memoryGroupCapture?.cronTime),
      fnc: this.runDaily.bind(this)
    }
  }

  /* ================= 群记忆管理指令（原 groupMemoryManage） ================= */

  /** 开启当前群记忆（授权 + 补录最近24h最多500条，需二次确认） */
  async enableGroupMemory(e) {
    if (!e.isGroup || !e.group_id) {
      await this.reply('此命令仅在群聊中可用', true)
      return
    }
    await this.reply(
      `⚠️ 确定要开启本群记忆采集吗？\n` +
      `将授权采集本群的非指令、非Bot纯文本消息（原文默认保留 ${Config.memoryGroupCapture?.rawRetentionDays ?? 30} 天）\n` +
      `并补录最近 24 小时、最多 500 条可获取的历史消息，用于每日批量提炼\n` +
      `回复"是"确认，回复其他内容取消`,
      true
    )
    const e_new = await this.awaitContext()
    if (!e_new.msg || !(/^(是|y|yes|确定|确认)$/i).test(e_new.msg.trim())) {
      await this.reply('操作已取消', true)
      return
    }
    const result = await groupCapture.enableGroup(e)
    await this.reply(result.message, true)
  }

  /** 关闭当前群记忆（取消授权 + 来源级清理，需二次确认） */
  async disableGroupMemory(e) {
    if (!e.isGroup || !e.group_id) {
      await this.reply('此命令仅在群聊中可用', true)
      return
    }
    const store = getStore()
    const gid = String(e.group_id)
    // 提示将删除的数据规模
    let warn = `⚠️ 确定要关闭本群记忆采集并执行来源级清理吗？\n`
    try {
      const tasks = await store.listTasks(gid).catch(() => [])
      const raws = await store.getRawMessages(gid, 0, Math.floor(Date.now() / 1000) + 86400).catch(() => [])
      warn += `将删除：本群原文 ${raws.length} 条、提炼任务 ${tasks.length} 个，以及仅由本群支持的记忆事实\n`
      warn += `保留：跨群成立或手工确认的事实（仅移除本群来源证据）\n`
    } catch { /* 统计失败不阻塞确认 */ }
    warn += `此操作不可恢复！\n回复"是"确认，回复其他内容取消`
    await this.reply(warn, true)

    const e_new = await this.awaitContext()
    if (!e_new.msg || !(/^(是|y|yes|确定|确认)$/i).test(e_new.msg.trim())) {
      await this.reply('操作已取消', true)
      return
    }
    const result = await groupCapture.disableGroup(e)
    await this.reply(result.message, true)
  }

  /** 查看群记忆状态 */
  async groupMemoryStatus(e) {
    const store = getStore()
    const gid = e.group_id ? String(e.group_id) : ''
    const groups = Array.isArray(Config.memoryGroupCapture?.groups) ? Config.memoryGroupCapture.groups : []
    const authorized = groups.filter(g => g && g.groupId && g.switchOn)
    const currentAuthorized = authorized.some(g => String(g.groupId) === gid)

    const stats = await store.stats().catch(() => ({ total: 0, byScope: {} }))
    const cfg = Config.memoryGroupCapture || {}

    let lines = []
    lines.push('🧠 V2 记忆系统状态')
    lines.push(`总开关(启用记忆系统)：${Config.enableMemory ? '✅ 已启用' : '❌ 未启用'}`)
    lines.push(`授权采集群：${authorized.length > 0 ? authorized.map(g => g.groupId).join('、') : '（无，可在群内 #群记忆开启）'}`)
    if (gid) {
      lines.push(`本群：${currentAuthorized ? '✅ 已授权采集' : '❌ 未授权'}`)
    }
    lines.push(`每日提炼时间：${cfg.cronTime || '0 0 4 * * ? *'}（修改后重启生效）`)
    lines.push(`原文保留：${cfg.rawRetentionDays ?? 30} 天 | 事件保留：${cfg.eventRetentionDays ?? 90} 天`)
    lines.push(`提取 Token：输入 ${cfg.inputTokenLimit ?? 30000} / 输出 ${cfg.outputTokenLimit ?? 4096} | 最低置信度：${cfg.minConfidence ?? 0.7}`)
    lines.push('')
    lines.push('📊 记忆统计（V2）')
    lines.push(`总事实数：${stats.total} 条`)
    lines.push(`  user(跨群)：${stats.byScope?.user || 0} 条`)
    lines.push(`  user_group(本群个人)：${stats.byScope?.user_group || 0} 条`)
    lines.push(`  group(群公共)：${stats.byScope?.group || 0} 条`)

    if (gid) {
      const tasks = await store.listTasks(gid).catch(() => [])
      const pending = tasks.filter(t => t.status === 'pending').length
      const completed = tasks.filter(t => t.status === 'completed').length
      const failed = tasks.filter(t => t.status === 'failed').length
      lines.push('')
      lines.push(`本群提炼任务：${tasks.length} 个窗口（完成 ${completed} / 待处理 ${pending} / 失败 ${failed}）`)
    }

    await this.reply(lines.join('\n'), true)
  }

  /** 立即提取当前群记忆 */
  async extractGroupMemoryNow(e) {
    if (!e.isGroup || !e.group_id) {
      await this.reply('此命令仅在群聊中可用', true)
      return
    }
    const gid = String(e.group_id)
    await this.reply('正在提取本群记忆（含失败任务重试与最近窗口补提炼），请稍候…', true)
    const result = await dailyConsolidation.runImmediate(gid)
    await this.reply(result.message, true)
  }

  /* ================= 每日批量提炼任务（原 memoryDailyTask） ================= */

  /** EasyCron 每日任务入口（只处理已结束的北京时间自然日） */
  async runDaily() {
    try {
      const report = await dailyConsolidation.runDaily()
      if (report?.skipped) {
        logger.info(`[MemoryV2] 每日提炼跳过: ${report.reason}`)
      }
    } catch (err) {
      logger.error(`[MemoryV2] 每日提炼异常: ${err.message}`)
    }
  }

  /** 主人手动触发一次每日任务（调试） */
  async runDailyDebug(e) {
    const report = await dailyConsolidation.runDaily()
    await this.reply(`每日提炼执行结果：${JSON.stringify(report)?.slice(0, 800)}`, true)
  }


  async sendChunkedForwardMsg(e, messages, title) {
    const CHUNK_SIZE = 20
    if (messages.length <= CHUNK_SIZE) {
      await e.reply(await makeForwardMsg(e, messages, title))
      return
    }
    const totalChunks = Math.ceil(messages.length / CHUNK_SIZE)
    for (let i = 0; i < totalChunks; i++) {
      const chunk = messages.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
      const chunkTitle = `${title} [${i + 1}/${totalChunks}]`
      await e.reply(await makeForwardMsg(e, chunk, chunkTitle))
    }
  }

  /** 格式化一条 V2 记忆 */
  formatMemory(m, index) {
    const kindLabel = KIND_LABELS[m.kind] || m.kind
    const scopeLabel = SCOPE_LABELS[m.scope] || m.scope
    let msg = `【记忆 ${index}】\n`
    msg += `作用域：${scopeLabel}\n`
    msg += `类型：${kindLabel}\n`
    msg += `事实键：${m.factKey} = ${m.factValue}\n`
    msg += `内容：${m.text}\n`
    msg += `置信度：${Number(m.confidence).toFixed(2)} | 重要性：${Number(m.importance).toFixed(2)}\n`
    if (m.validTo && m.validTo > 0) {
      msg += `有效期至：${new Date(m.validTo * 1000).toLocaleDateString('zh-CN')}\n`
    }
    msg += `来源：${m.source}\n`
    msg += `ID：${m.id}`
    return msg
  }

  /** 查看自己的记忆 */
  async myMemories(e) {
    if (!Config.enableMemory) {
      await e.reply('记忆系统未启用', true)
      return
    }
    try {
      const store = getStore()
      const memories = await store.listRecallCandidates(e.user_id, e.group_id || '')
      if (memories.length === 0) {
        await e.reply('你还没有任何记忆哦~', true)
        return
      }
      memories.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      const messages = memories.map((m, index) => this.formatMemory(m, index + 1))
      await this.sendChunkedForwardMsg(e, messages, `我的记忆 (共${memories.length}条)`)
    } catch (err) {
      logger.error('[Memory] 获取记忆失败:', err)
      await e.reply('获取记忆失败', true)
    }
  }

  /** 查看当前群记忆统计（主人专用） */
  async groupMemories(e) {
    if (!Config.enableMemory) {
      await e.reply('记忆系统未启用', true)
      return
    }
    if (!e.isGroup) {
      await e.reply('此命令仅在群聊中可用', true)
      return
    }
    try {
      const store = getStore()
      const gid = String(e.group_id)
      const groupMemories = await store.listByScope({ scope: 'group', ownerId: gid, groupId: gid })
      const userGroupMemories = await store.listUserGroupByGroup(gid)
      if (groupMemories.length === 0 && userGroupMemories.length === 0) {
        await e.reply('本群还没有任何记忆（可 #群记忆开启 采集，或等待每日提炼）', true)
        return
      }
      const messages = []
      messages.push(`本群公共记忆（group）：${groupMemories.length} 条`)
      groupMemories.forEach((m, i) => messages.push(this.formatMemory(m, `G${i + 1}`)))
      messages.push(`本群个人记忆（user_group）：${userGroupMemories.length} 条`)
      await this.sendChunkedForwardMsg(e, messages, `群记忆 (共${groupMemories.length + userGroupMemories.length}条)`)
    } catch (err) {
      logger.error('[Memory] 获取群记忆失败:', err)
      await e.reply('获取群记忆失败', true)
    }
  }

  /** 查看他人的记忆（主人专用） */
  async otherMemories(e) {
    if (!Config.enableMemory) {
      await e.reply('记忆系统未启用', true)
      return
    }
    let targetUserId = null
    const atUsers = e.message.filter(m => m.type === 'at')
    if (atUsers.length > 0) {
      targetUserId = atUsers[0].qq
    } else {
      const match = e.msg.match(/^#(?:他|她|TA|ta)的记忆\s+(\S+)/i)
      if (match) targetUserId = match[1]
    }
    if (!targetUserId) {
      await e.reply('请@某人或输入用户ID，例如：#他的记忆 user_123', true)
      return
    }
    try {
      const store = getStore()
      const memories = await store.listRecallCandidates(targetUserId, e.group_id || '')
      if (memories.length === 0) {
        await e.reply(`用户 ${targetUserId} 还没有任何记忆`, true)
        return
      }
      memories.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      const messages = memories.map((m, index) => this.formatMemory(m, index + 1))
      await this.sendChunkedForwardMsg(e, messages, `${targetUserId}的记忆 (共${memories.length}条)`)
    } catch (err) {
      logger.error('[Memory] 获取用户记忆失败:', err)
      await e.reply('获取记忆失败', true)
    }
  }

  /** 清空他人的记忆（主人专用） */
  async clearOtherMemories(e) {
    if (!Config.enableMemory) {
      await e.reply('记忆系统未启用', true)
      return
    }
    let targetUserId = null
    const atUsers = e.message.filter(m => m.type === 'at')
    if (atUsers.length > 0) {
      targetUserId = atUsers[0].qq
    } else {
      const match = e.msg.match(/^#清空(?:他|她|TA|ta)的记忆\s+(\S+)/i)
      if (match) targetUserId = match[1]
    }
    if (!targetUserId) {
      await e.reply('请@某人或输入用户ID，例如：#清空他的记忆 user_123', true)
      return
    }
    try {
      const store = getStore()
      // 预检须覆盖全部作用域（含其他群 user_group 与已过期数据）
      const hasMemories = await store.hasUserMemories(targetUserId)
      if (!hasMemories) {
        await e.reply(`用户 ${targetUserId} 没有记忆，无需清空`, true)
        return
      }
      await e.reply(`确定要清空用户 ${targetUserId} 的所有记忆吗？\n回复"是"确认，回复其他内容取消`, true)
      const e_new = await this.awaitContext()
      if (!e_new.msg || !(/^(是|y|yes|确定|确认)$/i).test(e_new.msg.trim())) {
        await e.reply('操作已取消', true)
        return
      }
      const success = await store.clearUser(targetUserId)
      if (success) {
        await e.reply(`已成功清空用户 ${targetUserId} 的所有记忆`, true)
        logger.info(`[Memory] 主人 ${e.user_id} 清空了用户 ${targetUserId} 的记忆`)
      } else {
        await e.reply('清空记忆失败', true)
      }
    } catch (err) {
      logger.error('[Memory] 清空记忆失败:', err)
      await e.reply('清空记忆失败', true)
    }
  }

  /** 清空自己的记忆 */
  async clearMyMemories(e) {
    if (!Config.enableMemory) {
      await e.reply('记忆系统未启用', true)
      return
    }
    try {
      const store = getStore()
      // 预检须覆盖全部作用域（含其他群 user_group 与已过期数据），不能用 listRecallCandidates（只查当前群+未过期）
      const hasMemories = await store.hasUserMemories(e.user_id)
      if (!hasMemories) {
        await e.reply('你还没有记忆，无需清空', true)
        return
      }
      await e.reply('确定要清空你的所有记忆吗？此操作不可恢复！\n回复"是"确认，回复其他内容取消', true)
      const e_new = await this.awaitContext()
      if (!e_new.msg || !(/^(是|y|yes|确定|确认)$/i).test(e_new.msg.trim())) {
        await e.reply('操作已取消', true)
        return
      }
      const success = await store.clearUser(e.user_id)
      if (success) {
        await e.reply('已成功清空你的所有记忆', true)
        logger.info(`[Memory] 用户 ${e.user_id} 清空了自己的记忆`)
      } else {
        await e.reply('清空记忆失败', true)
      }
    } catch (err) {
      logger.error('[Memory] 清空记忆失败:', err)
      await e.reply('清空记忆失败', true)
    }
  }

  /** 删除指定记忆（主人专用） */
  async deleteMemory(e) {
    if (!Config.enableMemory) {
      await e.reply('记忆系统未启用', true)
      return
    }
    const match = e.msg.match(/#删除记忆\s+(\S+)\s+[#\s]*([a-zA-Z0-9_\-]+)/i)
    if (!match) {
      await e.reply('格式错误！\n用法1: #删除记忆 用户ID 序号 (例如：#删除记忆 user_123 3)\n用法2: #删除记忆 用户ID 记忆ID', true)
      return
    }
    const targetUserId = match[1]
    const memoryIdentifier = match[2]
    try {
      const store = getStore()
      const memories = await store.listRecallCandidates(targetUserId, e.group_id || '')
      if (memories.length === 0) {
        await e.reply(`用户 ${targetUserId} 没有记忆`, true)
        return
      }
      let memoryToDelete = null
      if (/^\d{1,4}$/.test(memoryIdentifier)) {
        const index = parseInt(memoryIdentifier) - 1
        if (index < 0 || index >= memories.length) {
          await e.reply(`序号超出范围，该用户共有 ${memories.length} 条记忆`, true)
          return
        }
        memoryToDelete = memories[index]
      } else {
        memoryToDelete = memories.find(m => m.id === memoryIdentifier)
        if (!memoryToDelete) {
          await e.reply('未找到该记忆ID', true)
          return
        }
      }
      await e.reply(`确定要删除以下记忆吗？\n作用域：${SCOPE_LABELS[memoryToDelete.scope] || memoryToDelete.scope}\n内容：${memoryToDelete.text}\n\n回复"是"确认，回复其他内容取消`, true)
      const e_new = await this.awaitContext()
      if (!e_new.msg || !(/^(是|y|yes|确定|确认)$/i).test(e_new.msg.trim())) {
        await e.reply('操作已取消', true)
        return
      }
      const success = await store.deleteMemory(memoryToDelete.id)
      if (success) {
        await e.reply('记忆已删除', true)
        logger.info(`[Memory] 主人 ${e.user_id} 删除了用户 ${targetUserId} 的记忆: ${memoryToDelete.id}`)
      } else {
        await e.reply('删除记忆失败', true)
      }
    } catch (err) {
      logger.error('[Memory] 删除记忆失败:', err)
      await e.reply('删除记忆失败', true)
    }
  }

  /** 清空所有用户的记忆（主人专用，同时删除残留旧 Hash） */
  async clearAllMemories(e) {
    try {
      const store = getStore()
      const stats = await store.stats()
      if (stats.total === 0) {
        // 可能只剩旧 Hash
        const legacyKeys = await store.listLegacyHashKeys()
        if (legacyKeys.length === 0) {
          await e.reply('当前没有任何记忆', true)
          return
        }
      }
      await e.reply(
        `⚠️ 警告：此操作将清空所有 V2 记忆（含残留旧版 Hash）！\n\n` +
        `当前 V2 记忆数：${stats.total} 条\n` +
        `此操作不可恢复！确定要继续吗？\n` +
        `回复"确定清空所有记忆"以确认，回复其他内容取消`,
        true
      )
      const e_new = await this.awaitContext()
      if (!e_new.msg || e_new.msg.trim() !== '确定清空所有记忆') {
        await e.reply('操作已取消', true)
        return
      }
      const removed = await store.clearAll()
      await e.reply(`✅ 已成功清空所有记忆（删除 ${removed} 个键，含残留旧版 Hash）`, true)
      logger.warn(`[Memory] 主人 ${e.user_id} 清空了所有记忆 (${removed} keys)`)
    } catch (err) {
      logger.error('[Memory] 清空所有记忆失败:', err)
      await e.reply('清空所有记忆失败', true)
    }
  }

  /** 记忆统计（主人专用） */
  async memoryStats(e) {
    if (!Config.enableMemory) {
      await e.reply('记忆系统未启用', true)
      return
    }
    try {
      const store = getStore()
      const stats = await store.stats()
      const byKindLines = Object.entries(stats.byKind || {})
        .map(([kind, count]) => `  ${KIND_LABELS[kind] || kind}：${count} 条`)
        .join('\n')

      let msg = `📊 V2 记忆统计\n\n`
      msg += `总事实数：${stats.total} 条\n`
      msg += `作用域分布：\n`
      msg += `  🌐 user(跨群个人)：${stats.byScope?.user || 0} 条\n`
      msg += `  👥 user_group(本群个人)：${stats.byScope?.user_group || 0} 条\n`
      msg += `  🏘️ group(群公共)：${stats.byScope?.group || 0} 条\n`
      if (byKindLines) {
        msg += `类型分布：\n${byKindLines}\n`
      }
      msg += `\n配置信息：\n`
      msg += `  单用户上限：${Config.maxMemoriesPerUser} 条\n`
      msg += `  对话最低重要性：${Config.memoryMinImportance}\n`
      msg += `  对话记忆数量：${Config.memoryContextLimit} 条\n`
      msg += `  授权采集群：${(Config.memoryGroupCapture?.groups || []).filter(g => g?.switchOn).length} 个`
      await e.reply(msg, true)
    } catch (err) {
      logger.error('[Memory] 获取统计失败:', err)
      await e.reply('获取统计信息失败', true)
    }
  }

  /** 记忆帮助 */
  async memoryHelp(e) {
    const helpMsg = `📚 V2 记忆系统帮助\n\n` +
      `【查看记忆】\n` +
      `#我的记忆 - 查看自己的记忆\n` +
      `#他的记忆 @某人 - 查看某人的记忆(主人)\n` +
      `#群记忆 - 查看当前群的公共/个人记忆统计\n\n` +
      `【删除记忆】\n` +
      `#清空所有记忆 - 清空所有记忆并删除残留旧Hash(主人)\n` +
      `#清空我的记忆 - 清空自己的所有记忆\n` +
      `#清空他的记忆 @某人 - 清空某人的记忆(主人)\n` +
      `#删除记忆 用户ID 序号 - 删除指定记忆(主人)\n\n` +
      `【群记忆采集】\n` +
      `#群记忆开启 - 授权当前群采集并补录最近24h历史(主人)\n` +
      `#群记忆关闭 - 关闭当前群采集并执行来源级清理(主人)\n` +
      `#群记忆状态 - 查看采集状态与统计(主人)\n` +
      `#立即提取群记忆 - 立即提炼当前群记忆(主人)\n\n` +
      `【统计信息】\n` +
      `#记忆统计 - 查看记忆统计(主人)\n\n` +
      `记忆作用域：\n` +
      `🌐 user - 跨群稳定的个人事实\n` +
      `👥 user_group - 仅当前群成立的个人事实\n` +
      `🏘️ group - 群规则、共同计划与公共经历\n\n` +
      `说明：记忆由「每日批量提炼 + 对话中 Memory_Tool」写入，单值事实自动替换旧值，相同事实合并证据并提升置信度，明确否定自动撤回。`
    await e.reply(helpMsg, true)
  }
}
