#!/usr/bin/env node
// ============================================================
// mathRender 模板渲染检查（跨平台：Win11 本地 / Ubuntu 服务器都能跑）
//
// 用法：
//   node test/render/mathRender.check.mjs                 只跑断言（26 项）
//   node test/render/mathRender.check.mjs --shot          额外把整页截图写到系统临时目录（只看观感）
//   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node ...  指定浏览器（Ubuntu 上常用）
//
// 假绿点验证（证明这些断言真的拦得住回归，改的是生产模板，跑完务必 restore）：
//   node test/render/mutate-check.mjs apply     → 本脚本应 exit 1 且指定断言转红
//   node test/render/mutate-check.mjs restore   → 本脚本恢复全绿
//
// 设计约定（重要）：
//   只断言「跨平台等价」的事实：DOM 结构与数量、getComputedStyle 的颜色/内距/边框、
//   规则是否命中（::marker / .task-box）、是否产生假链接、嵌套层级。
//   不断言由字体决定的量：折行位置、列宽、行高、最终图片尺寸——本地 Win11 过了
//   不代表 Ubuntu 服务器过（服务器缺 CJK 字体时中文是方块）。字体情况只在开头打印，
//   不参与通过/失败判定。
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import artTemplate from 'art-template'
import puppeteer from 'puppeteer'

// 用 fileURLToPath 而不是 import.meta.dirname：后者需要 Node >= 20.11，
// 服务器上的 Node 版本可能更老，这个写法两边都能跑
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE, '../..')
const TEMPLATE = path.join(PLUGIN_DIR, 'resources/mathRender/index.html')
const RES_DIR = path.join(PLUGIN_DIR, 'resources')
const WIDE_PNG = path.join(HERE, 'fixtures/wide.png')
const WANT_SHOT = process.argv.includes('--shot')
const SHOT_DIR = path.join(os.tmpdir(), 'mathRender-check')

// ---------- 浏览器：按平台挑，别写死路径 ----------
function resolveBrowserPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
  if (process.platform === 'win32') {
    const candidates = [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ]
    return candidates.find((p) => fs.existsSync(p)) // 都找不到就交给 puppeteer 自带 Chrome
  }
  return undefined // Linux/macOS：puppeteer 自带 Chrome，或用 PUPPETEER_EXECUTABLE_PATH
}

