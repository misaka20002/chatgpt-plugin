import { getUin, getUserData } from '../utils/common.js'
import { Config } from '../utils/config.js'
import { KeyvFile } from 'keyv-file'
import _ from 'lodash'

export const originalValues = ['星火', '通义千问', '克劳德', '克劳德2', '必应', 'api', 'API', 'api3', 'API3', 'glm', '双子星', '双子座', '智谱']
export const correspondingValues = ['xh', 'qwen', 'claude', 'claude2', 'bing', 'api', 'api', 'api3', 'api3', 'chatglm', 'gemini', 'gemini', 'chatglm4']

const REDIS_SCAN_COUNT = 200
const REDIS_DELETE_BATCH_SIZE = 200

async function deleteRedisKeys(patterns, debugLabel = '') {
  const deleteCommand = typeof redis.unlink === 'function' ? 'UNLINK' : 'DEL'
  let deleted = 0
  let matched = 0

  async function flushBatch(batch, pattern) {
    if (batch.length === 0) {
      return
    }

    const removed = await redis.sendCommand([deleteCommand, ...batch])
    deleted += Number(removed) || 0

    if (Config.debug && debugLabel) {
      logger.info(`delete ${debugLabel}: pattern=${pattern}, batch=${batch.length}, command=${deleteCommand}`)
    }
  }

  for (const pattern of patterns) {
    let batch = []

    for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: REDIS_SCAN_COUNT })) {
      batch.push(key)
      matched++

      if (batch.length >= REDIS_DELETE_BATCH_SIZE) {
        await flushBatch(batch, pattern)
        batch = []
      }
    }

    await flushBatch(batch, pattern)
  }

  if (Config.debug && debugLabel) {
    logger.info(`delete ${debugLabel} summary: matched=${matched}, deleted=${deleted}, patterns=${patterns.length}`)
  }

  return deleted
}

async function clearKeyvNamespace(namespace) {
  let Keyv
  try {
    Keyv = (await import('keyv')).default
  } catch (err) {
    logger.warn(`清理 ${namespace} 命名空间失败，依赖 keyv 未安装`, err)
    return false
  }

  try {
    const cache = new Keyv({
      store: new KeyvFile({ filename: 'cache.json' }),
      namespace
    })
    if (typeof cache.clear === 'function') {
      await cache.clear()
      return true
    }
    logger.warn(`当前 keyv 存储不支持 clear，跳过清理命名空间: ${namespace}`)
  } catch (err) {
    logger.warn(`清理命名空间失败: ${namespace}`, err)
  }

  return false
}

function getCurrentModeCleanupTargets(use) {
  switch (use) {
    case 'claude':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_CLAUDE:*'],
        historyPatterns: ['CHATGPT:MESSAGE_Claude:*'],
        metadataPatterns: ['CHATGPT:WRONG_EMOTION:*']
      }
    case 'claude2':
      return {
        conversationPatterns: ['CHATGPT:CLAUDE2_CONVERSATION:*']
      }
    case 'xh':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_XH:*'],
        keyvNamespaces: ['xh']
      }
    case 'bing':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_BING:*'],
        metadataPatterns: ['CHATGPT:WRONG_EMOTION:*'],
        keyvNamespaces: [Config.toneStyle]
      }
    case 'api':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS:*'],
        historyPatterns: ['CHATGPT:MESSAGE:*']
      }
    case 'api3':
      return {
        conversationPatterns: ['CHATGPT:QQ_CONVERSATION:*'],
        historyPatterns: ['CHATGPT:QQ_MESSAGE:*'],
        metadataPatterns: [
          'CHATGPT:CONVERSATION_LAST_MESSAGE_PROMPT:*',
          'CHATGPT:CONVERSATION_LAST_MESSAGE_ID:*',
          'CHATGPT:CONVERSATION_CREATER_ID:*',
          'CHATGPT:CONVERSATION_CREATER_NICK_NAME:*'
        ]
      }
    case 'chatglm':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_CHATGLM:*'],
        historyPatterns: ['CHATGPT:MESSAGE_CHATGLM:*'],
        keyvNamespaces: ['chatglm_6b']
      }
    case 'qwen':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_QWEN:*'],
        historyPatterns: ['CHATGPT:MESSAGE_QWEN:*']
      }
    case 'gemini':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_GEMINI:*'],
        historyPatterns: ['CHATGPT:MESSAGE_Gemini:*']
      }
    case 'chatglm4':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_CHATGLM4:*'],
        historyPatterns: ['CHATGPT:MESSAGE_CHATGLM4:*']
      }
    case 'browser':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_BROWSER:*']
      }
    case 'azure':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_AZURE:*']
      }
    default:
      return {
        conversationPatterns: []
      }
  }
}

