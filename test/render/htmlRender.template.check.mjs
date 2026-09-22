#!/usr/bin/env node
// ============================================================
// htmlRender 模板脚本的逻辑检查（**不需要浏览器**）
//
// 为什么单独有这一个脚本：htmlRender.check.mjs 要真实 Chromium，不一定随时能跑；而模板里有两处
// 「只读代码看不出对错」的逻辑：
//   1. 内层文档的拼装：CSP meta 必须排在生成内容之前，且不能把模型给的 <html> 属性透传过去
//      —— meta 下发的 CSP 不作用于出现在它之前的内容，透传等于给模型留一条不受 CSP 约束的通道；
//   2. iframe 高度写回：必须有硬上限，否则模型输出一条 height:100000000px 就能把截图位图拉到巨幅。
//
// 做法：把模板里的 <script> 原样取出来，用最小 DOM 桩执行**真实的生产代码**，只桩掉浏览器 API。
// 布局度量（scrollWidth/scrollHeight/clientWidth/offsetWidth）是喂进去的输入，所以这里断言的是
// 「模板如何使用这些数字」，不是「Chromium 量得准不准」——后者只有 htmlRender.check.mjs 能回答。
//
// 用法：node test/render/htmlRender.template.check.mjs
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.resolve(HERE, '../../resources/htmlRender/index.html')

// 与模板里的 MAX_CONTENT_WIDTH / MAX_CONTENT_HEIGHT 保持一致（有意耦合）：
// 上限的意义就是"一个确定的小数字"，所以在这里写死；改模板的上限就要同步改这里。
// 单位一律是 CSS px；因为渲染器 DPR 恒为 1，也就是成品图的像素（模板是原生 2× 设计，无 zoom）。
const MAX_CONTENT_WIDTH = 4320
const MAX_CONTENT_HEIGHT = 6000

// 模板的原生设计尺寸（与 resources/htmlRender/index.html 一致，改模板要同步改这里）：
// 卡片 2400、iframe 实宽 2214、卡片占位 = 左右内距各 90 + 边框各 3 = 186。
const CARD_WIDTH = 2400
const FRAME_WIDTH = 2214

// ---------- 取出模板里的脚本 ----------
const source = fs.readFileSync(TEMPLATE, 'utf8')
const scriptMatch = source.match(/<script>([\s\S]*?)<\/script>/)
if (!scriptMatch) {
  console.error(`模板里找不到 <script>：${TEMPLATE}`)
  process.exit(1)
}
const TEMPLATE_SCRIPT = scriptMatch[1]

// ---------- 最小 DOM 桩：只提供模板脚本真正用到的东西 ----------
/**
 * 执行模板脚本并取回结果。
 * @param {string} rawHtml 隐藏容器里的原文（即模型输出的 HTML 源码）
 * @param {{scrollWidth?:number, scrollHeight?:number, frameClientWidth?:number, cardOffsetWidth?:number}} metrics
 *        喂给模板的布局度量
 * @returns {{doc:string, frame:object, card:object}} doc 即模板拼出的内层文档
 */
function renderTemplate (rawHtml, metrics = {}) {
  const listeners = {}
  const scrollWidth = metrics.scrollWidth ?? FRAME_WIDTH
  const scrollHeight = metrics.scrollHeight ?? 800
  const rawBox = { textContent: rawHtml }
  const card = { style: {}, offsetWidth: metrics.cardOffsetWidth ?? CARD_WIDTH }
  const innerDoc = {
    documentElement: { scrollWidth, scrollHeight },
    body: { scrollWidth, scrollHeight },
  }
  const frame = {
    style: {},
    clientWidth: metrics.frameClientWidth ?? FRAME_WIDTH,
    contentDocument: innerDoc,
    addEventListener (type, fn) { listeners[type] = fn },
  }
  const nodes = { 'raw-html': rawBox, page: frame, 'render-card': card }
  const document = { getElementById: (id) => nodes[id] }

  // 执行模板里的真实脚本（IIFE）。setTimeout 在模板里只用于 load 后的第二次补测，这里给空实现。
  new Function('document', 'setTimeout', TEMPLATE_SCRIPT)(document, () => {})

  if (typeof listeners.load !== 'function') throw new Error('模板脚本没有注册 iframe 的 load 回调')
  // 模板的量宽高逻辑挂在 load 上（真实浏览器里 iframe 加载完触发）
  listeners.load()

  return { doc: frame.srcdoc, frame, card }
}

// ---------- 断言工具 ----------
const results = []
function check (name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  —— ' + detail : ''}`)
}

// ---------- 1. 内层文档的拼装 ----------
console.log('=== 内层文档：CSP 位置与 <html>/<body> 属性 ===')
const rawDoc = [
  '<html style="background-image:url(http://127.0.0.1:8080/bg.png)">',
  '<body style="background:#fafafa"><div id="content">hi</div></body>',
  '</html>',
].join('')
const r = renderTemplate(rawDoc)
// CSP meta 之前出现过的每个字节都必须是模板自己写死的：meta 下发的 CSP 只作用于它之后的内容，
// 所以这条等式就等价于「模型给什么都进不到 CSP 前面」。模型自带的 <html>/<body> token 仍留在 raw 中，
// 且在 CSP meta **之后**才交给解析器；解析器会按标准树构造规则把其中属性合并到既有的 html/body 元素上
// （parse5 与 Chromium 实测都如此），但不会让它们提前出现在 CSP 之前 —— 所以"属性没落到
// documentElement / 没生效在 body 上"都不是本仓库的契约，下面这两条前缀等式才是。
const CSP_PREFIX = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
  + '<meta http-equiv="Content-Security-Policy" content="'
