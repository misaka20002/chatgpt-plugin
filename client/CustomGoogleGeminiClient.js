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
import { syncInnerOs } from '../utils/innerOs.js';

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
  constructor(props) {
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
   *     retryConfig: {origRetry?: number, fallbackModel?: string, fallbackRetry?: number, isFallback?: boolean},
   * }} opt
   * @returns {Promise<{conversationId: string?, parentMessageId: string, text: string, id: string}>}
   */
  async sendMessage(text, opt = {}) {
    /** 重试配置 */
    const retryConfig = {
      origRetry: 3,
      fallbackModel: Config.gemini_fallbackModel || 'gemini-2.5-flash',
      fallbackRetry: 3,
      isFallback: false,
      ...opt.retryConfig // 允许外部覆盖默认值，并在递归中透传状态
    };

    const executeRetry = async (logMsg, terminalAction) => {
      const nextOpt = { ...opt, retryConfig };
      if (!retryConfig.isFallback) {
        if (retryConfig.origRetry > 0) {
          retryConfig.origRetry--;
          logger.warn(`[chatgpt] ${logMsg} 。模型[${this.model}]重试剩余 ${retryConfig.origRetry} 次`);
          return this.sendMessage(text, nextOpt);
        } else {
          logger.warn(`[chatgpt][备用模型] 切换至模型[${retryConfig.fallbackModel}]`);
          retryConfig.isFallback = true;
          return this.sendMessage(text, nextOpt);
        }
      } else {
        if (retryConfig.fallbackRetry > 0) {
          retryConfig.fallbackRetry--;
          logger.warn(`[chatgpt][备用模型] ${logMsg} 。模型[${retryConfig.fallbackModel}]重试剩余 ${retryConfig.fallbackRetry} 次`);
          return this.sendMessage(text, nextOpt);
        } else {
          return terminalAction();
        }
      }
    };

    if (!opt.toolChain) {
      opt.toolChain = {
        depth: 0,
        calledTools: []
      };
    }
    let history = await this.getHistory(opt.parentMessageId)

    let maxHistory = 0
    if (Config.chatgptBlockCount) {
      // 限制历史记录最大轮数（按条数限制） maxHistory 必须是偶数
      maxHistory = Config.chatgptBlockCount;
      if (maxHistory % 2 !== 0) maxHistory += 1; // 强制保证是偶数，防止 Gemini 角色交替报错
    }

    // 面包版 思考模式/全局破限：确保第一条 user 消息使用最新配置，并持久化到 Redis
    syncInnerOs(history, opt.paimon_globalInnerOs, {
      getText: m => m.parts?.[0]?.text ?? '',
      setText: (m, t) => { if (m.parts?.[0]) m.parts[0].text = t },
      upsert: m => this.upsertMessage(m),
    })

    let systemMessage = opt.system

    // 存储前清除多媒体数据，并保留 mime_type 的辅助函数
    const getMessageForSave = (msg) => {
      let saveMsg = _.cloneDeep(msg);
      if (saveMsg.parts) {
        saveMsg.parts = saveMsg.parts.map(part => {
          if (part.inline_data) {
            // 取出 mimeType 并替换为文本占位符
            const mime = part.inline_data.mime_type || '未知类型';
            return { text: `[多媒体附件: ${mime}]` };
          }
          return part;
        });
      }
      return saveMsg;
    };


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
    if (opt.functionResponse && !Array.isArray(opt.functionResponse)) {
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

    // 记录点: opt.media
    // 逻辑：使用 media (带明确类型) 传递图片或视频
    if (opt.media) {
      let mime_type = opt.media.mimeType;
      let data = opt.media.data;
      // 去除可能携带的 data URL scheme 头部
      if (data.startsWith('data:')) {
        const match = data.match(/^data:(.*?);base64,(.*)$/);
        if (match) {
          mime_type = mime_type || match[1];
          data = match[2];
        }
      }
      // 支持通用媒体类型（视频、不同格式图片）
      thisMessage.parts.push({
        inline_data: {
          mime_type: mime_type, // 例如 'video/mp4' 或 'image/png'
          data: data
        }
      })
    }
    history.push(_.cloneDeep(thisMessage))
    const maxHistoryWithCurrentMessage = maxHistory > 0 ? maxHistory + 1 : 0
    const normalizedHistory = normalizeGeminiHistory(history, maxHistoryWithCurrentMessage)
    history = normalizedHistory.history
    if (this.debug && normalizedHistory.changed) {
      logger.info(`[Chatgpt][Gemini] cleaned invalid function-call history: ${JSON.stringify(normalizedHistory.stats)}`)
    }

    // retryConfig 根据是否处于备用模式决定使用的模型名称
    const modelToUse = retryConfig.isFallback ? retryConfig.fallbackModel : this.model;
    let url = `${this.baseUrl}/v1beta/models/${modelToUse}:generateContent`

    let body = {
      // 不去兼容官方的简单格式了，直接用，免得function还要转换
      /**
       * @type Array<Content>
       */
      contents: history,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE }
      ],
      generationConfig: {
        maxOutputTokens: opt.maxOutputTokens || 4096,
        temperature: opt.temperature || 0.9,
        topP: opt.topP || 0.95,
        topK: opt.tokK || 16
      },
      tools: []
    }
    if (opt.thinkingLevel) {
      body.generationConfig.thinkingConfig = {
        thinkingLevel: opt.thinkingLevel
      }
    }
    if (systemMessage) {
      body.system_instruction = {
        parts: [{ text: systemMessage }]
      }
    }

    if (this.tools?.length > 0) {
      body.tools.push({
        function_declarations: this.tools.map(tool => tool.function())
        // codeExecution: {}
      })

      let mode = opt.toolMode || 'AUTO'
      // toolMode='NONE' 是上限机制强制设置的，不允许被覆盖
      if (mode !== 'NONE') {
        let lastFuncName = (/** @type {FunctionResponse[] | undefined}**/ opt.functionResponse)?.map(rsp => rsp.name)
        const mustSendNextTurn = ['searchImage', 'searchMusic', 'searchVideo']
        if (lastFuncName && lastFuncName?.find(name => mustSendNextTurn.includes(name))) {
          mode = 'ANY'
        }
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
    // if (opt.media) {
    //   delete body.tools
    //   delete body.tool_config
    // }
    body.contents.forEach(content => {
      delete content.id
      delete content.parentMessageId
      delete content.conversationId
    })
    if (this.debug) {
      logger.info("body: " + JSON.stringify(body, null, 2))
    }
    let result = await newFetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this._key
      }
    })

    // 应用新的 executeRetry 处理错误
    if (result.status !== 200) {
      const errorText = await result.text()
      return await executeRetry(`Gemini API 错误 (${result.status}), 错误信息: ${errorText}`, () => {
        throw new Error(errorText)
      });
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
      logger.info("response: " + JSON.stringify(response, null, 2))
    }

    // 检查响应中是否包含错误
    if (response.error) {
      return await executeRetry(`Gemini API 返回错误: ${JSON.stringify(response.error)}`, () => {
        throw new Error(JSON.stringify(response.error))
      });
    }

    try {
      // 返回 token 统计信息
      const usage = response.usageMetadata;
      if (usage) {
        const numTokens = usage.promptTokenCount || 0;
        const outTokens = usage.candidatesTokenCount || 0;
        const maxTokens = opt.maxOutputTokens || 0;
        logger.info(`[Chatgpt][Gemini] 输入Token(${numTokens})${maxTokens ? ` | 回复上限(${maxTokens})` : ''} | 输出Token(${outTokens}) | 累计Token(${usage.totalTokenCount})`);
      }
    } catch (err) {
      logger.info(`[Chatgpt][Gemini] 打印 Token 日志失败: ${err.message}`);
    }

    // 检查 candidates 是否存在
    if (!response.candidates || response.candidates.length === 0) {
      return await executeRetry(`API 返回的 candidates 为空`, () => {
        throw new Error('API 返回的 candidates 为空,重试次数已用完')
      });
    }

    const candidate = response.candidates[0]
    responseContent = candidate.content
    let groundingMetadata = candidate.groundingMetadata
    const finishReason = candidate.finishReason || 'UNKNOWN'

    // 当模型没按要求写对参数时
    if (finishReason === 'MALFORMED_FUNCTION_CALL') {
      return await executeRetry(`遇到 MALFORMED_FUNCTION_CALL 错误`, () => {
        throw new Error('遇到 MALFORMED_FUNCTION_CALL 错误,重试次数已用完')
      });
    }

    // 检查 responseContent 是否为空
    if (!responseContent || !responseContent.parts || responseContent.parts.length === 0) {
      // 检查是否因为策略拦截导致内容为空
      const blockedReasons = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'OTHER']
      if (blockedReasons.includes(finishReason)) {
        return await executeRetry(`API返回内容被拦截 (finishReason: ${finishReason})`, () => {
          throw new Error(`API返回内容被拦截 (finishReason: ${finishReason}),重试次数已用完`)
        });
      }

      if (finishReason === 'STOP') {
        // 模型正常生成结束，但返回了空内容，赋一个默认空文本以防止后续解构报错
        responseContent = { role: 'model', parts: [{ text: '' }] }
      } else {
        // 其他未知中断情况
        return await executeRetry(`responseContent.parts 为空 (finishReason: ${finishReason})`, () => {
          throw new Error(`responseContent.parts 为空 (finishReason: ${finishReason}),重试次数已用完\n详情: ${JSON.stringify(candidate)}`)
        });
      }
    }
    // todo 空回复也可以重试
    if (responseContent?.parts?.filter(i => i.functionCall).length > 0) {
      const toolNames = responseContent.parts.filter(i => i.functionCall).map(i => i.functionCall.name);
      /** 工具调用最大轮次数 */
      const maxToolRounds = Config.llm_maxToolRounds
      // 最多允许连续 maxToolRounds 轮工具调用，不限制单次并行调用的工具数量
      // 注意：不再按工具名判断"重复调用"，同一工具不同 action 是合法场景（如 scheduleGroupTask 的 list→remove）
      const toolLimitReached = opt.toolChain.depth >= maxToolRounds;
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
        logger.info(`[Chatgpt][Gemini] execution function: ${JSON.stringify(fc)}`)
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

        // 关键：保留 thoughtSignature (适用于 Gemini Thinking 模型)
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
            // let isOwner = ['owner'].includes(this.e.sender.role) || (this.e.group?.is_owner && this.e.isMaster)
            let args = Object.assign(fc.args, {
              isAdmin,
              // isOwner,
              sender: this.e.sender.user_id,
              mode: 'gemini'
            })
            functionResponse.response.content = await chosenTool.func(args, this.e)
            logger.info(`[Chatgpt][Gemini] function ${fc.name} execution result: ${JSON.stringify(functionResponse.response.content)}`)
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

      // 防止在工具回调的轮次中再次携带媒体文件，避免 API 报错 Request contains an invalid argument
      delete responseOpt.media

      // 达到工具调用上限时，强制下一轮不使用工具，让模型必须生成文本回复
      if (toolLimitReached) {
        responseOpt.toolMode = 'NONE'
      }

      // 添加明确的系统指示
      const toolResultPrefix = "以下是工具调用的结果，请直接回答用户，不要再次调用工具：\n\n";
      if (responseOpt.system) {
        responseOpt.system = toolResultPrefix + responseOpt.system;
      } else {
        responseOpt.system = toolResultPrefix;
      }

      // 递归直到返回text
      // 先把这轮的消息存下来
      await this.upsertMessage(getMessageForSave(thisMessage))
      responseContent = handleSearchResponse(responseContent).responseContent
      const respMessage = Object.assign(responseContent, {
        id: idModel,
        parentMessageId: idThis
      })
      await this.upsertMessage(respMessage)

      // 函数调用产生的下一次对话不再传带有降级进度的 opt.retryConfig，重新应用默认的初始重试配置
      return await this.sendMessage('', responseOpt)
    }
    if (responseContent) {
      await this.upsertMessage(getMessageForSave(thisMessage))
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
        logger.info('[Chatgpt][Gemini Grounding] 搜索查询: ' + groundingMetadata.webSearchQueries.join(', '));
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
function normalizeGeminiHistory(history, maxHistory = 0) {
  const stats = {
    originalLength: history?.length || 0,
    trimmed: 0,
    droppedLeadingModel: 0,
    droppedFunctionResponse: 0,
    droppedFunctionCall: 0,
    strippedFunctionCall: 0,
    finalLength: 0
  }
  let normalized = Array.isArray(history) ? history.filter(Boolean) : []

  if (maxHistory > 0 && normalized.length > maxHistory) {
    let start = normalized.length - maxHistory

    // Gemini requires a functionResponse turn to be immediately preceded by
    // its model functionCall turn. Include the whole tool exchange when the
    // configured history limit cuts into the middle of it.
    while (start > 0 && isGeminiFunctionResponse(normalized[start])) {
      start--
    }
    while (start > 0 && isGeminiFunctionCall(normalized[start])) {
      start--
    }

    normalized = normalized.slice(start)
    stats.trimmed = start
  }

  normalized = stripInvalidGeminiFunctionTurns(normalized, stats)

  // Keep Gemini history starting from a user turn. If the suffix starts at a
  // model turn, dropping it can expose an orphan functionResponse, so clean
  // again after each leading drop.
  while (normalized.length > 0 && normalized[0]?.role !== 'user') {
    normalized.shift()
    stats.droppedLeadingModel++
    normalized = stripInvalidGeminiFunctionTurns(normalized, stats)
  }

  stats.finalLength = normalized.length
  return {
    history: normalized,
    stats,
    changed: stats.trimmed > 0 ||
      stats.droppedLeadingModel > 0 ||
      stats.droppedFunctionResponse > 0 ||
      stats.droppedFunctionCall > 0 ||
      stats.strippedFunctionCall > 0
  }
}

function stripInvalidGeminiFunctionTurns(history, stats) {
  const cleaned = []

  for (let i = 0; i < history.length; i++) {
    const content = history[i]
    if (isGeminiFunctionResponse(content)) {
      if (isGeminiFunctionCall(cleaned[cleaned.length - 1])) {
        cleaned.push(content)
      } else {
        stats.droppedFunctionResponse++
      }
      continue
    }

    if (isGeminiFunctionCall(content)) {
      if (isMatchingGeminiFunctionResponse(content, history[i + 1])) {
        cleaned.push(content)
        continue
      }

      const textOnlyContent = stripGeminiFunctionCallParts(content)
      if (textOnlyContent) {
        cleaned.push(textOnlyContent)
        stats.strippedFunctionCall++
      } else {
        stats.droppedFunctionCall++
      }
      continue
    }

    cleaned.push(content)
  }

  return cleaned
}

function isGeminiFunctionCall(content) {
  return Array.isArray(content?.parts) && content.parts.some(part => part?.functionCall)
}

function isGeminiFunctionResponse(content) {
  return Array.isArray(content?.parts) && content.parts.some(part => part?.functionResponse)
}

function isMatchingGeminiFunctionResponse(functionCallContent, functionResponseContent) {
  if (!isGeminiFunctionResponse(functionResponseContent)) {
    return false
  }

  const functionCallNames = getGeminiFunctionCallNames(functionCallContent)
  const functionResponseNames = getGeminiFunctionResponseNames(functionResponseContent)
  if (functionCallNames.length === 0 || functionCallNames.length !== functionResponseNames.length) {
    return false
  }

  const responseNameCounts = new Map()
  for (const name of functionResponseNames) {
    responseNameCounts.set(name, (responseNameCounts.get(name) || 0) + 1)
  }

  for (const name of functionCallNames) {
    const count = responseNameCounts.get(name) || 0
    if (count <= 0) {
      return false
    }
    responseNameCounts.set(name, count - 1)
  }

  return true
}

function getGeminiFunctionCallNames(content) {
  return (content.parts || [])
    .map(part => part?.functionCall?.name)
    .filter(Boolean)
}

function getGeminiFunctionResponseNames(content) {
  return (content.parts || [])
    .map(part => part?.functionResponse?.name)
    .filter(Boolean)
}

function stripGeminiFunctionCallParts(content) {
  const parts = content.parts?.filter(part => !part?.functionCall) || []
  if (parts.length === 0) {
    return null
  }
  return {
    ...content,
    parts
  }
}

function handleSearchResponse(responseContent) {
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
