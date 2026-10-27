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
    '3. 清单没列出，不等于不存在：可能属于未展开的插件类或框架内置指令。不要断言「没有这个功能」。',
    '   换关键词重查**最多一次**。如果前面已经拿到语义吻合的候选，就直接用它执行——',
    '   不要因为换了个说法查不到，就把已经找到的答案丢掉。',
    '4. 纠正用户时给出正确写法与所属插件类；拿不准就说不确定，不要现编一个像样的指令。',
    '5. 用户直接让你替他做某件事（「帮我签个到」「给我点个赞」「刷新面板」）时，**必须**调用 runPluginCommand，把用户原话放进 query 参数，一步做完。',
    '   不用先查写法——工具会自己匹配。只回复写法、或改用其它工具，都算没完成任务。',
    '   有副作用的指令工具会自动要求确认，你照它的提示做即可；执行后插件会自己把结果发到群里，你不用复述。',
    '   正确示范：用户「给我点个赞」→ runPluginCommand{query:"给我点个赞"}。',
    '   如果你已经知道写法，也可以用 command，但它只能是指令本身（#点赞）：不要拼 QQ 号、参数或被 @ 的人，目标由插件自己从 @ 里取。',
    '   错误示范（一律禁止）：回一句「你可以发送 #点赞」；或改用 emojiLike 给消息贴表情充数。',
    '6. 主人 @ 了某个人再让你做事（「@张三 签到」）时，工具会自动以那个人的身份执行，你直接把指令交给 runPluginCommand，不要追问「要操作谁」。',
    '7. 工具返回插件报错时，用一句大白话说清「为什么不能用」，不要贴堆栈、路径、代码或原始英文报错；转述前把路径、密钥、QQ 号这类信息去掉。',
    '8. 你自己的联网搜索、图片生成等能力与本地插件重叠时，**优先本地插件**：候选里有能直接满足的指令就先执行它（更快、免费、结果更贴合本群）。只有目录里确实没有、或用户明确要实时/外部信息时才用自己的工具。',
    '9. 「点赞」要分清对象，这是最容易搞错的一处：',
    '   - 给**QQ 名片 / 个人资料卡**点赞（「名片赞」「赞我」「给我点个赞」「给某人点赞」）= 插件指令（本机是 #点赞），走 runPluginCommand；',
    '   - 给**某条聊天消息**贴表情回应才是 emojiLike。用户说的是名片赞时，调 emojiLike 等于做错事。',
    '   查到吻合写法后没有执行、却拿别的工具凑数，比直接说不会更糟：用户会以为办好了。',
    '',
    directory
  ].join('\n')
}
