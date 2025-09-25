import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'

/** 使用 Tavily 搜索并提取完整内容的组合工具 */
export class TavilySearchAndExtractTool extends AbstractTool {
    name = 'tavily_search_and_extract'

    parameters = {
        properties: {
            q: {
                type: 'string',
                description: 'Search query'
            },
            max_results: {
                type: 'number', 
                description: 'Maximum number of results to search and extract (2-10)',
                default: 5
            },
            search_depth: {
                type: 'string',
                description: 'Search depth: basic or advanced',
                enum: ['basic', 'advanced'],
                default: 'basic'
            },
            extract_depth: {
                type: 'string',
                description: 'Extraction depth: basic or advanced',
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
            }
        },
        required: ['q']
    }

    func = async function (opts) {
        const {
            q: query,
            max_results = 5,
            search_depth = 'basic',
            extract_depth = 'basic',
            topic = 'general',
            days = 3,
            time_range
        } = opts

        // 限制最大结果数以避免过多请求
        const limitedResults = Math.min(Math.max(max_results, 2), 10)

        // 获取 Tavily API 密钥
        const tavilyKey = Config.getTavilyKey
        if (!tavilyKey) {
            throw new Error('Tavily API key is not configured')
        }

        try {
            // 第一步：执行搜索
            logger.info(`[Tavily] 开始搜索: "${query}"`)
            
            const searchPayload = {
                query,
                max_results: limitedResults,
                search_depth,
                topic
            }

            if (topic === 'news') {
                searchPayload.days = days
            }

            if (time_range && ['day', 'week', 'month', 'year'].includes(time_range)) {
                searchPayload.time_range = time_range
            }

            const searchResponse = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tavilyKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(searchPayload),
                timeout: 10000
            })

            if (!searchResponse.ok) {
                const errorText = await searchResponse.text()
                throw new Error(`Tavily search failed: ${errorText} (Status: ${searchResponse.status})`)
            }

            const searchData = await searchResponse.json()
            const searchResults = searchData.results || []

            if (!searchResults.length) {
                return `未找到与"${query}"相关的搜索结果。`
            }

            logger.info(`[Tavily] 找到 ${searchResults.length} 个搜索结果，开始提取网页内容...`)

            // 第二步：并行提取每个搜索结果的网页内容
            const extractionPromises = searchResults.map(async (result, index) => {
                const url = result.url
                if (!url) {
                    return {
                        index: index + 1,
                        title: result.title || '无标题',
                        url: 'N/A',
                        success: false,
                        error: 'URL为空',
                        content: result.content || '无内容摘要'
                    }
                }

                try {
                    logger.info(`[Tavily] 提取第 ${index + 1} 个网页: ${url}`)
                    
                    const extractPayload = {
                        urls: [url],
                        extract_depth
                    }

                    const extractResponse = await fetch('https://api.tavily.com/extract', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${tavilyKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(extractPayload),
                        timeout: 20000 // 网页提取需要更多时间
                    })

                    if (!extractResponse.ok) {
                        throw new Error(`HTTP ${extractResponse.status}`)
                    }

                    const extractData = await extractResponse.json()
                    const extractResults = extractData.results || []
                    
                    if (extractResults.length > 0 && extractResults[0].raw_content) {
                        return {
                            index: index + 1,
                            title: result.title || extractResults[0].title || '无标题',
                            url: url,
                            success: true,
                            content: extractResults[0].raw_content,
                            summary: result.content || '无摘要'
                        }
                    } else {
                        throw new Error('提取内容为空')
                    }

                } catch (error) {
                    logger.warn(`[Tavily] 第 ${index + 1} 个网页提取失败: ${error.message}`)
                    return {
                        index: index + 1,
                        title: result.title || '无标题',
                        url: url,
                        success: false,
                        error: error.message,
                        content: result.content || '无内容摘要'
                    }
                }
            })

            // 等待所有提取任务完成
            const extractionResults = await Promise.all(extractionPromises)

            // 第三步：整理和格式化最终结果
            const successfulExtractions = extractionResults.filter(r => r.success)
            const failedExtractions = extractionResults.filter(r => !r.success)

            logger.info(`[Tavily] 提取完成: 成功 ${successfulExtractions.length} 个，失败 ${failedExtractions.length} 个`)

            // 构建最终输出
            const resultParts = []

            // 添加搜索总结
            resultParts.push(`🔍 === Tavily 深度搜索与提取结果 ===`)
            resultParts.push(`搜索关键词: ${query}`)
            resultParts.push(`搜索深度: ${search_depth} | 提取深度: ${extract_depth}`)
            resultParts.push(`搜索主题: ${topic}`)
            resultParts.push(`找到结果: ${searchResults.length} 个`)
            resultParts.push(`成功提取: ${successfulExtractions.length} 个`)
            resultParts.push(`提取失败: ${failedExtractions.length} 个`)
            resultParts.push('')

            // 添加成功提取的详细内容
            if (successfulExtractions.length > 0) {
                resultParts.push(`📄 === 详细网页内容 ===`)
                resultParts.push('')

                successfulExtractions.forEach((result) => {
                    resultParts.push(`${result.index}. ${result.title}`)
                    resultParts.push(`🔗 URL: ${result.url}`)
                    resultParts.push(`📝 搜索摘要: ${result.summary}`)
                    resultParts.push('')
                    
                    // 限制每个网页内容长度
                    const maxContentLength = 1500
                    let content = result.content.trim()
                    if (content.length > maxContentLength) {
                        content = content.substring(0, maxContentLength) + '...\n\n[内容已截断]'
                    }
                    
                    resultParts.push(`--- 完整网页内容 ---`)
                    resultParts.push(content)
                    resultParts.push('')
                    resultParts.push('─'.repeat(50))
                    resultParts.push('')
                })
            }

            // 添加失败项目的摘要信息
            if (failedExtractions.length > 0) {
                resultParts.push(`⚠️ === 提取失败的项目（仅显示搜索摘要） ===`)
                resultParts.push('')

                failedExtractions.forEach((result) => {
                    resultParts.push(`${result.index}. ${result.title}`)
                    resultParts.push(`🔗 URL: ${result.url}`)
                    resultParts.push(`❌ 提取失败原因: ${result.error}`)
                    resultParts.push(`📝 搜索摘要: ${result.content}`)
                    resultParts.push('')
                })
            }

            // 添加使用统计
            resultParts.push(`📊 === 处理统计 ===`)
            resultParts.push(`总搜索结果: ${searchResults.length}`)
            resultParts.push(`成功提取内容: ${successfulExtractions.length}`)
            resultParts.push(`提取成功率: ${Math.round((successfulExtractions.length / searchResults.length) * 100)}%`)
            
            const totalContentLength = successfulExtractions.reduce((sum, r) => sum + r.content.length, 0)
            resultParts.push(`总提取内容: ${totalContentLength} 字符`)

            return resultParts.join('\n')

        } catch (error) {
            logger.warn('Tavily search and extract error:', error)
            throw new Error(`深度搜索提取失败: ${error.message}`)
        }
    }

    description = 'Comprehensive web search and content extraction tool. Performs a Tavily search first, then automatically extracts the full content from each search result webpage. Perfect for in-depth research when you need complete information from multiple sources about a topic. Returns both search summaries and full extracted webpage content in one operation.'
}