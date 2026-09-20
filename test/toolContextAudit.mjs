/**
 * 工具上下文占用审计（本地脚本，随仓库入库）
 *
 * 目的：量化 utils/tools 下每个工具对「模型上下文」的占用——
 * 即每次请求都要发给模型的 name / description / parameters JSON schema。
 * 用于判断哪些工具值得改成「主代理只暴露 {task}，由子 LLM 生成真实参数」的模式。
 *
 * 用法：node test/toolContextAudit.mjs [--json 输出路径]
 *
 * 做法：acorn 静态解析 + 字面量求值（不 import 生产模块，避免依赖 Yunzai 全局对象）。
 * 动态构造的 description/parameters（用到变量、函数调用、Config、地图对象等）会被标记 dynamic，
 * 其 token 数为静态可见部分的估算，属下限。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'

const here = path.dirname(fileURLToPath(import.meta.url))
const toolsDir = path.resolve(here, '../utils/tools')

let encoder = null
try {
  const { getEncoding } = await import('js-tiktoken')
  const enc = getEncoding('cl100k_base')
  encoder = text => enc.encode(text).length
} catch {
  encoder = text => Math.ceil(text.length / 3)
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    const value = node[key]
    if (Array.isArray(value)) value.forEach(item => walk(item, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}

function propKey(node) {
  if (!node) return null
  if (node.type === 'Identifier') return node.name
  if (node.type === 'Literal') return String(node.value)
  return null
}

/** 只求值「纯字面量 + scope 内的常量」子树；出现变量/调用/成员访问则标记 dynamic */
function evalNode(node, scope = {}) {
  if (!node) return { value: undefined, dynamic: true }
  switch (node.type) {
    case 'Literal':
      return { value: node.value, dynamic: false }
    case 'TemplateLiteral': {
      let dynamic = false
      let value = ''
      node.quasis.forEach((quasi, index) => {
        value += quasi.value.cooked ?? quasi.value.raw
        const expr = node.expressions[index]
        if (expr) {
          const inner = evalNode(expr, scope)
          if (inner.dynamic || inner.value === undefined) dynamic = true
          else value += String(inner.value)
        }
      })
      return { value, dynamic }
    }
    case 'ObjectExpression': {
      const out = {}
      let dynamic = false
      for (const property of node.properties) {
        if (property.type === 'SpreadElement') { dynamic = true; continue }
        const key = propKey(property.key)
        if (key === null) { dynamic = true; continue }
        const inner = evalNode(property.value, scope)
        if (inner.dynamic) dynamic = true
        out[key] = inner.value
      }
      return { value: out, dynamic }
    }
    case 'ArrayExpression': {
      const out = []
      let dynamic = false
      for (const element of node.elements) {
        const inner = evalNode(element, scope)
        if (inner.dynamic) dynamic = true
        out.push(inner.value)
      }
      return { value: out, dynamic }
    }
    case 'UnaryExpression': {
      const inner = evalNode(node.argument, scope)
      if (inner.dynamic || typeof inner.value !== 'number') return { value: undefined, dynamic: true }
      return { value: node.operator === '-' ? -inner.value : inner.value, dynamic: false }
    }
    case 'BinaryExpression': {
      const left = evalNode(node.left, scope)
      const right = evalNode(node.right, scope)
      if (node.operator === '+' && !left.dynamic && !right.dynamic) {
        return { value: String(left.value) + String(right.value), dynamic: false }
      }
      return { value: undefined, dynamic: true }
    }
    case 'Identifier':
      if (node.name === 'undefined') return { value: undefined, dynamic: false }
      if (Object.prototype.hasOwnProperty.call(scope, node.name)) return { value: scope[node.name], dynamic: false }
      return { value: undefined, dynamic: true }
    default:
      return { value: undefined, dynamic: true }
  }
}

function countText(text) {
  return { chars: [...text].length, tokens: encoder(text) }
}

function schemaStats(parameters) {
  const json = JSON.stringify(parameters ?? {})
  const stats = countText(json)
  const props = parameters && typeof parameters.properties === 'object' && parameters.properties
    ? Object.keys(parameters.properties)
    : []
  let enumValues = 0
  let nestedObjects = 0
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node.enum)) enumValues += node.enum.length
    if (node.type === 'object' && depth > 1) nestedObjects += 1
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) value.forEach(item => visit(item, depth + 1))
        else visit(value, depth + 1)
      }
    }
  }
  visit(parameters, 0)
  return { ...stats, propertyCount: props.length, enumValues, nestedObjects, requiredCount: Array.isArray(parameters?.required) ? parameters.required.length : 0, json }
}

