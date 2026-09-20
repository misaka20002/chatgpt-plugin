#!/usr/bin/env node
// ============================================================
// 假绿点验证（变异测试）：证明 mathRender.check.mjs 的断言真的能拦住回归
//
// 用法（两步，中间跑一次断言套件）：
//   node test/render/mutate-check.mjs apply
//   node test/render/mathRender.check.mjs        ← 预期 exit 1，且下面列出的断言转红
//   node test/render/mutate-check.mjs restore
//
// 再做一次「修复后」确认：
//   node test/render/mathRender.check.mjs        ← 预期全绿
//
// 检测的是这四组（都是曾经出现过的假绿点 / 真实回归）：
//   M1 表格单元格退回写死正文色            → 「引用块内的表格单元格用引用色」必须转红
//   M2 脚注两条规则一起退回「不含空白」    → 「没有假链接 / 定义行保留 / 引用段落是字面文本」必须转红
//   M3 onload 里制造未捕获异常             → 「所有用例页面均无未捕获 JS 异常」必须转红
//   M4 引用块首个子元素的 margin-top 退回不生效 → 「引用块上下内距对称」必须转红
//
// 安全约束：改的是生产模板。脚本会先把原文件备份到同目录 mutate-check.backup.html，
// 每段替换都要求「恰好匹配 1 处」，任何一段不匹配就整体放弃（不动文件）；
// 已处于变异状态时拒绝再次 apply，避免把变异版本当成备份。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.resolve(HERE, '../../resources/mathRender/index.html')
const BACKUP = path.join(HERE, 'mutate-check.backup.html')
const MARKER = 'mutant-pageerror'

const mode = process.argv[2] || 'apply'
const EOL = fs.readFileSync(TEMPLATE, 'utf8').includes('\r\n') ? '\r\n' : '\n'
const lines = (...arr) => arr.join(EOL)

if (mode === 'restore') {
  if (!fs.existsSync(BACKUP)) {
    console.error(`没有备份文件，无法恢复：${BACKUP}`)
    process.exit(2)
  }
  fs.copyFileSync(BACKUP, TEMPLATE)
  fs.rmSync(BACKUP)
  console.log(`已从备份恢复：${TEMPLATE}`)
  process.exit(0)
}

const current = fs.readFileSync(TEMPLATE, 'utf8')
if (current.includes(MARKER)) {
  console.error('当前模板已是变异版本，请先 restore 再 apply（避免把变异版本覆盖成备份）')
  process.exit(2)
}

const mutations = [
  {
    name: 'M1 表格单元格退回写死正文色',
    pairs: [[
      lines('        .markdown-body tbody td {', '            color: var(--text-color);'),
      lines('        .markdown-body tbody td {', '            color: #4a3735;'),
    ]],
  },
  {
    name: 'M2 脚注两条规则一起退回「不含任何空白」（只退一条复现不出）',
    pairs: [
      ['/^\\[\\^([^\\]\\r\\n]+)\\]/', '/^\\[\\^([^\\]\\s]+)\\]/'],
      ['/^ {0,3}\\[\\^([^\\]\\r\\n]+)\\]:[ \\t]*(.*)$/', '/^ {0,3}\\[\\^([^\\]\\s]+)\\]:[ \\t]*(.*)$/'],
    ],
  },
  {
    name: 'M3 onload 里制造未捕获异常',
    pairs: [[
      '            contentDiv.innerHTML = md.render(rawData);',
      lines('            contentDiv.innerHTML = md.render(rawData);', `            setTimeout(() => { throw new Error('${MARKER}'); }, 0);`),
    ]],
  },
  {
    name: 'M4 引用块首个子元素退回「margin-top 不清零」（文字整体下坠）',
    // 24px 就是浏览器默认 p{margin:1em}：修好之前，引用块内首段上方是 18+24、下方只有 18
    pairs: [[
      lines('        .markdown-body blockquote > :first-child {', '            margin-top: 0;'),
      lines('        .markdown-body blockquote > :first-child {', '            margin-top: 24px;'),
    ]],
  },
]

fs.writeFileSync(BACKUP, current, 'utf8')
let out = current
for (const m of mutations) {
  for (const [from, to] of m.pairs) {
    const hits = out.split(from).length - 1
    console.log(`[变异] ${m.name} —— 匹配 ${hits} 处`)
    if (hits !== 1) {
      fs.rmSync(BACKUP)
      console.error('匹配数量不为 1，已放弃并删除备份（模板未改动）')
      process.exit(2)
    }
    out = out.replace(from, to)
  }
}
fs.writeFileSync(TEMPLATE, out, 'utf8')
console.log(`\n已写入变异版本。接下来：`)
console.log('  node test/render/mathRender.check.mjs    # 预期 exit 1')
console.log('  node test/render/mutate-check.mjs restore')
