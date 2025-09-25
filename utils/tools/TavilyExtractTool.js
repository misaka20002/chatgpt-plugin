import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'

/** 使用 Tavily 提取完整内容的工具 */
export class TavilyExtractTool extends AbstractTool {
    name = 'tavily_extract'

    parameters = {
        properties: {
            url: {
                type: 'string',
                description: 'URL to extract content from'
            },
            extract_depth: {
                type: 'string',
                description: 'Extraction depth: basic or advanced',
                enum: ['basic', 'advanced'],
                default: 'basic'
            }
        },
        required: ['url']
    }

    func = async function (opts) {
        const {
            url,
            extract_depth = 'basic'
        } = opts

        if (!url || typeof url !== 'string' || !url.trim()) {
            throw new Error('URL must be a non-empty string')
        }

        // 获取 Tavily API 密钥
        const tavilyKey = Config.getTavilyKey
        if (!tavilyKey) {
            throw new Error('Tavily API key is not configured')
        }

        // 构建请求载荷
        const payload = {
            urls: [url.trim()],
            extract_depth: ['basic', 'advanced'].includes(extract_depth) ? extract_depth : 'basic'
        }

        try {
            // 调用 Tavily Extract API
            const response = await fetch('https://api.tavily.com/extract', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tavilyKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                timeout: 15000 // 网页提取可能需要更长时间
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Tavily Extract API error: ${errorText} (Status: ${response.status})`)
            }

            const data = await response.json()
            const results = data.results || []

            if (!results.length) {
                return `无法从指定URL提取内容: ${url}`
            }

            // 格式化提取结果
            const formattedResults = []
            results.forEach((result, index) => {
                const resultUrl = result.url || url
                const content = result.raw_content || '无法提取内容'
                const title = result.title || '无标题'

                // 限制内容长度以避免过长
                const maxContentLength = 2000
                let processedContent = content
                if (content.length > maxContentLength) {
                    processedContent = content.substring(0, maxContentLength) + '...\n\n[内容已截断，如需完整内容请直接访问原网页]'
                }

                formattedResults.push(
                    `=== 网页内容提取结果 ===\n` +
                    `标题: ${title}\n` +
                    `URL: ${resultUrl}\n` +
                    `提取深度: ${extract_depth}\n` +
                    `内容长度: ${content.length} 字符\n\n` +
                    `--- 网页内容 ---\n` +
                    `${processedContent}\n`
                )
            })

            return formattedResults.join('\n').trim()

        } catch (error) {
            console.error('Tavily extract error:', error)
            
            // 如果是网络错误，提供更友好的错误信息
            if (error.message.includes('timeout') || error.message.includes('ENOTFOUND')) {
                throw new Error(`网页提取失败: 无法访问指定URL或网络超时 (${url})`)
            }
            
            throw new Error(`网页提取失败: ${error.message}`)
        }
    }

    description = 'Extract and analyze content from web pages using Tavily API. Perfect for getting detailed content from specific URLs found in search results. This tool can extract clean, readable content from web pages, removing ads and navigation elements to focus on the main content.'
}