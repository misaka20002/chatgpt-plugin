import { AbstractTool } from './AbstractTool.js'
import { fetchText, fetchLocalPage } from './localFetch.js'
import { UNTRUSTED_NOTICE, capForModel } from './webContent.js'

/**
 * 纯本地搜索：不经过任何第三方服务，直接抓三个搜索引擎的结果页。
 *
 * 它是兜底工具——没有 Key、也没装 Python 时还能搜一点东西。代价写在工具描述里：
 * 站点改版、限流、地区封锁都会让它当场失效，失败时给出可归因的原因，不做静默降级。
 */

const ENGINE_TIMEOUT_MS = 15000

/** 结果页正文的抓取预算：三条并发，整体最多等这么久 */
const BODY_TIMEOUT_MS = 8000

/** 只给前几条抓正文；再多就是拿延迟换信息量 */
const BODY_RESULT_COUNT = 3

const BODY_CHARS = 2000

const MAX_RESULTS = 20

const MAX_TITLE_CHARS = 200

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeFromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => safeFromCodePoint(Number(code)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;|&emsp;|&thinsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

function safeFromCodePoint(code) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10FFFF) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

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

const ENGINES = [
  {
    label: 'Bing',
    build: (query, limit) => `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&count=${limit}`,
    parse: parseBing
  },
  {
    label: 'DuckDuckGo',
    build: query => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGo
  },
  {
    label: '百度',
    build: (query, limit) => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${limit}`,
    parse: parseBaidu
  }
]

async function searchWith(engine, query, limit) {
  const { text } = await fetchText(engine.build(query, limit), { timeoutMs: ENGINE_TIMEOUT_MS })
  return engine.parse(text)
    .filter(item => /^https?:\/\//i.test(item.url))
    .slice(0, limit)
}

/**
 * 给前几条结果并发补正文。抓不到就留空——一条正文失败不该影响整次搜索。
 * @param {{ title: string, url: string, snippet: string, excerpt?: string }[]} results
 */
async function attachExcerpts(results) {
  const targets = results.slice(0, BODY_RESULT_COUNT)
  const outcomes = await Promise.allSettled(
    targets.map(item => fetchLocalPage(item.url, { timeoutMs: BODY_TIMEOUT_MS }))
  )
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      targets[index].excerpt = outcome.value.text.slice(0, BODY_CHARS)
    }
  })
}

export class Misaka_WebSearchTool extends AbstractTool {
  name = 'web_search'

  parameters = {
    properties: {
      query: {
        type: 'string',
        description: '和用户的问题最相关的搜索关键词'
      },
      max_results: {
        type: 'number',
        description: `返回的最大搜索结果数量，默认 5，范围 1-${MAX_RESULTS}`,
        default: 5
      }
    },
    required: ['query']
  }

  func = async function (opts) {
    const query = typeof opts.query === 'string' ? opts.query.trim() : ''
    if (!query) {
      return 'Error: 搜索关键词不能为空'
    }
    const rawLimit = Number(opts.max_results ?? 5)
    const limit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5
    if (limit < 1 || limit > MAX_RESULTS) {
      return `Error: 搜索结果数量应在 1-${MAX_RESULTS} 之间`
    }

    const failures = []
    let hit
    for (const engine of ENGINES) {
      try {
        const results = await searchWith(engine, query, limit)
        if (results.length) {
          hit = { engine, results }
          break
        }
        failures.push(`${engine.label}: 解析不到结果`)
      } catch (err) {
        failures.push(`${engine.label}: ${err?.message || err}`)
      }
    }

    if (!hit) {
      return `Error: 三个搜索引擎都没有返回结果（可能被限流或页面结构变化）\n${failures.join('\n')}`
    }

    await attachExcerpts(hit.results)

    const blocks = hit.results.map((item, index) => {
      const lines = [`## ${index + 1}. [${item.title || item.url}](${item.url})`]
      if (item.snippet) lines.push(item.snippet)
      if (item.excerpt) lines.push('', item.excerpt)
      return lines.join('\n')
    })

    return capForModel(
      `Web search results from 本地搜索 (${hit.engine.label}) for "${query}" (${UNTRUSTED_NOTICE}):\n\n${blocks.join('\n\n')}`
    )
  }.bind(this)

  description = '用本机网络直接搜索 Bing、DuckDuckGo、百度，返回标题、真实链接、摘要和前几条的正文摘录。它不经过任何第三方服务，也不绕过反爬：站点限流或改版时可能搜不到，失败会说明是哪个引擎、什么原因。需要更稳的搜索时改用其它已配置的搜索来源。'
}
