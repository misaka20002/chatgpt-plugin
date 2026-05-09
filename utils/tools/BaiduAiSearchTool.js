import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'

/** 使用百度 AI 搜索（千帆/AppBuilder）并获得结果摘要的工具 */
export class BaiduAISearchTool extends AbstractTool {
    name = 'baidu_AI_Search_Tool'

    parameters = {
        properties: {
            query: {
                type: 'string',
                description: '完整的自然语言提问或详细的搜索诉求，不超过72个字'
            },
            top_k: {
                type: 'number',
                description: 'Optional. Number of web results to return. Maximum 50.',
                default: 10
            },
            search_recency_filter: {
                type: 'string',
                description: 'Optional. Time range filter. One of "week", "month", "semiyear", "year".',
                enum: ['week', 'month', 'semiyear', 'year']
            },
            site: {
                type: 'string',
                description: 'Optional. Restrict search to specific sites, separated by commas or pipes.'
            }
        },
        required: ['query']
    }

    func = async function (opts) {
        const {
            query,
            top_k = 10,
            search_recency_filter,
            site
        } = opts

        const apiKey = Config.getBaiduAppBuilderKey
        if (!apiKey) {
            throw new Error('Baidu AI Search API key is not configured in Config.')
        }

        // 处理 top_k 范围 (1-50)
        const limitK = Math.min(Math.max(top_k, 1), 50)

        // 截取 query 前 72 个字符
        const safeQuery = String(query).substring(0, 72)

        // 构建基础请求载荷
        const payload = {
            messages: [{ role: 'user', content: safeQuery }],
            search_source: 'baidu_search_v2',
            resource_type_filter:[{ type: 'web', top_k: limitK }]
        }

        // 验证和设置时间范围过滤
        if (search_recency_filter && ['week', 'month', 'semiyear', 'year'].includes(search_recency_filter)) {
            payload.search_recency_filter = search_recency_filter
        }

        // 处理 site 限制
        if (site) {
            // 将 "|" 替换为 "," 然后通过 "," 分割，去除首尾空格并过滤空字符串
            const sites = site.replace(/\|/g, ',').split(',').map(s => s.trim()).filter(s => s)
            if (sites.length > 0) {
                // 最多保留 100 个站点限制，与 Python 中的 sites[:100] 对应
                payload.search_filter = { match: { site: sites.slice(0, 100) } }
            }
        }

        try {
            // 调用百度千帆 API 接口
            const response = await fetch('https://qianfan.baidubce.com/v2/ai_search/web_search', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'X-Appbuilder-Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                timeout: 60000 // 设置 60 秒超时
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Baidu AI Search API error: ${errorText} (Status: ${response.status})`)
            }

            const data = await response.json()
            const references = data.references ||[]

            // 过滤出含有 url 的有效结果
            const validResults = references.filter(item => item.url)

            if (!validResults.length) {
                return `未找到与"${query}"相关的百度搜索结果。`
            }

            // 格式化搜索结果
            const formattedResults =[]
            validResults.forEach((result, index) => {
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
            const summary = `=== 百度 AI 搜索结果 ===\n` +
                            `搜索关键词: ${query}\n` +
                            `返回结果: ${validResults.length} 个\n\n`

            const finalResult = summary + formattedResults.join('').trim()

            return finalResult

        } catch (error) {
            console.error('Baidu AI search error:', error)
            throw new Error(`搜索失败: ${error.message}`)
        }
    }

    description = 'A web search tool based on Baidu AI Search. Use this for real-time web retrieval when Baidu AI Search is configured. Ideal for getting the latest information, news, and searching Chinese internet content.'
}