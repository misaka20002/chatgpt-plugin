/**
 * 简单 5 段 cron 表达式匹配器
 * 格式: 分 时 日 月 周 (minute hour day month weekday)
 * 支持: * 任意, 数字, 逗号(1,3,5), 范围(1-5), 步长(星/2 或 1-5/2)
 */

function matchField (field, value, max) {
  if (field === '*') return true

  // 步长: */2 或 1-5/2
  if (field.includes('/')) {
    const [range, stepStr] = field.split('/')
    const step = parseInt(stepStr)
    if (isNaN(step) || step <= 0) return false
    if (range === '*') return value % step === 0
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number)
      return value >= start && value <= end && (value - start) % step === 0
    }
    return false
  }

  // 范围: 1-5
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number)
    return value >= start && value <= end
  }

  // 逗号列表: 1,3,5
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value)
  }

  // 单个数字
  return parseInt(field) === value
}

/**
 * 估算 cron 表达式的最小执行间隔（分钟）
 * 用于安全校验，防止过于频繁的循环任务
 * @param {string} cronExpression - 5 段 cron
 * @returns {number} 估算的最小间隔分钟数
 */
export function estimateCronMinInterval (cronExpression) {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) return 0
  const [minute, hour] = parts

  function countFires (field, total) {
    if (field === '*') return total
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2))
      return (step > 0) ? Math.ceil(total / step) : total
    }
    if (field.includes(',')) return field.split(',').length
    if (field.includes('-')) {
      const [s, e] = field.split('-').map(Number)
      return Math.max(e - s + 1, 1)
    }
    return 1
  }

  const firesPerDay = countFires(minute, 60) * countFires(hour, 24)
  return firesPerDay > 0 ? Math.floor(1440 / firesPerDay) : 1440
}

/**
 * 判断给定时间是否匹配 cron 表达式
 * @param {string} cronExpression - 5 段 cron: "分 时 日 月 周"
 * @param {Date} [date] - 要匹配的时间，默认当前时间
 * @returns {boolean}
 */
export function matchCron (cronExpression, date = new Date()) {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [minute, hour, day, month, weekday] = parts
  return matchField(minute, date.getMinutes(), 59) &&
    matchField(hour, date.getHours(), 23) &&
    matchField(day, date.getDate(), 31) &&
    matchField(month, date.getMonth() + 1, 12) &&
    matchField(weekday, date.getDay(), 6)
}
