import { AbstractTool } from './AbstractTool.js'
import { getMasterQQ } from '../common.js'

export class BlockUserTool extends AbstractTool {
  name = 'blockUser'

  parameters = {
    properties: {
      userId: {
        type: 'string',
        description: 'The QQ number of the user to be blocked'
      },
      duration: {
        type: 'number',
        description: 'Duration of the block in minutes, valid range is 30-720 minutes'
      },
      reason: {
        type: 'string',
        description: 'The reason for blocking this user, should be consistent with your character personality'
      }
    },
    required: ['userId']
  }

  func = async function (opts, e) {
    let { userId, duration, reason } = opts

    // 验证用户ID
    if (!userId) {
      return 'Invalid user ID'
    }

    // 验证拉黑时长
    if (!duration || duration < 30 || duration > 720) {
      duration = 60;
    }

    // 检查权限：只有主人/管理员，可以对其他群友生效
    if (!(e.isMaster || e.sender.role == 'owner' || e.sender.role == 'admin')) {
      if (userId !== e.sender.user_id.toString()) {
        return 'Only the master or Group admin can block other users.'
      }
    }

    // 不能拉黑主人
    const masters = await getMasterQQ()
    if (masters.includes(userId)) {
      return 'Cannot block the master user'
    }

    try {
      const key = `CHATGPT:blockUser:${userId}`
      const blockData = {
        userId,
        blockedAt: Date.now(),
        duration: duration * 60, // 转换为秒
        reason: reason || 'No reason provided',
        blockedBy: e.sender.user_id
      }

      // 设置redis，过期时间为duration分钟
      await redis.set(key, JSON.stringify(blockData), { EX: duration * 60 })

      return `User ${userId} has been blocked for ${duration} minutes. Reason: ${reason || 'No reason provided'}`
    } catch (err) {
      return `Failed to block user: ${err.message || err.stack || String(err)}`
    }
  }

  description = 'Useful when you need to block a user from chatting. The blocked user will not be able to chat for the specified duration (10-60 minutes)'
}

