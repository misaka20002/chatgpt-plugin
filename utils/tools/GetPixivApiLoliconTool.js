import { AbstractTool } from './AbstractTool.js'
import { get_url_from_api_lolicon } from '../../apps/派蒙戳一戳.js'
import { Config } from '../config.js'

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
                description: '主标签（日文）。可用 "|" 分隔多个标签（OR 逻辑，最多20个）。示例："白髪", "猫耳|メイド"'
            },
            tag2: {
                type: 'string',
                description: '可选副标签（日文），格式同 tag1。与 tag1 为 AND 关系'
            },
            num: {
                type: 'number',
                description: '获取数量，1-10，默认 3'
            }
        },
        required: ['tag1']
    }

    description = '通过日文标签搜索并返回 Pixiv 动漫/插画图片。当用户索要带有特定特征（发色、服装等）的动漫图时调用。标签内支持 "|" 或逻辑，tag1 与 tag2 为与逻辑。图片会自动发送给用户。'

    constructor() {
        super()
    }

    func = async function (opts, e) {
        let { tag1, tag2, num = 3 } = opts

        if (!tag1 || typeof tag1 !== 'string') {
            return 'Error: tag1 parameter is required and must be a string'
        }

        if (typeof num !== 'number' || num < 1) {
            num = 1
        } else if (num > 10) {
            num = 10
        }

        try {
            const picUrls = await get_url_from_api_lolicon(tag1, tag2, num, Config.getPixiv18Tool ? 2 : 0)

            if (!picUrls || !Array.isArray(picUrls) || picUrls.length === 0) {
                return `No images found for tags: ${tag1}${tag2 ? ` and ${tag2}` : ''}. Try using different or more general tags.`
            }

            for (const url of picUrls) {
                e.reply(segment.image(url))
            }

            return `Successfully sent ${picUrls.length} image(s) with tags: ${tag1}${tag2 ? ` and ${tag2}` : ''}. Image URLs: ${JSON.stringify(picUrls)}. You may also use sendPicture tool if needed.`

        } catch (err) {
            logger.error('[GetPicsApiLoliconTool] Error:', err)
            return `Failed to retrieve image: ${err.message || 'Unknown error occurred'}`
        }
    }
}
