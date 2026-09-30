import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'
import { extractUserProfile, formatProfileView } from '../memory/profile.js'

/**
 * Tool: 用户画像（V2）
 *
 * 由 enableMemory 总开关自动注册。只从 V2 读取已存事实并返回结构化画像，
 * 不扫描群历史、不写入新事实，也不输出无证据的人格概括。
 *
 * 安全约束（服务端强制）：
 * - 仅限已授权采集的群（memoryGroupCapture.groups 中 switchOn=true）
 * - 普通成员只能分析本人；Bot 主人可分析任意成员
 */
export class UserProfileTool extends AbstractTool {
  name = 'userProfile'

  parameters = {
    properties: {
      target_id: {
        type: 'string',
        description: 'The QQ number of the user whose stored profile should be retrieved. Only the caller themselves, or the bot master for any member.'
      }
    },
    required: ['target_id']
  }

  func = async function (opts, e) {
    const { target_id } = opts

    if (!target_id) {
      return 'Error: target_id (QQ number) is required.'
    }
    if (!e?.group_id || !e?.isGroup) {
      return 'Error: This tool can only be used in group chats.'
    }

    // 服务端强制：当前群必须已授权记忆采集
    const groups = Array.isArray(Config.memoryGroupCapture?.groups) ? Config.memoryGroupCapture.groups : []
    const authorized = groups.some(g => g && g.switchOn && String(g.groupId) === String(e.group_id))
    if (!authorized) {
      return 'Error: 本群未开启记忆采集（需 Bot 主人在锅巴"授权采集群"或群内 #群记忆开启 授权），userProfile 不可用。'
    }

    // 服务端强制：普通成员只能分析本人；主人可分析任意成员
    const selfId = String(e.user_id)
    const targetId = String(target_id)
    if (targetId !== selfId && !e.isMaster) {
      return 'Error: 你只能分析自己的画像；分析其他成员需要 Bot 主人权限。'
    }

    try {
      const result = await extractUserProfile(e, target_id)
      if (!result.ok) {
        return result.message
      }
      const view = formatProfileView(result.profile)
      return `用户 ${target_id} 的已存画像：\n\n${view}`
    } catch (err) {
      logger.error('[UserProfileTool] 读取画像失败:', err)
      return `Error: Failed to read user profile: ${err.message || err.stack || String(err)}`
    }
  }

  description = 'Retrieve a user\'s existing precise profile facts (name, nickname, gender, age, occupation, interests, plans) from stored V2 memories. Does not scan group history or write new facts. Returns a structured profile backed by evidence; never fabricates personality summaries. Only usable in memory-authorized groups; non-master users can only view themselves.'
}
