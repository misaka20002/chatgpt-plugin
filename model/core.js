import {
  Config,
  // defaultOpenAIAPI
} from '../utils/config.js'
import McpManager from '../utils/mcp.js'
import {
  extractContentFromFile,
  formatDate,
  parseSourceImg,
  getMasterQQ,
  getUin,
  getUserData,
  normalizeChatMode,
  // isCN
} from '../utils/common.js'
import { KeyvFile } from 'keyv-file'
// import { getChatHistoryGroup } from '../utils/chat.js'
import { msgHistoryMgr } from '../model/Onebot11_MessageHistoryManager.js'
import { APTool } from '../utils/tools/APTool.js'
import { ClaudeAPIClient } from '../client/ClaudeAPIClient.js'
import { getMessageById, upsertMessage } from '../utils/history.js'
import { v4 as uuid } from 'uuid'
import fetch from 'node-fetch'
import { CustomGoogleGeminiClient } from '../client/CustomGoogleGeminiClient.js'
import { QueryStarRailTool } from '../utils/tools/QueryStarRailTool.js'
import { WebsiteTool } from '../utils/tools/WebsiteTool.js'
import { SendPictureTool } from '../utils/tools/SendPictureTool.js'
import { SendVideoTool } from '../utils/tools/SendBilibiliTool.js'
import { BilibiliSearchVideoTool } from '../utils/tools/SearchBilibiliTool.js'
import { SendAvatarTool } from '../utils/tools/SendAvatarTool.js'
import { SerpImageTool } from '../utils/tools/SearchImageTool.js'
import { SendNetEaseMusicTool } from '../utils/tools/SendNetEaseMusicTool.js'
import { SendAudioMessageTool } from '../utils/tools/SendAudioMessageTool.js'
import { SendMessageToSpecificGroupOrUserTool } from '../utils/tools/SendMessageToSpecificGroupOrUserTool.js'
import { QueryGenshinTool } from '../utils/tools/QueryGenshinTool.js'
import { WeatherTool } from '../utils/tools/WeatherTool.js'
import { QueryUserinfoTool } from '../utils/tools/QueryUserinfoTool.js'
import { EditCardTool } from '../utils/tools/EditCardTool.js'
import { JinyanTool } from '../utils/tools/JinyanTool.js'
import { KickOutTool } from '../utils/tools/KickOutTool.js'
import { SetTitleTool } from '../utils/tools/SetTitleTool.js'
import { SerpIkechan8370Tool } from '../utils/tools/SerpIkechan8370Tool.js'
import { azureSerpTool } from '../utils/tools/SerpTool.js'
import common from '../../../lib/common/common.js'
import { SendDiceTool } from '../utils/tools/SendDiceTool.js'
import { EliMovieTool } from '../utils/tools/EliMovieTool.js'
import { EliMusicTool } from '../utils/tools/EliMusicTool.js'
import { HandleMessageMsgTool } from '../utils/tools/HandleMessageMsgTool.js'
import { ProcessPictureTool } from '../utils/tools/ProcessPictureTool.js'
import { ImageCaptionTool } from '../utils/tools/ImageCaptionTool.js'
import { ChatGPTAPI } from '../utils/openai/chatgpt-api.js'
import { ResponsesAPI } from '../utils/openai/responses-api.js'
import { newFetch } from '../utils/proxy.js'
import Keyv from 'keyv'
import crypto from 'crypto'
import { getImageBase64 } from '../utils/paimonFuction.js'
import { sendToolCallForwardMsg } from '../utils/toolForward.js'
import { GithubAPITool } from '../utils/tools/GithubTool.js'
import { Misaka_WebSearchTool } from '../utils/tools/Misaka_WebSearchTool.js'
import { TavilySearchAndExtractTool } from '../utils/tools/TavilySearchAndExtractTool.js'
import { TavilyTool } from '../utils/tools/TavilyTool.js'
import { TavilyExtractTool } from '../utils/tools/TavilyExtractTool.js'
import { Sf_image_edit } from '../utils/tools/Sf_image_edit.js'
import { GeminiSearchTool } from '../utils/tools/GeminiSearchTool.js'
import { SerpImageTool_by_baidu } from '../utils/tools/SearchImageTool_by_baidu.js'
import { SerpImageTool_by_bing } from '../utils/tools/SerpImageTool_by_bing.js'
import { BlockUserTool } from '../utils/tools/Block_User.js'
import { AtOtherUserTool } from '../utils/tools/At_otherUser.js'
import { SendGroupPokeTool } from '../utils/tools/SendGroupPoke.js'
import { SandboxJSTool } from '../utils/tools/Sandbox_JS.js'
import { LocalSandboxTool } from '../utils/tools/LocalSandboxTool.js'
import { RemoteSandboxTool } from '../utils/tools/RemoteSandboxTool.js'
import { VercelSandboxTool } from '../utils/tools/VercelSandboxTool.js'
import { GetPixivApiLoliconTool } from '../utils/tools/GetPixivApiLoliconTool.js'
import { RecognitionResultsByGeminiTool } from '../utils/tools/RecognitionResultsByGeminiTool.js'
import { EmojiTool } from '../utils/tools/EmojiTool.js'
import { MemoryTool } from '../utils/tools/MemoryTool.js'
import { EmojiLikeTool } from '../utils/tools/EmojiLikeTool.js'
import { AnythingLLMQueryTool } from '../utils/anythingllm/AnythingLLMQueryTool.js'
import { AnythingLLMWorkspaceTool } from '../utils/anythingllm/AnythingLLMWorkspaceTool.js'
import { ScheduleTaskTool } from '../utils/tools/ScheduleTaskTool.js'
import { TTSAudioTool } from '../utils/tools/TTSAudioTool.js'
import { SendQQMusicTool } from '../utils/tools/SendQQMusicTool.js'
import { BaiduAISearchTool } from '../utils/tools/BaiduAiSearchTool.js'
import { GenerateMarkmapTool } from '../utils/tools/GenerateMarkmapTool.js'
import { UserProfileTool } from '../utils/tools/UserProfileTool.js'
import { GroupMemberSkillTool } from '../utils/tools/GroupMemberSkillTool.js'
import { GenerateMathRenderTool } from '../utils/tools/GenerateMathRenderTool.js'
import { GenerateGraphCalculatorTool } from '../utils/tools/GenerateGraphCalculatorTool.js'
import { DefaultMessageTriggerTool } from '../utils/tools/DefaultMessageTriggerTool.js'

