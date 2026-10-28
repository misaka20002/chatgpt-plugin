import { CAPABILITY_DIRECTORY_LIMIT } from './paths.js'
import { redactText } from './redact.js'

/**
 * 能力表单的纯构建层（收录范围与目录上限的决策见项目文档）。
 *
 * 这一层不读文件、不调模型、不碰框架——所有输入都是参数，所有输出都能断言。
 * 双过滤之外的所有加工（正则转写法、合并、目录截断）都在这里，便于单测。
 */

/** 单条规则最多展开几种写法：再多就不是「用户可能这么打」，是噪音 */
const MAX_VARIANTS = 6

/**
 * 残留的正则元字符。出现它就说明这条「写法」不是用户能打出来的字：
 * `^(#三角洲|\^)服务器状态$` 的第二支会展开出 `#^服务器状态`，
 * `^#星铁[上期|...]$` 会展开出 `#星铁[上期`。
 */
const REG_META_RE = /[\^$|\\[\]]/

/**
 * 把触发正则还原成用户可能打的**全部**写法。
 *
 * 为什么不止一种：`#(全部面板更新|更新面板|面板更新)` 里每一支都是真实可用的写法，
 * 只留第一支会让「帮我刷新面板」彻底查不到——2026-10-28 线上实例：
 * 用户说「刷新一下面板」，候选里没有 `#更新面板`，模型只好改用自带的查面板工具。
 *
 * @param {string} reg
 * @returns {string[]} 去重后的写法列表，最多 MAX_VARIANTS 条；无法给出可读写法时返回空数组
 */
export function commandsFromReg (reg) {
  if (typeof reg !== 'string' || !reg.trim()) return []
  let body = reg.trim()

  // 防御：可能是 /.../flags 的字符串写法
  const slashed = body.match(/^\/([\s\S]+)\/[a-z]*$/)
  if (slashed) body = slashed[1]

  /**
   * 自校验用的正则，与执行侧判「本机有没有这条指令」是同一把尺子（findRuleByCall）。
   * 必须在削掉首尾锚点之前编译——校验的是原始规则的语义。
   */
  const tester = compileReg(body)

  body = body.replace(/^\^/, '').replace(/\$$/, '')
  // 断言组整块删掉：`(?!1|glm|gpt)` 这类只影响匹配，不是用户要打的字
  body = body.replace(/\((\?[!=<][^()]*)\)/g, '')
  // 可选组整块删掉：`(图片)?chat` 的可选部分不该写进"正确用法"
  body = body.replace(/\(([^()]*)\)\?/g, '')

  const commands = []
  for (const variant of expandAlternations(body)) {
    let command = cleanupCommand(variant)
    if (!command) continue
    // 残留元字符：先把它们剔掉再校验（`^#点歌$|^点歌` 的第二支会留下 `#点歌$` → `#点歌`）。
    // 剔干净仍不被这条规则接受，就是伪写法，丢弃——执行侧测的是同一条 reg，
    // 这种写法进了索引只会抢走召回第一名，然后在存在性校验那里必然失败。
    if (REG_META_RE.test(command)) {
      command = command.replace(REG_META_RE, '')
      if (!command || !(tester && tester.test(command))) continue
    }
    if (commands.includes(command)) continue
    commands.push(command)
    if (commands.length >= MAX_VARIANTS) break
  }
  return commands
}

/**
 * 编译校验用的正则。规则本身写坏了就返回 null——那种规则在框架里也匹配不到任何消息，
 * 它派生的写法一律按伪写法处理。
 * @param {string} pattern
 * @returns {RegExp | null}
 */
