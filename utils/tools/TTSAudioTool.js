import { AbstractTool } from './AbstractTool.js'
import { generateAudio } from '../common.js'

/** 文字转语音发送工具 */
export class TTSAudioTool extends AbstractTool {
  name = 'sendTTSAudio'

  parameters = {
    properties: {
      message: {
        type: 'string',
        description: '需要转化为语音并发送给用户的文字内容'
      }
    },
    required: ['message']
  }

  func = async function (opts, e) {
    let { message } = opts
    try {
      let sendable = await generateAudio(e, message)
      if (sendable) {
        await e.reply(sendable)
        return '语音已成功发送给用户. If no extra description needed, just reply <EMPTY> at the next turn.'
      }
      return '语音生成失败，请检查配置'
    } catch (err) {
      return `语音发送失败: ${err.message}`
    }
  }

  description = 'Useful when you want to send a voice message to the user. 避免复读，不要让回复文本与语音内容雷同。'
}