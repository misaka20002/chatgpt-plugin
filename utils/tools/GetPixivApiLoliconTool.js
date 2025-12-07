import { AbstractTool } from './AbstractTool.js'
import { get_url_from_api_lolicon } from '../../apps/派蒙戳一戳.js'

/**
 * Tool: 从 Lolicon API 获取图片
 * 通过标签搜索并返回图片URL
 */
export class GetPixivApiLoliconTool extends AbstractTool {
    name = 'get_pixiv_images'

    parameters = {
        properties: {
            tag1: {
                type: 'string',
                description: 'Primary tag for image search in Japanese. Supports multiple tags separated by "|" (up to 20 tags). MUST use Japanese tags. Examples: "白髪", "猫耳", "ロリ", "メイド|巫女"'
            },
            tag2: {
                type: 'string',
                description: 'Optional secondary tag for image search in Japanese. Supports multiple tags separated by "|" (up to 20 tags). MUST use Japanese tags. This parameter is optional.'
            },
            num: {
                type: 'number',
                description: 'Number of images to retrieve. Minimum: 1, Maximum: 10. Default: 1'
            }
        },
        required: ['tag1']
    }

    description = 'Search and retrieve anime/illustration images from Pixiv using Japanese tags. Call this tool when users ask for anime pictures, character illustrations, or images with specific features (like hair color, clothing, characters, etc.). All tags MUST be in Japanese language (e.g., "白髪", "猫耳", "メイド". 2) tag1 and tag2 work as AND filter - images must match BOTH tags if tag2 is provided. 3) Each tag parameter supports multiple tags separated by "|" for OR logic (e.g., "メイド|巫女" means maid OR shrine maiden). Returns image URLs and sends them to the user.'

    constructor() {
        super()
    }

    func = async function (opts, e) {
        let { tag1, tag2, num = 1 } = opts

        // 验证必需参数
        if (!tag1 || typeof tag1 !== 'string') {
            return 'Error: tag1 parameter is required and must be a string'
        }

        // 验证并限制 num 参数
        if (typeof num !== 'number' || num < 1) {
            num = 1
        } else if (num > 10) {
            num = 10
        }

        try {
            // 调用函数获取图片URL
            const picUrls = await get_url_from_api_lolicon(tag1, tag2, num)

            if (!picUrls || !Array.isArray(picUrls) || picUrls.length === 0) {
                return `No images found for tags: ${tag1}${tag2 ? ` and ${tag2}` : ''}. Try using different or more general tags.`
            }

            // 发送图片给用户 (支持多图)
            for (const url of picUrls) {
                e.reply(segment.image(url))
            }

            return `Successfully retrieved and sent ${picUrls.length} image(s) with tags: ${tag1}${tag2 ? ` and ${tag2}` : ''}. The image(s) have been sent to the user.`

        } catch (err) {
            logger.error('[GetPicsApiLoliconTool] Error:', err)
            return `Failed to retrieve image: ${err.message || 'Unknown error occurred'}`
        }
    }
}
