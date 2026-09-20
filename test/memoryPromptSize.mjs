/**
 * 记忆提示词体积测量（本地脚本，随仓库入库）
 *
 * 用途：改动 utils/memory/prompt.js 的三个提示词常量前后，量化体积变化。
 * 这三个常量在每日提炼里按「分片」各发一次，不进用户每请求的上下文，
 * 但仍要控制体积（分片输入上限 30000 tokens 是按原文行算的，提示词会额外叠加）。
 *
 * 用法：
 *   node test/memoryPromptSize.mjs
 *   node test/memoryPromptSize.mjs utils/memory/prompt.js /path/to/other-prompt.js
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getEncoding } from 'js-tiktoken'

const KEYS = ['EXTRACTOR_SYSTEM', 'DEFAULT_GROUP_MEMORY_PROMPT', 'EXTRACTION_JSON_FORMAT']
const targets = process.argv.slice(2)
const files = targets.length ? targets : ['utils/memory/prompt.js']

const enc = getEncoding('cl100k_base')
const tokens = text => enc.encode(text).length

const rows = []
let grand = 0
for (const file of files) {
  const abs = path.resolve(file)
  const mod = await import(pathToFileURL(abs).href)
  let total = 0
  for (const key of KEYS) {
    const value = mod[key]
    if (typeof value !== 'string') {
      rows.push({ file: path.basename(file), key, chars: '-', tokens: '-' })
      continue
    }
    const t = tokens(value)
    total += t
    rows.push({ file: path.basename(file), key, chars: value.length, tokens: t })
  }
  grand += total
  rows.push({ file: path.basename(file), key: '合计', chars: '', tokens: total })
}

const pad = (v, w) => String(v).padEnd(w)
console.log(pad('文件', 22) + pad('常量', 30) + pad('字符', 8) + 'tokens')
for (const row of rows) {
  console.log(pad(row.file, 22) + pad(row.key, 30) + pad(row.chars, 8) + row.tokens)
}
console.log(`\n全部文件合计: ${grand} tokens`)
