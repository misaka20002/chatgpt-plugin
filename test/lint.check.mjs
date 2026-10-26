/**
 * 确定性风格检查（零依赖）：只收「正则就能判定、且当前仓库零存量违规」的机械规则
 *
 * 供 `npm run check` 与 CI 使用。规则准入标准是**零存量违规**：带存量噪音的规则会让门禁
 * 变成常红，最后被忽略。以下候选已评估、暂不纳入（要做先清存量再引入 linter）：
 * - 日志前缀全小写：现存 112 处（`[chatgpt]`、`[meme]`、`[chatgpt-tt]`…），是历史约定；
 *   只禁止**可判定的子集**——单 token 的 camelCase 前缀（`[quotedImage]`），这条已零存量；
 * - `utils/` 的 `console.log`：48 处；
 * - 行尾空格：379 处；
 * - 无注释空 `catch`：24 处；
 * - 未使用变量：需要 AST，仓库当前没有解析器依赖。
 *
 * 规则：
 * 1. JSDoc 与声明同行：文档块结束符后直接跟 `const`/`function`/`class` 等 —— 必须换行，
 *    否则 summary 不再独立成块。
 * 1b. 日志前缀不能是 camelCase 单 token（`[quotedImage]`）：要么全小写的历史前缀，
 *     要么 `[ChatGPT][子模块]` 两段式。
 * 2. `client/` 与 `model/` 里出现 `console.log(`（跳过注释行）—— 请求组装路径必须走 `logger`。
 * 3. 测试文件必须被某个 `test:*` 脚本引用；只需本机环境才能跑的，文件头写 `manual test:` 豁免。
 * 4. `test:*` 脚本里引用的文件必须存在。
 * 5. 每个 `test:*` 必须被 `check` 调用，或在 CHECK_EXCLUDED 里写明豁免理由——否则 CI 永远不跑它。
 * 6. 仓库根不得出现 `package-lock.json` 或 `.venv`：前者是 npm 在 pnpm 工作区里跑出来的，
 *    后者是本仓已无 Python 代码的证据（临时验证的 venv 该建在系统临时目录）。
 * 7. 用户可见文案（锅巴 `bottomHelpMessage`、`e.reply(...)`）里的**时长断言**必须带「实测」。
 *    本仓已吃过一次：审核文案写「一两分钟」，实测 8 分 30 秒，四倍偏差活到上线才被日志抓住。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = ['apps', 'client', 'model', 'utils', 'test', 'prompts']
const SCAN_FILES = ['index.js', 'guoba.support.js']
const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy', '.venv', 'output', 'temp', 'fixtures'])
const CODE_EXTS = new Set(['.js', '.mjs', '.cjs'])
/** 只在这两个目录禁用 console.log：请求组装路径，是 `logger` 的职责 */
const NO_CONSOLE_LOG_DIRS = ['client/', 'model/']

