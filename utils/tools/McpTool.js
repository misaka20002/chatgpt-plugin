import { AbstractTool } from './AbstractTool.js'

export class McpTool extends AbstractTool {
  constructor(serverName, client, mcpTool) {
    super()
    this.serverName = serverName
    this.client = client
    this.name = mcpTool.name
    this.description = mcpTool.description
    this.parameters = mcpTool.inputSchema || { type: 'object', properties: {}, required: [] }
  }

  func = async (args) => {
    try {
      logger.info(`[MCP][${this.serverName}] 正在调用工具 ${this.name}，参数: ${JSON.stringify(args)}`)
      const response = await this.client.callTool({
        name: this.name,
        arguments: args
      })
      if (response && response.content) {
        // 合并文本类型的内容返回
        return response.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n')
      }
      return JSON.stringify(response)
    } catch (err) {
      logger.error(`[MCP][${this.serverName}] 工具 ${this.name} 调用失败: ${err.message}`)
      return `Error calling MCP tool ${this.name}: ${err.message}`
    }
  }
}