async function auditFile(file) {
  const source = await readFile(file, 'utf8')
  let ast
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch (error) {
    return [{ file, error: `解析失败: ${error.message}` }]
  }
  const results = []
  walk(ast, node => {
    if (node.type !== 'ClassDeclaration' || !node.id) return
    const superName = node.superClass?.name || ''
    const entry = {
      className: node.id.name,
      superClass: superName,
      file: path.relative(path.resolve(here, '..'), file).replace(/\\/g, '/'),
      name: null,
      description: '',
      parameters: undefined,
      dynamic: [],
      returnsSchema: false
    }
    for (const member of node.body.body) {
      if (member.type === 'MethodDefinition' && propKey(member.key) === 'function') {
        entry.returnsSchema = true
        walk(member.value, inner => {
          if (inner.type === 'AssignmentExpression' && inner.left?.type === 'MemberExpression' && inner.left.object?.type === 'ThisExpression') {
            const key = propKey(inner.left.property)
            if (key === 'name' || key === 'description' || key === 'parameters') {
              const { value, dynamic } = evalNode(inner.right)
              if (dynamic) entry.dynamic.push(`function():${key}`)
              if (value !== undefined) entry[key] = value
            }
          }
        })
        continue
      }
      if (member.type !== 'PropertyDefinition') continue
      const key = propKey(member.key)
      if (key !== 'name' && key !== 'description' && key !== 'parameters') continue
      const { value, dynamic } = evalNode(member.value)
      if (dynamic) entry.dynamic.push(key)
      if (value !== undefined) entry[key] = value
    }
    results.push(entry)
  })
  return results
}

const files = (await readdir(toolsDir, { withFileTypes: true }))
  .filter(item => item.isFile() && item.name.endsWith('.js'))
  .map(item => path.join(toolsDir, item.name))

const audit = []
for (const file of files) {
  for (const entry of await auditFile(file)) {
    if (!entry.className || entry.error) { audit.push(entry); continue }
    if (entry.superClass !== 'AbstractTool' && entry.superClass !== '') continue
    const description = typeof entry.description === 'string' ? entry.description : ''
    const descStats = countText(description)
    const schema = schemaStats(entry.parameters)
    audit.push({
      ...entry,
      description: undefined,
      parameters: undefined,
      descriptionChars: descStats.chars,
      descriptionTokens: descStats.tokens,
      schemaChars: schema.chars,
      schemaTokens: schema.tokens,
      schemaBytes: Buffer.byteLength(schema.json, 'utf8'),
      propertyCount: schema.propertyCount,
      requiredCount: schema.requiredCount,
      enumValues: schema.enumValues,
      nestedObjects: schema.nestedObjects,
      totalTokens: descStats.tokens + schema.tokens
    })
  }
}

/* 是否真的接入 collectTools：类存在 ≠ 模型能看到。
 * 从 model/core.js 的 collectTools 函数体内提取 `new XxxTool()`、
 * `xxxToolMap = { key: XxxTool }` 的值与 `optionalTools` 里的 ToolClass。 */
async function collectRegisteredToolNames() {
  const file = path.resolve(here, '../model/core.js')
  const ast = acorn.parse(await readFile(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
  let scope = null
  walk(ast, node => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'collectTools') scope = node
  })
  const registered = new Set()
  if (!scope) return registered
  walk(scope, node => {
    if (node.type === 'NewExpression' && node.callee?.type === 'Identifier') registered.add(node.callee.name)
    if (node.type !== 'VariableDeclarator' || !node.id?.name) return
    const name = node.id.name
    if (/ToolMap$/.test(name) && node.init?.type === 'ObjectExpression') {
      for (const property of node.init.properties) {
        if (property.value?.type === 'Identifier') registered.add(property.value.name)
      }
    }
    if (name === 'optionalTools' && node.init?.type === 'ArrayExpression') {
      for (const element of node.init.elements) {
        if (element?.type !== 'ObjectExpression') continue
        for (const property of element.properties) {
          if (propKey(property.key) === 'ToolClass' && property.value?.type === 'Identifier') registered.add(property.value.name)
        }
      }
    }
  })
  return registered
}

const registeredNames = await collectRegisteredToolNames()

const tools = audit.filter(item => item.className && item.name).sort((a, b) => b.totalTokens - a.totalTokens)
for (const item of tools) item.registered = registeredNames.has(item.className)
const registeredTools = tools.filter(item => item.registered)
const unregisteredTools = tools.filter(item => !item.registered)
const grand = registeredTools.reduce((sum, item) => sum + item.totalTokens, 0)
const grandAll = tools.reduce((sum, item) => sum + item.totalTokens, 0)

