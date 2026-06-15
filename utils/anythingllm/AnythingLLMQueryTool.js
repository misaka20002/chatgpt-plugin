import { AbstractTool } from '../tools/AbstractTool.js'
import { getAnythingLLMClient } from './client.js'
import { Config } from '../config.js'

/**
 * AnythingLLM 知识库查询工具
 * 在知识库中检索相关信息并返回结果
 */
export class AnythingLLMQueryTool extends AbstractTool {
  name = 'anythingllm_query'

  parameters = {
    properties: {
      query: {
        type: 'string',
        description: '要在知识库中查询的问题或关键词。应该是具体明确的问题，例如："原神中钟离的元素战技是什么"、"如何部署 Docker 容器"等'
      },
      workspace: {
        type: 'string',
        description: '要查询的工作区名称（可选）。如果不指定，将使用默认工作区。常用工作区：general-knowledge（通用知识）、genshin-impact（原神）、tech-docs（技术文档）等'
      }
    },
    required: ['query']
  }

  description = '在 AnythingLLM 知识库中检索相关信息。适用于查询专业知识、文档资料、常见问题、技术文档等场景。会返回最相关的知识库内容片段。'

  // 简单的内存缓存
  static cache = new Map()

  func = async function (opts, e) {
    const { query, workspace } = opts

    // 检查是否启用
    if (!Config.anythingllm_enable) {
      logger.debug('[AnythingLLM] 功能未启用')
      return 'AnythingLLM 知识库功能未启用。请在锅巴配置中启用并配置 API Key。'
    }

    // 检查 API Key
    if (!Config.anythingllm_apiKey) {
      logger.warn('[AnythingLLM] API Key 未配置')
      return 'AnythingLLM API Key 未配置。请在锅巴配置中填写 API Key。'
    }

    try {
      // 确定使用的工作区
      const targetWorkspace = workspace || Config.anythingllm_defaultWorkspace || 'general-knowledge'

      // 生成缓存键
      const cacheKey = `${targetWorkspace}:${query}`

      // 检查缓存
      if (Config.anythingllm_cacheEnable) {
        const cached = AnythingLLMQueryTool.cache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < Config.anythingllm_cacheTTL) {
          logger.info(`[AnythingLLM] 使用缓存结果: ${query}`)
          return cached.result
        }
      }

      logger.info(`[AnythingLLM] 查询知识库 - 工作区: ${targetWorkspace}, 问题: ${query}`)

      // 创建客户端并查询
      const client = getAnythingLLMClient()
      const mode = Config.anythingllm_mode || 'query'
      const result = await client.chat(targetWorkspace, query, mode, e?.user_id?.toString() || 'yunzai-bot')

      // 处理错误
      if (result.error) {
        logger.error(`[AnythingLLM] 查询返回错误: ${result.error}`)
        return `知识库查询失败: ${result.error}`
      }

      // 构建返回结果
      let response = result.textResponse || result.response || ''

      // 如果没有找到结果
      if (!response || response.trim() === '') {
        logger.warn(`[AnythingLLM] 未找到相关信息: ${query}`)
        return `知识库中未找到与 "${query}" 相关的信息。您可以尝试：\n1. 换个关键词重新提问\n2. 检查是否选择了正确的工作区\n3. 确认相关文档已上传到知识库`
      }

      // 添加引用来源
      if (Config.anythingllm_includeSources && result.sources && result.sources.length > 0) {
        response += '\n\n📚 参考来源：'
        const uniqueSources = new Set()

        result.sources.forEach(source => {
          const title = source.title || source.name || '未知文档'
          if (!uniqueSources.has(title)) {
            uniqueSources.add(title)
          }
        })

        uniqueSources.forEach((title, idx) => {
          response += `\n${idx + 1}. ${title}`
        })
      }

      // 保存到缓存
      if (Config.anythingllm_cacheEnable) {
        AnythingLLMQueryTool.cache.set(cacheKey, {
          result: response,
          timestamp: Date.now()
        })

        // 清理过期缓存（简单的 LRU）
        if (AnythingLLMQueryTool.cache.size > 100) {
          const firstKey = AnythingLLMQueryTool.cache.keys().next().value
          AnythingLLMQueryTool.cache.delete(firstKey)
        }
      }

      logger.info(`[AnythingLLM] 查询成功，返回 ${response.length} 字符`)
      return response
    } catch (error) {
      logger.error('[AnythingLLM] 查询过程出错:', error)

      // 友好的错误提示
      let errorMessage = '知识库查询失败'

      if (error.message.includes('无法连接')) {
        errorMessage += '：无法连接到 AnythingLLM 服务，请检查服务是否正常运行'
      } else if (error.message.includes('API Key')) {
        errorMessage += '：API Key 无效或未授权，请检查配置'
      } else if (error.message.includes('未找到')) {
        errorMessage += `：工作区 "${workspace || Config.anythingllm_defaultWorkspace}" 不存在，请检查配置`
      } else if (error.message.includes('超时')) {
        errorMessage += '：请求超时，请稍后重试或增加超时时间'
      } else {
        errorMessage += `：${error.message}`
      }

      return errorMessage
    }
  }
}
