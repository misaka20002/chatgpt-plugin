import { AbstractTool } from './AbstractTool.js'
import { UserMemory } from '../userMemory.js'

/**
 * Tool: AI记忆工具
 * 允许AI在合适的时候主动记忆重要信息，用于构建更好的用户画像和对话体验
 */
export class MemoryTool extends AbstractTool {
  name = 'Memory_Tool'

  parameters = {
    properties: {
      memoryType: {
        type: 'string',
        enum: ['user_profile', 'scene_memory', 'emotional_memory', 'preference', 'event'],
        description: '记忆类型：user_profile(用户画像，如用户的性格、职业、兴趣爱好等基本信息), scene_memory(场景记忆，如重要的对话场景、事件背景), emotional_memory(情感记忆，如用户的情绪状态、情感倾向), preference(偏好记忆，如用户喜欢的东西、习惯), event(事件记忆，如重要的发生的事情、约定等)'
      },
      content: {
        type: 'string',
        description: '记忆内容：你对这次对话的理解和总结，需要精炼概括，保留关键信息。例如：用户喜欢玩原神，经常抽卡；用户今天心情不好，因为考试没考好；用户约定明天8点叫醒他等'
      },
      importance: {
        type: 'number',
        description: '重要性等级（1-10）：评估这条记忆的重要程度，10为最重要（如用户的核心信息、重要约定），1为一般信息',
        minimum: 1,
        maximum: 10
      },
      tags: {
        type: 'string',
        description: '标签：用逗号分隔的关键词，便于快速检索。例如：原神,游戏,爱好 或 考试,情绪,学习'
      }
    },
    required: ['memoryType', 'content', 'importance']
  }

  description = '保存重要的记忆信息。当对话中出现以下情况时应该调用此工具：1.用户透露个人信息（如姓名、职业、爱好、性格特点）；2.用户表达强烈的情感或情绪；3.重要的事件或约定；4.用户的喜好和偏好；5.值得记住的对话场景或上下文。注意：不要记忆过于琐碎的信息，专注于对未来对话有帮助的内容。'

  func = async function (opts, e) {
    const { memoryType, content, importance, tags } = opts

    if (!memoryType || !content || !importance) {
      return 'Error: 记忆类型、内容和重要性等级都是必需的'
    }

    if (importance < 1 || importance > 10) {
      return 'Error: 重要性等级必须在1-10之间'
    }

    try {
      // 构建记忆对象
      const memory = {
        timestamp: Date.now(),
        date: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        userId: e.user_id,
        groupId: e.group_id || null,
        isGroup: e.isGroup,
        userMsg: e.msg || '',
        userName: e.sender?.card || e.sender?.nickname || '未知',
        memoryType,
        content,
        importance,
        tags: tags ? tags.split(/[,，]/).map(t => t.trim()).filter(t => t) : []
      }

      // 保存记忆
      const result = await UserMemory.saveMemory(memory)

      if (result.success) {
        logger.info(`[Memory] 成功保存记忆 - 用户:${e.user_id}, 类型:${memoryType}, 重要性:${importance}`)
        return `Memory saved successfully. This memory has been recorded and will help in future conversations.`
      } else {
        logger.warn(`[Memory] 保存记忆失败: ${result.message}`)
        return `Failed to save memory: ${result.message}`
      }
    } catch (err) {
      logger.error('[Memory] 保存记忆时出错:', err)
      return `Error saving memory: ${err.message}`
    }
  }
}

