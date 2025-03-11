import { AbstractTool } from './AbstractTool.js'

export class QueryStarRailTool extends AbstractTool {
  name = 'queryStarRail'

  parameters = {
    properties: {
      qq: {
        type: 'string',
        description: '要查询的用户的qq号，将使用该qq号绑定的uid进行查询，默认为当前聊天对象'
      },
      uid: {
        type: 'string',
        description: '游戏的uid，如果用户提供了则传入并优先使用'
      },
      character: {
        type: 'string',
        description: '游戏角色名'
      }
    },
    required: []
  }

  func = async function (opts, e) {
    let { qq, uid = '', character = '' } = opts
    qq = isNaN(qq) || !qq ? e.sender.user_id : parseInt(qq.trim())
    if (e.at === e.bot.uin) {
      e.at = null
    }
    e.atBot = false
    try {
      if (character) {
        let ProfileDetail = (await import('../../../miao-plugin/apps/profile/ProfileDetail.js')).default
        // e.msg = `#${character}面板${uid}`
        e.original_msg = `*${character}面板${uid}`
        e.user_id = parseInt(qq)
        e.isSr = true
        await ProfileDetail.detail(e)
        return 'the character panel of star rail has been sent to group. you don\'t need text version'
      } else {
        let ProfileList = (await import('../../../miao-plugin/apps/profile/ProfileList.js')).default
        e.msg = `*面板${uid}`
        e.user_id = qq
        e.isSr = true
        await ProfileList.render(e)
        return 'the player panel of star rail has been sent to group. you don\'t need text version'
      }
    } catch (err) {
      return `failed to query, error: ${err.toString()}`
    }
  }

  description = 'Useful when you want to query player information of Honkai Star Rail(崩坏：星穹铁道). '
}
