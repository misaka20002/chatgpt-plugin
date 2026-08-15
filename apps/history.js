import plugin from '../../../lib/plugins/plugin.js'
import { render, getUin } from '../utils/common.js'
import { Config } from '../utils/config.js'
import { KeyvFile } from 'keyv-file'

async function getKeyv () {
  let Keyv
  try {
    Keyv = (await import('keyv')).default
  } catch (error) {
    throw new Error('keyv依赖未安装，请使用pnpm install keyv安装')
  }
  return Keyv
}
export class history extends plugin {
  constructor (e) {
    super({
      name: 'ChatGPT-Plugin 聊天记录',
      dsc: '让你的聊天更加便捷！本插件支持以图片的形式导出本次对话的聊天记录，方便随时分享精彩瞬间！',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#(chatgpt|ChatGPT)(导出)?聊天记录$',
          fnc: 'history',
          permission: 'master'
        }
      ]
    })
  }

  async history (e) {
    let use = await redis.get('CHATGPT:USE') || 'api'
    let chat = []
    let filtered = e.message.filter(m => m.type === 'at').filter(m => m.qq !== getUin(e))
    let queryUser = e.sender.user_id
    let user = e.sender
    if (filtered.length > 0) {
      queryUser = filtered[0].qq
      user = (await e.group.getMemberMap()).get(queryUser)
    }
    switch (use) {
      case 'api': {
        await e.reply('还不支持API模式呢')
        return true
      }
    }
    if (chat.length === 0) {
      await e.reply('无聊天记录', e.isGroup)
      return true
    }
    await render(e, 'chatgpt-plugin', 'content/History/index', {
      version: Config.version,
      user: {
        qq: queryUser,
        name: user.card || user.nickname || user.user_id
      },
      bot: {
        qq: getUin(e),
        name: e.bot.nickname
      },
      chat
    }, {})
  }
}

function getMessagesForConversation (messages, parentMessageId) {
  const orderedMessages = []
  let currentMessageId = parentMessageId
  while (currentMessageId) {
    const message = messages.find((m) => m.id === currentMessageId)
    if (!message) {
      break
    }
    orderedMessages.unshift(message)
    currentMessageId = message.parentMessageId
  }

  return orderedMessages
}
