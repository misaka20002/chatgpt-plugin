import { AbstractTool } from './AbstractTool.js'

/**
 * 网页搜索工具： Google → Bing → 搜狗 → DuckDuckGo
 */
export class Misaka_WebSearchTool extends AbstractTool {
    name = 'web_search'

    parameters = {
        properties: {
            query: {
                type: 'string',
                description: '和用户的问题最相关的搜索关键词，用于在网络上搜索'
            },
            max_results: {
                type: 'number',
                description: '返回的最大搜索结果数量，默认为 5',
                default: 5
            }
        },
        required: ['query']
    }

    description = '搜索网络以回答用户的问题。当用户需要搜索网络以获取即时性的信息时调用此工具。支持搜索关键词和指定最大结果数量。'

    // LLM调用的Tool
    func = async function (opts) {
        const { query, max_results = 5 } = opts

        if (!query || typeof query !== 'string') {
            return 'Error: 搜索关键词不能为空'
        }

        if (max_results < 1 || max_results > 20) {
            return 'Error: 搜索结果数量应在 1-20 之间'
        }

        console.log(`web_searcher - search_from_search_engine: ${query}`)

        try {
            // 获取搜索结果
            const results = await this.webSearchDefault(query, max_results)

            if (!results || results.length === 0) {
                return 'Error: 网络搜索没有返回任何结果，请尝试不同的关键词'
            }

            console.log(`Processing ${results.length} search results...`)

            // 并行处理搜索结果，但限制并发数量以避免过载
            const batchSize = 3 // 一次处理3个结果
            const processedResults = []

            for (let i = 0; i < results.length; i += batchSize) {
                const batch = results.slice(i, i + batchSize)
                const batchPromises = batch.map((result, batchIndex) =>
                    this.processSearchResult(result, i + batchIndex + 1, false)
                )

                const batchResults = await Promise.allSettled(batchPromises)

                for (const processed of batchResults) {
                    if (processed.status === 'fulfilled') {
                        processedResults.push(processed.value)
                    } else {
                        console.error('Error processing search result:', processed.reason?.message || processed.reason)
                        // 添加一个简化的结果作为备用
                        const failedIndex = processedResults.length + 1
                        const originalResult = results[failedIndex - 1]
                        if (originalResult) {
                            processedResults.push(`${failedIndex}. ${originalResult.title}\n${originalResult.snippet || '内容获取失败'}\n${originalResult.url}\n\n`)
                        }
                    }
                }
            }

            if (processedResults.length === 0) {
                return 'Error: 处理搜索结果时发生错误，请稍后重试'
            }

            let finalResult = processedResults.join('')

            // 添加搜索总结信息
            const summary = `\n=== 搜索总结 ===\n搜索关键词: ${query}\n找到 ${results.length} 个结果\n处理成功 ${processedResults.length} 个结果\n\n`

            return summary + finalResult.trim()

        } catch (error) {
            console.error('Web search error:', error)
            return `Error: 网络搜索失败 - ${error.message || '未知错误'}。请检查网络连接或稍后重试。`
        }
    }.bind(this)

    constructor() {
        super()
        // User-Agent 池，随机选择以避免被屏蔽
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0'
        ]

