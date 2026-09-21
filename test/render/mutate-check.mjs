#!/usr/bin/env node
// ============================================================
// 假绿点验证（变异测试）：证明 mathRender 两个套件的断言真的能拦住回归
//
// 用法（三步）：
//   node test/render/mutate-check.mjs apply                  # 一次注入全部变异
//   node test/render/mutate-check.mjs apply --only=M6        # 只注入一条（用来做单条归因）
//   node test/render/mathRender.check.mjs                    # 预期 exit 1（受影响的套件）
//   node test/render/mathRender.security.check.mjs           # 预期 exit 1
//   node test/render/mutate-check.mjs restore                # 全部还原
//
// 变异清单（每条都注明"谁必须转红"，--only=<id> 可单独跑）：
//   M1  [模板] 表格单元格退回写死正文色            → mathRender.check：引用块内的表格单元格用引用色
//   M2  [模板] 脚注两条规则一起退回「不含空白」    → mathRender.check：没有假链接 / 定义行保留 / 引用段落是字面文本
//   M3  [引导脚本] onload 里制造未捕获异常         → mathRender.check：所有用例页面均无未捕获 JS 异常
//   M4  [模板] 引用块首个子元素 margin-top 不清零  → mathRender.check：引用块上下内距对称
//   M5  [清洗] stripActiveMarkup 提前 return       → security：非主人零请求/零连接/无导航 + 用例 6 已清洗
//   M6  [模板] img-src 放开给所有人                → security：默认 img-src 只有 data: / 非主人零请求
//   M7  [模板] script-src 加上 'unsafe-inline'     → security：script-src 无 unsafe-inline / 非主人·主人无导航
//   M8  [工具] allowRemoteImages 恒为 true         → security：非主人 allowRemoteImages=false
//
// 安全约束：改的是生产文件。每段替换都要求「恰好匹配 1 处」，任何一段不匹配就整体放弃（不动任何文件）；
// 已处于变异状态时拒绝再次 apply，避免把变异版本当成备份。
// 备份与文件同名同目录（mutate-check.backup.<key>），restore 会把所有备份还原并删除。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '../..')
const MARKER = 'mutant-pageerror'

/** 可被变异的文件（key 也用于备份文件名） */
const FILES = {
  template: path.join(PLUGIN, 'resources/mathRender/index.html'),
  renderJs: path.join(PLUGIN, 'resources/mathRender/js/render.js'),
  sanitize: path.join(PLUGIN, 'utils/renderSanitize.js'),
  tool: path.join(PLUGIN, 'utils/tools/GenerateMathRenderTool.js'),
}
const backupOf = (key) => path.join(HERE, `mutate-check.backup.${key}`)
const read = (key) => fs.readFileSync(FILES[key], 'utf8')
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n')
const lines = (eol) => (...arr) => arr.join(eol)

const MODES = ['apply', 'restore']
const mode = process.argv[2] || 'apply'
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '')
if (!MODES.includes(mode)) {
  console.error(`模式只能是 ${MODES.join(' / ')}，收到：${mode}`)
  process.exit(2)
}

