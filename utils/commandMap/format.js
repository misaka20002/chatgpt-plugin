import { normalize } from './text.js'

/**
 * 候选的展示层。
 *
 * 工具返回给模型的每一行都算 token，所以只给决策必需的四样：写法、档位、一句话说明、参数与示例（有才给）。
 */

const RISK_LABEL = { q: '查询', w: '有副作用', a: '管理操作' }

/** 单个候选最多占几行，防止参数说明把上下文吃光 */
const MAX_ARG_CHARS = 120

/**
 * 按插件类名找一组指令：用户问「签到插件有什么功能」时走这条，而不是关键词硬猜。
 * @param {Array<object>} entries
 * @param {string} query
 * @returns {Array<object> | null}
 */
export function findPluginGroup (entries, query) {
  const needle = normalize(query)
  if (needle.length < 2) return null

  const groups = new Map()
  for (const entry of entries) {
    const name = normalize(entry.plugin)
    if (!name) continue
    if (!(name.includes(needle) || needle.includes(name))) continue
    if (!groups.has(entry.plugin)) groups.set(entry.plugin, [])
    groups.get(entry.plugin).push(entry)
  }

  if (groups.size !== 1) return null
  return [...groups.values()][0]
}

/**
 * 把候选渲染成给模型看的文本。
 * @param {Array<object>} matches
 * @param {{ limit?: number }} [options]
 * @returns {string}
 */
export function formatCandidates (matches, { limit = 5 } = {}) {
  const lines = []
  matches.slice(0, limit).forEach((entry, index) => {
    const risk = RISK_LABEL[entry.risk] || '查询'
    const permission = entry.permission ? `（需 ${entry.permission}）` : ''
    lines.push(`${index + 1}. ${entry.command || '（无固定触发词）'} [${risk}]${permission} —— ${entry.description || '（无描述）'}`)
    const args = formatArgs(entry.args)
    if (args) lines.push(`   参数：${args}`)
    if (entry.ex) lines.push(`   示例：${entry.ex}`)
  })
  return lines.join('\n')
}

/**
 * 插件清单视图：给写法、风险档、权限与一句话；参数留给用户选定具体哪条之后再查。
 * @param {Array<object>} entries
 * @param {{ limit?: number }} [options]
 */
export function formatPluginGroup (entries, { limit = 15 } = {}) {
  return entries
    .slice(0, limit)
    .map(entry => {
      const risk = RISK_LABEL[entry.risk] || '查询'
      const permission = entry.permission ? `（需 ${entry.permission}）` : ''
      return `${entry.command || '（无固定触发词）'} [${risk}]${permission} —— ${entry.description || '（无描述）'}`
    })
    .join('\n')
}

function formatArgs (args) {
  if (!args || typeof args !== 'object') return ''
  const parts = Object.entries(args)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `${key}=${value.trim()}`)
  const text = parts.join('；')
  return text.length > MAX_ARG_CHARS ? `${text.slice(0, MAX_ARG_CHARS)}…` : text
}
