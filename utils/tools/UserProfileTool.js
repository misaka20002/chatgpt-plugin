import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'
import { extractUserProfile, formatProfileView } from '../memory/profile.js'

/**
 * Tool: 用户画像（V2）
 *
 * 由 enableMemory 总开关自动注册。使用与每日提炼相同的提取器与 V2 存储：
 * 扫描群历史时写入精确事实（本人自述 + 消息证据），返回结构化画像，
 * 不再输出"外向、活跃、幽默"等无证据概括。
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
        description: 'The QQ number of the target user to analyze. Only the caller themselves, or the bot master for any member.'
      },
      max_msg_count: {
        type: 'number',
        description: 'Maximum number of text messages to scan for extraction. Default 200.'
      }
    },
    required: ['target_id']
  }

  func = async function (opts, e) {
    const { target_id, max_msg_count = 200 } = opts

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
      const count = Math.min(Math.max(Number(max_msg_count) || 200, 1), 500)
      const result = await extractUserProfile(e, target_id, { maxTargetMessages: count })
      if (!result.ok) {
        return result.message
      }
      const view = formatProfileView(result.profile)
      return `用户 ${target_id} 的画像（基于 ${result.message}）：\n\n${view}`
    } catch (err) {
      logger.error('[UserProfileTool] Error:', err)
      return `Error: Failed to extract user profile: ${err.message || err.stack || String(err)}`
    }
  }

  description = 'Analyze a user in the current authorized group and extract their precise profile facts (name, nickname, gender, age, occupation, interests, plans) from their own self-reports in group history. Returns a structured profile backed by evidence; never fabricates personality summaries. Only usable in memory-authorized groups; non-master users can only analyze themselves.'
}
