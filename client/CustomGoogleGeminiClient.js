import crypto from 'crypto'
import { GoogleGeminiClient } from './GoogleGeminiClient.js'
import { newFetch } from '../utils/proxy.js'
import _ from 'lodash'
import {
  splitString_Enter,
} from '../utils/paimonFuction.js'

import {
  makeForwardMsg,
} from '../utils/common.js'
import { convertFacesAndCQCode } from '../utils/face.js'
import { Config } from '../utils/config.js'

const BASEURL = 'https://generativelanguage.googleapis.com'

export const HarmCategory = {
  HARM_CATEGORY_UNSPECIFIED: 'HARM_CATEGORY_UNSPECIFIED',
  HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
  HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
  HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  HARM_CATEGORY_CIVIC_INTEGRITY: 'HARM_CATEGORY_CIVIC_INTEGRITY'
}

export const HarmBlockThreshold = {
  HARM_BLOCK_THRESHOLD_UNSPECIFIED: 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
  BLOCK_LOW_AND_ABOVE: 'BLOCK_LOW_AND_ABOVE',
  BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
  BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
  BLOCK_NONE: 'BLOCK_NONE',
  OFF: 'OFF'
}

/**
 * @typedef {{
 *   role: string,
 *   parts: Array<{
 *     text?: string,
 *     functionCall?: FunctionCall,
 *     functionResponse?: FunctionResponse,
 *     executableCode?: {
 *       language: string,
 *       code: string
 *     },
 *     codeExecutionResult?: {
 *       outcome: string,
 *       output: string
 *     }
 *   }>
 * }} Content
 *
 * Gemini消息的基本格式
 */

/**
 * @typedef {{
 *   searchEntryPoint: {
 *     renderedContent: string,
 *   },
 *   groundingChunks: Array<{
 *     web: {
 *       uri: string,
 *       title: string
 *     }
 *   }>,
 *   webSearchQueries: Array<string>
 * }} GroundingMetadata
 * 搜索结果的元数据
 */

/**
 * @typedef {{
 *    name: string,
 *    args: {},
 *    thoughtSignature?: string
 * }} FunctionCall
 *
 * Gemini的FunctionCall
 * thoughtSignature 用于严格验证函数调用的顺序和完整性
 */

/**
 * @typedef {{
 *   name: string,
 *   response: {
 *     name: string,
 *     content: {}
 *   },
 *   thoughtSignature?: string
 * }} FunctionResponse
 *
 * Gemini的Function执行结果包裹
 * 其中response可以为任意,本项目根据官方示例封装为name和content两个字段
 * thoughtSignature 必须按照收到的顺序原样返回
 */

export class CustomGoogleGeminiClient extends GoogleGeminiClient {
  constructor (props) {
    super(props)
    this.model = props.model
    this.baseUrl = props.baseUrl || BASEURL
    this.supportFunction = true
    this.debug = props.debug
  }

