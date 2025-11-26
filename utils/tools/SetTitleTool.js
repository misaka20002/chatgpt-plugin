import { AbstractTool } from './AbstractTool.js'

export class SetTitleTool extends AbstractTool {
  name = 'setTitle'

  parameters = {
    properties: {
      qq: {
        type: 'string',
        description: '你想给予群头衔的那个人的qq号，默认为聊天对象'
      },
      title: {
        type: 'string',
        description: '群头衔'
      },
      groupId: {
        type: 'string',
        description: 'group number'
      }
    },
    required: ['title', 'groupId']
  }

  description = 'Useful when you want to give someone a title in the group(群头衔)'

  func = async function (opts, e) {
    let { qq, title, groupId } = opts
    qq = isNaN(qq) || !qq ? e.sender.user_id : parseInt(qq.trim())
    groupId = isNaN(groupId) || !groupId ? e.group_id : parseInt(groupId.trim())

    // 检查权限：只有主人/管理员，可以对其他群友生效
    if (!(e.isMaster || e.sender.role == 'owner'|| e.sender.role == 'admin')) {
      if (qq != e.sender.user_id) {
        return 'Only the master or Group admin can block other users.'
      }
    }

    let group = await e.bot.pickGroup(groupId)
    let mm = await group.getMemberMap()
    if (!mm.has(qq)) {
      return `failed, the user ${qq} is not in group ${groupId}`
    }
    if (mm.get(e.bot.uin).role !== 'owner') {
      return 'failed, only group owner can give title'
    }
    logger.info('edit card: ', groupId, qq)
    let result = await group.setTitle(qq, title)
    if (result) {
      return `the user ${qq}'s title has been changed into ${title}`
    } else {
      return 'failed'
    }
  }
}
