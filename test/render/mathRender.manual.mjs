#!/usr/bin/env node
// ============================================================
// 手动出图：同一份「Markdown 常见语法」文档，分别按【非主人】与【主人】两档渲染成图片
//
// 用途（不做断言、不是回归套件）：
//   1. 肉眼核对常见语法的观感（标题/列表/任务/表格/引用/代码块/Mermaid/公式/分隔线/图片）；
//   2. 看清"外链图片只有 Bot 主人能出"这条授权在真实产物上的差别；
//   3. 顺带确认三件必须成立的事：外链图片非主人 0 请求、两档都不发生自导航、危险载荷已被清洗。
//
// 回归与安全断言分别见：mathRender.check.mjs、mathRender.security.check.mjs
//
// 用法：
//   node test/render/mathRender.manual.mjs                                  自己 launch 浏览器
//   PUPPETEER_BROWSER_URL=http://127.0.0.1:9333 node test/render/mathRender.manual.mjs   连已启动的实例
//
// 产物：系统临时目录 mathRender-manual/ 下的两张 PNG（脚本会把路径打出来）。
// 注意：截图用 DPR 2（看观感用）；生产渲染器截元素时 DPR 恒为 1，成图尺寸只由 CSS 决定。
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import artTemplate from 'art-template'
import sharp from 'sharp'
import { openBrowser, closeBrowser, browserLabel } from './harnessBrowser.mjs'
import { stripActiveMarkup } from '../../utils/renderSanitize.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE, '../..')
const TEMPLATE = path.join(PLUGIN_DIR, 'resources/mathRender/index.html')
const RES_DIR = path.join(PLUGIN_DIR, 'resources')
const SHOT_DIR = path.join(os.tmpdir(), 'mathRender-manual')

// ---------- 探针：只服务一张真图，用来量"图片到底有没有加载" ----------
const PROBE_PNG = await sharp({
  create: { width: 240, height: 80, channels: 4, background: { r: 220, g: 60, b: 90, alpha: 1 } },
}).png().toBuffer()

async function startProbe () {
  const hits = Object.create(null)
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://127.0.0.1').pathname
    hits[p] = (hits[p] || 0) + 1
    if (p === '/probe.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PROBE_PNG.length })
      res.end(PROBE_PNG)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    hits,
    reset: () => { for (const k of Object.keys(hits)) delete hits[k] },
    close: () => new Promise((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
      setTimeout(resolve, 2000)
    }),
  }
}

/** 常见语法 + 三类危险载荷（后者在渲染前会被清洗） */
function commonSyntaxMarkdown (port) {
  const o = `http://127.0.0.1:${port}`
  return [
    '# 一级标题：Markdown 常见语法',
    '',
    '## 二级标题',
    '',
    '正文里的**加粗**、*斜体*、`行内代码`、[站内链接](https://docs.qq.com)，以及行内公式 $a^2+b^2=c^2$。',
    '',
    '### 三级标题 · 列表与任务',
    '',
    '- 无序项一',
    '- 无序项二',
    '  1. 嵌套有序项',
    '  2. 再来一个',
    '- [ ] 未完成任务',
    '- [x] 已完成任务',
    '',
    '### 表格（含 `br` 折行与公式）',
    '',
    '| 项目 | 说明 | 公式 |',
    '| --- | --- | --- |',
    '| 折行 | 第一行<br/>第二行 | $E=mc^2$ |',
    '| 长文本 | 这一格用来观察表格在容器里的折行表现 | $\\int_0^1 x^2 dx$ |',
    '',
    '### 代码块',
    '',
    '```js',
    'const list = items.filter((x) => x.ok)',
    'console.log(list.length)',
    '```',
    '',
    '### 引用块（含嵌套与引用内表格）',
    '',
    '> 引用第一段',
    '>',
    '> > 嵌套引用',
    '>',
    '> | 引用里的表格 | B |',
    '> | --- | --- |',
    '> | A | B |',
    '',
    '### 图表与块级公式',
    '',
    '```mermaid',
    'graph TD',
    '  A["开始"] --> B{"判断"}',
    '  B -->|"是"| C["结束"]',
    '```',
    '',
    '$$\\frac{1}{3} = \\int_0^1 x^2\\,dx$$',
    '',
    '### 外链图片（按授权分档）',
    '',
    `![markdown 语法图片](${o}/probe.png)`,
    '',
    `<img src="${o}/probe.png" width="120">`,
    '',
    '### 脚注外形（不支持，但不应变成假链接）',
    '',
    '引用[^note] 按原文显示。',
    '',
    '[^note]: 定义内容',
    '',
    '---',
    '',
    '### 危险载荷（渲染前会被清洗或阻断）',
    '',
    `<img src="${o}/missing-404.png" onerror="location.href='${o}/nav-onerror'">`,
    '',
    `<link rel="preconnect" href="${o}/preconnect">`,
    '',
    `<meta http-equiv="refresh" content="0;url=${o}/nav">`,
    '',
    '结尾段落。',
  ].join('\n')
}

