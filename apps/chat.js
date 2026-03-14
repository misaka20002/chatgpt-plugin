import plugin from '../../../lib/plugins/plugin.js'
import common from '../../../lib/common/common.js'
import _ from 'lodash'
import { Config } from '../utils/config.js'
import AzureTTS from '../utils/tts/microsoft-azure.js'
import VoiceVoxTTS from '../utils/tts/voicevox.js'
import {
  completeJSON,
  formatDate,
  formatDate2,
  generateAudio,
  getDefaultReplySetting,
  getImageOcrText,
  parseSourceImg,
  getUin,
  getUserData,
  getUserReplySetting,
  isImage,
  makeForwardMsg,
  randomString,
  render,
  renderUrl
} from '../utils/common.js'

import fetch from 'node-fetch'
import { deleteConversation, getConversations, getLatestMessageIdByConversationId } from '../utils/conversation.js'
import { convertSpeaker, speakers } from '../utils/tts.js'
import { convertFacesAndCQCode } from '../utils/face.js'
import { ConversationManager, originalValues } from '../model/conversation.js'
import XinghuoClient from '../utils/xinghuo/xinghuo.js'
import { getProxy } from '../utils/proxy.js'
import { generateSuggestedResponse } from '../utils/chat.js'
import Core from '../model/core.js'
import { collectProcessors } from '../utils/postprocessors/BasicProcessor.js'
import {
  hidePrivacyInfo,
} from '../utils/paimonFuction.js'
import ChatCooldown from '../utils/chatCooldown.js'

let version = Config.version
let proxy = getProxy()
const isTrss = Array.isArray(Bot.uin)
const sleep_zz = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

import {
  recognitionResultsByGemini,
  convertSentenceToArray,
  extractCharacterName,
  splitString_Enter,
  processCQMessage,
} from '../utils/paimonFuction.js'

/**
 * 每个对话保留的时长。单个对话内ai是保留上下文的。超时后销毁对话，再次对话创建新的对话。
 * 单位：秒
 * @type {number}
 *
 * 这里使用动态数据获取，以便于锅巴动态更新数据
 */
// const CONVERSATION_PRESERVE_TIME = Config.conversationPreserveTime
const newFetch = (url, options = {}) => {
  const defaultOptions = Config.proxy
    ? {
      agent: proxy(Config.proxy)
    }
    : {}
  const mergedOptions = {
    ...defaultOptions,
    ...options
  }

  return fetch(url, mergedOptions)
}

