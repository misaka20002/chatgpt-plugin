/**
 * 纯本地搜索与网页读取工具
 *
 * 覆盖点（按「测试越少越好」定的取舍，只保底，不求全）：
 *  1. 读取：统一契约头 + Markdown 正文 + 按截断标记续读 + 内联 base64 图片被滤掉
 *  2. 读取：私网地址被拒且不发请求
 *  3. 读取：GBK 页面按 meta charset 解码
 *  4. 读取：非文本内容、403、超时、字节上限、重定向与跳数上限
 *  5. 搜索：百度取 mu、DuckDuckGo 解 uddg（纯函数，不触网）
 *  6. 搜索：引擎降级、并发抓正文时单条失败不影响其余、max_results 边界
 *  7. 搜索：20 秒总预算的两条出口（引擎轮询吃满、抓正文前耗尽）——假时钟快进，不真等
 *
 * 运行：npm run test:tools（或 node --test test/localWebTools.test.js）
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.logger) {
  globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, trace() {}, log() {} }
}

const { WebsiteTool } = await import('../utils/tools/WebsiteTool.js')
const { Misaka_WebSearchTool } = await import('../utils/tools/Misaka_WebSearchTool.js')
const { parseBaidu, parseDuckDuckGo } = await import('../utils/tools/searchParsers.js')

const realFetch = globalThis.fetch
let calls = []

function stubFetch(handler) {
  calls = []
  globalThis.fetch = async (url, options) => {
    const call = { url: String(url), options }
    calls.push(call)
    return handler(call)
  }
}

afterEach(() => {
  globalThis.fetch = realFetch
  calls = []
})

function html(body, { status = 200, headers = {} } = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers }
  })
}

function redirect(location, status = 302) {
  return new Response(null, { status, headers: { location } })
}

/**
 * 假时钟：替换 `Date.now`，把 20 秒总预算「快进」掉。
 *
 * 生产代码判断剩余时间只读 `Date.now()`，所以不需要 mock 定时器，也不用真等 20 秒——
 * 桩每被调用一次就往前拨一段，剩下的时间自然变成 0。
 * @returns {{ advance: (ms: number) => void, restore: () => void }}
 */
function fakeClock() {
  const real = Date.now
  let now = real()
  Date.now = () => now
  return {
    advance: ms => { now += ms },
    restore: () => { Date.now = real }
  }
}