export const roleMap = {
  owner: 'group owner',
  admin: 'group administrator'
}

const defaultPropmtPrefix = ', a large language model trained by OpenAI. You answer as concisely as possible for each response (e.g. don’t be verbose). It is very important that you answer as concisely as possible, so please remember this. If you are generating a list, do not have too many items. Keep the number of items short.'

function getRetryGroupContextLengths(baseLength = 0) {
  if (!Number.isFinite(baseLength) || baseLength <= 0) {
    return [0]
  }

  const fallbackLengths = [
    Math.floor(baseLength * 0.75),
    Math.floor(baseLength * 0.5),
    Math.floor(baseLength * 0.25),
    0
  ]

  return [...new Set(fallbackLengths.filter(length => length >= 0 && length < baseLength))]
}

async function handleSystem(e, system, settings) {
  if (settings.enableGroupContext) {
    try {
      let opt = {}
      opt.groupId = e.group_id
      opt.qq = e.sender.user_id
      opt.nickname = e.sender.card
      opt.groupName = e.group.name || e.group_name
      opt.botName = e.isGroup ? (e.group.pickMember(getUin(e)).card || e.group.pickMember(getUin(e)).nickname) : e.bot.nickname
      let master = (await getMasterQQ())[0]
      if (master && e.group) {
        opt.masterName = e.group.pickMember(parseInt(master)).card || e.group.pickMember(parseInt(master)).nickname
      }
      if (master && !e.group) {
        opt.masterName = e.bot.getFriendList().get(parseInt(master))?.nickname
      }
      const groupContextLength = settings.groupContextLength ?? Config.groupContextLength
      let chats = await msgHistoryMgr.getGroupHistoryContext(e, groupContextLength)
      opt.chats = chats
      const namePlaceholder = '[name]'
      const defaultBotName = 'ChatGPT'
      const groupContextTip = Config.groupContextTip
      system = system.replaceAll(namePlaceholder, opt.botName || defaultBotName) +
        ((opt.groupId) ? groupContextTip : '')
      system += 'Attention, you are currently chatting in a qq group, then one who asks you now is' + `${opt.nickname}(${opt.qq})。`
      system += `the group name is ${opt.groupName}, group id is ${opt.groupId}。`
      if (opt.botName) {
        system += `Your nickname is ${opt.botName} in the group,`
      }
      if (Array.isArray(chats) && chats.length > 0) {
        system += 'There is the conversation history in the group, you must chat according to the conversation history context"'
        system += chats
          .map(chat => {
            let sender = chat.sender || {}
            // if (sender.user_id === e.bot.uin && chat.raw_message.startsWith('建议的回复')) {
            if (chat.raw_message.startsWith('建议的回复')) {
              // 建议的回复太容易污染设定导致对话太固定跑偏了
              return ''
            }
            return `【${sender.card || sender.nickname}】(qq：${sender.user_id}, ${roleMap[sender.role] || 'normal user'}，${sender.area ? 'from ' + sender.area + ', ' : ''} ${sender.age} years old, 群头衔：${sender.title}, gender: ${sender.sex}, time：${formatDate(new Date(chat.time * 1000))}, messageId: ${chat.message_id}) 说：${chat.raw_message}`
          })
          .join('\n')
      }
    } catch (err) {
      if (e.isGroup) {
        logger.warn('获取群聊聊天记录失败，本次对话不携带聊天记录', err)
      }
    }
  }
  return system
}

/** 合并插件用系统提示词 */
function mergeSystemPrompt(systemPrompt, e, opt = {}) {
  // 呆毛版 在 prompt 中替换文本使用 e.sender 信息
  if (Config.isReplacePromptForSenderMsg) {
    systemPrompt = replacePromptForSenderMsg(e, systemPrompt);
  }
  // 呆毛版 连接画图插件
  if (Config.drawByJsonToPlugin) {
    systemPrompt += '\nIt is important that If I ask you to create a picture prompt or painting, please respond in English in a format suitable for Stable Diffusion. The prompt should include: {Character Description}, {Scene}, {Mood}, {Camera Angle}, {Lighting}, {Art Style}, {Architectural Style}. 其中角色使用词条形式，例如 `klee (genshin impact)`。 Return the message in JSON format like this:```json{"Tools": "Stable_Diffusion", "tags": "Your painting prompt in English", "msg": "Your role assistant content."}```'
  }
  // 呆毛版 CQ At 群友
  if (Config.isProcessCQAtCode) {
    systemPrompt += "\n如果你想要At某个用户，请在回复中使用格式 [CQ:at,id=用户id号]，例如 [CQ:at,id=123456]。注意：使用At码后不要再重复写用户昵称，直接继续你的回复内容即可。"
  }
  // 已不可用
  if (Config.enableChatSuno) {
    systemPrompt += '如果我要求你生成音乐或写歌，你需要回复适合Suno生成音乐的信息。请使用Verse、Chorus、Bridge、Outro和End等关键字对歌词进行分段，如[Verse 1]。音乐信息需要使用markdown包裹的JSON格式回复给我，结构为```json{"option": "Suno", "tags": "style", "title": "title of the song", "lyrics": "lyrics"}```。'
  }
  // 感知现实时间
  if (Config.getCurrentTime) {
    function buildConversationTimeline(reply_Timestamps) {
      if (!reply_Timestamps?.length) return ''
      return '\nConversation timeline:\n' + reply_Timestamps.map((ts, i) =>
        `- ${formatDate(new Date(ts))}`
      ).join('\n')
    }

    systemPrompt += `\nCurrent time: ${formatDate(new Date())}.`
    systemPrompt += buildConversationTimeline(opt.replyTimestamps)
  }
  return systemPrompt
}

