import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'
import { loadCommandIndex } from '../commandMap/indexLoader.js'
import { executeCommand, findCommandEntry } from '../commandMap/execute.js'
import { putPending, takePending, samePending } from '../commandMap/confirm.js'

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

  description = '替用户执行一条本机插件的指令。仅当用户明确想做某件事、并且已从候选里确定了写法时调用。执行后插件的输出会直接发到群里，你不需要复述。'

  func = async function (opts, e) {
    if (Config.enablePluginCommand !== true) return 'Error: 指令代执行功能已关闭，请在锅巴「智能模式 能力地图」里开启。'
    if (!e) return 'Error: 缺少消息上下文，无法代执行。'

    const command = typeof opts?.command === 'string' ? opts.command.trim() : ''
    if (!command) return 'Error: 缺少要执行的指令写法。'

    const { entries } = loadCommandIndex()
    const entry = findCommandEntry(entries, command)
    // 索引里查不到就按「有副作用」处理：保守方向只多问一句，反过来会少问一句
    const risk = entry?.risk || 'w'

    if (risk !== 'q') {
      const confirmed = takePending(e)
      if (!samePending(confirmed, command)) {
        putPending(e, command)
        return `这条指令可能改动数据：${command}\n要执行就回复「是」；两分钟内有效。`
      }
    }

    const result = await executeCommand(e, command)
    if (result.ok) return `已执行：${command}（插件输出会直接发到群里）`

    switch (result.reason) {
      case 'not-found':
        return `Error: 本机没有能匹配「${command}」的指令，可能你的插件版本不同。`
      case 'no-permission':
        return 'Error: 这条指令需要更高权限，已被框架拒绝。'
      case 'no-handler':
        return 'Error: 指令存在但处理函数不可用，可能是插件内部问题。'
      default:
        return 'Error: 执行失败，框架加载器不可用。'
    }
  }
}
