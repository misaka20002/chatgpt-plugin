import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'
import { recognitionResultsByGemini } from '../paimonFuction.js'
import { hidePrivacyInfo } from '../paimonFuction.js'

/**
 * Tool: 使用Gemini识别图片或视频内容
 */
export class RecognitionResultsByGeminiTool extends AbstractTool {
  name = 'recognize_media'

  parameters = {
    properties: {
      imageUrl: {
        type: 'string',
        description: 'The URL of the image to recognize. Optional if videoUrl is provided.'
      },
      videoUrl: {
        type: 'string',
        description: 'The URL of the video to recognize. Optional if imageUrl is provided.'
      },
      question: {
        type: 'string',
        description: 'The question or description requirement for the media. Can be empty.'
      },
      qq: {
        type: 'string',
        description: 'QQ number to get user avatar. Used only if imageUrl is empty.'
      }
    },
    required: []
  }

  description = 'Use this tool to ANALYZE/RECOGNIZE image OR video content. Returns text descriptions. Use when checking: 1) Image/Video content details, 2) Answering questions about visual media, 3) User avatars.'

  func = async function (opts, e) {
    const { imageUrl, videoUrl, question, qq } = opts

    let finalImageUrl = imageUrl
    let finalVideoUrl = videoUrl

    // 1. 处理 QQ 头像逻辑
    if (qq && !imageUrl && !videoUrl) {
      finalImageUrl = `https://q1.qlogo.cn/g?b=qq&s=160&nk=${qq}`
      logger.info(`[智能模式][Gemini识别] 识别QQ头像: ${qq}`)
    } else {
      // logger.info(`[智能模式][Gemini识别] 识别源 - 图片: ${finalImageUrl || '无'}, 视频: ${finalVideoUrl || '无'}`)
    }

    // 2. 校验输入
    if (!finalImageUrl && !finalVideoUrl) {
      return 'Error: Either imageUrl, videoUrl, or qq number is required.'
    }

    if (!Config.geminiKey || !Config.geminiKey.length) {
      return 'Error: Gemini API key is not configured.'
    }

    try {
      // 构造临时 e 对象
      const tempE = e || {
        sender: { user_id: 'tool_call' },
        msg: question || 'describe this content in Simplified Chinese'
      }

      // 3. 构造参数调用核心函数
      // recognitionResultsByGemini(e, imgArray, videoArray)
      const imgArgs = finalImageUrl ? [finalImageUrl] : []
      const videoArgs = finalVideoUrl ? [finalVideoUrl] : []

      const result = await recognitionResultsByGemini(tempE, imgArgs, videoArgs)

      if (!result) {
        return 'Error: Recognition failed, no result returned from API.'
      }
      return result

    } catch (err) {
      logger.error(`[智能模式][Gemini识别] 识别失败: ${err}`)
      return 'Error: Recognition failed: ' + (hidePrivacyInfo(err.message || err.toString()) || 'Unknown error')
    }
  }
}