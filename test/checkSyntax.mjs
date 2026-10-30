/**
 * 全仓语法预检：对仓库内每个 .js/.mjs 执行 `node --check`，再核对相对导入是否指向存在的文件。
 * 供 `npm run check` 与 CI 使用；跳过 node_modules、.git 与产物/平台目录。
 *
 * 只做 `--check` 抓不到「文件搬了目录、`../config.js` 没跟着改」：解析器不管路径能否解析，
 * 要等插件真正被载入才炸（已发生过一次：指令模块从 `utils/tools/` 搬到 `utils/` 后
 * 仍 import `../config.js`，插件载入报 ERR_MODULE_NOT_FOUND）。相对导入因此单独核一遍。
 */
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy', '.venv', '.scratch', 'output', 'temp'])
const CHECK_EXTS = new Set(['.js', '.mjs'])

const files = []
;(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name))
    } else if (CHECK_EXTS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name))
    }
  }
})(ROOT)

const failures = []
let cursor = 0
const workers = Array.from({ length: 8 }, async () => {
  while (cursor < files.length) {
    const file = files[cursor++]
    const code = await new Promise(resolve => {
      const child = spawn(process.execPath, ['--check', file], { stdio: 'ignore' })
      child.on('close', resolve)
      child.on('error', () => resolve(1))
    })
    if (code !== 0) failures.push(file)
  }
})
await Promise.all(workers)

/**
 * 相对导入必须指向真实文件。
 *
 * 四个模式：`import x from '…'`（副作用式的 `import '…'` 也归它，from 段是可选的）、
 * 多行 import 的 `} from '…'` 尾巴、`export … from '…'`、动态 `import('…')`。
 * 裸模块与 node: 前缀不查——那是宿主或 npm 的解析职责；无扩展名的也不查，判不了是目录还是省略后缀。
 * 注释先剥掉：留着旧 import 的块注释不该算数。
 */
const IMPORT_PATTERNS = [
  /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
  /^\s*\}\s*from\s+['"]([^'"]+)['"]/gm,
  /^\s*export\s+(?:[^'"]*?\s+)?from\s+['"]([^'"]+)['"]/gm,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g
]
const COMMENT_BLOCK = /\/\*[\s\S]*?\*\//g
const COMMENT_LINE = /^\s*\/\/.*$/gm

// 逐目录缓存文件名，并按大小写严格比对：Windows 的 existsSync 不分大小写，
// `./Config.js` 这类在开发机上能过、到 Linux 上必炸的写法会被漏掉。
const dirCache = new Map()
function existsExactCase(target) {
  const dir = path.dirname(target)
  if (!dirCache.has(dir)) {
    try {
      dirCache.set(dir, new Set(readdirSync(dir)))
    } catch {
      dirCache.set(dir, null)
    }
  }
  const names = dirCache.get(dir)
  return names ? names.has(path.basename(target)) : false
}

const unresolved = []
for (const file of files) {
  let source
  try {
    source = readFileSync(file, 'utf8').replace(COMMENT_BLOCK, '').replace(COMMENT_LINE, '')
  } catch {
    continue
  }
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
      if (path.extname(specifier) === '') continue
      const target = path.resolve(path.dirname(file), specifier)
      // 只核插件自己目录内的导入：指向宿主或兄弟插件（miao-plugin、lib/plugins）的路径
      // 在 CI 与开发机上本来就不存在，判不了。
      const inside = path.relative(ROOT, target)
      if (inside.startsWith('..') || path.isAbsolute(inside)) continue
      if (!existsExactCase(target)) unresolved.push({ file, specifier })
    }
  }
}

if (failures.length > 0) {
  console.error(`[ChatGPT] 语法预检失败：${failures.length}/${files.length} 个文件未通过`)
  for (const file of failures) console.error(`  - ${path.relative(ROOT, file)}`)
  process.exit(1)
}
if (unresolved.length > 0) {
  console.error(`[ChatGPT] 相对导入无法解析：${unresolved.length} 处`)
  for (const item of unresolved) {
    console.error(`  - ${path.relative(ROOT, item.file)} → ${item.specifier}`)
  }
  process.exit(1)
}
console.log(`[ChatGPT] 语法预检通过：${files.length} 个文件，相对导入全部可解析`)
