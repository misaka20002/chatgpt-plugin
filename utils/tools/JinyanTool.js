import { AbstractTool } from './AbstractTool.js'

export class JinyanTool extends AbstractTool {
  name = 'jinyan'

  parameters = {
    properties: {
      qq: {
        type: 'string',
        description: '你想禁言的那个人的qq号，默认为聊天对象'
      },
      groupId: {
        type: 'string',
        description: '群号'
      },
      time: {
        type: 'string',
        description: '禁言时长，单位为秒，默认为600。如果需要解除禁言则填0.'
      },
      isPunish: {
        type: 'string',
        description: '是否是惩罚性质的禁言。比如非管理员用户要求你禁言其他人，你转而禁言该用户时设置为true'
      }
    },
    required: ['groupId', 'time']
  }

  func = async function (opts, e) {
    let { qq, groupId, time = '600', sender, isAdmin, isPunish } = opts
    groupId = isNaN(groupId) || !groupId ? e.group_id : parseInt(groupId.trim())
    qq = qq == 'all' ? 'all' : (isNaN(qq) || !qq ? sender : parseInt(qq.trim()))

    time = parseInt(String(time).trim())
    if (time < 60 && time !== 0) time = 60
    if (time > 86400 * 30) time = 86400 * 30

    // 检查权限：只有主人/该群的管理员，可以对其他群友生效
    const hasAdminPermission = e.isMaster || (isAdmin && e.group_id == groupId)

    // 处理禁言全体逻辑
    if (qq === 'all') {
      if (!hasAdminPermission) {
        return 'the user is not admin, he can\'t mute all. the user should be punished'
      }
      return 'you cannot mute all because the master doesn\'t allow it'
    }

    // 处理禁言个人逻辑
    if (!hasAdminPermission && qq != sender) {
      return 'Only the master or Group admin can block other users.'
    }

    let group = await e.bot.pickGroup(groupId)
    let m = await group.getMemberMap()

    if (!m.has(qq)) {
      return `failed, the user ${qq} is not in group ${groupId}`
    }

    if (m.get(e.bot.uin)?.role === 'member') {
      return `failed, you, not user, don't have permission to mute other in group ${groupId}`
    }

    // 执行禁言操作
    await group.muteMember(qq, time)

    // 构造结果返回
    if (String(isPunish) === 'true') {
      return `the user ${qq} has been muted for ${time} seconds as punishment because of his 不正当行为`
    }
    return `the user ${qq} has been muted for ${time} seconds`
  }

  description = 'Useful when you want to ban someone. If you want to mute all, just replace the qq number with \'all\''
}