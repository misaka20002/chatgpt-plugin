import fetch from 'node-fetch'

import { formatDate } from '../common.js'
import { AbstractTool } from './AbstractTool.js'

const BILIBILI_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://search.bilibili.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
}

export class BilibiliSearchVideoTool extends AbstractTool {
  name = 'searchVideo'

  parameters = {
    properties: {
      keyword: {
        type: 'string',
        description: '要搜索的视频的标题或关键词'
      }
    },
    required: ['keyword']
  }

  func = async function (opts) {
    let { keyword } = opts
    try {
      return await searchBilibili(keyword)
    } catch (err) {
      logger.error(err)
      return `fail to search video, error: ${err.toString()}`
    }
  }

  description = 'Useful when you want to search a video by keywords. you should remember the id of the video if you want to share it'
}

export async function searchBilibili (name) {
  const keyword = String(name || '').trim()
  if (!keyword) {
    return '搜索关键词不能为空'
  }

  const cookie = await getBilibiliVisitorCookie()
  const searchUrl = new URL('https://api.bilibili.com/x/web-interface/search/type')
  searchUrl.search = new URLSearchParams({
    keyword,
    search_type: 'video'
  }).toString()

  const response = await fetch(searchUrl, {
    headers: {
      ...BILIBILI_HEADERS,
      cookie
    }
  })
  if (!response.ok) {
    throw new Error(`Bilibili search request failed: HTTP ${response.status}`)
  }

  const json = await response.json()
  if (json.code !== 0) {
    throw new Error(`Bilibili search request failed: ${json.message || json.code}`)
  }

  const videos = (json.data?.result || []).filter(r => r.type === 'video' && r.bvid)
  if (videos.length === 0) {
    return `没有找到关键词“${keyword}”的搜索结果`
  }

  const result = videos.slice(0, 5).map(r => {
    const title = r.title.replace(/<[^>]+>/g, '')
    return `id: ${r.bvid}，标题：${title}，作者：${r.author}，播放量：${r.play}，发布日期：${formatDate(new Date(r.pubdate * 1000))}`
  }).join('\n')
  return `这些是关键词“${keyword}”的搜索结果：\n${result}`
}

async function getBilibiliVisitorCookie () {
  const response = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
    headers: BILIBILI_HEADERS
  })
  if (!response.ok) {
    throw new Error(`Bilibili visitor cookie request failed: HTTP ${response.status}`)
  }

  const json = await response.json()
  const buvid3 = json.data?.b_3
  const buvid4 = json.data?.b_4
  if (!buvid3 || !buvid4) {
    throw new Error(`Bilibili visitor cookie request failed: ${json.message || json.code || 'invalid response'}`)
  }
  return `buvid3=${buvid3}; buvid4=${buvid4}`
}
