import { AbstractTool } from './AbstractTool.js'

export class SendAvatarTool extends AbstractTool {
  name = 'sendAvatar'

  parameters = {
    properties: {
      qq: {
        type: 'string',
        description: 'if you need to send avatar of a user, input his qq.If there are multiple qq, separate them with a space'
      },
      targetGroupIdOrQQNumber: {
        type: 'string',
        description: 'Fill in the target user\'s qq number or groupId when you need to send avatar to specific user or group, otherwise leave blank'
      }
    },
    required: ['qq', 'targetGroupIdOrQQNumber']
  }

  func = async function (opts, e) {
    let { qq, targetGroupIdOrQQNumber } = opts
    const pictures = qq.split(/[,，\s]/).filter(qq => !isNaN(qq.trim()) && qq.trim()).map(qq => segment.image('https://q1.qlogo.cn/g?b=qq&s=0&nk=' + parseInt(qq.trim())))
    if (!pictures.length) {
      return 'there is no valid qq'
    }
    const defaultTarget = e.isGroup ? e.group_id : e.sender.user_id
    const target = isNaN(targetGroupIdOrQQNumber) || !targetGroupIdOrQQNumber
      ? defaultTarget
      : parseInt(targetGroupIdOrQQNumber) === e.bot.uin ? defaultTarget : parseInt(targetGroupIdOrQQNumber)
    let groupList
    try {
      groupList = await e.bot.getGroupList()
    } catch (err) {
      groupList = e.bot.gl
    }
    console.log('sendAvatar', target, pictures)

    // 判断groupList是Map还是Array
    const isGroupExist = groupList instanceof Map
      ? groupList.has(target)
      : Array.isArray(groupList)
        ? groupList.includes(target)
        : groupList && groupList[target]

    if (isGroupExist) {
      let group = await e.bot.pickGroup(target)
      await group.sendMsg(pictures)
    }
    return `the ${pictures.length > 1 ? 'users: ' + qq + '\'s avatar' : 'avatar'} has been sent to group ${target}`
  }

  description = 'Use this tool to SEND/DISPLAY user avatar images to a group or user. This tool fetches and sends avatar pictures as messages. DO NOT use this tool for analyzing or recognizing avatar content - use recognize_image tool instead for that purpose. If no extra description needed, just reply <EMPTY> at the next turn'
}
