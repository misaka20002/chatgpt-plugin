/**
 * 依赖预检：本仓多数测试要 node_modules（lodash / keyv / node-fetch 等），
 * 而 `checkSyntax` / `pathLeak` / `lint` 是零依赖的。缺依赖时若不早退，
 * 后面每个测试各抛一次 ERR_MODULE_NOT_FOUND，真正的原因被几十条同义报错淹没。
 *
 * 一手证据（2026-10-27）：一台只 clone 未安装依赖的机器上跑 `npm run check`，
 * 27 个用例里 8 个 fail、19 个 cancelled，全部指向 lodash 解析失败，
 * 看上去像"改动把测试搞挂了"，实际是环境没装依赖。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main () {
  try {
    await import('lodash')
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err
    const hasNodeModules = existsSync(path.join(ROOT, 'node_modules'))
    console.error('[ChatGPT] 依赖缺失：本仓测试需要 node_modules（lodash 等）。')
    console.error(
      hasNodeModules
        ? '  node_modules 目录存在，但 lodash 解析不到——可能是空壳或安装中断。'
        : '  node_modules 目录不存在，说明还没安装依赖。'
    )
    console.error('  修法：在插件目录执行 pnpm install（本仓用 pnpm；用 npm 会生成 package-lock.json，被 lint 规则 6 拦下）。')
    process.exit(1)
  }
}

await main()
