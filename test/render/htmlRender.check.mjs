#!/usr/bin/env node
// ============================================================
// htmlRender 模板渲染检查（跨平台：Win11 本地 / Ubuntu 服务器都能跑）
//
// 用法：
//   node test/render/htmlRender.check.mjs                 只跑断言
//   node test/render/htmlRender.check.mjs --shot          额外把整页截图写到系统临时目录（只看观感）
//   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node ...  指定浏览器（Ubuntu 上常用）
//
// 设计约定（与 mathRender.check.mjs 一致）：
//   只断言「跨平台等价」的事实：DOM 结构、getComputedStyle 的尺寸/颜色、sandbox 属性、
//   高度自适应是否生效、样式隔离是否成立。不断言由字体决定的折行位置与最终图片尺寸。
//
// 本模板的特殊风险点（也是这组断言的靶子）：
//   1. 生成内容放在 iframe 里，iframe 不会自动撑高 → 高度没量出来内容就被裁掉（静默丢内容）
//   2. 生成内容可能有自己的 <style>（body/.card/!important）→ 必须不污染外层卡片
//   3. 生成内容可能有 <script> → iframe 的 sandbox 必须真正挡住脚本执行
//   4. sandbox 挡不住网络请求 → 内层文档的 CSP 必须阻断外链资源（用例 4 带「无 CSP 对照」）
//   5. 模型给的 <html> 属性一旦被透传就会落在 CSP meta 之前 → 模板不再透传；这条契约由
//      htmlRender.template.check.mjs 断言「CSP 之前的源码前缀完全固定」，浏览器侧不做断言
//      （raw 自带的 <html> token 会被解析器把属性合并到已有的 html 元素上，那是解析器行为）
//   6. 高度无上限 → 模型输出一条 height:100000000px 就能把截图位图拉到巨幅（用例 6 钉住硬上限）
//   7. inline SVG 是这个工具的一等能力 → 需要一条真实的矢量渲染用例（用例 5）
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import artTemplate from 'art-template'
import puppeteer from 'puppeteer'

// 用 fileURLToPath 而不是 import.meta.dirname：后者需要 Node >= 20.11
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE, '../..')
const TEMPLATE = path.join(PLUGIN_DIR, 'resources/htmlRender/index.html')
// 用例 4 拿来当「外链资源」的本地图片（mathRender 的检查脚本也在用同一个 fixture）
const EXTERNAL_PNG = path.join(HERE, 'fixtures/wide.png')
const WANT_SHOT = process.argv.includes('--shot')
const SHOT_DIR = path.join(os.tmpdir(), 'htmlRender-check')

// ---------- 浏览器：按平台挑，别写死路径 ----------
function resolveBrowserPath () {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
  if (process.platform === 'win32') {
    const candidates = [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ]
    return candidates.find((p) => fs.existsSync(p))
  }
  return undefined
}

