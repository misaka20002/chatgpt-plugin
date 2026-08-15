/**
 * 托管内置工具（provider-hosted / server tools）统一定义。
 *
 * 这些工具由 OpenAI / Anthropic 在服务端执行，插件只需要把工具定义放进请求体，
 * 不需要像普通 AbstractTool 一样在本地下发并执行。
 *
 * 参考 opencode 源码：
 *  - packages/llm/src/protocols/openai-responses.ts  HOSTED_TOOLS
 *  - packages/llm/src/protocols/anthropic-messages.ts SERVER_TOOL_RESULT_NAMES
 *  - packages/core/src/github-copilot/responses/openai-responses-prepare-tools.ts
 *  - packages/core/src/github-copilot/responses/openai-responses-api-types.ts
 */
import { Config } from './config.js'

const OPENAI_RESPONSES_HOST = 'api.openai.com'
const ANTHROPIC_HOST = 'api.anthropic.com'

/** 是否为 OpenAI 官方 Responses API 端点（用于 OpenAI 官方专属托管能力判断） */
export function isOfficialResponsesEndpoint (baseUrl = '') {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === OPENAI_RESPONSES_HOST
  } catch {
    return false
  }
}

/** 是否为官方 Anthropic Messages API 端点 */
export function isOfficialAnthropicEndpoint (baseUrl = '') {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === ANTHROPIC_HOST
  } catch {
    return false
  }
}

const normalizeClaudeModel = (model = '') => String(model || '').trim().toLowerCase()

/** Claude 4 / 5 系列模型（支持服务端托管工具的基础门槛） */
export function isClaudeServerToolModel (model = '') {
  const m = normalizeClaudeModel(model)
  return /^claude-(opus|sonnet|haiku)-4/.test(m) ||
    /^claude-(opus|sonnet|fable|mythos)-5/.test(m) ||
    m.startsWith('claude-mythos-preview')
}

/** 支持 20260209 动态过滤版 web_search / web_fetch 的模型（Claude 4.6+ / 5 系列） */
export function isClaudeDynamicFilteringModel (model = '') {
  const m = normalizeClaudeModel(model)
  return /^claude-(opus|sonnet|fable|mythos)-5/.test(m) ||
    /^claude-(opus|sonnet)-4-(6|7|8)/.test(m) ||
    m.startsWith('claude-mythos-preview')
}

/** 兼容旧名称：Anthropic 托管搜索要求 Claude 4 系列模型 */
export const isClaudeWebSearchModel = isClaudeServerToolModel

const openAIBaseStatus = (config = Config) => {
  if (!config.responsesApiKey) {
    return {
      available: false,
      reason: '未配置 Responses API Key（responsesApiKey）'
    }
  }
  return null
}

/** 非官方端点只是提示，不阻断；是否支持以服务商实际返回为准 */
const openAIEndpointNote = (config = Config) => {
  return isOfficialResponsesEndpoint(config.responsesApiBaseUrl)
    ? ''
    : `；注意当前端点（${config.responsesApiBaseUrl || '未设置'}）不是官方 api.openai.com，托管工具是否可用以该服务商实际实现为准`
}

/**
 * OpenAI 官方专属托管能力（file_search / code_interpreter / image_generation）
 * 只确认官方端点支持；非官方端点不自动注入，避免整个 Responses 请求因不支持的
 * tools 直接 400。web_search 不做这个门控，按服务商实际支持发送。
 */
const openAIOfficialHostedStatus = (config = Config, toolName = '') => {
  if (isOfficialResponsesEndpoint(config.responsesApiBaseUrl)) return null
  return {
    available: false,
    reason: `${toolName} 是 OpenAI 官方专属托管能力，当前端点（${config.responsesApiBaseUrl || '未设置'}）非官方 api.openai.com，未确认支持，故不自动注入（联网搜索 web_search 不受此限制）`
  }
}

const claudeBaseStatus = (config = Config) => {
  if (!config.claudeApiKey) {
    return {
      available: false,
      reason: '未配置 Claude API Key（claudeApiKey）'
    }
  }
  if (!isClaudeServerToolModel(config.claudeApiModel)) {
    const model = config.claudeApiModel || '未设置（默认 claude-3-sonnet-20240229）'
    return {
      available: false,
      reason: `当前 Claude 模型 ${model} 不支持托管工具，需要 Claude 4 / 5 系列模型`
    }
  }
  return null
}

const claudeEndpointNote = (config = Config) => {
  return isOfficialAnthropicEndpoint(config.claudeApiBaseUrl)
    ? ''
    : `；注意当前反代（${config.claudeApiBaseUrl}）需支持 Anthropic server tool`
}