export class chatgpt extends plugin {
  constructor(e) {
    let toggleMode = Config.toggleMode
    super({
      /** 功能名称 */
      name: 'ChatGpt 对话',
      /** 功能描述 */
      dsc: '与人工智能对话，畅聊无限可能~',
      event: 'message',
      /** 优先级，数字越小等级越高 */
      priority: 1144,
      rule: [
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?chat3[sS]*',
          /** 执行方法 */
          fnc: 'chatgpt3'
        },
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?chat1[sS]*',
          /** 执行方法 */
          fnc: 'chatgpt1'
        },
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?chatglm[sS]*',
          /** 执行方法 */
          fnc: 'chatglm'
        },
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?bing[sS]*',
          /** 执行方法 */
          fnc: 'bing'
        },
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?claude(2|3|.ai)[sS]*',
          /** 执行方法 */
          fnc: 'claude2'
        },
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?claude[sS]*',
          /** 执行方法 */
          fnc: 'claude'
        },
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?xh[sS]*',
          /** 执行方法 */
          fnc: 'xh'
        },
        {
          reg: '^#星火助手',
          fnc: 'newxhBotConversation'
        },
        {
          reg: '^#星火(搜索|查找)助手',
          fnc: 'searchxhBot'
        },
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?glm4[sS]*',
          /** 执行方法 */
          fnc: 'glm4'
        },
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?qwen[sS]*',
          /** 执行方法 */
          fnc: 'qwen'
        },
        {
          /** 命令正则匹配 */
          reg: '^#(图片)?gemini[sS]*',
          /** 执行方法 */
          fnc: 'gemini'
        },
        {
          /** 命令正则匹配 */
          reg: toggleMode === 'at' ? '^[^#][sS]*' : '^(#(图片)?chat[^gpt])[sS]*',
          /** 执行方法 */
          fnc: 'chatgpt',
          log: false
        },
        {
          /** 命令正则匹配 */
          reg: Config.tts_First_person,
          /** 执行方法 */
          fnc: 'chatgpt_for_firstperson_call',
          log: false
        },
        {
          reg: '^#(chatgpt)?对话列表$',
          fnc: 'getAllConversations',
          permission: 'master'
        },
        {
          reg: `^#?(${originalValues.join('|')})?(结束|新开|摧毁|毁灭|完结)对话([sS]*)$`,
          fnc: 'destroyConversations'
        },
        {
          reg: `^#?(${originalValues.join('|')})?(结束|新开|摧毁|毁灭|完结|清理)全部(模式)?对话$`,
          fnc: 'endAllConversations',
          permission: 'master'
        },
        // {
        //   reg: '#chatgpt帮助',
        //   fnc: 'help'
        // },
        {
          reg: '^#chatgpt图片模式$',
          fnc: 'switch2Picture'
        },
        {
          reg: '^#chatgpt文本模式$',
          fnc: 'switch2Text'
        },
        {
          reg: '^#chatgpt语音模式$',
          fnc: 'switch2Audio'
        },
        {
          reg: '^#chatgpt语音换源',
          fnc: 'switchTTSSource'
        },
        {
          reg: '^#chatgpt设置(语音角色|角色语音|角色)',
          fnc: 'setDefaultRole'
        },
        {
          reg: '#(OpenAI|openai)(剩余)?(余额|额度)',
          fnc: 'totalAvailable',
          permission: 'master'
        },
        {
          reg: '^#chatgpt切换对话',
          fnc: 'attachConversation'
        },
        {
          reg: '^#(chatgpt)?加入对话',
          fnc: 'joinConversation'
        },
        {
          reg: '^#chatgpt删除对话',
          fnc: 'deleteConversation',
          permission: 'master'
        }
      ]
    })
    this.toggleMode = toggleMode
    this.reply = async (msg, quote, data) => {
      if (!Config.enableMd) {
        return e.reply(msg, quote, data)
      }
      let handler = e.runtime?.handler || {}
      const btns = await handler.call('chatgpt.button.post', this.e, data)
      if (btns) {
        const btnElement = {
          type: 'button',
          content: btns
        }
        if (Array.isArray(msg)) {
          msg.push(btnElement)
        } else {
          msg = [msg, btnElement]
        }
      }

      return e.reply(msg, quote, data)
    }
  }

  /**
   * 获取chatgpt当前对话列表
   * @param e
   * @returns {Promise<void>}
   */
  async getConversations(e) {
    // todo 根据use返回不同的对话列表
    let keys = await redis.keys('CHATGPT:CONVERSATIONS:*')
    if (!keys || keys.length === 0) {
      await this.reply('当前没有人正在与机器人对话', true)
    } else {
      let response = '当前对话列表：(格式为【开始时间 ｜ qq昵称 ｜ 对话长度 ｜ 最后活跃时间】)\n'
      await Promise.all(keys.map(async (key) => {
        let conversation = await redis.get(key)
        if (conversation) {
          conversation = JSON.parse(conversation)
          response += `${conversation.ctime} ｜ ${conversation.sender.nickname} ｜ ${conversation.num} ｜ ${conversation.utime} \n`
        }
      }))
      await this.reply(`${response}`, true)
    }
  }

  /**
   * 销毁指定人的对话
   * @param e
   * @returns {Promise<void>}
   */
  async destroyConversations(e) {
    let manager = new ConversationManager(e)
    await manager.endConversation.bind(this)(e)
  }

  async endAllConversations(e) {
    let manager = new ConversationManager(e)
    await manager.endAllConversations.bind(this)(e)
  }

  async deleteConversation(e) {
    let ats = e.message.filter(m => m.type === 'at')
    let use = await redis.get('CHATGPT:USE') || 'api'
    if (use !== 'api3') {
      await this.reply('本功能当前仅支持API3模式', true)
      return false
    }
    if (ats.length === 0 || (ats.length === 1 && (e.atme || e.atBot))) {
      let conversationId = _.trimStart(e.msg, '#chatgpt删除对话').trim()
      if (!conversationId) {
        await this.reply('指令格式错误，请同时加上对话id或@某人以删除他当前进行的对话', true)
        return false
      } else {
        let deleteResponse = await deleteConversation(conversationId, newFetch)
        logger.mark(deleteResponse)
        let deleted = 0
        let qcs = await redis.keys('CHATGPT:QQ_CONVERSATION:*')
        for (let i = 0; i < qcs.length; i++) {
          if (await redis.get(qcs[i]) === conversationId) {
            await redis.del(qcs[i])
            if (Config.debug) {
              logger.info('delete conversation bind: ' + qcs[i])
            }
            deleted++
          }
        }
        await this.reply(`对话删除成功，同时清理了${deleted}个同一对话中用户的对话。`, true)
      }
    } else {
      for (let u = 0; u < ats.length; u++) {
        let at = ats[u]
        let qq = at.qq
        let atUser = _.trimStart(at.text, '@') || _.trimStart(at.name, '@');
        let conversationId = await redis.get('CHATGPT:QQ_CONVERSATION:' + qq)
        if (conversationId) {
          let deleteResponse = await deleteConversation(conversationId)
          if (Config.debug) {
            logger.mark(deleteResponse)
          }
          let deleted = 0
          let qcs = await redis.keys('CHATGPT:QQ_CONVERSATION:*')
          for (let i = 0; i < qcs.length; i++) {
            if (await redis.get(qcs[i]) === conversationId) {
              await redis.del(qcs[i])
              if (Config.debug) {
                logger.info('delete conversation bind: ' + qcs[i])
              }
              deleted++
            }
          }
          await this.reply(`${atUser}的对话${conversationId}删除成功，同时清理了${deleted}个同一对话中用户的对话。`)
        } else {
          await this.reply(`${atUser}当前已没有进行对话`)
        }
      }
    }
  }

  async switch2Picture(e) {
    let userReplySetting = await redis.get(`CHATGPT:USER:${e.sender.user_id}`)
    if (!userReplySetting) {
      userReplySetting = getDefaultReplySetting()
    } else {
      userReplySetting = JSON.parse(userReplySetting)
    }
    userReplySetting.usePicture = true
    userReplySetting.useTTS = false
    await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userReplySetting))
    await this.reply('ChatGPT回复已转换为图片模式')
  }

  async switch2Text(e) {
    let userSetting = await getUserReplySetting(this.e)
    userSetting.usePicture = false
    userSetting.useTTS = false
    await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userSetting))
    await this.reply('ChatGPT回复已转换为文字模式')
  }

  async switch2Audio(e) {
    switch (Config.ttsMode) {
      case 'vits-uma-genshin-honkai':
        if (!Config.ttsSpace) {
          await this.reply('您没有配置VITS API，请前往锅巴面板进行配置')
          return
        }
        break
      case 'azure':
        if (!Config.azureTTSKey) {
          await this.reply('您没有配置Azure Key，请前往锅巴面板进行配置')
          return
        }
        break
      case 'voicevox':
        if (!Config.voicevoxSpace) {
          await this.reply('您没有配置VoiceVox API，请前往锅巴面板进行配置')
          return
        }
        break
    }
    let userSetting = await getUserReplySetting(this.e)
    userSetting.useTTS = true
    userSetting.usePicture = false
    await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userSetting))
    await this.reply('ChatGPT回复已转换为语音模式')
  }

  async switchTTSSource(e) {
    let target = e.msg.replace(/^#chatgpt语音换源/, '')
    switch (target.trim()) {
      case '1': {
        Config.ttsMode = 'vits-uma-genshin-honkai'
        break
      }
      case '2': {
        Config.ttsMode = 'azure'
        break
      }
      case '3': {
        Config.ttsMode = 'voicevox'
        break
      }
      default: {
        await this.reply('请使用#chatgpt语音换源+数字进行换源。1为vits-uma-genshin-honkai，2为微软Azure，3为voicevox')
        return
      }
    }
    await this.reply('语音转换源已切换为' + Config.ttsMode)
  }

  async setDefaultRole(e) {
    if (Config.ttsMode === 'vits-uma-genshin-honkai' && !Config.ttsSpace) {
      await this.reply('您没有配置vits-uma-genshin-honkai API，请前往后台管理或锅巴面板进行配置')
      return
    }
    if (Config.ttsMode === 'azure' && !Config.azureTTSKey) {
      await this.reply('您没有配置azure 密钥，请前往后台管理或锅巴面板进行配置')
      return
    }
    if (Config.ttsMode === 'voicevox' && !Config.voicevoxSpace) {
      await this.reply('您没有配置voicevox API，请前往后台管理或锅巴面板进行配置')
      return
    }
    const regex = /^#chatgpt设置(语音角色|角色语音|角色)/
    let speaker = e.msg.replace(regex, '').trim() || '随机'
    switch (Config.ttsMode) {
      case 'vits-uma-genshin-honkai': {
        let userSetting = await getUserReplySetting(this.e)
        userSetting.ttsRole = convertSpeaker(speaker)
        if (speakers.indexOf(userSetting.ttsRole) >= 0) {
          await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userSetting))
          await this.reply(`当前语音模式为${Config.ttsMode},您的默认语音角色已被设置为 "${userSetting.ttsRole}" `)
        } else if (speaker === '随机') {
          userSetting.ttsRole = '随机'
          await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userSetting))
          await this.reply(`当前语音模式为${Config.ttsMode},您的默认语音角色已被设置为 "随机" `)
        } else {
          await this.reply(`抱歉，"${userSetting.ttsRole}"我还不认识呢.可发送:#tts可选人物列表`)
        }
        break
      }
      case 'azure': {
        let userSetting = await getUserReplySetting(this.e)
        let chosen = AzureTTS.supportConfigurations.filter(s => s.name === speaker)
        if (speaker === '随机') {
          userSetting.ttsRoleAzure = '随机'
          await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userSetting))
          await this.reply(`当前语音模式为${Config.ttsMode},您的默认语音角色已被设置为 "随机" `)
        } else if (chosen.length === 0) {
          await this.reply(`抱歉，没有"${speaker}"这个角色，目前azure模式下支持的角色有${AzureTTS.supportConfigurations.map(item => item.name).join('、')}`)
        } else {
          userSetting.ttsRoleAzure = chosen[0].code
          await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userSetting))
          // Config.azureTTSSpeaker = chosen[0].code
          const supportEmotion = AzureTTS.supportConfigurations.find(config => config.name === speaker)?.emotion
          await this.reply(`当前语音模式为${Config.ttsMode},您的默认语音角色已被设置为 ${speaker}-${chosen[0].gender}-${chosen[0].languageDetail} ${supportEmotion && Config.azureTTSEmotion ? '，此角色支持多情绪配置，建议重新使用设定并结束对话以获得最佳体验！' : ''}`)
        }
        break
      }
      case 'voicevox': {
        let regex = /^(.*?)-(.*)$/
        let match = regex.exec(speaker)
        let style = null
        if (match) {
          speaker = match[1]
          style = match[2]
        }
        let userSetting = await getUserReplySetting(e)
        if (speaker === '随机') {
          userSetting.ttsRoleVoiceVox = '随机'
          await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userSetting))
          await this.reply(`当前语音模式为${Config.ttsMode},您的默认语音角色已被设置为 "随机" `)
          break
        }
        let chosen = VoiceVoxTTS.supportConfigurations.filter(s => s.name === speaker)
        if (chosen.length === 0) {
          await this.reply(`抱歉，没有"${speaker}"这个角色，目前voicevox模式下支持的角色有${VoiceVoxTTS.supportConfigurations.map(item => item.name).join('、')}`)
          break
        }
        if (style && !chosen[0].styles.find(item => item.name === style)) {
          await this.reply(`抱歉，"${speaker}"这个角色没有"${style}"这个风格，目前支持的风格有${chosen[0].styles.map(item => item.name).join('、')}`)
          break
        }
        userSetting.ttsRoleVoiceVox = chosen[0].name + (style ? `-${style}` : '')
        await redis.set(`CHATGPT:USER:${e.sender.user_id}`, JSON.stringify(userSetting))
        await this.reply(`当前语音模式为${Config.ttsMode},您的默认语音角色已被设置为 "${userSetting.ttsRoleVoiceVox}" `)
        break
      }
    }
  }

  /**
   * #chatgpt
   */
  async chatgpt(e) {
    let msg = e.msg
    let prompt
    let forcePictureMode = false
    if (this.toggleMode === 'at') {
      if (!msg || e.msg?.startsWith('#')) {
        return false
      }
      if ((e.isGroup || e.group_id) && !(e.atme || e.atBot || (e.at === e.self_id))) {
        return false
      }
      if (e.user_id == getUin(e)) return false
      prompt = isTrss ? processCQMessage(e.raw_message, getUin(e)) : msg.trim()
      try {
        if (e.isGroup && !isTrss) {
          let mm = this.e.bot.gml
          let me = mm.get(getUin(e)) || {}
          let card = me.card
          let nickname = me.nickname
          if (nickname && card) {
            if (nickname.startsWith(card)) {
              // 例如nickname是"滚筒洗衣机"，card是"滚筒"
              prompt = prompt.replace(`@${nickname}`, '').trim()
            } else if (card.startsWith(nickname)) {
              // 例如nickname是"十二"，card是"十二｜本月已发送1000条消息"
              prompt = prompt.replace(`@${card}`, '').trim()
              // 如果是好友，显示的还是昵称
              prompt = prompt.replace(`@${nickname}`, '').trim()
            } else {
              // 互不包含，分别替换
              if (nickname) {
                prompt = prompt.replace(`@${nickname}`, '').trim()
              }
              if (card) {
                prompt = prompt.replace(`@${card}`, '').trim()
              }
            }
          } else if (nickname) {
            prompt = prompt.replace(`@${nickname}`, '').trim()
          } else if (card) {
            prompt = prompt.replace(`@${card}`, '').trim()
          }
        }
      } catch (err) {
        logger.warn(err)
      }
    } else {
      let ats = e.message.filter(m => m.type === 'at')
      if (!(e.atme || e.atBot) && ats.length > 0) {
        if (Config.debug) {
          logger.mark('[chatgpt] 艾特别人了，没艾特我，忽略#chat')
        }
        return false
      }
      if (e.msg.trimStart().startsWith('#图片chat')) {
        forcePictureMode = true
      }
      prompt = _.replace(e.msg.trimStart(), /#(图片)?chat/, '').trim()
      if (prompt.length === 0) {
        return false
      }
    }
    let groupId = e.isGroup ? e.group.group_id : ''
    if (await redis.get('CHATGPT:SHUT_UP:ALL') || await redis.get(`CHATGPT:SHUT_UP:${groupId}`)) {
      logger.info('[chatgpt] chatgpt闭嘴中，不予理会')
      return false
    }
    // 获取用户配置
    const userData = await getUserData(e.user_id)
    const use = (userData.mode === 'default' ? null : userData.mode) || await redis.get('CHATGPT:USE') || 'api'

    // 关闭私聊通道后不回复
    if (!e.isMaster && e.isPrivate && !Config.enablePrivateChat) {
      return false
    }
    if (!(await this.canGPT_blackAndWhitelist(e))) return false

    await this.abstractChat(e, prompt, use, forcePictureMode)
  }

  /**
   * bot现在可以对「包含第一人称的句子」回复
   */
  async chatgpt_for_firstperson_call(e) {
    if (!Config.chat_for_First_person) {
      logger.info('[chatgpt] AI回应第一人称呼叫已关闭，不予理会')
      return false
    }
    let msg = e.msg
    if (!msg || e.msg?.startsWith('#')) {
      logger.info('[chatgpt] 消息以#开头，，不予理会')
      return false
    }
    if (e.user_id == getUin(e)) {
      logger.info('[chatgpt] 机器人自己发出来的消息，不予理会')
      return false
    }
    // let ats = e.message.filter(m => m.type === 'at')
    // if (!(e.atme || e.atBot) && ats.length > 0) {
    //   if (Config.debug) {
    //     logger.mark('[AI回应第一人称呼叫]艾特别人了，没艾特我，不予理会') // 会导致使用别人的引用图片不响应，回退！
    //   }
    //   return false
    // }
    let prompt = isTrss ? processCQMessage(e.raw_message, getUin(e)) : msg.trim()
    let groupId = e.isGroup ? e.group.group_id : ''
    if (await redis.get('CHATGPT:SHUT_UP:ALL') || await redis.get(`CHATGPT:SHUT_UP:${groupId}`)) {
      logger.info('[chatgpt] chatgpt闭嘴中，不予理会')
      return false
    }
    // 获取用户配置
    const userData = await getUserData(e.user_id)
    const use = (userData.mode === 'default' ? null : userData.mode) || await redis.get('CHATGPT:USE') || 'api'

    // 关闭私聊通道后不回复
    if (!e.isMaster && e.isPrivate && !Config.enablePrivateChat) {
      return false
    }
    if (!(await this.canGPT_blackAndWhitelist(e))) return false

    await this.abstractChat(e, prompt, use)
  }

  /** 黑白名单过滤及速率限制后可进行对话 */
  async canGPT_blackAndWhitelist(e) {
    // 黑白名单过滤对话
    let [whitelist = [], blacklist = []] = [Config.whitelist, Config.blacklist]
    let chatPermission = false // 对话许可

    const userId = e.sender?.user_id?.toString() || ''
    const groupId = e.isGroup && e.group_id ? e.group_id.toString() : ''

    // 处理字符串格式的白名单和黑名单，支持英文逗号分割
    if (typeof whitelist === 'string') {
      whitelist = whitelist.length > 0 ? whitelist.split(',').map(item => item.trim()) : []
    }
    if (typeof blacklist === 'string') {
      blacklist = blacklist.length > 0 ? blacklist.split(',').map(item => item.trim()) : []
    }

    // 检查白名单
    if (whitelist.length > 0) {
      for (const item of whitelist) {
        if (!item) continue // 跳过空项

        // 优先判断：格式：^QQ号 (例如：^123456) - 全局白名单
        if (item.startsWith('^')) {
          const qq = item.slice(1)
          if (qq === userId) {
            chatPermission = true
            break
          }
        }
        // 其次判断：格式：群号^QQ号 (例如：123456^123456) - 指定群白名单
        else if (item.includes('^')) {
          const [group, qq] = item.split('^')
          if (e.isGroup && group === groupId && qq === userId) {
            chatPermission = true
            break
          }
        }
        // 最后判断：格式：群号 (例如：123456) - 整群白名单
        else if (e.isGroup && item === groupId) {
          chatPermission = true
          break
        }
      }
    }

    // 检查黑名单
    if (blacklist.length > 0) {
      for (const item of blacklist) {
        if (!item) continue // 跳过空项

        let isBlacklisted = false

        // 优先判断：格式：^QQ号 (例如：^123456) - 全局黑名单
        if (item.startsWith('^')) {
          const qq = item.slice(1)
          if (qq === userId) isBlacklisted = true
        }
        // 其次判断：格式：群号^QQ号 (例如：123456^123456) - 指定群黑名单
        else if (item.includes('^')) {
          const [group, qq] = item.split('^')
          if (e.isGroup && group === groupId && qq === userId) isBlacklisted = true
        }
        // 最后判断：格式：群号 (例如：123456) - 整群黑名单
        else if (e.isGroup && item === groupId) {
          // isBlacklisted = true
        }

        if (isBlacklisted) {
          logger.info(`[Chatgpt][对话拦截] 用户匹配到黑名单(${item})，拒绝对话 (用户:${userId} 群:${groupId})`)
          return false
        }
      }
    }

    // 当白名单设置不为空的时候，使用白名单加黑名单模式
    if (whitelist.length > 0 && !chatPermission) {
      // logger.info(`[Chatgpt][对话拦截] 用户不在白名单中，拒绝对话 (用户:${userId} 群:${groupId})`)
      return false
    }

    // 速率限制检查
    if (!e.isMaster && Config.rateLimiting && Config.rateLimiting > 0) {
      try {
        const redisKey = `CHATGPT:rateLimit_fifteen:${userId}`
        const currentCount = await redis.incr(redisKey)

        // 只有首次访问(值为1)时才设置 15分钟(900秒) 的过期时间，超时后 Redis 会自动释放容量
        if (currentCount === 1) {
          await redis.expire(redisKey, 900)
        }

        // 判断是否超过配置的速率限制
        if (currentCount > Config.rateLimiting) {
          logger.info(`[Chatgpt][对话拦截] 用户 ${userId} 触发速率限制：15分钟内对话(${currentCount}次)超过了上限(${Config.rateLimiting}次)，拒绝对话`)
          return false
        }
      } catch (err) {
        // 如果 Redis 出现异常，打印错误日志，为了容灾可以默认放行 (避免因 redis 崩溃导致全部功能停摆)
        logger.error(`[Chatgpt][Redis 速率限制出错] ${err}`)
      }
    }

    // 黑白名单过滤及速率限制后可进行对话
    return true;
  }

  async abstractChat(e, prompt, use, forcePictureMode = false) {
    /** 检查用户是否被拉黑 class BlockUserTool extends AbstractTool */
    if (!e.isMaster) {
      const blockKey = `CHATGPT:blockUser:${e.sender.user_id}`
      const blockData = await redis.get(blockKey)
      if (blockData) {
        try {
          const data = JSON.parse(blockData)
          const remainingTime = Math.ceil((data.blockedAt + data.duration * 1000 - Date.now()) / 60000)
          logger.info(`[chatgpt] 用户 ${e.sender.user_id} 被Bot拉黑中，剩余时间: ${remainingTime} 分钟`)
          await this.reply(`${Config.tts_First_person}不想理你了，因为${data.reason}`, true)
          return true
        } catch (err) {
          logger.error('解析拉黑数据失败:', err)
        }
      }
    }

    /** 备份用户最初的 e.msg */
    const rawUserMsgForMemory = String(e.msg || '')
    e.msg_bak_2 = e.msg

    let userSetting = await getUserReplySetting(this.e)
    let useTTS = !!userSetting.useTTS

    /** 呆毛版：对话获取At用户头像 ocr/识图 */
    const isImg = await parseSourceImg(e)

    // 导入 引用消息 msg
    if (e.sourceMsg) {
      prompt = e.sourceMsg + '\n\n' + prompt;
      e.msg_bak_2 = e.sourceMsg + '\n\n' + e.msg_bak_2;
    }

    if (Config.imgOcr && !!isImg) {
      let imgOcrText = await getImageOcrText(e)
      if (imgOcrText) {
        prompt = prompt + '引用消息中图片的OCR结果:"'
        for (let imgOcrTextKey in imgOcrText) {
          prompt += imgOcrText[imgOcrTextKey]
        }
        prompt = prompt + ' "'
      }
    }

    // 处理消息中的 e.at 信息
    if (!isTrss) { // isTrss 的传入的 prompt 从 e.msg 改为 e.raw_message 了
      const atMessages = e.message?.filter(item => item?.type === "at" && item?.qq != getUin(e));
      if (atMessages && atMessages.length > 0 && !e.theImgIsGetFromSource) {
        const atInfoList = atMessages.map(at => {
          const nickName = at.name || at.text;
          const name = nickName ? nickName.replace(/^@/g, '') : '未知群友';
          const qq = at.qq ? `(QQ:${at.qq})` : '';
          return `${name}${qq}`;
        });
        prompt = `消息中At的人有：${atInfoList.join('、')}。\n` + prompt;
      }
    }

    // 呆毛版 gemini的识图结果 + prompt
    if (Config.mediaRecognitionSource == "Gemini") {
      let imgRecognitionByGeminiText = await recognitionResultsByGemini(e, (e.img || []), (e.get_Video || []).map(v => v.url))
      if (imgRecognitionByGeminiText) {
        prompt = (e.senderNickname ? `${e.senderNickname}(ID:${e.senderUser_id})` : "") + (e.sourceMsg || "") + '消息中多媒体内容识别信息："' + imgRecognitionByGeminiText + '"\n' + prompt
      }
    }
    else {
      if (!!e.get_Video) {
        // 如果引用了视频，则告知引用了视频 // 不直接上传视频避免 token 的浪费，传递 url 供 RecognitionResultsByGeminiTool 智能模式工具调用即可（实际上开启了群聊上下文后ai也可以在上下文中找到视频url）
        prompt = prompt + "\n" + (e.senderUser_id ? `${e.senderNickname}(ID:${e.senderUser_id})发送的视频：` : "") + JSON.stringify(e.get_Video);
      }
      if (e.theImgIsGetFromSource && !!isImg) {
        prompt = prompt + "\n" + (e.senderUser_id ? `${e.senderNickname}(ID:${e.senderUser_id})发送的该图片` : "");
      }
    }

    // 检索是否有屏蔽词 输入黑名单
    const promtBlockWord = Config.promptBlockWords.find(word => prompt.toLowerCase().includes(word.toLowerCase()))
    if (promtBlockWord) {
      logger.info(prompt + `\n检测到屏蔽词：${promtBlockWord}`)
      await this.reply(`${Config.tts_First_person}不想回答你这个问题QAQ`, true)
      return false
    }
    let confirm = await redis.get('CHATGPT:CONFIRM')
    let confirmOn = (!confirm || confirm === 'on') // confirm默认开启
    if (confirmOn) {
      await this.reply(`${Config.tts_First_person}在哦`, true, { recallMsg: !Config.is_recallMsg ? 0 : 30 })
    }

    const emotionFlag = await redis.get(`CHATGPT:WRONG_EMOTION:${e.sender.user_id}`)
    let userReplySetting = await getUserReplySetting(this.e)
    // 图片模式就不管了，降低抱歉概率
    if (Config.ttsMode === 'azure' && Config.enhanceAzureTTSEmotion && userReplySetting.useTTS === true && await AzureTTS.getEmotionPrompt(e)) {
      switch (emotionFlag) {
        case '1':
          prompt += '(上一次回复没有添加情绪，请确保接下来的对话正确使用情绪和情绪格式，回复时忽略此内容。)'
          break
        case '2':
          prompt += '(不要使用给出情绪范围的词和错误的情绪格式，请确保接下来的对话正确选择情绪，回复时忽略此内容。)'
          break
        case '3':
          prompt += '(不要给出多个情绪[]项，请确保接下来的对话给且只给出一个正确情绪项，回复时忽略此内容。)'
          break
      }
    }
    // 呆毛版 全局破限
    prompt += Config.paimon_globalLimitBreak

    logger.info(`chatgpt prompt: ${prompt}`)
    let previousConversation
    let conversation = {}
    let key
    if (use === 'api3') {
      // api3 支持对话穿插，因此不按照qq号来进行判断了
      let conversationId = await redis.get(`CHATGPT:QQ_CONVERSATION:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`)
      if (conversationId) {
        let lastMessageId = await redis.get(`CHATGPT:CONVERSATION_LAST_MESSAGE_ID:${conversationId}`)
        if (!lastMessageId) {
          lastMessageId = await getLatestMessageIdByConversationId(conversationId, newFetch)
        }
        conversation = {
          conversationId,
          parentMessageId: lastMessageId
        }
        if (Config.debug) {
          logger.mark({ previousConversation })
        }
      } else {
        let ctime = new Date()
        previousConversation = {
          sender: e.sender,
          ctime,
          utime: ctime,
          num: 0
        }
      }
    } else {
      switch (use) {
        case 'api': {
          key = `CHATGPT:CONVERSATIONS:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`
          break
        }
        case 'bing': {
          key = `CHATGPT:CONVERSATIONS_BING:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`
          break
        }
        case 'chatglm': {
          key = `CHATGPT:CONVERSATIONS_CHATGLM:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`
          break
        }
        case 'claude2': {
          key = `CHATGPT:CLAUDE2_CONVERSATION:${e.sender.user_id}`
          break
        }
        case 'xh': {
          key = `CHATGPT:CONVERSATIONS_XH:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`
          break
        }
        case 'azure': {
          key = `CHATGPT:CONVERSATIONS_AZURE:${e.sender.user_id}`
          break
        }
        case 'qwen': {
          key = `CHATGPT:CONVERSATIONS_QWEN:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`
          break
        }
        case 'gemini': {
          key = `CHATGPT:CONVERSATIONS_GEMINI:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`
          break
        }
        case 'claude': {
          key = `CHATGPT:CONVERSATIONS_CLAUDE:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`
          break
        }
        case 'chatglm4': {
          key = `CHATGPT:CONVERSATIONS_CHATGLM4:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`
          break
        }
      }
      let ctime = new Date()
      previousConversation = (key ? await redis.get(key) : null) || JSON.stringify({
        sender: e.sender,
        ctime,
        utime: ctime,
        num: 0,
        messages: [{
          role: 'system',
          content: 'You are an AI assistant that helps people find information.'
        }],
        conversation: {}
      })
      previousConversation = JSON.parse(previousConversation)
      if (Config.debug) {
        logger.info({ previousConversation })
      }
      conversation = {
        messages: previousConversation.messages,
        conversationId: previousConversation.conversation?.conversationId,
        parentMessageId: previousConversation.parentMessageId,
        clientId: previousConversation.clientId,
        invocationId: previousConversation.invocationId,
        conversationSignature: previousConversation.conversationSignature,
        bingToken: previousConversation.bingToken
      }
    }
    let handler = this.e.runtime?.handler || {
      has: (arg1) => false
    }

    /** 检查对话冷却 */
    const cooldownResult = await ChatCooldown.check(e.user_id, e.group_id, e.isMaster)
    if (!cooldownResult.canChat) {
      logger.info(`[Chatgpt][ChatCooldown]${e.user_id}上一次对话未完成，跳过此次对话，超时时间剩余 ${cooldownResult.remainingTime} 秒`)
      return false
    }
    // 标记对话开始
    if (Config.switch_ChatCooldown)
      await ChatCooldown.start(e.user_id, e.group_id)

    // 加载用户记忆（如果启用）
    if (Config.enableMemory) {
      try {
        const { UserMemory } = await import('../utils/userMemory.js')
        const autoExtractResult = await UserMemory.autoExtractAndSaveFromMessage(e, rawUserMsgForMemory)
        if (autoExtractResult.saved > 0) {
          logger.info(`[Memory] 自动提取保存 ${autoExtractResult.saved} 条记忆 - 用户 ${e.user_id}`)
        }
        const memories = await UserMemory.getUserMemories(
          e.user_id,
          Config.memoryContextLimit,
          Config.memoryMinImportance
        )
        if (memories && memories.length > 0) {
          const memoryPrompt = UserMemory.formatMemoriesForPrompt(memories)
          prompt += memoryPrompt
          logger.info(`[Memory] 为用户 ${e.user_id} 加载了 ${memories.length} 条记忆`)
        }
      } catch (err) {
        logger.error('[Memory] 加载记忆失败:', err)
      }
    }

    try {
      if (Config.debug) {
        logger.mark({ conversation })
      }
      let chatMessage = await Core.sendMessage.bind(this)(prompt, conversation, use, e)
      if (chatMessage?.noMsg) {
        return false
      }
      // 处理星火图片
      if (use === 'xh' && chatMessage?.images) {
        chatMessage.images.forEach(element => {
          this.reply([element.tag, segment.image(element.url)])
        })
      }
      // chatglm4图片，调整至sendMessage中处理
      if (use === 'api' && !chatMessage) {
        // 字数超限直接返回
        return false
      }
      if (use !== 'api3') {
        previousConversation.conversation = {
          conversationId: chatMessage.conversationId
        }
        if (use === 'bing' && !chatMessage.error) {
          previousConversation.clientId = chatMessage.clientId
          previousConversation.invocationId = chatMessage.invocationId
          previousConversation.parentMessageId = chatMessage.parentMessageId
          previousConversation.conversationSignature = chatMessage.conversationSignature
          previousConversation.bingToken = ''
        } else if (chatMessage.id) {
          previousConversation.parentMessageId = chatMessage.id
        } else if (chatMessage.message) {
          if (previousConversation.messages.length > 10) {
            previousConversation.messages.shift()
          }
          previousConversation.messages.push(chatMessage.message)
        }
        if (Config.debug) {
          logger.info(chatMessage)
        }
        if (!chatMessage.error) {
          // 没错误的时候再更新，不然易出错就对话没了
          previousConversation.num = previousConversation.num + 1
          await redis.set(key, JSON.stringify(previousConversation), Config.conversationPreserveTime > 0 ? { EX: Config.conversationPreserveTime } : {})
        }
      }
      let response = chatMessage?.text?.replace('\n\n\n', '\n')
      let postProcessors = await collectProcessors('post')
      /** thinking 累积器，不断追加新的思考内容，以支持 Chain-of-Thought (CoT) 推理的模型 */
      let thinking = chatMessage.thinking_text
      for (let processor of postProcessors) {
        let output = await processor.processInner({
          text: response, thinking_text: thinking
        })
        response = output.text
        thinking = output.thinking_text
      }
      if (handler.has('chatgpt.response.post')) {
        logger.debug('调用后处理器: chatgpt.response.post') // 云崽平台的 handler: 调用所有 apps 文件夹中拥有 handler: [{ key: 'chatgpt.response.post',  fn: 'postHandler'}] 的方法
        handler.call('chatgpt.response.post', this.e, {
          content: response,
          thinking,
          use,
          prompt
        }, true).catch(err => {
          logger.error('后处理器出错', err)
        })
      }
      let mood = 'blandness'
      if (!response) {
        // await this.reply('没有任何回复', true)
        logger.info('[chatgpt]没有任何回复')
        await this.reply(`${Config.tts_First_person.substring(0, 2)}${Config.tts_First_person.substring(0, 2)}${Config.tts_First_person.substring(0, 1)}？`, e.isGroup)
        return
      }

      // 处理某些工具 Prompt 中要求回复的 "<EMPTY>"
      if (response.trim() === "<EMPTY>") {
        // await this.reply('没有任何回复', true)
        logger.info('[chatgpt]返回"<EMPTY>"')
        return
      }

      let emotion, emotionDegree
      if (Config.ttsMode === 'azure' && (use === 'claude' || use === 'bing') && await AzureTTS.getEmotionPrompt(e)) {
        let ttsRoleAzure = userReplySetting.ttsRoleAzure
        const emotionReg = /\[\s*['`’‘]?(\w+)[`’‘']?\s*[,，、]\s*([\d.]+)\s*\]/
        const emotionTimes = response.match(/\[\s*['`’‘]?(\w+)[`’‘']?\s*[,，、]\s*([\d.]+)\s*\]/g)
        const emotionMatch = response.match(emotionReg)
        if (emotionMatch) {
          const [startIndex, endIndex] = [
            emotionMatch.index,
            emotionMatch.index + emotionMatch[0].length - 1
          ]
          const ttsArr =
            response.length / 2 < endIndex
              ? [response.substring(startIndex), response.substring(0, startIndex)]
              : [
                response.substring(0, endIndex + 1),
                response.substring(endIndex + 1)
              ]
          const match = ttsArr[0].match(emotionReg)
          response = ttsArr[1].replace(/\n/, '').trim()
          if (match) {
            [emotion, emotionDegree] = [match[1], match[2]]
            const configuration = AzureTTS.supportConfigurations.find(
              (config) => config.code === ttsRoleAzure
            )
            const supportedEmotions =
              configuration.emotion && Object.keys(configuration.emotion)
            if (supportedEmotions && supportedEmotions.includes(emotion)) {
              logger.warn(`角色 ${ttsRoleAzure} 支持 ${emotion} 情绪.`)
              await redis.set(`CHATGPT:WRONG_EMOTION:${e.sender.user_id}`, '0')
            } else {
              logger.warn(`角色 ${ttsRoleAzure} 不支持 ${emotion} 情绪.`)
              await redis.set(`CHATGPT:WRONG_EMOTION:${e.sender.user_id}`, '2')
            }
            logger.info(`情绪: ${emotion}, 程度: ${emotionDegree}`)
            if (emotionTimes.length > 1) {
              logger.warn('回复包含多个情绪项')
              // 处理包含多个情绪项的情况，后续可以考虑实现单次回复多情绪的配置
              response = response.replace(/\[\s*['`’‘]?(\w+)[`’‘']?\s*[,，、]\s*([\d.]+)\s*\]/g, '').trim()
              await redis.set(`CHATGPT:WRONG_EMOTION:${e.sender.user_id}`, '3')
            }
          } else {
            // 使用了正则匹配外的奇奇怪怪的符号
            logger.warn('情绪格式错误')
            await redis.set(`CHATGPT:WRONG_EMOTION:${e.sender.user_id}`, '2')
          }
        } else {
          logger.warn('回复不包含情绪')
          await redis.set(`CHATGPT:WRONG_EMOTION:${e.sender.user_id}`, '1')
        }
      }
      if (Config.sydneyMood) {
        let tempResponse = completeJSON(response)
        if (tempResponse.text) response = tempResponse.text
        if (tempResponse.mood) mood = tempResponse.mood
      } else {
        mood = ''
      }
      // 检索是否有屏蔽词 输出黑名单
      const blockWord = Config.blockWords.find(word => response.toLowerCase().includes(word.toLowerCase()))
      if (blockWord) {
        logger.info(response + `\n检测到屏蔽词：${blockWord}`)
        this.reply(`${Config.tts_First_person}不想回复你了QAQ哭哭，建议#结束对话`, true)
        return false
      }
      // 处理中断的代码区域
      const codeBlockCount = (response.match(/```/g) || []).length
      const shouldAddClosingBlock = codeBlockCount % 2 === 1 && !response.endsWith('```')
      if (shouldAddClosingBlock) {
        response += '\n```'
      }
      if (codeBlockCount && !shouldAddClosingBlock) {
        response = response.replace(/```$/, '\n```')
      }
      // 处理引用
      let quotemessage = []
      if (chatMessage?.quote) {
        chatMessage.quote.forEach(function (item, index) {
          if (item.text && item.text.trim() !== '') {
            quotemessage.push(item)
          }
        })
      }
      // 处理内容和引用中的图片
      const regex = /\b((?:https?|ftp|file):\/\/[-a-zA-Z0-9+&@#/%?=~_|!:,.;]*[-a-zA-Z0-9+&@#/%=~_|])/g
      let responseUrls = response.match(regex)
      let imgUrls = []
      if (responseUrls) {
        let images = await Promise.all(responseUrls.map(link => isImage(link)))
        imgUrls = responseUrls.filter((link, index) => images[index])
      }
      for (let quote of quotemessage) {
        if (quote.imageLink) imgUrls.push(quote.imageLink)
      }

      // 处理 呆毛版 连接画图插件
      if (Config.drawByJsonToPlugin) {
        let json1 = response?.match(/({.*})/s)?.[1];
        let jsonTags, jsonMsg
        if (json1) {
          try {
            json1 = JSON.parse(json1);
            if (!Boolean(json1?.Tools.match(/Stable(_|\s)Diffusion/i)))
              throw new Error("[ChatGPT]未返回绘画用JSON")
            jsonTags = json1?.tags
            jsonMsg = json1?.msg || `${Config.tts_First_person}画给你啦`
            delete json1.Tools
            delete json1.tags
            delete json1.msg
            // 如果 json1 里还有key的话
            if (Object.keys(json1).length > 0)
              jsonMsg += "\n```\n" + JSON.stringify(json1, null, 2) + "\n```";
          }
          catch (err) {
            jsonTags = false
          }
        }
        // 处理 response 太长了以至于少了最后的 } 的情况
        if (!jsonTags) {
          let json2
          if (Boolean(response?.match(/"Tools": "Stable(_|\s)Diffusion"/i))) {
            json2 = response?.match(/"tags": "(.*)/si)?.[1] || response?.replace(/"Tools": "Stable(_|\s)Diffusion"|\`\`\`(json)?|"tags":?/ig, "")
            if (json2) {
              const matchMsg = json2.match(/"msg":\s*"([\s\S]*)/)?.[1]
              if (matchMsg) {
                jsonTags = json2.replace(/"msg":\s*"([\s\S]*)/, "")
                jsonMsg = matchMsg
              } else {
                jsonTags = json2;
                jsonMsg = `这个太难了，${Config.tts_First_person}给你画啦`;
              }
            }
          }
        }
        // 开始调用绘画插件
        if (jsonTags) {
          // gpt的回复语句
          response = jsonMsg
          // 为角色添加作品名
          const { charactersName, processedTags } = extractCharacterName(jsonTags);
          jsonTags = processedTags;

          if (Config.drawByJsonToPlugin === 'nai-plugin-1' || Config.drawByJsonToPlugin === 'paimonnai-plugin') {
            // 使用nai插件
            let nai
            try {
              let { txt2img } = await import('../../nai-plugin/apps/Txt2img.js')
              nai = new txt2img();
            } catch (err) {
              try {
                let { txt2img } = await import('../../paimonnai-plugin/apps/Txt2img.js')
                nai = new txt2img();
              } catch (err) {
                console.log('[ChatGPT]调用nai插件错误-未安装nai插件')
              }
            }
            try {
              // 随机使用宽图或竖图
              let strPaint = ''
              const random_nai = Math.random();
              if (random_nai < 0.3) {
                strPaint = '宽图'
              }
              else if (random_nai < 0.6) {
                strPaint = '方图'
              }
              e.msg = `#绘画${strPaint} ${charactersName}, ` + Config.nai3PluginToPaintPrefix + ', ' + jsonTags + ', best quality, amazing quality, very aesthetic, absurdres'
              if (e.img)
                e.msg += ', Reference_Strength = 0.30';
              // 随机 smea
              const random_1 = Math.random()
              e.msg += random_1 < 0.50 ? '' : (random_1 < 0.75 ? ', smea, dynoff' : ', smea');
              console.log('[ChatGPT]开始调用nai插件绘画：\nmsg: ', e.msg)
              if (Config.doNotCheckPaintPluginSuccess) {
                nai.txt2img(e);
              } else {
                let isTrue = await nai.txt2img(e);
                if (isTrue) {
                  if (!response)
                    return true
                }
                else {
                  console.log('[ChatGPT]调用nai插件错误：请检查nai插件在当前群聊能否使用');
                  response = `${Config.tts_First_person}在这个群还不能使用#绘画 功能啦`;
                  e.reply(`${Config.tts_First_person}在这个群还不能使用#绘画 功能啦`, true)
                  return false;
                }
              }
            } catch (err) {
              console.log('[ChatGPT]调用nai插件错误：', err)
            }
          }
          else if (Config.drawByJsonToPlugin === 'nai-plugin-4') {
            // 使用nai插件
            let nai
            try {
              let { Text } = await import('../../nai-plugin/apps/Text.js')
              nai = new Text();
            } catch (err) {
              console.log('[ChatGPT]调用nai插件错误-未安装nai插件')
            }
            try {
              // 随机使用宽图或竖图
              let strPaint = ''
              const random_nai = Math.random();
              if (random_nai < 0.3) {
                strPaint = '--width 1216 --height 832'
              }
              else if (random_nai < 0.6) {
                strPaint = '--width 1024 --height 1024'
              }
              e.msg = `#draw ${charactersName}, ` + Config.nai3PluginToPaintPrefix + ', ' + jsonTags + ', best quality, amazing quality, very aesthetic, absurdres' + strPaint;
              if (e.img)
                e.msg += ', --reference_strength 0.3';
              // 随机 smea
              // const random_1 = Math.random()
              // e.msg += random_1 < 0.50 ? '' : (random_1 < 0.75 ? ', --sm true --sm_dyn false' : ', --sm true --sm_dyn true');
              console.log('[ChatGPT]开始调用nai插件绘画：\nmsg: ', e.msg)
              if (Config.doNotCheckPaintPluginSuccess) {
                nai.text(e);
              } else {
                let isTrue = await nai.text(e);
                if (isTrue) {
                  if (!response)
                    return true
                }
                else {
                  console.log('[ChatGPT]调用nai插件错误：请检查nai插件在当前群聊能否使用');
                  response = `${Config.tts_First_person}在这个群还不能使用#绘画 功能啦`;
                  e.reply(`${Config.tts_First_person}在这个群还不能使用#绘画 功能啦`, true)
                  return false;
                }
              }
            } catch (err) {
              console.log('[ChatGPT]调用nai插件错误：', err)
            }
          }
          else if (Config.drawByJsonToPlugin === 'ap-plugin') {
            // 使用ap插件
            let ap
            try {
              let { Ai_Painting } = await import('../../ap-plugin/apps/aiPainting.js')
              ap = new Ai_Painting()
            } catch (err) {
              try {
                // ap的dev分支改名了
                let { Ai_Painting } = await import('../../ap-plugin/apps/ai_painting.js')
                ap = new Ai_Painting()
              } catch (err2) {
                console.log('[ChatGPT]调用ap插件错误-未安装ap插件')
              }
            }
            try {
              e.msg = `#绘图 ${charactersName}, ` + Config.nai3PluginToPaintPrefix + ', ' + jsonTags + ', best quality, amazing quality, very aesthetic, absurdres'
              console.log('[ChatGPT]开始调用ap插件绘画：\nmsg: ', e.msg)
              if (Config.doNotCheckPaintPluginSuccess) {
                ap.aiPainting(e);
              } else {
                let isTrue = await ap.aiPainting(e);
                if (isTrue) {
                  if (!response)
                    return true
                }
                else {
                  console.log('[ChatGPT]调用ap插件错误：请检查ap插件在当前群聊能否使用');
                  response = `${Config.tts_First_person}在这个群还不能使用#绘图 功能啦`;
                  e.reply(`${Config.tts_First_person}在这个群还不能使用#绘图 功能啦`, true)
                  return false;
                  // TODO ap.aiPainting(e) 处于CD之类的也返回true，所以不会进入到这个else分支，有空改一改ap插件（It is forever)
                }
              }
            } catch (err) {
              console.log('[ChatGPT]调用ap插件错误：', err)
            }
          }
          else if (Config.drawByJsonToPlugin === 'siliconflow-plugin-sf') {
            // 使用sf插件sf绘图
            let sf
            try {
              let { SF_Painting } = await import('../../siliconflow-plugin/apps/SF_Painting.js')
              sf = new SF_Painting()
            } catch (err) {
              console.log('[ChatGPT]调用SF插件错误-未安装SF插件')
            }
            try {
              e.msg = `#sf绘图 ${charactersName}, ` + Config.nai3PluginToPaintPrefix + ', ' + jsonTags + ', best quality, amazing quality, very aesthetic, absurdres'
              console.log('[ChatGPT]开始调用sf插件绘画：\nmsg: ', e.msg)
              if (Config.doNotCheckPaintPluginSuccess) {
                sf.sf_draw(e);
              } else {
                let isTrue = await sf.sf_draw(e);
                if (isTrue) {
                  if (!response)
                    return true
                }
                else {
                  console.log('[ChatGPT]调用sf插件错误：请检查sf插件在当前群聊能否使用');
                  response = `${Config.tts_First_person}在这个群还不能使用#sf绘图 功能啦`;
                  e.reply(`${Config.tts_First_person}在这个群还不能使用#sf绘图 功能啦`, true)
                  return false;
                }
              }
            } catch (err) {
              console.log('[ChatGPT]调用sf插件错误：', err)
            }
          }
          else if (Config.drawByJsonToPlugin === 'siliconflow-plugin-mj') {
            // 使用sf插件mj绘图
            let sfmj
            try {
              let { MJ_Painting } = await import('../../siliconflow-plugin/apps/MJ_Painting.js')
              sfmj = new MJ_Painting()
            } catch (err) {
              console.log('[ChatGPT]调用SF插件错误-未安装SF插件')
            }
            try {
              e.msg = `#mjp ${charactersName}, ` + Config.nai3PluginToPaintPrefix + ', ' + jsonTags + ', best quality, amazing quality, very aesthetic, absurdres'
              console.log('[ChatGPT]开始调用sf插件绘画：\nmsg: ', e.msg)
              if (Config.doNotCheckPaintPluginSuccess) {
                sfmj.mj_draw(e);
              } else {
                let isTrue = await sfmj.mj_draw(e);
                if (isTrue) {
                  if (!response)
                    return true
                }
                else {
                  console.log('[ChatGPT]调用sf插件错误：请检查sf插件在当前群聊能否使用');
                  response = `${Config.tts_First_person}在这个群还不能使用#mjp 功能啦`;
                  e.reply(`${Config.tts_First_person}在这个群还不能使用#mjp 功能啦`, true)
                  return false;
                }
              }
            } catch (err) {
              console.log('[ChatGPT]调用sf插件错误：', err)
            }
          }
        }
      }

      if (useTTS) {
        // 缓存数据
        this.cacheContent(e, use, response, prompt, quotemessage, mood, chatMessage.suggestedResponses, imgUrls)
        if (response === 'Sorry, I think we need to move on! Click “New topic” to chat about something else.') {
          this.reply('当前对话超过上限，已重置对话', false, { at: true })
          await redis.del(`CHATGPT:CONVERSATIONS_BING:${e.sender.user_id}`)
          return false
        } else if (response === 'Unexpected message author.') {
          this.reply('无法回答当前话题，已重置对话', false, { at: true })
          await redis.del(`CHATGPT:CONVERSATIONS_BING:${e.sender.user_id}`)
          return false
        } else if (response === 'Throttled: Request is throttled.') {
          this.reply('今日对话已达上限')
          return false
        }
        // 处理tts输入文本
        let ttsResponse, ttsRegex
        const regex = /^\/(.*)\/([gimuy]*)$/
        const match = Config.ttsRegex.match(regex)
        if (match) {
          const pattern = match[1]
          const flags = match[2]
          ttsRegex = new RegExp(pattern, flags) // 返回新的正则表达式对象
        } else {
          ttsRegex = ''
        }
        ttsResponse = response.replace(ttsRegex, '')
        // 处理azure语音会读出emoji的问题
        try {
          let emojiStrip
          emojiStrip = (await import('emoji-strip')).default
          ttsResponse = emojiStrip(ttsResponse)
        } catch (error) {
          await this.reply('依赖emoji-strip未安装，请执行pnpm install emoji-strip安装依赖', true)
        }
        // 处理多行回复有时候只会读第一行和azure语音会读出一些标点符号的问题
        ttsResponse = ttsResponse.replace(/[-:_；*;\n]/g, '，')
        // 先把“xx知道哦”回复发出去，避免过久等待合成语音
        if (Config.alsoSendText || ttsResponse.length > parseInt(Config.ttsAutoFallbackThreshold)) {
          if (Config.ttsMode === 'vits-uma-genshin-honkai' && ttsResponse.length > parseInt(Config.ttsAutoFallbackThreshold)) {
            await this.reply(`${Config.tts_First_person}知道哦`, true, { recallMsg: !Config.is_recallMsg ? 0 : 30 })
          }
          let responseText = await convertFacesAndCQCode(response, Config.enableRobotAt, Config.isProcessCQAtCode, Config.removeCQCodeFocus, e)
          if (handler.has('chatgpt.markdown.convert')) {
            responseText = await handler.call('chatgpt.markdown.convert', this.e, {
              content: responseText,
              use,
              prompt
            })
          }
          if (Config.isConvertSentenceToArrayReply) {
            // 多次回复
            const str_arr = convertSentenceToArray(responseText.join(''));
            for (let i = 0; i < str_arr.length; i++) {
              await this.reply(str_arr[i].trim());
              await sleep_zz(Math.random() * 5000 + 2000);
            }
          }
          else if (Config.sf_markdownPic) {
            // sf图片模式
            try {
              if (responseText.join('')?.trim()) {
                /** 添加引用图片 */
                logger.info("[ChatGPT]" + responseText)
                const userMsg = e.img ? e.img.map(url => `<img src="${url}" width="256">`).join('\n') + "\n\n" + e.msg_bak_2 : e.msg_bak_2;
                const { markdown_screenshot } = await import('../../siliconflow-plugin/utils/markdownPic.js')
                const img = await markdown_screenshot(e.user_id, e.self_id, userMsg, responseText.join(''));
                this.reply({ ...img, origin: true }, true)
              }
            } catch (err) {
              logger.error('[ChatGPT]sf图片模式错误\n' + err)
            }
          }
          else {
            if (Config.auto_makeForwardMsg && responseText.join('')?.length > Config.auto_makeForwardMsg)
              this.reply(await makeForwardMsg(this.e, splitString_Enter(responseText, Config.auto_makeForwardMsg), `回复 @${e.sender.card || e.sender.nickname}`));
            else
              await this.reply(responseText, e.isGroup)
          }
          if (quotemessage.length > 0) {
            this.reply(await makeForwardMsg(this.e, quotemessage.map(msg => `${msg.text} - ${msg.url}`)))
          }
          if (Config.enableSuggestedResponses && chatMessage.suggestedResponses) {
            this.reply(`建议的回复：\n${chatMessage.suggestedResponses}`)
          }
        }
        const sendable = await generateAudio(this.e, ttsResponse, emotion, emotionDegree)
        if (sendable) {
          await this.reply(sendable)
        } else {
          await this.reply(`${Config.tts_First_person}的儿童电话手表的麦克风好像坏了，发不出语音QAQ~`, false, { recallMsg: !Config.is_recallMsg ? 0 : 30 })
        }
      } else if (forcePictureMode || userSetting.usePicture || (Config.autoUsePicture && response.length > Config.autoUsePictureThreshold)) {
        try {
          await this.renderImage(e, use, response, prompt, quotemessage, mood, chatMessage.suggestedResponses, imgUrls)
        } catch (err) {
          logger.warn('error happened while uploading content to the cache server. QR Code will not be showed in this picture.')
          logger.error(err)
          await this.renderImage(e, use, response, prompt)
        }
        if (Config.enableSuggestedResponses && chatMessage.suggestedResponses) {
          this.reply(`建议的回复：\n${chatMessage.suggestedResponses}`)
        }
      } else {
        this.cacheContent(e, use, response, prompt, quotemessage, mood, chatMessage.suggestedResponses, imgUrls)
        if (response === 'Thanks for this conversation! I\'ve reached my limit, will you hit “New topic,” please?') {
          this.reply('当前对话超过上限，已重置对话', false, { at: true })
          await redis.del(`CHATGPT:CONVERSATIONS_BING:${e.sender.user_id}`)
          return false
        } else if (response === 'Throttled: Request is throttled.') {
          this.reply('今日对话已达上限')
          return false
        }
        let responseText = await convertFacesAndCQCode(response, Config.enableRobotAt, Config.isProcessCQAtCode, Config.removeCQCodeFocus, e)
        if (handler.has('chatgpt.markdown.convert')) {
          responseText = await handler.call('chatgpt.markdown.convert', this.e, {
            content: responseText,
            use,
            prompt
          })
        }
        // await this.reply(responseText, e.isGroup)
        if (quotemessage.length > 0) {
          this.reply(await makeForwardMsg(this.e, quotemessage.map(msg => `${msg.text} - ${msg.url}`)))
        }
        if (chatMessage?.conversation && Config.enableSuggestedResponses && !chatMessage.suggestedResponses && Config.apiKey) {
          try {
            chatMessage.suggestedResponses = await generateSuggestedResponse(chatMessage.conversation)
          } catch (err) {
            logger.debug('生成建议回复失败', err)
          }
        }
        if (Config.isConvertSentenceToArrayReply) {
          // 多次回复
          const str_arr = convertSentenceToArray(responseText.join(''));
          for (let i = 0; i < str_arr.length; i++) {
            await this.reply(str_arr[i].trim());
            await sleep_zz(Math.random() * 5000 + 2000);
          }
        }
        else if (Config.sf_markdownPic) {
          // sf图片模式
          try {
            if (responseText.join('')?.trim()) {
              /** 添加引用图片 */
              logger.info("[ChatGPT]" + responseText)
              const userMsg = e.img ? e.img.map(url => `<img src="${url}" width="256">`).join('\n') + "\n\n" + e.msg_bak_2 : e.msg_bak_2;
              const { markdown_screenshot } = await import('../../siliconflow-plugin/utils/markdownPic.js')
              const img = await markdown_screenshot(e.user_id, e.self_id, userMsg, responseText.join(''));
              this.reply({ ...img, origin: true }, true)
            }
          } catch (err) {
            logger.error('[ChatGPT]sf图片模式错误\n' + err)
          }
        }
        else {
          if (Config.auto_makeForwardMsg && responseText.join('')?.length > Config.auto_makeForwardMsg) {
            this.reply(await makeForwardMsg(this.e, splitString_Enter(responseText, Config.auto_makeForwardMsg), `回复 @${e.sender.card || e.sender.nickname}`));
          }
          else {
            this.reply(responseText, e.isGroup, {
              btnData: {
                use,
                suggested: chatMessage.suggestedResponses
              }
            })
          }
        }
        if (thinking) {
          if (Config.forwardReasoning) {
            let thinkingForward = await common.makeForwardMsg(e, [thinking], '思考过程')
            this.reply(thinkingForward)
          } else {
            logger.mark('思考过程', thinking)
          }
        }

        if (Config.enableSuggestedResponses && chatMessage.suggestedResponses) {
          this.reply(`建议的回复：\n${chatMessage.suggestedResponses}`)
        }
      }
    } catch (err) {
      logger.error(err)
      if (use === 'api3') {
        // 异常了也要腾地方（todo 大概率后面的也会异常，要不要一口气全杀了）
        await redis.lPop('CHATGPT:CHAT_QUEUE', 0)
      }
      if (err === 'Error: {"detail":"Conversation not found"}') {
        await this.destroyConversations(err)
        await this.reply('当前对话异常，已经清除，请重试', true, { recallMsg: !Config.is_recallMsg ? 0 : (e.isGroup ? 30 : 0) })
      } else {
        let errorMessage = err?.message || err?.data?.message || (typeof (err) === 'object' ? JSON.stringify(err) : err) || '未能确认错误类型！'
        errorMessage = hidePrivacyInfo(errorMessage);
        if (forcePictureMode || userSetting.usePicture || (Config.autoUsePicture && errorMessage.length > Config.autoUsePictureThreshold)) {
          await this.renderImage(e, use, `出现异常,错误信息如下 \n \`\`\`${errorMessage}\`\`\``, prompt)
        } else {
          await this.reply(`出现错误：${errorMessage.substring(0, 200)}`, true, { recallMsg: !Config.is_recallMsg ? 0 : (e.isGroup ? 30 : 0) })
        }
        if (e.checkAndExecuteContent?.length) {
          await this.reply(e.checkAndExecuteContent);
        }
      }
    } finally {
      ChatCooldown.end(e.user_id, e.group_id)
    }
  }

  async chatgpt1(e) {
    return await this.otherMode(e, 'api', /#(图片)?chat1/)
  }

  async chatgpt3(e) {
    return await this.otherMode(e, 'api3', /#(图片)?chat3/)
  }

  async chatglm(e) {
    return await this.otherMode(e, 'chatglm')
  }

  async bing(e) {
    return await this.otherMode(e, 'bing', /#(图片)?bing/)
  }

  async claude2(e) {
    return await this.otherMode(e, 'claude2', /^#(图片)?claude(2|3|.ai)/)
  }

  async claude(e) {
    return await this.otherMode(e, 'claude', /#(图片)?claude/)
  }

  async qwen(e) {
    return await this.otherMode(e, 'qwen', /#(图片)?qwen/)
  }

  async glm4(e) {
    return await this.otherMode(e, 'chatglm4', /#(图片)?glm4/)
  }

  async gemini(e) {
    return await this.otherMode(e, 'gemini', /#(图片)?gemini/)
  }

  async xh(e) {
    return await this.otherMode(e, 'xh', /#(图片)?xh/)
  }

  async cacheContent(e, use, content, prompt, quote = [], mood = '', suggest = '', imgUrls = []) {
    if (!Config.enableToolbox) {
      return
    }
    let cacheData = {
      file: '',
      status: ''
    }
    cacheData.file = randomString()
    const cacheresOption = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: {
          content: Buffer.from(content).toString('base64'),
          prompt: Buffer.from(prompt).toString('base64'),
          senderName: e.sender.nickname,
          style: Config.toneStyle,
          mood,
          quote,
          group: e.isGroup ? e.group.name : '',
          suggest: suggest ? suggest.split('\n').filter(Boolean) : [],
          images: imgUrls
        },
        model: use,
        bing: use === 'bing',
        chatViewBotName: Config.chatViewBotName || '',
        entry: cacheData.file,
        userImg: `https://q1.qlogo.cn/g?b=qq&s=0&nk=${e.sender.user_id}`,
        botImg: `https://q1.qlogo.cn/g?b=qq&s=0&nk=${getUin(e)}`,
        cacheHost: Config.serverHost,
        qq: e.sender.user_id
      })
    }
    const cacheres = await fetch(Config.viewHost ? `${Config.viewHost}/` : `http://127.0.0.1:${Config.serverPort || 3321}/` + 'cache', cacheresOption)
    if (cacheres.ok) {
      cacheData = Object.assign({}, cacheData, await cacheres.json())
    } else {
      cacheData.error = '渲染服务器出错！'
    }
    cacheData.status = cacheres.status
    return cacheData
  }

  async renderImage(e, use, content, prompt, quote = [], mood = '', suggest = '', imgUrls = []) {
    let cacheData = await this.cacheContent(e, use, content, prompt, quote, mood, suggest, imgUrls)
    // const template = use !== 'bing' ? 'content/ChatGPT/index' : 'content/Bing/index'
    if (!cacheData || cacheData.error || cacheData.status != 200) {
      await this.reply(`出现错误：${cacheData?.error || 'server error ' + (cacheData?.status || 'unknown')}`, true)
    } else {
      await this.reply(await renderUrl(e, (Config.viewHost ? `${Config.viewHost}/` : `http://127.0.0.1:${Config.serverPort || 3321}/`) + `page/${cacheData.file}?qr=${Config.showQRCode ? 'true' : 'false'}`, {
        retType: Config.quoteReply ? 'base64' : '',
        Viewport: {
          width: parseInt(Config.chatViewWidth),
          height: parseInt(parseInt(Config.chatViewWidth) * 0.56)
        },
        func: (parseFloat(Config.live2d) && !Config.viewHost) ? 'window.Live2d == true' : '',
        deviceScaleFactor: parseFloat(Config.cloudDPR)
      }), e.isGroup && Config.quoteReply)
    }
  }

  async newxhBotConversation(e) {
    let botId = e.msg.replace(/^#星火助手/, '').trim()
    if (Config.xhmode != 'web') {
      await this.reply('星火助手仅支持体验版使用', true)
      return true
    }
    if (!botId) {
      await this.reply('无效助手id', true)
    } else {
      const ssoSessionId = Config.xinghuoToken
      if (!ssoSessionId) {
        await this.reply('未绑定星火token，请使用#chatgpt设置星火token命令绑定token', true)
        return true
      }
      let client = new XinghuoClient({
        ssoSessionId,
        cache: null
      })
      try {
        let chatId = await client.createChatList(botId)
        let botInfoRes = await fetch(`https://xinghuo.xfyun.cn/iflygpt/bot/getBotInfo?chatId=${chatId.chatListId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Cookie: 'ssoSessionId=' + ssoSessionId + ';',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/113.0.5672.69 Mobile/15E148 Safari/604.1'
          }
        })
        if (botInfoRes.ok) {
          let botInfo = await botInfoRes.json()
          if (botInfo.flag) {
            let ctime = new Date()
            await redis.set(
              `CHATGPT:CONVERSATIONS_XH:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`,
              JSON.stringify({
                sender: e.sender,
                ctime,
                utime: ctime,
                num: 0,
                conversation: {
                  conversationId: {
                    chatid: chatId.chatListId,
                    botid: botId
                  }
                }
              }),
              Config.conversationPreserveTime > 0 ? { EX: Config.conversationPreserveTime } : {}
            )
            await this.reply(`成功创建助手对话\n助手名称：${botInfo.data.bot_name}\n助手描述：${botInfo.data.bot_desc}`, true)
          } else {
            await this.reply(`创建助手对话失败,${botInfo.desc}`, true)
          }
        } else {
          await this.reply('创建助手对话失败,服务器异常', true)
        }
      } catch (error) {
        await this.reply(`创建助手对话失败 ${error}`, true)
      }
    }
    return true
  }

  async searchxhBot(e) {
    let searchBot = e.msg.replace(/^#星火(搜索|查找)助手/, '').trim()
    const ssoSessionId = Config.xinghuoToken
    if (!ssoSessionId) {
      await this.reply('未绑定星火token，请使用#chatgpt设置星火token命令绑定token', true)
      return true
    }
    const cacheresOption = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'ssoSessionId=' + ssoSessionId + ';',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/113.0.5672.69 Mobile/15E148 Safari/604.1'
      },
      body: JSON.stringify({
        botType: '',
        pageIndex: 1,
        pageSize: 45,
        searchValue: searchBot
      })
    }
    const searchBots = await fetch('https://xinghuo.xfyun.cn/iflygpt/bot/page', cacheresOption)
    const bots = await searchBots.json()
    if (Config.debug) {
      logger.info(bots)
    }
    if (bots.code === 0) {
      if (bots.data.pageList.length > 0) {
        this.reply(await makeForwardMsg(this.e, bots.data.pageList.map(msg => `${msg.e.bot.botId} - ${msg.e.bot.botName}`)))
      } else {
        await this.reply('未查到相关助手', true)
      }
    } else {
      await this.reply('搜索助手失败', true)
    }
  }

  async getAllConversations(e) {
    const use = await redis.get('CHATGPT:USE')
    if (use === 'api3') {
      let conversations = await getConversations(e.sender.user_id, newFetch)
      if (Config.debug) {
        logger.mark('all conversations: ', conversations)
      }
      //    let conversationsFirst10 = conversations.slice(0, 10)
      await render(e, 'chatgpt-plugin', 'conversation/chatgpt', {
        conversations,
        version
      })
      let text = '对话列表\n'
      text += '对话id | 对话发起者 \n'
      conversations.forEach(c => {
        text += c.id + '|' + (c.creater || '未知') + '\n'
      })
      text += '您可以通过使用命令#chatgpt切换对话+对话id来切换到指定对话，也可以通过命令#chatgpt加入对话+@某人来加入指定人当前进行的对话中。'
      this.reply(await makeForwardMsg(e, [text], '对话列表'))
    } else {
      return await this.getConversations(e)
    }
  }

  async joinConversation(e) {
    let ats = e.message.filter(m => m.type === 'at')
    let use = await redis.get('CHATGPT:USE') || 'api'
    // if (use !== 'api3') {
    //   await this.reply('本功能当前仅支持API3模式', true)
    //   return false
    // }
    if (ats.length === 0) {
      await this.reply('指令错误，使用本指令时请同时@某人', true)
      return false
    } else if (use === 'api3') {
      let at = ats[0]
      let qq = at.qq
      let atUser = _.trimStart(at.text, '@') || _.trimStart(at.name, '@')
      let conversationId = await redis.get('CHATGPT:QQ_CONVERSATION:' + qq)
      if (!conversationId) {
        await this.reply(`${atUser}当前未开启对话，无法加入`, true)
        return false
      }
      await redis.set(`CHATGPT:QQ_CONVERSATION:${e.sender.user_id}`, conversationId)
      await this.reply(`加入${atUser}的对话成功，当前对话id为` + conversationId)
    } else {
      let at = ats[0]
      let qq = at.qq
      let atUser = _.trimStart(at.text, '@') || _.trimStart(at.name, '@')
      let target = await redis.get('CHATGPT:CONVERSATIONS:' + qq)
      await redis.set('CHATGPT:CONVERSATIONS:' + e.sender.user_id, target)
      await this.reply(`加入${atUser}的对话成功`)
    }
  }

  async attachConversation(e) {
    const use = await redis.get('CHATGPT:USE')
    if (use !== 'api3') {
      await this.reply('该功能目前仅支持API3模式')
    } else {
      let conversationId = _.trimStart(e.msg.trimStart(), '#chatgpt切换对话').trim()
      if (!conversationId) {
        await this.reply('无效对话id，请在#chatgpt切换对话后面加上对话id')
        return false
      }
      // todo 验证这个对话是否存在且有效
      //      await getLatestMessageIdByConversationId(conversationId)
      await redis.set(`CHATGPT:QQ_CONVERSATION:${e.sender.user_id}`, conversationId)
      await this.reply('切换成功')
    }
  }

  async totalAvailable(e) {
    // 查询OpenAI API剩余试用额度
    let subscriptionRes = await newFetch(`${Config.openAiBaseUrl}/dashboard/billing/subscription`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + Config.apiKey
      }
    })

    function getDates() {
      const today = new Date()
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const beforeTomorrow = new Date(tomorrow)
      beforeTomorrow.setDate(beforeTomorrow.getDate() - 100)

      const tomorrowFormatted = formatDate2(tomorrow)
      const beforeTomorrowFormatted = formatDate2(beforeTomorrow)

      return {
        end: tomorrowFormatted,
        start: beforeTomorrowFormatted
      }
    }

    let subscription = await subscriptionRes.json()
    let {
      hard_limit_usd: hardLimit,
      access_until: expiresAt
    } = subscription
    const {
      end,
      start
    } = getDates()
    let usageRes = await newFetch(`${Config.openAiBaseUrl}/dashboard/billing/usage?start_date=${start}&end_date=${end}`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + Config.apiKey
      }
    })
    let usage = await usageRes.json()
    const { total_usage: totalUsage } = usage
    expiresAt = formatDate(new Date(expiresAt * 1000))
    let left = hardLimit - totalUsage / 100
    this.reply('总额度：$' + hardLimit + '\n已经使用额度：$' + totalUsage / 100 + '\n当前剩余额度：$' + left + '\n到期日期(UTC)：' + expiresAt)
  }

  /**
   * 其他模式
   * @param e
   * @param mode
   * @param {string|RegExp} pattern
   * @returns {Promise<boolean>}
   */
  async otherMode(e, mode, pattern = `#${mode}`) {
    if (!Config.allowOtherMode) {
      return false
    }
    let ats = e.message.filter(m => m.type === 'at')
    if (!(e.atme || e.atBot) && ats.length > 0) {
      if (Config.debug) {
        logger.mark('艾特别人了，没艾特我，忽略' + pattern)
      }
      return false
    }
    let prompt = _.replace(e.msg.trimStart(), pattern, '').trim()
    if (prompt.length === 0) {
      return false
    }
    let forcePictureMode = e.msg.trimStart().startsWith('#图片')
    await this.abstractChat(e, prompt, mode, forcePictureMode)
    return true
  }
}