function renderTemplate ({ markdown, title, allowRemoteImages }) {
  const html = artTemplate.render(fs.readFileSync(TEMPLATE, 'utf8'), {
    pluResPath: pathToFileURL(RES_DIR).href,
    title,
    markdown,
    allowRemoteImages,
  })
  if (/\{\{/.test(html)) throw new Error('模板渲染结果残留 {{，变量没被替换')
  return html
}

async function renderOne (browser, { key, label, markdown, allowRemoteImages }) {
  const html = renderTemplate({ markdown, title: `Markdown 常见语法（${label}）`, allowRemoteImages })
  const tmpHtml = path.join(os.tmpdir(), `mathRender-manual-${key}.html`)
  await fs.promises.writeFile(tmpHtml, html, 'utf8')

  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)))
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 })
  try {
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0', timeout: 20000 })
  } catch (e) {
    pageErrors.push(`goto: ${String((e && e.message) || e)}`)
  }
  await page.evaluate(() => document.fonts.ready)
  // Mermaid 是异步画的，等它真的出 SVG（它没画出来时下面的 mermaidSvg 会是 false）
  await page.waitForSelector('.mermaid svg', { timeout: 10000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 400))

  const facts = await page.evaluate(() => {
    const c = document.getElementById('content')
    const imgs = [...c.querySelectorAll('img')]
    return {
      url: location.href,
      navMarker: !!document.getElementById('nav-marker'),
      contentChildren: c.children.length,
      imgCount: imgs.length,
      imgLoaded: imgs.filter((i) => i.naturalWidth > 0).length,
      imgDims: imgs.map((i) => i.naturalWidth),
      katex: c.querySelectorAll('.katex').length,
      katexError: c.querySelectorAll('.katex-error').length,
      mermaidSvg: c.querySelectorAll('.mermaid svg').length,
      taskBox: c.querySelectorAll('.task-box').length,
      tableWrap: c.querySelectorAll('.table-wrap').length,
      blockquote: c.querySelectorAll('blockquote').length,
      hr: c.querySelectorAll('hr').length,
      bogusLink: [...c.querySelectorAll('a')].filter((a) => !/^https?:/.test(a.getAttribute('href') || '')).length,
    }
  })

  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const shot = path.join(SHOT_DIR, `markdown-${key}.png`)
  const el = await page.$('#container')
  await el.screenshot({ path: shot, type: 'png' })
  await page.close()

  return {
    facts,
    pageErrors,
    shot,
    sanitized: {
      metaRefresh: /<meta\s+http-equiv="refresh"/i.test(html),
      preconnect: /<link\b[^>]*(preconnect|dns-prefetch)/i.test(html),
      iframe: /<iframe\b/i.test(html),
    },
  }
}

;(async () => {
  console.log('=== 环境 ===')
  console.log(`平台   : ${process.platform} ${process.arch} / node ${process.version}`)
  console.log(`浏览器 : ${browserLabel()}`)

  const probe = await startProbe()
  console.log(`探针   : http://127.0.0.1:${probe.port}/probe.png（PNG ${PROBE_PNG.length} 字节）\n`)
  const browser = await openBrowser()

  const md = commonSyntaxMarkdown(probe.port)
  const results = []
  try {
    for (const mode of [
      { key: 'non-master', label: '非主人', allowRemoteImages: false },
      { key: 'master', label: '主人', allowRemoteImages: true },
    ]) {
      probe.reset()
      // 生产路径：工具先清洗，再按 e.isMaster 决定 allowRemoteImages
      const out = await renderOne(browser, { ...mode, markdown: stripActiveMarkup(md) })
      const row = { ...mode, ...out, hits: { ...probe.hits } }
      results.push(row)

      const f = out.facts
      console.log(`=== ${mode.label}（allowRemoteImages=${mode.allowRemoteImages}）===`)
      console.log(`  产物        : ${out.shot}`)
      console.log(`  外链请求    : ${JSON.stringify(row.hits)}`)
      console.log(`  图片        : 元素 ${f.imgCount} 个，加载成功 ${f.imgLoaded} 个（naturalWidth=${f.imgDims.join('/')}）`)
      console.log(`  自导航      : ${f.navMarker || !f.url.startsWith('file://') ? '发生了（异常！）' : '未发生'}`)
      console.log(`  清洗结果    : meta refresh=${out.sanitized.metaRefresh} preconnect=${out.sanitized.preconnect} iframe=${out.sanitized.iframe}`)
      console.log(`  Mermaid/公式: svg=${f.mermaidSvg} .katex=${f.katex} .katex-error=${f.katexError}`)
      console.log(`  其它结构    : 任务框=${f.taskBox} 表格包裹=${f.tableWrap} 引用块=${f.blockquote} 分隔线=${f.hr} 假链接=${f.bogusLink}`)
      console.log(`  页面异常    : ${out.pageErrors.length ? out.pageErrors.join('; ') : '无'}\n`)
    }
  } finally {
    await closeBrowser(browser)
    await probe.close()
  }

  const [nonMaster, master] = results
  console.log('=== 两档差别（本次要看的重点）===')
  console.log(`  外链图片加载成功数：非主人 ${nonMaster.facts.imgLoaded} / 主人 ${master.facts.imgLoaded}`)
  console.log(`  外链请求次数      ：非主人 ${Object.keys(nonMaster.hits).length} 个路径 / 主人 ${Object.keys(master.hits).length} 个路径`)
  console.log(`  共同结论          ：两档都未发生自导航，危险标签都已被清洗`)
  console.log('\nMANUAL RENDER DONE')
  process.exit(0)
})().catch((e) => {
  console.error('FAILED:', (e && e.stack) || e)
  process.exit(1)
})