// ---------- 字体就绪情况：只打印，不参与断言 ----------
function cjkFontReport() {
  if (process.platform === 'linux') {
    try {
      const out = execFileSync('fc-list', [':lang=zh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const n = out.split('\n').filter(Boolean).length
      return n > 0
        ? { ok: true, detail: `fc-list :lang=zh 命中 ${n} 条` }
        : { ok: false, detail: '没有 CJK 字体 → 中文会渲染成方块，装 fonts-noto-cjk 后 fc-cache -fv' }
    } catch {
      return { ok: false, detail: 'fc-list 不可用（或未装 fontconfig）→ 无法确认 CJK 字体' }
    }
  }
  if (process.platform === 'win32') {
    const found = ['msyh.ttc', 'msyhbd.ttc', 'simhei.ttf', 'simsun.ttc'].find((f) =>
      fs.existsSync(path.join('C:/Windows/Fonts', f)))
    return found ? { ok: true, detail: `系统字体目录有 ${found}` } : { ok: false, detail: '未找到常见 CJK 字体' }
  }
  return { ok: true, detail: `未检查（${process.platform}）` }
}

// ---------- 用例（markdown 用行数组拼，避免模板字面量与围栏反引号打架） ----------
const mdSyntax = [
  '## 1. 代码块',
  '```js',
  'const kv = cache.slice(-window)',
  'console.log(kv)',
  '```',
  '## 2. 列表与任务',
  '- 普通项',
  '- [ ] 未完成',
  '- [x] 已完成',
  '  - [ ] 嵌套未完成',
  '## 3. 链接 / 分隔线 / 标题',
  '[腾讯文档](https://docs.qq.com) 与 <https://example.com>',
  '',
  '#### h4 四级标题',
  '',
  '##### h5 五级标题',
  '',
  '###### h6 六级标题',
  '',
  '---',
  '## 4. 表格',
  '| 项目 | 说明 |',
  '| --- | --- |',
  '| 换行 | 第一行<br/>第二行 |',
  '| 公式 | $E=mc^2$ |',
].join('\n')

const mdFootnote = [
  '## 脚注外形（不支持，但不能变成假链接）',
  '',
  '引用[^note] 与带内部空白的 [^source 1] 都要按原文显示。',
  '',
  '[^note]: 定义内容一',
  '[^source 1]: 定义内容二',
  '',
  '对照：引用式链接 [指向示例][ref] 必须照常渲染。',
  '',
  '[ref]: https://example.com/ref',
].join('\n')

const mdNestedColor = [
  '## 完成父任务下的取色',
  '',
  '- [x] 父任务',
  '  - 未完成子项',
  '  - [x] 已完成子项',
  '',
  '- [x] 带引用的父任务',
  '  > 引用块里的列表',
  '  > - 引用里的普通列表项',
  '',
  '> - [x] 引用里的完成父任务',
  '>   - 引用里的未完成子任务',
  '>',
  '> | 项目 | 内容 |',
  '> | --- | --- |',
  '> | A | B |',
].join('\n')

// 宽图用真 PNG 生成 data URI（markdown-it 会拒绝 file:// 这类协议）
function mdWithWideImage() {
  const b64 = fs.readFileSync(WIDE_PNG).toString('base64')
  return ['## 图片限宽', '', `![宽图](data:image/png;base64,${b64})`].join('\n')
}

// 引用块内距：首/末子元素自带的 margin 会各自叠到引用块的内距上，只清末尾不清开头时，
// 文字上方是「内距 + margin-top」、下方只有内距，看起来就是整段文字往下坠（曾经如此）。
// 覆盖单段、多段、首元素是列表、嵌套引用四种形态。
const mdQuoteSpacing = [
  '## 引用块内距',
  '',
  '> 单段引用',
  '',
  '> 第一段',
  '>',
  '> 第二段',
  '',
  '> - 列表项一',
  '> - 列表项二',
  '',
  '> > 嵌套引用',
].join('\n')

// ---------- 渲染 ----------
// 每个用例的未捕获异常都汇总到这里（渲染完一次性断言，避免只查了某一个用例，
// 也避免把「页面没炸」重复记成多条测试数）
const pageErrorLog = []

async function renderFixture(page, title, markdown) {
  const tpl = await fs.promises.readFile(TEMPLATE, 'utf8')
  const html = artTemplate.render(tpl, {
    pluResPath: pathToFileURL(RES_DIR).href,
    title,
    markdown,
  })
  const errors = []
  if (/\{\{/.test(html)) errors.push('渲染结果里仍残留 {{，模板变量没被替换')
  const tmpHtml = path.join(os.tmpdir(), `mathRender-check-${title.replace(/[^\w-]/g, '_')}.html`)
  await fs.promises.writeFile(tmpHtml, html, 'utf8')
  const onErr = (e) => pageErrorLog.push(`${title}: ${String((e && e.message) || e)}`)
  page.on('pageerror', onErr)
  await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForSelector('#content', { timeout: 20000 })
  await page.evaluate(() => document.fonts.ready)
  await new Promise((r) => setTimeout(r, 300))
  if (WANT_SHOT) {
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 })
    const el = await page.$('#container')
    await el.screenshot({ path: path.join(SHOT_DIR, `${title.replace(/[^\w-]/g, '_')}.png`) })
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
  }
  page.off('pageerror', onErr)
  return { errors }
}

// ---------- 断言工具 ----------
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  —— ' + detail : ''}`)
}

const COLOR = { body: 'rgb(74, 55, 53)', done: 'rgb(138, 118, 113)', quote: 'rgb(102, 80, 76)', link: 'rgb(211, 96, 124)' }

;(async () => {
  console.log('=== 环境 ===')
  console.log(`平台      : ${process.platform} ${process.arch} / node ${process.version}`)
  const browserPath = resolveBrowserPath()
  console.log(`浏览器    : ${browserPath || 'puppeteer 自带 Chrome'}`)
  const font = cjkFontReport()
  console.log(`CJK 字体  : ${font.ok ? '有' : '缺'} —— ${font.detail}`)
  console.log('提示      : 字体相关的观感（折行/列宽/图片尺寸）不由本脚本断言，别把本地截图当回归依据\n')

  const browser = await puppeteer.launch({ headless: true, executablePath: browserPath })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })

    // —— 用例 1：基础语法 ——
    console.log('=== 用例 1：代码块 / 列表 / 任务 / 链接 / 表格 ===')
    const r1 = await renderFixture(page, 'syntax', mdSyntax)
    // 模板变量残留只需查一次：四个用例用的是同一份模板渲染结果，判定是确定性的
    check('模板渲染不残留 {{', r1.errors.length === 0, r1.errors.join('; '))
    const a1 = await page.evaluate(() => {
      const c = document.getElementById('content')
      const q = (s) => [...c.querySelectorAll(s)]
      const cs = (e) => getComputedStyle(e)
      const pre = q('pre')[0]
      const code = pre && pre.querySelector('code')
      let indentDiff = null
      if (code && code.firstChild) {
        const nl = code.textContent.indexOf('\n')
        const r1 = document.createRange(); r1.setStart(code.firstChild, 0); r1.setEnd(code.firstChild, 1)
        const b1 = r1.getBoundingClientRect()
        if (nl >= 0) {
          const r2 = document.createRange(); r2.setStart(code.firstChild, nl + 1); r2.setEnd(code.firstChild, nl + 2)
          indentDiff = Math.round((b1.left - r2.getBoundingClientRect().left) * 10) / 10
        }
      }
      return {
        indentDiff,
        codePadding: code ? cs(code).padding : null,
        links: q('a').map((a) => ({ href: a.getAttribute('href'), color: cs(a).color })),
        markerColor: c.querySelector('li') ? getComputedStyle(c.querySelector('li'), '::marker').color : null,
        liMargin: c.querySelector('li') ? cs(c.querySelector('ul li')).marginBottom : null,
        taskBox: q('.task-box').length,
        taskDone: q('.task-box.is-done').length,
        taskItem: q('li.task-item').length,
        rawMarkerLeft: q('li').some((e) => /^\s*\[[ xX]\]/.test(e.textContent)),
        hr: c.querySelector('hr') ? cs(c.querySelector('hr')).borderTopWidth + ' ' + cs(c.querySelector('hr')).borderTopStyle : null,
        tableWrap: q('.table-wrap').length,
        tableRows: q('table tr').length,
        tdColor: c.querySelector('tbody td') ? cs(c.querySelector('tbody td')).color : null,
        headings: q('h4,h5,h6').map((h) => cs(h).fontSize),
        strayPipes: q('p').filter((p) => p.textContent.trim().startsWith('|')).length,
      }
    })
    check('代码块首行与后续行左边界一致（无 8px 内距泄漏）', a1.indentDiff === 0, `indentDiff=${a1.indentDiff} padding=${a1.codePadding}`)
    check('链接全部为 http(s) 且为主题粉', a1.links.length > 0 && a1.links.every((l) => /^https?:/.test(l.href) && l.color === COLOR.link), JSON.stringify(a1.links.map((l) => l.color)))
    check('无序列表 marker 为主题粉', a1.markerColor === 'rgb(255, 143, 163)', String(a1.markerColor))
    check('列表项间距为 8px', a1.liMargin === '8px', String(a1.liMargin))
    check('任务列表生成复选框（未完成 2 + 已完成 1）', a1.taskBox === 3 && a1.taskDone === 1, `box=${a1.taskBox} done=${a1.taskDone}`)
    check('无残留字面 [ ] / [x]', a1.rawMarkerLeft === false)
    check('hr 为 2px 虚线', a1.hr === '2px dashed', String(a1.hr))
    check('表格包裹与行数正确', a1.tableWrap === 1 && a1.tableRows === 3, `wrap=${a1.tableWrap} tr=${a1.tableRows}`)
    check('表格单元格用正文色（--text-color）', a1.tdColor === COLOR.body, String(a1.tdColor))
    check('无管道符泄漏成段落', a1.strayPipes === 0)
    check('h4/h5/h6 字号递减', a1.headings.length === 3 && parseFloat(a1.headings[0]) > parseFloat(a1.headings[1]) && parseFloat(a1.headings[1]) > parseFloat(a1.headings[2]), a1.headings.join(' / '))

    // —— 用例 2：脚注外形 ——
    console.log('=== 用例 2：脚注外形（含内部空白 label）===')
    const r2 = await renderFixture(page, 'footnote', mdFootnote)
    const a2 = await page.evaluate(() => {
      const c = document.getElementById('content')
      const links = [...c.querySelectorAll('a')].map((a) => ({ text: a.textContent, href: a.getAttribute('href') }))
      // 只取「引用所在的那一段」来判定字面文本：整页 textContent 里包含脚注定义行，
      // 定义行本身就带 [^note] / [^source 1]，拿整页判断等于假断言（引用被吃掉了也照样通过）
      const refP = [...c.querySelectorAll('p')].find((p) => p.textContent.includes('都要按原文显示。'))
      return {
        links,
        bogus: links.filter((l) => !/^https?:/.test(l.href || '')).length,
        defKept: c.textContent.includes('[^note]: 定义内容一') && c.textContent.includes('[^source 1]: 定义内容二'),
        refText: refP ? refP.textContent : null,
        refHasLink: refP ? !!refP.querySelector('a') : null,
      }
    })
    check('没有假链接（href 非 http/https）', a2.bogus === 0, JSON.stringify(a2.links))
    check('引用式链接仍正常', a2.links.some((l) => l.href === 'https://example.com/ref'))
    check('脚注定义行按原文保留', a2.defKept)
    check('引用所在段落是字面文本且不含链接', !!a2.refText && a2.refText.includes('[^note]') && a2.refText.includes('[^source 1]') && a2.refHasLink === false, a2.refText)

    // —— 用例 3：完成任务下的取色 ——
    console.log('=== 用例 3：完成父任务下的取色（含引用块）===')
    const r3 = await renderFixture(page, 'nestedColor', mdNestedColor)
    const a3 = await page.evaluate(() => {
      const c = document.getElementById('content')
      const cs = (e) => getComputedStyle(e).color
      const quoteTd = c.querySelector('blockquote tbody td')
      return {
        li: [...c.querySelectorAll('li')].map((e) => ({ cls: e.className || '(无)', color: cs(e), text: e.textContent.trim().split('\n')[0].slice(0, 12) })),
        blockquote: [...c.querySelectorAll('blockquote')].map((e) => cs(e)),
        quoteTdColor: quoteTd ? cs(quoteTd) : null,
      }
    })
    const doneParent = a3.li.filter((l) => l.cls.includes('is-done'))
    const plainChild = a3.li.find((l) => l.text === '未完成子项')
    const quoteChild = a3.li.find((l) => l.text === '引用里的普通列表项')
    const quoteTaskChild = a3.li.find((l) => l.text === '引用里的未完成子任务')
    check('完成任务自身为弱化灰', doneParent.length >= 4 && doneParent.every((l) => l.color === COLOR.done), `${doneParent.length} 项 ${JSON.stringify([...new Set(doneParent.map((l) => l.color))])}`)
    check('直接子列表的未完成项为正文色', plainChild && plainChild.color === COLOR.body, plainChild && plainChild.color)
    check('引用块内的列表保持引用色（不被强制正文色）', quoteChild && quoteChild.color === COLOR.quote, quoteChild && quoteChild.color)
    check('引用块内的完成任务：子列表回到引用色而非正文色（镜像场景）', quoteTaskChild && quoteTaskChild.color === COLOR.quote, `${quoteTaskChild && quoteTaskChild.color}；blockquote=${[...new Set(a3.blockquote)].join(',')}`)
    // 表格单元格只有在引用块里才能验证「用了 --text-color」：写在普通正文时，
    // 旧写法（写死 #4a3735）与变量写法取值完全一样，那种断言拦不住回归
    check('引用块内的表格单元格用引用色（证明 td 走 var(--text-color)）', a3.quoteTdColor === COLOR.quote, String(a3.quoteTdColor))

    // —— 用例 4：图片限宽 ——
    if (fs.existsSync(WIDE_PNG)) {
      console.log('=== 用例 4：图片限宽 ===')
      const r4 = await renderFixture(page, 'image', mdWithWideImage())
      const a4 = await page.evaluate(() => {
        const c = document.getElementById('content')
        const img = c.querySelector('img')
        if (!img) return { has: false }
        const r = img.getBoundingClientRect()
        return { has: true, maxWidth: getComputedStyle(img).maxWidth, overflowRight: Math.round(r.right - c.getBoundingClientRect().right), natural: img.naturalWidth }
      })
      check('图片渲染出来了', a4.has)
      check('图片 max-width 生效', a4.has && a4.maxWidth === '100%', a4.maxWidth)
      check('图片不溢出内容区', a4.has && a4.overflowRight <= 0, `溢出 ${a4.overflowRight}px（原图宽 ${a4.natural}）`)
    } else {
      console.log('（跳过图片用例：缺少 fixtures/wide.png）')
    }

    // —— 用例 5：引用块内距对称 ——
    console.log('=== 用例 5：引用块内距对称 ===')
    await renderFixture(page, 'quoteSpacing', mdQuoteSpacing)
    const a5 = await page.evaluate(() => {
      const c = document.getElementById('content')
      const round = (n) => Math.round(n * 100) / 100
      return [...c.querySelectorAll('blockquote')].map((q, i) => {
        const first = q.firstElementChild
        const last = q.lastElementChild
        // 只量「首/末子元素的外边距盒到引用块边框盒」的距离（= 内距 + 该子元素的 margin），
        // 与字体、折行、行高都无关；子元素为空的引用块（例如只有一行 `>`）没有可量的边距
        if (!first || !last) return { i, gapTop: null, gapBottom: null, mt: null, mb: null }
        return {
          i,
          gapTop: round(first.getBoundingClientRect().top - q.getBoundingClientRect().top),
          gapBottom: round(q.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom),
          mt: getComputedStyle(first).marginTop,
          mb: getComputedStyle(last).marginBottom,
        }
      })
    })
    const quotable = a5.filter((q) => q.gapTop !== null)
    check('引用块上下内距对称（首个子元素不再被 margin-top 顶下去）',
      quotable.length > 0 && quotable.every((q) => Math.abs(q.gapTop - q.gapBottom) <= 0.5),
      JSON.stringify(a5))

    // 页面健康放在所有用例跑完后统一断言——之前只在用例 1 查，后面几个用例即使抛未捕获异常也会全绿
    check('所有用例页面均无未捕获 JS 异常', pageErrorLog.length === 0, pageErrorLog.join('; '))
  } finally {
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`)
  if (failed.length) {
    console.log('失败项：')
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? '  —— ' + f.detail : ''}`)
  }
  if (WANT_SHOT) console.log(`截图（仅看观感，字体相关结论不可跨平台）：${SHOT_DIR}`)
  console.log(`字体情况：${font.ok ? '本机有 CJK 字体' : '本机缺 CJK 字体（截图里的中文会是方块）'}`)
  process.exit(failed.length ? 1 : 0)
})().catch((e) => {
  console.error('FAILED:', (e && e.stack) || e)
  process.exit(1)
})
