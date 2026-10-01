import fetch from 'node-fetch'
import sharp from 'sharp'

const ORIGIN = 'https://q1.qlogo.cn'
const MAX_BYTES = 512 * 1024
const cache = new Map()
const pending = new Map()

async function downloadAvatar(id) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  // 与 meme 的 QQ 头像来源一致；仅允许数字 QQ，不能把昵称或外部 URL 当成请求地址。
  let url = new URL(`/g?b=qq&s=160&nk=${id}`, ORIGIN)
  try {
    for (let hop = 0; hop <= 2; hop++) {
      const response = await fetch(url.href, { signal: controller.signal, redirect: 'manual' })
      try {
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location || hop === 2) throw new Error('头像重定向缺失或次数过多')
          const next = new URL(location, url)
          if (next.origin !== ORIGIN || next.username || next.password) throw new Error('头像重定向离开固定服务，已拒绝')
          url = next
          continue
        }
        if (!response.ok) throw new Error(`头像服务返回 HTTP ${response.status}`)
        if (!/^image\//i.test(response.headers.get('content-type') || '')) throw new Error('头像响应不是图片')
        if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('头像声明大小超过上限')
        const chunks = []
        let size = 0
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > MAX_BYTES) throw new Error('头像下载大小超过上限')
          chunks.push(chunk)
        }
        // 解码后重编码为小型静态图片，模板只接收 data URI，不让浏览器访问头像服务。
        const buffer = await sharp(Buffer.concat(chunks), { limitInputPixels: 1024 * 1024 })
          .rotate().resize(160, 160, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer()
        return `data:image/jpeg;base64,${buffer.toString('base64')}`
      } finally {
        response.body?.destroy?.()
      }
    }
    throw new Error('头像重定向次数过多')
  } finally {
    clearTimeout(timer)
  }
}

async function avatarFor(id) {
  const cached = cache.get(id)
  if (cached && cached.expires > Date.now()) return cached.uri
  if (pending.has(id)) return pending.get(id)
  const job = (async () => {
    let uri = ''
    try {
      uri = await downloadAvatar(id)
    } catch (error) {
      logger.warn(`[MemoryV2] AT图谱头像加载失败（${id}），使用姓名徽章：${error.message}`)
    }
    cache.delete(id)
    cache.set(id, { uri, expires: Date.now() + (uri ? 30 * 60 * 1000 : 60 * 1000) })
    if (cache.size > 128) cache.delete(cache.keys().next().value)
    return uri
  })()
  pending.set(id, job)
  try {
    return await job
  } finally {
    pending.delete(id)
  }
}

/** 只加载实际展示成员的头像，限制并发；失败时用原有姓名徽章保持图谱可用。 */
export async function loadAtGraphAvatars(graph) {
  const people = [graph.target, ...graph.nodes, ...graph.outgoingRank, ...graph.incomingRank, ...graph.affectionRank, ...graph.mutualRank]
  const ids = [...new Set(people.map(p => String(p.id)).filter(id => /^\d{5,20}$/.test(id)))].slice(0, 40)
  const avatars = Object.create(null)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++]
      avatars[id] = await avatarFor(id)
    }
  }))
  return avatars
}
