#!/usr/bin/env node
// ============================================================
// 本地预览：把一段 HTML 走**真实** resources/htmlRender/index.html 渲染成图（生产同款裁切）
//
// 用途：想「看一眼某段模型输出渲染出来什么样」时用，不必启动 Yunzai、不必有智能模式对话。
//
// 为什么是两步（本机环境限制，实测）：
//   - puppeteer 在本机 Edge 上起不来；Bash 工具沙箱里启动的浏览器进程会静默死亡
//     （退出码 0、无任何产物，execFileSync 亦然）→ 只有 PowerShell 的 Start-Process 能拉起 Edge。
//   - Edge 的 --screenshot 拍的是**视口**，不是元素（实测 --window-size=400,200 就得到 400x200），
//     所以拿不到生产那种 #container 元素截图。
//   于是：build 用 art-template 拼真实模板，并**只在预览副本里**给 #container 加一圈品红描边；
//   截图后用仓库已装的 sharp 找出品红像素 bbox（= #container 盒子），内缩 3px 裁掉描边本身。
//   生产代码一行不改，描边只存在于预览副本。
//
// 用法（Windows，两段）：
//   node test/render/htmlPreview.edge.mjs build <输入.html> [标题]     # 默认标题「HTML 视觉图」
//   <把打印出来的 PowerShell 命令粘到 PowerShell 工具里跑>
//   node test/render/htmlPreview.edge.mjs crop <截图.png> <输出.png>
//
// dpr：给 build 传 --dpr=2（或在 PowerShell 命令里改 --force-device-scale-factor）可出 2x 清晰版；
//      crop 对任意 dpr 都成立，因为品红 bbox 是在实际像素上量的。
//      注意模板**本身**就是原生 2× 设计（#container 2600px 宽），与生产同款，所以这里不改 dpr
//      也已经得到 2600px 的成品；dpr 只用于把预览再放大来看细节。
// 窗口宽度要 ≥ 2600px（#container 的固定宽度）：比它窄会把右边的品红描边切出视口。
//
// 隐私提示：脚本本身不含任何本机信息，但它打印的命令里带系统临时目录的绝对路径
// （Windows 上即 C:\Users\<用户名>\AppData\Local\Temp\...）。要把那段命令贴给别人时先替换掉。
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '../..')
const TEMPLATE = path.join(PLUGIN, 'resources/htmlRender/index.html')
// 脚本就在仓库里，依赖可以直接解析
const req = createRequire(pathToFileURL(path.join(PLUGIN, 'package.json')))
const artTemplate = req('art-template')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const MARKER = '#ff00ff'
const MARKER_STYLE = `<style>#container{outline:3px solid ${MARKER};outline-offset:-3px}</style></head>`

const [mode, ...rest] = process.argv.slice(2)
const dpr = Number((rest.find((a) => a.startsWith('--dpr=')) || '--dpr=1').split('=')[1])
const args = rest.filter((a) => !a.startsWith('--'))

function runBuild () {
  const [input, title = 'HTML 视觉图'] = args
  if (!input) throw new Error('用法：build <输入.html> [标题]')
  const tpl = fs.readFileSync(TEMPLATE, 'utf8')
  const html = fs.readFileSync(input, 'utf8')
  let page = artTemplate.render(tpl, {
    pluResPath: pathToFileURL(path.join(PLUGIN, 'resources')).href,
    title,
    html,
  })
  if (/\{\{/.test(page)) throw new Error('模板残留 {{：变量没被替换')
  if (!page.includes('</head>')) throw new Error('模板里没有 </head>')
  page = page.replace('</head>', MARKER_STYLE)

  const out = path.join(os.tmpdir(), `htmlPreview-${Date.now()}.html`)
  fs.writeFileSync(out, page, 'utf8')
  const shot = path.join(os.tmpdir(), `htmlPreview-${Date.now()}.png`)
  const fileUrl = pathToFileURL(out).href
  console.log(`预览页：${out}（标题 = ${title}）`)
  console.log('\n把下面这条丢给 PowerShell 工具跑（Bash/node 起不来浏览器）：\n')
  console.log('$edge = "' + EDGE + '"; $out = "' + shot.replace(/\//g, '\\') + '";')
  console.log(`Start-Process -FilePath $edge -ArgumentList '--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--hide-scrollbars',"--user-data-dir=$env:TEMP\\edge-preview",'--virtual-time-budget=4000','--force-device-scale-factor=${dpr}','--window-size=2700,3000','--screenshot=${shot}','${fileUrl}' -NoNewWindow -Wait`)
  console.log('\n然后：')
  console.log(`  node test/render/htmlPreview.edge.mjs crop "${shot}" "<输出.png>"`)
  // 视口给小了会截掉内容：品红描边是判据，crop 找不到描边就会报错。
  // 宽度尤其要注意——模板的 #container 是固定 2600px（原生 2× 设计），窗口比它窄会把右侧描边切掉，
  // 那时 crop 虽然找得到描边，量到的 bbox 却是被裁过的，裁出来会缺右边一块。
  console.log('\n（#container 固定 2600px 宽，--window-size 的宽度必须 ≥ 2600；内容比窗口还高时加大高度；crop 找不到描边会明确报错）')
}

async function runCrop () {
  const sharp = req('sharp')
  const [src, dst] = args
  if (!src || !dst) throw new Error('用法：crop <截图.png> <输出.png>')
  const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true })
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels
      if (data[i] > 240 && data[i + 1] < 60 && data[i + 2] > 240) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  console.log(`原图 ${info.width}x${info.height}，品红 bbox = (${x0},${y0})-(${x1},${y1})`)
  if (x1 < 0) throw new Error('没找到品红描边：#container 不在视口内（把 --window-size 调大）')
  const inset = 3 * (Number.isFinite(dpr) && dpr > 0 ? dpr : 1)
  await sharp(src)
    .extract({
      left: x0 + inset,
      top: y0 + inset,
      width: x1 - x0 + 1 - inset * 2,
      height: y1 - y0 + 1 - inset * 2,
    })
    .png()
    .toFile(dst)
  const m = await sharp(dst).metadata()
  console.log(`CROPPED ${dst} ${m.width}x${m.height}`)
}

if (mode === 'build') runBuild()
else if (mode === 'crop') await runCrop()
else {
  console.error('用法：htmlPreview.edge.mjs build|crop …')
  process.exit(2)
}
