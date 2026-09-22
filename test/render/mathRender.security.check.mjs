#!/usr/bin/env node
// ============================================================
// mathRender 模板的「渲染前清洗 + CSP」安全用例（真实浏览器 + 本地探针服务器）
//
// 用法：
//   node test/render/mathRender.security.check.mjs
//   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node ...
//
// 靶子是三条互相独立的能力，混在一起就说不清是哪一层在挡：
//   A. 联网：正文里的 <img src="http://…"> 与 CSS url(http://…) 会让 Bot 主机的 Chromium
//      真的去发请求（内网探测 / 追踪像素 / 把任意图当渲染图发出去）
//   B. 导航：<meta http-equiv="refresh"> 能让渲染页自己跳到外站，而渲染器用的是
//      `waitUntil: 'networkidle0'`，会把**对方页面**等加载完再截下来
//   C. 授权：只有 Bot 主人才能出带外链图片的图（工具按 e.isMaster 传 allowRemoteImages）
//
// 断言纪律：每条"应该被挡住"的断言都配了对照，证明它不是碰巧绿：
//   - 生产路径（工具实际会渲染的数据）分主人/非主人两组，主人那组必须**真的加载到图**，
//     否则"非主人 0 请求"可能只是因为探针根本没被正确指向；
//   - 对照 4 摘掉 CSP：同样的数据必须真的发起请求 → 证明非主人组的 0 是 CSP 造成的；
//   - 对照 1/5 故意不清洗：meta refresh **必须真的把页面导航走**。这条同时是三件事的证据：
//     漏洞真实存在、探针确实能观测到攻击、以及"CSP 拦不住导航、必须靠删标签"这个判断成立。
//     所以工具侧一旦漏调 stripActiveMarkup，本套件必红。
//
// 只在生产路径（用例 2、3）断言"页面无未捕获异常"，用来证明新加的 CSP 没把渲染器本身打死
// （markdown-it / KaTeX / Mermaid 都走 script-src file:，一旦策略写错，这里最先炸）。
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import artTemplate from 'art-template'
import sharp from 'sharp'
// 浏览器引导（连已启动实例 / 自己 launch）与 mathRender.check.mjs 共用同一份实现
import { openBrowser, closeBrowser, browserLabel } from './harnessBrowser.mjs'
// 生产实现的清洗函数：用例里的"生产路径"必须用它，不能在测试里另写一份（否则测的是测试自己）
import { stripActiveMarkup } from '../../utils/renderSanitize.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE, '../..')
const YUNZAI_ROOT = path.resolve(HERE, '../../../..')
const TEMPLATE = path.join(PLUGIN_DIR, 'resources/mathRender/index.html')
const RES_DIR = path.join(PLUGIN_DIR, 'resources')

// 探针图片现场生成（不复用 test/render/fixtures/wide.png：那个 fixture 在当前检出里并不存在，
// 既有套件因此一直在跳过图片用例）。用真图才能量 naturalWidth，从而证明"主人路径下图片确实加载成功"。
const PROBE_PNG = await sharp({
  create: { width: 16, height: 16, channels: 4, background: { r: 220, g: 40, b: 60, alpha: 1 } },
}).png().toBuffer()

const results = []
function check (name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  —— ' + detail : ''}`)
}

// ---------- 探针服务器：按路径计数，并单独统计 TCP 连接 ----------
// 单独统计连接是必要的：<link rel="preconnect"> 只建连、不发请求，只看 request 事件会漏掉它。
async function startProbe () {
  const hits = Object.create(null)
  let connections = 0
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://127.0.0.1').pathname
    hits[p] = (hits[p] || 0) + 1
    if (p === '/nav') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!DOCTYPE html><html><body><div id="nav-marker">NAVIGATED</div></body></html>')
      return
    }
    if (p === '/evil.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' })
      res.end('document.title = "EVIL-JS-RAN"')
      return
    }
    if (p.endsWith('.png') && !/404|missing/.test(p)) {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PROBE_PNG.length })
      res.end(PROBE_PNG)
      return
    }
    // 未识别的路径一律 404：载荷里那条 onerror 向量必须**加载失败**才会触发处理器，
    // 否则"处理器没触发"只是因为图片成功了（那是假绿）
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })
  server.on('connection', () => { connections++ })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    hits,
    stats: () => ({ connections }),
    reset: () => { for (const k of Object.keys(hits)) delete hits[k]; connections = 0 },
    close: () => new Promise((resolve) => {
      // 必须主动断开存量连接：`server.close()` 只等新连接停下，已经建起来的 keep-alive 连接
      // 会让回调永远不触发（被导航/建连的用例跑完时就是这样，套件会在收尾处挂死）
      server.closeAllConnections()
      server.close(() => resolve())
      setTimeout(resolve, 2000)
    }),
  }
}

