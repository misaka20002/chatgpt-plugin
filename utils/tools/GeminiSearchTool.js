import { AbstractTool } from './AbstractTool.js'
import { Config } from '../../utils/config.js'
import { hidePrivacyInfo } from '../../utils/paimonFuction.js'

/**
 * Tool: 调用Gemini LLM原生搜索返回结果
 */
export class GeminiSearchTool extends AbstractTool {
    name = 'web_search_by_gemini'

    parameters = {
        properties: {
            query: {
                type: 'string',
                description: '和用户的问题最相关的搜索关键词，用于在网络上搜索'
            },
        },
        required: ['query']
    }

    description = '搜索网络以回答用户的问题。当用户需要搜索网络以获取即时性的信息时调用此工具'

    // LLM调用的Tool
    func = async function (opts) {
        const { query } = opts

        if (!query || typeof query !== 'string') {
            return 'Error: 搜索关键词不能为空'
        }

        if (!Config.geminiKey.length) {
            return 'Error: 需要在锅巴设置中配置Gemini密钥'
        }

        const { CustomGoogleGeminiClient } = await import("../../client/CustomGoogleGeminiClient.js")

        logger.info(`Gemini LLM Searcher: ${query}`)

        const opt = {
            toolMode: 'NONE',
            search: true,
            system: "请帮我搜索，并用中文回复",
        };

        let client = new CustomGoogleGeminiClient({
            key: Config.getGeminiKey,
            model: 'gemini-2.5-flash',
            baseUrl: Config.geminiBaseUrl,
            debug: Config.debug
        })

        try {
            let res = await client.sendMessage(query, opt)
            return res.text || "Error: 没有返回搜索结果"
        } catch (err) {
            return 'Error: 网络搜索失败: ' + (hidePrivacyInfo(err.message) || '未知错误');
        }
    }
}