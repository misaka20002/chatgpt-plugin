import { BaseClient } from './BaseClient.js'

import { getMessageById, upsertMessage } from '../utils/history.js'

/**
 * Gemini 基类：保留 history 管道、`this._key`（CustomGoogleGeminiClient 的 fetch 认证头用它）
 * 与 upsert/getMessageById 默认绑定；请求实现全部在 CustomGoogleGeminiClient（自写 fetch）。
 * 官方 @google/generative-ai SDK 路径与代理补丁已于 2026-10 随死代码清理移除。
 */
export class GoogleGeminiClient extends BaseClient {
  constructor (props) {
    if (!props.upsertMessage) {
      props.upsertMessage = async function umGemini (message) {
        return await upsertMessage(message, 'Gemini')
      }
    }
    if (!props.getMessageById) {
      props.getMessageById = async function umGemini (message) {
        return await getMessageById(message, 'Gemini')
      }
    }
    super(props)
    this._key = props.key
    this.supportFunction = false
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

  async destroyHistory (conversationId, opt = {}) {
    // todo clean history
  }
}
