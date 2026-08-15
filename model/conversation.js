import { getUin, getUserData, normalizeChatMode } from '../utils/common.js'
import { Config } from '../utils/config.js'
import { KeyvFile } from 'keyv-file'
import _ from 'lodash'

export const originalValues = ['克劳德', 'api', 'API', 'responses', 'Responses', 'glm', '双子星', '双子座']
export const correspondingValues = ['claude', 'api', 'api', 'responses', 'responses', 'chatglm', 'gemini', 'gemini']

const REDIS_SCAN_COUNT = 3000
const REDIS_DELETE_BATCH_SIZE = 1000

async function deleteRedisKeys(patterns) {
  const deleteCommand = typeof redis.unlink === 'function' ? 'UNLINK' : 'DEL'
  let totalDeleted = 0

  async function processPattern(pattern) {
    let batch = []
    let deleted = 0
    for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: REDIS_SCAN_COUNT })) {
      batch.push(key)
      if (batch.length >= REDIS_DELETE_BATCH_SIZE) {
        const removed = await redis.sendCommand([deleteCommand, ...batch])
        deleted += Number(removed) || 0
        batch = []
      }
    }
    if (batch.length > 0) {
      const removed = await redis.sendCommand([deleteCommand, ...batch])
      deleted += Number(removed) || 0
    }
    return deleted
  }

  const results = await Promise.all(patterns.map(p => processPattern(p)))
  totalDeleted = results.reduce((a, b) => a + b, 0)
  return totalDeleted
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
    case 'api':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS:*'],
        historyPatterns: ['CHATGPT:MESSAGE:*']
      }
    case 'responses':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_RESPONSES:*']
      }
    case 'gemini':
      return {
        conversationPatterns: ['CHATGPT:CONVERSATIONS_GEMINI:*'],
        historyPatterns: ['CHATGPT:MESSAGE_Gemini:*']
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
      use = normalizeChatMode((userData.mode === 'default' ? null : userData.mode) || await redis.get('CHATGPT:USE'))
    }
    console.log(use)
    await redis.del(`CHATGPT:WRONG_EMOTION:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`)
    // fast implementation
    if (use === 'claude') {
      await redis.del(`CHATGPT:CONVERSATIONS_CLAUDE:${(e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id}`)
      await this.reply('claude对话已结束')
      return
    }
    let ats = e.message.filter(m => m.type === 'at')
    const isAtMode = Config.toggleMode === 'at'
    if (isAtMode) ats = ats.filter(item => item.qq !== getUin(e))
    if (ats.length === 0) {
      if (use === 'api') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS:${e.sender.user_id}`)
        if (!c) {
          await this.reply('当前没有开启对话', true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS:${e.sender.user_id}`)
          await this.reply('已结束当前对话，请@我进行聊天以开启新的对话', true)
        }
      } else if (use === 'responses') {
        const scope = (e.isGroup && Config.groupMerge) ? e.group_id.toString() : e.sender.user_id
        let c = await redis.get(`CHATGPT:CONVERSATIONS_RESPONSES:${scope}`)
        if (!c) {
          await this.reply('当前没有开启对话', true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_RESPONSES:${scope}`)
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
      }
    } else {
      let at = ats[0]
      let qq = at.qq
      let atUser = _.trimStart(at.text, '@') || _.trimStart(at.name, '@')
      if (use === 'api') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS:${qq}`)
        if (!c) {
          await this.reply(`当前${atUser}没有开启对话`, true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS:${qq}`)
          await this.reply(`已结束${atUser}的对话，TA仍可以@我进行聊天以开启新的对话`, true)
        }
      } else if (use === 'responses') {
        let c = await redis.get(`CHATGPT:CONVERSATIONS_RESPONSES:${qq}`)
        if (!c) {
          await this.reply(`当前${atUser}没有开启对话`, true)
        } else {
          await redis.del(`CHATGPT:CONVERSATIONS_RESPONSES:${qq}`)
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
      }
    }
  }

  async endAllConversations(e) {
    const match = e.msg.trim().match(`^#?(${originalValues.join('|')})?(结束|新开|摧毁|毁灭|完结|清理)全部(模式|模型)?对话$`)

    if (match?.[3]) {
      const conversationPatterns = [
        'CHATGPT:CONVERSATIONS:*',
        'CHATGPT:CONVERSATIONS_RESPONSES:*',
        'CHATGPT:QQ_CONVERSATION:*',
        'CHATGPT:CONVERSATIONS_GEMINI:*',
        'CHATGPT:CONVERSATIONS_CLAUDE:*',
      ]
      const historyPatterns = [
        'CHATGPT:MESSAGE:*',
        'CHATGPT:MESSAGE_Gemini:*',
        'CHATGPT:MESSAGE_Claude:*',
        'CHATGPT:QQ_MESSAGE:*'
      ]
      const metadataPatterns = [
        'CHATGPT:WRONG_EMOTION:*',
        'CHATGPT:CONVERSATION_LAST_MESSAGE_PROMPT:*',
        'CHATGPT:CONVERSATION_LAST_MESSAGE_ID:*',
        'CHATGPT:CONVERSATION_CREATER_ID:*',
        'CHATGPT:CONVERSATION_CREATER_NICK_NAME:*'
      ]

      const [deletedConversations] = await Promise.all([
        deleteRedisKeys(conversationPatterns, 'conversation'),
        deleteRedisKeys(historyPatterns, 'history'),
        deleteRedisKeys(metadataPatterns, 'conversation metadata')
      ])

      await clearKeyvNamespace(Config.toneStyle)
      await clearKeyvNamespace('chatglm_6b')

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
