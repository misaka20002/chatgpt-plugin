import Keyv from 'keyv'
import pTimeout from 'p-timeout'
import QuickLRU from 'quick-lru'
import { v4 as uuidv4 } from 'uuid'

import * as tokenizer from './tokenizer.js'
import * as types from './types.js'
import globalFetch from 'node-fetch'
import { fetchSSE } from './fetch-sse.js'
import { openai, Role } from './types.js'

const CHATGPT_MODEL = 'gpt-4o-mini'

const USER_LABEL_DEFAULT = 'User'
const ASSISTANT_LABEL_DEFAULT = 'ChatGPT'
const TOOL_LABEL_DEFAULT = 'Tool'

function extractTextContent(content?: string | types.openai.ChatCompletionContentPart[] | null): string {
    if (!content) {
        return ''
    }
    return typeof content === 'string'
        ? content
        : content.filter(part => part.type === 'text').map(part => (part as any).text).join('\n')
}

function getStoredMessageRole(role?: string): Role | 'function' {
    if (role === 'tool' || role === 'assistant' || role === 'system') {
        return role
    }
    if (role === 'function') {
        return 'function'
    }
    return 'user'
}

export class ChatGPTAPI {
    protected _apiKey: string
    protected _apiBaseUrl: string
    protected _apiOrg?: string
    protected _debug: boolean

    protected _systemMessage: string
    protected _completionParams: Omit<
        types.openai.CreateChatCompletionRequest,
        'messages' | 'n'
    >
    protected _maxModelTokens: number
    protected _maxResponseTokens: number
    protected _fetch: types.FetchFn

    protected _getMessageById: types.GetMessageByIdFunction
    protected _upsertMessage: types.UpsertMessageFunction

    protected _messageStore: Keyv<types.ChatMessage>

    /**
     * Creates a new client wrapper around OpenAI's chat completion API, mimicing the official ChatGPT webapp's functionality as closely as possible.
     *
     * @param apiKey - OpenAI API key (required).
     * @param apiOrg - Optional OpenAI API organization (optional).
     * @param apiBaseUrl - Optional override for the OpenAI API base URL.
     * @param debug - Optional enables logging debugging info to stdout.
     * @param completionParams - Param overrides to send to the [OpenAI chat completion API](https://platform.openai.com/docs/api-reference/chat/create). Options like `temperature` and `presence_penalty` can be tweaked to change the personality of the assistant.
     * @param maxModelTokens - Optional override for the maximum number of tokens allowed by the model's context. Defaults to 4096.
     * @param maxResponseTokens - Optional override for the minimum number of tokens allowed for the model's response. Defaults to 1000.
     * @param messageStore - Optional [Keyv](https://github.com/jaredwray/keyv) store to persist chat messages to. If not provided, messages will be lost when the process exits.
     * @param getMessageById - Optional function to retrieve a message by its ID. If not provided, the default implementation will be used (using an in-memory `messageStore`).
     * @param upsertMessage - Optional function to insert or update a message. If not provided, the default implementation will be used (using an in-memory `messageStore`).
     * @param fetch - Optional override for the `fetch` implementation to use. Defaults to the global `fetch` function.
     */
    constructor(opts: types.ChatGPTAPIOptions) {
        const {
            apiKey,
            apiOrg,
            apiBaseUrl = 'https://api.openai.com/v1',
            debug = false,
            messageStore,
            completionParams,
            systemMessage,
            maxModelTokens = 4096,
            maxResponseTokens = 8192,
            getMessageById,
            upsertMessage,
            fetch = globalFetch
        } = opts

        this._apiKey = apiKey
        this._apiOrg = apiOrg
        this._apiBaseUrl = apiBaseUrl
        this._debug = !!debug
        this._fetch = fetch

        this._completionParams = {
            model: CHATGPT_MODEL,
            temperature: 0.8,
            top_p: 1.0,
            presence_penalty: 1.0,
            ...completionParams
        }

        this._systemMessage = systemMessage

        if (this._systemMessage === undefined) {
            const currentDate = new Date().toISOString().split('T')[0]
            this._systemMessage = `You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible.\nKnowledge cutoff: 2021-09-01\nCurrent date: ${currentDate}`
        }

        this._maxModelTokens = maxModelTokens
        this._maxResponseTokens = maxResponseTokens

        this._getMessageById = getMessageById ?? this._defaultGetMessageById
        this._upsertMessage = upsertMessage ?? this._defaultUpsertMessage

        if (messageStore) {
            this._messageStore = messageStore
        } else {
            this._messageStore = new Keyv<types.ChatMessage, any>({
                store: new QuickLRU<string, types.ChatMessage>({ maxSize: 10000 })
            })
        }

        if (!this._apiKey) {
            throw new Error('OpenAI missing required apiKey')
        }

        if (!this._fetch) {
            throw new Error('Invalid environment; fetch is not defined')
        }

        if (typeof this._fetch !== 'function') {
            throw new Error('Invalid "fetch" is not a function')
        }
    }

