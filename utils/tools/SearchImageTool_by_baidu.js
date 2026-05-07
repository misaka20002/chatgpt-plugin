import { AbstractTool } from './AbstractTool.js'
import { Config } from '../../utils/config.js'

/** 百度图片公开接口搜索API */
export class SerpImageTool_by_baidu extends AbstractTool {
  name = 'searchImage_by_baidu'

  parameters = {
    properties: {
      q: {
        type: 'string',
        description: 'search keyword'
      },
      limit: {
        type: 'number',
        description: 'image number, default is 30, max is 50'
      }
    },
    required: ['q']
  }

  description = 'Useful when you want to search images from Baidu (百度图片搜索). Returns image URLs that can be sent using sendPicture.'

  func = async function (opts) {
    let { q, limit = 30 } = opts
    try {
      const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&word=${encodeURIComponent(q)}&pn=0&rn=${Math.min(limit, 50)}`

      let response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://image.baidu.com/'
        }
      })

      // 清除非法控制字符后再解析
      const text = await response.text()
      const cleanText = text
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // 移除不可见的非法控制字符（含未转义的换行、制表符等）
        .replace(/\\'/g, "'")                 // 修复 JSON 标准中不允许的单引号转义 \'

      const data = JSON.parse(cleanText)

      if (!data.data || data.data.length === 0) {
        return `No images found for keyword: ${q}`
      }

      // 处理返回的图片数据
      const images = data.data
        .filter(item => item.thumbURL || item.middleURL || item.hoverURL)
        .slice(0, limit)
        .map(item => ({
          title: item.fromPageTitleEnc || item.fromPageTitle || 'No title',
          url: item.middleURL || item.hoverURL || item.thumbURL,
          thumbnail: item.thumbURL,
          source: item.fromURLHost || 'baidu.com',
          width: item.width,
          height: item.height
        }))

      return `images search results from Baidu in json format:\n${JSON.stringify(images, null, 2)}. The 'url' field is the actual picture url. You should use sendPicture to send them`

    } catch (error) {
      return `Error searching images from Baidu: ${error.message}`
    }
  }
}