const count = (hits, prefix) => Object.entries(hits)
  .filter(([k]) => k.startsWith(prefix))
  .reduce((n, [, v]) => n + v, 0)

// ---------- 攻击载荷 ----------
// 覆盖用户报告里的两条，外加同类：CSS url()、markdown 图片语法（无法靠删标签解决，只能靠 CSP）、
// 行内事件处理器（受 script-src 约束）、preconnect（连接提示）、base（改写相对 URL 基准）。
function hostileMarkdown (port) {
  const o = `http://127.0.0.1:${port}`
  return [
    '## 探针文档',
    '',
    '正文内容，用来确认页面本身还渲染得出来。',
    '',
    `<img src="${o}/raw-img.png" width="120">`,
    '',
    `![markdown 图片](${o}/md-img.png)`,
    '',
    `<div style="height:60px;background:url('${o}/css-bg.png')">CSS url 探针</div>`,
    '',
    `<img src="${o}/missing-404.png" onerror="location.href='${o}/nav-onerror'">`,
    '',
    `<iframe src="${o}/iframe"></iframe>`,
    '',
    `<script src="${o}/evil.js"></script>`,
    '',
    `<link rel="preconnect" href="${o}/preconnect">`,
    '',
    `<base href="${o}/base/">`,
    '',
    `<meta http-equiv="refresh" content="0;url=${o}/nav">`,
    '',
    '结尾段落。',
  ].join('\n')
}

// 单向量载荷：只留"图片加载失败 → onerror 里导航"这一条，用来把 script-src 对**行内事件处理器**的
// 约束单独钉住。混在完整载荷里说不清是谁触发的——meta refresh 的 content=0 会先抢跑导航走。
function onerrorOnlyMarkdown (port) {
  return `<img src="http://127.0.0.1:${port}/missing-404.png" onerror="location.href='http://127.0.0.1:${port}/nav-onerror'">`
}

/**
 * 载荷能力矩阵：把"危险"拆成四条可判定的能力——**自导航 / 主动联网 / 执行代码 / 读本地文件**——
 * 每类放一个最小向量，用来逐条量清楚"到底被哪一层挡住"，而不是凭"我们配了 CSP"下结论。
 * 向量特意覆盖容易出现假绿的地方：本地 file:// 资源、`@import`、外部 `<use>`、媒体、表单、
 * javascript: 链接、以及 `<script src>` 指向**本地 .js**（`script-src file:` 是放行本地的，
 * 这一条只能靠清洗，必须单独钉住）。
 */
function capabilityPayload (port, sentinelUrl, localPngUrl) {
  const o = `http://127.0.0.1:${port}`
  return [
    '## 载荷能力矩阵',
    '',
    `![markdown 语法引用本地文件](${localPngUrl})`,
    '',
    `<img id="local-img" src="${localPngUrl}" width="40">`,
    '',
    `<video id="v" src="${o}/media.mp4" controls width="80"></video>`,
    '',
    `<audio id="a" src="${o}/media.mp3"></audio>`,
    '',
    `<style>@import url("${o}/imp.css"); .markdown-body{ --text-color:#4a3735; }</style>`,
    '',
    `<svg width="60" height="20"><use href="${o}/use.svg#a"></use></svg>`,
    '',
    `<form action="${o}/form" method="get"><input name="a" value="1"><button type="submit">提交</button></form>`,
    '',
    `<a id="js-link" href="javascript:location.href='${o}/js-link'">点我</a>`,
    '',
    `<script src="${sentinelUrl}"></script>`,
    '',
    `<img id="data-img" src="data:image/png;base64,${PROBE_PNG.toString('base64')}">`,
  ].join('\n')
}

