import { AbstractTool } from './AbstractTool.js'

export class HandleMessageMsgTool extends AbstractTool {
  name = 'handleMsg'

  parameters = {
    properties: {
      type: {
        type: 'string',
        enum: ['recall', 'essence', 'un-essence'],
        description: 'what do you want to do with the message'
      },
      messageId: {
        type: 'string',
        description: 'which message to handle, current one by default'
      }
    },
    required: ['type']
  }

  func = async function (opts, e) {
    let { type = 'recall', messageId = e.message_id } = opts

    // 因为 gemini 太蠢了所以手动指定使用 source_message_id
    if (e.source_message_id && messageId == e.source_message_id)
      logger.mark("[ChatGPT][handleMsg] ai 已正确选择引用消息 source_message_id")
    else
      messageId = e.source_message_id || e.message_id

    try {
      switch (type) {
        case 'recall': {
          await e.group.recallMsg(messageId)
          break
        }
        case 'essence': {
          await e.bot.setEssenceMessage(messageId)
          break
        }
        case 'un-essence': {
          await e.bot.removeEssenceMessage(messageId)
          break
        }
      }
      return 'success!'
    } catch (err) {
      logger.error(err)
      return 'operation failed: ' + err.message
    }
  }

  description = '用来撤回消息或将消息设为精华'
}
