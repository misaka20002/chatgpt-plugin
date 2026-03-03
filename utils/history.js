import { Config } from '../utils/config.js'

export async function upsertMessage(message, suffix = '') {
  if (suffix) {
    suffix = '_' + suffix
  }
  await redis.set(`CHATGPT:MESSAGE${suffix}:${message.id}`, JSON.stringify(message), Config.conversationPreserveTime > 0 ? { EX: Config.conversationPreserveTime } : {})
}

export async function getMessageById(id, suffix = '') {
  if (suffix) {
    suffix = '_' + suffix
  }
  let messageStr = await redis.get(`CHATGPT:MESSAGE${suffix}:${id}`)
  return JSON.parse(messageStr)
}