// ---------- 渲染一份模板（与生产同路径：art-template 转义，再 file:// 打开） ----------
function renderTemplate ({ markdown, allowRemoteImages }) {
  const html = artTemplate.render(fs.readFileSync(TEMPLATE, 'utf8'), {
    pluResPath: pathToFileURL(RES_DIR).href,
    title: '安全用例',
    markdown,
    allowRemoteImages,
  })
  if (/\{\{/.test(html)) throw new Error('模板渲染结果残留 {{，变量没被替换')
  return html
}

function extractCsp (html) {
  const m = /<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i.exec(html)
  if (!m) return null
  // art-template 的 {{}} 默认做 HTML 转义（' → &#39;），属性值在浏览器里会被解码回来，
  // 这里同样解码后再断言，避免把"转义"误判成"策略不对"
  return m[1]
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

async function loadInBrowser (browser, html, { name, stripCsp = false, click = null } = {}) {
  if (stripCsp) html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '')
  const tmpHtml = path.join(os.tmpdir(), `mathRender-security-${name}.html`)
  await fs.promises.writeFile(tmpHtml, html, 'utf8')

  const started = Date.now()
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)))
  try {
    // 与生产一致的等待策略（common.js 把 pageGotoParams 设成 networkidle0）：正因为它是
    // networkidle0，meta refresh 才危险——它会等"对方页面"加载完再让渲染器截图。
    // 但超时收紧到 15s：被导航走的用例里，goto 等的是**原来那次导航**的生命周期，
    // 已经回不来了，用生产默认的 60s/120s 只会在测试里白等（断言本身不依赖 goto 是否 resolve）。
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0', timeout: 15000 })
  } catch (e) {
    // 触发 refresh 导航时 goto 可能因 frame detached 等超时抛错，这不是失败，继续看落地状态
    pageErrors.push(`goto: ${String((e && e.message) || e)}`)
  }
  await new Promise((r) => setTimeout(r, 800))
  // javascript: 链接这类向量必须靠"点一下"才会触发（headless 里没有用户点击），
  // 所以对照组要显式点它，否则"没导航"只证明没人点，不证明策略在挡
  if (click) {
    try {
      await page.click(click)
      await new Promise((r) => setTimeout(r, 600))
    } catch (e) {
      pageErrors.push(`click(${click}): ${String((e && e.message) || e)}`)
    }
  }
  const facts = await page.evaluate(() => ({
    url: location.href,
    navMarker: !!document.getElementById('nav-marker'),
    contentChildren: document.getElementById('content') ? document.getElementById('content').children.length : -1,
    contentText: document.getElementById('content') ? document.getElementById('content').textContent.slice(0, 40) : '',
    // 图片元素是否存在 + 有没有真的解码出像素：两条一起看才能区分
    // "内容里没有 img"（内容坏了）和 "img 在但被策略挡住了"（策略生效）
    imgCount: document.querySelectorAll('#content img').length,
    imgNatural: [...document.querySelectorAll('#content img')].reduce((n, i) => Math.max(n, i.naturalWidth), 0),
    // 能力矩阵用的细粒度事实
    localImgNatural: document.getElementById('local-img') ? document.getElementById('local-img').naturalWidth : -1,
    dataImgNatural: document.getElementById('data-img') ? document.getElementById('data-img').naturalWidth : -1,
    videoError: document.getElementById('v') ? !!document.getElementById('v').error : null,
    audioError: document.getElementById('a') ? !!document.getElementById('a').error : null,
    svgUse: document.querySelectorAll('#content use').length,
    formCount: document.querySelectorAll('#content form').length,
    scriptTags: document.querySelectorAll('#content script').length,
    sentinelRan: window.__sentinelRan === true,
    title: document.title,
  }))
  await page.close()
  // 每个用例的落地状态与耗时都打出来：套件变慢时（例如被导航走的用例要等 goto 超时）
  // 能直接从日志看出卡在哪个用例，而不是只看总时长
  console.log(`  [${name}] ${((Date.now() - started) / 1000).toFixed(1)}s → ${facts.url}${facts.navMarker ? ' (已导航走)' : ''}`)
  return { facts, pageErrors }
}

