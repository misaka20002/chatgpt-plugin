/**
 * 派蒙meme 变异生成器 —— 用于确认 test/meme/meme.test.mjs 的断言不是"假绿"。
 *
 * 每个变异对应一类断言：跑完测试套件后，预期只有目标断言转红；若全绿说明断言没真正覆盖该行为。
 *
 * 用法：
 *   node test/meme/run.mjs --mutant <kind>     # 推荐：生成变异 + 跑套件 + 自动清理
 *   node test/meme/run.mjs --all-mutants       # 跑全部变异（慢，约 15 × 15s）
 *
 * 注意：变异副本落在 apps/ 下（相对 import 才能解析），文件名以 `.mjs` 结尾——
 * 云崽 loader 只扫描以 `.js` 结尾的文件，所以运行中的 bot 不会把变异副本当成插件加载。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const SRC = path.resolve(here, '../../apps/派蒙meme.js')
export const DST = path.resolve(here, '../../apps/__mutant_meme.mjs')

export const MUTATIONS = {
  rule: {
    desc: '删掉 entry.plugin.rule = rules（规则不再回写注册实例）',
    re: /^[ \t]*entry\.plugin\.rule = rules[ \t]*\r?$/m,
    to: '',
    kills: 'A1/B2/B3/C1/C2/D2/E2/F3/I2/J1/J2',
  },
  cron: {
    desc: '定时任务回到 this.init.bind(this)（只重读本地缓存）',
    re: /fnc: this\.init\.bind\(this, true\)/,
    to: 'fnc: this.init.bind(this)',
    kills: 'B1/B2/B4/B5',
  },
  race: {
    desc: 'init 一进来就清空全局 keyMap/infos（还原更新期竞态）',
    re: /([ \t]*const oldInfos = infos\r?\n)/,
    to: '$1    keyMap = {}; infos = {} // mutant: 还原旧行为\r\n',
    kills: 'F1/F2',
  },
  protect: {
    desc: 'imgUrls[0] = [meAvatar]（还原主人保护分支的数组 bug）',
    re: /imgUrls\[0\] = meAvatar/,
    to: 'imgUrls[0] = [meAvatar]',
    kills: 'G1',
  },
  partial: {
    desc: '逐项重建不完整也照单接收',
    re: /if \(Object\.keys\(infosTmp\)\.length >= keys\.length\) \{/,
    to: 'if (Object.keys(infosTmp).length) {',
    kills: 'I1/I2/I3/I4',
  },
  escape: {
    desc: '关键词不转义直接拼正则',
    re: /reg: cmdReg\(_\.escapeRegExp\(key\)\)/,
    to: 'reg: cmdReg(key)',
    kills: 'J1/J2',
  },
  cachemark: {
    desc: '读本地缓存后误把 fetched 置真（启动即误报更新完成）',
    re: /([ \t]*)nextKeyMap = readJsonFile\('data\/memes\/keyMap\.json'\)/,
    to: "$1nextKeyMap = readJsonFile('data/memes/keyMap.json')\r\n$1fetched = true // mutant",
    kills: 'A5',
  },
  timeout: {
    desc: '移除请求超时信号（卡住时永久挂起）',
    re: /const res = await fetch\(url, \{ signal: timeoutSignal\(REQUEST_TIMEOUT\) \}\)/,
    to: 'const res = await fetch(url)',
    kills: 'K*（挂死，K 组不会出现）',
  },
  imgfallback: {
    desc: '回复存在时不再回退本条图（还原 else-if 取图）',
    re: /if \(imgUrls\.length < needImages && e\.img\?\.length\) \{/,
    to: 'if (!(e.source || e.reply_id) && e.img?.length) {',
    kills: 'L1/L3',
  },
  imgdownload: {
    desc: '图片下载回退到无超时无校验版本',
    re: /let imageResponse[\s\S]*?buffer = Buffer\.from\(await imageResponse\.arrayBuffer\(\)\)\r?\n          if \(buffer\.length > maxFileSizeByte\) \{[\s\S]*?\r?\n          \}\r?\n/,
    to: "const imageResponse = await fetch(imgUrl)\r\n          const ct = imageResponse.headers.get('content-type') || ''\r\n          mimeType = ct.split(';')[0] || mimeType\r\n          fileType = mimeType.split('/')[1] || 'jpeg'\r\n          buffer = Buffer.from(await imageResponse.arrayBuffer())\r\n",
    kills: 'M1/M2/M3',
  },
  cd: {
    desc: 'CD 回退到 GET→SET 非原子写法',
    re: /    const cdKey = `[\s\S]*?return false\r?\n    \}\r?\n/,
    to: "    const cdKey = `Yz:paimon_meme_cd:${e.group_id}:${e.sender.user_id || e.user_id}`\r\n    const lastTime = await redis.get(cdKey)\r\n    if (lastTime && !e.isFromPaimonChuo && !e.isMaster) return false\r\n    if (Config.meme_CD > 0) redis.set(cdKey, 1, { EX: Config.meme_CD })\r\n",
    kills: 'N1',
  },
  argfalsy: {
    desc: '枚举回退到 `valueMap[arg] || default`（吞掉合法值 0）',
    re: /argsObj\[prop\] = _\.has\(valueMap, trimmedArg\) \? valueMap\[trimmedArg\] : propInfo\.default;/,
    to: 'argsObj[prop] = valueMap[trimmedArg] || propInfo.default;',
    kills: 'O1',
  },
  argparse: {
    desc: '数字解析回退到只接受非负整数',
    re: /const numValue = trimmedArg === '' \? NaN : Number\(trimmedArg\);/,
    to: "const numValue = /^\\d+$/.test(trimmedArg) ? parseInt(trimmedArg) : NaN;",
    kills: 'O2',
  },
  argrange: {
    desc: '去掉 minimum/maximum 校验',
    re: /const inRange =\r?\n\s*\(minimum === undefined \|\| numValue >= minimum\) &&\r?\n\s*\(maximum === undefined \|\| numValue <= maximum\);/,
    to: 'const inRange = true;',
    kills: 'O3',
  },
  arghelp: {
    desc: '帮助文本回退到 truthy 过滤枚举值（吞掉值 0）',
    re: /opt\.action\?\.value !== undefined && opt\.dest === prop/g,
    to: 'opt.action?.value && opt.dest === prop',
    kills: 'O4',
  },
}

/**
 * 生成变异副本
 * @param {string} kind MUTATIONS 的键
 * @returns {string} 变异副本路径
 */
export function writeMutant(kind) {
  const mut = MUTATIONS[kind]
  if (!mut) throw new Error(`未知变异: ${kind}（可选: ${Object.keys(MUTATIONS).join('|')}）`)
  const src = fs.readFileSync(SRC, 'utf8')
  const mutated = src.replace(mut.re, mut.to)
  if (mutated === src) throw new Error(`变异未应用：没匹配到目标（${kind}），说明被测代码已改动`)
  fs.writeFileSync(DST, mutated)
  return DST
}

/** 删除变异副本（必须确认生效，否则会在 apps/ 下留垃圾） */
export function removeMutant() {
  if (!fs.existsSync(DST)) return false
  fs.unlinkSync(DST)
  return !fs.existsSync(DST)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, 'make-mutant.mjs')) {
  const kind = process.argv[2]
  if (!kind) {
    console.log(`用法: node test/meme/run.mjs --mutant <kind>\n可选: ${Object.keys(MUTATIONS).join(' | ')}`)
    process.exit(2)
  }
  console.log(`mutant[${kind}] ${MUTATIONS[kind].desc}\n  → 预期转红: ${MUTATIONS[kind].kills}`)
  writeMutant(kind)
}