function cjkFontReport () {
  if (process.platform === 'linux') {
    try {
      const out = execFileSync('fc-list', [':lang=zh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const n = out.split('\n').filter(Boolean).length
      return n > 0 ? `命中 ${n} 条` : '没有 CJK 字体 → 中文会渲染成方块，装 fonts-noto-cjk 后 fc-cache -fv'
    } catch {
      return 'fc-list 不可用，无法确认 CJK 字体'
    }
  }
  return `未检查（${process.platform}）`
}

// ---------- 用例内容 ----------
// 用例 1：完整文档形态（<html>/<body>/<style>/<script> 都在），内容取自真实的链路图需求。
// 其中 <html style>/<body style> 都**不由模板透传**：解析器会把 raw 里这两个 token 的属性合并到
// 既有的 html/body 元素上（parse5 与 Chromium 一致），所以「body 背景生效」仍然断言（innerBodyBg）；
// 而「CSP 之前不许有模型内容 / 模型标签不被模板拆解」由 test/render/htmlRender.template.check.mjs 断言。
const fullDoc = [
  '<html style="margin:0;padding:0;">',
  '<title>AI 语音链路</title>',
  '<style>.stage{border:1px solid #e5e7eb}</style>',
  '<body style="background:#fafafa">',
  '<div style="box-sizing:border-box;padding:16px;font-family:sans-serif;color:#1f2937;">',
  '  <div style="font-size:17px;font-weight:700;">AI 语音会话完整链路</div>',
  '  <div style="font-size:13px;color:#6b7280;">麦克风 → VAD → STT → LLM → TTS</div>',
  '  <div class="stage" style="border-radius:10px;padding:12px;margin-top:12px;">',
  '    <div style="font-weight:700;color:#2563eb;">① 采集与转写</div>',
  '    <div id="chain" style="display:flex;gap:6px;margin-top:8px;">',
  '      <div>麦克风</div><div>→</div><div>Whisper STT</div>',
  '    </div>',
  '  </div>',
  '</div>',
  // sandbox 必须挡住这段脚本：它一旦执行就会往里插一个 #injected-by-script
  '<script>document.body.appendChild(Object.assign(document.createElement("div"), { id: "injected-by-script" }))</script>',
  '</body>',
  '</html>',
].join('\n')

// 用例 2：片段形态 + 带 !important 的样式，用来验证隔离（泄漏就会改掉外层卡片的圆角）
const fragment = [
  '<style>body{background:#123456} .card{border-radius:0 !important} #container{padding:0 !important}</style>',
  '<div id="frag" style="padding:24px;color:#fff;">片段内容（没有 html/body 标签）</div>',
].join('\n')

// 用例 3：内容超出约定的 1100px（模型没守约束）——必须撑宽而不是静默裁掉右边
const overflow = [
  '<div style="padding:20px">',
  '  <div id="wide" style="width:1400px;padding:12px;">外层 1400px 的内容</div>',
  '</div>',
].join('\n')

const cases = [
  { name: 'fullDoc', title: 'HTML 链路图', html: fullDoc },
  { name: 'fragment', title: 'HTML 片段', html: fragment },
  { name: 'overflow', title: 'HTML 超宽内容', html: overflow },
]

// ---------- 断言工具 ----------
const results = []
function check (name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  —— ' + detail : ''}`)
}

const SUBTITLE_COLOR = 'rgb(200, 167, 164)' // #c8a7a4

// 卡片自身占位 = 左右 45px 内距 + 1.5px 边框（Chrome 对 1.5px 边框取整，实测合计 92px）。
// 只断言「iframe 铺满卡片、且只差这点占位」，不写死 iframe 的绝对宽度：
// 容器宽度一变（比如改卡片宽度）就不该再改这条断言。
const CARD_CHROME = 92
const onlyCardChromeLeft = (cardWidth, frameClientWidth) =>
  Math.abs(parseFloat(cardWidth) - frameClientWidth - CARD_CHROME) <= 2

// 与 resources/htmlRender/index.html 里的 MAX_CONTENT_HEIGHT 保持一致（有意耦合）：
// 这条断言的意义就是"上限是个确定的小数字"，所以这里写死；改模板的上限必须同步改这里。
// 单位是设计 CSS px（成品图还有 #container 的 zoom）。
const MAX_CONTENT_HEIGHT = 3000

// 出图宽度 = #container 的布局宽度 × zoom：模板把 1300px 的设计整体放大到 2560px（2K）。
// zoom 直接从模板里读，避免"改了模板宽度还要记着改这里"（改不出来就直接报错，别让断言悄悄失效）。
const RENDER_ZOOM = (() => {
  const m = fs.readFileSync(TEMPLATE, 'utf8').match(/#container\s*\{[^}]*zoom:\s*([\d.]+)/)
  if (!m) throw new Error('模板里读不到 #container 的 zoom：出图宽度断言失去依据')
  return Number(m[1])
})()

// ---------- 渲染一个用例 ----------
async function renderFixture (page, c, opts = {}) {
  let html = artTemplate.render(fs.readFileSync(TEMPLATE, 'utf8'), {
    pluResPath: pathToFileURL(path.join(PLUGIN_DIR, 'resources')).href,
    title: c.title,
    html: c.html,
  })
  if (/\{\{/.test(html)) throw new Error(`${c.name}: 模板残留 {{，变量没被替换`)
  // 对照组用：把内层文档的 CSP 摘掉，验证「外链加载被阻断」这条断言确实会红
  if (opts.stripCsp) html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '')

  const tmpHtml = path.join(os.tmpdir(), `htmlRender-check-${c.name}.html`)
  await fs.promises.writeFile(tmpHtml, html, 'utf8')

  const pageErrors = []
  const onErr = (e) => pageErrors.push(String((e && e.message) || e))
  page.on('pageerror', onErr)
  await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForSelector('#page', { timeout: 20000 })
  // 模板在 iframe 的 load 事件里量高度，这里等到高度真的被写回
  await page.waitForFunction(() => {
    const f = document.getElementById('page')
    return !!(f && f.contentDocument && f.style.height)
  }, { timeout: 10000 })
  await page.evaluate(() => document.fonts.ready)
  await new Promise((r) => setTimeout(r, 300))

  // renderZoom：#container 带 zoom（成品图放大到 2K），getBoundingClientRect 返回的是**放大后**的值，
  // 而 iframe 内部量到的 scrollHeight 是它自己那套 CSS px。统一折回 CSS px 再比较，
  // 下面「高度 = 内容高度」「高度 = 硬上限」这些断言才仍然成立。
  const facts = await page.evaluate((renderZoom) => {
    const frame = document.getElementById('page')
    const inner = frame.contentDocument
    const cs = (el, prop) => (el ? getComputedStyle(el)[prop] : null)
    const card = document.getElementById('render-card')
    return {
      subtitle: document.querySelector('.window-subtitle').textContent.trim(),
      subtitleColor: cs(document.querySelector('.window-subtitle'), 'color'),
      footer: document.querySelector('.footer').textContent.trim(),
      rawBoxDisplay: cs(document.getElementById('raw-html'), 'display'),
      cardWidth: cs(card, 'width'),
      cardRadius: cs(card, 'borderRadius'),
      frameWidth: cs(frame, 'width'),
      frameHeight: frame.getBoundingClientRect().height / renderZoom,
      frameSandbox: frame.getAttribute('sandbox'),
      innerScrollHeight: inner ? Math.max(inner.documentElement.scrollHeight, inner.body.scrollHeight) : -1,
      innerScrollWidth: inner ? Math.max(inner.documentElement.scrollWidth, inner.body.scrollWidth) : -1,
      frameClientWidth: frame.clientWidth,
      innerBodyStyleAttr: inner ? inner.body.getAttribute('style') : null,
      innerBodyBg: inner ? cs(inner.body, 'backgroundColor') : null,
      innerBodyMargin: inner ? cs(inner.body, 'margin') : null,
      innerNodeCount: inner ? inner.body.children.length : -1,
      innerHasFrag: inner ? !!inner.getElementById('frag') : false,
      innerChainItems: inner ? inner.querySelectorAll('#chain > div').length : -1,
      // inline SVG：节点是否留下、是否按 viewBox 铺满、defs 里的渐变是否还在
      innerSvgCount: inner ? inner.querySelectorAll('svg').length : -1,
      innerSvgWidth: inner && inner.querySelector('svg') ? inner.querySelector('svg').getBoundingClientRect().width : -1,
      innerSvgHeight: inner && inner.querySelector('svg') ? inner.querySelector('svg').getBoundingClientRect().height : -1,
      innerGradientStops: inner && inner.getElementById('sky') ? inner.getElementById('sky').querySelectorAll('stop').length : -1,
      innerRectFill: inner && inner.querySelector('rect') ? inner.querySelector('rect').getAttribute('fill') : null,
      // 外链图片是否真的加载成功（CSP 生效时应为 0）
      innerImgNatural: inner && inner.getElementById('ext') ? inner.getElementById('ext').naturalWidth : -1,
      scriptRan: inner ? !!inner.getElementById('injected-by-script') : null,
      outerBodyBg: cs(document.body, 'backgroundColor'),
      outerContainerPadding: cs(document.getElementById('container'), 'paddingTop'),
    }
  }, RENDER_ZOOM)

  if (WANT_SHOT) {
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    const el = await page.$('#container')
    await el.screenshot({ path: path.join(SHOT_DIR, `${c.name}.png`) })
  }

  page.off('pageerror', onErr)
  return { facts, pageErrors, html }
}

;(async () => {
  console.log('=== 环境 ===')
  console.log(`平台      : ${process.platform} ${process.arch} / node ${process.version}`)
  console.log(`浏览器    : ${resolveBrowserPath() || 'puppeteer 自带 Chrome'}`)
  console.log(`CJK 字体  : ${cjkFontReport()}`)
  console.log('提示      : 折行位置 / 最终图片尺寸由字体决定，不由本脚本断言\n')

  const browser = await puppeteer.launch({ headless: true, executablePath: resolveBrowserPath() })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 })

    // —— 用例 1：完整文档 ——
    console.log('=== 用例 1：完整文档（含 <script> 与 body 背景）===')
    const r1 = await renderFixture(page, cases[0])
    const f = r1.facts
    check('右上角标签为 HTML', f.subtitle === 'HTML', f.subtitle)
    check('右上角标签沿用主题弱化色', f.subtitleColor === SUBTITLE_COLOR, String(f.subtitleColor))
    check('卡片宽度 1200px（与 markdown 图同宽）', f.cardWidth === '1200px', String(f.cardWidth))
    check('卡片圆角 40px（与 markdown 图一致）', f.cardRadius === '40px', String(f.cardRadius))
    check('iframe 铺满卡片内容区（只差内距与边框）', onlyCardChromeLeft(f.cardWidth, f.frameClientWidth), `card=${f.cardWidth} frameClient=${f.frameClientWidth}`)
    check('iframe 带 sandbox 且未开 allow-scripts', !!f.frameSandbox && !f.frameSandbox.includes('allow-scripts'), String(f.frameSandbox))
    check('iframe 高度按内容量出（内容不会被裁）', f.frameHeight > 0 && Math.abs(f.frameHeight - f.innerScrollHeight) <= 2, `frame=${f.frameHeight} inner=${f.innerScrollHeight}`)
    check('生成内容确实渲染在 iframe 内（节点保留）', f.innerNodeCount >= 2 && f.innerChainItems === 3, `bodyChildren=${f.innerNodeCount} chain=${f.innerChainItems}`)
    check('iframe 内 <script> 未执行', f.scriptRan === false, String(f.scriptRan))
    check('完整文档里的 <body style> 正常生效（解析器合并，不靠模板透传）', f.innerBodyBg === 'rgb(250, 250, 250)', `${f.innerBodyStyleAttr} → ${f.innerBodyBg}`)
    check('hidden 容器不显示源码文本', f.rawBoxDisplay === 'none', String(f.rawBoxDisplay))
    check('页脚署名保留', f.footer.includes('Created By PaimonChatGPT-Plugin'), f.footer)
    // 出图宽度必须真的到 2K：截的是 #container，宽度 =（卡片 + 左右内距）× zoom
    const shot1 = Buffer.from(await (await page.$('#container')).screenshot({ type: 'png' }))
    const shot1Width = shot1.readUInt32BE(16)
    check('成品图宽度达到 2K（≥2560px）', shot1Width >= 2560, `png=${shot1Width} card=${f.cardWidth} zoom=${RENDER_ZOOM}`)
    check('用例 1 页面无未捕获 JS 异常', r1.pageErrors.length === 0, r1.pageErrors.join('; '))

    // —— 用例 2：片段 + 样式隔离 ——
    console.log('=== 用例 2：片段形态 + 生成内容样式的隔离 ===')
    const r2 = await renderFixture(page, cases[1])
    const g = r2.facts
    check('片段被包成完整文档后正常渲染', g.innerHasFrag === true && g.innerNodeCount >= 1, `frag=${g.innerHasFrag} children=${g.innerNodeCount}`)
    check('片段用例的 iframe 高度同样自适应', g.frameHeight > 0 && Math.abs(g.frameHeight - g.innerScrollHeight) <= 2, `frame=${g.frameHeight} inner=${g.innerScrollHeight}`)
    check('片段没有 html/body 时也套用了基础 margin:0', g.innerBodyMargin === '0px', String(g.innerBodyMargin))
    check('生成内容的 body 样式只作用于 iframe 内', g.innerBodyBg === 'rgb(18, 52, 86)', String(g.innerBodyBg))
    check('生成内容的 !important 不会污染外层卡片圆角', g.cardRadius === '40px', String(g.cardRadius))
    check('生成内容的 !important 不会污染外层容器内距', g.outerContainerPadding === '50px', String(g.outerContainerPadding))
    check('外层页面背景不受生成内容影响', g.outerBodyBg === 'rgba(0, 0, 0, 0)', String(g.outerBodyBg))
    check('用例 2 页面无未捕获 JS 异常', r2.pageErrors.length === 0, r2.pageErrors.join('; '))

    // —— 用例 3：超宽内容 ——
    console.log('=== 用例 3：内容超出 1100px 时撑宽而不是裁掉 ===')
    // 真实渲染后端不设 viewport（默认 800×600），这里切到同样的窄视口，
    // 确认「比视口还宽的卡片」仍被完整截进图片（否则图会被裁到 800 宽）
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 })
    const r3 = await renderFixture(page, cases[2])
    const h = r3.facts
    check('超宽内容把 iframe 撑到内容宽度', h.frameClientWidth > f.frameClientWidth && h.frameClientWidth === h.innerScrollWidth, `默认=${f.frameClientWidth} 撑宽后=${h.frameClientWidth} innerScrollWidth=${h.innerScrollWidth}`)
    check('撑宽后内容不再横向溢出（右边没被裁）', h.innerScrollWidth <= h.frameClientWidth, `${h.innerScrollWidth} <= ${h.frameClientWidth}`)
    check('卡片跟着内容一起变宽（仍只多内距与边框）', onlyCardChromeLeft(h.cardWidth, h.frameClientWidth), `card=${h.cardWidth} frame=${h.frameClientWidth}`)
    check('用例 3 高度同样自适应', h.frameHeight > 0 && Math.abs(h.frameHeight - h.innerScrollHeight) <= 2, `frame=${h.frameHeight} inner=${h.innerScrollHeight}`)
    const wideShot = Buffer.from(await (await page.$('#container')).screenshot({ type: 'png' }))
    // 期望宽度 =（撑宽后的卡片 + 左右内距）× zoom；zoom 会把小数放大，留 2px 取整余量
    const expectWide = (parseFloat(h.cardWidth) + 100) * RENDER_ZOOM
    check('成品图完整包含变宽的卡片（没被窄视口裁掉）',
      Math.abs(wideShot.readUInt32BE(16) - expectWide) <= 2,
      `png=${wideShot.readUInt32BE(16)} 期望≈${Math.round(expectWide)}（card=${h.cardWidth} zoom=${RENDER_ZOOM}）`)
    check('用例 3 页面无未捕获 JS 异常', r3.pageErrors.length === 0, r3.pageErrors.join('; '))
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 })

    // —— 用例 4：CSP 挡外链（sandbox 只挡脚本，不挡网络请求）——
    if (fs.existsSync(EXTERNAL_PNG)) {
      console.log('=== 用例 4：内层文档的 CSP 挡掉外链资源 ===')
      const externalImg = `<div style="padding:20px"><img id="ext" src="${pathToFileURL(EXTERNAL_PNG).href}" width="600"></div>`
      const ctrl = await renderFixture(page, { name: 'cspControl', title: '无 CSP 对照', html: externalImg }, { stripCsp: true })
      check('对照：摘掉 CSP 后外链图片能加载（这条断言确实会红）', ctrl.facts.innerImgNatural > 0, `naturalWidth=${ctrl.facts.innerImgNatural}；csp=${/Content-Security-Policy/.test(ctrl.html)}`)
      const guarded = await renderFixture(page, { name: 'cspGuarded', title: 'CSP 生效', html: externalImg })
      check('内层文档带上了 CSP meta', /http-equiv="Content-Security-Policy"/.test(guarded.html))
      check('CSP 挡掉外链图片（img-src data:）', guarded.facts.innerImgNatural === 0, `naturalWidth=${guarded.facts.innerImgNatural}`)
      check('被拦时布局不塌（图片仍占宽度，高度照常量出）', guarded.facts.frameHeight > 0 && Math.abs(guarded.facts.frameHeight - guarded.facts.innerScrollHeight) <= 2, `frame=${guarded.facts.frameHeight} inner=${guarded.facts.innerScrollHeight}`)
      check('用例 4 页面无未捕获 JS 异常', guarded.pageErrors.length === 0, guarded.pageErrors.join('; '))
    } else {
      console.log('（跳过用例 4：缺少 fixtures/wide.png）')
    }

    // —— 用例 5：inline SVG（SVG 是这个工具的一等能力，不能只靠"浏览器碰巧能渲染"）——
    console.log('=== 用例 5：inline SVG 矢量插画 ===')
    const svgArt = [
      '<svg viewBox="0 0 1000 650" style="display:block;width:100%;height:auto">',
      '  <defs>',
      '    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">',
      '      <stop offset="0%" stop-color="#eff6ff"/><stop offset="100%" stop-color="#ffe5e7"/>',
      '    </linearGradient>',
      '  </defs>',
      '  <rect x="0" y="0" width="1000" height="650" fill="url(#sky)"/>',
      '  <g id="subject" stroke="#4a3735" stroke-width="6" fill="none">',
      '    <circle cx="300" cy="480" r="110"/><circle cx="700" cy="480" r="110"/>',
      '    <path d="M300 480 L420 330 L620 330 L700 480"/>',
      '  </g>',
      '</svg>',
    ].join('\n')
    const r5 = await renderFixture(page, { name: 'svgArt', title: 'SVG 插画', html: svgArt })
    const s = r5.facts
    check('SVG 节点被保留（没被清洗或转义掉）', s.innerSvgCount === 1, String(s.innerSvgCount))
    check('SVG 按 viewBox 铺满容器宽度（width:100% 生效）',
      s.innerSvgWidth > 1000 && Math.abs(s.innerSvgWidth - s.frameClientWidth) <= 2,
      `svg=${s.innerSvgWidth} frame=${s.frameClientWidth}`)
    // 内部引用 url(#sky) 不产生网络请求、不受 CSP 约束；这里要防的是清洗/转义把 defs 弄坏
    check('defs 里的渐变与引用完整（stops 齐全、rect 仍指向 url(#sky)）',
      s.innerGradientStops === 2 && s.innerRectFill === 'url(#sky)',
      `stops=${s.innerGradientStops} fill=${s.innerRectFill}`)
    check('SVG 高度按 viewBox 比例算出（不是 150px 兜底值）',
      Math.abs(s.innerSvgHeight - s.innerSvgWidth * 650 / 1000) <= 2,
      `svgH=${s.innerSvgHeight} 期望=${(s.innerSvgWidth * 0.65).toFixed(1)}`)
    check('用例 5 的 iframe 高度同样自适应', s.frameHeight > 0 && Math.abs(s.frameHeight - s.innerScrollHeight) <= 2, `frame=${s.frameHeight} inner=${s.innerScrollHeight}`)
    check('用例 5 页面无未捕获 JS 异常', r5.pageErrors.length === 0, r5.pageErrors.join('; '))

    // —— 用例 6：异常高度必须被硬上限截住（真实渲染是对 #container 的元素截图）——
    console.log('=== 用例 6：异常高度受硬上限约束 ===')
    const r6 = await renderFixture(page, {
      name: 'extremeTall',
      title: '异常高度',
      html: '<div style="height:50000px;padding:20px">异常高度</div>',
    })
    const t = r6.facts
    // frameHeight 已按 zoom 折回 CSS px，除 zoom 会带浮点误差 → 用容差比较，别用严格等值
    check(`异常高度被硬上限截住（${MAX_CONTENT_HEIGHT}px）`, Math.abs(t.frameHeight - MAX_CONTENT_HEIGHT) <= 2, `frame=${t.frameHeight}`)
    check('该 fixture 确实超过上限（这条断言不是空跑）', t.innerScrollHeight > MAX_CONTENT_HEIGHT, `inner=${t.innerScrollHeight}`)
    check('用例 6 页面无未捕获 JS 异常', r6.pageErrors.length === 0, r6.pageErrors.join('; '))
  } finally {
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`)
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? '  —— ' + f.detail : ''}`)
  if (WANT_SHOT) console.log(`截图（仅看观感）：${SHOT_DIR}`)
  console.log('CHECK DONE')
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error('FAILED:', (e && e.stack) || e)
  process.exit(1)
})