// ---------- 工具侧接线：func() 实际送给渲染器的数据长什么样 ----------
// 渲染器用真实套件起不来（本机 puppeteer 没下载 Chromium），所以只把 renderer.screenshot 换成
// 捕获函数——拿到的是**生产代码真正传给渲染器的 data**，再交给上面的浏览器用例去跑。
async function captureToolPayload () {
  if (!fs.existsSync(path.join(process.cwd(), 'config/default_config')) && fs.existsSync(path.join(YUNZAI_ROOT, 'config/default_config'))) {
    process.chdir(YUNZAI_ROOT)
  }
  globalThis.logger = {
    info () { }, warn () { }, error () { }, mark () { }, debug () { },
    green: (s) => s, red: (s) => s, yellow: (s) => s,
  }
  globalThis.redis = { get: async () => null, set: async () => null, del: async () => null }
  globalThis.segment = { image: (x) => x }
  globalThis.Bot = {}
  globalThis.Renderer = {}

  const rendererModule = await import('../../../../lib/puppeteer/puppeteer.js')
  const captured = []
  rendererModule.default.screenshot = async (name, data) => {
    captured.push({ name, data })
    return 'data:image/png;base64,captured'
  }

  const { GenerateMathRenderTool } = await import('../../utils/tools/GenerateMathRenderTool.js')
  const tool = new GenerateMathRenderTool()
  const call = async (isMaster) => {
    const e = { isMaster, reply: async () => true }
    const ret = await tool.func({ title: 'T', markdown: hostileMarkdown(1) }, e)
    return { ret, last: captured[captured.length - 1] }
  }
  return {
    nonMaster: await call(false),
    master: await call(true),
    anonymous: await call(undefined),
  }
}

