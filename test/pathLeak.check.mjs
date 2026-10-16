/**
 * 全仓"路径卫生"检查：拦截会随仓库公开的、带用户名的本机绝对路径
 * （Windows 的 `X:\Users\<名字>\` 与 Unix 的 `/home/<名字>/`、`/Users/<名字>/`）。
 * 供 `npm run check` 与 CI 使用；扫描面比 checkSyntax 广（含 .scratch 与 .md 等文本）。
 * 允许：占位形式（`<名字>`、`…`、`$…`、`%…%`、`{…}`）与白名单样例名：
 *   runner —— GitHub Actions 运行器路径（/home/runner/...），非个人目录
 *   turing —— SydneyAIClient 里的虚构样例路径，非真人
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy', '.venv', 'output', 'temp'])
const SKIP_PATHS = new Set(['server/static']) // 打包产物，非本仓书写内容
const TEXT_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.yml', '.yaml', '.html', '.txt', '.py', '.sh', '.bat', '.cmd', '.ps1'])
const MAX_BYTES = 512 * 1024

const PATTERNS = [
  { label: 'Windows 用户目录', re: /[A-Za-z]:[\\/][Uu]sers[\\/]([^\\/\s"'`）)]+)/g },
  { label: 'Unix 用户目录', re: /(?<![\w.])\/(?:home|[Uu]sers)\/([^/\s"'`）)]+)/g },
]
const ALLOW_USERNAMES = new Set(['runner', 'turing'])
const isPlaceholder = name => ['<', '…', '$', '%', '{'].some(ch => name.startsWith(ch))

const files = []
;(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(ROOT, full).split(path.sep).join('/')
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !SKIP_PATHS.has(rel)) walk(full)
    } else if (TEXT_EXTS.has(path.extname(entry.name)) && statSync(full).size <= MAX_BYTES) {
      files.push(full)
    }
  }
})(ROOT)

const findings = []
for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (text.includes('\u0000')) continue
  for (const [index, line] of text.split('\n').entries()) {
    for (const { label, re } of PATTERNS) {
      for (const match of line.matchAll(re)) {
        if (isPlaceholder(match[1]) || ALLOW_USERNAMES.has(match[1])) continue
        findings.push(`${path.relative(ROOT, file)}:${index + 1} [${label}] ${line.trim().slice(0, 120)}`)
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`[ChatGPT] 路径卫生检查失败：${findings.length} 处带用户名的本机路径（已扫 ${files.length} 个文件）`)
  for (const finding of findings) console.error(`  - ${finding}`)
  console.error('  改用仓库相对路径或占位形式（如 %LOCALAPPDATA%、~、<系统临时目录>）；确属样例/占位的加白名单并在脚本里注明原因')
  process.exit(1)
}
console.log(`[ChatGPT] 路径卫生检查通过：${files.length} 个文件`)
