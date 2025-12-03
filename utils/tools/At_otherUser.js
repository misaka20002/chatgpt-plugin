import { AbstractTool } from './AbstractTool.js'

export class AtOtherUserTool extends AbstractTool {
  name = 'atOtherUser'

  parameters = {
    properties: {
      userIds: {
        type: 'string',
        description: '要At的用户QQ号，多个用户用英文逗号分隔，例如: "123456789,987654321"'
      },
      message: {
        type: 'string',
        description: 'At群友时要说的话，需要符合你的人设'
      }
    },
    required: ['userIds', 'message']
  }

  func = async function (opts, e) {
    let { userIds, message } = opts

    if (!e.isGroup) {
      return 'This tool can only be used in group chats'
    }

    if (!userIds || !message) {
      return 'Invalid parameters: userIds and message are required'
    }

    try {
      // 处理用户ID列表
      const userIdList = userIds.split(',').map(id => id.trim()).filter(id => id)
      
      if (userIdList.length === 0) {
        return 'No valid user IDs provided'
      }

      let msg = []
      
      // 添加所有At
      for (let userId of userIdList) {
        if (!isNaN(userId)) {
          msg.push(segment.at(userId))
        }
      }
      
      // 添加空格和消息内容
      if (msg.length > 0) {
        msg.push(' ')
      }
      msg.push(message)

      // 发送消息
      await e.reply(msg)
      
      return `Successfully mentioned ${userIdList.length} user(s). IMPORTANT: The message "${message}" has already been sent to the group. Do NOT repeat or include this message content in your response to the user. If no extra description needed, just reply <EMPTY> at the next turn.`
    } catch (err) {
      return `Failed to mention users: ${err.message || err.stack || String(err)}`
    }
  }

  description = 'Mention (@) one or multiple group members by their QQ user IDs and send them a message. This tool can only be used in group chats. The message will be sent immediately when you call this tool, so do not repeat the message content in your response. If no extra description needed, just reply <EMPTY> at the next turn.'
}
