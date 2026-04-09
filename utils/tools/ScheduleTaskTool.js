import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'
import { estimateCronMinInterval } from '../cronMatcher.js'

const REDIS_KEY = 'CHATGPT:ScheduledTasks'

function limitLabel (count, maxTasks, e) {
  return e.isMaster ? `${count}, no limit` : `${count}/${maxTasks}`
}

// ==================== 一次性任务 ====================

async function getUserTasks (userId) {
  const allTasks = await redis.zRange(REDIS_KEY, 0, -1) || []
  const userTasks = []
  for (const taskStr of allTasks) {
    try {
      const taskObj = JSON.parse(taskStr)
      if (String(taskObj.user_id) === String(userId)) {
        if (!taskObj.taskId) {
          taskObj.taskId = `legacy_${taskObj.createdAt || taskObj.executeTime}`
        }
        userTasks.push({ raw: taskStr, data: taskObj })
      }
    } catch (_) {}
  }
  userTasks.sort((a, b) => a.data.executeTime - b.data.executeTime)
  return userTasks
}

function formatTaskList (userTasks) {
  return userTasks.map((t, i) => {
    const time = new Date(t.data.executeTime).toLocaleString('zh-CN')
    const preview = (t.data.content || '').length > 40
      ? t.data.content.slice(0, 40) + '...'
      : (t.data.content || '')
    return `${i + 1}. [${t.data.taskId}] at ${time} — "${preview}"`
  }).join('\n')
}

async function listTasks (e) {
  const userTasks = await getUserTasks(e.user_id)
  if (userTasks.length === 0) {
    return 'No pending one-time scheduled tasks for this user. Inform the user they have no scheduled tasks.'
  }
  const maxTasks = Config.ScheduleTask_MaxPerUser ?? 1 // 使用 ?? 以支持 0
  return `One-time tasks (${limitLabel(userTasks.length, maxTasks, e)}):\n${formatTaskList(userTasks)}\nPresent this list to the user in a friendly way.`
}

async function cancelTask (e, taskId) {
  if (!taskId) {
    return 'Missing taskId. Use action "list" first to get the taskId, then call cancel with the taskId in the content field.'
  }

  const userTasks = await getUserTasks(e.user_id)
  const target = userTasks.find(t => t.data.taskId === taskId)

  if (!target) {
    if (userTasks.length === 0) {
      return 'No pending tasks found for this user. Nothing to cancel.'
    }
    return `Task "${taskId}" not found. Current tasks:\n${formatTaskList(userTasks)}`
  }

  await redis.zRem(REDIS_KEY, target.raw)
  const remaining = userTasks.length - 1
  const maxTasks = Config.ScheduleTask_MaxPerUser ?? 1
  return `Successfully cancelled task [${taskId}]. Remaining tasks: ${limitLabel(remaining, maxTasks, e)}. Confirm the cancellation to the user.`
}

async function scheduleTask (e, content, delayMinutes) {
  if (!content) {
    return 'Missing content. Please provide the reminder/message content.'
  }
  if (!delayMinutes || delayMinutes <= 0) {
    return 'Invalid delay time. Must be a positive number.'
  }

  const MAX_DELAY_MINUTES = 30 * 24 * 60
  if (delayMinutes > MAX_DELAY_MINUTES) {
    return `Delay time is too long. Maximum is ${MAX_DELAY_MINUTES} minutes (about 1 month).`
  }

  const maxTasks = Config.ScheduleTask_MaxPerUser ?? 1 // 使用 ?? 允许值为 0
  const userTasks = await getUserTasks(e.user_id)

  // 主人不受任务数量限制
  if (!e.isMaster) {
    if (maxTasks === 0) {
      return `One-time scheduled tasks are currently disabled by the administrator (limit is 0). Do NOT create the task, and politely inform the user.`
    }
    if (userTasks.length >= maxTasks) {
      return `Task limit reached (${userTasks.length}/${maxTasks}). Cannot create a new task. Current tasks:\n${formatTaskList(userTasks)}\nDo NOT create the task. Instead, tell the user their task slots are full, show them the current task list, and ask which one they want to cancel. After they choose, use action "cancel" to remove it, then retry scheduling.`
    }
  }

  const executeTime = Date.now() + (delayMinutes * 60 * 1000)
  const taskData = {
    taskId: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    bot_id: e.self_id || e.bot?.uin,
    isGroup: e.isGroup,
    group_id: e.isGroup ? e.group_id : undefined,
    user_id: e.user_id,
    content: content,
    createdAt: Date.now(),
    executeTime: executeTime,
    isMaster: e.isMaster,
    nickname: e.sender?.card || e.sender?.nickname || 'User'
  }

  await redis.zAdd(REDIS_KEY, [{
    score: executeTime,
    value: JSON.stringify(taskData)
  }])

  const dateStr = new Date(executeTime).toLocaleString('zh-CN')
  const newCount = userTasks.length + 1
  return `Successfully scheduled task [${taskData.taskId}]. It will execute at ${dateStr}. Active tasks: ${limitLabel(newCount, maxTasks, e)}. Tell the user the task has been set and when it will execute.`
}

