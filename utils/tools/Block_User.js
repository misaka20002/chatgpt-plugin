import { AbstractTool } from './AbstractTool.js'
import { getMasterQQ } from '../common.js'

export class BlockUserTool extends AbstractTool {
  name = 'blockUser'

  parameters = {
    properties: {
      action: {
        type: 'string',
        enum: ['block', 'unblock', 'check'],
        description: 'Action to perform: block, unblock, or check status of a user'
      },
      userId: {
        type: 'string',
        description: 'The QQ number of the user to be blocked, unblocked, or checked'
      },
      duration: {
        type: 'number',
        description: 'Duration of the block in minutes, recommended range is 30-720 minutes (only for block action)'
      },
      reason: {
        type: 'string',
        description: 'The reason for blocking this user, should be consistent with your character personality (only for block action)'
      }
    },
    required: ['userId']
  }

  func = async function (opts, e) {
    let { action = 'block', userId, duration, reason } = opts

    // 验证用户ID
    if (!userId) {
      return 'Invalid user ID'
    }

    // 检查权限：只有主人/管理员，可以对其他群友生效
    if (!(e.isMaster || e.sender.role == 'owner' || e.sender.role == 'admin')) {
      if (userId !== e.sender.user_id.toString()) {
        return 'Only the master or Group admin can block/unblock/check other users.'
      }
    }

    const key = `CHATGPT:blockUser:${userId}`

    try {
      if (action === 'check') {
        // 获取剩余时间（秒）
        const ttl = await redis.ttl(key)

        // ttl 返回 -2 表示 key 不存在（未被拉黑）
        // ttl 返回 -1 表示 key 存在但没有过期时间（永久）
        if (ttl === -2) {
          return `User ${userId} is not currently blocked.`
        }

        // 读取一下拉黑原因
        const dataStr = await redis.get(key)
        let blockReason = ''
        if (dataStr) {
          try {
            const data = JSON.parse(dataStr)
            blockReason = data.reason ? ` Reason: ${data.reason}.` : ''
          } catch (e) { }
        }

        if (ttl === -1) {
          return `User ${userId} is blocked permanently.${blockReason}`
        }

        // 格式化剩余时间
        const leftMin = Math.floor(ttl / 60)
        const leftSec = ttl % 60
        return `User ${userId} is blocked. Remaining time: ${leftMin}m ${leftSec}s.${blockReason}`
      }
      else if (action === 'unblock') {
        // 解除拉黑
        const exists = await redis.exists(key)
        if (!exists) {
          return `User ${userId} is not blocked`
        }
        await redis.del(key)
        return `User ${userId} has been unblocked successfully`
      } else {
        // 拉黑用户
        // 验证拉黑时长
        duration = parseInt(duration);
        if (isNaN(duration) || duration <= 0) {
          duration = 30;
        }

        // 不能拉黑主人
        const masters = await getMasterQQ()
        if (masters.includes(userId)) {
          return 'Cannot block the master user'
        }

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
      }
    } catch (err) {
      return `Failed to ${action} user: ${err.message || err.stack || String(err)}`
    }
  }

  description = 'Useful when you need to block, unblock, or check the block status of a user. For blocking, the user will not be able to chat for the specified duration. Use "check" action to see remaining time.'
}
