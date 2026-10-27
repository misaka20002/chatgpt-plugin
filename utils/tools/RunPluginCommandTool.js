import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'
import { loadCommandIndex } from '../commandMap/indexLoader.js'
import { executeCommand, findCommandEntry } from '../commandMap/execute.js'
import { recall } from '../commandMap/recall.js'
import { putPending, takePending, samePending } from '../commandMap/confirm.js'

/**
 * 在目录里找「已知写法」——即给定写法是某条已知写法的开头。
 *
 * 用途：模型把参数拼进写法（「#点赞 3649682312」），插件的正则要求精确匹配就全被拒。
 * 取**最长**的那条已知写法，避免「#点赞」抢走「#点赞榜」。
 *
 * @param {Array<object>} entries
 * @param {string} command
 * @returns {object | null}
 */
function knownWritingPrefix (entries, command) {
  const text = String(command || '').trim()
  if (!text) return null
  let best = null
  for (const entry of entries || []) {
    const writing = entry?.command
    if (!writing || writing === text) continue
    if (!text.startsWith(writing)) continue
    if (!best || writing.length > best.command.length) best = entry
  }
  return best
}

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
      query: {
        type: 'string',
        description: '用户的原话或功能关键词，例如「给宾宾点个赞」「帮我签到」「刷新一下面板」。不确定正确写法时用这个，工具会自己匹配到具体指令。'
      },
      command: {
        type: 'string',
        description: '可选。已经确认过的完整指令写法（如 #点赞）。只能写指令本身：不要拼 QQ 号、参数或被 @ 的人，目标由插件自己从 @ 段里取。一般不用填，填了就不再做匹配。'
      }
    },
    required: []
  }

  description = '【代执行】替用户真正执行一条本机插件指令。凡用户说「帮我 / 给我 / 替我 + 某个动作」（帮我签到、给我点个赞、刷新面板），直接调用本工具，把用户原话放进 query 就行，不需要先查写法，也不要只告诉他怎么写。执行后插件的输出会自己发到群里，你不用复述。'

  func = async function (opts, e) {
    if (Config.enableCapabilityMap === false) return 'Error: 插件能力功能已关闭，请在锅巴「可选工具」里打开「启用插件能力地图」。'
    if (!e) return 'Error: 缺少消息上下文，无法代执行。'

    const wanted = typeof opts?.command === 'string' ? opts.command.trim() : ''
    const query = typeof opts?.query === 'string' ? opts.query.trim() : ''
    if (!wanted && !query) return 'Error: 请把用户的原话放进 query，或给出完整指令写法。'

    const { entries } = loadCommandIndex()
    if (!entries.length) {
      // 工具只读不重建：重建要花钱，只能由主人发指令触发
      return 'Error: 本机能力目录还没有生成。请主人发送 #chatgpt刷新功能表 生成后再试。'
    }

    let command = wanted
    let entry = wanted ? findCommandEntry(entries, wanted) : null

    // 只给原话时自己匹配：把「查一步、做一步」压成一次调用，
    // 否则模型经常查完就改用别的工具或直接回话（2026-10-28 线上实测）。
    if (!command) {
      const { matches } = recall(query, entries, { limit: 3 })
      if (!matches.length) {
        return `Error: 本机没有和「${query}」对得上的插件指令。可以用 lookupPluginCapability 换个说法再确认，仍然没有就如实告诉用户暂时做不到，不要编。`
      }
      entry = matches[0]
      command = entry.command
      if (!command) return `Error: 「${query}」匹配到的指令没有固定触发词，只能由用户自己操作。`
      globalThis.logger?.mark?.(`[Chatgpt][commandMap] 原话「${query}」匹配到 ${command}（${entry.plugin}）`)
    } else if (!entry) {
      // 模型常把参数拼进写法（「#点赞 3649682312」），而插件的正则多半要求精确匹配，
      // 于是所有插件都拒绝。回退到目录里的已知写法：目标由被 @ 的人决定，插件自己从 @ 段取。
      const base = knownWritingPrefix(entries, command)
      if (base) {
        globalThis.logger?.mark?.(`[Chatgpt][commandMap] 「${command}」不是已知写法，回退为 ${base.command}（参数由插件自行解析）`)
        command = base.command
        entry = base
      }
    }

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
      case 'not-handled':
        // 插件明确说了「这条我不处理」：这次没办成，不能报成功
        return 'Error: 没有插件真正接手执行这条指令（插件拒绝了，或前置条件不满足）。如实告诉用户这次没办成，不要说已经完成。'
      case 'no-effect':
        // 指令派出去了，但没有任何插件回应：多半是插件的前置条件不满足
        return 'Error: 指令已经派发给插件，但没有插件回话，多半是前置条件不满足（如没绑定、不是好友、没权限）。如实告诉用户这次没办成，不要说已经完成。'
      case 'handler-error':
        // 原文交给模型，让它翻成人话；只截长度，避免把整篇堆栈塞进上下文
        return `Error: 插件执行时报错，结果没有发出去。原文（供你解释原因，转述给用户前必须去掉路径/密钥/QQ号等敏感信息）：${String(result.message || '').slice(0, 500)}`
      default:
        return 'Error: 执行失败，框架加载器不可用。'
    }
  }
}
