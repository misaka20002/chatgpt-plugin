import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { AVATAR_ACTIONS } from './config.js'
import { avatarRoot, checkedAvatarPath, AVATAR_FILENAME, MAX_AVATAR_BYTES, MAX_AVATAR_IMAGE_BYTES } from './paths.js'
import { validateAvatarId } from './config.js'

const MAX_FILE_BYTES = MAX_AVATAR_BYTES
const MAX_IMAGE_BYTES = MAX_AVATAR_IMAGE_BYTES
const MAX_TOTAL_PIXELS = 32 * 1024 * 1024
const MOTION_DEFAULTS = {
  breathAmpY: 3, breathPeriod: 3800, swayAmpX: 1, swayPeriod: 5200,
  talkTiltMaxDeg: 2.5, talkTiltPeriod: 3500,
  bounceAmp: 6, bouncePeriod: 570, shakeAmp: 3.5,
  wobbleAmp: 9, wobblePeriod: 2200, wobbleRot: 3,
  nodAmp: 5, nodPeriod: 1450, nodRot: 1,
  headshakeAmp: 7, headshakePeriod: 690, headshakeRot: 3,
  surpriseHopY: 12, surpriseHopDur: 200
}

function number(value, fallback, min, max, name) {
  if (value == null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('角色参数超出范围：' + name)
  }
  return value
}

async function picture(value, name, budget) {
  const match = typeof value?.ref === 'string'
    ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.ref) : null
  if (!match) throw new Error(name + '必须是 JSON 内嵌的 PNG/JPEG/WebP，不能使用外链')
  if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error(name + '超过 6 MiB')
  const input = Buffer.from(match[2], 'base64')
  if (!input.length || input.length > MAX_IMAGE_BYTES) throw new Error(name + '大小无效')
  const image = sharp(input, { limitInputPixels: 2048 * 2048, failOn: 'warning' })
  const meta = await image.metadata()
  if (meta.format !== match[1] || (meta.pages ?? 1) !== 1
    || !meta.width || !meta.height || meta.width > 2048 || meta.height > 2048) {
    throw new Error(name + '实际格式、帧数或尺寸不支持（最长边 2048）')
  }
  budget.pixels += meta.width * meta.height
  if (budget.pixels > MAX_TOTAL_PIXELS) throw new Error('角色图片累计像素超过 32 MiPixels')
  const place = value.place ?? {}
  const normalized = {
    dx: number(place.dx, 0, -2048, 2048, name + '.dx'),
    dy: number(place.dy, 0, -2048, 2048, name + '.dy'),
    scale: number(place.scale, 1, 0.1, 3, name + '.scale'),
    rot: number(place.rot, 0, -180, 180, name + '.rot')
  }
  // 解码并重新编码，只把栅格像素传给绘制模板。
  const { data: png, info } = await image.rotate().png().toBuffer({ resolveWithObject: true })
  return { data: png, width: info.width, height: info.height, place: normalized }
}