const JSDOC_SAME_LINE_RE = /\*\/[ \t]+(?:const|let|var|function|async[ \t]+function|export|class)\b/
const CAMEL_LOG_PREFIX_RE = /\blogger\.(?:info|warn|error|mark|debug|blue|cyan|red)\(\s*['"`]\[([a-z][A-Za-z0-9]*)\]/
const CONSOLE_LOG_RE = /\bconsole\.log\(/
/** 用户可见文案的判定：锅巴字段说明与回复语句 */
const USER_COPY_RE = /bottomHelpMessage:|e\.reply\(/
/** 时长断言：约 N 分钟 / N 分 M 秒 / 一两分钟 / 几分钟 —— 都是「没测就写」的典型措辞 */
const DURATION_CLAIM_RE = /约\s*\d+(?:\.\d+)?\s*分(?:钟)?|\d+\s*分\s*\d+\s*秒|一两分钟|几分钟/

const violations = []

function scanFile(file) {
  const text = readFileSync(file, 'utf8')
  if (text.length > 512 * 1024) return
  const relative = path.relative(ROOT, file).split(path.sep).join('/')
  const forbidConsoleLog = NO_CONSOLE_LOG_DIRS.some(dir => relative.startsWith(dir))
  text.split('\n').forEach((line, index) => {
    if (line.includes('lint-ignore')) return
    if (JSDOC_SAME_LINE_RE.test(line)) {
      violations.push(`${relative}:${index + 1} JSDoc 结束与声明须换行`)
    }
    const camelLog = CAMEL_LOG_PREFIX_RE.exec(line)
    if (camelLog && /[A-Z]/.test(camelLog[1])) {
      violations.push(`${relative}:${index + 1} 日志前缀 "${camelLog[1]}" 是 camelCase；改全小写或 "[ChatGPT][子模块]"`)
    }
    // 规则 7：用户文案里的时长断言必须带「实测」，否则就是凭感觉写的数
    const trimmedLine = line.trim()
    if (USER_COPY_RE.test(line) && !trimmedLine.startsWith('//') && !trimmedLine.startsWith('*')) {
      const claim = DURATION_CLAIM_RE.exec(line)
      if (claim && !line.includes('实测')) {
        violations.push(`${relative}:${index + 1} 时长断言「${claim[0]}」没有实测依据；写实测值并注明规模，或改成「视规模而定」`)
      }
    }
    if (!forbidConsoleLog) return
    const trimmed = line.trim()
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) return
    if (CONSOLE_LOG_RE.test(line)) {
      violations.push(`${relative}:${index + 1} 请求组装路径请用 logger，不用 console.log`)
    }
  })
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(path.join(dir, entry.name))
      continue
    }
    if (!entry.isFile()) continue
    if (!CODE_EXTS.has(path.extname(entry.name))) continue
    scanFile(path.join(dir, entry.name))
  }
}

for (const dir of SCAN_DIRS) {
  const absolute = path.join(ROOT, dir)
  try {
    if (statSync(absolute).isDirectory()) walk(absolute)
  } catch {
    // 目录不存在就跳过：分支裁剪后可能出现
  }
}
for (const file of SCAN_FILES) {
  try {
    if (statSync(path.join(ROOT, file)).isFile()) scanFile(path.join(ROOT, file))
  } catch {
    // 同上
  }
}

const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts
const scriptsText = Object.values(scripts).join('\n')

// 规则 3：测试文件必须挂进某个脚本，否则永远不会有谁跑它
const testDir = path.join(ROOT, 'test')
for (const entry of readdirSync(testDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.test\.(?:m?js)$/.test(entry.name)) continue
  if (scriptsText.includes(`test/${entry.name}`)) continue
  const head = readFileSync(path.join(testDir, entry.name), 'utf8').slice(0, 400)
  if (/manual test:/.test(head)) continue
  violations.push(`test/${entry.name} 没有被任何 test:* 脚本引用；只需手工运行的请把首行写成 "manual test: <原因>"`)
}

// 规则 4：脚本里的 test/ 路径必须真实存在（改文件名/删文件后最容易漏）
const referenced = [...scriptsText.matchAll(/test\/[\w./-]+\.(?:m?js)/g)].map(match => match[0])
for (const file of new Set(referenced)) {
  try {
    statSync(path.join(ROOT, file))
  } catch {
    violations.push(`package.json 引用了不存在的测试文件 ${file}`)
  }
}

// 规则 5：每个 test:* 要么被 check 调用，要么进显式豁免清单——否则它只活在本地、谁都不知道
// 它还存不存在。check 只收「每次改动都该跑」的核心门禁；专题套件进豁免清单并写明用途与耗时，
// 改到相关模块时本地跑。别为了"覆盖更全"往 check 里堆套件——门禁一慢就会被绕过。
const CHECK_EXCLUDED = new Set([
  'test:avatar', // 头像处理专项，慢
  // 走 puppeteer 真实导航（harnessBrowser.mjs）：开本机 Chromium 时 34s 全绿，CI 无 Chromium
  'test:render',
  'test:meme', // meme 慢测试
  'test:meme:fast', // meme 日常回归，仍属专项
  'test:meme:mutants', // meme 变异测试，仅专项
  'test:tools', // 工具行为专项（220+ 例，4.6s）；改到工具时本地跑，不压 CI 门禁
  'test:memory', // 记忆/图谱专项（8.8s，是专项里最贵的一项）；按需本地跑
])
// 按「npm run <名字>」切词后精确比对：`includes` 子串匹配会让 `test:meme` 命中
// `test:meme:fast`，于是没接线的套件也能蒙过去
const checkScript = scripts.check || ''
const invokedByCheck = new Set([...checkScript.matchAll(/\bnpm run ([^\s&|;)]+)/g)].map(match => match[1]))
for (const name of Object.keys(scripts).filter(key => key.startsWith('test:'))) {
  if (CHECK_EXCLUDED.has(name)) continue
  if (invokedByCheck.has(name)) continue
  violations.push(`package.json 的 ${name} 没有接进 check；接进去，或加进 lint.check.mjs 的 CHECK_EXCLUDED 并写明原因`)
}

// 规则 6：跑错工具链或临时验证留下的产物。两条都是实际踩过的：npm 在 pnpm 工作区里生成了
// package-lock.json；`python -m venv .venv` 在插件目录留下一个只有 pip 的空壳。
const STRAY_ARTIFACTS = [
  ['package-lock.json', '本仓是 pnpm 工作区，这是 npm install 的产物：删掉它，改用 pnpm'],
  ['.venv', '本仓没有 Python 代码：临时验证的 venv 建在系统临时目录，用完连目录删掉']
]
for (const [name, reason] of STRAY_ARTIFACTS) {
  if (existsSync(path.join(ROOT, name))) violations.push(`不应存在 ${name}——${reason}`)
}

if (violations.length) {
  console.error(`[ChatGPT] 风格检查未通过，共 ${violations.length} 处：`)
  for (const item of violations) console.error('  - ' + item)
  process.exit(1)
}
console.log('[ChatGPT] 风格检查通过：JSDoc 换行、日志前缀、console.log 边界、测试挂载、脚本路径、套件接线、工具链产物、时长断言须实测')
