import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Config } from './config.js'
import { McpTool } from './tools/McpTool.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');

class McpManager {
  clients = new Map()       // serverName -> Client instance
  transports = new Map()    // serverName -> Transport instance
  tools = []                // Array of McpTool instances
  initialized = false

  async init() {
    if (!Config.enableMcp) {
      return
    }
    if (this.initialized) {
      return
    }

    logger.info('[Chatgpt][mcp] 正在初始化通用 MCP 客户端管理器...')

    let servers = {}
    try {
      const parsed = JSON.parse(Config.mcpServers || '{}')
      if (parsed && typeof parsed === 'object') {
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          servers = parsed.mcpServers
        } else {
          servers = parsed
        }
      }
    } catch (e) {
      logger.error(`[Chatgpt][mcp] 解析 mcpServers 配置文件 JSON 失败: ${e.message}。请检查锅巴面板中的配置格式。`)
      return
    }

    for (const [name, serverConfig] of Object.entries(servers)) {
      if (!serverConfig || typeof serverConfig !== 'object') {
        continue
      }

      // 支持在单条 MCP 配置中写 "enabled": false 随时单独关闭
      if (serverConfig.enabled === false) {
        logger.info(`[Chatgpt][mcp] 服务器 [${name}] 已被配置单独关闭，跳过启动`)
        continue
      }

      logger.info(`[Chatgpt][mcp] 正在连接 MCP 服务器 [${name}]...`)
      try {
        const client = new Client(
          { name: 'chatgpt-plugin-mcp-client', version: Config.version || '1.0.0' },
          { capabilities: {} }
        )

        let transport
        const configuredType = typeof serverConfig.type === 'string' ? serverConfig.type.toLowerCase() : ''
        const transportType = configuredType || (serverConfig.url ? 'sse' : (serverConfig.command ? 'stdio' : ''))

        if (!['stdio', 'http', 'sse'].includes(transportType)) {
          logger.warn(`[Chatgpt][mcp] 服务器 [${name}] 配置类型无效: ${serverConfig.type}`)
          continue
        }

        if (transportType === 'http') {
          if (!serverConfig.url) {
            logger.warn(`[Chatgpt][mcp] 服务器 [${name}] Streamable HTTP 配置无效，必须包含 url`)
            continue
          }
          logger.info(`[Chatgpt][mcp] 服务器 [${name}] 使用 Streamable HTTP 协议，连接地址: ${serverConfig.url}`)
          transport = new StreamableHTTPClientTransport(new URL(serverConfig.url))
        } else if (transportType === 'sse') {
          if (!serverConfig.url) {
            logger.warn(`[Chatgpt][mcp] 服务器 [${name}] SSE 配置无效，必须包含 url`)
            continue
          }
          logger.info(`[Chatgpt][mcp] 服务器 [${name}] 使用 SSE 协议，连接地址: ${serverConfig.url}`)
          transport = new SSEClientTransport(new URL(serverConfig.url))
        } else if (transportType === 'stdio') {
          if (!serverConfig.command) {
            logger.warn(`[Chatgpt][mcp] 服务器 [${name}] Stdio 配置无效，必须包含 command`)
            continue
          }
          // 兼容 Windows 和 Ubuntu：在 Linux (非 win32) 平台下，将 'python' 自动映射为 'python3'
          let execCommand = serverConfig.command
          if (execCommand === 'python' && process.platform !== 'win32') {
            execCommand = 'python3'
          }

          // 路径兼容处理：自动将 args 中的相对路径（以 ./ 或 ../ 开头，或者相对路径）解析为基于插件根目录的绝对路径
          const resolvedArgs = (serverConfig.args || []).map(arg => {
            if (typeof arg === 'string') {
              if (arg.startsWith('./') || arg.startsWith('../') || (!path.isAbsolute(arg) && (arg.endsWith('.py') || arg.endsWith('.js') || arg.includes('/') || arg.includes('\\')))) {
                return path.resolve(pluginRoot, arg)
              }
            }
            return arg
          })

          // Stdio 本地子进程模式
          logger.info(`[Chatgpt][mcp] 服务器 [${name}] 使用 Stdio 协议，执行命令: ${execCommand}，参数: ${JSON.stringify(resolvedArgs)}`)
          transport = new StdioClientTransport({
            command: execCommand,
            args: resolvedArgs,
            env: {
              ...process.env,
              ...(serverConfig.env || {})
            }
          })
        }

        await client.connect(transport)
        this.clients.set(name, client)
        this.transports.set(name, transport)

        // 连接成功后拉取工具列表
        const toolsResult = await client.listTools()
        let loadedCount = 0
        if (toolsResult && Array.isArray(toolsResult.tools)) {
          for (const t of toolsResult.tools) {
            const mcpTool = new McpTool(name, client, t)
            this.tools.push(mcpTool)
            loadedCount++
          }
        }

        logger.info(`[Chatgpt][mcp] 服务器 [${name}] 连接成功！加载了 ${loadedCount} 个工具。`)
      } catch (err) {
        logger.error(`[Chatgpt][mcp] 服务器 [${name}] 初始化连接失败: ${err.message}`)
      }
    }

    this.initialized = true
    logger.info(`[Chatgpt][mcp] 通用 MCP 客户端管理器初始化完成，共成功加载了 ${this.tools.length} 个 MCP 工具！`)
  }

  getTools() {
    return this.tools
  }

  async destroy() {
    logger.info('[Chatgpt][mcp] 正在销毁所有 MCP 客户端连接...')
    for (const [name, client] of this.clients) {
      try {
        await client.close()
        logger.info(`[Chatgpt][mcp] 服务器 [${name}] 连接已安全关闭`)
      } catch (e) {
        logger.error(`[Chatgpt][mcp] 关闭服务器 [${name}] 失败: ${e.message}`)
      }
    }
    this.clients.clear()
    this.transports.clear()
    this.tools = []
    this.initialized = false
  }
}

export default new McpManager()
