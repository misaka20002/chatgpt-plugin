/**
 * 三个搜索引擎结果页的解析器：HTML 字符串进，`{ title, url, snippet }[]` 出。
 *
 * 单独放一个文件，是因为它们的失效原因与工具本身无关：**站点改版就断**，而工具的其余部分
 * （引擎降级、总预算、并发抓正文）不受影响。也正因为它们最脆，改这里之前先拿真实结果页
 * 跑一遍，别只对着正则推理。
 */

import { decodeEntities, stripTags } from './htmlText.js'

/** 标题上限：结果页偶尔会把整段正文塞进标题链接 */
const MAX_TITLE_CHARS = 200

/**
 * 解析 Bing 结果页。结果块是 `li.b_algo`，标题链接在 `h2 > a`，摘要在块内第一个 `<p>`。
 * @param {string} html
 * @returns {{ title: string, url: string, snippet: string }[]}
 */
export function parseBing(html) {
  const results = []
  for (const block of String(html).split(/<li[^>]*class="[^"]*b_algo[^"]*"/i).slice(1)) {
    const anchor = /<h2[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (!anchor) continue
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)
    results.push({
      title: stripTags(anchor[2]).slice(0, MAX_TITLE_CHARS),
      url: decodeEntities(anchor[1]),
      snippet: snippet ? stripTags(snippet[1]) : ''
    })
  }
  return results
}

/**
 * 解析 DuckDuckGo 的 HTML 版结果页。链接类名是 `result__a`，真实地址在 `uddg` 参数里，
 * 需要 URL 解码一次；摘要类名是 `result__snippet`。
 * @param {string} html
 * @returns {{ title: string, url: string, snippet: string }[]}
 */
export function parseDuckDuckGo(html) {
  const results = []
  for (const block of String(html).split(/class="result results_links/i).slice(1)) {
    const anchor = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (!anchor) continue
    const href = /href="([^"]+)"/i.exec(anchor[0])
    if (!href) continue
    let url = decodeEntities(href[1])
    const target = /[?&]uddg=([^&]+)/.exec(url)
    if (target) {
      try {
        url = decodeURIComponent(target[1])
      } catch {
        // 编码坏了就保留原链接，至少还能点开
      }
    } else if (url.startsWith('//')) {
      url = `https:${url}`
    }
    const snippet = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    results.push({
      title: stripTags(anchor[1]).slice(0, MAX_TITLE_CHARS),
      url,
      snippet: snippet ? stripTags(snippet[1]) : ''
    })
  }
  return results
}

/**
 * 解析百度结果页。`h3 > a` 的 href 是 `baidu.com/link?url=…` 跳转链，真实地址在结果块的
 * `mu` 属性里——必须用 `mu`，否则模型拿到的是没法判断来源的跳转链接。
 * @param {string} html
 * @returns {{ title: string, url: string, snippet: string }[]}
 */
export function parseBaidu(html) {
  const results = []
  for (const block of String(html).split(/<div[^>]*class="result/i).slice(1)) {
    if (!block.includes('<h3')) continue
    const anchor = /<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
    if (!anchor) continue
    const real = /\smu="([^"]+)"/i.exec(block)
    results.push({
      title: stripTags(anchor[2]).slice(0, MAX_TITLE_CHARS),
      url: decodeEntities(real ? real[1] : anchor[1]),
      snippet: ''
    })
  }
  return results
}