class Core {
  async sendMessage(prompt, conversation = {}, use, e, opt = {
    enableSmart: Config.smartMode,
    system: {
      api: Config.promptPrefixOverride,
      responses: Config.responsesSystemPrompt,
      claude: Config.claudeSystemPrompt,
      gemini: Config.geminiPrompt
    },
    settings: {
      replyPureTextCallback: undefined,
      enableGroupContext: Config.enableGroupContext,
      forceTool: false
    }
  }) {
    use = normalizeChatMode(use)
    if (!conversation) {
      conversation = {
        timeoutMs: Config.defaultTimeoutMs
      }
    }
    if (Config.debug) {
      logger.mark(`using ${use} mode`)
    }
    const userData = await getUserData(e.user_id)
    const useCast = userData.cast || {}
    if (use === 'claude') { // 使用接口 ##############################
      // slack已经不可用，移除
      let keys = Config.claudeApiKey?.split(/[,;]/).map(key => key.trim()).filter(key => key)
      let choiceIndex = Math.floor(Math.random() * keys.length)
      let key = keys[choiceIndex]
      logger.info(`使用API Key：${key}`)
      while (keys.length >= 0) {
        let errorMessage = ''
        const client = new ClaudeAPIClient({
          key,
          model: Config.claudeApiModel || 'claude-3-sonnet-20240229',
          debug: Config.debug,
          baseUrl: Config.claudeApiBaseUrl,
          e
          // temperature: Config.claudeApiTemperature || 0.5
        })
        let promptForClaude = prompt
        let system = opt.system.claude || ''
        system = mergeSystemPrompt(system, e, { replyTimestamps: conversation.replyTimestamps })
        let option = {
          stream: false,
          parentMessageId: conversation.parentMessageId,
          conversationId: conversation.conversationId,
          max_tokens: Config.claudeApiMaxToken,
          temperature: Config.claudeApiTemperature
        }
        if (opt.enableSmart) {
          const {
            funcMap,
            promptAddition,
            systemAddition
          } = await collectTools(e)
          let tools = Object.keys(funcMap).map(k => funcMap[k].tool)
          client.addTools(tools)
          promptAddition && (promptForClaude += promptAddition)
          systemAddition && (system += systemAddition)

          const forceToolByKeyword = Config.enableForceToolKeywords !== false &&
            Config.geminiForceToolKeywords?.find(k => promptForClaude?.includes(k) || e.msg?.includes(k))
          option.toolMode = (opt.settings.forceTool || forceToolByKeyword) ? 'ANY' : 'AUTO'
        }
        if (opt.settings.enableGroupContext && e.isGroup) {
          let chats = await msgHistoryMgr.getGroupHistoryContext(e, Config.groupContextLength)
          const namePlaceholder = '[name]'
          const defaultBotName = 'Claude'
          const groupContextTip = Config.groupContextTip
          let botName = e.isGroup ? (e.group.pickMember(getUin(e)).card || e.group.pickMember(getUin(e)).nickname) : e.bot.nickname

          system = system.replaceAll(namePlaceholder, botName || defaultBotName) +
            ((opt.settings.enableGroupContext && e.group_id) ? groupContextTip : '')
          system += 'Attention, you are currently chatting in a qq group, then one who asks you now is' + `${e.sender.card || e.sender.nickname}(${e.sender.user_id}).`
          system += `the group name is ${e.group.name || e.group_name}, group id is ${e.group_id}.`
          system += `Your nickname is ${botName} in the group,`
          if (chats) {
            system += 'There is the conversation history in the group, you must chat according to the conversation history context"'
            system += chats
              .map(chat => {
                let sender = chat.sender || {}
                return `【${sender.card || sender.nickname}】(qq：${sender.user_id}, ${roleMap[sender.role] || 'normal user'}，${sender.area ? 'from ' + sender.area + ', ' : ''} ${sender.age} years old, 群头衔：${sender.title}, gender: ${sender.sex}, time：${formatDate(new Date(chat.time * 1000))}, messageId: ${chat.message_id}) 说：${chat.raw_message}`
              })
              .join('\n')
          }
        }
        option.system = system
        // let img = await parseSourceImg(e)
        if (e.img && e.img.length > 0 && Config.mediaRecognitionSource == "Orignal") {
          let imageUrl = e.img ? e.img[0] : undefined;
          if (imageUrl) {
            const base64String = await getImageBase64(imageUrl);
            if (base64String) {
              option.media = {
                mimeType: 'image/jpeg',
                data: base64String
              };
            }
          }
        }
        try {
          let rsp = await client.sendMessage(promptForClaude, option)
          return rsp
        } catch (err) {
          errorMessage = err.message
          switch (err.message) {
            case 'rate_limit_error': {
              // api没钱了或者当月/日/时/分额度耗尽
              // throw new Error('claude API额度耗尽或触发速率限制')
              break
            }
            case 'authentication_error': {
              // 无效的key
              // throw new Error('claude API key无效')
              break
            }
            default:
          }
          logger.warn(`claude api 错误：[${key}] ${errorMessage}`)
        }
        if (keys.length === 0) {
          throw new Error(errorMessage)
        }
        keys.splice(choiceIndex, 1)
        choiceIndex = Math.floor(Math.random() * keys.length)
        key = keys[choiceIndex]
        logger.info(`使用API Key：${key}`)
      }
    } else if (use === 'gemini') { // 使用接口 ##############################
      let client = new CustomGoogleGeminiClient({
        e,
        userId: e.sender.user_id,
        key: Config.getGeminiKey,
        model: Config.geminiModel,
        baseUrl: Config.geminiBaseUrl,
        debug: Config.debug
      })
      let option = {
        stream: false,
        onProgress: (data) => {
          if (Config.debug) {
            logger.info(JSON.stringify(data, null, 2))
          }
        },
        parentMessageId: conversation.parentMessageId,
        conversationId: conversation.conversationId,
        search: Config.geminiEnableGoogleSearch, // Gemini 原生搜索，开启后无法使用智能模式，默认关闭
        codeExecution: Config.geminiEnableCodeExecution, // Gemini 原生代码执行，开启后无法使用智能模式，默认关闭
        paimon_globalInnerOs: Config.paimon_globalInnerOs,
        thinkingLevel: Config.geminiThinkingLevel || ''
      }

      // 记录点: opt.media
      if (Config.mediaRecognitionSource == "Orignal") {
        // const image = await parseSourceImg(e)
        let imageUrl = e.img ? e.img[0] : undefined;
        if (imageUrl) {
          const base64String = await getImageBase64(imageUrl);
          if (base64String) {
            option.media = {
              mimeType: 'image/jpeg',
              data: base64String
            };
          }
        }
      }

      if (opt.enableSmart) {
        const {
          funcMap
        } = await collectTools(e)
        let tools = Object.keys(funcMap).map(k => funcMap[k].tool)
        client.addTools(tools)
      }
      let system = opt.system.gemini

      system = mergeSystemPrompt(system, e, { replyTimestamps: conversation.replyTimestamps })

      if (opt.settings.enableGroupContext && e.isGroup) {
        let chats = await msgHistoryMgr.getGroupHistoryContext(e, Config.groupContextLength)
        const namePlaceholder = '[name]'
        const defaultBotName = 'GeminiPro'
        const groupContextTip = Config.groupContextTip
        let botName = e.isGroup ? (e.group.pickMember(getUin(e)).card || e.group.pickMember(getUin(e)).nickname) : e.bot.nickname
        system = system.replaceAll(namePlaceholder, botName || defaultBotName) +
          ((opt.settings.enableGroupContext && e.group_id) ? groupContextTip : '')
        system += 'Attention, you are currently chatting in a qq group, then one who asks you now is' + `${e.sender.card || e.sender.nickname}(${e.sender.user_id}).`
        system += `the group name is ${e.group.name || e.group_name}, group id is ${e.group_id}.`
        system += `Your nickname is ${botName} in the group,`
        if (chats) {
          system += 'There is the conversation history in the group, you must chat according to the conversation history context"'
          system += chats
            .map(chat => {
              let sender = chat.sender || {}
              return `【${sender.card || sender.nickname}】(qq：${sender.user_id}, ${roleMap[sender.role] || 'normal user'}，${sender.area ? 'from ' + sender.area + ', ' : ''} ${sender.age} years old, 群头衔：${sender.title}, gender: ${sender.sex}, time：${formatDate(new Date(chat.time * 1000))}, messageId: ${chat.message_id}) 说：${chat.raw_message}`
            })
            .join('\n')
        }
      }
      option.system = system
      option.replyPureTextCallback = opt.settings.replyPureTextCallback || (async (msg) => {
        if (msg) {
          await e.reply(msg, true)
        }
      })
      const forceToolByKeyword = Config.enableForceToolKeywords !== false &&
        Config.geminiForceToolKeywords?.find(k => prompt?.includes(k))
      option.toolMode = (opt.settings.forceTool || forceToolByKeyword) ? 'ANY' : 'AUTO'

      // 导入更多 gemini config
      option.temperature = Config.gemini_temperature
      option.sf_markdownPic = Config.sf_markdownPic
      option.auto_makeForwardMsg = Config.auto_makeForwardMsg

      return await client.sendMessage(prompt, option)
    } else if (use === 'responses') { // OpenAI Responses API ##############################
      const completionParams = {}
      if (Config.responsesModel) completionParams.model = Config.responsesModel
      if (Config.responsesReasoningEffort) completionParams.reasoning_effort = Config.responsesReasoningEffort
      if (typeof Config.responsesTemperature === 'number') completionParams.temperature = Config.responsesTemperature

      let extraSystemMessage = ''
      const buildResponsesInstructions = async (groupContextLength = Config.groupContextLength) => {
        let instructions = await handleSystem(e, opt.system.responses || Config.responsesSystemPrompt, {
          ...opt.settings,
          groupContextLength
        })
        instructions = mergeSystemPrompt(instructions, e, { replyTimestamps: conversation.replyTimestamps })
        if (extraSystemMessage) instructions += extraSystemMessage
        return instructions
      }

      const client = new ResponsesAPI({
        apiBaseUrl: Config.responsesApiBaseUrl,
        apiKey: Config.responsesApiKey,
        debug: false,
        fetch: newFetch,
        maxResponseTokens: Config.responsesApiMaxToken,
        maxModelTokens: Config.responsesMaxModelTokens
      })
      let instructions = await buildResponsesInstructions()

      let imageDataUrl = null
      const imageUrl = e.img ? e.img[0] : undefined
      if (imageUrl && Config.mediaRecognitionSource === 'Orignal') {
        try {
          const base64String = await getImageBase64(imageUrl)
          if (base64String) imageDataUrl = `data:image/jpeg;base64,${base64String}`
        } catch (err) {
          logger.error('Responses API 获取图片失败', err)
        }
      }

      let isAdmin
      let sender
      let fullFuncMap = {}
      if (opt.enableSmart) {
        isAdmin = ['admin', 'owner'].includes(e.sender.role)
        sender = e.sender.user_id
        const { funcMap, fullFuncMap: collectedFullFuncMap, promptAddition, systemAddition } = await collectTools(e)
        fullFuncMap = collectedFullFuncMap
        promptAddition && (prompt += promptAddition)
        extraSystemMessage = systemAddition || ''
        instructions = await buildResponsesInstructions()
        completionParams.tools = Object.values(funcMap).map(({ function: definition }) => ({
          type: 'function',
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
          // 现有工具 schema 并不全部满足 strict 模式约束，保留 Chat API 的最佳努力行为。
          strict: false
        }))
        if (Config.enableForceToolKeywords !== false && Array.isArray(Config.geminiForceToolKeywords)) {
          const inputText = prompt || e.msg || ''
          if (Config.geminiForceToolKeywords.some(keyword => inputText.includes(keyword))) {
            completionParams.tool_choice = 'required'
          }
        }
      }

      const initialInput = imageDataUrl
        ? [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt || '请描述这张图片' },
            { type: 'input_image', image_url: imageDataUrl }
          ]
        }]
        : prompt
      const statelessToolInput = Array.isArray(initialInput)
        ? [...initialInput]
        : [{ role: 'user', content: initialInput }]

      const sendResponsesWithContextFallback = async (input, sendOptions) => {
        const retryLengths = opt.settings.enableGroupContext
          ? getRetryGroupContextLengths(Config.groupContextLength)
          : []
        for (let i = 0; i <= retryLengths.length; i++) {
          try {
            return await client.sendMessage(input, sendOptions)
          } catch (err) {
            const isContextExceeded = err.message?.includes('context_length_exceeded')
            if (!isContextExceeded || i >= retryLengths.length) throw err
            const nextGroupContextLength = retryLengths[i]
            logger.warn(`[chatgpt][Responses] 上下文超限，压缩群聊记录后重试，groupContextLength=${nextGroupContextLength}`)
            sendOptions.instructions = await buildResponsesInstructions(nextGroupContextLength)
          }
        }
      }

      const sendOptions = {
        timeoutMs: 600000,
        instructions,
        completionParams,
        store: Config.responsesStore === true,
        previousResponseId: Config.responsesStore ? conversation.previousResponseId : undefined
      }

      try {
        let msg = await sendResponsesWithContextFallback(initialInput, sendOptions)
        let toolRoundCount = 0
        const maxToolRounds = Config.llm_maxToolRounds

        while (msg.toolCalls?.length > 0 && toolRoundCount < maxToolRounds) {
          toolRoundCount++
          if (msg.text) await this.reply((msg.text.replace(/\n{2,}/g, '\n')).trim())

          const toolResults = await executeResponsesToolCalls(this, e, msg.toolCalls, fullFuncMap, isAdmin, sender, toolRoundCount)
          if (completionParams.tool_choice === 'required') delete completionParams.tool_choice

          if (Config.responsesStore) {
            sendOptions.previousResponseId = msg.id
            msg = await sendResponsesWithContextFallback(toolResults, sendOptions)
          } else {
            statelessToolInput.push(...msg.responseOutput, ...toolResults)
            msg = await sendResponsesWithContextFallback(statelessToolInput, sendOptions)
          }
        }

        if (msg.toolCalls?.length > 0 && toolRoundCount >= maxToolRounds) {
          logger.warn(`Responses API 工具调用已达最大轮次上限 ${maxToolRounds} 轮，强制终止工具循环`)
          msg.toolCalls = undefined
          msg.functionCall = undefined
        }
        return msg
      } catch (err) {
        if (err.message?.includes('context_length_exceeded')) {
          logger.warn(err)
          await this.reply('字数超限啦，将为您自动结束本次对话。')
          return null
        }
        logger.error(err)
        throw err
      }
    } else { // 使用接口 ##############################
      // openai api
      let completionParams = {}
      if (Config.model) {
        completionParams.model = Config.model
      }
      if (Config.reasoningEffort) {
        completionParams.reasoning_effort = Config.reasoningEffort
      }
      const currentDate = new Date().toISOString().split('T')[0]
      let promptPrefix = `You are ${Config.assistantLabel} ${useCast?.api || opt.system.api || defaultPropmtPrefix}
        Current date: ${currentDate}`
      // let maxModelTokens = getMaxModelTokens(completionParams.model)
      // let system = promptPrefix
      let extraSystemMessage = ''
      const buildOpenAISystem = async (groupContextLength = Config.groupContextLength) => {
        let system = await handleSystem(e, promptPrefix, {
          ...opt.settings,
          groupContextLength
        })
        system = mergeSystemPrompt(system, e, { replyTimestamps: conversation.replyTimestamps })
        if (extraSystemMessage) {
          system += extraSystemMessage
        }
        return system
      }
      let system = await buildOpenAISystem()

      logger.debug(system)
      let opts = {
        apiBaseUrl: Config.openAiBaseUrl,
        apiKey: Config.apiKey,
        debug: false,
        upsertMessage,
        getMessageById,
        systemMessage: system,
        completionParams,
        assistantLabel: Config.assistantLabel,
        fetch: newFetch,
        maxModelTokens: Config.maxModelTokens,
        maxResponseTokens: Config.apiMaxToken,
        chatgptBlockCount: Config.chatgptBlockCount,
      }

      // if (!Config.openAiForceUseReverse) {
      //   let openAIAccessible = (Config.proxy || !(await isCN())) // 配了代理或者服务器在国外，默认认为不需要反代
      //   if (opts.apiBaseUrl !== defaultOpenAIAPI && openAIAccessible) {
      //     // 如果配了proxy(或者不在国内)，而且有反代，但是没开启强制反代,将baseurl删掉
      //     delete opts.apiBaseUrl
      //   }
      // }

      // const client = new OpenAI({
      //   apiKey: Config.apiKey,
      //   baseURL: opts.apiBaseUrl,
      //   fetch: newFetch
      // })

      this.chatGPTApi = new ChatGPTAPI(opts)
      let option = {
        timeoutMs: 600000,
        completionParams,
        stream: Config.apiStream,
        onProgress: (data) => {
          if (Config.debug) {
            logger.info(JSON.stringify((data?.text || data.functionCall || data), null, 2))
          }
        }
        // systemMessage: promptPrefix
      }
      option.systemMessage = system
      option.paimon_globalInnerOs = Config.paimon_globalInnerOs
      if (conversation) {
        if (!conversation.conversationId) {
          conversation.conversationId = uuid()
        }
        option = Object.assign(option, conversation)
      }

      /** 定义OpenAI格式请求 */
      const sendOpenAIWithContextFallback = async (messageContent, sendOption) => {
        const retryLengths = opt.settings.enableGroupContext
          ? getRetryGroupContextLengths(Config.groupContextLength)
          : []

        for (let i = 0; i <= retryLengths.length; i++) {
          try {
            // logger.mark(`messageContent:\n` + JSON.stringify(messageContent, null, 2))
            // logger.mark(`sendOption:\n` + JSON.stringify(sendOption, null, 2))
            return await this.chatGPTApi.sendMessage(messageContent, sendOption)
          } catch (err) {
            const isContextExceeded = err.message?.indexOf('context_length_exceeded') > 0
            if (!isContextExceeded || i >= retryLengths.length) {
              throw err
            }
            const nextGroupContextLength = retryLengths[i]
            logger.warn(`[chatgpt] 上下文超限，压缩群聊记录后重试，groupContextLength=${nextGroupContextLength}。若频繁出现，请检查锅巴中的“回复内容最大Token数(apiMaxToken)”与“模型总上下文Token数(maxModelTokens)”配置是否过紧。`)
            sendOption.systemMessage = await buildOpenAISystem(nextGroupContextLength)
          }
        }
      }

      let imageDataUrl = null;
      let imageUrl = e.img ? e.img[0] : undefined;
      if (imageUrl && Config.mediaRecognitionSource == "Orignal") {
        try {
          const base64String = await getImageBase64(imageUrl);
          if (base64String) {
            // mimeType == "gif" 会报错，强制使用这个
            const mimeType = 'image/jpeg';
            // OpenAI API 要求格式: data:image/jpeg;base64,{base64_string}
            imageDataUrl = `data:${mimeType};base64,${base64String}`;
          }
        } catch (err) {
          logger.error('OpenAI 获取图片失败', err);
        }
      }

      if (opt.enableSmart) {
        let isAdmin = ['admin', 'owner'].includes(e.sender.role)
        let sender = e.sender.user_id
        const {
          funcMap,
          fullFuncMap,
          promptAddition,
          systemAddition
        } = await collectTools(e)
        if (!option.completionParams) {
          option.completionParams = {}
        }
        promptAddition && (prompt += promptAddition)
        systemAddition && (option.systemMessage += systemAddition)
        option.completionParams.tools = Object.keys(funcMap).map(k => ({
          type: "function",
          function: funcMap[k].function
        }))
        extraSystemMessage = systemAddition || ''
        option.systemMessage = await buildOpenAISystem()

        let msg
        try {
          // 强制调用工具 // 可能有用吧
          if (Config.enableForceToolKeywords !== false && Config.geminiForceToolKeywords && Array.isArray(Config.geminiForceToolKeywords)) {
            let inputText = prompt || e.msg || "";
            if (Config.geminiForceToolKeywords.some(keyword => inputText.includes(keyword))) {
              // "required" 是 OpenAI 官方参数，意为强制模型必须调用 tools 里的至少一个工具
              option.completionParams.tool_choice = "required";
            }
          }

          let messageContent = prompt;
          if (imageDataUrl) {
            // 当图片存在时，重组数据为多模态数组
            messageContent = [
              { type: 'text', text: prompt || '请描述这张图片' },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ];
          }

          msg = await sendOpenAIWithContextFallback(messageContent, option)

          if (Config.debug) // 避免控制台刷屏
            logger.info(JSON.stringify(msg, null, 2))

          /** 工具调用轮次计数器 */
          let toolRoundCount = 0
          /** 工具调用最大轮次数 */
          const maxToolRounds = Config.llm_maxToolRounds
          // 只要模型返回了需要调用工具，且没有超过最大轮次，就继续循环
          while ((msg.functionCall || (msg.toolCalls && msg.toolCalls.length > 0)) && toolRoundCount < maxToolRounds) {
            toolRoundCount++

            if (msg.text) {
              await this.reply((msg.text.replace(/\n{2,}/g, '\n')).trim())
            }

            const pendingToolCalls = msg.toolCalls?.length
              ? msg.toolCalls
              : (msg.functionCall
                ? [{
                  id: `legacy_${crypto.randomUUID()}`,
                  type: 'function',
                  function: msg.functionCall
                }]
                : [])

            if (pendingToolCalls.length === 0) {
              break
            }

            const toolMessages = [{
              id: msg.id,
              role: 'assistant',
              text: msg.text || '',
              originalContent: msg.originalContent ?? (msg.text || null),
              parentMessageId: msg.parentMessageId,
              conversationId: msg.conversationId,
              functionCall: msg.functionCall,
              toolCalls: pendingToolCalls
            }]
            let previousMessageId = msg.id
            const toolForwardRecords = []

            for (const toolCall of pendingToolCalls) {
              let name = toolCall.function.name
              let args
              try {
                args = JSON.parse(toolCall.function.arguments)
              } catch (e) {
                args = {}
              }

              logger.info(`[Chatgpt][API] execution function: ${JSON.stringify({ name, args })}`)
              const toolArgsForForward = { ...args }

              if (!args.groupId) {
                args.groupId = e.group_id + '' || e.sender.user_id + ''
              }
              try {
                parseInt(args.groupId)
              } catch (err) {
                args.groupId = e.group_id + '' || e.sender.user_id + ''
              }

              let functionResult = ''
              try {
                if (fullFuncMap[name.trim()]) {
                  functionResult = await fullFuncMap[name.trim()].exec.bind(this)(Object.assign({
                    isAdmin,
                    sender
                  }, args), e)
                  logger.info(`[Chatgpt][API] function ${name} execution result: ${JSON.stringify(functionResult)}`)
                } else {
                  functionResult = `Function ${name} not found.`
                  logger.warn(functionResult)
                }
              } catch (err) {
                functionResult = `Error executing function ${name}: ${err.message}`
                logger.error(functionResult)
              }

              toolForwardRecords.push({
                platform: 'OpenAI API',
                round: toolRoundCount,
                name,
                args: toolArgsForForward,
                result: functionResult
              })

              const toolMessageId = crypto.randomUUID()
              toolMessages.push({
                id: toolMessageId,
                role: 'tool',
                text: String(functionResult),
                originalContent: String(functionResult),
                parentMessageId: previousMessageId,
                conversationId: msg.conversationId,
                toolCallId: toolCall.id
              })
              previousMessageId = toolMessageId
            }

            sendToolCallForwardMsg(e, toolForwardRecords, 'OpenAI API工具调用与返回')

            option.parentMessageId = msg.id
            option.appendMessages = toolMessages

            // 拿到工具结果后重置 tool_choice 参数，允许大模型输出自然语言回答，防止死循环无限调用工具
            if (option.completionParams && option.completionParams.tool_choice === "required") {
              delete option.completionParams.tool_choice
            }

            // 不然普通用户可能会被openai限速
            await common.sleep(300)

            // 将所有并行工具的结果一次性POST回给API，进入下一轮
            msg = await sendOpenAIWithContextFallback(null, option)

            if (Config.debug)
              logger.info(JSON.stringify(msg, null, 2))
          }

          // 判断退出原因，如果是达到最大轮次强制退出的，打印警告
          if ((msg.functionCall || (msg.toolCalls && msg.toolCalls.length > 0)) && toolRoundCount >= maxToolRounds) {
            logger.warn(`工具调用已达最大轮次上限 ${maxToolRounds} 轮，强制终止工具循环`)
            // 清除残留的 tool_calls，防止返回含 tool_calls 但无对应 tool response 的消息破坏对话历史
            msg.functionCall = undefined
            msg.toolCalls = undefined
            // 同步更新 Redis 中已存储的消息副本，防止下一轮加载历史时仍携带 tool_calls
            upsertMessage(msg).catch(err => logger.warn('[chatgpt] 清理存储中的工具调用记录失败', err))
          }
        } catch (err) {
          if (err.message?.indexOf('context_length_exceeded') > 0) {
            logger.warn(err)
            await redis.del(`CHATGPT:CONVERSATIONS:${e.sender.user_id}`)
            await redis.del(`CHATGPT:WRONG_EMOTION:${e.sender.user_id}`)
            await this.reply('字数超限啦，将为您自动结束本次对话。')
            return null
          } else {
            logger.error(err)
            throw new Error(err)
          }
        }
        return msg
      } else {
        let msg
        try {
          let messageContent = prompt;
          if (imageDataUrl) {
            messageContent = [
              { type: 'text', text: prompt || '请描述这张图片' },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ];
          }
          msg = await sendOpenAIWithContextFallback(messageContent, option)
        } catch (err) {
          if (err.message?.indexOf('context_length_exceeded') > 0) {
            logger.warn(err)
            await redis.del(`CHATGPT:CONVERSATIONS:${e.sender.user_id}`)
            await redis.del(`CHATGPT:WRONG_EMOTION:${e.sender.user_id}`)
            await this.reply('字数超限啦，将为您自动结束本次对话。')
            return null
          } else {
            logger.error(err)
            throw new Error(err)
          }
        }
        return msg
      }
    }
  }
}

