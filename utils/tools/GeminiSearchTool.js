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
                description: '完整的自然语言提问或详细的搜索诉求'
            },
        },
        required: ['query']
    }

    description = '通过Gemini原生搜索能力获取网络上的实时信息、新闻或解答需要联网查证的问题。当需要获取最新资讯或客观事实时，请调用此工具。'

    // LLM调用的Tool
    func = async function (opts) {
        const { query } = opts

        if (!query || typeof query !== 'string') {
            return 'Error: 搜索提问不能为空'
        }

        if (!Config.geminiKey.length) {
            return 'Error: 需要在锅巴设置中配置Gemini密钥'
        }

        const { CustomGoogleGeminiClient } = await import("../../client/CustomGoogleGeminiClient.js")

        logger.info(`Gemini LLM Searcher Query: ${query}`)

        // 专为 Gemini 原生搜索定制的 System Prompt，确保它不仅执行搜索，还能对结果进行过滤、交叉验证并生成结构化的高质量回复
        const systemPrompt = `你是一个具备高级网络搜索和信息整合能力的智能引擎。为了给用户提供最优质的答案，请严格遵守以下原则：
1. 【强制联网】必须使用你的原生搜索功能（Google Search）来查找与用户提问相关的信息，不要仅依赖预训练数据。
2. 【注重时效】优先采纳最新、最权威的搜索结果，对于新闻、数据、天气等时间敏感型问题，必须确保信息的即时性和准确性。
3. 【多源整合】综合多方的搜索结果进行归纳总结，提供全面、详实且客观的最终答案，而不是简单罗列单条数据的链接。
4. 【直击要害】针对用户的提问直接给出结论或具体数据，无需过多寒暄或解释搜索过程。
5. 【语言要求】全程请务必使用中文（简体）进行回复。`

        const opt = {
            toolMode: 'NONE', // 假设这里NONE代表不在内部循环调用其他Tool，直接返回内容
            search: true,     // 开启 Gemini 客户端底层的 Google Grounding 搜索
            system: systemPrompt,
        };

        let client = new CustomGoogleGeminiClient({
            key: Config.getGeminiKey,
            model: Config.geminiSearchModel,
            baseUrl: Config.geminiBaseUrl,
            debug: Config.debug
        })

        try {
            let res = await client.sendMessage(query, opt)
            return res.text || "Error: Gemini没有返回任何搜索相关的文本结果"
        } catch (err) {
            return 'Error: 网络搜索失败: ' + (hidePrivacyInfo(err.message) || '未知错误');
        }
    }
}