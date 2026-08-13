/**
 * Minimal client for OpenAI-compatible Responses APIs.
 * It intentionally keeps the Responses item protocol separate from the
 * Chat Completions message protocol used by chatgpt-api.js.
 */
export class ResponsesAPI {
  constructor (opts = {}) {
    const {
      apiKey,
      apiBaseUrl = 'https://api.openai.com/v1',
      debug = false,
      fetch = globalThis.fetch,
      maxResponseTokens,
      maxModelTokens
    } = opts

    if (!apiKey) throw new Error('Responses API missing required apiKey')
    if (typeof fetch !== 'function') throw new Error('Invalid environment; fetch is not defined')

    this._apiKey = apiKey
    this._apiBaseUrl = apiBaseUrl.replace(/\/+$/, '')
    this._debug = debug
    this._fetch = fetch
    this._maxResponseTokens = maxResponseTokens
    this._maxModelTokens = maxModelTokens
  }

  _extractOutputText (response) {
    if (typeof response.output_text === 'string') return response.output_text

    return (response.output || [])
      .filter(item => item.type === 'message')
      .flatMap(item => item.content || [])
      .filter(item => item.type === 'output_text' || item.type === 'text')
      .map(item => item.text || '')
      .join('')
  }

  _extractReasoningText (response) {
    return (response.output || [])
      .filter(item => item.type === 'reasoning')
      .flatMap(item => item.summary || [])
      .map(item => item.text || '')
      .filter(Boolean)
      .join('\n')
  }

  _extractToolCalls (response) {
    return (response.output || [])
      .filter(item => item.type === 'function_call')
      .map(item => ({
        id: item.call_id,
        callId: item.call_id,
        type: 'function',
        function: {
          name: item.name,
          arguments: item.arguments || ''
        },
        item
      }))
  }

  /**
   * @param {string | Array<object>} input Responses input string or item list
   * @param {object} opts Request overrides
   */
  async sendMessage (input, opts = {}) {
    const {
      instructions,
      completionParams = {},
      store = false,
      previousResponseId,
      timeoutMs
    } = opts
    const {
      reasoning_effort: reasoningEffort,
      max_output_tokens: configuredMaxOutputTokens,
      ...requestParams
    } = completionParams

    const controller = timeoutMs ? new AbortController() : undefined
    const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : undefined
    const body = {
      ...requestParams,
      input,
      instructions,
      store: Boolean(store),
      stream: false
    }

    const maxOutputTokens = configuredMaxOutputTokens || this._maxResponseTokens
    if (maxOutputTokens) body.max_output_tokens = maxOutputTokens
    if (reasoningEffort) body.reasoning = { effort: reasoningEffort }
    if (store && previousResponseId) body.previous_response_id = previousResponseId

    const url = `${this._apiBaseUrl}/responses`
    if (this._debug) console.log('[Chatgpt][Responses] request:', JSON.stringify(body, null, 2))

    try {
      const res = await this._fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller?.signal
      })
      if (!res.ok) {
        const reason = await res.text()
        const error = new Error(`Responses API error ${res.status || res.statusText}: ${reason}`)
        error.statusCode = res.status
        error.statusText = res.statusText
        throw error
      }

      const response = await res.json()
      if (this._debug) console.log('[Chatgpt][Responses] response:', JSON.stringify(response, null, 2))

      const usage = response.usage || {}
      const inputTokens = usage.input_tokens ?? usage.prompt_tokens
      const outputTokens = usage.output_tokens ?? usage.completion_tokens
      const reportedCacheReadTokens = usage.cache_read_input_tokens
        ?? usage.prompt_tokens_details?.cached_tokens
        ?? usage.input_tokens_details?.cached_tokens
      const cacheReadTokens = reportedCacheReadTokens ?? 0
      const reportedCacheWriteTokens = usage.cache_creation_input_tokens
        ?? usage.prompt_tokens_details?.cache_write_tokens
        ?? usage.input_tokens_details?.cache_write_tokens
      const cacheWriteTokens = reportedCacheWriteTokens ?? 0
      const reportedReasoningTokens = usage.output_tokens_details?.reasoning_tokens
        ?? usage.completion_tokens_details?.reasoning_tokens
        ?? usage.reasoning_tokens
      const reasoningTokens = reportedReasoningTokens ?? 0
      const rawOutputTokens = outputTokens ?? 0
      const answerTokens = rawOutputTokens >= reasoningTokens
        ? rawOutputTokens - reasoningTokens
        : rawOutputTokens
      if (typeof inputTokens === 'number') {
        const cachedInputTokens = cacheReadTokens + cacheWriteTokens
        const freshInputTokens = inputTokens >= cachedInputTokens
          ? inputTokens - cachedInputTokens
          : inputTokens
        const cacheableInputTokens = freshInputTokens + cachedInputTokens
        const cacheHitRate = cacheableInputTokens > 0
          ? (cacheReadTokens / cacheableInputTokens) * 100
          : 0
        const totalTokenCount = usage.total_tokens ?? inputTokens + (outputTokens ?? 0)
        const cacheWriteInfo = reportedCacheWriteTokens == null
          ? ''
          : ` | 缓存写入(${cacheWriteTokens})`
        const reasoningInfo = reportedReasoningTokens == null
          ? ''
          : ` | 推理Token(${reasoningTokens})`
        const cacheReadInfo = reportedCacheReadTokens == null
          ? ''
          : ` | 缓存命中(${cacheReadTokens}, ${cacheHitRate.toFixed(1)}%)`
        console.info(`[Chatgpt][Responses] 输入Token(${inputTokens})${maxOutputTokens ? ` | 回复上限(${maxOutputTokens})` : ''} | 回答Token(${answerTokens})${reasoningInfo} | 累计Token(${totalTokenCount})${cacheWriteInfo}${cacheReadInfo}`)
        if (this._maxModelTokens && maxOutputTokens && inputTokens + maxOutputTokens > this._maxModelTokens) {
          console.warn(`[Chatgpt][Responses] 当前 token 配置边界过紧：输入Token(${inputTokens}) + 回复上限(${maxOutputTokens}) > 总上下文(${this._maxModelTokens})。请检查锅巴中的 Responses Token 配置。`)
        }
      }

      const toolCalls = this._extractToolCalls(response)
      return {
        id: response.id,
        role: 'assistant',
        text: this._extractOutputText(response),
        thinking_text: this._extractReasoningText(response),
        originalContent: response.output,
        toolCalls,
        functionCall: toolCalls[0]?.function,
        detail: response,
        responseOutput: response.output || [],
        usage: response.usage
      }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}
