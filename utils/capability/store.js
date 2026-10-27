import fs from 'node:fs'

import { capabilityDataDir, capabilityFormPath, capabilityMetaPath } from './paths.js'

/**
 * 表单的落盘与读取。
 *
 * 唯一允许写文件的地方，且路径写死：写的是本模块自己算出来的产物，
 * 不接受任何外部指定的目标路径。产物落在框架 data/ 下，天生不在插件仓库的版本控制里。
 *
 * 读路径是同步的：它要给每次请求的提示词拼装用，异步会让四个 provider 分支都要改签名。
 * 用进程内缓存挡住重复 IO，写入与外部刷新时失效。
 */

let cache = null

/** @returns {{ meta: object, form: string } | null} */
export function readCapabilityState () {
  if (cache) return cache
  try {
    const meta = JSON.parse(fs.readFileSync(capabilityMetaPath(), 'utf8'))
    const form = fs.readFileSync(capabilityFormPath(), 'utf8')
    if (!meta || typeof meta !== 'object') return null
    cache = { meta, form }
    return cache
  } catch {
    return null
  }
}

/**
 * @param {{ form: string, meta: object }} state
 */
export function saveCapabilityState ({ form, meta }) {
  const dir = capabilityDataDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(capabilityFormPath(), form, 'utf8')
  fs.writeFileSync(capabilityMetaPath(), JSON.stringify(meta, null, 2), 'utf8')
  cache = { meta, form }
}

/**
 * 拼进系统提示词的那一段。
 *
 * 措辞是硬规则而不是软引导：软引导下模型经常跳过查询、直接编。
 * 没有可用状态时返回空串，调用方据此决定不加任何东西（静默降级）。
 *
 * @returns {string}
 */
/** @returns {string} */
export function capabilityPromptAddon () {
  const state = readCapabilityState()
  const directory = state?.meta?.directory
  if (typeof directory !== 'string' || !directory.trim()) return ''

  const generatedAt = state.meta.generatedAt || '未知'
  const degraded = state.meta.degraded ? '（数据来源为源码粗提，可能不完整）' : ''

  return [
    '',
    '',
    '【本机插件能力目录】',
    `下面是本机已安装的第三方插件的**插件类清单**（类名 + 指令条数），生成于 ${generatedAt}${degraded}。`,
    '规则（必须遵守）：',
    '1. 用户询问「你能干什么」「有什么功能」、询问某功能怎么用、或输入的指令疑似打错时，必须先看这份清单再回答，禁止凭记忆编造。',
    '2. 清单里只到插件类这一级。要回答具体指令，必须调用 lookupPluginCapability 工具：传插件类名可列出该类全部指令，传关键词可搜具体指令。',
    '3. 清单没列出，不等于不存在：可能属于未展开的插件类或框架内置指令。不要断言「没有这个功能」，可以换关键词再查一次。',
    '4. 纠正用户时给出正确写法与所属插件类；拿不准就说不确定，不要现编一个像样的指令。',
    '5. 用户直接让你替他做某件事（「帮我签个到」「求个签」「查下我战绩」）时，**必须**先 lookupPluginCapability 确认写法，然后立即调用 runPluginCommand 代他执行。',
    '   不要回答「请你自己发送 #xxx」——那正是这个工具要消灭的行为。只有当没有候选、或缺少必填参数需要用户补充时，才把写法告诉他。',
    '   有副作用的指令工具会自动要求确认，你照它的提示做即可；执行后插件会自己把结果发到群里，你不用复述。',
    '6. 主人 @ 了某个人再让你做事（「@张三 签到」）时，工具会自动以那个人的身份执行，你直接把指令交给 runPluginCommand，不要追问「要操作谁」。',
    '7. 工具返回插件报错时，用一句大白话说清「为什么不能用」，不要贴堆栈、路径、代码或原始英文报错；转述前把路径、密钥、QQ 号这类信息去掉。',
    '8. 你自己的联网搜索、图片生成等能力与本地插件重叠时，**优先本地插件**：候选里有能直接满足的指令就先执行它（更快、免费、结果更贴合本群）。只有目录里确实没有、或用户明确要实时/外部信息时才用自己的工具。',
    '',
    directory
  ].join('\n')
}