describe('网页读取', () => {
  test('正常页面：统一契约头、标题与 Markdown 正文，脚本样式不进正文', async () => {
    stubFetch(() => html(`<html><head><title>示例标题</title><style>p{color:red}</style></head>
      <body><article><h1>示例标题</h1><p>正文第一段</p></article><script>alert('bad')</script></body></html>`))

    const out = await new WebsiteTool().func({ url: 'https://93.184.216.34/page' })

    assert.match(out, /^Web page content from 本地抓取 for https:\/\/93\.184\.216\.34\/page \(untrusted external data/)
    assert.match(out, /Title: 示例标题/)
    assert.match(out, /正文第一段/)
    assert.doesNotMatch(out, /alert\('bad'\)/)
  })

  test('内联 data: 图片不进正文，正常外链图片保留', async () => {
    // 站点的内联 SVG logo 转换后是一整段 base64，实测能占掉 41–61% 的正文
    stubFetch(() => html(`<html><head><title>带图</title></head><body>
      <p>正文</p>
      <img src="data:image/svg+xml;base64,QUJDREVG" alt="logo">
      <img src="https://93.184.216.34/a.png" alt="外链图">
      </body></html>`))

    const out = await new WebsiteTool().func({ url: 'https://93.184.216.34/img' })

    assert.doesNotMatch(out, /QUJDREVG/)
    assert.match(out, /93\.184\.216\.34\/a\.png/)
  })

  test('续读：按截断标记里的 start 再调一次能拿到后续片段', async () => {
    const body = `<html><head><title>长文</title></head><body><p>${'a'.repeat(20000)}${'B'.repeat(1000)}</p></body></html>`
    stubFetch(() => html(body))
    const tool = new WebsiteTool()

    const first = await tool.func({ url: 'https://93.184.216.34/long' })
    const marker = /continue with start=(\d+)/.exec(first)
    assert.ok(marker, '第一段应当带续读标记')

    const second = await tool.func({ url: 'https://93.184.216.34/long', start: Number(marker[1]) })
    assert.doesNotMatch(second, /continue with start=/)
    assert.match(second, /BBBB/)
  })

  test('私网地址：直接拒绝，且一个请求都不发', async () => {
    stubFetch(() => {
      throw new Error('不该发出请求')
    })

    // 覆盖 loopback / 私有 / 链路本地 / 0.0.0.0 与两种 IPv4-mapped 写法：只查 v6 段时
    // `::ffff:7f00:1` 不命中任何一条，整套 v4 私网会被绕过
    for (const url of [
      'http://127.0.0.1:6099/',
      'http://10.1.2.3/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]/'
    ]) {
      const out = await new WebsiteTool().func({ url })
      assert.match(out, /拒绝访问私网地址/, url)
    }
    assert.equal(calls.length, 0)
  })

  test('GBK 页面按 meta charset 解码，不乱码', async () => {
    // 整个页面（含标题）都是 GBK 字节：「中文标题」= d6d0 cec4 b1ea cce2，「中文」= d6d0 cec4
    const bytes = Buffer.concat([
      Buffer.from('<html><head><meta charset="gbk"><title>'),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb1, 0xea, 0xcc, 0xe2]),
      Buffer.from('</title></head><body><p>'),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
      Buffer.from('</p></body></html>')
    ])
    stubFetch(() => new Response(bytes, { status: 200, headers: { 'content-type': 'text/html' } }))

    const out = await new WebsiteTool().func({ url: 'https://93.184.216.34/gbk' })

    assert.match(out, /Title: 中文标题/)
    assert.match(out, /中文/)
  })

  test('非文本内容、403、超时、字节上限都返回可归因的失败', async () => {
    const tool = new WebsiteTool()

    stubFetch(() => new Response('%PDF-1.5', { status: 200, headers: { 'content-type': 'application/pdf' } }))
    assert.match(await tool.func({ url: 'https://93.184.216.34/a.pdf' }), /不支持的内容类型：application\/pdf/)

    stubFetch(() => html('拒绝访问', { status: 403 }))
    assert.match(await tool.func({ url: 'https://93.184.216.34/deny' }), /HTTP 403/)

    stubFetch(() => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      throw error
    })
    assert.match(await tool.func({ url: 'https://93.184.216.34/slow' }), /请求超时/)

    stubFetch(() => new Response('x', { status: 200, headers: { 'content-type': 'text/html', 'content-length': '6000000' } }))
    assert.match(await tool.func({ url: 'https://93.184.216.34/huge' }), /响应体过大/)
  })

  test('重定向：跟随并报告最终地址；超过 5 跳就放弃', async () => {
    const tool = new WebsiteTool()

    stubFetch(call => call.url.includes('93.184.216.34')
      ? redirect('https://93.184.216.35/next')
      : html('<html><head><title>跳转后</title></head><body><p>落地页正文</p></body></html>'))
    const followed = await tool.func({ url: 'https://93.184.216.34/start' })
    assert.match(followed, /https:\/\/93\.184\.216\.35\/next/)
    assert.match(followed, /落地页正文/)
    assert.equal(calls.length, 2)

    stubFetch(() => redirect('https://93.184.216.34/loop'))
    assert.match(await tool.func({ url: 'https://93.184.216.34/loop' }), /重定向超过 5 跳/)
    assert.equal(calls.length, 6)
  })
})