const normalizeVectorStoreIds = (config = Config) => {
  const raw = config.responsesFileSearchVectorStoreIds
  const list = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' ? raw.split(/[,，]/) : [])
  return list.map(id => String(id).trim()).filter(Boolean)
}

export const HOSTED_BUILTIN_TOOLS = [
  {
    id: 'openai_responses_web_search',
    provider: 'responses',
    providerLabel: 'OpenAI Responses API',
    name: 'web_search',
    toolType: 'web_search',
    requestTool: Object.freeze({
      type: 'web_search'
    }),
    getStatus (config = Config) {
      const base = openAIBaseStatus(config)
      if (base) return base
      return {
        available: true,
        reason: '可用。将随请求携带 { type: "web_search" }，由服务端执行联网搜索（模型需支持内置搜索）' + openAIEndpointNote(config)
      }
    }
  },
  {
    id: 'openai_responses_file_search',
    provider: 'responses',
    providerLabel: 'OpenAI Responses API',
    name: 'file_search',
    toolType: 'file_search',
    buildRequestTool (config = Config) {
      const vectorStoreIds = normalizeVectorStoreIds(config)
      const maxNumResults = Number(config.responsesFileSearchMaxNumResults)
      return {
        type: 'file_search',
        vector_store_ids: vectorStoreIds,
        ...(Number.isInteger(maxNumResults) && maxNumResults >= 1 && maxNumResults <= 50
          ? { max_num_results: maxNumResults }
          : {})
      }
    },
    getStatus (config = Config) {
      const base = openAIBaseStatus(config)
      if (base) return base
      const official = openAIOfficialHostedStatus(config, 'file_search')
      if (official) return official
      const vectorStoreIds = normalizeVectorStoreIds(config)
      if (vectorStoreIds.length === 0) {
        return {
          available: false,
          reason: '未配置 Responses 文件搜索向量库 ID（responsesFileSearchVectorStoreIds），需要在 OpenAI 创建 Vector Store 后填入'
        }
      }
      return {
        available: true,
        reason: `可用。将随请求携带 { type: "file_search", vector_store_ids: [${vectorStoreIds.join(', ')}] }，由服务端检索已上传文件`
      }
    }
  },
  {
    id: 'openai_responses_code_interpreter',
    provider: 'responses',
    providerLabel: 'OpenAI Responses API',
    name: 'code_interpreter',
    toolType: 'code_interpreter',
    requestTool: Object.freeze({
      type: 'code_interpreter',
      container: { type: 'auto' }
    }),
    getStatus (config = Config) {
      const base = openAIBaseStatus(config)
      if (base) return base
      const official = openAIOfficialHostedStatus(config, 'code_interpreter')
      if (official) return official
      return {
        available: true,
        reason: '可用。将随请求携带 { type: "code_interpreter", container: { type: "auto" } }，由服务端沙箱执行 Python 代码'
      }
    }
  },
  {
    id: 'openai_responses_image_generation',
    provider: 'responses',
    providerLabel: 'OpenAI Responses API',
    name: 'image_generation',
    toolType: 'image_generation',
    requestTool: Object.freeze({
      type: 'image_generation'
    }),
    getStatus (config = Config) {
      const base = openAIBaseStatus(config)
      if (base) return base
      const official = openAIOfficialHostedStatus(config, 'image_generation')
      if (official) return official
      return {
        available: true,
        reason: '可用。将随请求携带 { type: "image_generation" }，由服务端生成图像（结果在 image_generation_call item 的 result 字段中）'
      }
    }
  },
  {
    id: 'claude_web_search',
    provider: 'claude',
    providerLabel: 'Claude API',
    name: 'web_search',
    toolType: 'web_search_20260209 / web_search_20250305',
    maxUses: 5,
    buildRequestTool (config = Config) {
      const dynamic = isClaudeDynamicFilteringModel(config.claudeApiModel)
      return {
        type: dynamic ? 'web_search_20260209' : 'web_search_20250305',
        name: 'web_search',
        max_uses: 5,
        // 标记为托管工具，ClaudeAPIClient._toClaudeTool 会直接透传该定义
        hosted: true
      }
    },
    getStatus (config = Config) {
      const base = claudeBaseStatus(config)
      if (base) return base
      const dynamic = isClaudeDynamicFilteringModel(config.claudeApiModel)
      const type = dynamic ? 'web_search_20260209' : 'web_search_20250305'
      return {
        available: true,
        reason: `可用。将随请求携带 { type: "${type}", name: "web_search", max_uses: 5 }，由 Anthropic 服务端执行联网搜索${claudeEndpointNote(config)}`
      }
    }
  },
  {
    id: 'claude_web_fetch',
    provider: 'claude',
    providerLabel: 'Claude API',
    name: 'web_fetch',
    toolType: 'web_fetch_20260209 / web_fetch_20250910',
    maxUses: 5,
    buildRequestTool (config = Config) {
      const dynamic = isClaudeDynamicFilteringModel(config.claudeApiModel)
      return {
        type: dynamic ? 'web_fetch_20260209' : 'web_fetch_20250910',
        name: 'web_fetch',
        max_uses: 5,
        hosted: true
      }
    },
    getStatus (config = Config) {
      const base = claudeBaseStatus(config)
      if (base) return base
      const dynamic = isClaudeDynamicFilteringModel(config.claudeApiModel)
      const type = dynamic ? 'web_fetch_20260209' : 'web_fetch_20250910'
      return {
        available: true,
        reason: `可用。将随请求携带 { type: "${type}", name: "web_fetch", max_uses: 5 }，由 Anthropic 服务端抓取对话中已出现的 URL（不能由模型自行构造 URL）${claudeEndpointNote(config)}`
      }
    }
  },
  {
    id: 'claude_code_execution',
    provider: 'claude',
    providerLabel: 'Claude API',
    name: 'code_execution',
    toolType: 'code_execution_20260521',
    // 按 Anthropic 官方建议：web_search_20260209 / web_fetch_20260209 的动态过滤
    // 会自动使用代码执行，不要在 tools 里再单独声明 code_execution。
    skipRequest: true,
    requestTool: Object.freeze({
      type: 'code_execution_20260521',
      name: 'code_execution',
      hosted: true
    }),
    getStatus (config = Config) {
      const base = claudeBaseStatus(config)
      if (base) return base
      const dynamic = isClaudeDynamicFilteringModel(config.claudeApiModel)
      if (dynamic) {
        return {
          available: true,
          reason: '按官方建议不单独声明。web_search_20260209 / web_fetch_20260209 动态过滤会自动使用代码执行，无需在请求中单独发送 code_execution'
        }
      }
      return {
        available: false,
        reason: '按官方建议不单独声明。当前模型使用基础版 web_search / web_fetch，不会自动获得代码执行能力，因此 code_execution 不会生效'
      }
    }
  }
]

