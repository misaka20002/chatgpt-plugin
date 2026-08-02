import { Config } from '../utils/config.js'
import { ChatGPTAPI } from '../utils/openai/chatgpt-api.js'
import { CustomGoogleGeminiClient } from '../client/CustomGoogleGeminiClient.js'
import { ClaudeAPIClient } from '../client/ClaudeAPIClient.js'
import { QwenApi } from '../utils/alibaba/qwen-api.js'
import XinghuoClient from '../utils/xinghuo/xinghuo.js'
import { ChatGLM4Client } from '../client/ChatGLM4Client.js'
import { newFetch } from '../utils/proxy.js'
import { ResponsesAPI } from '../utils/openai/responses-api.js'
import { AbstractTool } from '../utils/tools/AbstractTool.js'
import { v4 as uuid } from 'uuid'

const SUPPORTED_PROVIDERS = ['openai', 'responses', 'gemini', 'claude', 'qwen', 'xh', 'chatglm4']

/**
 * 将 chat.js 中的 use 值映射为 SubLLM 支持的 provider
 * SubLLM 支持: openai, responses, gemini, claude, qwen, xh, chatglm4
 *
 * @param {string} use  chat.js 中的 use 值 (api/api3/bing/azure/responses/claude/claude2/gemini/qwen/xh/chatglm/chatglm4)
 * @returns {string} SubLLM 支持的 provider
 */
export function useToProvider(use) {
  const mapping = {
    api: 'openai',
    api3: 'openai',
    bing: 'openai',
    azure: 'openai',
    responses: 'responses',
    claude: 'claude',
    claude2: 'claude',
    gemini: 'gemini',
    qwen: 'qwen',
    xh: 'xh',
    chatglm: 'chatglm4',
    chatglm4: 'chatglm4',
  }
  return mapping[use] || 'openai'
}

/**
 * 子LLM调用器 —— 主LLM可以通过它调用另一个LLM完成子任务
 *
 * @example
 * // 基本用法
 * const subLLM = new SubLLM({ provider: 'openai', model: 'gpt-4o-mini', systemPrompt: '你是一个翻译助手' })
 * const result = await subLLM.chat('把这句话翻译成英文：你好世界')
 * console.log(result.text) // "Hello World"
 *
 * @example
 * // 作为Tool被主LLM调用
 * import { SubLLMTool } from '../model/SubLLM.js'
 * // 在 collectTools 中加入 new SubLLMTool() 即可
 */
