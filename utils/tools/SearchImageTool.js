import { AbstractTool } from './AbstractTool.js'

export class SerpImageTool extends AbstractTool {
  name = 'searchImage'

  parameters = {
    properties: {
      q: {
        type: 'string',
        description: 'search keyword'
      },
      limit: {
        type: 'number',
        description: 'image number'
      },
      source: {
        type: 'string',
        description: 'search source, bing or yandex'
      }
    },
    required: ['q', 'source']
  }

  func = async function (opts) {
    let { q, limit = 2, source = 'bing' } = opts
    let serpRes = await fetch(`https://serp.ikechan8370.com/image/${source}?q=${encodeURIComponent(q)}&limit=${limit}`, {
      headers: {
        'X-From-Library': 'ikechan8370'
      }
    })
    serpRes = await serpRes.json()

    let res = serpRes.data
    return `images search results in json format:\n${JSON.stringify(res)}. the murl field is actual picture url. You should use sendPicture to send them`
  }

  description = 'Useful when you want to search images from the Internet.'
}