const MUTATIONS = [
  {
    id: 'M1', file: 'template', suite: 'mathRender.check.mjs',
    name: '表格单元格退回写死正文色 → 引用块内的表格单元格用引用色必须转红',
    pairs: (L) => [[
      L('        .markdown-body tbody td {', '            color: var(--text-color);'),
      L('        .markdown-body tbody td {', '            color: #4a3735;'),
    ]],
  },
  {
    id: 'M2', file: 'template', suite: 'mathRender.check.mjs',
    name: '脚注两条规则一起退回「不含任何空白」（只退一条复现不出）',
    pairs: () => [
      ['/^\\[\\^([^\\]\\r\\n]+)\\]/', '/^\\[\\^([^\\]\\s]+)\\]/'],
      ['/^ {0,3}\\[\\^([^\\]\\r\\n]+)\\]:[ \\t]*(.*)$/', '/^ {0,3}\\[\\^([^\\]\\s]+)\\]:[ \\t]*(.*)$/'],
    ],
  },
  {
    // 引导脚本已外置到 js/render.js（CSP 的 script-src 不含 'unsafe-inline'），所以这条变异也挪过去了
    id: 'M3', file: 'renderJs', suite: 'mathRender.check.mjs',
    name: 'onload 里制造未捕获异常',
    pairs: (L) => [[
      '    contentDiv.innerHTML = md.render(rawData);',
      L('    contentDiv.innerHTML = md.render(rawData);', `    setTimeout(() => { throw new Error('${MARKER}'); }, 0);`),
    ]],
  },
  {
    id: 'M4', file: 'template', suite: 'mathRender.check.mjs',
    name: '引用块首个子元素退回「margin-top 不清零」（文字整体下坠）',
    // 24px 就是浏览器默认 p{margin:1em}：修好之前，引用块内首段上方是 18+24、下方只有 18
    pairs: (L) => [[
      L('        .markdown-body blockquote > :first-child {', '            margin-top: 0;'),
      L('        .markdown-body blockquote > :first-child {', '            margin-top: 24px;'),
    ]],
  },
  {
    id: 'M5', file: 'sanitize', suite: 'mathRender.security.check.mjs',
    name: 'stripActiveMarkup 变成空操作（清洗整层失效）',
    pairs: (L) => [[
      L("  let cleaned = String(html ?? '')", '  for (const tag of ACTIVE_TAGS) {'),
      L("  let cleaned = String(html ?? '')", '  return cleaned', '  for (const tag of ACTIVE_TAGS) {'),
    ]],
  },
  {
    id: 'M6', file: 'template', suite: 'mathRender.security.check.mjs',
    name: "img-src 放开给所有人（授权分档被破坏）",
    pairs: () => [[
      "img-src data:{{allowRemoteImages ? ' http: https:' : ''}}",
      'img-src data: http: https:',
    ]],
  },
  {
    id: 'M7', file: 'template', suite: 'mathRender.security.check.mjs',
    name: "script-src 加上 'unsafe-inline'（行内事件处理器活过来）",
    pairs: () => [[
      'script-src file:;',
      "script-src file: 'unsafe-inline';",
    ]],
  },
  {
    id: 'M8', file: 'tool', suite: 'mathRender.security.check.mjs',
    name: 'allowRemoteImages 恒为 true（授权判定不看事件上下文）',
    pairs: () => [[
      'allowRemoteImages: e?.isMaster === true,',
      'allowRemoteImages: true,',
    ]],
  },
]

// ---------- restore ----------
if (mode === 'restore') {
  const restorable = Object.keys(FILES).filter((k) => fs.existsSync(backupOf(k)))
  if (restorable.length === 0) {
    console.error('没有备份文件，无法恢复')
    process.exit(2)
  }
  for (const key of restorable) {
    fs.copyFileSync(backupOf(key), FILES[key])
    fs.rmSync(backupOf(key))
    console.log(`已从备份恢复：${FILES[key]}`)
  }
  process.exit(0)
}

// ---------- apply ----------
const selected = only ? MUTATIONS.filter((m) => m.id === only) : MUTATIONS
if (only && selected.length === 0) {
  console.error(`没有 id 为 ${only} 的变异，可用：${MUTATIONS.map((m) => m.id).join(', ')}`)
  process.exit(2)
}
const touched = [...new Set(selected.map((m) => m.file))]
for (const key of touched) {
  if (fs.existsSync(backupOf(key))) {
    console.error(`已有备份 ${backupOf(key)}，说明当前是变异状态；请先 restore 再 apply`)
    process.exit(2)
  }
  if (read(key).includes(MARKER)) {
    console.error(`文件里已含变异标记 ${MARKER}，请先 restore`)
    process.exit(2)
  }
}

// 先在内存里算完所有替换，全部通过才落盘（任何一段匹配数不为 1 就整体放弃）
const out = {}
const eolCache = {}
for (const key of touched) {
  out[key] = read(key)
  eolCache[key] = eolOf(out[key])
}
let abort = false
for (const m of selected) {
  for (const [from, to] of m.pairs(lines(eolCache[m.file]))) {
    const hits = out[m.file].split(from).length - 1
    console.log(`[${m.id}] ${m.name} —— 匹配 ${hits} 处（${path.basename(FILES[m.file])}）`)
    if (hits !== 1) {
      console.error(`匹配数量不为 1，已整体放弃（没有任何文件被改动）`)
      abort = true
      break
    }
    out[m.file] = out[m.file].replace(from, to)
  }
  if (abort) break
}
if (abort) process.exit(2)

for (const key of touched) {
  fs.writeFileSync(backupOf(key), read(key), 'utf8')
  fs.writeFileSync(FILES[key], out[key], 'utf8')
  console.log(`已写入变异版本：${path.basename(FILES[key])}（备份 ${path.basename(backupOf(key))}）`)
}

console.log('\n接下来：')
for (const suite of [...new Set(selected.map((m) => m.suite))]) {
  console.log(`  node test/render/${suite}    # 预期 exit 1`)
}
console.log('  node test/render/mutate-check.mjs restore')