export class SubLLM {
  /**
   * @param {object} options
   * @param {'openai'|'responses'|'gemini'|'claude'|'qwen'|'xh'|'chatglm4'|'api'|'api3'|'bing'|'azure'|'claude2'|'chatglm'} options.provider  LLM来源，也支持传入 use 值自动映射，默认 openai
   * @param {string}  [options.model]           模型名，留空则用各provider的默认值
   * @param {string}  [options.systemPrompt]    系统提示词
   * @param {string}  [options.apiKey]          API Key，留空则用全局Config
   * @param {string}  [options.apiBaseUrl]      API BaseUrl，留空则用全局Config
   * @param {number}  [options.temperature]     温度
   * @param {number}  [options.maxTokens]       最大输出token
   * @param {number}  [options.timeoutMs]       超时毫秒，默认 120000
   * @param {boolean} [options.debug]           调试模式
   */
  constructor(options = {}) {
    // 支持直接传入 use 值（如 api/claude2/gemini 等），自动映射为 provider
    let provider = options.provider || 'openai'
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      provider = useToProvider(provider)
    }
    this.provider = provider
    if (!SUPPORTED_PROVIDERS.includes(this.provider)) {
      throw new Error(`SubLLM: 不支持的provider "${this.provider}"，当前支持: ${SUPPORTED_PROVIDERS.join(', ')}`)
    }
    this.model = options.model || ''
    this.systemPrompt = options.systemPrompt || ''
    this.apiKey = options.apiKey || ''
    this.apiBaseUrl = options.apiBaseUrl || ''
    this.temperature = options.temperature ?? undefined
    this.maxTokens = options.maxTokens ?? undefined
    this.timeoutMs = options.timeoutMs || 120000
    this.debug = options.debug ?? Config.debug ?? false
  }

  /**
   * 向子LLM发送消息并获取回复
   *
   * @param {string} prompt  用户消息
   * @param {object} [opts]  额外选项
   * @param {string} [opts.systemPrompt]  本次调用临时覆盖的systemPrompt
   * @param {object} [opts.conversation]  对话上下文（parentMessageId / conversationId），openai/qwen/claude/gemini 可用
   * @returns {Promise<{text: string, id?: string, conversationId?: string, parentMessageId?: string}>}
   */
  async chat(prompt, opts = {}) {
    const systemPrompt = opts.systemPrompt || this.systemPrompt
    const conversation = opts.conversation || {}

    if (this.debug) {
      logger.info(`[SubLLM] provider=${this.provider}, model=${this.model}, prompt=${prompt?.slice(0, 100)}`)
    }

    switch (this.provider) {
      case 'openai':
        return await this._chatOpenAI(prompt, systemPrompt, conversation)
      case 'responses':
        return await this._chatResponses(prompt, systemPrompt)
      case 'gemini':
        return await this._chatGemini(prompt, systemPrompt, conversation)
      case 'claude':
        return await this._chatClaude(prompt, systemPrompt, conversation)
      case 'qwen':
        return await this._chatQwen(prompt, systemPrompt, conversation)
      case 'xh':
        return await this._chatXH(prompt, systemPrompt, conversation)
      case 'chatglm4':
        return await this._chatChatGLM4(prompt, systemPrompt, conversation)
      default:
        throw new Error(`SubLLM: 未实现的provider "${this.provider}"`)
    }
  }

  /* ===================== 各 Provider 实现 ===================== */

  async _chatOpenAI(prompt, systemPrompt, conversation) {
    const completionParams = {}
    if (this.model) completionParams.model = this.model
    if (this.temperature !== undefined) completionParams.temperature = this.temperature

    const opts = {
      apiKey: this.apiKey || Config.apiKey,
      apiBaseUrl: this.apiBaseUrl || Config.openAiBaseUrl,
      debug: this.debug,
      systemMessage: systemPrompt || undefined,
      completionParams,
      assistantLabel: 'SubLLM',
      fetch: newFetch,
      maxModelTokens: Config.maxModelTokens,
      maxResponseTokens: this.maxTokens || Config.apiMaxToken,
    }

    const client = new ChatGPTAPI(opts)
    const option = {
      timeoutMs: this.timeoutMs,
      completionParams,
    }
    if (conversation.conversationId) {
      option.conversationId = conversation.conversationId
    }
    if (conversation.parentMessageId) {
      option.parentMessageId = conversation.parentMessageId
    }

    const result = await client.sendMessage(prompt, option)
    return {
      text: result.text,
      id: result.id,
      conversationId: result.conversationId,
      parentMessageId: result.parentMessageId,
    }
  }

  async _chatResponses(prompt, systemPrompt) {
    const completionParams = {}
    if (this.model || Config.responsesModel) completionParams.model = this.model || Config.responsesModel
    if (this.temperature !== undefined) completionParams.temperature = this.temperature
    else if (typeof Config.responsesTemperature === 'number') completionParams.temperature = Config.responsesTemperature
    if (Config.responsesReasoningEffort) completionParams.reasoning_effort = Config.responsesReasoningEffort

    const client = new ResponsesAPI({
      apiKey: this.apiKey || Config.responsesApiKey,
      apiBaseUrl: this.apiBaseUrl || Config.responsesApiBaseUrl,
      debug: this.debug,
      fetch: newFetch,
      maxResponseTokens: this.maxTokens || Config.responsesApiMaxToken,
      maxModelTokens: Config.responsesMaxModelTokens
    })
    // 子模型请求永远不附带 tools/tool_choice，避免不兼容模型被强制工具调用。
    const result = await client.sendMessage(prompt, {
      instructions: systemPrompt || undefined,
      completionParams,
      store: false,
      timeoutMs: this.timeoutMs
    })
    return {
      text: result.text,
      id: result.id
    }
  }

  async _chatGemini(prompt, systemPrompt, conversation) {
    const client = new CustomGoogleGeminiClient({
      key: this.apiKey || Config.getGeminiKey,
      model: this.model || Config.geminiModel,
      baseUrl: this.apiBaseUrl || Config.geminiBaseUrl,
      debug: this.debug,
    })

    const option = {
      stream: false,
      onProgress: (data) => {
        if (this.debug) logger.info(data)
      },
      system: systemPrompt || undefined,
    }
    if (conversation.parentMessageId) option.parentMessageId = conversation.parentMessageId
    if (conversation.conversationId) option.conversationId = conversation.conversationId
    if (this.temperature !== undefined) option.temperature = this.temperature

    const result = await client.sendMessage(prompt, option)
    return {
      text: result.text,
      id: result.id,
      conversationId: result.conversationId,
      parentMessageId: result.parentMessageId,
    }
  }

  async _chatClaude(prompt, systemPrompt, conversation) {
    const keys = (this.apiKey || Config.claudeApiKey)?.split(/[,;]/).map(k => k.trim()).filter(k => k)
    if (!keys || keys.length === 0) {
      throw new Error('SubLLM: claude provider 未配置API Key')
    }

    const key = keys[Math.floor(Math.random() * keys.length)]
    const client = new ClaudeAPIClient({
      key,
      model: this.model || Config.claudeApiModel || 'claude-3-sonnet-20240229',
      debug: this.debug,
      baseUrl: this.apiBaseUrl || Config.claudeApiBaseUrl,
    })

    const option = {
      stream: false,
      system: systemPrompt || undefined,
      max_tokens: this.maxTokens || Config.claudeApiMaxToken || 1024,
    }
    if (conversation.parentMessageId) option.parentMessageId = conversation.parentMessageId
    if (conversation.conversationId) option.conversationId = conversation.conversationId

    const result = await client.sendMessage(prompt, option)
    return {
      text: result.text,
      id: result.id,
      conversationId: result.conversationId,
      parentMessageId: result.parentMessageId,
    }
  }

  async _chatQwen(prompt, systemPrompt, conversation) {
    const completionParams = {
      parameters: {
        top_p: Config.qwenTopP || 0.5,
        top_k: Config.qwenTopK || 50,
        seed: Config.qwenSeed > 0 ? Config.qwenSeed : Math.floor(Math.random() * 114514),
        temperature: this.temperature !== undefined ? this.temperature : (Config.qwenTemperature || 1),
        enable_search: !!Config.qwenEnableSearch,
        result_format: 'message',
      }
    }
    if (this.model) completionParams.model = this.model
    else if (Config.qwenModel) completionParams.model = Config.qwenModel

    const opts = {
      apiKey: this.apiKey || Config.qwenApiKey,
      debug: this.debug,
      systemMessage: systemPrompt || undefined,
      completionParams,
      assistantLabel: 'SubLLM',
      fetch: newFetch,
    }

    const option = {
      timeoutMs: this.timeoutMs,
      completionParams,
    }
    if (conversation.conversationId) {
      option.conversationId = conversation.conversationId
    } else {
      option.conversationId = uuid()
    }
    if (conversation.parentMessageId) {
      option.parentMessageId = conversation.parentMessageId
    }

    const client = new QwenApi(opts)
    const result = await client.sendMessage(prompt, option)
    return {
      text: result.text,
      id: result.id,
      conversationId: result.conversationId,
      parentMessageId: result.parentMessageId,
    }
  }

  async _chatXH(prompt, systemPrompt, conversation) {
    const ssoSessionId = this.apiKey || Config.xinghuoToken
    if (!ssoSessionId) {
      throw new Error('SubLLM: xh provider 未配置星火Token')
    }

    const client = new XinghuoClient({ ssoSessionId })
    const result = await client.sendMessage(prompt, {
      chatId: conversation?.conversationId,
      system: systemPrompt || undefined,
    })
    return {
      text: result.text,
      id: result.id,
      conversationId: result.conversationId,
      parentMessageId: result.parentMessageId,
    }
  }

  async _chatChatGLM4(prompt, systemPrompt, conversation) {
    const client = new ChatGLM4Client({
      refreshToken: this.apiKey || Config.chatglmRefreshToken,
    })
    const option = {}
    if (systemPrompt) option.system = systemPrompt
    if (conversation.conversationId) option.conversationId = conversation.conversationId
    if (conversation.parentMessageId) option.parentMessageId = conversation.parentMessageId

    const result = await client.sendMessage(prompt, option)
    return {
      text: result.text,
      id: result.id,
      conversationId: result.conversationId,
      parentMessageId: result.parentMessageId,
    }
  }
}

