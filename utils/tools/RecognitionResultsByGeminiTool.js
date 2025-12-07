import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'
import { recognitionResultsByGemini } from '../paimonFuction.js'
import { hidePrivacyInfo } from '../paimonFuction.js'

/**
 * Tool: 使用Gemini识别图片内容
 */
export class RecognitionResultsByGeminiTool extends AbstractTool {
  name = 'recognize_image'

  parameters = {
    properties: {
      imageUrl: {
        type: 'string',
        description: 'The URL of the image to recognize. Can be omitted if qq parameter is provided.'
      },
      question: {
        type: 'string',
        description: 'The question or description requirement for the image. Can be empty or use default description if user has no special requirements.'
      },
      qq: {
        type: 'string',
        description: 'QQ number to get user avatar. If you want to see user\'s avatar, pass the QQ number.'
      }
    },
    required: []
  }

  description = 'Use this tool to ANALYZE/RECOGNIZE image content. This tool returns text descriptions of what is in the image. Use this when you need to: 1) Understand/describe image content, 2) Answer questions about images, 3) Analyze user avatars by QQ number.'

  func = async function (opts, e) {
    const { imageUrl, question, qq } = opts

    // 如果提供了 qq 参数，构造头像 URL
    let finalImageUrl = imageUrl
    if (qq && !imageUrl) {
      finalImageUrl = `https://q1.qlogo.cn/g?b=qq&s=160&nk=${qq}`
      logger.info(`[智能模式][Gemini图片识别] 识别QQ头像: ${qq}`)
    } else
      logger.info(`[智能模式][Gemini图片识别] 识别url: ${finalImageUrl}`)      

    if (!finalImageUrl || typeof finalImageUrl !== 'string') {
      return 'Error: Image URL or QQ number is required'
    }

    if (!Config.geminiKey || !Config.geminiKey.length) {
      return 'Error: Gemini API key is not configured. Please configure it in Guoba settings.'
    }

    try {
      // 构造一个临时的 e
      const tempE = e || {
        sender: { user_id: 'tool_call' },
        msg: question || 'describe this image in Simplified Chinese'
      }

      const result = await recognitionResultsByGemini(tempE, [finalImageUrl])

      if (!result) {
        return 'Error: Image recognition failed, no result returned'
      }
      return result

    } catch (err) {
      logger.error(`[智能模式][Gemini图片识别] 识别失败: ${err}`)
      return 'Error: Image recognition failed: ' + (hidePrivacyInfo(err.message || err.toString()) || 'Unknown error')
    }
  }
}