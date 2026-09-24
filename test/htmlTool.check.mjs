#!/usr/bin/env node
// ============================================================
// GenerateHtmlTool 的两个纯函数（非 node:test 结构的文件级断言脚本）
//
// 用法：node test/htmlTool.check.mjs
//
// 覆盖：子代理回复 → HTML 源码的提取（围栏/前言/后记/取不到）、
//       渲染前清洗（script / iframe / object / embed 等可执行标签、
//       meta refresh / link 连接提示 / base 基址 等会绕开渲染端 CSP 的空元素）、
//       send_html_file 落盘文件名的清洗。
//       `stripActiveMarkup` 由 utils/renderSanitize.js 提供，generate_html 与 generate_math_markdown
//       两个模板共用同一份实现，所以这里断言的是两个工具共同的第一道防线。
// 说明：本脚本桩掉全局对象后直接 import 工具模块（会连带拉起 utils/common.js 的依赖链），
//       因此结尾必须显式 process.exit —— 否则框架侧的 chokidar 句柄会让进程挂住。
// 另：该依赖链会 import 主仓库的 lib/config/config.js，它按 **cwd** 读 config/default_config/，
//     所以无论从插件目录还是仓库根调用，都先把 cwd 切到云崽根目录。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const YUNZAI_ROOT = path.resolve(HERE, '../../..')
if (!fs.existsSync(path.join(process.cwd(), 'config/default_config'))) {
  if (!fs.existsSync(path.join(YUNZAI_ROOT, 'config/default_config'))) {
    console.error(`找不到云崽根目录（缺 config/default_config/）：${YUNZAI_ROOT}`)
    process.exit(1)
  }
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

const { extractHtmlSource, sanitizeHtmlFileName } = await import('../utils/tools/GenerateHtmlTool.js')
const { stripActiveMarkup } = await import('../utils/renderSanitize.js')

const results = []
function eq (name, actual, expected) {
  const ok = actual === expected
  results.push({ name, ok, detail: ok ? '' : `got=${JSON.stringify(actual)} exp=${JSON.stringify(expected)}` })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : `  —— got=${JSON.stringify(actual)} exp=${JSON.stringify(expected)}`}`)
}

// —— 从子代理回复里取 HTML ——
eq('纯 HTML 原样返回', extractHtmlSource('<div>hi</div>'), '<div>hi</div>')
eq('剥掉代码围栏', extractHtmlSource('```html\n<div>hi</div>\n```'), '<div>hi</div>')
eq('剥掉前后解说（有 </html> 时以它收尾）',
  extractHtmlSource('好的，这是你要的图：\n<html><body>x</body></html>\n需要我调整配色吗？'),
  '<html><body>x</body></html>')
eq('剥掉开头前言（无 </html>）', extractHtmlSource('Here you go:\n<div>hi</div>'), '<div>hi</div>')
// 回归：正文里的三反引号是内容而不是回复围栏 —— 生成的 HTML 用 <pre> 展示 Markdown / 代码块时就长这样，
// 旧实现按"最后一个 ```"截断会把 </pre><p>end</p></div> 整段砍掉
eq('HTML 正文里的三反引号不会被误当成回复围栏',
  extractHtmlSource('<div><pre>```js\nconst x=1\n```</pre><p>end</p></div>'),
  '<div><pre>```js\nconst x=1\n```</pre><p>end</p></div>')
eq('前言 + 围栏包住的片段：仍按围栏收尾，``` 不留在输出里',
  extractHtmlSource('```html\n这是你要的图：\n<div>hi</div>\n```'),
  '<div>hi</div>')
eq('围栏回复里正文本身含 ``` 时，仍以最后那道围栏收尾',
  extractHtmlSource('```html\n<div><pre>```js\nconst x=1\n```</pre></div>\n```'),
  '<div><pre>```js\nconst x=1\n```</pre></div>')
// 回归：前言只是**提到**三反引号（不是围栏行）时不能误判，否则正文里最后一个 ``` 会被当结束围栏
eq('前言只是提到 ``` 时不误判成回复围栏',
  extractHtmlSource('说明：正文里可以出现 ```，不是围栏。\n<div><pre>```js\nconst x=1\n```</pre><p>end</p></div>'),
  '<div><pre>```js\nconst x=1\n```</pre><p>end</p></div>')
eq('没有标签就返回空串（调用方据此报错）', extractHtmlSource('抱歉，我做不到。'), '')
eq('空输入返回空串', extractHtmlSource(''), '')

// —— 清洗可执行标签 ——
eq('移除成对 script', stripActiveMarkup('<div>a</div><script>alert(1)</script>'), '<div>a</div>')
eq('移除未闭合的 script 开标签', stripActiveMarkup('<div>a</div><script src="http://evil/x.js">'), '<div>a</div>')
eq('移除 iframe / object / embed',
  stripActiveMarkup('<iframe src="http://x"></iframe><object data="y"></object><embed src="z">'), '')
eq('普通内容不受影响（含实体）',
  stripActiveMarkup('<div style="color:#4a3735">a &amp; b</div>'), '<div style="color:#4a3735">a &amp; b</div>')

// —— 清洗会绕开 CSP 的空元素 ——
// <meta http-equiv="refresh"> 能让承载内容的 iframe 导航到任意地址：sandbox 只禁止它导航别的
// 浏览上下文，CSP 也没有能在 meta 中生效的「禁止导航」指令，所以必须在这里删掉。
eq('移除 <meta http-equiv="refresh">（否则内层 iframe 会自导航）',
  stripActiveMarkup('<meta http-equiv="refresh" content="0;url=http://127.0.0.1:8080/probe"><div>a</div>'),
  '<div>a</div>')
eq('meta 清洗不受大小写影响',
  stripActiveMarkup('<div>a</div><META HTTP-EQUIV="refresh" content="0;url=/x">'), '<div>a</div>')
eq('meta 清洗不受属性换行影响（<meta 后换行再跟属性）',
  stripActiveMarkup('<META\n  HTTP-EQUIV="refresh" content="0;url=/x">\n<div>a</div>'), '\n<div>a</div>')
eq('移除 <link>（preconnect / dns-prefetch 是 CSP 管不到的连接提示）',
  stripActiveMarkup('<link rel="preconnect" href="http://127.0.0.1:8080"><link rel="dns-prefetch" href="//evil"><div>a</div>'),
  '<div>a</div>')
// <base href> 会把文档里所有相对 URL 的解析基准换到别处：模型只要写一句
// <base href="http://attacker/">，模板里那些相对路径就可能被带到外站（CSP 的 base-uri 只是第二道锁）
eq('移除 <base>（相对 URL 的解析基准不能被内容改写）',
  stripActiveMarkup('<base href="http://127.0.0.1:8080/"><div>a</div>'), '<div>a</div>')
eq('base 清洗不受大小写与换行影响',
  stripActiveMarkup('<BASE\n  HREF="http://evil/">\n<div>a</div>'), '\n<div>a</div>')
// 多个危险标签混在一段内容里时不能只删掉一个
eq('多个危险标签同时出现时全部清除',
  stripActiveMarkup('<meta http-equiv="refresh" content="0;url=http://evil/"><base href="http://evil/"><iframe src="http://evil/"></iframe><link rel="preconnect" href="http://evil/"><p>正文</p>'),
  '<p>正文</p>')
eq('普通内容里的 <br/> 等正常行内标签不受影响',
  stripActiveMarkup('<p>第一行<br/>第二行</p>'), '<p>第一行<br/>第二行</p>')

// —— send_html_file 的文件名清洗（纯函数；发送分支的端到端断言见 test/htmlToolSend.test.mjs）——
// 标题来自模型（tool arguments），可能带 `/` 或 `..`：不清洗就等于让模型决定写入路径。
eq('去掉路径分隔符与 Windows 非法字符', sanitizeHtmlFileName('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j')
eq('折叠空白并剥掉首尾的点与空格', sanitizeHtmlFileName('  .. 链路图 .. '), '链路图')
eq('只有点的标题清成空串（调用方回退默认名）', sanitizeHtmlFileName('...'), '')
eq('空标题返回空串', sanitizeHtmlFileName(''), '')
eq('超长标题截断到 48 字符', sanitizeHtmlFileName('x'.repeat(80)).length, 48)

const failed = results.filter((r) => !r.ok)
console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`)
for (const f of failed) console.log(`  - ${f.name}  —— ${f.detail}`)
console.log('CHECK DONE')
process.exit(failed.length ? 1 : 0)
