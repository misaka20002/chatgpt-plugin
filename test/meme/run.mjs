/**
 * 派蒙meme 测试入口。
 *
 * 断言套件（meme.test.mjs）需要 import 主仓库的 `lib/plugins/loader.js` 与 `lib/config/config.js`，
 * 这两条链路要求 cwd 看起来像云崽根目录（`config/default_config/`、`package.json`、`renderers/`），
 * 因此这里自动搭一个临时 cwd 再跑，跑完清理——测试产生的 `data/memes/*` 也只会落在临时目录里。
 *
 * 用法：
 *   node test/meme/run.mjs                    # 完整套件（含约 48s 的超时用例 K）
 *   node test/meme/run.mjs --skip-slow        # 跳过 K 组，日常回归用
 *   node test/meme/run.mjs --force-sharp=false # 关掉 forceSharp 再跑一遍（断言会反向推导）
 *   node test/meme/run.mjs --mutant <kind>    # 生成指定变异 → 跑套件 → 清理副本（验证断言有效性）
 *   node test/meme/run.mjs --all-mutants      # 跑全部变异（慢）
 *   node test/meme/run.mjs --keep             # 保留临时 cwd 便于排查
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MUTATIONS, writeMutant, removeMutant } from './make-mutant.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../../..') // plugins/chatgpt-plugin/test/meme -> 云崽根目录
const SUITE = path.join(here, 'meme.test.mjs')
const PLUGIN_REL = 'plugins/chatgpt-plugin/apps/派蒙meme.js'

/** 需要跑慢用例 K 才成立的变异，--all-mutants 会跳过它们 */
const SLOW_ONLY = new Set(['timeout'])

const argv = process.argv.slice(2)
const has = n => argv.includes(n)
/**
 * 取具名参数的值。
 * 两种写法都支持：`--flag value` 与 `--flag=value`。
 * 只认前一种时，文档里写的 `--force-sharp=false` 会**静默变成"没传"**，
 * 于是变体套件其实还是按默认 forceSharp=true 跑的，等于白跑。
 */
const valueOf = (n, d) => {
  const i = argv.indexOf(n)
  if (i > -1) return argv[i + 1]
  const prefix = `${n}=`
  const eq = argv.find(a => a.startsWith(prefix))
  return eq ? eq.slice(prefix.length) : d
}

const skipSlow = has('--skip-slow')
const forceSharp = valueOf('--force-sharp', '')
const keep = has('--keep')
const one = valueOf('--mutant', '')
let kinds = has('--all-mutants') ? Object.keys(MUTATIONS).filter(k => !SLOW_ONLY.has(k)) : (one ? [one] : [])

if (one && !MUTATIONS[one]) {
  console.error(`未知变异: ${one}\n可选: ${Object.keys(MUTATIONS).join(' | ')}`)
  process.exit(2)
}
if (has('--all-mutants') && SLOW_ONLY.size) {
  console.log(`# --all-mutants 已跳过只对慢用例生效的变异: ${[...SLOW_ONLY].join(', ')}`)
  console.log(`#   （它们的预期是"挂死"，请单独跑: node test/meme/run.mjs --mutant timeout）`)
}

/** 搭一个"像云崽根目录"的临时 cwd */
function prepareCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meme-test-'))
  fs.cpSync(path.join(repoRoot, 'config/default_config'), path.join(dir, 'config/default_config'), { recursive: true })
  fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(dir, 'package.json'))
  fs.mkdirSync(path.join(dir, 'renderers'), { recursive: true })
  return dir
}

const cwd = prepareCwd()
const baseEnv = {
  MEME_PLUGIN: PLUGIN_REL,
  ...(forceSharp ? { MEME_FORCE_SHARP: forceSharp } : {}),
}

/** 返回 {status, killed} */
function runSuite(env, timeout = 300000) {
  const r = spawnSync(process.execPath, [SUITE], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    timeout,
  })
  return { status: r.status, killed: !!r.signal }
}

let failed = 0
const summary = []
try {
  if (!kinds.length) {
    console.log(`# 完整套件  cwd=${cwd}${skipSlow ? '  (--skip-slow)' : ''}${forceSharp ? `  forceSharp=${forceSharp}` : ''}`)
    const r = runSuite({ ...baseEnv, ...(skipSlow ? { MEME_SKIP_K: '1' } : {}) })
    summary.push(`套件: ${r.killed ? '被 timeout 杀死' : `退出码 ${r.status}`}`)
    if (r.status) failed++
  } else {
    for (const kind of kinds) {
      console.log(`\n======== mutant: ${kind} ========`)
      console.log(`# ${MUTATIONS[kind].desc}\n# 预期转红: ${MUTATIONS[kind].kills}`)
      let r
      try {
        const dst = writeMutant(kind)
        r = runSuite({ ...baseEnv, MEME_PLUGIN: path.relative(repoRoot, dst).split(path.sep).join('/'), MEME_SKIP_K: '1' }, 240000)
      } finally {
        const ok = removeMutant()
        if (!ok && fs.existsSync(path.join(repoRoot, 'plugins/chatgpt-plugin/apps/__mutant_meme.mjs'))) {
          console.error('⚠️ 变异副本清理失败，请手工删除 apps/__mutant_meme.mjs')
        }
      }
      if (r.killed) {
        summary.push(`${kind}: 挂死被 timeout 杀死（预期形态）`)
      } else {
        summary.push(`${kind}: 退出码 ${r.status}${r.status ? '（有断言转红，符合预期）' : '（⚠️ 无断言转红，说明断言没覆盖该变异！）'}`)
        if (!r.status) failed++
      }
    }
  }
} finally {
  if (keep) console.log(`# 保留临时 cwd: ${cwd}`)
  else fs.rmSync(cwd, { recursive: true, force: true })
}

console.log('\n================ 汇总 ================')
for (const line of summary) console.log(line)
process.exit(failed ? 1 : 0)