/** 执行 Responses API 请求的本地工具，并转换成 function_call_output items。 */
async function executeResponsesToolCalls(core, e, toolCalls, fullFuncMap, isAdmin, sender, round) {
  const toolForwardRecords = []
  const toolResults = []

  for (const toolCall of toolCalls) {
    const name = toolCall.function?.name || ''
    let args
    try {
      args = JSON.parse(toolCall.function?.arguments || '{}')
    } catch {
      args = {}
    }

    const toolArgsForForward = { ...args }
    if (!args.groupId) args.groupId = e.group_id + '' || e.sender.user_id + ''
    try {
      parseInt(args.groupId)
    } catch {
      args.groupId = e.group_id + '' || e.sender.user_id + ''
    }

    let functionResult = ''
    try {
      if (fullFuncMap[name.trim()]) {
        functionResult = await fullFuncMap[name.trim()].exec.bind(core)(Object.assign({ isAdmin, sender }, args), e)
        logger.info(`[Chatgpt][Responses] function ${name} execution result: ${JSON.stringify(functionResult)}`)
      } else {
        functionResult = `Function ${name} not found.`
        logger.warn(functionResult)
      }
    } catch (err) {
      functionResult = `Error executing function ${name}: ${err.message}`
      logger.error(functionResult)
    }

    toolForwardRecords.push({
      platform: 'OpenAI Responses API',
      round,
      name,
      args: toolArgsForForward,
      result: functionResult
    })
    toolResults.push({
      type: 'function_call_output',
      call_id: toolCall.callId || toolCall.id,
      output: String(functionResult)
    })
  }

  sendToolCallForwardMsg(e, toolForwardRecords, 'OpenAI Responses API工具调用与返回')
  return toolResults
}