const FIXED_BODY_PREFIX = '</style></head><body>'
const cspAt = r.doc.indexOf('Content-Security-Policy')
const contentAt = r.doc.indexOf('<div id="content">')

check('内层文档带上 CSP meta', cspAt >= 0)
check('CSP meta 排在生成内容之前', cspAt >= 0 && contentAt > cspAt, `csp@${cspAt} 内容@${contentAt}`)
check('CSP meta 之前只有模板写死的固定头部（模型属性进不到 CSP 前面）',
  r.doc.startsWith(CSP_PREFIX), r.doc.slice(0, 80))
check('外层 <html> 标签上不带模型给的属性（只保留 lang="zh-CN"）',
  (r.doc.match(/<html\b[^>]*>/i) || [''])[0] === '<html lang="zh-CN">',
  (r.doc.match(/<html\b[^>]*>/i) || [''])[0])
// 模型标签不再被模板"二次解析"：固定骨架之后必须原样接上 raw，属性合并交给 HTML 解析器
check('固定骨架之后紧跟 raw 本身（模板不拆解模型的 <html>/<body> 标签）',
  r.doc.includes(FIXED_BODY_PREFIX + rawDoc),
  r.doc.slice(r.doc.indexOf('</style>'), r.doc.indexOf('</style>') + 70))

// 回归：HTML 属性值里**合法允许**出现 >，模板若用 /<body\b([^>]*)>/ 这类正则去理解模型标签，
// 就会在引号内的 > 处截断，把合法 HTML 拼坏
const trickyRaw = '<body data-note="a>b" style="background:#fafafa"><div id="x">ok</div></body>'
const tricky = renderTemplate(trickyRaw)
check('属性值里含 > 的合法 HTML 不被拼坏（raw 原样进内层文档）',
  tricky.doc.includes(FIXED_BODY_PREFIX + trickyRaw),
  tricky.doc.slice(tricky.doc.indexOf('</style>'), tricky.doc.indexOf('</style>') + 90))

// ---------- 2. 高度写回 ----------
console.log('=== iframe 高度写回：硬上限 ===')
const tall = renderTemplate('<div style="height:50000px">异常高度</div>', { scrollHeight: 50000 })
check(`超限高度被 clamp 到上限（${MAX_CONTENT_HEIGHT}px）`, tall.frame.style.height === `${MAX_CONTENT_HEIGHT}px`, String(tall.frame.style.height))
const normal = renderTemplate('<div style="height:940px">正常内容</div>', { scrollHeight: 940 })
check('未超限时高度等于实测 scrollHeight', normal.frame.style.height === '940px', String(normal.frame.style.height))
const tiny = renderTemplate('<div>空</div>', { scrollHeight: 0 })
check('量到 0 时不动 iframe 高度（保持模板里的 min-height）', tiny.frame.style.height === undefined, String(tiny.frame.style.height))

// ---------- 3. 宽度写回（与高度对称：正常超宽要撑宽，超上限才放弃） ----------
console.log('=== 卡片宽度写回 ===')
// 内容 2600px（> iframe 实宽 2214，模型没守 2200px 画布约定）→ 卡片 = 内容宽 + 卡片占位 186
const CONTENT_W = 2600
const wide = renderTemplate('<div>超宽</div>', { scrollWidth: CONTENT_W, frameClientWidth: FRAME_WIDTH, cardOffsetWidth: CARD_WIDTH })
check('超宽内容按实测差值撑宽卡片（内容宽 + 卡片占位）',
  wide.card.style.width === `${CONTENT_W + CARD_WIDTH - FRAME_WIDTH}px`, String(wide.card.style.width))
// 这条同时钉住"阈值确实随模板翻倍"：5000 超过新上限 4320 才该放弃，
// 若模板上限没跟着改（仍是 2160），这里会因为 5000 > 2160 继续绿——所以下面再补一条
// 落在「旧上限之上、新上限之下」的用例，确保上限真的被放大了。
const midWide = renderTemplate('<div>中度过宽</div>', { scrollWidth: 3000, frameClientWidth: FRAME_WIDTH, cardOffsetWidth: CARD_WIDTH })
check(`上限放宽到 ${MAX_CONTENT_WIDTH}px：3000px 内容仍然撑宽（旧上限 2160 会误判成超限）`,
  midWide.card.style.width === `${3000 + CARD_WIDTH - FRAME_WIDTH}px`, String(midWide.card.style.width))
const tooWide = renderTemplate('<div>极端超宽</div>', { scrollWidth: 5000, frameClientWidth: FRAME_WIDTH })
check(`超过宽度上限（${MAX_CONTENT_WIDTH}px）不再继续撑宽（宁可裁断也不无限拉宽）`,
  tooWide.card.style.width === undefined, String(tooWide.card.style.width))

const failed = results.filter((x) => !x.ok)
console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log(`  - ${f.name}${f.detail ? '  —— ' + f.detail : ''}`)
console.log('CHECK DONE')
process.exit(failed.length ? 1 : 0)
