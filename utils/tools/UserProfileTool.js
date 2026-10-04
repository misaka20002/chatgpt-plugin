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
 * - 总开关开启后私聊可用；群聊仍限已授权采集的群（memoryGroupCapture.groups 中 switchOn=true）
 * - 普通用户只能分析本人；Bot 主人可分析任意用户
 */
export class UserProfileTool extends AbstractTool {
  name = 'userProfile'

  parameters = {
    properties: {
      target_id: {
        type: 'string',
        description: '要查询已存画像的用户 QQ 号。普通用户只能查询本人，Bot 主人可以查询其他用户。'
      }
    },
    required: ['target_id']
  }

  func = async function (opts, e) {
    if (!Config.enableMemory) {
      return 'Error: 记忆系统未启用'
    }
    const { target_id } = opts

    if (!target_id) {
      return 'Error: 请提供 target_id（用户 QQ 号）'
    }

    // 私聊没有授权群要求；群事件仍必须同时具备有效群号与采集授权。
    if (e?.isGroup || e?.group_id) {
      if (!e.isGroup || !e.group_id) return 'Error: 群聊上下文不完整，无法查询画像'
      const groups = Array.isArray(Config.memoryGroupCapture?.groups) ? Config.memoryGroupCapture.groups : []
      const authorized = groups.some(g => g && g.switchOn && String(g.groupId) === String(e.group_id))
      if (!authorized) {
        return 'Error: 本群未开启记忆采集（需 Bot 主人在锅巴"授权采集群"或群内 #群记忆开启 授权），userProfile 不可用。'
      }
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
      return `Error: 读取用户画像失败：${err.message || err.stack || String(err)}`
    }
  }

  description = '从 V2 记忆读取用户已存的精确画像事实（姓名、称呼、性别、年龄、职业、兴趣、计划等），返回有证据的结构化资料，不扫描聊天历史、不写入新事实、不编造人格总结。私聊可查询个人记忆；群聊须已授权记忆采集，且可包含本群个人事实。普通用户只能查询本人，Bot 主人可查询其他用户。'
}
