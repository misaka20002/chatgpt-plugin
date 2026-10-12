import sharp from 'sharp'
import gifenc from 'gifenc'
import { shortCaption, avatarRenderOptions } from './config.js'

const { GIFEncoder, quantize, applyPalette } = gifenc

export function avatarFrame(resource, cue, time, durationMs = 3000) {
  const expression = resource.expressions.find(x => x.id === cue.expressionId)
  const blinkAt = resource.blinkMin
  const blinking = time >= blinkAt && (time - blinkAt) % resource.blinkMax < resource.blinkDuration
  const talking = time < durationMs - 400 && Math.floor(time / 200) % 2 === 1
  const pictureIndex = expression ? expression.pictureIndex : blinking ? 1 : talking ? 2 : 0
  const action = cue.action === 'idle' && expression ? expression.animation : cue.action
  const m = resource.motion
  const wave = period => Math.sin(time * Math.PI * 2 / period)
  const envelope = Math.sin(time * Math.PI / durationMs) ** 2
  let x = m.swayAmpX * wave(m.swayPeriod) * envelope
  let y = m.breathAmpY * wave(m.breathPeriod) * envelope
  let rotation = m.talkTiltMaxDeg * wave(m.talkTiltPeriod) * (expression ? 0 : 0.3) * envelope
  if (action === 'bounce') y -= m.bounceAmp * Math.abs(wave(m.bouncePeriod)) * envelope
  if (action === 'shake') x += m.shakeAmp * wave(240) * envelope
  if (action === 'wobble') {
    x += m.wobbleAmp * wave(m.wobblePeriod) * envelope
    rotation += m.wobbleRot * wave(m.wobblePeriod) * envelope
  }
  if (action === 'nod') {
    y += m.nodAmp * wave(m.nodPeriod) * envelope
    rotation += m.nodRot * wave(m.nodPeriod) * envelope
  }
  if (action === 'headshake') {
    x += m.headshakeAmp * wave(m.headshakePeriod) * envelope
    rotation += m.headshakeRot * wave(m.headshakePeriod) * envelope
  }
  if (action === 'recoil') y -= m.surpriseHopY * Math.abs(wave(Math.max(400, m.surpriseHopDur * 2))) * envelope
  return { pictureIndex, x, y, rotation }
}

function escapeXml(text) {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&apos;' })[c])
}

function bubbleSvg(caption, width, height, designHeight) {
  const characters = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(shortCaption(caption))]
    .map(x => x.segment)
  const lines = [characters.slice(0, 12).join(''), characters.slice(12).join('')].filter(Boolean)
  const top = designHeight === 640 ? 520 : 408
  const text = lines.map((line, i) => '<text x="256" y="' + (lines.length === 1 ? top + 60 : top + 42 + i * 36)
    + '" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#5b4035">'
    + escapeXml(line) + '</text>').join('')
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height
    + '" viewBox="0 0 512 ' + designHeight + '">'
    + '<path d="M80 ' + top + ' L246 ' + top + ' L256 ' + (top - 18) + ' L266 ' + top
    + ' L432 ' + top + ' Q464 ' + top + ' 464 ' + (top + 30) + ' L464 ' + (top + 68)
    + ' Q464 ' + (top + 96) + ' 432 ' + (top + 96) + ' L80 ' + (top + 96)
    + ' Q48 ' + (top + 96) + ' 48 ' + (top + 68) + ' L48 ' + (top + 30) + ' Q48 ' + top + ' 80 ' + top + '"'
    + ' fill="#fff5ed" stroke="#e5c7b6" stroke-width="2"/>' + text + '</svg>'
}

// 标准 8×8 Bayer 矩阵：只给不透明像素加有序抖动，压制 256 色量化的色阶。
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21
]
const DITHER_STRENGTH = 10

function clamp255(value) { return value < 0 ? 0 : value > 255 ? 255 : Math.round(value) }

// GIF 只支持 1 位透明度：全透明像素统一成 (0,0,0,0)（对齐调色板索引 0），
// 不透明像素保持颜色并叠加有序抖动；不做这一步，近透明的边缘会被量化成白色光晕。
function applyAlphaAndDither(rgba, width, height) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (rgba[i + 3] <= 127) {
        rgba[i] = 0
        rgba[i + 1] = 0
        rgba[i + 2] = 0
        rgba[i + 3] = 0
        continue
      }
      const offset = ((BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64 - 0.5) * 2 * DITHER_STRENGTH
      rgba[i] = clamp255(rgba[i] + offset)
      rgba[i + 1] = clamp255(rgba[i + 1] + offset)
      rgba[i + 2] = clamp255(rgba[i + 2] + offset)
      rgba[i + 3] = 255
    }
  }
}