export class ConversationManager {
  async endConversation(e) {
    const userData = await getUserData(e.user_id)
    const match = e.msg.trim().match('^#?(.*)(结束|新开|摧毁|毁灭|完结)对话')
    console.log(match[1])
    let use
    if (match[1] && match[1] != 'chatgpt') {
      use = correspondingValues[originalValues.indexOf(match[1])]
    } else {
      use = (userData.mode === 'default' ? null : userData.mode) || await redis.get('CHATGPT:USE')
    }
    console.log(use)
    await redis.del(`CHATGPT:WRONG_EMOTION:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`)
    // fast implementation
    if (use === 'claude') {
      await redis.del(`CHATGPT:CONVERSATIONS_CLAUDE:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`)
      await this.reply('claude对话已结束')
      return
    }
    if (use === 'claude2') {
      await redis.del(`CHATGPT:CLAUDE2_CONVERSATION:${e.sender.user_id}`)
      await this.reply('claude.ai对话已结束')
      return
    }
    if (use === 'xh') {
      await redis.del(`CHATGPT:CONVERSATIONS_XH:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`)
      await this.reply('星火对话已结束')
      return
    }
    let ats = e.message.filter(m => m.type === 'at')
    const isAtMode = Config.toggleMode === 'at'
    if (isAtMode) ats = ats.filter(item => item.qq !== getUin(e))
    if (ats.length === 0) {
      if (use === 'api3') {
        await redis.del(`CHATGPT:QQ_CONVERSATION:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`)
        await this.reply('已退出当前对话，该对话仍然保留。请@我进行聊天以开启新的对话', true)
      } else if (use === 'bing') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_BING:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`)
        if (!c) {
          await this.reply('当前没有开启对话', true)
          return
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_BING:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`)
        }
        const conversation = {
          store: new KeyvFile({ filename: 'cache.json' }),
          namespace: Config.toneStyle
        }
        let Keyv
        try {
          Keyv = (await import('keyv')).default
        } catch (err) {
          await this.reply('依赖keyv未安装，请执行pnpm install keyv', true)
        }
        const conversationsCache = new Keyv(conversation)
        logger.info(`SydneyUser_${e.sender.user_id}`, await conversationsCache.get(`SydneyUser_${e.sender.user_id}`))
        await conversationsCache.delete(`SydneyUser_${e.sender.user_id}`)
        await this.reply('已退出当前对话，该对话仍然保留。请@我进行聊天以开启新的对话', true)
      } else if (use === 'chatglm') {
        const conversation = {
          store: new KeyvFile({ filename: 'cache.json' }),
          namespace: 'chatglm_6b'
        }
        let Keyv
        try {
          Keyv = (await import('keyv')).default
        } catch (err) {
          await this.reply('依赖keyv未安装，请执行pnpm install keyv', true)
        }
        const conversationsCache = new Keyv(conversation)
        logger.info(`ChatGLMUser_${e.sender.user_id}`, await conversationsCache.get(`ChatGLMUser_${e.sender.user_id}`))
        await conversationsCache.delete(`ChatGLMUser_${e.sender.user_id}`)
        await this.reply('已退出当前对话，该对话仍然保留。请@我进行聊天以开启新的对话', true)
      } else if (use === 'api') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS:${e.sender.user_id}`)
        if (!c) {
          await this.reply('当前没有开启对话', true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS:${e.sender.user_id}`)
          await this.reply('已结束当前对话，请@我进行聊天以开启新的对话', true)
        }
      } else if (use === 'qwen') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_QWEN:${e.sender.user_id}`)
        if (!c) {
          await this.reply('当前没有开启对话', true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_QWEN:${e.sender.user_id}`)
          await this.reply('已结束当前对话，请@我进行聊天以开启新的对话', true)
        }
      } else if (use === 'gemini') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_GEMINI:${e.sender.user_id}`)
        if (!c) {
          await this.reply('当前没有开启对话', true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_GEMINI:${e.sender.user_id}`)
          await this.reply('已结束当前对话，请@我进行聊天以开启新的对话', true)
        }
      } else if (use === 'chatglm4') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_CHATGLM4:${e.sender.user_id}`)
        if (!c) {
          await this.reply('当前没有开启对话', true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_CHATGLM4:${e.sender.user_id}`)
          await this.reply('已结束当前对话，请@我进行聊天以开启新的对话', true)
        }
      } else if (use === 'bing') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_BING:${e.sender.user_id}`)
        if (!c) {
          await this.reply('当前没有开启对话', true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_BING:${e.sender.user_id}`)
          await this.reply('已结束当前对话，请@我进行聊天以开启新的对话', true)
        }
      } else if (use === 'browser') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_BROWSER:${e.sender.user_id}`)
        if (!c) {
          await this.reply('当前没有开启对话', true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_BROWSER:${e.sender.user_id}`)
          await this.reply('已结束当前对话，请@我进行聊天以开启新的对话', true)
        }
      }
    } else {
      let at = ats[0]
      let qq = at.qq
      let atUser = _.trimStart(at.text, '@') || _.trimStart(at.name, '@')
      if (use === 'api3') {
        await redis.del(`CHATGPT:QQ_CONVERSATION:${qq}`)
        await this.reply(`${atUser}已退出TA当前的对话，TA仍可以@我进行聊天以开启新的对话`, true)
      } else if (use === 'bing') {
        const conversation = {
          store: new KeyvFile({ filename: 'cache.json' }),
          namespace: Config.toneStyle
        }
        let Keyv
        try {
          Keyv = (await import('keyv')).default
        } catch (err) {
          await this.reply('依赖keyv未安装，请执行pnpm install keyv', true)
        }
        const conversationsCache = new Keyv(conversation)
        await conversationsCache.delete(`SydneyUser_${qq}`)
        await this.reply('已退出当前对话，该对话仍然保留。请@我进行聊天以开启新的对话', true)
      } else if (use === 'chatglm') {
        const conversation = {
          store: new KeyvFile({ filename: 'cache.json' }),
          namespace: 'chatglm_6b'
        }
        let Keyv
        try {
          Keyv = (await import('keyv')).default
        } catch (err) {
          await this.reply('依赖keyv未安装，请执行pnpm install keyv', true)
        }
        const conversationsCache = new Keyv(conversation)
        logger.info(`ChatGLMUser_${e.sender.user_id}`, await conversationsCache.get(`ChatGLMUser_${e.sender.user_id}`))
        await conversationsCache.delete(`ChatGLMUser_${qq}`)
        await this.reply('已退出当前对话，该对话仍然保留。请@我进行聊天以开启新的对话', true)
      } else if (use === 'api') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS:${qq}`)
        if (!c) {
          await this.reply(`当前${atUser}没有开启对话`, true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS:${qq}`)
          await this.reply(`已结束${atUser}的对话，TA仍可以@我进行聊天以开启新的对话`, true)
        }
      } else if (use === 'qwen') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_QWEN:${qq}`)
        if (!c) {
          await this.reply(`当前${atUser}没有开启对话`, true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_QWEN:${qq}`)
          await this.reply(`已结束${atUser}的对话，TA仍可以@我进行聊天以开启新的对话`, true)
        }
      } else if (use === 'gemini') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_GEMINI:${qq}`)
        if (!c) {
          await this.reply(`当前${atUser}没有开启对话`, true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_GEMINI:${qq}`)
          await this.reply(`已结束${atUser}的对话，TA仍可以@我进行聊天以开启新的对话`, true)
        }
      } else if (use === 'chatglm4') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_CHATGLM4:${qq}`)
        if (!c) {
          await this.reply(`当前${atUser}没有开启对话`, true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_CHATGLM4:${qq}`)
          await this.reply(`已结束${atUser}的对话，TA仍可以@我进行聊天以开启新的对话`, true)
        }
      } else if (use === 'bing') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_BING:${qq}`)
        if (!c) {
          await this.reply(`当前${atUser}没有开启对话`, true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_BING:${qq}`)
          await this.reply(`已结束${atUser}的对话，TA仍可以@我进行聊天以开启新的对话`, true)
        }
      } else if (use === 'browser') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_BROWSER:${qq}`)
        if (!c) {
          await this.reply(`当前${atUser}没有开启对话`, true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_BROWSER:${qq}`)
          await this.reply(`已结束${atUser}的对话，TA仍可以@我进行聊天以开启新的对话`, true)
        }
      }
    }
  }

  async endAllConversations(e) {
    const match = e.msg.trim().match(`^#?(${originalValues.join('|')})?(结束|新开|摧毁|毁灭|完结|清理)全部(模式|模型)?对话$`)

    if (match?.[3]) {
      const conversationPatterns = [
        'CHATGPT:CONVERSATIONS:*',
        'CHATGPT:QQ_CONVERSATION:*',
        'CHATGPT:CONVERSATIONS_BING:*',
        'CHATGPT:CONVERSATIONS_CHATGLM:*',
        'CHATGPT:CONVERSATIONS_QWEN:*',
        'CHATGPT:CONVERSATIONS_GEMINI:*',
        'CHATGPT:CONVERSATIONS_CLAUDE:*',
        'CHATGPT:CLAUDE2_CONVERSATION:*',
        'CHATGPT:CONVERSATIONS_CHATGLM4:*',
        'CHATGPT:CONVERSATIONS_XH:*',
        'CHATGPT:CONVERSATIONS_BROWSER:*',
        'CHATGPT:CONVERSATIONS_AZURE:*'
      ]
      const historyPatterns = [
        'CHATGPT:MESSAGE:*',
        'CHATGPT:MESSAGE_QWEN:*',
        'CHATGPT:MESSAGE_Gemini:*',
        'CHATGPT:MESSAGE_Claude:*',
        'CHATGPT:MESSAGE_CHATGLM:*',
        'CHATGPT:MESSAGE_CHATGLM4:*',
        'CHATGPT:QQ_MESSAGE:*'
      ]
      const metadataPatterns = [
        'CHATGPT:WRONG_EMOTION:*',
        'CHATGPT:CONVERSATION_LAST_MESSAGE_PROMPT:*',
        'CHATGPT:CONVERSATION_LAST_MESSAGE_ID:*',
        'CHATGPT:CONVERSATION_CREATER_ID:*',
        'CHATGPT:CONVERSATION_CREATER_NICK_NAME:*'
      ]

      const deletedConversations = await deleteRedisKeys(conversationPatterns, 'conversation')
      await deleteRedisKeys(historyPatterns, 'history')
      await deleteRedisKeys(metadataPatterns, 'conversation metadata')

      await clearKeyvNamespace(Config.toneStyle)
      await clearKeyvNamespace('chatglm_6b')
      await clearKeyvNamespace('xh')

      await this.reply(`已按全模式清理，结束了${deletedConversations}个会话，并清空可识别的历史记录。`, false)
      return
    }

    let use
    if (match?.[1] && match[1] !== 'chatgpt') {
      use = correspondingValues[originalValues.indexOf(match[1])]
    } else {
      use = await redis.get('CHATGPT:USE') || 'api'
    }

    const {
      conversationPatterns = [],
      historyPatterns = [],
      metadataPatterns = [],
      keyvNamespaces = []
    } = getCurrentModeCleanupTargets(use)

    const deletedConversations = await deleteRedisKeys(conversationPatterns, `${use} conversation`)
    await deleteRedisKeys(historyPatterns, `${use} history`)
    await deleteRedisKeys(metadataPatterns, `${use} metadata`)

    for (const namespace of keyvNamespaces) {
      await clearKeyvNamespace(namespace)
    }

    await this.reply(`已清理当前模式 ${use} 的数据，结束了${deletedConversations}个会话。`, false)
  }
}