    protected _toRequestMessage(message: types.ChatMessage): types.openai.ChatCompletionRequestMessage | null {
        const storedRole = getStoredMessageRole(message.role)
        const content = message.originalContent ?? message.text

        if (storedRole === 'function') {
            // Legacy conversation data may still contain function-role messages
            // written before tool_call_id support. Skip them during replay.
            return null
        }

        if (storedRole === 'tool') {
            if (!message.toolCallId) {
                return null
            }
            return {
                role: 'tool',
                content: content || '',
                tool_call_id: message.toolCallId
            }
        }

        return {
            role: storedRole,
            content: content || '',
            name: storedRole === 'user' ? message.name : undefined,
            function_call: storedRole === 'assistant' && !message.toolCalls?.length ? message.functionCall : undefined,
            tool_calls: storedRole === 'assistant' ? message.toolCalls : undefined
        }
    }

    protected async _getMessageTokenEstimate(message: types.openai.ChatCompletionRequestMessage) {
        const contentString = extractTextContent(message.content)
        let nonTextTokens = 0
        if (Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part.type === 'image_url') nonTextTokens += 85
                if (part.type === 'input_audio') nonTextTokens += 100
            }
        }

        let promptLine = ''
        switch (message.role) {
            case 'system':
                promptLine = `Instructions:\n${contentString}`
                break
            case 'user':
                promptLine = `${USER_LABEL_DEFAULT}:\n${contentString}`
                break
            case 'assistant':
                promptLine = `${ASSISTANT_LABEL_DEFAULT}:\n${contentString}`
                break
            case 'tool':
                promptLine = `${TOOL_LABEL_DEFAULT}:\n${contentString}`
                break
        }

        let tokenCount = await this._getTokenCount(promptLine) + nonTextTokens
        if (message.function_call) {
            tokenCount += await this._getTokenCount(JSON.stringify(message.function_call))
        }
        if (message.tool_calls) {
            tokenCount += await this._getTokenCount(JSON.stringify(message.tool_calls))
        }
        if (message.tool_call_id) {
            tokenCount += await this._getTokenCount(message.tool_call_id)
        }
        return tokenCount
    }

    /**
     * Sends a message to the OpenAI chat completions endpoint, waits for the response
     * to resolve, and returns the response.
     *
     * If you want your response to have historical context, you must provide a valid `parentMessageId`.
     *
     * If you want to receive a stream of partial responses, use `opts.onProgress`.
     *
     * Set `debug: true` in the `ChatGPTAPI` constructor to log more info on the full prompt sent to the OpenAI chat completions API. You can override the `systemMessage` in `opts` to customize the assistant's instructions.
     *
     * @param content - The prompt message to send: 多模态消息体封装：将传给 sendMessage 的参数从单纯的 string 放开为 string | ChatCompletionContentPart[]。你现在可以在上层应用构建好 [{ type: 'text', text: '描述一下这个图' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,....' } }]
     * @param opts.parentMessageId - Optional ID of the previous message in the conversation (defaults to `undefined`)
     * @param opts.conversationId - Optional ID of the conversation (defaults to `undefined`)
     * @param opts.messageId - Optional ID of the message to send (defaults to a random UUID)
     * @param opts.systemMessage - Optional override for the chat "system message" which acts as instructions to the model (defaults to the ChatGPT system message)
     * @param opts.timeoutMs - Optional timeout in milliseconds (defaults to no timeout)
     * @param opts.onProgress - Optional callback which will be invoked every time the partial response is updated
     * @param opts.abortSignal - Optional callback used to abort the underlying `fetch` call using an [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
     * @param completionParams - Optional overrides to send to the [OpenAI chat completion API](https://platform.openai.com/docs/api-reference/chat/create). Options like `temperature` and `presence_penalty` can be tweaked to change the personality of the assistant.
     *
     * @returns The response from ChatGPT
     */
    async sendMessage(
        content: string | types.openai.ChatCompletionContentPart[] | null,
        opts: types.SendMessageOptions = {},
        role: Role = 'user',
    ): Promise<types.ChatMessage> {
        const {
            parentMessageId,
            messageId = uuidv4(),
            timeoutMs,
            onProgress,
            stream = onProgress ? true : false,
            completionParams,
            conversationId
        } = opts

        let { abortSignal } = opts

        let abortController: AbortController = null
        if (timeoutMs && !abortSignal) {
            abortController = new AbortController()
            abortSignal = abortController.signal
        }

        const currentMessages = [...(opts.appendMessages || [])]
        if (content !== null) {
            if (role === 'tool' && !opts.toolCallId) {
                throw new Error('tool role message requires toolCallId')
            }

            const message: types.ChatMessage = {
                role,
                id: messageId,
                conversationId,
                parentMessageId: currentMessages.length > 0 ? currentMessages[currentMessages.length - 1].id : parentMessageId,
                text: extractTextContent(content),
                originalContent: content, // 存储完整的原始对象（包含图片）
                name: role === 'user' ? opts.name : undefined,
                toolCallId: role === 'tool' ? opts.toolCallId : undefined
            }
            currentMessages.push(message)
        }

        if (currentMessages.length === 0) {
            throw new Error('sendMessage requires content or appendMessages')
        }

        const { messages, maxTokens, numTokens } = await this._buildMessages(
            currentMessages,
            opts,
            completionParams
        )
        console.log(`maxTokens: ${maxTokens}, numTokens: ${numTokens}`)

        const result: types.ChatMessage & { conversation: openai.ChatCompletionRequestMessage[] } = {
            role: 'assistant',
            id: uuidv4(),
            conversationId,
            parentMessageId: currentMessages[currentMessages.length - 1].id,
            text: '',
            thinking_text: '',
            functionCall: undefined,
            toolCalls: undefined,
            conversation: []
        }

        const responseP = new Promise<types.ChatMessage & { conversation: openai.ChatCompletionRequestMessage[] }>(
            async (resolve, reject) => {
                const url = `${this._apiBaseUrl}/chat/completions`
                const headers = {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this._apiKey}`
                }
                const body = {
                    max_tokens: maxTokens,
                    ...this._completionParams,
                    ...completionParams,
                    messages,
                    stream
                }

                // 如果存在 functions，将其转换为 tools 格式
                if ((body as any).functions && (body as any).functions.length > 0) {
                    (body as any).tools = (body as any).functions.map((func: any) => ({
                        type: "function",
                        function: func
                    }));
                    delete (body as any).functions;
                }

                if (this._debug) {
                    console.log(JSON.stringify(body))
                }
                // Support multiple organizations
                // See https://platform.openai.com/docs/api-reference/authentication
                if (this._apiOrg) {
                    headers['OpenAI-Organization'] = this._apiOrg
                }

                if (this._debug) {
                    console.log(`sendMessage (${numTokens} tokens)`, body)
                }

                if (stream) {
                    fetchSSE(
                        url,
                        {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(body),
                            signal: abortSignal,
                            onMessage: (data: string) => {
                                if (data === '[DONE]') {
                                    result.text = result.text.trim()
                                    if (result.functionCall && (!result.toolCalls || result.toolCalls.length === 0)) {
                                        result.toolCalls = [{
                                            id: `call_${uuidv4()}`,
                                            type: 'function',
                                            function: result.functionCall
                                        }]
                                    }
                                    result.conversation = messages
                                    return resolve(result)
                                }

                                try {
                                    const response: types.openai.CreateChatCompletionDeltaResponse =
                                        JSON.parse(data)

                                    if (response.id) {
                                        result.id = response.id
                                    }

                                    if (response.choices?.length) {
                                        const delta = response.choices[0].delta
                                        if (delta.function_call && delta.function_call !== null) {
                                            if (delta.function_call.name) {
                                                result.functionCall = {
                                                    name: delta.function_call.name,
                                                    arguments: delta.function_call.arguments
                                                }
                                            } else {
                                                result.functionCall.arguments = (result.functionCall.arguments || '') + delta.function_call.arguments
                                            }
                                        } else if (delta.tool_calls && delta.tool_calls.length > 0) {
                                            if (!result.toolCalls) {
                                                result.toolCalls = []
                                            }
                                            for (const incomingToolCall of delta.tool_calls) {
                                                const toolCallIndex = incomingToolCall.index || 0
                                                if (!result.toolCalls[toolCallIndex]) {
                                                    result.toolCalls[toolCallIndex] = {
                                                        id: incomingToolCall.id || `call_${uuidv4()}`,
                                                        type: 'function',
                                                        function: {
                                                            name: incomingToolCall.function?.name || '',
                                                            arguments: incomingToolCall.function?.arguments || ''
                                                        }
                                                    }
                                                } else {
                                                    if (incomingToolCall.id) {
                                                        result.toolCalls[toolCallIndex].id = incomingToolCall.id
                                                    }
                                                    if (incomingToolCall.function?.name) {
                                                        result.toolCalls[toolCallIndex].function.name = incomingToolCall.function.name
                                                    }
                                                    if (incomingToolCall.function?.arguments) {
                                                        result.toolCalls[toolCallIndex].function.arguments =
                                                            (result.toolCalls[toolCallIndex].function.arguments || '') + incomingToolCall.function.arguments
                                                    }
                                                }
                                            }
                                            if (result.toolCalls.length > 0) {
                                                result.functionCall = result.toolCalls[0].function
                                            }
                                        } else {
                                            result.delta = delta.content
                                            if (delta?.content) result.text += delta.content
                                            if (delta?.reasoning_content) result.thinking_text += delta.reasoning_content
                                        }
                                        if (delta.role) {
                                            result.role = delta.role
                                        }
                                        result.detail = response
                                        onProgress?.(result)
                                    }
                                } catch (err) {
                                    console.warn('OpenAI stream SEE event unexpected error', err)
                                    return reject(err)
                                }
                            }
                        },
                        this._fetch
                    ).catch(reject)
                } else {
                    try {
                        const res = await this._fetch(url, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(body),
                            signal: abortSignal
                        })

                        if (!res.ok) {
                            const reason = await res.text()
                            const msg = `OpenAI error ${res.status || res.statusText
                                }: ${reason}`
                            const error = new types.ChatGPTError(msg)
                            error.statusCode = res.status
                            error.statusText = res.statusText
                            return reject(error)
                        }
                        const response: types.openai.CreateChatCompletionResponse =
                            (await res.json()) as types.openai.CreateChatCompletionResponse
                        if (this._debug) {
                            console.log(response)
                        }

                        if (response?.id) {
                            result.id = response.id
                        }

                                        if (response?.choices?.length) {
                                            const message = response.choices[0].message
                                            if (message.content) {
                                                result.text = typeof message.content === 'string' ? message.content : (message.content as any).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
                                                result.originalContent = message.content
                                            } else if (message.function_call && message.function_call !== null) {
                                                result.functionCall = message.function_call
                                                result.toolCalls = [{
                                                    id: `call_${uuidv4()}`,
                                                    type: 'function',
                                                    function: message.function_call
                                                }]
                                            } else if (message.tool_calls && message.tool_calls.length > 0) {
                                                // 设置 functionCall 以兼容旧代码
                                                result.functionCall = message.tool_calls.map(tool => tool.function)[0]
                                                // 同时设置 toolCalls 以支持新的格式
                                                result.toolCalls = message.tool_calls
                            }
                            result.thinking_text = message.reasoning_content
                            if (message.role) {
                                result.role = message.role
                            }
                        } else {
                            const res = response as any
                            console.error(res)
                            return reject(
                                new Error(
                                    `OpenAI error: ${res?.detail?.message || res?.detail || 'unknown'
                                    }`
                                )
                            )
                        }

                        result.detail = response
                        result.conversation = messages
                        return resolve(result)
                    } catch (err) {
                        return reject(err)
                    }
                }
            }
        ).then(async (message) => {
            if (message.detail && !message.detail.usage) {
                try {
                    const promptTokens = numTokens
                    const completionTokens = await this._getTokenCount(message.text)
                    message.detail.usage = {
                        prompt_tokens: promptTokens,
                        completion_tokens: completionTokens,
                        total_tokens: promptTokens + completionTokens,
                        estimated: true
                    }
                } catch (err) {
                    // TODO: this should really never happen, but if it does,
                    // we should handle notify the user gracefully
                }
            }

            return Promise.all([
                ...currentMessages.map(currentMessage => this._upsertMessage(currentMessage)),
                this._upsertMessage(message)
            ]).then(() => message)
        })

        if (timeoutMs) {
            if (abortController) {
                // This will be called when a timeout occurs in order for us to forcibly
                // ensure that the underlying HTTP request is aborted.
                ; (responseP as any).cancel = () => {
                    abortController.abort()
                }
            }

            return pTimeout(responseP, {
                milliseconds: timeoutMs,
                message: 'OpenAI timed out waiting for response'
            })
        } else {
            return responseP
        }
    }

    // @ts-ignore
    get apiKey(): string {
        return this._apiKey
    }

    // @ts-ignore
    set apiKey(apiKey: string) {
        this._apiKey = apiKey
    }

    // @ts-ignore
    get apiOrg(): string {
        return this._apiOrg
    }

    // @ts-ignore
    set apiOrg(apiOrg: string) {
        this._apiOrg = apiOrg
    }

    protected async _buildMessages(
        currentMessages: types.ChatMessage[],
        opts: types.SendMessageOptions,
        completionParams: Partial<Omit<openai.CreateChatCompletionRequest, 'messages' | 'n' | 'stream'>>
    ) {
        const { systemMessage = this._systemMessage } = opts
        let parentMessageId = currentMessages[0]?.parentMessageId

        const promptBudget = this._maxResponseTokens < this._maxModelTokens
            ? this._maxModelTokens - this._maxResponseTokens
            : this._maxModelTokens - 1

        let messages: types.openai.ChatCompletionRequestMessage[] = []

        if (systemMessage) {
            messages.push({
                role: 'system',
                content: systemMessage
            })
        }

        const systemMessageOffset = messages.length
        const currentRequestMessages = currentMessages
            .map(message => this._toRequestMessage(message))
            .filter(Boolean) as types.openai.ChatCompletionRequestMessage[]
        let nextMessages = messages.concat(currentRequestMessages)

        let functionToken = 0
        let numTokens = functionToken

        do {
            let nextNumTokensEstimate = functionToken
            for (const message of nextMessages) {
                nextNumTokensEstimate += await this._getMessageTokenEstimate(message)
            }

            const isValidPrompt = nextNumTokensEstimate <= promptBudget
            const includesOnlyCurrentTurn = nextMessages.length === systemMessageOffset + currentRequestMessages.length

            if (includesOnlyCurrentTurn || isValidPrompt) {
                messages = nextMessages
                numTokens = nextNumTokensEstimate
            }

            if (!isValidPrompt || !parentMessageId) {
                break
            }

            const parentMessage = await this._getMessageById(parentMessageId)
            if (!parentMessage) {
                break
            }

            const storedRole = getStoredMessageRole(parentMessage.role)
            if (storedRole === 'tool') {
                const toolHistoryMessages: types.ChatMessage[] = []
                let cursor: types.ChatMessage | undefined = parentMessage

                while (cursor && getStoredMessageRole(cursor.role) === 'tool') {
                    toolHistoryMessages.unshift(cursor)
                    cursor = cursor.parentMessageId ? await this._getMessageById(cursor.parentMessageId) : undefined
                }

                parentMessageId = cursor?.parentMessageId

                const assistantRequestMessage = cursor ? this._toRequestMessage(cursor) : null
                const toolRequestMessages = toolHistoryMessages
                    .map(message => this._toRequestMessage(message))
                    .filter(Boolean) as types.openai.ChatCompletionRequestMessage[]

                if (
                    assistantRequestMessage?.role !== 'assistant' ||
                    !assistantRequestMessage.tool_calls?.length ||
                    toolRequestMessages.length !== toolHistoryMessages.length
                ) {
                    continue
                }

                nextMessages = nextMessages.slice(0, systemMessageOffset).concat([
                    assistantRequestMessage,
                    ...toolRequestMessages,
                    ...nextMessages.slice(systemMessageOffset)
                ])
                continue
            }

            const parentRequestMessage = this._toRequestMessage(parentMessage)
            parentMessageId = parentMessage.parentMessageId

            if (!parentRequestMessage) {
                continue
            }

            nextMessages = nextMessages.slice(0, systemMessageOffset).concat([
                parentRequestMessage,
                ...nextMessages.slice(systemMessageOffset)
            ])
        } while (true)

        const maxTokens = Math.max(1, this._maxResponseTokens)

        return { messages, maxTokens, numTokens }
    }

    protected async _getTokenCount(text: string) {
        if (!text) {
            return 0
        }
        // TODO: use a better fix in the tokenizer
        text = text.replace(/<\|endoftext\|>/g, '')

        return tokenizer.encode(text).length
    }

    protected async _defaultGetMessageById(
        id: string
    ): Promise<types.ChatMessage> {
        const res = await this._messageStore.get(id)
        return res
    }

    protected async _defaultUpsertMessage(
        message: types.ChatMessage
    ): Promise<void> {
        await this._messageStore.set(message.id, message)
    }
}
