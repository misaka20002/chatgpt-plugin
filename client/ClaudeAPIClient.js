import crypto from 'crypto'
import { newFetch } from '../utils/proxy.js'
import _ from 'lodash'
import { getMessageById, upsertMessage } from '../utils/history.js'
import { BaseClient } from './BaseClient.js'
import { Config } from '../utils/config.js'
import { sendToolCallForwardMsg } from '../utils/toolForward.js'

const BASEURL = 'https://api.anthropic.com'

/**
 * @typedef {Object} Content
 * @property {string} model
 * @property {string} system
 * @property {number} max_tokens
 * @property {boolean} stream
 * @property {Array<{
 *   role: 'user'|'assistant',
 *   content: string|Array<{
 *     type: 'text'|'image',
 *     text?: string,
 *     source?: {
 *       type: 'base64',
 *       media_type: 'image/jpeg'|'image/png'|'image/gif'|'image/webp',
 *       data: string
 *     }
 *   }>
 * }>} messages
 *
 * Claude消息的基本格式
 */

/**
 * @typedef {Object} ClaudeResponse
 * @property {string} id
 * @property {string} type
 * @property {number} role
 * @property {number} model
 * @property {number} stop_reason
 * @property {number} stop_sequence
 * @property {number} role
 * @property {boolean} stream
 * @property {Array<{
 *   type: string,
 *   text: string
 * }>} content
 * @property {Array<{
 *   input_tokens: number,
 *   output_tokens: number,
 * }>} usage
 * @property {{
 *   type: string,
 *   message: string,
 * }} error
 * Claude响应的基本格式
 */

export class ClaudeAPIClient extends BaseClient {
  constructor (props) {
    if (!props.upsertMessage) {
      props.upsertMessage = async function umGemini (message) {
        return await upsertMessage(message, 'Claude')
      }
    }
    if (!props.getMessageById) {
      props.getMessageById = async function umGemini (message) {
        return await getMessageById(message, 'Claude')
      }
    }
    super(props)
    this.model = props.model
    this.key = props.key
    if (!this.key) {
      throw new Error('no claude API key')
    }
    this.baseUrl = props.baseUrl || BASEURL
    this.supportFunction = true
    this.debug = props.debug
  }

  async getHistory (parentMessageId, userId = this.userId, opt = {}) {
    const history = []
    let cursor = parentMessageId
    if (!cursor) {
      return history
    }
    do {
      let parentMessage = await this.getMessageById(cursor)
      if (!parentMessage) {
        break
      } else {
        history.push(parentMessage)
        cursor = parentMessage.parentMessageId
        if (!cursor) {
          break
        }
      }
    } while (true)
    return history.reverse()
  }

  _toClaudeTool (tool) {
    const fn = tool.function()
    return {
      name: fn.name,
      description: fn.description,
      input_schema: fn.parameters || { type: 'object', properties: {} }
    }
  }

  _getToolChoice (toolMode) {
    const modeMap = {
      ANY: 'any',
      AUTO: 'auto',
      NONE: 'none'
    }
    return { type: modeMap[toolMode] || 'auto' }
  }

  async _createMessage (messages, opt = {}, toolMode = opt.toolMode) {
    /**
     * 发送的body
     * @type {Content}
     * @see https://docs.anthropic.com/claude/reference/messages_post
     */
    let body = {}
    if (opt.system) {
      body.system = opt.system
    }
    body = Object.assign(body, {
      model: opt.model || this.model || 'claude-3-opus-20240229',
      max_tokens: opt.max_tokens || 4096,
      messages,
      stream: false
    })
    if (Number.isFinite(opt.temperature)) {
      body.temperature = opt.temperature
    }
    if (this.tools?.length > 0) {
      body.tools = this.tools.map(tool => this._toClaudeTool(tool))
      body.tool_choice = this._getToolChoice(toolMode)
    }
    if (this.debug) {
      console.log("body: " + JSON.stringify(body, null, 2))
      console.log(`sendMessage (${messages.length} messages)`, body)
    }
    let url = `${this.baseUrl}/v1/messages`
    let result = await newFetch(url, {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': this.key,
        'content-type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(body)
    })
    if (result.status !== 200) {
      throw new Error(await result.text())
    }
    /**
     * @type {ClaudeResponse}
     */
    let response = await result.json()
    if (this.debug) {
      console.log("response: " + JSON.stringify(response, null, 2))
    }
    if (response.type === 'error') {
      logger.error(response.error.message)
      throw new Error(response.error.type)
    }
    const inputTokens = response.usage?.input_tokens || 0
    const outputTokens = response.usage?.output_tokens || 0
    const totalTokens = inputTokens + outputTokens
    console.info(`[Chatgpt][Claude] 输入Token(${inputTokens})${body.max_tokens ? ` | 回复上限(${body.max_tokens})` : ''} | 输出Token(${outputTokens}) | 累计Token(${totalTokens})`)
    return response
  }

  _buildResponseText (response) {
    return Array.isArray(response.content)
      ? response.content
        .filter(item => item?.type === 'text' && typeof item.text === 'string')
        .map(item => item.text)
        .join('\n')
      : ''
  }

  _buildThinkingText (response) {
    return Array.isArray(response.content)
      ? response.content
        .filter(item => item?.type === 'thinking' && typeof item.thinking === 'string')
        .map(item => item.thinking)
        .join('\n')
      : ''
  }

  _getToolUses (response) {
    return Array.isArray(response.content)
      ? response.content.filter(item => item?.type === 'tool_use')
      : []
  }

