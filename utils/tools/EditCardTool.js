import { AbstractTool } from './AbstractTool.js'

export class EditCardTool extends AbstractTool {
  name = 'editCard'

  parameters = {
    properties: {
      qq: {
        type: 'string',
        description: '你想改名片的那个人的qq号，默认为聊天对象'
      },
      card: {
        type: 'string',
        description: 'the new card'
      },
      groupId: {
        type: 'string',
        description: 'group number'
      }
    },
    required: ['card', 'groupId']
  }

  description = 'Useful when you want to edit someone\'s card in the group(群名片)'

  func = async function (opts, e) {
    let { qq, card, groupId, sender, isAdmin } = opts
    qq = isNaN(qq) || !qq ? e.sender.user_id : parseInt(qq.trim())
    groupId = isNaN(groupId) || !groupId ? e.group_id : parseInt(groupId.trim())

    // 检查权限：只有主人/管理员，可以对其他群友生效
    if (!(e.isMaster || e.sender.role == 'owner'|| e.sender.role == 'admin')) {
      if (qq != e.sender.user_id) {
        return 'Only the master or Group admin can block other users.'
      }
    }

    let group = await e.bot.pickGroup(groupId)
    try {
      let mm = await group.getMemberMap()
      if (!mm.has(qq)) {
        return `failed, the user ${qq} is not in group ${groupId}`
      }
      if (mm.get(e.bot.uin) && mm.get(e.bot.uin).role === 'member') {
        return `failed, you, not user, don't have permission to edit card in group ${groupId}`
      }
    } catch (err) {
      logger.error('获取群信息失败，可能使用的底层协议不完善')
    }
    logger.info('edit card: ', groupId, qq)
    if (isAdmin || sender == qq) {
      await group.setCard(qq, card)
    } else {
      return 'the user is not admin, he can\'t edit card of other people.'
    }
    return `the user ${qq}'s card has been changed into ${card}`
  }
}