/**
 * 收集tools
 * @param e
 * @return {Promise<{systemAddition, funcMap: {}, promptAddition: string, fullFuncMap: {}}>}
 */
async function collectTools(e) {
  /** 搜索/网络来源 总工具 */
  const serpToolMap = {
    'geminiSearchTool': GeminiSearchTool,
    'tavily_search': TavilyTool,
    'misaka_WebSearchTool': Misaka_WebSearchTool,
    'ikechan8370': SerpIkechan8370Tool, // 该工具使用的 url 不再提供服务
    'azure': azureSerpTool,
    'local_WebsiteTool': WebsiteTool,
    'tavily_WebsiteTool': TavilyExtractTool,
    'Weather_Tool': WeatherTool,
    'Send163_MusicTool': SendNetEaseMusicTool,
    'SendQQ_MusicTool': SendQQMusicTool,
    'BaiduAI_SearchTool': BaiduAISearchTool,
    'GithubAPI': GithubAPITool,
  }
  /** 搜索/网络来源 */
  let serpTools = Object.entries(serpToolMap)
    .filter(([key]) => Config.serpSourceArr.includes(key))
    .map(([_, ToolClass]) => new ToolClass());

  /** 默认工具 */
  const defaultToolMap = {
    'SendPicture': SendPictureTool,
    'SendVideo': SendVideoTool,
    'QueryUserinfo': QueryUserinfoTool,
    'BlockUser': BlockUserTool,
  }
  let defaultTools = Object.entries(defaultToolMap)
    .filter(([key]) => Config.toolDefaultArr.includes(key))
    .map(([_, ToolClass]) => new ToolClass());

  /** 游戏查询工具 */
  const gameQueryToolMap = {
    'QueryStarRail': QueryStarRailTool,
    'QueryGenshin': QueryGenshinTool,
  }
  let gameQueryTools = Object.entries(gameQueryToolMap)
    .filter(([key]) => Config.toolGameQueryArr.includes(key))
    .map(([_, ToolClass]) => new ToolClass());

  /** 群管理工具 */
  const groupAdminToolMap = {
    'EditCard': EditCardTool,
    'Jinyan': JinyanTool,
    'KickOut': KickOutTool,
    'SetTitle': SetTitleTool,
    'HandleMsg': HandleMessageMsgTool,
  }
  let groupAdminTools = Object.entries(groupAdminToolMap)
    .filter(([key]) => Config.toolGroupAdminArr.includes(key))
    .map(([_, ToolClass]) => new ToolClass());

  /** 图片/视频搜索工具（由搜索/网络来源配置控制） */
  const serpExtraToolMap = {
    'SerpImageTool_Baidu': SerpImageTool_by_baidu,
    'SerpImageTool_Bing': SerpImageTool_by_bing,
    'Bilibili_SearchVideoTool': BilibiliSearchVideoTool,
  }
  let serpExtraTools = Object.entries(serpExtraToolMap)
    .filter(([key]) => Config.serpSourceArr.includes(key))
    .map(([_, ToolClass]) => new ToolClass());

  /** fullTools 包括了踢人等管理员用的工具 */
  let fullTools = [
    new APTool(),
    ...defaultTools,
    ...gameQueryTools,
    ...groupAdminTools,
    ...serpExtraTools,
    ...serpTools,
  ]

  let /** @type{AbstractTool[]} **/ tools = [ // Gemini 只有取 tools，不取 fullTools
    new APTool(),
    ...defaultTools,
    ...gameQueryTools,
    ...serpExtraTools,
    ...serpTools,
  ]

  /** 可选工具 */
  const optionalTools = [
    { condition: !Config.disable_sendMessage_tool, ToolClass: SendMessageToSpecificGroupOrUserTool },
    { condition: !Config.disable_SendAvatarTool, ToolClass: SendAvatarTool },
    { condition: Config.switch_atOtherUserTool, ToolClass: AtOtherUserTool },
    { condition: Config.poke_userIDs, ToolClass: SendGroupPokeTool },
    { condition: Config.agent_MarkmapToolSwitch, ToolClass: GenerateMarkmapTool },
    { condition: Config.agent_SandboxSwitch, ToolClass: SandboxJSTool },
    { condition: Config.agent_LocalSandboxSwitch && (!Config.localSandboxMasterOnly || e.isMaster), ToolClass: LocalSandboxTool },
    { condition: Config.agent_RemoteSandboxSwitch && (!Config.remoteSandboxMasterOnly || e.isMaster), ToolClass: RemoteSandboxTool },
    { condition: Config.agent_VercelSandboxSwitch && (!Config.vercelSandboxMasterOnly || e.isMaster), ToolClass: VercelSandboxTool },
    { condition: Config.getPixivTool, ToolClass: GetPixivApiLoliconTool },
    { condition: Config.switch_EmojiTool, ToolClass: EmojiTool },
    { condition: Config.enableMemory, ToolClass: MemoryTool },
    { condition: Config.enableEmojiLikeTool, ToolClass: EmojiLikeTool },
    { condition: Config.mediaRecognitionGeminiTool, ToolClass: RecognitionResultsByGeminiTool },
    { condition: Config.ScheduleTask_Tool, ToolClass: ScheduleTaskTool },
    { condition: Config.TTSAudio_Tool, ToolClass: TTSAudioTool },
    { condition: Config.enableUserProfileTool, ToolClass: UserProfileTool },
    { condition: Config.enableGroupMemberSkillTool && e?.isGroup && e?.isMaster, ToolClass: GroupMemberSkillTool },
    { condition: Config.generateMathRender_ToolSwitch, ToolClass: GenerateMathRenderTool },
    { condition: Config.generateGraphCalculator_ToolSwitch, ToolClass: GenerateGraphCalculatorTool },
    { condition: Config.anythingllm_enable, ToolClass: AnythingLLMQueryTool },
    { condition: Config.anythingllm_enable, ToolClass: AnythingLLMWorkspaceTool },
  ];

  optionalTools.forEach(({ condition, ToolClass }) => {
    if (condition) {
      tools.push(new ToolClass())
      fullTools.push(new ToolClass())
    }
  });

  if (Config.enableDefaultMessageTriggerTool) {
    const defaultMessageTool = new DefaultMessageTriggerTool(e)
    if (defaultMessageTool.allowedKeywords.size > 0) {
      tools.push(defaultMessageTool)
      fullTools.push(defaultMessageTool)
    }
  }

  // 加载已启用的通用 MCP 工具
  if (Config.enableMcp) {
    try {
      const mcpTools = McpManager.getTools()
      mcpTools.forEach(mcpTool => {
        tools.push(mcpTool)
        fullTools.push(mcpTool)
      })
    } catch (err) {
      logger.error(`[Chatgpt][mcp] 加载 MCP 工具到对话失败: ${err.message}`)
    }
  }

  let systemAddition = ''
  if (e.isGroup) {
    let botInfo = await e.bot?.pickMember?.(e.group_id, getUin(e)) || await e.bot?.getGroupMemberInfo?.(e.group_id, getUin(e))
    if (['admin', 'owner'].includes(botInfo.role)) {
      /** 当Bot是管理员才给这些工具（不用担心误伤，普通群成员只能对自己禁言>_<） */
      const allowedAdminKeys = ['EditCard', 'Jinyan', 'SetTitle']
      /** 当Bot是管理员+当用户是管理员才给这些工具 */
      const masterOnlyKeys = ['KickOut', 'HandleMsg']
      Object.entries(groupAdminToolMap)
        .filter(([key]) => Config.toolGroupAdminArr.includes(key))
        .filter(([key]) => {
          if (masterOnlyKeys.includes(key)) {
            return e.isMaster || ['admin', 'owner'].includes(e.sender.role)
          }
          return allowedAdminKeys.includes(key)
        })
        .forEach(([_, ToolClass]) => tools.push(new ToolClass()))
      // 用于撤回和加精的id
      if (e.source?.seq) {
        let source = (await e.group.getChatHistory(e.source?.seq, 1)).pop()
        systemAddition += `\nthe last message is replying to ${source.message_id}"\n`
      } else {
        systemAddition += `\nthe last message id is ${e.message_id}. `
      }
    }
  }

  let promptAddition = ''
  // let img = await parseSourceImg(e)
  if (e.img?.length > 0) {
    // tools.push(new ImageCaptionTool())
    // tools.push(new ProcessPictureTool())

    // 检查 e.img 的大小，如果太大可能是 base64 那么就不附加上了
    const isImgUrlValid = Array.isArray(e?.img) && !e.img.some(item => typeof item === 'string' && item.length > 1000);
    if (isImgUrlValid) {
      promptAddition += `\nthe url of the picture(s) above: ${e.img.join(', ')}`;
    }
  }

  const buildFuncMap = (toolArray) => {
    return Object.fromEntries(
      toolArray.map(tool => [
        tool.name,
        { exec: tool.func, function: tool.function(), tool }
      ])
    )
  }

  return {
    funcMap: buildFuncMap(tools),
    fullFuncMap: buildFuncMap(fullTools),
    systemAddition,
    promptAddition
  }
}