        this.headers = {
            'Accept': '*/*',
            'Connection': 'keep-alive',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache'
        }
    }

    // 获取随机 User-Agent
    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
    }

    // 清理文本，去除多余的空格和换行符
    tidyText(text) {
        if (!text) return ''
        return text.trim()
            .replace(/\n/g, ' ')
            .replace(/\r/g, ' ')
            .replace(/\s+/g, ' ') // 将多个空格替换为单个空格
    }

    // 从 URL 获取网页内容
    async getFromUrl(url) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    ...this.headers,
                    'User-Agent': this.getRandomUserAgent()
                },
                signal: AbortSignal.timeout(6000) // 6秒超时
            })

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }

            const html = await response.text()

            let content = this.extractMainContent(html)

            return this.tidyText(content)
        } catch (error) {
            console.error(`Error fetching content from ${url}:`, error.message)
            return ''
        }
    }

    // 提取网页主要内容 (模拟readability库功能)
    extractMainContent(html) {
        try {
            // 移除脚本和样式
            let content = html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
                .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
                .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
                .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '')

            // 尝试提取主要内容区域
            const mainContentPatterns = [
                /<main[^>]*>(.*?)<\/main>/is,
                /<article[^>]*>(.*?)<\/article>/is,
                /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/is,
                /<div[^>]*id="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/is,
                /<div[^>]*class="[^"]*main[^"]*"[^>]*>(.*?)<\/div>/is
            ]

            for (const pattern of mainContentPatterns) {
                const match = content.match(pattern)
                if (match && match[1] && match[1].length > 200) {
                    content = match[1]
                    break
                }
            }

            // 移除所有HTML标签
            content = content
                .replace(/<[^>]*>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#\d+;/g, ' ')
                .replace(/&[a-zA-Z]+;/g, ' ')

            return content
        } catch (error) {
            console.error('Error extracting main content:', error.message)
            return html.replace(/<[^>]*>/g, ' ')
        }
    }

    // 使用 Google 搜索 (通过 googlesearch-to-api.vercel.app)
    async searchGoogle(query, numResults) {
        try {
            // 使用免费的Google搜索API代理服务
            const response = await fetch(`https://googlesearch-to-api.vercel.app/?query=${encodeURIComponent(query)}&limit=${numResults}`, {
                headers: {
                    'User-Agent': this.getRandomUserAgent()
                }
            })

            if (!response.ok) {
                throw new Error(`Google search API error: ${response.status}`)
            }

            const data = await response.json()
            const results = []

            if (data.results && Array.isArray(data.results)) {
                for (const item of data.results.slice(0, numResults)) {
                    results.push({
                        title: item.title || '',
                        url: item.url || '',
                        snippet: item.description || ''
                    })
                }
            }

            return results
        } catch (error) {
            console.error('Google search error:', error.message)
            return []
        }
    }

    // 使用 Bing 搜索（网页爬虫方式）
    async searchBing(query, numResults) {
        try {
            const bingUrls = ['https://cn.bing.com', 'https://www.bing.com']

            for (const baseUrl of bingUrls) {
                try {
                    const searchUrl = `${baseUrl}/search?q=${encodeURIComponent(query)}`
                    const response = await fetch(searchUrl, {
                        headers: {
                            ...this.headers,
                            'User-Agent': this.getRandomUserAgent(),
                            'Referer': baseUrl
                        }
                    })

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`)
                    }

                    const html = await response.text()
                    const results = this.parseBingResults(html, numResults)

                    if (results.length > 0) {
                        return results
                    }
                } catch (error) {
                    console.log(`Trying next Bing URL due to error: ${error.message}`)
                    continue
                }
            }

            return []
        } catch (error) {
            console.error('Bing search error:', error.message)
            return []
        }
    }

    // 解析Bing搜索结果HTML
    parseBingResults(html, numResults) {
        const results = []
        try {
            // 使用正则表达式解析Bing搜索结果
            const resultPattern = /<li class="b_algo"[^>]*>(.*?)<\/li>/gs
            const matches = html.match(resultPattern) || []

            for (let i = 0; i < Math.min(matches.length, numResults); i++) {
                const match = matches[i]

                // 提取标题
                const titleMatch = match.match(/<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a><\/h2>/)
                if (!titleMatch) continue

                const url = titleMatch[1]
                const title = titleMatch[2].replace(/<[^>]*>/g, '').trim()

                // 提取描述片段
                const snippetMatch = match.match(/<p[^>]*>([^<]*)<\/p>/)
                const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : ''

                if (title && url) {
                    results.push({
                        title: this.tidyText(title),
                        url: url,
                        snippet: this.tidyText(snippet)
                    })
                }
            }
        } catch (error) {
            console.error('Error parsing Bing results:', error.message)
        }

        return results
    }

    // 使用搜狗搜索
    async searchSogou(query, numResults) {
        try {
            const searchUrl = `https://www.sogou.com/web?query=${encodeURIComponent(query)}`
            const response = await fetch(searchUrl, {
                headers: {
                    ...this.headers,
                    'User-Agent': this.getRandomUserAgent(),
                    'Referer': 'https://www.sogou.com/'
                }
            })

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }

            const html = await response.text()
            const results = this.parseSogouResults(html, numResults)

            return results
        } catch (error) {
            console.error('Sogou search error:', error.message)
            return []
        }
    }

    // 解析搜狗搜索结果HTML
    parseSogouResults(html, numResults) {
        const results = []
        try {
            // 使用正则表达式解析搜狗搜索结果
            const resultPattern = /<div class="vrwrap"[^>]*>(.*?)<\/div>/gs
            const matches = html.match(resultPattern) || []

            for (let i = 0; i < Math.min(matches.length, numResults); i++) {
                const match = matches[i]

                // 跳过广告或提示框
                if (match.includes('middle-better-hintBox')) continue

                // 提取标题和URL
                const titleMatch = match.match(/<h3[^>]*><a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a><\/h3>/)
                if (!titleMatch) continue

                let url = titleMatch[1]
                const title = titleMatch[2].replace(/<[^>]*>/g, '').trim()

                // 处理搜狗的重定向链接
                if (url.startsWith('/link?')) {
                    url = 'https://www.sogou.com' + url
                    // 注意：实际使用中可能需要进一步解析重定向URL
                }

                // 提取描述片段 (搜狗的结构可能不同，这里做简化处理)
                const snippet = ''

                if (title && url) {
                    results.push({
                        title: this.tidyText(title),
                        url: url,
                        snippet: snippet
                    })
                }
            }
        } catch (error) {
            console.error('Error parsing Sogou results:', error.message)
        }

        return results
    }

    // 使用 DuckDuckGo 搜索 (作为备用搜索引擎)
    async searchDuckDuckGo(query, numResults) {
        try {
            // DuckDuckGo 即时答案 API (免费，无需API密钥)
            const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
                headers: {
                    'User-Agent': this.getRandomUserAgent()
                }
            })

            if (!response.ok) {
                throw new Error(`DuckDuckGo search error: ${response.status}`)
            }

            const data = await response.json()
            const results = []

            // 处理相关主题
            if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
                for (let i = 0; i < Math.min(data.RelatedTopics.length, numResults); i++) {
                    const topic = data.RelatedTopics[i]
                    if (topic.FirstURL && topic.Text) {
                        results.push({
                            title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 50),
                            url: topic.FirstURL,
                            snippet: topic.Text
                        })
                    }
                }
            }

            // 如果没有相关主题，尝试抽象答案
            if (results.length === 0 && data.AbstractText && data.AbstractURL) {
                results.push({
                    title: data.Heading || query,
                    url: data.AbstractURL,
                    snippet: data.AbstractText
                })
            }

            return results
        } catch (error) {
            console.error('DuckDuckGo search error:', error.message)
            return []
        }
    }

    // 默认搜索方法，依次尝试不同搜索引擎 (顺序: Google → Bing → 搜狗 → DuckDuckGo)
    async webSearchDefault(query, numResults) {
        let results = []

        // 首先尝试 Google 搜索
        try {
            results = await this.searchGoogle(query, numResults)
            if (results.length > 0) {
                console.log(`Found ${results.length} results using Google`)
                return results
            }
        } catch (error) {
            console.log('Google search failed, trying next engine...', error.message)
        }

        // 如果 Google 失败，尝试 Bing 搜索
        try {
            results = await this.searchBing(query, numResults)
            if (results.length > 0) {
                console.log(`Found ${results.length} results using Bing`)
                return results
            }
        } catch (error) {
            console.log('Bing search failed, trying next engine...', error.message)
        }

        // 如果 Bing 失败，尝试搜狗搜索
        try {
            results = await this.searchSogou(query, numResults)
            if (results.length > 0) {
                console.log(`Found ${results.length} results using Sogou`)
                return results
            }
        } catch (error) {
            console.log('Sogou search failed, trying next engine...', error.message)
        }

        // 如果前面都失败，尝试 DuckDuckGo 搜索作为最后备用
        try {
            results = await this.searchDuckDuckGo(query, numResults)
            if (results.length > 0) {
                console.log(`Found ${results.length} results using DuckDuckGo`)
                return results
            }
        } catch (error) {
            console.log('DuckDuckGo search failed', error.message)
        }

        // 如果所有搜索引擎都失败了，返回一个简单的搜索建议
        console.log('All search engines failed')
        return [{
            title: `搜索建议: ${query}`,
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
            snippet: `无法直接获取搜索结果，建议手动搜索关键词: ${query}`
        }]
    }

    // 处理单个搜索结果
    async processSearchResult(result, index, includeLink = false) {
        console.log(`web_searcher - scraping web: ${result.title} - ${result.url}`)

        let siteContent = ''
        try {
            siteContent = await this.getFromUrl(result.url)
        } catch (error) {
            console.error(`Failed to fetch content from ${result.url}:`, error.message)
        }

        // 限制内容长度
        if (siteContent.length > 700) {
            siteContent = siteContent.substring(0, 700) + '...'
        }

        let header = `${index}. ${result.title} `
        if (includeLink && result.url) {
            header += result.url
        }

        return `${header}\n${result.snippet}\n${siteContent}\n\n`
    }
}