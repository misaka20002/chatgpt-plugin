import { AbstractTool } from './AbstractTool.js'
import fs from 'node:fs'

const SYSTEM_ADD_MODULE = '../../../system/add.js'

function cloneEvent (e) {
  return Object.assign(Object.create(Object.getPrototypeOf(e)), e)
}

/**
 * 读取云崽原生 #添加 / #全局添加 的可用关键词，并把实际发送交还给 system/add.js。
 * 工具不会读取或返回关键词对应的消息内容。
 */
export class DefaultMessageTriggerTool extends AbstractTool {
  name = 'triggerDefaultMessage'

  constructor (e) {
    super()

    this.groupKeywords = e?.isGroup ? readKeywords(e.group_id) : []
    this.globalKeywords = readKeywords('global')
    this.allowedKeywords = new Set([...this.groupKeywords, ...this.globalKeywords])

    const scopeDescription = [
      this.groupKeywords.length ? `Group: ${this.groupKeywords.join(', ')}` : '',
      this.globalKeywords.length ? `Global: ${this.globalKeywords.join(', ')}` : ''
    ].filter(Boolean).join('\n')

    this.description = [
      'Trigger a Yunzai preset message by key. The preset is sent directly; after success, do not repeat it.',
      scopeDescription
    ].join('\n')

    const keyword = {
      type: 'string',
      description: 'Exact preset key to trigger.'
    }
    if (this.allowedKeywords.size > 0) keyword.enum = [...this.allowedKeywords]

    this.parameters = {
      properties: { keyword },
      required: ['keyword']
    }
  }

  func = async (opts, e) => {
    const keyword = typeof opts?.keyword === 'string' ? opts.keyword.trim() : ''
    if (!keyword || !this.allowedKeywords.has(keyword)) {
      return 'The requested default-message key is not available in this conversation.'
    }

    try {
      const { add, messageMap } = await import(SYSTEM_ADD_MODULE)
      const triggerEvent = cloneEvent(e)
      triggerEvent.msg = keyword
      triggerEvent.raw_message = keyword
      triggerEvent.message = [{ type: 'text', text: keyword }]

      const addPlugin = new add()
      addPlugin.e = triggerEvent

      // 私聊只允许全局词条。仍由 add.js#getMessage 完成匹配和原样发送，
      // 这里只覆盖作用域解析，避免它通过 Redis 找到用户最近所在的群。
      if (!e.isGroup) {
        addPlugin.getGroupId = async () => (addPlugin.group_id = 'global')
        addPlugin.getKeyWordMsg = key => messageMap.global?.get(key) || []
      }

      const sent = await addPlugin.getMessage()
      if (sent === false) {
        return 'The default-message key no longer exists or could not be sent.'
      }
      return 'The default message was sent directly to the current conversation. Do not repeat its content.'
    } catch (err) {
      logger.error(`[ChatGPT][DefaultMessageTriggerTool] ${err.stack || err.message || err}`)
      return `Failed to trigger the default message: ${err.message || String(err)}`
    }
  }
}

function readKeywords (scope) {
  if (scope === undefined || scope === null || scope === '') return []
  try {
    const file = `data/messageJson/${scope}.json`
    if (!fs.existsSync(file)) return []
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Object.keys(data)
  } catch (err) {
    logger.warn(`[ChatGPT][DefaultMessageTriggerTool] failed to read ${scope} keys: ${err.message || err}`)
    return []
  }
}