function compileReg (pattern) {
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

/**
 * 把正则体拆成所有候选写法。多分支组逐层展开，组外的 `|` 也拆开。
 * @param {string} text
 * @returns {string[]}
 */
function expandAlternations (text) {
  const results = []
  const budget = MAX_VARIANTS * 8

  const walk = current => {
    if (results.length >= budget) return
    const match = /\((?:\?:)?([^()]*)\)/.exec(current)
    if (!match) {
      results.push(...current.split('|'))
      return
    }
    const head = current.slice(0, match.index)
    const tail = current.slice(match.index + match[0].length)
    for (const alt of match[1].split('|')) walk(head + alt + tail)
  }

  walk(text)
  return results
}

/**
 * 单支候选的收尾清理：去掉正则残留，补上 `#` 前缀。
 * @param {string} body
 * @returns {string}
 */
function cleanupCommand (body) {
  // 字符类连同其量词一起删：`[^#]`、`[\s\S]*`
  body = body.replace(/\[\^?[^\]]*\]\s*[*+?]?/g, '')
  // 空白类转义与其量词
  body = body.replace(/\\[sSdDwW]\s*[*+?]?/g, '')
  // 量词区间：`\d{5}`、`\d{1,3}` 里的 `{5}` 不是用户打的字，留着会变成「#查询{5}」这种脏写法。
  // 必须放在转义还原之前——此时字面量的 `\{` 还没还原，不会被误删。
  body = body.replace(/\{\d*,?\d*\}/g, '')
  // 其余转义还原成字面量
  body = body.replace(/\\(.)/g, '$1')
  // 残留的元字符
  body = body.replace(/[()?*+:]/g, '')
  // 空白收掉：用户打的指令里不该有排版空格
  body = body.replace(/\s+/g, '')
  // 转义还原后常留下尾部标点（`^#运行日志\.$` → `#运行日志.`），实际指令不带它
  body = body.replace(/\.{2,}/g, '.')
  body = body.replace(/[.。·…、,，]+$/g, '')

  if (!body) return ''
  if (!body.startsWith('#')) body = `#${body}`
  return body
}

/**
 * 单条规则的**主写法**（用户最可能打的那一个）。等价于 `commandsFromReg(reg)[0]`。
 * @param {string} reg
 * @returns {string}
 */
export function commandFromReg (reg) {
  return commandsFromReg(reg)[0] || ''
}

/** 空壳正则（`(?:)`、`()`、`^$`）不构成任何用户可见指令，直接跳过 */
function isMeaninglessReg (reg) {
  const value = String(reg || '').trim()
  return !value || /^\(\??:?\)$/.test(value) || value === '^$'
}

/**
 * 快照 + 配置提示 → 指令条目。
 *
 * 描述此刻还是空的，留给审核环节的「描述翻译」填；拿不到翻译的条目会在渲染时退回插件级描述。
 *
 * @param {{ plugins: Array<{ key: string, name: string, dsc: string, rules: Array<{ reg: string, fnc: string, permission: string }> }> }} snapshot
 * @param {Record<string, { field: string, value: string }[]>} [hints]
 */
export function buildCapabilityEntries (snapshot, hints = {}) {
  const entries = []
  const plugins = Array.isArray(snapshot?.plugins) ? snapshot.plugins : []

  for (const plugin of plugins) {
    const pluginName = redactText(plugin.name || plugin.key || '')
    const pluginDsc = redactText(plugin.dsc || '')
    const hintFields = Array.isArray(hints?.[plugin.key]) ? hints[plugin.key] : []

    for (const rule of plugin.rules || []) {
      if (isMeaninglessReg(rule.reg)) continue
      // 一条规则可能对应多种真实写法（`#(全部面板更新|更新面板|面板更新)`），
      // 每种写法各占一条：只留第一支会让其余写法彻底搜不到
      for (const command of commandsFromReg(rule.reg)) {
        entries.push({
          plugin: pluginName,
          // 注册类名（可能同名多个包）不够定位，key 保留原始注册单位，供核对与按包聚合
          pluginKey: plugin.key,
          pluginDsc,
          reg: rule.reg,
          command,
          permission: rule.permission || '',
          hintFields: hintFields.slice(0, 5),
          description: '',
          confidence: 'none'
        })
      }
    }
  }

  return entries
}

