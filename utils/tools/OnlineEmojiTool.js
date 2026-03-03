import { AbstractTool } from './AbstractTool.js'
import fetch from 'node-fetch'
import { Config } from '../config.js'

const emotionTagMap = {
  happy: '高兴',
  proud: '得意',
  shy: '害羞',
  sad: '难过',
  conflicted: '纠结',
  angry: '生气',
  surprised: '惊讶',
  confused: '困惑',
  pleading: '委屈',
  scared: '害怕',
  awkward: '尴尬',
  speechless: '无语',
  disgusted: '嫌弃',
  bored: '无聊',
  like: '喜欢',
  love: '喜欢',
  tired: '疲惫',
  excited: '兴奋',
  laugh: '开心',
  cry: '伤心',
  cute: '可爱',
  thumbsup: '点赞',
  thinking: '思考',
  cool: '帅气',
  sick: '生病',
  sleep: '困',
  eat: '吃饭'
}

function normalizeChineseEmotion(input = '') {
  const text = String(input).trim()
  if (!text) return '高兴'
  if (/高兴|开心|快乐|喜悦/.test(text)) return '高兴'
  if (/生气|愤怒|火大|恼火/.test(text)) return '生气'
  if (/难过|伤心|悲伤|低落/.test(text)) return '难过'
  if (/害羞|羞涩|脸红/.test(text)) return '害羞'
  if (/喜欢|爱|心动/.test(text)) return '喜欢'
  if (/害怕|恐惧|紧张/.test(text)) return '害怕'
  if (/惊讶|震惊|吃惊/.test(text)) return '惊讶'
  if (/困惑|疑惑|迷茫/.test(text)) return '困惑'
  if (/疲惫|很累|累/.test(text)) return '疲惫'
  if (/兴奋|激动/.test(text)) return '兴奋'
  if (/无聊|乏味/.test(text)) return '无聊'
  if (/可爱|萌/.test(text)) return '可爱'
  if (/生病|不舒服/.test(text)) return '生病'
  if (/睡|困/.test(text)) return '困'
  if (/吃|美食|饿/.test(text)) return '吃饭'
  return text
}

function mapEmotionToChineseTag(emotion = '') {
  const raw = String(emotion).trim()
  if (!raw) return '高兴'
  const lower = raw.toLowerCase()
  if (emotionTagMap[lower]) return emotionTagMap[lower]
  if (/[\u4e00-\u9fa5]/.test(raw)) return normalizeChineseEmotion(raw)
  return '高兴'
}

function buildUrlWithTag(prefix, tag) {
  const raw = String(prefix || '').trim()
  const safeTag = encodeURIComponent(tag)
  if (!raw) return ''

  if (raw.includes('{tags}')) {
    return raw.replaceAll('{tags}', safeTag)
  }

  try {
    const u = new URL(raw)
    u.searchParams.set('tags', tag)
    if (!u.searchParams.has('count')) {
      u.searchParams.set('count', '1')
    }
    return u.toString()
  } catch {
    if (/([?&])tags=/.test(raw)) {
      const withTag = raw.replace(/([?&]tags=)[^&]*/i, `$1${safeTag}`)
      return /([?&])count=/.test(withTag) ? withTag : `${withTag}&count=1`
    }
    const sep = raw.includes('?') ? '&' : '?'
    return `${raw}${sep}tags=${safeTag}&count=1`
  }
}

function maskSensitiveUrl(rawUrl = '') {
  const text = String(rawUrl || '')
  if (!text) return text
  try {
    const u = new URL(text)
    for (const key of ['api_key', 'apikey', 'key', 'token', 'access_token']) {
      if (u.searchParams.has(key)) {
        u.searchParams.set(key, '***')
      }
    }
    return u.toString()
  } catch {
    return text.replace(/([?&](?:api_key|apikey|key|token|access_token)=)[^&]*/ig, '$1***')
  }
}

function looksLikeImageUrl(url) {
  if (!url || typeof url !== 'string') return false
  return /^(https?:\/\/|file:\/\/|base64:\/\/|data:image\/)/i.test(url.trim())
}

function extractImageUrl(payload) {
  const queue = [payload]
  const keys = ['image', 'image_url', 'url', 'img', 'src', 'murl', 'file', 'path', 'original', 'origin_url', 'cdn_url']
  const visited = new Set()

  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) continue
    if (typeof node === 'string') {
      if (looksLikeImageUrl(node)) return node
      continue
    }
    if (typeof node !== 'object') continue
    if (visited.has(node)) continue
    visited.add(node)

    if (Array.isArray(node)) {
      for (const item of node) queue.push(item)
      continue
    }

    for (const key of keys) {
      if (typeof node[key] === 'string' && looksLikeImageUrl(node[key])) {
        return node[key]
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push(value)
      if (typeof value === 'string' && looksLikeImageUrl(value)) return value
    }
  }

  return ''
}

export class OnlineEmojiTool extends AbstractTool {
  name = 'sendOnlineEmoji'

  parameters = {
    properties: {
      emotion: {
        type: 'string',
        description: 'Current emotion/mood. Prefer Chinese like 生气、高兴、难过、害羞. English emotions are also supported and will be mapped to Chinese tags automatically.'
      }
    },
    required: ['emotion']
  }

  func = async function (opts, e) {
    const apiPrefix = String(Config.onlineEmojiApiPrefix || '').trim()
    if (!apiPrefix) {
      return 'Online emoji API prefix is not configured. 请先在配置中设置 onlineEmojiApiPrefix。'
    }

    const emotion = opts?.emotion
    const tag = mapEmotionToChineseTag(emotion)
    const requestUrl = buildUrlWithTag(apiPrefix, tag)
    if (!requestUrl) {
      return 'Failed to build online emoji API url.'
    }
    logger.debug(`[OnlineEmojiTool][REQ] emotion=${emotion || ''} tag=${tag} url=${maskSensitiveUrl(requestUrl)}`)

    try {
      const response = await fetch(requestUrl, { method: 'GET' })
      if (!response.ok) {
        const errText = await response.text()
        logger.debug(`[OnlineEmojiTool][RES] status=${response.status} ok=false body=${String(errText || '').slice(0, 200)}`)
        return `Failed to request online emoji api: HTTP ${response.status}, ${errText?.slice?.(0, 200) || ''}`
      }

      const contentType = String(response.headers.get('content-type') || '')
      let imageUrl = ''

      if (contentType.startsWith('image/')) {
        imageUrl = requestUrl
      } else {
        let payload
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        imageUrl = extractImageUrl(payload)
      }

      if (!imageUrl) {
        logger.debug(`[OnlineEmojiTool][RES] status=${response.status} ok=true contentType=${contentType || '<empty>'} imageUrl=<empty>`)
        return `Online emoji api returned no image for tag "${tag}".`
      }
      logger.debug(`[OnlineEmojiTool][RES] status=${response.status} ok=true contentType=${contentType || '<empty>'} imageUrl=${maskSensitiveUrl(imageUrl)}`)

      await e.reply(segment.image(imageUrl))
      return 'Online emoji image has been sent. Do NOT describe this tool execution. You may continue normal reply text if needed.'
    } catch (err) {
      logger.error(`[OnlineEmojiTool][RES] error=${err.message || err.stack || String(err)}`)
      return `Failed to send online emoji image: ${err.message || err.stack || String(err)}`
    }
  }

  description = 'Send one online emoji/meme image by mood tag. The tag should reflect current emotion and prefers Chinese tags like 生气、高兴、难过、害羞。This tool sends image directly.'
}
