import { resolveProvider, providerConversationKey } from '../utils/providers.js'
import { providerLabel } from '../utils/providerProfiles.js'
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
    const row = resolveProvider()
    const ats = (e.message || []).filter(m => m.type === 'at' && String(m.qq) !== String(getUin(e)))
    if (ats.length && !e.isMaster) { await this.reply('只有主人可以结束他人的对话'); return }
    const scope = e.isGroup && Config.groupMerge ? String(e.group_id) : ats[0]?.qq || e.sender.user_id
    await redis.del(providerConversationKey(row, scope))
    await this.reply(`${providerLabel(row)} 对话已结束`, true)
  }

  async endAllConversations(e) {
    if (!e.isMaster) { await this.reply('只有主人可以结束全部会话'); return }
    const all = /全部|所有|全模式/.test(e.msg)
    const pattern = all ? 'CHATGPT:CONVERSATIONS_V2:*' : `CHATGPT:CONVERSATIONS_V2:${resolveProvider().id}:*`
    let count = 0
    for await (const key of redis.scanIterator({ MATCH: pattern })) count += await redis.del(key)
    await this.reply(`已结束 ${count} 个会话`, false)
  }
}