/**
 * 条目 → 表单 markdown + 能力目录。
 *
 * @param {Array<object>} entries
 * @param {{ generatedAt?: string, degraded?: boolean }} [options]
 */
export function renderCapabilityForm (entries, { generatedAt, degraded = false } = {}) {
  const all = Array.isArray(entries) ? entries : []
  const groups = groupByPlugin(all)
  // 上限口径 = 目录里展开的**插件类**个数（两级目录的第一级），不是指令条数。
  // 固定值，不再走配置：要调就改 paths.js 里的常量。
  const maxGroups = CAPABILITY_DIRECTORY_LIMIT

  // 目录按指令数降序，保证展开的都是信息量最大的那一批
  const ranked = [...groups].sort((a, b) => b.entries.length - a.entries.length)
  const listedGroups = ranked.slice(0, maxGroups)
  const unlisted = ranked.slice(maxGroups).map(group => group.plugin)

  const header = [
    '# 本机插件能力表单',
    '',
    `> 生成时间：${generatedAt || '未知'} ｜ 插件类：${groups.length} ｜ 指令数：${all.length}`,
    `> 数据来源：${degraded ? '源码粗提（**可能不完整**）' : '框架插件总表'}`,
    '> 说明：只收录第三方插件的用户可见指令，不含本插件自己的指令、框架内置指令与内部工具。',
    ''
  ]

  const body = []
  for (const group of groups) {
    body.push(`## ${group.plugin}${group.dsc ? ` —— ${group.dsc}` : ''}`, '')
    for (const entry of group.entries) {
      const command = entry.command ? `\`${entry.command}\`` : '_（无固定触发词）_'
      const permission = entry.permission ? `（权限：${entry.permission}）` : ''
      body.push(`- ${command}${permission} —— ${describeCapabilityEntry(entry)}`)
    }
    body.push('')
  }

  // 目录只到「插件类 + 条数」这一级：单条指令的细节靠查询工具按需取。
  // 这样每次请求的固定成本跟着插件类数量走，而不是跟着指令总数走。
  const directoryLines = listedGroups.map(group => `- 【${group.plugin}】${group.entries.length} 条`)
  const tail = unlisted.length
    ? [`- （另有 ${unlisted.length} 个插件类未展开，可按类名或关键词查询）`]
    : []

  return {
    form: [...header, ...body].join('\n').trimEnd() + '\n',
    directory: [...directoryLines, ...tail].join('\n'),
    unlistedPlugins: unlisted,
    pluginCount: groups.length,
    entryCount: all.length,
    listedCount: listedGroups.length,
    listedEntryCount: listedGroups.reduce((total, group) => total + group.entries.length, 0)
  }
}

/**
 * 条目的一句话说明。工具与表单共用，避免同一条指令在两处显示不同的描述。
 * @param {object} entry
 * @returns {string}
 */
function describeCapabilityEntry (entry) {
  if (entry?.description) return entry.description
  if (entry?.pluginDsc) return `${entry.pluginDsc}（描述粗略）`
  if (Array.isArray(entry?.hintFields) && entry.hintFields.length) {
    return `${entry.hintFields.map(item => item.value).join('、')}（描述粗略）`
  }
  return '（描述粗略）'
}

/** 列表预览：「a、b 等」这类截断写法只在这里定义一次 */
export function previewList (items, max) {
  const list = Array.isArray(items) ? items : []
  return `${list.slice(0, max).join('、')}${list.length > max ? ' 等' : ''}`
}

function groupByPlugin (entries) {
  const order = []
  const map = new Map()
  for (const entry of entries) {
    const plugin = entry.plugin || '未知插件'
    if (!map.has(plugin)) {
      map.set(plugin, { plugin, dsc: entry.pluginDsc || '', entries: [] })
      order.push(plugin)
    }
    map.get(plugin).entries.push(entry)
  }
  return order.map(plugin => map.get(plugin))
}
