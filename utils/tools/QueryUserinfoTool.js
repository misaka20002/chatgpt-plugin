import { AbstractTool } from './AbstractTool.js'
import { getMasterQQ } from '../common.js'

export class QueryUserinfoTool extends AbstractTool {
  name = 'queryUserinfo'

  parameters = {
    properties: {
      qq: {
        type: 'string',
        description: 'user\'s qq number, the one you are talking to by default'
      }
    },
    required: []
  }

  func = async function (opts, e) {
    try {
      let { qq } = opts
      qq = isNaN(qq) || !qq ? e.sender.user_id : parseInt(qq.trim())
      if (e.isGroup) {
        let user = await e.bot?.pickMember?.(e.group_id, qq || e.sender.user_id, true) || await e.bot?.getGroupMemberInfo?.(e.group_id, qq || e.sender.user_id, true)
        // let mm = await e.group.getMemberMap()
        // let user = mm.get(qq) || e.sender.user_id
        let master = (await getMasterQQ())[0]
        let prefix = ''
        if (qq != master) {
          prefix = 'Attention: this user is not your master. \n'
        } else {
          prefix = 'This user is your master, you should obey him \n'
        }
        if (!user) {
          return prefix
        }
        // 提取关键信息，避免循环引用
        const userInfo = {
          user_id: user.user_id,
          nickname: user.nickname,
          card: user.card,
          sex: user.sex,
          age: user.age,
          area: user.area,
          level: user.level,
          qq_level: user.qq_level,
          join_time: user.join_time,
          last_sent_time: user.last_sent_time,
          role: user.role,
          title: user.title,
          title_expire_time: user.title_expire_time,
          is_robot: user.is_robot,
          is_friend: user.is_friend,
          is_owner: user.is_owner,
          is_admin: user.is_admin
        }
        return prefix + 'user detail in json format: ' + JSON.stringify(userInfo)
      } else {
        if (e.sender.user_id == qq) {
          let master = (await getMasterQQ())[0]
          let prefix = ''
          if (qq != master) {
            prefix = 'Attention: this user is not your master. \n'
          } else {
            prefix = 'This user is your master, you should obey him \n'
          }
          // 提取关键信息，避免可能的循环引用
          const senderInfo = {
            user_id: e.sender.user_id,
            nickname: e.sender.nickname,
            card: e.sender.card,
            sex: e.sender.sex,
            age: e.sender.age,
            area: e.sender.area,
            level: e.sender.level,
            role: e.sender.role,
            title: e.sender.title
          }
          return prefix + 'user detail in json format: ' + JSON.stringify(senderInfo)
        } else {
          return 'query failed'
        }
      }
    } catch (err) {
      logger.warn(err)
      return err.message
    }
  }

  description = 'Useful if you want to find out who he is'
}