  _stringifyToolResult (result) {
    if (result === undefined) {
      return 'undefined'
    }
    if (typeof result === 'string') {
      return result
    }
    try {
      return JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value)
    } catch (err) {
      return String(result)
    }
  }

  /**
   *
   * @param text
   * @param {{conversationId: string?, parentMessageId: string?, stream: boolean?, onProgress: function?, functionResponse: FunctionResponse?, system: string?, media: { mimeType: string, data: string }?, model: string?, toolMode: 'AUTO'|'ANY'|'NONE'?}} opt
   * @returns {Promise<{conversationId: string?, parentMessageId: string, text: string, id: string}>}
   */
  async sendMessage (text, opt = {}) {
    let history = await this.getHistory(opt.parentMessageId)
    const idThis = crypto.randomUUID()
    /**
     * @type {Array<{
     *   role: 'user'|'assistant',
     *   content: string|Array<{
     *     type: 'text'|'image',
     *     text?: string,
     *     source?: {
     *       type: 'base64',
     *       media_type: 'image/jpeg'|'image/png'|'image/gif'|'image/webp',
     *       data: string
     *     }
     *   }>
     * }>}
     */
    let thisContent = [{ type: 'text', text }]
    if (opt.media) {
      thisContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: opt.media.mimeType || 'image/jpeg',
          data: opt.media.data
        }
      })
    }
    const thisMessage = {
      role: 'user',
      content: thisContent,
      id: idThis,
      parentMessageId: opt.parentMessageId || undefined
    }
    history.push(_.cloneDeep(thisMessage))

    let pendingUserMessage = thisMessage
    let toolRoundCount = 0
    let toolMode = opt.toolMode || 'AUTO'
    const maxToolRounds = Config.llm_maxToolRounds || 3

    while (true) {
      const messages = history.map(h => { return { role: h.role, content: h.content } })
      const response = await this._createMessage(messages, opt, toolMode)
      const idModel = crypto.randomUUID()
      const respMessage = Object.assign(response, {
        id: idModel,
        parentMessageId: pendingUserMessage.id
      })

      const responseText = this._buildResponseText(response)
      const thinkingText = this._buildThinkingText(response)
      const toolUses = this._getToolUses(response)
      if (toolUses.length === 0) {
        await this.upsertMessage(pendingUserMessage)
        await this.upsertMessage(respMessage)
        return {
          text: responseText,
          thinking_text: thinkingText,
          conversationId: '',
          parentMessageId: pendingUserMessage.id,
          id: idModel
        }
      }

      if (toolRoundCount >= maxToolRounds) {
        logger.warn(`Claude工具调用已达最大轮次上限 ${maxToolRounds} 轮，返回当前文本并终止工具循环`)
        const fallbackText = responseText || `工具调用已达最大轮次上限 ${maxToolRounds} 轮，已停止继续调用工具。`
        const safeRespMessage = Object.assign({}, respMessage, {
          role: 'assistant',
          content: [{ type: 'text', text: fallbackText }]
        })
        await this.upsertMessage(pendingUserMessage)
        await this.upsertMessage(safeRespMessage)
        return {
          text: fallbackText,
          thinking_text: thinkingText,
          conversationId: '',
          parentMessageId: pendingUserMessage.id,
          id: idModel
        }
      }

      toolRoundCount++
      await this.upsertMessage(pendingUserMessage)
      await this.upsertMessage(respMessage)
      const toolResults = []
      const toolForwardRecords = []
      for (const toolUse of toolUses) {
        const name = toolUse.name
        const args = _.cloneDeep(toolUse.input || {})
        const chosenTool = this.tools.find(t => t.name === name)
        let resultContent
        let isError = false
        logger.info(`[Chatgpt][Claude] execution function: ${JSON.stringify({ name, args })}`)
        try {
          if (!chosenTool) {
            isError = true
            resultContent = `Function ${name} not found.`
          } else {
            const execArgs = Object.assign({}, args, {
              isAdmin: ['admin', 'owner'].includes(this.e?.sender?.role) || (this.e?.group?.is_admin && this.e?.isMaster),
              sender: this.e?.sender?.user_id,
              mode: 'claude'
            })
            if (!execArgs.groupId) {
              const defaultGroupId = this.e?.group_id || this.e?.sender?.user_id
              if (defaultGroupId) {
                execArgs.groupId = `${defaultGroupId}`
              }
            }
            resultContent = await chosenTool.func(execArgs, this.e)
            logger.info(`[Chatgpt][Claude] function ${name} execution result: ${this._stringifyToolResult(resultContent)}`)
          }
        } catch (err) {
          isError = true
          resultContent = `Error executing function ${name}: ${err.message}`
          logger.error(resultContent)
        }
        toolForwardRecords.push({
          platform: 'Claude',
          round: toolRoundCount,
          name,
          args,
          result: resultContent
        })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: this._stringifyToolResult(resultContent),
          ...(isError ? { is_error: true } : {})
        })
      }
      sendToolCallForwardMsg(this.e, toolForwardRecords, 'Claude工具调用与返回')

      const toolResultMessage = {
        role: 'user',
        content: toolResults,
        id: crypto.randomUUID(),
        parentMessageId: idModel
      }
      await this.upsertMessage(toolResultMessage)
      history.push(_.cloneDeep(respMessage))
      history.push(_.cloneDeep(toolResultMessage))
      pendingUserMessage = toolResultMessage
      toolMode = toolRoundCount >= maxToolRounds ? 'NONE' : 'AUTO'
    }
  }
}
