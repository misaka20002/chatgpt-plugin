import { CAPABILITY_DIRECTORY_LIMIT, CAPABILITY_DIRECTORY_MAX, CAPABILITY_MAX_CANDIDATES } from './paths.js'
import { redactText } from './redact.js'

/**
 * 能力表单的纯构建层（收录范围与目录上限的决策见项目文档）。
 *
 * 这一层不读文件、不调模型、不碰框架——所有输入都是参数，所有输出都能断言。
 * 双过滤之外的所有加工（正则转写法、合并、目录截断）都在这里，便于单测。
 */

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
  // 上限口径 = 目录里展开的**插件类**个数（两级目录的第一级），不是指令条数
  const maxGroups = clampLimit(limit)

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
 * 两级目录下的检索：先看是不是在问某个插件类，再退回关键词。
 *
 * 命中的是插件类名时返回该类下的全部指令（截断到 pluginEntryLimit）——
 * 这是两级目录能省 token 的前提：目录里只有类名与条数，AI 想知道细节必须按类展开。
 *
 * @param {Array<object>} entries
 * @param {string} query
 * @param {{ entryLimit?: number, pluginEntryLimit?: number }} [options]
 * @returns {{ mode: 'plugin'|'entry'|'none', plugin?: string, matches: Array<object>, total: number }}
 */
export function searchCapabilities (entries, query, { entryLimit = CAPABILITY_MAX_CANDIDATES, pluginEntryLimit = 30 } = {}) {
  const raw = typeof query === 'string' ? query.trim() : ''
  if (!raw) return { mode: 'none', matches: [], total: 0 }

  const normalized = normalizeQuery(raw)
  const groups = groupByPlugin(Array.isArray(entries) ? entries : [])
  const hitGroups = groups.filter(group => {
    const name = normalizeQuery(group.plugin)
    return name && (name.includes(normalized) || normalized.includes(name))
  })

  if (hitGroups.length === 1) {
    const group = hitGroups[0]
    return {
      mode: 'plugin',
      plugin: group.plugin,
      matches: group.entries.slice(0, pluginEntryLimit),
      total: group.entries.length
    }
  }

  if (hitGroups.length > 1) {
    const merged = hitGroups.flatMap(group => group.entries).slice(0, entryLimit)
    return { mode: 'entry', matches: merged, total: hitGroups.reduce((total, group) => total + group.entries.length, 0) }
  }

  const { matches, total } = matchCapabilities(entries, raw, { limit: entryLimit })
  return { mode: 'entry', matches, total }
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