;(async () => {
  console.log('=== 环境 ===')
  console.log(`平台   : ${process.platform} ${process.arch} / node ${process.version}`)
  console.log(`浏览器 : ${browserLabel()}`)
  console.log(`探针图 : sharp 现场生成的 PNG（${PROBE_PNG.length} 字节）\n`)

  const probe = await startProbe()
  console.log(`探针服务器：http://127.0.0.1:${probe.port}\n`)
  const browser = await openBrowser()

  try {
    // ---------- 策略本身（字符串级，便宜且能钉住模板回归） ----------
    console.log('=== 用例 0：CSP 是否按授权分档（且默认严格）===')
    const htmlStrict = renderTemplate({ markdown: 'a', allowRemoteImages: false })
    const htmlMaster = renderTemplate({ markdown: 'a', allowRemoteImages: true })
    const cspStrict = extractCsp(htmlStrict)
    const cspMaster = extractCsp(htmlMaster)
    const imgSrcOf = (csp) => (csp ? (csp.split(';').find((s) => s.includes('img-src')) || '').trim() : '(没有 CSP)')
    check('模板里确实有 CSP meta，且能取到内容', !!cspStrict && cspStrict.length > 0, String(cspStrict).slice(0, 60))
    check('CSP 在 <head> 内、且位于所有子资源之前',
      htmlStrict.indexOf('Content-Security-Policy') > 0
      && htmlStrict.indexOf('Content-Security-Policy') < htmlStrict.indexOf('katex.min.css')
      && htmlStrict.indexOf('Content-Security-Policy') < htmlStrict.indexOf('<body>'),
      `cspAt=${htmlStrict.indexOf('Content-Security-Policy')} katexAt=${htmlStrict.indexOf('katex.min.css')}`)
    check('默认（未显式授权）img-src 只有 data:，没有任何 http/https',
      /img-src data:/.test(imgSrcOf(cspStrict)) && !/http/.test(imgSrcOf(cspStrict)), imgSrcOf(cspStrict))
    check('显式授权后 img-src 才追加 http:/https:',
      /img-src data:\s*http:\s*https:/.test(imgSrcOf(cspMaster)), imgSrcOf(cspMaster))
    check('script-src 里没有 unsafe-inline（否则内容里的 onerror= 行内处理器会活过来）',
      /script-src file:/.test(cspStrict) && !/script-src[^;]*unsafe-inline/.test(cspStrict),
      (cspStrict.split(';').find((s) => s.includes('script-src')) || '').trim())
    check('default-src 为 none（漏列的资源类型一律拒绝）', /default-src 'none'/.test(cspStrict))
    check('导航相关的兜底在（base-uri / form-action / frame-src / object-src）',
      /base-uri 'none'/.test(cspStrict) && /form-action 'none'/.test(cspStrict)
      && /frame-src 'none'/.test(cspStrict) && /object-src 'none'/.test(cspStrict))

    // ---------- 对照组 1：故意不清洗 + 有 CSP ----------
    console.log('\n=== 用例 1（对照/攻击面）：不清洗时 CSP 挡得住请求、挡不住导航 ===')
    probe.reset()
    const raw = await loadInBrowser(browser, renderTemplate({ markdown: hostileMarkdown(probe.port), allowRemoteImages: false }), { name: 'raw-csp' })
    check('CSP 确实拦住了外链图片与 CSS url()（含 markdown 图片语法）',
      count(probe.hits, '/raw-img') + count(probe.hits, '/md-img') + count(probe.hits, '/css-bg') === 0,
      JSON.stringify(probe.hits))
    check('CSP 拦不住 <meta http-equiv="refresh">：页面自己导航走了（所以这条必须靠删标签）',
      raw.facts.navMarker === true || /\/nav$/.test(raw.facts.url),
      `url=${raw.facts.url}`)

    // 上面那条断言不能顺带证明"行内事件处理器也被挡住了"：meta refresh 会先抢跑，
    // 说不清导航是谁触发的。单独用一条只含 onerror 的载荷来钉 script-src。
    console.log('\n=== 用例 1b（对照/攻击面）：单向量 onerror —— CSP 在场时行内处理器不执行 ===')
    probe.reset()
    const rawOnerror = await loadInBrowser(browser, renderTemplate({ markdown: onerrorOnlyMarkdown(probe.port), allowRemoteImages: false }), { name: 'raw-onerror-csp' })
    check('CSP 在场时 onerror 未触发导航（script-src 不含 unsafe-inline）',
      count(probe.hits, '/nav-onerror') === 0 && rawOnerror.facts.url.startsWith('file://'),
      `url=${rawOnerror.facts.url} hits=${JSON.stringify(probe.hits)}`)

    // ---------- 对照 5：故意不清洗 + 摘掉 CSP（证明上面那些"拦住了"不是空断言） ----------
    console.log('\n=== 用例 5（对照）：不清洗 + 摘掉 CSP 时，请求必须真的发生 ===')
    probe.reset()
    const rawNoCsp = await loadInBrowser(browser, renderTemplate({ markdown: hostileMarkdown(probe.port), allowRemoteImages: false }), { name: 'raw-nocsp', stripCsp: true })
    check('摘掉 CSP 后外链图片 / CSS url() 真的被请求了（说明用例 1/2 的 0 是策略造成的）',
      count(probe.hits, '/raw-img') + count(probe.hits, '/md-img') + count(probe.hits, '/css-bg') > 0,
      JSON.stringify(probe.hits))
    check('摘掉 CSP 后 preconnect 真的建了连接（说明连接提示不受其它指令约束）',
      probe.stats().connections > 0, `connections=${probe.stats().connections}`)

    console.log('\n=== 用例 5b（对照）：同一个单向量 onerror，摘掉 CSP 后必须真的导航走 ===')
    probe.reset()
    const ctrlOnerror = await loadInBrowser(browser, renderTemplate({ markdown: onerrorOnlyMarkdown(probe.port), allowRemoteImages: false }), { name: 'raw-onerror-nocsp', stripCsp: true })
    check('摘掉 CSP 后 onerror 真的触发了导航（证明 1b/2/3 的"没导航"是 script-src 在挡，不是碰巧）',
      count(probe.hits, '/nav-onerror') > 0 || ctrlOnerror.facts.url.includes('/nav-onerror'),
      `url=${ctrlOnerror.facts.url} hits=${JSON.stringify(probe.hits)}`)

    // ---------- 生产路径（非主人）：工具清洗后的数据 ----------
    console.log('\n=== 用例 2（生产路径 · 非主人）：零请求、零导航、内容照常渲染 ===')
    // 生产路径 = 工具实际会送进模板的东西：先清洗，再按 e.isMaster 决定 allowRemoteImages
    const safeMd = stripActiveMarkup(hostileMarkdown(probe.port))
    const htmlProdStrict = renderTemplate({ markdown: safeMd, allowRemoteImages: false })
    probe.reset()
    const nonMaster = await loadInBrowser(browser, htmlProdStrict, { name: 'clean-nomaster' })
    check('清洗后的 HTML 里没有 meta refresh / preconnect / base（只剩模板自己的资源标签）',
      !/<meta\s+http-equiv="refresh"/i.test(htmlProdStrict)
      && !/<link\b[^>]*(preconnect|dns-prefetch)/i.test(htmlProdStrict)
      && !/<base\b/i.test(htmlProdStrict))
    check('非主人：探针一个 HTTP 请求都没收到', Object.keys(probe.hits).length === 0, JSON.stringify(probe.hits))
    check('非主人：连 TCP 连接都没有（preconnect 是 CSP 管不到的，必须靠删标签）',
      probe.stats().connections === 0, `connections=${probe.stats().connections}`)
    check('非主人：页面没有被导航走', nonMaster.facts.url.startsWith('file://') && nonMaster.facts.navMarker === false, `url=${nonMaster.facts.url}`)
    check('非主人：正文仍然渲染出来了（没把内容一起删空）',
      nonMaster.facts.contentChildren > 0 && nonMaster.facts.contentText.includes('探针文档'),
      `children=${nonMaster.facts.contentChildren} text=${JSON.stringify(nonMaster.facts.contentText)}`)
    check('非主人：图片元素在内容里、但一张都没解码出像素（是被策略挡的，不是内容里没图）',
      nonMaster.facts.imgCount > 0 && nonMaster.facts.imgNatural === 0,
      `img=${nonMaster.facts.imgCount} naturalWidth=${nonMaster.facts.imgNatural}`)
    check('非主人：页面无未捕获 JS 异常（CSP 没把渲染器打死）', nonMaster.pageErrors.length === 0, nonMaster.pageErrors.join('; '))

    // ---------- 生产路径（主人）：图片能加载，但依然不能导航 ----------
    console.log('\n=== 用例 3（生产路径 · 主人）：能出带外链图片的图，但依旧不能自导航 ===')
    probe.reset()
    const master = await loadInBrowser(browser, renderTemplate({ markdown: safeMd, allowRemoteImages: true }), { name: 'clean-master' })
    check('主人：外链图片真的被请求到了（证明上面的 0 不是因为探针指错地方）',
      count(probe.hits, '/raw-img') + count(probe.hits, '/md-img') > 0, JSON.stringify(probe.hits))
    check('主人：图片进入渲染结果（naturalWidth > 0，功能没被误伤）',
      master.facts.imgNatural > 0, `img=${master.facts.imgCount} naturalWidth=${master.facts.imgNatural}`)
    check('主人：onerror 仍然被 script-src 挡住', count(probe.hits, '/nav-onerror') === 0, `url=${master.facts.url}`)
    check('主人：页面没有被导航走', master.facts.url.startsWith('file://') && master.facts.navMarker === false, `url=${master.facts.url}`)
    check('主人：页面无未捕获 JS 异常', master.pageErrors.length === 0, master.pageErrors.join('; '))

    // ---------- 对照 4：非主人 + 摘掉 CSP ----------
    console.log('\n=== 用例 4（对照）：同一个非主人数据，摘掉 CSP 后图片必须加载得起来 ===')
    probe.reset()
    const ctrl = await loadInBrowser(browser, renderTemplate({ markdown: safeMd, allowRemoteImages: false }), { name: 'clean-nomaster-nocsp', stripCsp: true })
    // 这一条只做"授权确实由 CSP 执行"的对照：摘掉 CSP，同一份非主人数据里的图片就会被请求。
    // 不在这里断言"没被导航走"——清洗不删 onerror 属性（那是故意的，见 utils/renderSanitize.js 的取舍），
    // 所以去掉 CSP 后行内处理器本来就会导航走。反过来也说明导航防护**不能只靠清洗**，
    // 是删除导航类标签 + script-src 不含 unsafe-inline 两条一起兜住的。这里只把观测打出来。
    check('摘掉 CSP 后非主人数据里的图片被请求了（授权判定确实由 CSP 执行）',
      count(probe.hits, '/raw-img') + count(probe.hits, '/md-img') > 0, JSON.stringify(probe.hits))
    console.log(`  [观测] 摘掉 CSP 后同一份数据${ctrl.facts.url.includes('/nav-onerror') ? '被 onerror 导航走了（行内处理器的防护由 script-src 承担）' : '没有被导航走'}`)

    // ---------- 用例 7：载荷能力矩阵 ----------
    // 把"危险"拆成四条可判定的能力：自导航 / 主动联网 / 执行代码 / 读本地文件。
    // 每条都给最小向量，并配一个"不清洗 + 摘掉 CSP"的对照，证明这些向量真的能造成后果。
    console.log('\n=== 用例 7：载荷能力矩阵（哪一层挡住哪一类能力）===')
    const localPng = path.join(os.tmpdir(), 'mathRender-security-local.png')
    await fs.promises.writeFile(localPng, PROBE_PNG)
    const sentinel = path.join(os.tmpdir(), 'mathRender-security-sentinel.js')
    await fs.promises.writeFile(sentinel, 'window.__sentinelRan = true;\n', 'utf8')
    const capMd = capabilityPayload(probe.port, pathToFileURL(sentinel).href, pathToFileURL(localPng).href)
    const capProd = renderTemplate({ markdown: stripActiveMarkup(capMd), allowRemoteImages: false })
    const capRaw = renderTemplate({ markdown: capMd, allowRemoteImages: false })

    probe.reset()
    const cap = await loadInBrowser(browser, capProd, { name: 'capability-prod', click: '#js-link' })
    check('读本地：file:// 图片一张都不加载（任何档位的 img-src 都没有 file:）',
      cap.facts.localImgNatural === 0, `naturalWidth=${cap.facts.localImgNatural}`)
    check('正向对照：data: 图片正常加载（CSP 不是"什么都挡"）',
      cap.facts.dataImgNatural > 0, `naturalWidth=${cap.facts.dataImgNatural}`)
    check('联网：<video> / <audio> 未发起请求，且元素处于错误态（media-src none）',
      cap.facts.videoError === true && cap.facts.audioError === true && !probe.hits['/media.mp4'] && !probe.hits['/media.mp3'],
      `videoError=${cap.facts.videoError} audioError=${cap.facts.audioError} hits=${JSON.stringify(probe.hits)}`)
    check('联网：CSS @import 未发起请求（style-src 只放行 file: 与内联样式）',
      !probe.hits['/imp.css'], JSON.stringify(probe.hits))
    check('联网：外部 SVG <use> 未发起请求（跨源 use 在 Chromium 里本就不被支持，CSP 是第二道；这里只钉"元素在、请求无"）',
      !probe.hits['/use.svg'] && cap.facts.svgUse === 1, `use=${cap.facts.svgUse} hits=${JSON.stringify(probe.hits)}`)
    check('执行代码：<script> 标签已被清洗删除', cap.facts.scriptTags === 0, `script=${cap.facts.scriptTags}`)
    // "<script> 能不能执行"是三层叠加的，必须分清谁在起作用（对照实测得出）：
    //   ① 模板把 markdown-it 的输出用 `contentDiv.innerHTML = ...` 写进 DOM，**按 HTML 规范，
    //      这样插入的 <script> 既不执行、也不发起请求**——对照用例里不清洗 + 摘掉 CSP，
    //      哨兵仍然没跑、探针也没收到对它的请求，说明这一层就把它按住了；
    //   ② script-src 不含 'unsafe-inline'，挡住行内脚本与 `onerror=` 这类行内事件处理器；
    //   ③ 清洗把 <script> 整类删掉，连痕迹都不留。
    // 下面这条只断言"没执行"这个结果；原因归因见对照用例。
    check('执行代码：本地 .js 哨兵未执行（三层叠加的结果，归因见对照用例）',
      cap.facts.sentinelRan === false, `__sentinelRan=${cap.facts.sentinelRan}`)
    check('导航：点击 javascript: 链接后仍在本地页（script-src 挡住 javascript: URL）',
      cap.facts.url.startsWith('file://') && !probe.hits['/js-link'],
      `url=${cap.facts.url} hits=${JSON.stringify(probe.hits)}`)
    check('用例 7 生产路径页面无未捕获异常', cap.pageErrors.length === 0, cap.pageErrors.join('; '))

    // 表单必须"点提交"才会走，所以单独跑一次带点击的用例，才有资格说"被 form-action 挡住"
    probe.reset()
    const capForm = await loadInBrowser(browser, capProd, { name: 'capability-prod-form', click: '#content form button' })
    check('联网：点提交后表单没有提交出去（form-action none），页面也没被导航走',
      !probe.hits['/form'] && capForm.facts.url.startsWith('file://'),
      `url=${capForm.facts.url} hits=${JSON.stringify(probe.hits)}`)

    // 对照 A：不清洗 + 摘掉 CSP，且**不点击**——一旦页面被导航走，evaluate 读到的就是新文档，
    // 哨兵执行与否再也读不到了（实测踩过：先点后读 → `__sentinelRan=false` 的假红）
    probe.reset()
    const capCtl = await loadInBrowser(browser, capRaw, { name: 'capability-raw', stripCsp: true })
    check('对照：本地哨兵 .js 哪怕不清洗、摘掉 CSP 也没执行（innerHTML 插入的 script 按规范不执行，这是第一层）',
      capCtl.facts.sentinelRan === false, `__sentinelRan=${capCtl.facts.sentinelRan}`)
    check('对照：媒体与 @import 都真的发了请求（证明探针能观测到这一类能力）',
      !!(probe.hits['/media.mp4'] && probe.hits['/media.mp3'] && probe.hits['/imp.css']), JSON.stringify(probe.hits))

    // 对照 B：单独一次加载来点 javascript: 链接（点击会导航，不能和上面的执行断言共用一次加载）
    probe.reset()
    const capCtlJs = await loadInBrowser(browser, capRaw, { name: 'capability-raw-js-link', stripCsp: true, click: '#js-link' })
    check('对照：点 javascript: 链接真的导航走了（所以"没导航"是 script-src 在挡）',
      capCtlJs.facts.url.includes('/js-link') || !!probe.hits['/js-link'], `url=${capCtlJs.facts.url}`)

    probe.reset()
    const capCtlForm = await loadInBrowser(browser, capRaw, { name: 'capability-raw-form', stripCsp: true, click: '#content form button' })
    check('对照：点提交后表单真的提交出去了（所以"没提交"是 form-action 在挡）',
      !!probe.hits['/form'] || capCtlForm.facts.url.includes('/form'),
      `url=${capCtlForm.facts.url} hits=${JSON.stringify(probe.hits)}`)

    // ---------- 工具侧接线 ----------
    console.log('\n=== 用例 6：工具传给渲染器的数据（清洗 + 授权判定） ===')
    // 这一段要拉起生产模块（连到 lib/renderer/loader.js），跑不起来时单独报一条，
    // 免得把前面已经跑出来的浏览器结论一起吞掉
    try {
      const payload = await captureToolPayload()
      for (const [label, got] of [['非主人', payload.nonMaster], ['主人', payload.master], ['缺 isMaster', payload.anonymous]]) {
        const md = got.last.data.markdown
        check(`${label}：传给渲染器的 markdown 已清洗（无 meta/link/base/script/iframe）`,
          !/<(meta|link|base|script|iframe)\b/i.test(md), md.slice(0, 60).replace(/\n/g, '\\n'))
      }
      check('非主人：allowRemoteImages=false', payload.nonMaster.last.data.allowRemoteImages === false, String(payload.nonMaster.last.data.allowRemoteImages))
      check('主人：allowRemoteImages=true（功能保留）', payload.master.last.data.allowRemoteImages === true, String(payload.master.last.data.allowRemoteImages))
      check('缺 isMaster（匿名/异常事件对象）：按 false 处理（fail-closed）', payload.anonymous.last.data.allowRemoteImages === false, String(payload.anonymous.last.data.allowRemoteImages))
      check('清洗后正文内容仍保留（不是整段删空）',
        payload.nonMaster.last.data.markdown.includes('探针文档') && payload.nonMaster.last.data.markdown.includes('结尾段落。'))
      check('渲染目标仍是 mathRender 模板', payload.nonMaster.last.name === 'chatgpt-plugin/mathRender/index', payload.nonMaster.last.name)
      check('工具返回成功而不是报错', /^Successfully/.test(payload.nonMaster.ret), payload.nonMaster.ret)
    } catch (e) {
      check('用例 6 自身跑不起来（接线测试未执行，不是断言失败）', false, String((e && e.stack) || e))
    }
  } finally {
    await closeBrowser(browser)
    await probe.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`)
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? '  —— ' + f.detail : ''}`)
  console.log('SECURITY CHECK DONE')
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error('FAILED:', (e && e.stack) || e)
  process.exit(1)
})