/** 呆毛版 在 prompt 中替换文本使用 e.sender 信息 */
function replacePromptForSenderMsg(e, systemMsg = "") {
  const getCurrentDate = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const getCurrentTime = () => {
    const date = new Date();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };
  systemMsg = systemMsg.replace(/_sender_name_/igm, e.sender.card || e.sender.nickname)
  systemMsg = systemMsg.replace(/_sender_id_/igm, e.sender.user_id)
  systemMsg = systemMsg.replace(/_sender_gender_/igm, e.sender.sex)
  systemMsg = systemMsg.replace(/_sender_age_/igm, e.sender.age)
  systemMsg = systemMsg.replace(/_sender_area_/igm, e.sender.area)
  systemMsg = systemMsg.replace(/_sender_role_/igm, `${e.sender.role == "owner" ? '群主' : `${e.sender.role == "admin" ? '管理员' : ''}`}`)
  systemMsg = systemMsg.replace(/_sender_title_/igm, e.sender.title)
  systemMsg = systemMsg.replace(/_date_/igm, getCurrentDate())
  systemMsg = systemMsg.replace(/_time_/igm, getCurrentTime())
  systemMsg = systemMsg.replace(/_sender_groupid_/igm, e.group_id || e.sender.user_id)
  return systemMsg;
}

export default new Core()