describe('搜索', () => {
  test('百度取 mu 的真实地址、DuckDuckGo 解 uddg', () => {
    const baidu = parseBaidu(`<div class="result c-container"><h3 class="t"><a href="http://www.baidu.com/link?url=abc">标题甲</a></h3><div class="cos-color-text-tiny summary-text_15QGa"><em>摘要</em>甲正文</div><div mu="https://real.example.com/a"></div></div>`)
    assert.equal(baidu[0].url, 'https://real.example.com/a')
    assert.equal(baidu[0].title, '标题甲')
    assert.match(baidu[0].snippet, /摘要.*甲正文/)

    const ddg = parseDuckDuckGo(`<div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2F93.184.216.36%2Fb">标题乙</a><a class="result__snippet">摘要乙</a></div>`)
    assert.equal(ddg[0].url, 'https://93.184.216.36/b')
    assert.equal(ddg[0].snippet, '摘要乙')
  })

  test('搜索页 302 到私网：拒绝跟随，换下一个引擎', async () => {
    stubFetch(call => {
      if (call.url.includes('cn.bing.com')) return redirect('http://127.0.0.1:6099/')
      if (call.url.includes('html.duckduckgo.com')) {
        return html('<div class="result results_links"><a class="result__a" href="https://93.184.216.36/ok">降级结果</a></div>')
      }
      return html('<html><head><title>落地页</title></head><body><p>正文</p></body></html>')
    })

    const out = await new Misaka_WebSearchTool().func({ query: '关键词' })

    assert.equal(calls.filter(call => call.url.includes('127.0.0.1')).length, 0, '重定向目标不该被请求')
    assert.match(out, /本地搜索 \(DuckDuckGo\)/)
  })

  test('Bing 失败时降级到 DuckDuckGo，并用后者作为来源', async () => {
    stubFetch(call => {
      if (call.url.includes('cn.bing.com')) return html('被限流', { status: 500 })
      if (call.url.includes('html.duckduckgo.com')) {
        return html(`<div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2F93.184.216.36%2Fb">降级结果</a><a class="result__snippet">来自 DuckDuckGo</a></div>`)
      }
      return html('<html><head><title>落地页</title></head><body><p>正文摘录</p></body></html>')
    })

    const out = await new Misaka_WebSearchTool().func({ query: '某个关键词', max_results: 3 })

    assert.match(out, /本地搜索 \(DuckDuckGo\)/)
    assert.match(out, /## 1\. \[降级结果\]\(https:\/\/93\.184\.216\.36\/b\)/)
    assert.match(out, /来自 DuckDuckGo/)
    assert.match(out, /正文摘录/)
  })

  test('并发抓正文时单条失败不影响其余结果', async () => {
    stubFetch(call => {
      if (call.url.includes('cn.bing.com')) {
        return html(`
          <li class="b_algo"><h2><a href="https://93.184.216.36/ok">第一条</a></h2><p>摘要一</p></li>
          <li class="b_algo"><h2><a href="https://93.184.216.37/bad">第二条</a></h2><p>摘要二</p></li>
          <li class="b_algo"><h2><a href="https://93.184.216.38/boom">第三条</a></h2><p>摘要三</p></li>`)
      }
      if (call.url.includes('93.184.216.36')) return html('<html><head><title>一</title></head><body><p>第一条的正文</p></body></html>')
      if (call.url.includes('93.184.216.37')) return html('炸了', { status: 500 })
      throw new Error('连接被重置')
    })

    const out = await new Misaka_WebSearchTool().func({ query: '关键词', max_results: 3 })

    assert.match(out, /第一条的正文/)
    assert.match(out, /\[第二条\]\(https:\/\/93\.184\.216\.37\/bad\)/)
    assert.match(out, /\[第三条\]\(https:\/\/93\.184\.216\.38\/boom\)/)
  })

  test('总预算：第一个引擎就吃满 20 秒后，后两个引擎不再执行', async () => {
    const clock = fakeClock()
    try {
      stubFetch(() => {
        clock.advance(20000)
        return html('被限流', { status: 500 })
      })

      const out = await new Misaka_WebSearchTool().func({ query: '关键词' })

      assert.equal(calls.length, 1, '预算已用完，不该再打第二个引擎')
      assert.match(out, /Bing: HTTP 500/)
      assert.match(out, /DuckDuckGo: 总预算 20 秒已用完，未执行/)
      assert.match(out, /百度: 总预算 20 秒已用完，未执行/)
    } finally {
      clock.restore()
    }
  })

  test('总预算：引擎用光预算后不再为正文发请求', async () => {
    const clock = fakeClock()
    const warned = []
    const realWarn = globalThis.logger.warn
    globalThis.logger.warn = message => warned.push(String(message))
    try {
      stubFetch(call => {
        if (call.url.includes('cn.bing.com')) {
          clock.advance(20000)
          return html('<li class="b_algo"><h2><a href="https://93.184.216.36/ok">唯一结果</a></h2><p>摘要一</p></li>')
        }
        throw new Error('不该再发请求')
      })

      const out = await new Misaka_WebSearchTool().func({ query: '关键词', max_results: 3 })

      assert.equal(calls.length, 1, '抓正文不在预算里，不该再发请求')
      assert.match(out, /唯一结果/)
      assert.match(out, /摘要一/)
      assert.equal(warned.filter(line => line.includes('总预算已用完')).length, 1, '被跳过的正文要留下原因')
    } finally {
      globalThis.logger.warn = realWarn
      clock.restore()
    }
  })

  test('max_results 越界直接报错，不发请求', async () => {
    stubFetch(() => {
      throw new Error('不该发出请求')
    })
    const tool = new Misaka_WebSearchTool()

    assert.match(await tool.func({ query: '关键词', max_results: 0 }), /应在 1-20 之间/)
    assert.match(await tool.func({ query: '关键词', max_results: 21 }), /应在 1-20 之间/)
    assert.match(await tool.func({ query: '   ' }), /搜索关键词不能为空/)
    assert.equal(calls.length, 0)
  })
})
