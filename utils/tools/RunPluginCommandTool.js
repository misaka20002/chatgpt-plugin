import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'
import { loadCommandIndex } from '../commandMap/indexLoader.js'
import { executeCommand, findCommandEntry } from '../commandMap/execute.js'
import { putPending, takePending, samePending } from '../commandMap/confirm.js'

/**
 * 找出这条消息里被 @ 的「他人」。
 *
 * `e.at` 会把 @Bot 也算进去，所以必须自己扫段并排除机器人自己；多个 @ 时取最后一个
 * （与框架 `loader.js:407` 的语义一致）。拿不到群成员信息时返回 error，由调用方拒绝执行——
 * 猜一个身份执行等于替人越权。
 *
 * @param {object} e
 * @returns {Promise<{ target?: { userId: string, member: object }, error?: string }>}
 */
async function resolveTarget (e) {
  const selfId = String(e?.self_id || e?.bot?.uin || '')
  const segments = Array.isArray(e?.message) ? e.message : []
  const ats = segments
    .filter(item => item?.type === 'at' && item?.qq)
    .map(item => String(item.qq))
    .filter(qq => qq && qq !== selfId && qq !== 'all')

  const userId = ats[ats.length - 1]
  if (!userId) return {}
  if (!e?.group_id) return { error: '@ 他人执行只能在群里使用。' }

  try {
    const member = await globalThis.Bot?.pickMember?.(e.group_id, Number(userId))
    if (!member) return { error: `查不到 ${userId} 在本群的成员信息，让他本人先发一条消息再试。` }
    return { target: { userId, member } }
  } catch (err) {
    return { error: `查不到 ${userId} 的群身份（${err?.message || '未知原因'}），让他本人先发一条消息再试。` }
  }
}

/**
 * 代执行工具：把用户在对话里表达的需求，变成一条真实发出去的指令。
 *
 * 三条边界：
 *   1. 只接受「完整指令写法」，参数由模型从用户原话里抽好——工具本身不解析自然语言；
 *   2. 风险档来自本地索引，**不接受模型传入**（模型说这是查询不算数）；
 *   3. 能不能执行由框架权限决定，这里只做确认与存在性校验。
 */
export class RunPluginCommandTool extends AbstractTool {
  name = 'runPluginCommand'

  parameters = {
    properties: {
      command: {
        type: 'string',
        description: '完整指令写法，含参数，例如 #三角洲战绩 烽火地带。必须来自 lookupPluginCapability 的候选或用户原话里的写法，不要自己编。'
      }
    },
    required: ['command']
  }

  description = '替用户执行一条本机插件的指令。用户让你替他做某件事（帮我签到 / 求个签 / 查下我战绩）时调用本工具，而不是让用户自己发。写法先用 lookupPluginCapability 确认。执行后插件的输出直接发到群里，你不需要复述。'

  func = async function (opts, e) {
    if (Config.enableCapabilityMap === false) return 'Error: 插件能力功能已关闭，请在锅巴「可选工具」里打开「启用插件能力地图」。'
    if (!e) return 'Error: 缺少消息上下文，无法代执行。'

    const command = typeof opts?.command === 'string' ? opts.command.trim() : ''
    if (!command) return 'Error: 缺少要执行的指令写法。'

    const { entries } = loadCommandIndex()
    const entry = findCommandEntry(entries, command)
    // 索引里查不到就按「有副作用」处理：保守方向只多问一句，反过来会少问一句
    const risk = entry?.risk || 'w'

    // 以他人身份执行：只有主人可以发起，且必须拿到对方真实群身份（拿不到就拒绝）
    let target = null
    if (e.isMaster) {
      const resolved = await resolveTarget(e)
      if (resolved?.error) return `Error: ${resolved.error}`
      target = resolved?.target || null
      // 代他人执行时必须留下发起者：执行日志里的身份是被 @ 的人，不记发起人就查不到是谁动的手
      if (target) {
        const initiator = e?.sender?.user_id || e?.user_id || ''
        globalThis.logger?.mark?.(`[Chatgpt][commandMap] 代执行 发起者=${initiator} 目标=${target.userId} 指令=${command}`)
      }
    }

    // 主人替他人执行视为已授权，不再要求确认；其余情况 w/a 仍要回显等「是」
    if (!target && risk !== 'q') {
      const confirmed = takePending(e)
      if (!samePending(confirmed, command)) {
        putPending(e, command)
        return `这条指令可能改动数据：${command}\n要执行就回复「是」；两分钟内有效。`
      }
    }

    const result = await executeCommand(e, command, { target })
    if (result.ok) {
      const who = target ? `以 ${target.userId} 的身份` : ''
      return `已${who ? `${who}` : ''}执行：${command}（插件输出会直接发到群里）`
    }

    switch (result.reason) {
      case 'not-found':
        return `Error: 本机没有能匹配「${command}」的指令，可能你的插件版本不同。`
      case 'no-permission':
        return 'Error: 这条指令需要更高权限，已被框架拒绝。'
      case 'no-handler':
        return 'Error: 指令存在但处理函数不可用，可能是插件内部问题。'
      case 'handler-error':
        // 原文交给模型，让它翻成人话；只截长度，避免把整篇堆栈塞进上下文
        return `Error: 插件执行时报错，结果没有发出去。原文（供你解释原因，转述给用户前必须去掉路径/密钥/QQ号等敏感信息）：${String(result.message || '').slice(0, 500)}`
      default:
        return 'Error: 执行失败，框架加载器不可用。'
    }
  }
}
