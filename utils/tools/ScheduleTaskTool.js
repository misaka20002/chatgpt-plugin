import { AbstractTool } from './AbstractTool.js'

/** 定时执行工具 */
export class ScheduleTaskTool extends AbstractTool {
  name = 'scheduleGroupTask'

  description = 'Useful when the user wants to schedule a reminder, message, or task to be executed in the future. (Works in both group chats and private chats)'

  parameters = {
    properties: {
      content: {
        type: 'string',
        description: 'The exact message or reminder content you want to send to the user.'
      },
      delayMinutes: {
        type: 'number',
        description: 'How many minutes from now should this task be executed. Must be a positive number, max limit is 43200 (1 month).'
      }
    },
    required: ['content', 'delayMinutes']
  }

  func = async function (opts, e) {
    let { content, delayMinutes } = opts

    if (!delayMinutes || delayMinutes <= 0) {
      return 'Invalid delay time. Must be a positive number.'
    }

    // 最长 1 个月
    const MAX_DELAY_MINUTES = 30 * 24 * 60
    if (delayMinutes > MAX_DELAY_MINUTES) {
      return `Delay time is too long. The maximum allowed delay is ${MAX_DELAY_MINUTES} minutes (about 1 month).`
    }

    try {
      let replacedOldTask = false

      // 每个用户只能拥有一个活跃任务, 主人除外
      if (!e.isMaster) {
        const pendingTasks = await redis.zRange('CHATGPT:ScheduledTasks', 0, -1) || []
        const tasksToRemove = []

        for (const taskStr of pendingTasks) {
          try {
            const taskObj = JSON.parse(taskStr)
            if (String(taskObj.user_id) === String(e.user_id)) {
              tasksToRemove.push(taskStr)
            }
          } catch (parseErr) {
            // 忽略 JSON 解析失败的脏数据
          }
        }

        if (tasksToRemove.length > 0) {
          await redis.zRem('CHATGPT:ScheduledTasks', tasksToRemove)
          replacedOldTask = true
        }
      }

      const executeTime = Date.now() + (delayMinutes * 60 * 1000)

      const taskData = {
        taskId: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        bot_id: e.self_id || e.bot?.uin,
        // 如果是私聊，group_id 为 undefined
        isGroup: e.isGroup,
        group_id: e.isGroup ? e.group_id : undefined,
        user_id: e.user_id,
        content: content,
        createdAt: Date.now(),
        executeTime: executeTime,
        isMaster: e.isMaster,
        nickname: e.sender?.card || e.sender?.nickname || 'User'
      }

      await redis.zAdd('CHATGPT:ScheduledTasks', [{
        score: executeTime,
        value: JSON.stringify(taskData)
      }])

      const dateStr = new Date(executeTime).toLocaleString('zh-CN')

      let responseMsg = `Successfully scheduled the task. It will be executed at ${dateStr}. `
      if (replacedOldTask) {
        responseMsg += `Note: This user already had a pending scheduled task. As regular users can only have one active task, the OLD task was REMOVED and replaced by this new one. Please explicitly inform the user about this replacement.`
      } else {
        responseMsg += `You can reply to the user now.`
      }

      return responseMsg

    } catch (err) {
      return `Failed to schedule task: ${err.message || String(err)}`
    }
  }
}