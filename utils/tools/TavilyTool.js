import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'

/** 使用 Tavily 搜索并获得结果摘要的工具 */
export class TavilyTool extends AbstractTool {
    name = 'tavily_search'

    parameters = {
        properties: {
            q: {
                type: 'string',
                description: 'Search query. Using natural language questions'
            },
            max_results: {
                type: 'number', 
                description: 'Maximum number of results to return (5-20)',
                default: 5
            },
            search_depth: {
                type: 'string',
                description: 'Search depth: basic or advanced',
                enum: ['basic', 'advanced'],
                default: 'basic'
            },
            topic: {
                type: 'string', 
                description: 'Search topic: general or news',
                enum: ['general', 'news'],
                default: 'general'
            },
            days: {
                type: 'number',
                description: 'Days back from current date (only for news topic)',
                default: 3
            },
            time_range: {
                type: 'string',
                description: 'Time range: day, week, month, year',
                enum: ['day', 'week', 'month', 'year']
            },
            start_date: {
                type: 'string',
                description: 'Start date in YYYY-MM-DD format'
            },
            end_date: {
                type: 'string', 
                description: 'End date in YYYY-MM-DD format'
            }
        },
        required: ['q']
    }

    func = async function (opts) {
        const {
            q: query,
            max_results = 5,
            search_depth = 'basic',
            topic = 'general',
            days = 3,
            time_range,
            start_date,
            end_date
        } = opts

        // 获取 Tavily API 密钥
        const tavilyKey = Config.getTavilyKey
        if (!tavilyKey) {
            throw new Error('Tavily API key is not configured')
        }

        // 构建请求载荷
        const payload = {
            query,
            max_results: Math.min(Math.max(max_results, 5), 20)
        }

        // 验证和设置搜索深度
        if (['basic', 'advanced'].includes(search_depth)) {
            payload.search_depth = search_depth
        } else {
            payload.search_depth = 'basic'
        }

        // 验证和设置主题
        if (['general', 'news'].includes(topic)) {
            payload.topic = topic
        } else {
            payload.topic = 'general'
        }

        // 如果是新闻主题，添加天数
        if (topic === 'news') {
            payload.days = days
        }

        // 添加时间范围参数
        if (time_range && ['day', 'week', 'month', 'year'].includes(time_range)) {
            payload.time_range = time_range
        }

        if (start_date) {
            payload.start_date = start_date
        }

        if (end_date) {
            payload.end_date = end_date
        }

        try {
            // 调用 Tavily API
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tavilyKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                timeout: 10000
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Tavily API error: ${errorText} (Status: ${response.status})`)
            }

            const data = await response.json()
            const results = data.results || []

            if (!results.length) {
                return `未找到与"${query}"相关的搜索结果。`
            }

            // 格式化搜索结果
            const formattedResults = []
            results.forEach((result, index) => {
                const title = result.title || '无标题'
                const url = result.url || ''
                const content = result.content || '无内容摘要'

                formattedResults.push(
                    `${index + 1}. ${title}\n` +
                    `链接: ${url}\n` +
                    `摘要: ${content}\n\n`
                )
            })

            // 添加搜索总结信息
            const totalResults = data.total_results || results.length
            const processedResults = results.length
            
            const summary = `=== Tavily 搜索结果 ===\n` +
                          `搜索关键词: ${query}\n` +
                          `搜索深度: ${search_depth}\n` +
                          `搜索主题: ${topic}\n` +
                          `找到结果: ${totalResults} 个\n` +
                          `返回结果: ${processedResults} 个\n\n`

            const finalResult = summary + formattedResults.join('').trim()

            // 如果启用了链接显示，添加使用提示
            const linkTip = '\n\n💡 提示: 如需了解详细内容，可使用网页提取工具获取完整页面信息。'

            return finalResult + linkTip

        } catch (error) {
            console.error('Tavily search error:', error)
            throw new Error(`搜索失败: ${error.message}`)
        }
    }

    description = 'A powerful web search tool using Tavily API. Ideal for gathering current information, news, and detailed web content analysis. When formatting your search query (q), prefer writing complete, conversational questions.'
}