/**
 * SubLLMTool —— 将子LLM封装为可被主LLM调用的工具
 *
 * 主LLM可以在智能模式下调用此工具，将子任务委派给另一个LLM处理。
 * 默认使用openai provider，可在构造时自定义。
 *
 * @example
 * // 默认配置（使用全局openai配置）
 * new SubLLMTool()
 *
 * @example
 * // 自定义provider和systemPrompt
 * new SubLLMTool({
 *   provider: 'gemini',
 *   model: 'gemini-flash-latest',
 *   systemPrompt: 'You are a professional translator.',
 *   toolName: 'call_translator',
 *   toolDescription: 'Call a translator sub-LLM to translate text.'
 * })
 */
export class SubLLMTool extends AbstractTool {
  /**
   * @param {object} [options]
   * @param {'openai'|'responses'|'gemini'|'claude'|'qwen'|'xh'|'chatglm4'|'api'|'api3'|'bing'|'azure'|'claude2'|'chatglm'} [options.provider]
   * @param {string}  [options.model]
   * @param {string}  [options.systemPrompt]
   * @param {string}  [options.apiKey]
   * @param {string}  [options.apiBaseUrl]
   * @param {number}  [options.temperature]
   * @param {number}  [options.maxTokens]
   * @param {number}  [options.timeoutMs]
   * @param {string}  [options.toolName]        自定义工具名，默认 'call_sub_llm'
   * @param {string}  [options.toolDescription]  自定义工具描述
   */
  constructor(options = {}) {
    super()
    const {
      toolName = 'call_sub_llm',
      toolDescription,
      provider = 'openai',
      ...subLLMOptions
    } = options

    this.name = toolName
    this.description = toolDescription || `Call a sub-LLM (${provider}) to handle a specific sub-task. Use this when you need another AI model to process something independently, such as translation, summarization, code review, or any task that benefits from a different perspective or specialized processing.`

    this.parameters = {
      properties: {
        prompt: {
          type: 'string',
          description: 'The message/prompt to send to the sub-LLM. Be specific and clear about what you want the sub-LLM to do.'
        },
        system_prompt: {
          type: 'string',
          description: 'Optional one-time system prompt override for this specific call. Use this to give the sub-LLM a specific role or instruction for this task only.'
        }
      },
      required: ['prompt']
    }

    this._subLLM = new SubLLM({ provider, ...subLLMOptions })
    this._provider = provider
  }

  func = async (opts, e) => {
    const { prompt, system_prompt } = opts
    if (!prompt) {
      return 'Error: prompt is required.'
    }

    try {
      const result = await this._subLLM.chat(prompt, {
        systemPrompt: system_prompt || undefined,
      })

      if (this._subLLM.debug) {
        logger.info(`[SubLLMTool] provider=${this._provider}, response=${result.text?.slice(0, 200)}`)
      }

      return result.text || '(empty response from sub-LLM)'
    } catch (err) {
      logger.error(`[SubLLMTool] sub-LLM call failed: ${err.message}`)
      return `Error calling sub-LLM (${this._provider}): ${err.message}`
    }
  }
}
