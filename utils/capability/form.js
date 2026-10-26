import { CAPABILITY_DIRECTORY_LIMIT, CAPABILITY_DIRECTORY_MAX, CAPABILITY_MAX_CANDIDATES } from './paths.js'
import { redactText } from './redact.js'

/**
 * 能力表单的纯构建层（收录范围与目录上限的决策见项目文档）。
 *
 * 这一层不读文件、不调模型、不碰框架——所有输入都是参数，所有输出都能断言。
 * 双过滤之外的所有加工（正则转写法、合并、目录截断）都在这里，便于单测。
 */

/** 目录里一行描述的最大长度，超了截断（提示词里的固定成本靠它控住） */
const DIRECTORY_DESC_LIMIT = 60

/**
 * 把触发正则还原成用户实际要打的写法。
 *
 * 这是个启发式函数，不做完备的正则解析——覆盖插件里最常见的几种写法即可：
 * 锚点、捕获组与多分支、可选组、负向断言、字符类与任意字符尾巴。
 *
 * @param {string} reg
 * @returns {string} 形如 `#签到`；无法给出可读写法时返回空串（表示靠自然语言触发）
 */
export function commandFromReg (reg) {
  if (typeof reg !== 'string' || !reg.trim()) return ''
  let body = reg.trim()

  // 防御：可能是 /.../flags 的字符串写法
  const slashed = body.match(/^\/([\s\S]+)\/[a-z]*$/)
  if (slashed) body = slashed[1]

  body = body.replace(/^\^/, '').replace(/\$$/, '')
  // 断言组整块删掉：`(?!1|glm|gpt)` 这类只影响匹配，不是用户要打的字
  body = body.replace(/\((\?[!=<][^()]*)\)/g, '')
  // 可选组整块删掉：`(图片)?chat` 的可选部分不该写进"正确用法"
  body = body.replace(/\(([^()]*)\)\?/g, '')

  // 捕获组里有多分支时取第一支：`#(结束|新开|摧毁)对话` → `#结束对话`
  let previous = ''
  while (previous !== body) {
    previous = body
    body = body.replace(/\(([^()]*)\)/g, (_, inner) => inner.replace(/^\?:/, '').split('|')[0])
  }
  // 组外还剩多分支时同样取第一支
  body = body.split('|')[0]

  // 字符类连同其量词一起删：`[^#]`、`[\s\S]*`
  body = body.replace(/\[\^?[^\]]*\]\s*[*+?]?/g, '')
  // 空白类转义与其量词
  body = body.replace(/\\[sSdDwW]\s*[*+?]?/g, '')
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
      const command = commandFromReg(rule.reg)
      entries.push({
        plugin: pluginName,
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

  return entries
}

/**
 * 条目 → 表单 markdown + 能力目录。
 *
 * @param {Array<object>} entries
 * @param {{ generatedAt?: string, degraded?: boolean, limit?: number }} [options]
 */
export function renderCapabilityForm (entries, { generatedAt, degraded = false, limit = CAPABILITY_DIRECTORY_LIMIT } = {}) {
  const all = Array.isArray(entries) ? entries : []
  const groups = groupByPlugin(all)
  const maxEntries = clampLimit(limit)

  const listed = []
  const unlisted = []
  for (const group of groups) {
    if (listed.length + group.entries.length <= maxEntries) {
      listed.push(...group.entries)
    } else {
      unlisted.push(group.plugin)
    }
  }
  // 一条都没列出来时（单插件条目就超上限），至少按条截断，别让目录整个空着
  if (!listed.length && maxEntries > 0) {
    const flattened = groups.flatMap(group => group.entries).slice(0, maxEntries)
    listed.push(...flattened)
    const listedSet = new Set(listed)
    for (const group of groups) {
      if (group.entries.some(entry => !listedSet.has(entry))) unlisted.push(group.plugin)
    }
  }

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

  if (unlisted.length) {
    body.push(`> 目录已按上限截断，还有 ${unlisted.length} 个插件未展开：${previewList(unlisted, 12)}`, '')
  }

  const directoryLines = listed.map(entry => {
    const command = entry.command || '(无固定触发词)'
    const desc = clamp(describeCapabilityEntry(entry), DIRECTORY_DESC_LIMIT)
    return `- 【${entry.plugin}】${command} — ${desc}`
  })
  const tail = unlisted.length
    ? [`- （还有 ${unlisted.length} 个插件未展开：${previewList(unlisted, 8)}）`]
    : []

  return {
    form: [...header, ...body].join('\n').trimEnd() + '\n',
    directory: [...directoryLines, ...tail].join('\n'),
    unlistedPlugins: unlisted,
    pluginCount: groups.length,
    entryCount: all.length,
    listedCount: listed.length
  }
}

/** 便捷入口：快照直接出表单（跳过审核，只在测试与降级预览里用） */
export function buildCapabilityForm (snapshot, hints, options) {
  return renderCapabilityForm(buildCapabilityEntries(snapshot, hints), options)
}

/**
 * 按关键词找指令。工具层唯一的检索逻辑，放这里是为了能纯函数测试。
 *
 * 打分从高到低：写法全等 > 写法包含 > 描述包含 > 插件名包含。
 *
 * @param {Array<object>} entries
 * @param {string} query
 * @param {{ limit?: number }} [options]
 * @returns {{ matches: Array<object>, total: number }}
 */
export function matchCapabilities (entries, query, { limit = CAPABILITY_MAX_CANDIDATES } = {}) {
  const raw = typeof query === 'string' ? query.trim() : ''
  if (!raw) return { matches: [], total: 0 }

  const normalized = normalizeQuery(raw)
  const scored = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    const command = normalizeQuery(entry.command || '')
    const description = String(entry.description || entry.pluginDsc || '')
    const plugin = normalizeQuery(entry.plugin || '')
    let score = 0

    if (command && command === normalized) score = 100
    else if (command && (command.includes(normalized) || normalized.includes(command))) score = 70
    else if (description && description.includes(raw)) score = 45
    else if (plugin && plugin.includes(normalized)) score = 25

    if (score > 0) scored.push({ entry, score })
  }

  scored.sort((a, b) => b.score - a.score || String(a.entry.command).localeCompare(String(b.entry.command)))
  return { matches: scored.slice(0, limit).map(item => item.entry), total: scored.length }
}

function normalizeQuery (text) {
  return String(text || '').replace(/[#＃\s]/g, '').toLowerCase()
}

/**
 * 条目的一句话说明。工具与表单共用，避免同一条指令在两处显示不同的描述。
 * @param {object} entry
 * @returns {string}
 */
export function describeCapabilityEntry (entry) {
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

function clampLimit (limit) {
  const value = Number(limit)
  if (!Number.isFinite(value) || value <= 0) return CAPABILITY_DIRECTORY_LIMIT
  return Math.min(Math.floor(value), CAPABILITY_DIRECTORY_MAX)
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

function clamp (text, max) {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
