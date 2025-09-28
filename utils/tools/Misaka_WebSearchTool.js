import { AbstractTool } from './AbstractTool.js'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.resolve(__dirname, '../..')

/**
 * 网页搜索工具：通过Python后端调用 Google → Bing → 搜狗 搜索引擎
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

    constructor() {
        super()
    }

    // LLM调用的Tool
    func = async function (opts) {
        const { query, max_results = 5 } = opts

        if (!query || typeof query !== 'string') {
            return 'Error: 搜索关键词不能为空'
        }

        if (max_results < 1 || max_results > 20) {
            return 'Error: 搜索结果数量应在 1-20 之间'
        }

        logger.info(`web_searcher - search_from_search_engine: ${query}`)

        try {
            // Python 脚本路径
            const pythonScript = path.join(pluginRoot, 'utils', 'web_search.py')
            
            // 准备传递给Python脚本的参数
            const searchParams = JSON.stringify({
                query: query,
                max_results: max_results
            })

            // 使用 execSync 执行 Python 脚本
            let stdout
            try {
                stdout = execSync(`python3 "${pythonScript}"`, {
                    input: searchParams,
                    encoding: 'utf-8',
                    windowsHide: true,
                    timeout: 60000 // 60秒超时
                })
            } catch (pythonError) {
                // 如果 python3 不存在，尝试使用 python
                try {
                    stdout = execSync(`python "${pythonScript}"`, {
                        input: searchParams,
                        encoding: 'utf-8',
                        windowsHide: true,
                        timeout: 60000 // 60秒超时
                    })
                } catch (fallbackError) {
                    throw new Error(`Python execution failed. Please ensure Python 3 is installed and available in PATH. Error: ${fallbackError.message}`)
                }
            }

            // 解析Python脚本的输出
            const result = JSON.parse(stdout)

            if (!result.success) {
                // 检查是否是依赖问题
                if (result.dependency_error) {
                    return `Error: Python依赖缺失 - ${result.error}\n\n请安装必要的Python包：\npip install aiohttp beautifulsoup4\n\n可选安装googlesearch包以获得更好的Google搜索效果：\npip install googlesearch-python`
                }
                return `Error: 搜索失败 - ${result.error}`
            }

            if (!result.results || result.results.length === 0) {
                return 'Error: 网络搜索没有返回任何结果，请尝试不同的关键词'
            }

            logger.info(`Processing ${result.results.length} search results...`)

            // 格式化搜索结果
            const formattedResults = []
            for (const searchResult of result.results) {
                let resultText = `${searchResult.index}. ${searchResult.title}\n`
                
                if (searchResult.snippet) {
                    resultText += `${searchResult.snippet}\n`
                }
                
                if (searchResult.content) {
                    resultText += `${searchResult.content}\n`
                }
                
                resultText += '\n'
                formattedResults.push(resultText)
            }

            // 添加搜索总结信息
            const summary = `\n=== 搜索总结 ===\n搜索关键词: ${query}\n找到 ${result.total_results} 个结果\n处理成功 ${result.processed_results} 个结果\n\n`

            return summary + formattedResults.join('').trim()

        } catch (error) {
            console.error('Web search error:', error)
            
            // 检查是否是Python相关的错误
            if (error.message.includes('python') || error.message.includes('Python')) {
                return `Error: Python环境问题 - ${error.message}\n\n请确保：\n1. 已安装 Python 3\n2. Python 在系统 PATH 中可用\n3. 已安装必要的依赖包：pip install aiohttp beautifulsoup4`
            }
            
            return `Error: 网络搜索失败 - ${error.message || '未知错误'}。请检查网络连接或稍后重试。`
        }
    }.bind(this)
}