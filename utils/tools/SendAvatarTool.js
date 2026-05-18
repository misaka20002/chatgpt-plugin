import { AbstractTool } from './AbstractTool.js'

export class SendAvatarTool extends AbstractTool {
  name = 'sendAvatar'

  parameters = {
    properties: {
      qq: {
        type: 'string',
        description: 'QQ numbers to fetch avatars. Separate multiple with space.'
      },
      targetGroupIdOrQQNumber: {
        type: 'string',
        description: 'Target QQ or group ID to send avatars. Leave blank for default.'
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

  description = 'Fetch and send QQ avatars to a group/user. NOT for analyzing image content. Reply <EMPTY> if no extra text needed.'
}
