import { resolveProvider, providerConfig } from '../utils/providers.js'
import { Config } from '../utils/config.js'
import { ChatGPTAPI } from '../utils/openai/chatgpt-api.js'
import { CustomGoogleGeminiClient } from '../client/CustomGoogleGeminiClient.js'
import { ClaudeAPIClient } from '../client/ClaudeAPIClient.js'
import { newFetch } from '../utils/proxy.js'
import { ResponsesAPI } from '../utils/openai/responses-api.js'
import { AbstractTool } from '../utils/tools/AbstractTool.js'
import { v4 as uuid } from 'uuid'

const SUPPORTED_PROVIDERS = ['openai', 'responses', 'gemini', 'claude']

/**
 * 解析来源引用，保留具体提供商条目的身份。
 *
 * @param {string} use 条目 ID 或 current
 * @returns {string} 提供商条目 ID
 */
export function useToProvider(use) {
  return resolveProvider(use).id
}

/**
 * 把 base64 媒体转成 data URL（OpenAI Chat Completions / Responses 的图片入参格式）
 *
 * @param {{mimeType?: string, data: string}} media
 * @returns {string}
 */
function toMediaDataUrl(media) {
  return `data:${media.mimeType || 'image/jpeg'};base64,${media.data}`
}

/**
 * OpenAI Chat Completions 的多模态 message content。
 * 无 media 时保持纯字符串，不改变既有调用形态。
 *
 * @param {string} prompt
 * @param {{mimeType?: string, data: string}|null} [media]
 * @returns {string|Array<object>}
 */
function buildOpenAIContent(prompt, media) {
  if (!media?.data) return prompt
  return [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: toMediaDataUrl(media) } }
  ]
}

/**
 * Responses API 的多模态 input（结构同 model/core.js 的 initialInput）
 *
 * @param {string} prompt
 * @param {{mimeType?: string, data: string}|null} [media]
 * @returns {string|Array<object>}
 */
function buildResponsesInput(prompt, media) {
  if (!media?.data) return prompt
  return [{
    role: 'user',
    content: [
      { type: 'input_text', text: prompt },
      { type: 'input_image', image_url: toMediaDataUrl(media) }
    ]
  }]
}

