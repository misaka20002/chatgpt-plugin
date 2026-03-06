import { Config } from './config.js'

/**
 * 用户记忆管理模块
 * 用于存储和检索AI的用户记忆
 */
export class UserMemory {
  /**
   * 保存记忆到Redis (使用Hash表)
   * @param {Object} memory - 记忆对象
   * @returns {Promise<{success: boolean, message: string}>}
   */
  static async saveMemory(memory) {
    try {
      const { userId } = memory
      const userMemoryKey = `CHATGPT:MEMORY:USER:${userId}`

      // 获取所有现有记忆
      const existingMemories = await redis.hGetAll(userMemoryKey)
      const memoriesArray = Object.values(existingMemories || {}).map(m => JSON.parse(m))

      // 检查是否超过个人记忆限制
      if (memoriesArray.length >= Config.maxMemoriesPerUser) {
        // 使用时间衰减算法：综合考虑重要性和时效性
        // 得分 = 重要性 * 时间衰减因子
        // 时间越久，衰减越大；这样既保护重要记忆，又避免旧的高重要性记忆占满空间
        const now = Date.now()
        memoriesArray.forEach(m => {
          const ageInDays = (now - m.timestamp) / (1000 * 60 * 60 * 24)
          // 时间衰减：每30天衰减10%，最低保留10%
          const timeDecay = Math.max(0.1, 1 - (ageInDays / 30) * 0.1)
          m.score = m.importance * timeDecay
        })

        // 按得分排序，删除得分最低的
        memoriesArray.sort((a, b) => a.score - b.score)
        const lowestScoreMemory = memoriesArray[0]
        await redis.hDel(userMemoryKey, lowestScoreMemory.id)
        // logger.info(`[Memory] 用户 ${userId} 记忆已满，删除得分最低的记忆 (重要性:${lowestScoreMemory.importance}, 时间:${Math.floor((now - lowestScoreMemory.timestamp) / (1000 * 60 * 60 * 24))}天, 得分:${lowestScoreMemory.score.toFixed(2)})`)
      }

      // 生成记忆ID并保存
      memory.id = Date.now().toString() + Math.random().toString(36).substring(2, 9)
      await redis.hSet(userMemoryKey, memory.id, JSON.stringify(memory))

      return {
        success: true,
        message: '记忆保存成功'
      }
    } catch (err) {
      logger.error('[Memory] 保存记忆失败:', err)
      return {
        success: false,
        message: err.message || '未知错误'
      }
    }
  }

  /**
   * 获取用户的记忆 (从Hash表读取)
   * @param {string} userId - 用户ID
   * @param {number} limit - 获取数量限制
   * @param {number} minImportance - 最低重要性过滤
   * @returns {Promise<Array>}
   */
  static async getUserMemories(userId, limit = 10, minImportance = 1) {
    try {
      const userMemoryKey = `CHATGPT:MEMORY:USER:${userId}`
      const memoriesHash = await redis.hGetAll(userMemoryKey)

      if (!memoriesHash || Object.keys(memoriesHash).length === 0) {
        return []
      }

      // 解析并转换为数组
      let memories = Object.values(memoriesHash).map(m => JSON.parse(m))

      // 按时间排序（新的在前）
      memories.sort((a, b) => b.timestamp - a.timestamp)

      // 过滤重要性并限制数量
      memories = memories
        .filter(m => m.importance >= minImportance)
        .slice(0, limit)

      return memories
    } catch (err) {
      logger.error('[Memory] 获取用户记忆失败:', err)
      return []
    }
  }