/**
 * 获取某个接口当前实际会随请求发送的托管内置工具。
 * 返回的对象已经带上对应配置计算好的 requestTool。
 * @param {'responses'|'claude'} provider
 * @param config 默认使用全局 Config
 */
export function getEnabledHostedBuiltinTools (provider, config = Config) {
  if (config.enableHostedBuiltinTools !== true) return []
  return HOSTED_BUILTIN_TOOLS
    .filter(tool => tool.provider === provider && tool.skipRequest !== true && tool.getStatus(config).available)
    .map(tool => ({
      ...tool,
      requestTool: tool.buildRequestTool ? tool.buildRequestTool(config) : tool.requestTool
    }))
}

/**
 * 获取用于“1 次 API 调用实际探测”的候选托管工具。
 * 与静态可用性判断无关：只要属于纯托管工具就放入探测请求，
 * file_search 需要真实 vector store id 才探测，code_execution 按官方建议不单独声明。
 * @param {'responses'|'claude'} provider
 * @param config 默认使用全局 Config
 */
export function getHostedToolProbeCandidates (provider, config = Config) {
  if (provider !== 'responses' && provider !== 'claude') return []
  return HOSTED_BUILTIN_TOOLS
    .filter(tool => tool.provider === provider && tool.skipRequest !== true)
    .filter(tool => tool.id !== 'openai_responses_file_search' || normalizeVectorStoreIds(config).length > 0)
    .map(tool => ({
      name: tool.name,
      requestTool: tool.buildRequestTool ? tool.buildRequestTool(config) : tool.requestTool
    }))
}

/** 生成管理指令用到的托管内置工具检查报告 */
export function getHostedBuiltinToolReport (config = Config) {
  return {
    enabled: config.enableHostedBuiltinTools === true,
    items: HOSTED_BUILTIN_TOOLS.map(tool => ({
      id: tool.id,
      provider: tool.provider,
      providerLabel: tool.providerLabel,
      name: tool.name,
      toolType: tool.toolType,
      skipRequest: tool.skipRequest === true,
      status: tool.getStatus(config)
    }))
  }
}