/**
 * 子LLM调用器 —— 主LLM可以通过它调用另一个LLM完成子任务
 *
 * @example
 * // 基本用法
 * const subLLM = new SubLLM({ provider: Config.defaultProviderId, systemPrompt: '你是一个翻译助手' })
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
   * @param {string}  [options.provider]       提供商条目 ID 或 current，默认全局主条目
   * @param {string}  [options.model]           内部调用的模型覆盖，留空则用条目的主模型
   * @param {string}  [options.systemPrompt]    系统提示词
   * @param {string}  [options.apiKey]          API Key，留空则用所选条目
   * @param {string}  [options.apiBaseUrl]      API BaseUrl，留空则用所选条目
   * @param {number}  [options.temperature]     温度
   * @param {number}  [options.maxTokens]       最大输出token
   * @param {number}  [options.timeoutMs]       超时毫秒，默认 600000
   * @param {boolean} [options.debug]           调试模式
   * @param {{mimeType?: string, data: string}} [options.media] 多模态媒体（base64）；各 provider 按自身协议转换：
   *                                            OpenAI 走 image_url、Responses 走 input_image、Claude/Gemini 走 option.media
   */
  constructor(options = {}) {
    const row = resolveProvider(options.providerId || options.provider || Config.defaultProviderId)
    this.config = providerConfig(row)
    this.provider = row.type === 'api' ? 'openai' : row.type
    this.model = options.model || row[{ api: 'model', responses: 'responsesModel', gemini: 'geminiModel', claude: 'claudeApiModel' }[row.type]] || ''
    this.systemPrompt = options.systemPrompt || ''
    this.apiKey = options.apiKey || ''
    this.apiBaseUrl = options.apiBaseUrl || ''
    this.temperature = options.temperature ?? undefined
    this.maxTokens = options.maxTokens ?? undefined
    this.timeoutMs = options.timeoutMs || 600000
    this.debug = options.debug ?? Config.debug ?? false
    this.media = options.media || null
  }

  /**
   * 向子LLM发送消息并获取回复
   *
   * @param {string} prompt  用户消息
   * @param {object} [opts]  额外选项
   * @param {string} [opts.systemPrompt]  本次调用临时覆盖的systemPrompt
   * @param {object} [opts.conversation]  对话上下文（parentMessageId / conversationId），openai/claude/gemini 可用
   * @param {{mimeType?: string, data: string}} [opts.media]  本次调用携带的多模态媒体（base64），覆盖构造时的 media
   * @returns {Promise<{text: string, id?: string, conversationId?: string, parentMessageId?: string}>}
   */
  async chat(prompt, opts = {}) {
    const systemPrompt = opts.systemPrompt || this.systemPrompt
    const conversation = opts.conversation || {}
    const media = opts.media || this.media

    if (this.debug) {
      logger.info(`[SubLLM] provider=${this.provider}, model=${this.model}, prompt=${prompt?.slice(0, 100)}`)
    }

    switch (this.provider) {
      case 'openai':
        return await this._chatOpenAI(prompt, systemPrompt, conversation, media)
      case 'responses':
        return await this._chatResponses(prompt, systemPrompt, media)
      case 'gemini':
        return await this._chatGemini(prompt, systemPrompt, conversation, media)
      case 'claude':
        return await this._chatClaude(prompt, systemPrompt, conversation, media)
      default:
        throw new Error(`SubLLM: 未实现的provider "${this.provider}"`)
    }
  }

  /* ===================== 各 Provider 实现 ===================== */

  async _chatOpenAI(prompt, systemPrompt, conversation, media) {
    const Config = this.config
    const completionParams = {}
    if (this.model) completionParams.model = this.model
    if (Config.reasoningEffort) completionParams.reasoning_effort = Config.reasoningEffort
    if (this.temperature !== undefined) completionParams.temperature = this.temperature
    else if (typeof Config.temperature === 'number') completionParams.temperature = Config.temperature

    const opts = {
      apiKey: this.apiKey || Config.apiKey,
      apiBaseUrl: this.apiBaseUrl || Config.openAiBaseUrl,
      debug: this.debug,
      systemMessage: systemPrompt || undefined,
      completionParams,
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

    const result = await client.sendMessage(buildOpenAIContent(prompt, media), option)
    return {
      text: result.text,
      id: result.id,
      conversationId: result.conversationId,
      parentMessageId: result.parentMessageId,
    }
  }

  async _chatResponses(prompt, systemPrompt, media) {
    const Config = this.config
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
    const result = await client.sendMessage(buildResponsesInput(prompt, media), {
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

  async _chatGemini(prompt, systemPrompt, conversation, media) {
    const Config = this.config
    const client = new CustomGoogleGeminiClient({
      config: Config,
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
    // 与 api / responses / claude 三个分支对齐：不传就等于静默丢弃调用方给的上限
    // （CustomGoogleGeminiClient 只在收到 maxOutputTokens 时才用它，否则回落到它自己的默认值），
    // HTML 卡片这类长结构化输出会因此被截断成半张图。
    option.maxOutputTokens = this.maxTokens || Config.geminiMaxOutputTokens
    option.thinkingLevel = Config.geminiThinkingLevel
    if (option.temperature === undefined) option.temperature = Config.gemini_temperature
    // 记录点: opt.media —— Gemini 客户端按 { mimeType, data } 组装 inlineData
    if (media?.data) option.media = { mimeType: media.mimeType || 'image/jpeg', data: media.data }

    const result = await client.sendMessage(prompt, option)
    return {
      text: result.text,
      id: result.id,
      conversationId: result.conversationId,
      parentMessageId: result.parentMessageId,
    }
  }

  async _chatClaude(prompt, systemPrompt, conversation, media) {
    const Config = this.config
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
      max_tokens: this.maxTokens || Config.claudeApiMaxToken || 65536,
      temperature: this.temperature ?? Config.claudeApiTemperature,
    }
    if (conversation.parentMessageId) option.parentMessageId = conversation.parentMessageId
    if (conversation.conversationId) option.conversationId = conversation.conversationId
    // 记录点: opt.media —— Claude 客户端按 { mimeType, data } 组装 image block
    if (media?.data) option.media = { mimeType: media.mimeType || 'image/jpeg', data: media.data }

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
 * 默认使用全局主条目，可在构造时指定其他条目。
 *
 * @example
 * // 默认配置（使用全局主条目）
 * new SubLLMTool()
 *
 * @example
 * // 自定义provider和systemPrompt
 * new SubLLMTool({
 *   provider: Config.translateSource,
 *   systemPrompt: 'You are a professional translator.',
 *   toolName: 'call_translator',
 *   toolDescription: 'Call a translator sub-LLM to translate text.'
 * })
 */
export class SubLLMTool extends AbstractTool {
  /**
   * @param {object} [options]
   * @param {string} [options.provider] 提供商条目 ID 或 current
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
      provider = Config.defaultProviderId,
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
