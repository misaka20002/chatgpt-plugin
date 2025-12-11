import { Config } from './config.js'

/**
 * 用户记忆管理模块
 * 用于存储和检索AI的用户记忆
 */
export class UserMemory {
  /**
   * 保存记忆到Redis
   * @param {Object} memory - 记忆对象
   * @returns {Promise<{success: boolean, message: string}>}
   */
  static async saveMemory(memory) {
    try {
      const { userId } = memory

      // 检查个人记忆数量限制
      const userMemoryKey = `CHATGPT:MEMORY:USER:${userId}`
      let userMemories = await redis.get(userMemoryKey)
      userMemories = userMemories ? JSON.parse(userMemories) : []

      // 检查是否超过个人记忆限制
      if (userMemories.length >= Config.maxMemoriesPerUser) {
        // 删除最不重要的记忆（重要性最低且时间最早） // 修改了，现在仅考虑时间 不考虑重要性了
        userMemories.sort((a, b) => {
          // if (a.importance !== b.importance) {
          //   return a.importance - b.importance
          // }
          return a.timestamp - b.timestamp
        })
        userMemories.shift() // 移除第一个（最不重要的）
        logger.info(`[Memory] 用户 ${userId} 记忆已满，删除最不重要的记忆`)
      }

      // 添加新记忆
      memory.id = Date.now().toString() + Math.random().toString(36).substring(2, 9)
      userMemories.push(memory)

      // 按重要性和时间排序（重要性高的在前，时间新的在前） // 修改了，现在仅考虑时间 不考虑重要性了
      userMemories.sort((a, b) => {
        // if (b.importance !== a.importance) {
        //   return b.importance - a.importance
        // }
        return b.timestamp - a.timestamp
      })

      // 保存用户记忆
      await redis.set(userMemoryKey, JSON.stringify(userMemories))

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
   * 获取用户的记忆
   * @param {string} userId - 用户ID
   * @param {number} limit - 获取数量限制
   * @param {number} minImportance - 最低重要性过滤
   * @returns {Promise<Array>}
   */
  static async getUserMemories(userId, limit = 10, minImportance = 1) {
    try {
      const userMemoryKey = `CHATGPT:MEMORY:USER:${userId}`
      let memories = await redis.get(userMemoryKey)
      memories = memories ? JSON.parse(memories) : []

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
   * 删除用户的某条记忆
   * @param {string} userId - 用户ID
   * @param {string} memoryId - 记忆ID
   * @returns {Promise<boolean>}
   */
  static async deleteMemory(userId, memoryId) {
    try {
      const userMemoryKey = `CHATGPT:MEMORY:USER:${userId}`
      let memories = await redis.get(userMemoryKey)
      memories = memories ? JSON.parse(memories) : []

      const originalLength = memories.length
      memories = memories.filter(m => m.id !== memoryId)

      if (memories.length < originalLength) {
        await redis.set(userMemoryKey, JSON.stringify(memories))
        return true
      }
      return false
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

    prompt += '\n请基于这些记忆信息，结合当前对话，给出更贴合用户特点的回复。如果对话中出现新的值得记忆的信息，可以考虑使用 save_memory 工具保存。\n'

    return prompt
  }

  /**
   * 获取记忆统计信息
   * @param {string} userId - 用户ID
   * @returns {Promise<Object>}
   */
  static async getMemoryStats(userId) {
    try {
      const memories = await this.getUserMemories(userId, 1000, 0)

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