import { AbstractTool } from './AbstractTool.js'
import { convertFacesAndCQCode } from '../face.js'
import { Config } from '../config.js'

export class AtOtherUserTool extends AbstractTool {
  name = 'atOtherUser'

  parameters = {
    properties: {
      userIds: {
        type: 'string',
        description: 'QQ user IDs to mention (@). For multiple users, separate with commas (e.g., "123456789,987654321").'
      },
      message: {
        type: 'string',
        description: 'The message content to send along with the mention. This message should align with your character personality.'
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

      // 检查是否包含当前对话用户自己
      if (userIdList.includes(e.user_id.toString())) {
        return 'Cannot mention the current conversation user. This tool is only for mentioning OTHER users in the group. For replying to the current user, use normal conversation response instead.'
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
      let msgArr = convertFacesAndCQCode(message, Config.enableRobotAt, Config.isProcessCQAtCode, Config.removeCQCodeFocus, e)
      msg.push(...msgArr)

      // 发送消息
      await e.reply(msg)

      return `Successfully mentioned ${userIdList.length} user(s). IMPORTANT: The message "${message}" has already been sent to the group. Do NOT repeat or include this message content in your response to the user. If no extra description needed, just reply <EMPTY> at the next turn.`
    } catch (err) {
      return `Failed to mention users: ${err.message || err.stack || String(err)}`
    }
  }

  description = 'Mention (@) one or multiple OTHER group members by their QQ user IDs and send them a message. CRITICAL RESTRICTIONS: 1) NEVER use this tool to mention the current conversation user (the person you are talking to) - attempting to do so will be rejected. This tool is EXCLUSIVELY for mentioning OTHER users who are NOT currently in the conversation. 2) For normal replies to the current user, use standard conversation responses instead. 3) Only works in group chats. 4) The message will be sent immediately upon calling this tool, so DO NOT repeat the message content in your subsequent response. If no extra description needed, just reply <EMPTY> at the next turn.'
}
