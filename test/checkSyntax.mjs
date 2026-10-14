/**
 * 全仓语法预检：对仓库内每个 .js/.mjs 执行 `node --check`。
 * 供 `npm run check` 与 CI 使用；跳过 node_modules、.git 与产物/平台目录。
 */
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
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

if (failures.length > 0) {
  console.error(`[ChatGPT] 语法预检失败：${failures.length}/${files.length} 个文件未通过`)
  for (const file of failures) console.error(`  - ${path.relative(ROOT, file)}`)
  process.exit(1)
}
console.log(`[ChatGPT] 语法预检通过：${files.length} 个文件`)
