import fetch from 'node-fetch'
import { createHash } from 'node:crypto'

import { formatDate } from '../common.js'
import { AbstractTool } from './AbstractTool.js'

const BILIBILI_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://search.bilibili.com/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
}

// Bilibili WBI 签名使用的固定重排表。
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

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
  const { imgKey, subKey } = await getBilibiliWbiKeys(cookie)
  const searchParams = {
    keyword,
    search_type: 'video',
    page: 1,
    page_size: 20,
    order: '',
    duration: 0,
    tids: 0,
    platform: 'pc',
    highlight: 1,
    single_column: 0,
    from_source: 'webtop_search',
    web_location: 1430654
  }

  // 优先使用视频分类接口。部分 Bilibili 节点会在风控时返回 code=0
  // 但 result 为空，此时不能直接当作“没有搜索结果”。
  const typeJson = await requestWbiSearch(
    'https://api.bilibili.com/x/web-interface/wbi/search/type',
    searchParams,
    keyword,
    cookie,
    imgKey,
    subKey
  )
  let videos = getVideoResults(typeJson)

  // type 接口被静默风控时，使用综合搜索接口再确认一次。
  if (videos.length === 0) {
    console.warn(`[BilibiliSearch] search/type 返回空结果，尝试 all/v2。keyword=${keyword}，numResults=${typeJson.data?.numResults ?? 'unknown'}`)
    const allJson = await requestWbiSearch(
      'https://api.bilibili.com/x/web-interface/wbi/search/all/v2',
      {
        ...searchParams,
        refresh: true,
        from_source: 'web_search',
        from_spmid: '333.337',
        source_tag: 3,
        web_roll_page: 1
      },
      keyword,
      cookie,
      imgKey,
      subKey
    )
    videos = getVideoResults(allJson)
  }

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

  const json = await readJsonResponse(response, 'Bilibili visitor cookie request')
  const buvid3 = json.data?.b_3
  const buvid4 = json.data?.b_4
  if (json.code !== 0 || !buvid3 || !buvid4) {
    throw new Error(`Bilibili visitor cookie request failed: ${json.message || json.code || 'invalid response'}`)
  }
  const cookies = new Map([
    ['buvid3', buvid3],
    ['buvid4', buvid4]
  ])

  // 访问首页补齐 b_nut 等浏览器会获得的访客 Cookie。某些 Bilibili
  // 节点只有 buvid3/buvid4 时会返回 code=0、result=[] 的静默风控结果。
  const baseCookie = serializeCookies(cookies)
  const homepageResponse = await fetch('https://www.bilibili.com/', {
    headers: {
      ...BILIBILI_HEADERS,
      cookie: baseCookie
    }
  })
  const setCookieHeaders = homepageResponse.headers.raw()['set-cookie'] || []
  for (const header of setCookieHeaders) {
    const pair = header.split(';', 1)[0]
    const separator = pair.indexOf('=')
    if (separator > 0) {
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }

  // 即使首页没有下发 b_nut，也提供与当前访客身份匹配的时间值。
  if (!cookies.has('b_nut')) {
    cookies.set('b_nut', String(Math.floor(Date.now() / 1000)))
  }
  return serializeCookies(cookies)
}

function serializeCookies (cookies) {
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
}

async function getBilibiliWbiKeys (cookie) {
  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: {
      ...BILIBILI_HEADERS,
      cookie
    }
  })
  if (!response.ok) {
    throw new Error(`Bilibili WBI key request failed: HTTP ${response.status}`)
  }

  const json = await readJsonResponse(response, 'Bilibili WBI key request')
  // 匿名访问通常返回 code=-101，但 data.wbi_img 依然包含可用密钥。
  const imgUrl = json.data?.wbi_img?.img_url
  const subUrl = json.data?.wbi_img?.sub_url
  if (!imgUrl || !subUrl) {
    throw new Error(`Bilibili WBI key request failed: ${json.message || 'invalid response'}`)
  }

  return {
    imgKey: getWbiKeyPart(imgUrl),
    subKey: getWbiKeyPart(subUrl)
  }
}

function getWbiKeyPart (url) {
  return new URL(url).pathname.split('/').pop().split('.')[0]
}

function getMixinKey (origin) {
  return MIXIN_KEY_ENC_TAB.map(index => origin[index]).join('').slice(0, 32)
}

function signWbiParams (params, imgKey, subKey) {
  const signedParams = {
    ...params,
    wts: Math.floor(Date.now() / 1000)
  }
  const query = Object.keys(signedParams)
    .sort()
    .map(key => {
      // Bilibili 会在校验签名前过滤这些字符。
      const value = String(signedParams[key] ?? '').replace(/[!'()*]/g, '')
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    })
    .join('&')
  const mixinKey = getMixinKey(imgKey + subKey)
  const wRid = createHash('md5').update(query + mixinKey).digest('hex')
  return `${query}&w_rid=${wRid}`
}

async function requestWbiSearch (endpoint, params, keyword, cookie, imgKey, subKey) {
  const query = signWbiParams(params, imgKey, subKey)
  const response = await fetch(`${endpoint}?${query}`, {
    headers: {
      ...BILIBILI_HEADERS,
      Origin: 'https://search.bilibili.com',
      Referer: `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`,
      cookie
    }
  })
  if (!response.ok) {
    throw new Error(`Bilibili search request failed: HTTP ${response.status}`)
  }

  const json = await readJsonResponse(response, 'Bilibili search request')
  if (json.code !== 0) {
    throw new Error(`Bilibili search request failed: ${json.message || json.code}`)
  }
  return json
}

function getVideoResults (json) {
  const result = json.data?.result
  if (!Array.isArray(result)) {
    return []
  }

  // search/type 直接返回视频数组。不要依赖 type 字段，部分响应变体中
  // 可能缺少该字段；bvid 才是视频结果的稳定标识。
  const directVideos = result.filter(item => item?.bvid)
  if (directVideos.length > 0) {
    return directVideos
  }

  // search/all/v2 返回按 result_type 分组的数据。
  const videoGroup = result.find(group => group?.result_type === 'video')
  return Array.isArray(videoGroup?.data)
    ? videoGroup.data.filter(item => item?.bvid)
    : []
}

async function readJsonResponse (response, label) {
  const contentType = response.headers.get('content-type') || ''
  const body = await response.text()
  if (!contentType.includes('application/json')) {
    throw new Error(`${label} returned non-JSON response: HTTP ${response.status}`)
  }

  try {
    return JSON.parse(body)
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`)
  }
}
