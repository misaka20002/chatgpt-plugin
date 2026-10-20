import { AbstractTool } from './AbstractTool.js'
import { fetchLocalPage, fetchRawHtml } from './localFetch.js'
import { parseBaidu, parseBing, parseDuckDuckGo } from './searchParsers.js'
import { UNTRUSTED_NOTICE, capForModel } from './webContent.js'

/**
 * 纯本地搜索：不经过任何第三方服务，直接抓三个搜索引擎的结果页。
 *
 * 它是兜底工具——没有 Key、也没装 Python 时还能搜一点东西。代价写在工具描述里：
 * 站点改版、限流、地区封锁都会让它当场失效，失败时给出可归因的原因，不做静默降级。
 */

const ENGINE_TIMEOUT_MS = 15000

/**
 * 整次搜索（引擎轮询 + 抓正文）的总预算。两个阶段共用一个 deadline，因为旧实现最坏要
 * 3 × 15 秒引擎 + 8 秒正文 ≈ 53 秒——一次工具调用不该占住这么久。
 */
const SEARCH_BUDGET_MS = 20000

/** 抓正文阶段自己的上限：三条并发，整体最多等这么久（总预算剩得更少时按剩余的算） */
const BODY_TIMEOUT_MS = 8000

/** 只给前几条抓正文；再多就是拿延迟换信息量 */
const BODY_RESULT_COUNT = 3

const BODY_CHARS = 2000

const MAX_RESULTS = 20

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

async function searchWith(engine, query, limit, timeoutMs) {
  // 地址由上面的 ENGINES 拼出来，不含模型输入，所以走不设防的 fetchRawHtml（模型给的 URL 走 fetchLocalPage）
  const { text } = await fetchRawHtml(engine.build(query, limit), { timeoutMs })
  return engine.parse(text)
    .filter(item => /^https?:\/\//i.test(item.url))
    .slice(0, limit)
}

/**
 * 给前几条结果并发补正文。抓不到就留空——一条正文失败不该影响整次搜索，但原因要记下来，
 * 否则「为什么这条没有正文」在日志里查不到。
 * @param {{ title: string, url: string, snippet: string, excerpt?: string }[]} results
 * @param {number} deadline 整次搜索的截止时刻：抓正文与引擎轮询共用一个预算
 */
async function attachExcerpts(results, deadline) {
  const targets = results.slice(0, BODY_RESULT_COUNT)
  const outcomes = await Promise.allSettled(
    targets.map(async item => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error('搜索总预算已用完，未抓正文')
      }
      return fetchLocalPage(item.url, { timeoutMs: Math.min(BODY_TIMEOUT_MS, remaining) })
    })
  )
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      targets[index].excerpt = outcome.value.text.slice(0, BODY_CHARS)
      return
    }
    globalThis.logger?.warn?.(`[chatgpt][web_search] 正文抓取失败 ${targets[index].url}：${outcome.reason?.message || outcome.reason}`)
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
    const deadline = Date.now() + SEARCH_BUDGET_MS
    let hit
    for (const engine of ENGINES) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        failures.push(`${engine.label}: 总预算 ${SEARCH_BUDGET_MS / 1000} 秒已用完，未执行`)
        continue
      }
      try {
        const results = await searchWith(engine, query, limit, Math.min(ENGINE_TIMEOUT_MS, remaining))
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

    await attachExcerpts(hit.results, deadline)

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

  description = '用本机网络直接搜索 Bing、DuckDuckGo、百度，返回标题、真实链接、摘要和前几条的正文摘录。百度结果常常没有摘要（页面结构所致），只剩标题与链接。它不经过任何第三方服务，也不绕过反爬：站点限流或改版时可能搜不到，失败会说明是哪个引擎、什么原因。需要更稳的搜索时改用其它已配置的搜索来源。'
}