// ==================== Cron 循环任务 ====================

function getUserCronTasks (userId) {
  const allCron = Config.ScheduleTask_CronTasks || []
  return allCron.filter(t => String(t.user_id) === String(userId))
}

function formatCronList (cronTasks) {
  return cronTasks.map((t, i) => {
    const preview = (t.content || '').length > 40
      ? t.content.slice(0, 40) + '...'
      : (t.content || '')
    return `${i + 1}. [${t.taskId}] cron: ${t.cronExpression} — "${preview}"`
  }).join('\n')
}

function cronList (e) {
  const userCron = getUserCronTasks(e.user_id)
  if (userCron.length === 0) {
    return 'No recurring cron tasks for this user. Inform the user they have no recurring tasks.'
  }
  const maxCronTasks = Config.ScheduleTask_CronMaxPerUser ?? 1 // 使用 ?? 以支持 0
  return `Recurring cron tasks (${limitLabel(userCron.length, maxCronTasks, e)}):\n${formatCronList(userCron)}\nPresent this list to the user in a friendly way, explaining each task's schedule.`
}

function cronAdd (e, content, cronExpression) {
  if (!content) {
    return 'Missing content for cron task.'
  }
  if (!cronExpression) {
    return 'Missing cronExpression. Use 5-field cron format: "minute hour day month weekday". Examples: "30 8 * * *" (daily 8:30), "0 9 * * 1" (Monday 9:00).'
  }

  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return `Invalid cron expression "${cronExpression}". Must have exactly 5 fields: minute hour day month weekday.`
  }

  const minInterval = Config.ScheduleTask_CronMinInterval || 60
  const estimated = estimateCronMinInterval(cronExpression)
  // 主人不受循环最小间隔限制
  if (estimated < minInterval && !e.isMaster) {
    return `Cron interval too short: "${cronExpression}" fires roughly every ${estimated} minute(s), but the minimum allowed interval is ${minInterval} minute(s). Tell the user to use a less frequent schedule. For example, "0 * * * *" for hourly or "0 */2 * * *" for every 2 hours.`
  }

  const maxCronTasks = Config.ScheduleTask_CronMaxPerUser ?? 1 // 使用 ?? 以支持 0
  const userCron = getUserCronTasks(e.user_id)

  // 主人不受任务数量限制
  if (!e.isMaster) {
    if (maxCronTasks === 0) {
      return `Recurring cron tasks are currently disabled by the administrator (limit is 0). Do NOT create the task, and politely inform the user.`
    }
    if (userCron.length >= maxCronTasks) {
      return `Cron task limit reached (${userCron.length}/${maxCronTasks}). Current cron tasks:\n${formatCronList(userCron)}\nDo NOT create the task. Instead, tell the user their recurring task slots are full, show them the current list, and ask which one to remove. After they choose, use action "cron_remove" to delete it, then retry.`
    }
  }

  const taskData = {
    taskId: `cron_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    cronExpression: cronExpression.trim(),
    bot_id: e.self_id || e.bot?.uin,
    isGroup: e.isGroup,
    group_id: e.isGroup ? e.group_id : undefined,
    user_id: e.user_id,
    content: content,
    isMaster: e.isMaster,
    nickname: e.sender?.card || e.sender?.nickname || 'User',
    createdAt: Date.now()
  }

  const allCron = Config.ScheduleTask_CronTasks || []
  allCron.push(taskData)
  Config.getConfig().ScheduleTask_CronTasks = allCron
  Config.save()

  const newCount = userCron.length + 1
  return `Successfully created recurring cron task [${taskData.taskId}]. Cron: ${cronExpression}. Active cron tasks: ${limitLabel(newCount, maxCronTasks, e)}. Tell the user the recurring task has been created and explain when it will trigger in plain language.`
}

function cronRemove (e, taskId) {
  if (!taskId) {
    return 'Missing taskId. Use action "cron_list" first to get the taskId, then call cron_remove with the taskId in the content field.'
  }

  const allCron = Config.ScheduleTask_CronTasks || []
  const idx = allCron.findIndex(t => t.taskId === taskId && String(t.user_id) === String(e.user_id))

  if (idx === -1) {
    const userCron = getUserCronTasks(e.user_id)
    if (userCron.length === 0) {
      return 'No cron tasks found for this user. Nothing to remove.'
    }
    return `Cron task "${taskId}" not found. Current cron tasks:\n${formatCronList(userCron)}`
  }

  allCron.splice(idx, 1)
  Config.getConfig().ScheduleTask_CronTasks = allCron
  Config.save()

  const remaining = getUserCronTasks(e.user_id).length
  const maxCronTasks = Config.ScheduleTask_CronMaxPerUser ?? 1
  return `Successfully removed cron task [${taskId}]. Remaining cron tasks: ${limitLabel(remaining, maxCronTasks, e)}. Confirm the removal to the user.`
}

// ==================== 工具定义 ====================

/** 定时执行工具 - 支持一次性任务和 cron 循环任务的创建、查询、取消 */
export class ScheduleTaskTool extends AbstractTool {
  name = 'scheduleGroupTask'

  description = 'Manage scheduled tasks. Supports one-time delayed tasks AND recurring cron tasks. Actions: "schedule" (one-time), "list"/"cancel" (manage one-time), "cron_add" (recurring), "cron_list"/"cron_remove" (manage recurring). Works in both group chats and private chats.'

  parameters = {
    properties: {
      action: {
        type: 'string',
        enum: ['schedule', 'list', 'cancel', 'cron_add', 'cron_list', 'cron_remove'],
        description: 'Action to perform. One-time tasks: "schedule" to create, "list" to view, "cancel" to remove. Recurring tasks: "cron_add" to create, "cron_list" to view, "cron_remove" to remove.'
      },
      content: {
        type: 'string',
        description: 'For "schedule"/"cron_add": the message content. For "cancel"/"cron_remove": the taskId to remove (get from list first). Not needed for "list"/"cron_list".'
      },
      delayMinutes: {
        type: 'number',
        description: 'Only for "schedule". How many minutes from now to execute. Must be positive, max 43200 (about 1 month).'
      },
      cronExpression: {
        type: 'string',
        description: 'Only for "cron_add". Standard 5-field cron: "minute hour day month weekday". Examples: "30 8 * * *" (daily 8:30), "0 9 * * 1" (every Monday 9:00), "0 */2 * * *" (every 2 hours).'
      }
    },
    required: ['action']
  }

  func = async function (opts, e) {
    const { action, content, delayMinutes, cronExpression } = opts

    try {
      switch (action) {
        case 'list':
          return await listTasks(e)
        case 'cancel':
          return await cancelTask(e, content)
        case 'cron_add':
          return cronAdd(e, content, cronExpression)
        case 'cron_list':
          return cronList(e)
        case 'cron_remove':
          return cronRemove(e, content)
        case 'schedule':
        default:
          return await scheduleTask(e, content, delayMinutes)
      }
    } catch (err) {
      return `Failed to execute ${action}: ${err.message || String(err)}`
    }
  }
}