  /**
   *
   * @param text
   * @param {{
   *     conversationId: string?,
   *     parentMessageId: string?,
   *     stream: boolean?,
   *     onProgress: function?,
   *     functionResponse?: FunctionResponse | FunctionResponse[],
   *     system: string?,
   *     image: string?,
   *     video: string?,
   *     media: { mimeType: string, data: string }?,
   *     maxOutputTokens: number?,
   *     temperature: number?,
   *     topP: number?,
   *     tokK: number?,
   *     replyPureTextCallback: Function,
   *     toolMode: 'AUTO' | 'ANY' | 'NONE'
   *     search: boolean,
   *     codeExecution: boolean,
   * }} opt
   * @param {number} retryTime 重试次数
   * @returns {Promise<{conversationId: string?, parentMessageId: string, text: string, id: string}>}
   */
  async sendMessage (text, opt = {}, retryTime = 10) {
    if (!opt.toolChain) {
      opt.toolChain = {
        depth: 0,
        calledTools: []
      };
    }
    let history = await this.getHistory(opt.parentMessageId)
    let systemMessage = opt.system
    // if (systemMessage) {
    //   history = history.reverse()
    //   history.push({
    //     role: 'model',
    //     parts: [
    //       {
    //         text: 'ok'
    //       }
    //     ]
    //   })
    //   history.push({
    //     role: 'user',
    //     parts: [
    //       {
    //         text: systemMessage
    //       }
    //     ]
    //   })
    //   history = history.reverse()
    // }
    const idThis = crypto.randomUUID()
    const idModel = crypto.randomUUID()
    if (opt.functionResponse && !typeof Array.isArray(opt.functionResponse)) {
      opt.functionResponse = [opt.functionResponse]
    }
    const thisMessage = opt.functionResponse?.length > 0
      ? {
          role: 'user',
          // parts: [{
          //   functionResponse: opt.functionResponse
          // }],
          parts: opt.functionResponse.map(i => {
            return {
              functionResponse: i
            }
          }),
          id: idThis,
          parentMessageId: opt.parentMessageId || undefined
        }
      : {
        role: 'user',
        parts: text ? [{ text }] : [],
        id: idThis,
        parentMessageId: opt.parentMessageId || undefined
      }

    // 逻辑：优先使用 media (带明确类型)，其次 video (默认为MP4)，最后 fallback 到 image (默认为JPEG)
    // 推荐以后都使用 opt.media
    if (opt.media) {
      // 支持通用媒体类型（视频、不同格式图片）
      thisMessage.parts.push({
        inline_data: {
          mime_type: opt.media.mimeType, // 例如 'video/mp4' 或 'image/png'
          data: opt.media.data
        }
      })
    } else if (opt.image) {
      // 旧版图片参数兼容
      thisMessage.parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: opt.image
        }
      })
    }
    history.push(_.cloneDeep(thisMessage))
    let url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent`
    let body = {
      // 不去兼容官方的简单格式了，直接用，免得function还要转换
      /**
       * @type Array<Content>
       */
      contents: history,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
          threshold: HarmBlockThreshold.BLOCK_NONE
        }
      ],
      generationConfig: {
        maxOutputTokens: opt.maxOutputTokens || 4096,
        temperature: opt.temperature || 0.9,
        topP: opt.topP || 0.95,
        topK: opt.tokK || 16
      },
      tools: []
    }
    if (systemMessage) {
      body.system_instruction = {
        parts: {
          text: systemMessage
        }
      }
    }
    if (this.tools?.length > 0) {
      body.tools.push({
        function_declarations: this.tools.map(tool => tool.function())
        // codeExecution: {}
      })

      // ANY要笑死人的效果
      let mode = opt.toolMode || 'AUTO'
      let lastFuncName = (/** @type {FunctionResponse[] | undefined}**/ opt.functionResponse)?.map(rsp => rsp.name)
      const mustSendNextTurn = [
        'searchImage', 'searchMusic', 'searchVideo'
      ]
      if (lastFuncName && lastFuncName?.find(name => mustSendNextTurn.includes(name))) {
        mode = 'ANY'
      }
      // 防止死循环。
      delete opt.toolMode
      body.tool_config = {
        function_calling_config: {
          mode
        }
      }
    }
    if (opt.search) {
      body.tools.push({ google_search: {} })
    }
    if (opt.codeExecution) {
      body.tools.push({ code_execution: {} })
    }
    // if (opt.image) {
    //   delete body.tools
    //   delete body.tool_config
    // }
    body.contents.forEach(content => {
      delete content.id
      delete content.parentMessageId
      delete content.conversationId
    })
    if (this.debug) {
      logger.debug(JSON.stringify(body))
    }
    let result = await newFetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'x-goog-api-key': this._key
      }
    })
    if (result.status !== 200) {
      const errorText = await result.text()
      if (retryTime <= 0) {
        throw new Error(errorText)
      }
      logger.warn(`[chatgpt] Gemini API 错误 (${result.status}),进行重试。错误信息: ${errorText}`)
      return this.sendMessage(text, opt, --retryTime)
    }
    /**
     * @type {Content | undefined}
     */
    let responseContent
    /**
     * @type {{candidates: Array<{content: Content, groundingMetadata: GroundingMetadata, finishReason: string}>}}
     */
    let response = await result.json()
    if (this.debug) {
      console.log(JSON.stringify(response))
    }
    
    // 检查响应中是否包含错误
    if (response.error) {
      if (retryTime <= 0) {
        throw new Error(JSON.stringify(response.error))
      }
      logger.warn(`[chatgpt] Gemini API 返回错误,进行重试。错误信息: ${JSON.stringify(response.error)}`)
      return this.sendMessage(text, opt, --retryTime)
    }
    
    // 检查 candidates 是否存在
    if (!response.candidates || response.candidates.length === 0) {
      if (retryTime <= 0) {
        throw new Error('API 返回的 candidates 为空,重试次数已用完')
      }
      logger.warn('[chatgpt] API 返回的 candidates 为空,进行重试。')
      return this.sendMessage(text, opt, --retryTime)
    }
    
    responseContent = response.candidates[0].content
    let groundingMetadata = response.candidates[0].groundingMetadata
    if (response.candidates[0].finishReason === 'MALFORMED_FUNCTION_CALL') {
      if (retryTime <= 0) {
        throw new Error('遇到 MALFORMED_FUNCTION_CALL 错误,重试次数已用完')
      }
      logger.warn('[chatgpt] 遇到 MALFORMED_FUNCTION_CALL 错误,进行重试。')
      return this.sendMessage(text, opt, --retryTime)
    }
    
    // 检查 responseContent 是否为空
    if (!responseContent || !responseContent.parts || responseContent.parts.length === 0) {
      if (retryTime <= 0) {
        throw new Error('responseContent.parts 为空,重试次数已用完')
      }
      logger.warn('[chatgpt] responseContent.parts 为空,进行重试。')
      return this.sendMessage(text, opt, --retryTime)
    }
    
    // todo 空回复也可以重试
    if (responseContent?.parts?.filter(i => i.functionCall).length > 0) {
      const toolNames = responseContent.parts.filter(i => i.functionCall).map(i => i.functionCall.name);
      
      const repeatedTool = toolNames.find(name => opt.toolChain.calledTools.includes(name));
      
      if (opt.toolChain.depth >= 2 || repeatedTool) {
        const responseText = responseContent.parts.find(i => i.text)?.text;
        if(!responseText){
          if (retryTime <= 0) {
            return {
              text: '操作已完成',
              conversationId: '',
              parentMessageId: idThis,
              id: idModel
            };
          }
          logger.warn('[chatgpt] responseContent.parts 中未找到文本内容,进行重试。');
          return this.sendMessage(text, opt, --retryTime);
        }
        return {
          text: responseText,
          conversationId: '',
          parentMessageId: idThis,
          id: idModel
        };
      }
      // functionCall - 提取所有的 functionCall 部分（保留原始顺序）
      const functionCallParts = responseContent.parts.filter(i => i.functionCall)
      const functionCall = functionCallParts.map(i => i.functionCall)
      
      // 提取 thoughtSignatures - 按照文档规则处理
      // 单次调用：第一个 functionCall 包含签名
      // 并行调用：只有第一个 functionCall 包含签名
      // 多步（顺序）调用：每个 functionCall 都有签名
      const thoughtSignatures = functionCallParts
        .map(part => part.functionCall?.thoughtSignature)
        .filter(sig => sig !== undefined && sig !== null)
      
      const replyText = responseContent.parts.find(i => i.text)?.text
      if (replyText && replyText.trim()) {
        // send reply first
        // logger.info('[chatgpt]functionCall附加的对话text: ' + replyText.trim())

        if (opt.sf_markdownPic) {
          // sf图片模式
          try {
            if (replyText.trim()) {
              const userMsg = this.e.img ? this.e.img.map(url => `<img src="${url}" width="256">`).join('\n') + "\n\n" + this.e.msg_bak_2 : this.e.msg_bak_2;
              const { markdown_screenshot } = await import('../../siliconflow-plugin/utils/markdownPic.js')
              const img = await markdown_screenshot(this.e.user_id, this.e.self_id, userMsg, replyText.trim());
              this.e.reply({ ...img, origin: true }, true)
            }
          } catch (err) {
            logger.error('[chatgpt][functionCall附加的对话text]sf图片模式错误\n' + err)
            opt.replyPureTextCallback && await opt.replyPureTextCallback(replyText.trim())
          }
        }
        else {
          if (replyText.length > 1000) {
            // if (opt.auto_makeForwardMsg && replyText.trim()?.length > opt.auto_makeForwardMsg) {
            this.e.reply(await makeForwardMsg(this.e, splitString_Enter(replyText.trim(), opt.auto_makeForwardMsg), `Tool回复 @${this.e.sender.card || this.e.sender.nickname}`));
            // }
            // else {
            //   opt.replyPureTextCallback && await opt.replyPureTextCallback(replyText.trim())
            // }
          } else {
            logger.info("[chatgpt][functionCall附加的对话text] Processing...")
            this.e.reply((await convertFacesAndCQCode(replyText.trim(), Config.enableRobotAt, Config.isProcessCQAtCode, Config.removeCQCodeFocus, this.e)), true);
          }
        }
      }
      let /** @type {FunctionResponse[]} **/ fcResults = []
      for (let fc of functionCall) {
        logger.info(JSON.stringify(fc))
        const funcName = fc.name
        let chosenTool = this.tools.find(t => t.name === funcName)
        /**
         * @type {FunctionResponse}
         */
        let functionResponse = {
          name: funcName,
          response: {
            name: funcName,
            content: null
          }
        }
        
        // 关键：保留 thoughtSignature
        // 根据文档：
        // - 单次调用：只有一个签名，添加到唯一的 response
        // - 并行调用：只有第一个有签名，仅添加到第一个 response
        // - 多步调用：每个都有签名，按索引添加
        if (fc.thoughtSignature) {
          functionResponse.thoughtSignature = fc.thoughtSignature
        }
        
        if (!chosenTool) {
          // 根本没有这个工具！
          functionResponse.response.content = {
            error: `Function ${funcName} doesn't exist`
          }
        } else {
          // execute function
          try {
            let isAdmin = ['admin', 'owner'].includes(this.e.sender.role) || (this.e.group?.is_admin && this.e.isMaster)
            let isOwner = ['owner'].includes(this.e.sender.role) || (this.e.group?.is_owner && this.e.isMaster)
            let args = Object.assign(fc.args, {
              isAdmin,
              isOwner,
              sender: this.e.sender.user_id,
              mode: 'gemini'
            })
            functionResponse.response.content = await chosenTool.func(args, this.e)
            if (this.debug) {
              logger.info(JSON.stringify(functionResponse.response.content))
            }
          } catch (err) {
            logger.error(err)
            functionResponse.response.content = {
              error: `Function execute error: ${err.message}`
            }
          }
        }
        fcResults.push(functionResponse)
      }
      let responseOpt = _.cloneDeep(opt)
      responseOpt.parentMessageId = idModel
      responseOpt.functionResponse = fcResults
      responseOpt.toolChain = {
        depth: opt.toolChain.depth + 1,
        calledTools: [...opt.toolChain.calledTools, ...toolNames]
      };

      // 添加明确的系统指示
      const toolResultPrefix = "以下是工具调用的结果，请直接回答用户，不要再次调用工具：\n\n";
      if (responseOpt.system) {
        responseOpt.system = toolResultPrefix + responseOpt.system;
      } else {
        responseOpt.system = toolResultPrefix;
      }

      // 递归直到返回text
      // 先把这轮的消息存下来
      await this.upsertMessage(thisMessage)
      responseContent = handleSearchResponse(responseContent).responseContent
      const respMessage = Object.assign(responseContent, {
        id: idModel,
        parentMessageId: idThis
      })
      await this.upsertMessage(respMessage)
      return await this.sendMessage('', responseOpt)
    }
    if (responseContent) {
      await this.upsertMessage(thisMessage)
      const respMessage = Object.assign(responseContent, {
        id: idModel,
        parentMessageId: idThis
      })
      await this.upsertMessage(respMessage)
    }
    let { final } = handleSearchResponse(responseContent)
    try {
      if (groundingMetadata?.groundingChunks) {
        final += '\n参考资料\n'
        groundingMetadata.groundingChunks.forEach(chunk => {
          // final += `[${chunk.web.title}](${chunk.web.uri})\n`
          final += `[${chunk.web.title}]\n`
        })
        groundingMetadata.webSearchQueries.forEach(q => {
          logger.info('search query: ' + q)
        })
      }
    } catch (err) {
      logger.warn(err)
    }

    return {
      text: final,
      conversationId: '',
      parentMessageId: idThis,
      id: idModel
    }
  }
}