const pad = (text, width) => {
  const widthOf = value => [...String(value)].reduce((acc, char) => acc + (char.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
  const s = String(text ?? '')
  return s + ' '.repeat(Math.max(0, width - widthOf(s)))
}

const lines = []
lines.push(`# 工具上下文占用审计`)
lines.push('')
lines.push(`- 扫描目录：\`utils/tools/\`（共 ${files.length} 个 .js）`)
lines.push(`- 识别到工具类：${tools.length} 个；其余为解析失败/非工具类：${audit.length - tools.length} 个`)
lines.push(`- **已接入 \`collectTools\`**：${registeredTools.length} 个，合计 **${grand} tokens**（这才是模型真正看得到的上限）`)
lines.push(`- **未接入**（类存在但没有任何 \`new XxxTool()\` / 开关注册）：${unregisteredTools.length} 个，合计 ${grandAll - grand} tokens —— 属于死代码或尚未布线，不占上下文`)
lines.push('')
lines.push('| # | 工具 name | 类名 | desc tokens | schema tokens | 合计 | 参数字段 | enum 数 | required | 已接入 | 文件 | 动态构造 |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
tools.forEach((item, index) => {
  lines.push(`| ${index + 1} | ${item.name} | ${item.className} | ${item.descriptionTokens} | ${item.schemaTokens} | **${item.totalTokens}** | ${item.propertyCount} | ${item.enumValues} | ${item.requiredCount} | ${item.registered ? '✓' : '✗'} | ${item.file} | ${item.dynamic.join(',') || '-'} |`)
})

/* 典型启用场景（按 utils/config.js 的默认开关 + collectTools 的注册条件） */
const SCENARIOS = {
  'A 默认配置（私聊 / 群里非管理员）': ['draw', 'sendPicture', 'sendVideo', 'queryUserinfo', 'blockUser', 'queryStarRail', 'queryGenshin', 'searchImage_by_baidu', 'searchVideo', 'web_search_by_gemini', 'sendNetEaseMusic', 'weather', 'sendQQMusic', 'github'],
  'B A + Bot 是管理员（群管五件套）': ['editCard', 'jinyan', 'kickOut', 'setTitle', 'handleMsg'],
  'C B + 常用可选开关（记忆/定时/渲染/沙箱JS/图片/表情）': ['Memory_Tool', 'scheduleGroupTask', 'generate_math_markdown', 'generate_markmap', 'execute_javascript', 'get_pixiv_images', 'sendEmoji', 'emojiLike', 'recognize_media']
}
const byName = Object.fromEntries(tools.map(item => [item.name, item]))
lines.push('')
lines.push('## 典型场景占用（只看已接入的工具）')
lines.push('')
lines.push('| 场景 | tokens |')
lines.push('| --- | --- |')
let scenarioAcc = []
for (const [label, list] of Object.entries(SCENARIOS)) {
  const missing = list.filter(name => !byName[name]?.registered)
  if (missing.length) throw new Error(`场景「${label}」包含未接入工具: ${missing.join(', ')}`)
  scenarioAcc = scenarioAcc.concat(list)
  const total = scenarioAcc.reduce((sum, name) => sum + byName[name].totalTokens, 0)
  lines.push(`| ${label} | **${total}** |`)
}
if (audit.length - tools.length) {
  lines.push('')
  lines.push('## 未纳入统计')
  lines.push('')
  for (const item of audit.filter(entry => !tools.includes(entry))) {
    lines.push(`- ${item.file}${item.className ? ` (${item.className})` : ''}: ${item.error || '无 name/未继承 AbstractTool'}`)
  }
}
/* ------------------------------------------------------------------
 * 改造后估算：把工具改成「主代理只暴露 {task}，子代理生成真实参数」的模式后，
 * 主代理侧只剩 facade 的 description + {task} schema。
 * facade 文案按实际可写的程度给出（不是最省，而是能保持模型调用意愿的写法）。
 * ------------------------------------------------------------------ */
const FACADES = {
  Memory_Tool: {
    note: '记忆写入下沉：主代理只交原文片段，子代理产出原子候选',
    desc: '把值得长期记住的信息写入记忆库，或撤回被用户否定的事实。只需说明要记/要撤回的事实原文。',
    schema: { properties: { task: { type: 'string', description: '待记录或撤回的事实原文，以及它是跨群个人事实、本群个人事实还是群公共规则。' } }, required: ['task'] }
  },
  sendAudioMessage: {
    note: '枚举知识型（58 个音色 + ttsMode/情绪）',
    desc: '把一段文字作为语音消息发送。说明要朗读的文本与期望的音色/情绪，投递目标默认是当前会话。',
    schema: { properties: { task: { type: 'string', description: '要朗读的文本，以及期望的音色（角色）、情绪与投递目标用户/群。' } }, required: ['task'] }
  },
  scheduleGroupTask: {
    note: '自然语言时间 → delayMinutes/cron 的换算知识',
    desc: '为用户安排一次性提醒或定时任务，也可列出与取消已有任务。用自然语言说明时间与要做的事即可。',
    schema: { properties: { task: { type: 'string', description: '要做的事与时间（如“明天下午三点提醒我交房租”），或“列出我的任务”“取消第 2 个任务”。' } }, required: ['task'] }
  },
  generate_math_markdown: {
    note: 'Mermaid/LaTeX 语法规则知识',
    desc: '把 Markdown（含 LaTeX 公式、Mermaid 图表）渲染成图片。说明要呈现的内容与图表类型即可。',
    schema: { properties: { task: { type: 'string', description: '要渲染的内容与图表类型（公式 / 流程图 / 状态图 / 时序图）。' } }, required: ['task'] }
  },
  generate_graph_calculator: {
    note: '纯数值/表达式参数，无会话依赖',
    desc: '按函数表达式绘制直角坐标系图像。给出表达式与可选的取值范围即可。',
    schema: { properties: { task: { type: 'string', description: '要绘制的函数表达式，以及可选的 x/y 取值范围。' } }, required: ['task'] }
  },
  generate_markmap: {
    note: 'Markdown 层级 → markmap 结构',
    desc: '把一段结构化内容渲染成思维导图（markmap）。说明要展开的主题与层级即可。',
    schema: { properties: { task: { type: 'string', description: '思维导图的主题与需要展开的分支内容。' } }, required: ['task'] }
  },
  get_pixiv_images: {
    note: 'tag/尺寸/数量等检索参数知识',
    desc: '按关键词获取 Pixiv 插画并发送。说明想要的主题、风格与数量即可。',
    schema: { properties: { task: { type: 'string', description: '想要的插画主题、风格、数量等要求。' } }, required: ['task'] }
  },
  sendEmoji: {
    note: '固定枚举（20 个 reaction id）',
    desc: '对当前消息贴表情回应。说明想表达的态度即可。',
    schema: { properties: { task: { type: 'string', description: '想表达的态度，如“赞同”“嘲讽”“疑惑”。' } }, required: ['task'] }
  },
  emojiLike: {
    note: '固定枚举（16 个 reaction id）',
    desc: '对群内指定成员的消息贴表情回应。说明对象与态度即可。',
    schema: { properties: { task: { type: 'string', description: '要点赞/回应的对象与态度。' } }, required: ['task'] }
  },
  musicTool: {
    note: '音乐检索参数知识',
    desc: '点歌并发送音乐卡片（QQ/网易云曲库）。说明歌名/歌手即可。',
    schema: { properties: { task: { type: 'string', description: '要点的歌曲名、歌手或歌单来源。' } }, required: ['task'] }
  },
  processPicture: {
    note: '图像处理参数知识（枚举 2）',
    desc: '对图片做常规处理（缩放、裁剪、格式转换、加滤镜等）。说明要处理的图与目标效果即可。',
    schema: { properties: { task: { type: 'string', description: '要处理的图片与期望的处理效果。' } }, required: ['task'] }
  },
  imageCaption: { note: '反例：结果要回主模型', desc: null, schema: null },
  github: { note: '反例：结果要回主模型迭代', desc: null, schema: null },
  tavily_search: { note: '反例：结果要回主模型引用', desc: null, schema: null },
  KickOut: { note: '反例：鉴权/动作目标必须来自 e 与用户原话', desc: null, schema: null }
}

function facadeStats(spec) {
  const desc = countText(spec.desc)
  const schema = schemaStats(spec.schema)
  return { descriptionTokens: desc.tokens, schemaTokens: schema.tokens, totalTokens: desc.tokens + schema.tokens }
}

const facadeRows = []
for (const item of tools) {
  const spec = FACADES[item.name] || Object.entries(FACADES).find(([key]) => key.toLowerCase() === String(item.name).toLowerCase())?.[1]
  if (!spec) continue
  if (!spec.desc) {
    facadeRows.push({ name: item.name, note: spec.note, before: item.totalTokens, after: null, saved: null, registered: item.registered })
    continue
  }
  const after = facadeStats(spec)
  facadeRows.push({ name: item.name, note: spec.note, before: item.totalTokens, after: after.totalTokens, saved: item.totalTokens - after.totalTokens, registered: item.registered })
}

const tierA = facadeRows.filter(row => row.saved !== null && row.registered)
const skippedUnregistered = facadeRows.filter(row => row.saved !== null && !row.registered)
const totalBefore = tierA.reduce((sum, row) => sum + row.before, 0)
const totalAfter = tierA.reduce((sum, row) => sum + row.after, 0)

lines.push('')
lines.push('## 改造后估算（主代理只暴露 {task} facade）')
lines.push('')
lines.push(`已接入的可下沉工具当前合计 **${totalBefore} tokens** → facade 合计 **${totalAfter} tokens**，节省 **${totalBefore - totalAfter} tokens**（每请求都命中）。`)
if (skippedUnregistered.length) {
  lines.push('')
  lines.push(`未接入故不计入：${skippedUnregistered.map(row => `${row.name}(${row.before}→${row.after})`).join('、')}`)
}
lines.push('')
lines.push('| 工具 | 现状 | 改造后 | 节省 | 已接入 | 说明 |')
lines.push('| --- | --- | --- | --- | --- | --- |')
for (const row of facadeRows) {
  lines.push(`| ${row.name} | ${row.before} | ${row.after ?? '—'} | ${row.saved ?? '不建议下沉'} | ${row.registered ? '✓' : '✗'} | ${row.note} |`)
}

/* 子代理自身开销：systemPrompt 每次调用都要发送，不参与主代理每请求的节省，但决定「下沉是否划算」 */
const subAgentPromptStats = {}
{
  const file = path.resolve(here, '../utils/sandboxSubAgent.js')
  const ast = acorn.parse(await readFile(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
  const scope = {} // 顶层常量，用于解析 ${COMMON_RULES} 这类插值
  walk(ast, node => {
    if (node.type !== 'VariableDeclarator' || !node.id?.name) return
    const { value, dynamic } = evalNode(node.init, scope)
    if (!dynamic && value !== undefined) scope[node.id.name] = value
  })
  if (typeof scope.COMMON_RULES === 'string') subAgentPromptStats['COMMON_RULES（单独计）'] = countText(scope.COMMON_RULES)
  if (scope.SANDBOX_PROMPTS && typeof scope.SANDBOX_PROMPTS === 'object') {
    for (const [kind, prompt] of Object.entries(scope.SANDBOX_PROMPTS)) {
      subAgentPromptStats[`${kind}（完整 systemPrompt）`] = countText(String(prompt))
    }
  }
}
lines.push('')
lines.push('## 子代理侧开销（每次调用支付一次，不属于主代理每请求占用）')
lines.push('')
lines.push('| 子代理 prompt | chars | tokens |')
lines.push('| --- | --- | --- |')
for (const [kind, stat] of Object.entries(subAgentPromptStats)) {
  lines.push(`| utils/sandboxSubAgent.js → ${kind} | ${stat.chars} | ${stat.tokens} |`)
}

const jsonIndex = process.argv.indexOf('--json')
const jsonPath = jsonIndex > -1 ? process.argv[jsonIndex + 1] : path.join(here, 'toolContextAudit.json')
await writeFile(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), grandTotalTokens: grand, tools, facadeRows, subAgentPromptStats }, null, 2) + '\n', 'utf8')

const report = lines.join('\n') + '\n'
const mdPath = path.join(here, 'toolContextAudit.md')
await writeFile(mdPath, report, 'utf8')

console.log(`Markdown 报告: ${mdPath}`)
console.log(`JSON 明细   : ${jsonPath}`)
console.log(`工具类 ${tools.length} 个：已接入 ${registeredTools.length} 个（${grand} tokens），未接入 ${unregisteredTools.length} 个（${grandAll - grand} tokens）`)
console.log(`已接入的可下沉工具 ${totalBefore} -> ${totalAfter} tokens（省 ${totalBefore - totalAfter}）`)
console.log(`未接入（死代码/未布线）: ${unregisteredTools.map(item => `${item.name}(${item.totalTokens})`).join(', ') || '无'}`)
console.log('TOP12:')
for (const item of tools.slice(0, 12)) {
  console.log(`  ${pad(item.name, 30)} ${pad(item.totalTokens, 8)} tokens  ${item.registered ? '已接入' : '未接入'}  (desc ${item.descriptionTokens} / schema ${item.schemaTokens})  props=${item.propertyCount} enum=${item.enumValues}`)
}
