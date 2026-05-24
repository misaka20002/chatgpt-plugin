import { AbstractTool } from './AbstractTool.js'
import { render } from '../common.js'

/**
 * 生成 Markmap 思维导图的 LLM 工具
 */
export class GenerateMarkmapTool extends AbstractTool {
    name = 'generate_markmap'

    // 定义参数，让 LLM 知道如何传递 Markdown 和 标题
    parameters = {
        properties: {
            title: {
                type: 'string',
                description: 'The title of the mind map. Keep it concise, catchy, and relevant to the topic. Emojis can be used to make it cute.'
            },
            markdown: {
                type: 'string',
                description: 'The Markdown text used to generate the mind map. MUST use strictly standard markdown syntax: use "#" for the central root topic, "##" for main branches, "###" for sub-branches, and "-" for list items.'
            }
        },
        required: ['title', 'markdown']
    }

    // 描述工具用途，指导 LLM 何时调用以及如何生成标准代码
    description = 'Useful when the user asks to create a mind map (思维导图), conceptual graph, or brain map. Provide a catchy title and standard markdown hierarchy to generate a mind map image.'

    func = async (opts, e) => {
        let { title, markdown } = opts

        try {
            let img = await render(e, 'chatgpt-plugin', 'markmap/index', {
                markdown: markdown,
                title: title || '思维导图',
                // DPR 4x 超清截图，viewport 足够大让 autoResizeContainer 自由展开
                // 截图只截 #container（fit-content），不受 viewport 大小影响
                Viewport: {
                    width: 2560,
                    height: 1600,
                    deviceScaleFactor: 4
                }
            }, { retType: 'base64' })

            if (!img) {
                return 'Error: Failed to render the mind map image.'
            }

            // 引用发送图片
            await e.reply(img, true)

            // 返回成功信息给大模型，让大模型知道工具调用成功并结束回复
            return `Successfully generated and sent the mind map image to the user. Do NOT output the markdown text in your final response.`

        } catch (error) {
            return `Error generating mind map image: ${error.message}`
        }
    }
}