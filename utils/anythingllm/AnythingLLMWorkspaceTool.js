import { AbstractTool } from '../tools/AbstractTool.js'
import { getAnythingLLMClient } from './client.js'
import { Config } from '../config.js'

/**
 * AnythingLLM 工作区管理工具
 * 用于列出、查看工作区信息
 */
export class AnythingLLMWorkspaceTool extends AbstractTool {
  name = 'anythingllm_workspace'

  parameters = {
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'info'],
        description: '操作类型：list（列出所有工作区）、info（查看指定工作区详情）'
      },
      workspace: {
        type: 'string',
        description: '工作区名称（action 为 info 时必填）'
      }
    },
    required: ['action']
  }

  description = '管理 AnythingLLM 工作区。可以列出所有可用工作区、查看工作区详细信息（包含文档数量等）。'

  func = async function (opts, e) {
    const { action, workspace } = opts

    // 检查是否启用
    if (!Config.anythingllm_enable) {
      return 'AnythingLLM 知识库功能未启用'
    }

    if (!Config.anythingllm_apiKey) {
      return 'AnythingLLM API Key 未配置'
    }

    try {
      const client = getAnythingLLMClient()

      switch (action) {
        case 'list': {
          logger.info('[AnythingLLM] 获取工作区列表')
          const workspaces = await client.listWorkspaces()

          if (!workspaces || workspaces.length === 0) {
            return '当前没有可用的工作区。请先在 AnythingLLM 管理界面中创建工作区。'
          }

          let response = '📚 可用的知识库工作区：\n\n'
          workspaces.forEach((ws, idx) => {
            response += `${idx + 1}. ${ws.name || ws.slug}\n`
            response += `   标识：${ws.slug}\n`
            if (ws.description) {
              response += `   描述：${ws.description}\n`
            }
            response += '\n'
          })

          response += `\n💡 提示：在查询时可以指定工作区，例如指定使用 "${workspaces[0].slug}" 工作区`

          return response
        }

        case 'info': {
          if (!workspace) {
            return 'info 操作需要指定工作区名称'
          }

          logger.info(`[AnythingLLM] 获取工作区信息: ${workspace}`)
          const wsInfo = await client.getWorkspace(workspace)
          const documents = await client.getWorkspaceDocuments(workspace)

          let response = `📚 工作区信息：${wsInfo.name || workspace}\n\n`
          response += `标识：${wsInfo.slug || workspace}\n`

          if (wsInfo.description) {
            response += `描述：${wsInfo.description}\n`
          }

          response += `文档数量：${documents.length} 个\n`

          if (documents.length > 0) {
            response += '\n📄 最近的文档：\n'
            documents.slice(0, 5).forEach((doc, idx) => {
              response += `${idx + 1}. ${doc.name || doc.title}\n`
            })

            if (documents.length > 5) {
              response += `... 还有 ${documents.length - 5} 个文档\n`
            }
          }

          return response
        }

        default:
          return `不支持的操作: ${action}`
      }
    } catch (error) {
      logger.error('[AnythingLLM] 工作区管理操作失败:', error)
      return `操作失败: ${error.message}`
    }
  }
}
