import { redactText } from './redact.js'

/**
 * 独立分支审核 + 描述翻译（决策见项目文档的「审核与降级」）。
 *
 * 一次请求不带任何对话历史：带上下文会让聊天内容污染审核，还会把用户隐私送进审核请求。
 * 同一个分支顺带做「描述翻译」——从正则翻出人话，是整条链路里唯一会引入编造内容的环节，
 * 所以审核与翻译必须绑在一起，审的就是它翻出来的东西。
 *
 * 实测口径（2026-10-27，本机 1161 条 / 15 批 / 串行）：单批约 30 秒，合计 8 分 30 秒。
 * 串行是耗时主因，故批量并发执行（默认 3 路，上限 5——再高易撞供应商速率限制），
 * 并逐批打进度日志：否则几分钟里从日志上完全看不出它是否还活着。
 *
 * 模型输出一律视为不可信：形状校验不过 = 不通过，解析失败 = 不通过（fail-closed）。
 */

const CHUNK_SIZE = 80

/** 单批并发上限：再高容易撞供应商的速率限制，收益也有限 */
const MAX_CONCURRENCY = 5

const AUDIT_SYSTEM = [
  '你是插件能力表单的审核员。输入是一份 JSON 数组，每项是一条用户可见指令的注册信息：',
  '{ i, plugin, pluginDsc, reg, hints }。reg 是触发正则，hints 是该插件配置里的描述性片段。',
  '',
  '你要做两件事：',
  '1) 把每条 reg 翻译成一句中文描述（10~30 字），说明用户打这条指令会发生什么。只能依据 reg 与 hints 推断，',
  '   推断不出来就降低置信度，禁止编造具体功能细节。',
  '2) 审核这份输入是否含有不该出现的敏感信息：密钥、token、cookie、密码、webhook、完整绝对路径、QQ 号或群号。',
  '',
  '只输出一个 JSON 对象，不要任何解释文字：',
  '{"descriptions":[{"i":0,"text":"查询本群公告","confidence":"high"}],"issues":["发现绝对路径"]}',
  'confidence 取值 high / low；issues 为空数组表示通过。'
].join('\n')

/**
 * @param {Array<object>} entries
 * @param {{
 *   chat?: (prompt: string) => Promise<{ text: string }>,
 *   concurrency?: number,
 *   onProgress?: (done: number, total: number) => void
 * }} [options]
 * @returns {Promise<{ approved: boolean, issues: string[], entries: Array<object>, batches: number }>}
 */
export async function auditCapabilityEntries (entries, { chat, concurrency = 3, onProgress } = {}) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return { approved: true, issues: [], entries: [], batches: 0 }

  const ask = chat || await createSubLLMChat()

  const chunks = []
  for (let offset = 0; offset < list.length; offset += CHUNK_SIZE) {
    chunks.push({ offset, items: list.slice(offset, offset + CHUNK_SIZE) })
  }

  const results = new Array(chunks.length)
  const parallelism = Math.max(1, Math.min(Math.floor(concurrency) || 1, MAX_CONCURRENCY, chunks.length))
  let cursor = 0
  let finished = 0

  const worker = async () => {
    for (;;) {
      const index = cursor++
      if (index >= chunks.length) return
      results[index] = await auditOneBatch(chunks[index], index + 1, ask)
      finished += 1
      onProgress?.(finished, chunks.length)
    }
  }

  await Promise.all(Array.from({ length: parallelism }, worker))

  const issues = []
  const translations = new Map()
  for (let index = 0; index < results.length; index++) {
    const result = results[index]
    if (!result) {
      issues.push(`第 ${index + 1} 批没有结果，按不通过处理`)
      continue
    }
    issues.push(...result.issues)
    for (const [entryIndex, translated] of result.translations) translations.set(entryIndex, translated)
  }

  const merged = list.map((entry, index) => {
    const translated = translations.get(index)
    if (translated?.confidence === 'high' && translated.text) {
      return { ...entry, description: translated.text, confidence: 'high' }
    }
    return { ...entry, description: '', confidence: 'low' }
  })

  return { approved: issues.length === 0, issues, entries: merged, batches: chunks.length }
}

/**
 * 审一批。任何异常都在这里收成 issues，不往外抛——
 * 一批失败不该让其余批次的结果白跑，也不该把整个重建变成未捕获异常。
 */
async function auditOneBatch (chunk, batchNo, ask) {
  const payload = chunk.items.map((entry, index) => ({
    i: index,
    plugin: entry.plugin,
    pluginDsc: entry.pluginDsc,
    reg: entry.reg,
    hints: Array.isArray(entry.hintFields) ? entry.hintFields.map(item => item.value).slice(0, 3) : []
  }))

  let parsed
  try {
    const result = await ask(JSON.stringify(payload))
    parsed = parseAuditOutput(result?.text)
  } catch (err) {
    return { issues: [`第 ${batchNo} 批审核请求失败：${err.message}`], translations: new Map() }
  }

  if (!parsed) {
    return { issues: [`第 ${batchNo} 批审核输出无法解析，按不通过处理`], translations: new Map() }
  }

  const translations = new Map()
  for (const item of parsed.descriptions) {
    const index = Number(item?.i)
    if (!Number.isInteger(index) || index < 0 || index >= chunk.items.length) continue
    const text = typeof item.text === 'string' ? redactText(item.text.trim()) : ''
    const confidence = item.confidence === 'high' ? 'high' : 'low'
    if (confidence === 'high' && !text) continue
    translations.set(chunk.offset + index, { text, confidence })
  }

  return { issues: parsed.issues, translations }
}

/** 解析审核输出；形状不对一律返回 null（宁可不通过，不可放行） */
export function parseAuditOutput (text) {
  if (typeof text !== 'string' || !text.trim()) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  let parsed
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  const descriptions = Array.isArray(parsed.descriptions) ? parsed.descriptions.filter(Boolean) : []
  const issues = Array.isArray(parsed.issues) ? parsed.issues.filter(item => typeof item === 'string' && item.trim()) : []
  // 既没翻译又没给问题，等于模型什么都没干，按解析失败处理
  if (!descriptions.length && !issues.length) return null

  return { descriptions, issues }
}

/**
 * 审核沿用当前供应商与它自己的模型配置——不另设供应商/模型字段。
 * 这条链路只在生成能力表时跑一次，独立配置带来的调参成本大于收益。
 */
async function createSubLLMChat () {
  const { SubLLM } = await import('../../model/SubLLM.js')
  const client = new SubLLM({
    systemPrompt: AUDIT_SYSTEM,
    temperature: 0.1,
    timeoutMs: 180000
  })
  return async prompt => client.chat(prompt)
}