/**
 * 处理成单独的text
 * @param {Content} responseContent
 * @returns {{final: string, responseContent}}
 */
function handleSearchResponse (responseContent) {
  let final = ''

  // 如果 responseContent 不存在或没有 parts,直接返回
  if (!responseContent || !responseContent.parts) {
    return {
      final,
      responseContent
    }
  }

  // 遍历每个 part 并处理
  responseContent.parts = responseContent.parts.map((part) => {
    let newText = ''

    if (part.text) {
      newText += part.text
      final += part.text // 累积到 final
    }
    if (part.executableCode) {
      const codeBlock = '\n执行代码：\n' + '```' + part.executableCode.language + '\n' + part.executableCode.code.trim() + '\n```\n\n'
      newText += codeBlock
      final += codeBlock // 累积到 final
    }
    if (part.codeExecutionResult) {
      const resultBlock = `\n执行结果(${part.codeExecutionResult.outcome})：\n` + '```\n' + part.codeExecutionResult.output + '\n```\n\n'
      newText += resultBlock
      final += resultBlock // 累积到 final
    }

    // 返回更新后的 part，但不设置空的 text
    const updatedPart = { ...part }
    if (newText) {
      updatedPart.text = newText // 仅在 newText 非空时设置 text
    } else {
      delete updatedPart.text // 如果 newText 是空的，则删除 text 字段
    }

    return updatedPart
  })

  return {
    final,
    responseContent
  }
}