export async function renderAvatarGif(resource, cue, options = {}) {
  const { size, duration, fps } = avatarRenderOptions(options)
  const [width, height] = size.split('x').map(Number)
  const designHeight = height * 512 / width
  const stageBottom = designHeight === 640 ? 472 : 384
  const imageSize = designHeight === 640 ? 448 : 360
  const bubble = await sharp(Buffer.from(bubbleSvg(cue.caption, width, height, designHeight))).png().toBuffer()
  const base = resource.pictures[0]
  const scale = Math.min(imageSize / base.width, imageSize / base.height)
  const images = resource.pictures.map(p => Buffer.from(p.data).toString('base64'))
  const samples = []
  for (const picture of resource.pictures) {
    // 采样必须保留 alpha：flatten 或铺白底会把半透明边缘的白色污染进调色板。
    samples.push(await sharp(Buffer.from(picture.data))
      .resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer())
  }
  samples.push(await sharp(bubble)
    .resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer())
  // 透明项必须落在索引 0：gifenc 的背景色索引固定为 0，透明帧的帧间清屏依赖它。
  const palette = quantize(Buffer.concat(samples), 255, { format: 'rgba4444', oneBitAlpha: true })
  const transparentIndex = palette.findIndex(color => color[3] === 0)
  if (transparentIndex > 0) {
    const transparent = palette[0]
    palette[0] = palette[transparentIndex]
    palette[transparentIndex] = transparent
  } else if (transparentIndex < 0) palette.unshift([0, 0, 0, 0])
  const encoder = GIFEncoder()
  for (let i = 0; i < duration * fps; i++) {
    const frame = avatarFrame(resource, cue, i * 1000 / fps, duration * 1000)
    const picture = resource.pictures[frame.pictureIndex]
    const place = picture.place
    const w = picture.width
    const h = picture.height
    // 模板、变换和图片类型固定；模型输出只作为经过 XML 转义的气泡文本。
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
      + ' width="' + width + '" height="' + height + '" viewBox="0 0 512 ' + designHeight
      + '">'
      + '<defs><clipPath id="avatar"><rect x="16" y="8" width="480" height="' + (stageBottom + 16) + '"/></clipPath></defs>'
      + '<g clip-path="url(#avatar)"><g transform="translate(' + (256 + frame.x) + ' ' + (stageBottom + frame.y)
      + ') rotate(' + frame.rotation + ') scale(' + scale + ') translate(' + place.dx + ' ' + place.dy
      + ') rotate(' + place.rot + ') scale(' + place.scale + ')">'
      + '<image x="' + (-w / 2) + '" y="' + (-h) + '" width="' + w + '" height="' + h
      + '" xlink:href="data:image/png;base64,' + images[frame.pictureIndex] + '"/></g></g></svg>'
    const rgba = await sharp(Buffer.from(svg)).composite([{ input: bubble }]).ensureAlpha().raw().toBuffer()
    // 透明输出：先做 alpha 二值化与有序抖动，再映射到全局调色板。
    applyAlphaAndDither(rgba, width, height)
    // GIF 延时单位是百分之一秒；累计舍入保证 15 FPS 的总时长仍准确。
    const delay = (Math.round((i + 1) * 100 / fps) - Math.round(i * 100 / fps)) * 10
    // palette[0] 由上方保证是透明项，dispose 会被 gifenc 在透明帧上强制为 2。
    encoder.writeFrame(applyPalette(rgba, palette, 'rgba4444'), width, height,
      { palette: i === 0 ? palette : undefined, delay, repeat: 0, transparent: true, transparentIndex: 0 })
    if (encoder.bytesView().byteLength > 8 * 1024 * 1024) throw new Error('角色 GIF 超过 8 MiB')
  }
  encoder.finish()
  const output = Buffer.from(encoder.bytes())
  if (output.length > 8 * 1024 * 1024) throw new Error('角色 GIF 超过 8 MiB')
  return output
}