  static _normalizeMemoryText(text = '') {
    return String(text || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[，。！？、,.!?;:：；"'`~@#$%^&*()_\-+=\[\]{}<>]/g, '')
      .trim()
  }

  static _isDuplicateMemory(candidate, existingMemories = []) {
    if (!candidate || !candidate.content) return true
    const next = this._normalizeMemoryText(candidate.content)
    if (!next) return true
    return existingMemories.some(m => {
      if (!m || m.memoryType !== candidate.memoryType) return false
      const old = this._normalizeMemoryText(m.content)
      if (!old) return false
      return old === next || old.includes(next) || next.includes(old)
    })
  }

  static _extractMemoriesFromUserMessage(text = '') {
    const source = String(text || '').trim()
    if (!source) return []
    if (source.startsWith('#')) return []
    if (source.length < 6 || source.length > 220) return []

    const pushUnique = (arr, item) => {
      if (!item || !item.content) return
      const key = `${item.memoryType}:${this._normalizeMemoryText(item.content)}`
      if (!arr.some(x => `${x.memoryType}:${this._normalizeMemoryText(x.content)}` === key)) {
        arr.push(item)
      }
    }

    const result = []
    let m

    // 用户画像
    m = source.match(/(?:我叫|我是|本人是|我现在是)([^，。！？\n]{1,24})/)
    if (m?.[1]) {
      pushUnique(result, {
        memoryType: 'user_profile',
        content: `用户自述身份：${m[1].trim()}`,
        importance: 6,
        tags: ['身份']
      })
    }

    m = source.match(/(?:我在|我住在|我来自|来自)([^，。！？\n]{1,24})/)
    if (m?.[1]) {
      pushUnique(result, {
        memoryType: 'user_profile',
        content: `用户所在地：${m[1].trim()}`,
        importance: 5,
        tags: ['地区']
      })
    }

    // 偏好
    m = source.match(/(?:我喜欢|我最喜欢|我爱|我偏好)([^，。！？\n]{1,30})/)
    if (m?.[1]) {
      pushUnique(result, {
        memoryType: 'preference',
        content: `用户偏好：喜欢${m[1].trim()}`,
        importance: 5,
        tags: ['喜欢']
      })
    }

    m = source.match(/(?:我讨厌|我不喜欢)([^，。！？\n]{1,30})/)
    if (m?.[1]) {
      pushUnique(result, {
        memoryType: 'preference',
        content: `用户偏好：不喜欢${m[1].trim()}`,
        importance: 5,
        tags: ['不喜欢']
      })
    }

    // 情绪
    m = source.match(/我(?:今天|现在|最近)?(?:真的|有点|挺|很|太)?(开心|高兴|兴奋|难过|伤心|生气|烦|焦虑|崩溃|抑郁|委屈|紧张)/)
    if (m?.[1]) {
      pushUnique(result, {
        memoryType: 'emotional_memory',
        content: `用户当前情绪：${m[1].trim()}`,
        importance: 6,
        tags: ['情绪']
      })
    }

    // 事件/约定
    if (/(明天|后天|今晚|下周|周[一二三四五六日天]|\d{1,2}[点时分])/.test(source)
      && /(提醒|记得|要|约|安排|考试|面试|开会|上课|打卡|ddl|截止)/i.test(source)) {
      const snippet = source.length > 80 ? `${source.slice(0, 80)}...(truncated)` : source
      pushUnique(result, {
        memoryType: 'event',
        content: `用户提到待办/时间安排：${snippet}`,
        importance: 7,
        tags: ['待办', '时间']
      })
    }

    // 明确要求记住
    if (/(请记住|记一下|记住这件事|别忘了)/.test(source)) {
      const snippet = source.length > 80 ? `${source.slice(0, 80)}...(truncated)` : source
      pushUnique(result, {
        memoryType: 'event',
        content: `用户要求记住：${snippet}`,
        importance: 8,
        tags: ['用户要求']
      })
    }

    return result.slice(0, 2)
  }

  static async autoExtractAndSaveFromMessage(e, text = '') {
    try {
      if (!Config.enableMemory) {
        return { success: false, saved: 0, reason: 'memory_disabled' }
      }
      const userId = e?.user_id || e?.sender?.user_id
      if (!userId) {
        return { success: false, saved: 0, reason: 'missing_user_id' }
      }

      const cooldownKey = `CHATGPT:MEMORY:AUTO_COOLDOWN:${userId}`
      const inCooldown = await redis.get(cooldownKey)
      if (inCooldown) {
        return { success: true, saved: 0, reason: 'cooldown' }
      }

      const candidates = this._extractMemoriesFromUserMessage(text)
      if (!candidates.length) {
        return { success: true, saved: 0, reason: 'no_candidate' }
      }

      const existingMemories = await this.getUserMemories(userId, 100, 1)
      let saved = 0

      for (const candidate of candidates) {
        if (this._isDuplicateMemory(candidate, existingMemories)) continue
        const memory = {
          timestamp: Date.now(),
          date: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          userId,
          groupId: e?.group_id || null,
          isGroup: Boolean(e?.isGroup),
          userMsg: String(text || ''),
          userName: e?.sender?.card || e?.sender?.nickname || '未知',
          memoryType: candidate.memoryType,
          content: candidate.content,
          importance: candidate.importance,
          tags: Array.isArray(candidate.tags) ? candidate.tags : []
        }
        const saveRet = await this.saveMemory(memory)
        if (saveRet?.success) {
          saved++
          existingMemories.unshift(memory)
        }
      }

      if (saved > 0) {
        await redis.set(cooldownKey, '1', { EX: 90 })
      }
      return { success: true, saved, reason: saved > 0 ? 'saved' : 'all_duplicate' }
    } catch (err) {
      logger.error('[Memory] 自动提取记忆失败:', err)
      return { success: false, saved: 0, reason: err.message || 'unknown_error' }
    }
  }

  /**
   * 根据标签搜索记忆
   * @param {string} userId - 用户ID
   * @param {Array<string>} tags - 标签数组
   * @returns {Promise<Array>}
   */
  static async searchMemoriesByTags(userId, tags) {
    try {
      const memories = await this.getUserMemories(userId, 100, 1)
      return memories.filter(m =>
        m.tags && m.tags.some(tag => tags.includes(tag))
      )
    } catch (err) {
      logger.error('[Memory] 搜索记忆失败:', err)
      return []
    }
  }

  /**
   * 删除用户的某条记忆 (从Hash表删除)
   * @param {string} userId - 用户ID
   * @param {string} memoryId - 记忆ID
   * @returns {Promise<boolean>}
   */
  static async deleteMemory(userId, memoryId) {
    try {
      const userMemoryKey = `CHATGPT:MEMORY:USER:${userId}`
      const result = await redis.hDel(userMemoryKey, memoryId)
      return result > 0
    } catch (err) {
      logger.error('[Memory] 删除记忆失败:', err)
      return false
    }
  }

  /**
   * 清空用户的所有记忆
   * @param {string} userId - 用户ID
   * @returns {Promise<boolean>}
   */
  static async clearUserMemories(userId) {
    try {
      const userMemoryKey = `CHATGPT:MEMORY:USER:${userId}`
      await redis.del(userMemoryKey)
      return true
    } catch (err) {
      logger.error('[Memory] 清空用户记忆失败:', err)
      return false
    }
  }

  /**
   * 格式化记忆为提示词
   * @param {Array} memories - 记忆数组
   * @returns {string}
   */
  static formatMemoriesForPrompt(memories) {
    if (!memories || memories.length === 0) {
      return ''
    }

    const memoryTypeNames = {
      user_profile: '用户画像',
      scene_memory: '场景记忆',
      emotional_memory: '情感记忆',
      preference: '偏好',
      event: '事件'
    }

    let prompt = '\n\n【关于此用户的记忆】\n'
    prompt += '以下是你对这个用户的历史记忆，这些信息可以帮助你更好地理解用户并提供个性化的回复：\n'

    memories.forEach((memory, index) => {
      const typeLabel = memoryTypeNames[memory.memoryType] || memory.memoryType
      prompt += `${index + 1}. [${typeLabel}] ${memory.content}`
      if (memory.tags && memory.tags.length > 0) {
        prompt += ` (标签: ${memory.tags.join(', ')})`
      }
      prompt += ` [重要性: ${memory.importance}/10, 时间: ${memory.date}]\n`
    })

    prompt += '\n【重要提示】\n'
    prompt += '1. 请基于这些记忆信息，结合当前对话，给出更贴合用户特点的回复。\n'
    prompt += '2. 如果记忆内容与你的原始人设、角色设定或系统提示词产生冲突，请始终以原始人设为准，记忆信息仅作为补充参考。\n'
    prompt += '3. 如果对话中出现新的值得记忆的信息，可以考虑使用 save_memory 工具保存。\n'

    return prompt
  }

  /**
   * 获取记忆统计信息 (从Hash表统计)
   * @param {string} userId - 用户ID
   * @returns {Promise<Object>}
   */
  static async getMemoryStats(userId) {
    try {
      const userMemoryKey = `CHATGPT:MEMORY:USER:${userId}`
      const memoriesHash = await redis.hGetAll(userMemoryKey)

      if (!memoriesHash || Object.keys(memoriesHash).length === 0) {
        return {
          total: 0,
          byType: {},
          avgImportance: 0,
          highImportance: 0
        }
      }

      const memories = Object.values(memoriesHash).map(m => JSON.parse(m))

      const stats = {
        total: memories.length,
        byType: {},
        avgImportance: 0,
        highImportance: 0 // 重要性>=7的数量
      }

      let totalImportance = 0
      memories.forEach(m => {
        stats.byType[m.memoryType] = (stats.byType[m.memoryType] || 0) + 1
        totalImportance += m.importance
        if (m.importance >= 7) {
          stats.highImportance++
        }
      })

      stats.avgImportance = memories.length > 0
        ? (totalImportance / memories.length).toFixed(2)
        : 0

      return stats
    } catch (err) {
      logger.error('[Memory] 获取记忆统计失败:', err)
      return null
    }
  }
}