export async function parseAvatarResource(raw) {
  if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error('角色 JSON 超过 32 MiB')
  const config = JSON.parse(raw)
  if (config?.schema !== 2 || config.imageMode !== 'images') {
    throw new Error('只支持 Peraravatar+ schema:2 的完整图片模式')
  }
  if (!Array.isArray(config.mouthTiers) || config.mouthTiers.length !== 1
    || !Array.isArray(config.mouthTiers[0]?.images) || config.mouthTiers[0].images.length !== 1) {
    throw new Error('首版只支持一个开口档，每档一张图片')
  }
  const custom = config.customExpressions ?? []
  if (!Array.isArray(custom) || custom.length > 32) throw new Error('特色表情最多 32 种')
  const ids = new Set()
  for (const expression of custom) {
    if (typeof expression?.id !== 'string' || !/^[\w-]{1,80}$/.test(expression.id)
      || ids.has(expression.id)
      || !['none', ...AVATAR_ACTIONS].includes(expression.animation ?? 'none')) {
      throw new Error('特色表情 ID 或动作不支持')
    }
    ids.add(expression.id)
  }
  const pictures = []
  const budget = { pixels: 0 }
  for (const [value, name] of [[config.images?.normal, '正常图'], [config.images?.close, '闭眼图'],
    [config.mouthTiers[0].images[0], '张嘴图'], ...custom.map(x => [x.image, '特色表情'])]) {
    pictures.push(await picture(value, name, budget))
  }
  // 导出文件保留闲置的分层和侧视样例字段，完整图片模式不读取这些字段。
  const motion = {}
  for (const [name, fallback] of Object.entries(MOTION_DEFAULTS)) {
    const period = /Period$|Dur$/.test(name)
    motion[name] = number(config.motion?.[name], fallback, period ? 100 : 0, period ? 30000 : 30, name)
  }
  const blinkMin = number(config.blinkMin, 2000, 100, 30000, 'blinkMin')
  const blinkMax = number(config.blinkMax, 5000, blinkMin, 30000, 'blinkMax')
  return {
    version: createHash('sha256').update(raw).digest('hex'),
    pictures, motion, blinkMin, blinkMax,
    blinkDuration: number(config.blinkDuration, 150, 100, 1000, 'blinkDuration'),
    expressions: custom.map((x, i) => ({ id: x.id, label: String(x.label ?? x.id).slice(0, 40),
      animation: x.animation === 'none' || !x.animation ? 'idle' : x.animation, pictureIndex: i + 3 }))
  }
}

export class AvatarResourceStore {
  constructor(root = process.cwd(), warn = message => globalThis.logger?.warn(message)) {
    this.root = root
    this.warn = warn
    this.entries = new Map()
    this.pending = new Map()
  }

  filename(botId, avatarId) {
    if (!/^\d{1,20}$/.test(String(botId))) throw new Error('Bot QQ 格式无效')
    return path.join(avatarRoot(this.root), validateAvatarId(avatarId), AVATAR_FILENAME)
  }

  async load(botId, avatarId) {
    const key = this.filename(botId, avatarId)
    if (this.pending.has(key)) return this.pending.get(key)
    const pending = this.read(key, avatarId)
    this.pending.set(key, pending)
    try { return await pending } finally { this.pending.delete(key) }
  }

  async read(key, avatarId) {
    let handle
    let signature
    const previous = this.entries.get(key)
    try {
      handle = await fs.open(await checkedAvatarPath(this.root, avatarId), 'r')
      const stat = await handle.stat()
      signature = stat.mtimeMs + ':' + stat.ctimeMs + ':' + stat.size
      if (previous?.signature === signature) return previous.resource
      if (previous?.failedSignature === signature) {
        if (previous.resource) return previous.resource
        throw new Error(previous.error.slice('角色文件读取失败：'.length))
      }
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('角色 JSON 必须是文件且不超过 32 MiB')
      // 分块读取也设上限，避免检查长度后文件被替换或持续增长。
      const chunks = []
      let total = 0
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        total += chunk.length
        if (total > MAX_FILE_BYTES) throw new Error('角色 JSON 超过 32 MiB')
        chunks.push(chunk)
      }
      const resource = await parseAvatarResource(Buffer.concat(chunks).toString('utf8'))
      this.entries.set(key, { signature, resource, error: '' })
      return resource
    } catch (err) {
      const message = '角色文件读取失败：' + err.message
      if (previous?.error !== message) this.warn('[ChatGPT] ' + avatarId + ' ' + message)
      // 保留上一次成功资源，避免手动更新中的半写文件破坏当前角色。
      this.entries.set(key, { ...previous, signature: undefined, failedSignature: signature, error: message })
      if (previous?.resource) return previous.resource
      throw new Error(message, { cause: err })
    } finally {
      if (handle) await handle.close()
    }
  }

  error(botId, avatarId) { return this.entries.get(this.filename(botId, avatarId))?.error || '' }
}
