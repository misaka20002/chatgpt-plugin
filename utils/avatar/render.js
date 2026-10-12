import sharp from 'sharp'
import gifenc from 'gifenc'
import { shortCaption, avatarRenderOptions } from './config.js'

const { GIFEncoder, quantize, applyPalette } = gifenc

// 特色表情过渡：正常段 → 交叉溶解（DISSOLVE_MS）→ 特色段，比例随时长自适应，特色段不短于 MIN_FEATURE_MS。
const DISSOLVE_MS = 350
const MIN_FEATURE_MS = 1000
// 特色段开头反应动作（抖动/跳动等）的缓入时长：避免位移瞬间跳变。
const REACTION_EASE_MS = 200
// 索引滞回（平方距离）：画面仅轻微移动时沿用上一帧调色板索引，抑制量化边界
// 被来回跨越产生的逐帧「色斑闪烁」；颜色确有明显变化时不受影响。
const INDEX_HYSTERESIS = 384

export function expressionTimeline(durationMs) {
  let normalMs = Math.round(durationMs * 0.5)
  let featureMs = durationMs - normalMs - DISSOLVE_MS
  if (featureMs < MIN_FEATURE_MS) {
    featureMs = MIN_FEATURE_MS
    normalMs = durationMs - DISSOLVE_MS - featureMs
  }
  return { normalMs: Math.max(0, normalMs), dissolveMs: DISSOLVE_MS, featureMs }
}

function isBlinking(resource, time) {
  return time >= resource.blinkMin && (time - resource.blinkMin) % resource.blinkMax < resource.blinkDuration
}

// expression 允许为 null（未选中特色）；action 传入时覆盖动作选择（过渡用它把基础段固定为 idle）。
function frameParts(resource, cue, time, durationMs, expression, action = null) {
  const blinking = isBlinking(resource, time)
  const talking = time < durationMs - 400 && Math.floor(time / 200) % 2 === 1
  const pictureIndex = expression ? expression.pictureIndex : blinking ? 1 : talking ? 2 : 0
  const motionAction = action ?? (cue.action === 'idle' && expression ? expression.animation : cue.action)
  const m = resource.motion
  const wave = period => Math.sin(time * Math.PI * 2 / period)
  const envelope = Math.sin(time * Math.PI / durationMs) ** 2
  let x = m.swayAmpX * wave(m.swayPeriod) * envelope
  let y = m.breathAmpY * wave(m.breathPeriod) * envelope
  let rotation = m.talkTiltMaxDeg * wave(m.talkTiltPeriod) * (expression ? 0 : 0.3) * envelope
  if (motionAction === 'bounce') y -= m.bounceAmp * Math.abs(wave(m.bouncePeriod)) * envelope
  if (motionAction === 'shake') x += m.shakeAmp * wave(240) * envelope
  if (motionAction === 'wobble') {
    x += m.wobbleAmp * wave(m.wobblePeriod) * envelope
    rotation += m.wobbleRot * wave(m.wobblePeriod) * envelope
  }
  if (motionAction === 'nod') {
    y += m.nodAmp * wave(m.nodPeriod) * envelope
    rotation += m.nodRot * wave(m.nodPeriod) * envelope
  }
  if (motionAction === 'headshake') {
    x += m.headshakeAmp * wave(m.headshakePeriod) * envelope
    rotation += m.headshakeRot * wave(m.headshakePeriod) * envelope
  }
  if (motionAction === 'recoil') y -= m.surpriseHopY * Math.abs(wave(Math.max(400, m.surpriseHopDur * 2))) * envelope
  return { pictureIndex, x, y, rotation }
}

export function avatarFrame(resource, cue, time, durationMs = 3000, options = {}) {
  const expression = resource.expressions.find(x => x.id === cue.expressionId) ?? null
  // 关闭过渡或未命中特色表情时保持旧行为：整段单张特色立绘 / 普通三帧循环。
  if (options.transition !== true || !expression) return frameParts(resource, cue, time, durationMs, expression)
  const { normalMs, dissolveMs } = expressionTimeline(durationMs)
  const featureStart = normalMs + dissolveMs
  // 正常段：基础三帧配基础运动（眨眼、说话动嘴照常）；反应动作不提前出现。
  if (time < normalMs) return frameParts(resource, cue, time, durationMs, null, 'idle')
  // 溶解段：两层共用基础运动，只是上层特色层渐显。
  if (time < featureStart) {
    const base = frameParts(resource, cue, time, durationMs, null, 'idle')
    const blinking = isBlinking(resource, time)
    return {
      pictureIndex: blinking ? 1 : 0,
      overlayIndex: blinking ? 1 : expression.pictureIndex,
      overlayOpacity: Math.min(1, (time - normalMs) / dissolveMs),
      x: base.x,
      y: base.y,
      rotation: base.rotation
    }
  }
  // 特色段：反应动作在过渡完成后短暂缓入（避免位移瞬间跳变）；眨眼按原节奏闪回基础闭眼帧。
  const base = frameParts(resource, cue, time, durationMs, null, 'idle')
  const feature = frameParts(resource, cue, time, durationMs, expression)
  const ease = Math.min(1, (time - featureStart) / REACTION_EASE_MS)
  return {
    pictureIndex: isBlinking(resource, time) ? 1 : feature.pictureIndex,
    x: base.x + (feature.x - base.x) * ease,
    y: base.y + (feature.y - base.y) * ease,
    rotation: base.rotation + (feature.rotation - base.rotation) * ease
  }
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

// GIF 只支持 1 位透明度：alpha ≤ 127 的像素统一成 (0,0,0,0)，其余置为完全不透明。
// 不做全屏有序抖动：固定图案的抖动叠加在逐帧轻微移动的画面上会不断改变取值，
// 形成肉眼可见的「色斑闪烁」，这里改为依赖调色板精度与逐像素最近色映射保证稳定。
function binarizeAlpha(rgba, width, height) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (rgba[i + 3] <= 127) {
        rgba[i] = 0
        rgba[i + 1] = 0
        rgba[i + 2] = 0
        rgba[i + 3] = 0
      } else {
        rgba[i + 3] = 255
      }
    }
  }
}

// 调色板采样用的等长 RGBA 混合：ratio 0..1 表示 top 的占比。
function mixSamples(bottom, top, ratio) {
  const mixed = Buffer.alloc(bottom.length)
  for (let i = 0; i < bottom.length; i += 4) {
    mixed[i] = Math.round(bottom[i] + (top[i] - bottom[i]) * ratio)
    mixed[i + 1] = Math.round(bottom[i + 1] + (top[i + 1] - bottom[i + 1]) * ratio)
    mixed[i + 2] = Math.round(bottom[i + 2] + (top[i + 2] - bottom[i + 2]) * ratio)
    mixed[i + 3] = Math.round(bottom[i + 3] + (top[i + 3] - bottom[i + 3]) * ratio)
  }
  return mixed
}

// 像素到调色板颜色的平方距离（索引滞回判定用）。
function colorDistance(rgba, pixel, color) {
  const dr = rgba[pixel] - color[0]
  const dg = rgba[pixel + 1] - color[1]
  const db = rgba[pixel + 2] - color[2]
  return dr * dr + dg * dg + db * db
}

// 只保留不透明像素参与调色板统计：透明区域不该占用色位。
function opaqueOnly(raw) {
  let count = 0
  for (let i = 3; i < raw.length; i += 4) if (raw[i] !== 0) count++
  const data = new Uint8Array(count * 4)
  let j = 0
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i + 3] === 0) continue
    data[j++] = raw[i]
    data[j++] = raw[i + 1]
    data[j++] = raw[i + 2]
    data[j++] = 255
  }
  return data
}

export async function renderAvatarGif(resource, cue, options = {}) {
  const { size, duration, fps } = avatarRenderOptions(options)
  const transition = options.transition === true
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
    // 采样保留 alpha 后再剔除透明像素：透明区域不占色位，flatten 或铺白底会污染调色板。
    samples.push(opaqueOnly(await sharp(Buffer.from(picture.data))
      .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer()))
  }
  // 交叉溶解开启且命中特色时，补入基础图与特色图的半程混合样本，减轻溶解过程的色阶。
  const transitionExpression = transition ? resource.expressions.find(x => x.id === cue.expressionId) : null
  if (transitionExpression) {
    const feature = await sharp(Buffer.from(resource.pictures[transitionExpression.pictureIndex].data))
      .resize(256, 256, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
    for (const index of [0, 1, 2]) {
      const picture = await sharp(Buffer.from(resource.pictures[index].data))
        .resize(256, 256, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
      samples.push(opaqueOnly(mixSamples(picture, feature, 0.5)))
    }
  }
  samples.push(opaqueOnly(await sharp(bubble)
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer()))
  // rgb565 精度（8/4/8 级色格）比 rgba4444（17 级色格）细，逐帧颜色微移时不易跨格跳色。
  const total = samples.reduce((n, sample) => n + sample.length, 0)
  const combined = new Uint8Array(total)
  let offset = 0
  for (const sample of samples) {
    combined.set(sample, offset)
    offset += sample.length
  }
  const colors = quantize(total ? combined : new Uint8Array([0, 0, 0, 255]), 255, { format: 'rgb565' })
  // 索引 0 固定为透明项（GIF 背景色与帧间清屏依赖它）；参与最近色匹配的只有后面的不透明色。
  const palette = [[0, 0, 0, 0], ...colors]
  const encoder = GIFEncoder()
  // 单帧最多两层：溶解帧上层带 opacity 渐显；其余帧与旧结构一致（单层、无 opacity）。
  const layer = (index, opacity) => {
    const picture = resource.pictures[index]
    const place = picture.place
    const content = '<g transform="translate(' + place.dx + ' ' + place.dy + ') rotate(' + place.rot
      + ') scale(' + place.scale + ')"><image x="' + (-picture.width / 2) + '" y="' + (-picture.height)
      + '" width="' + picture.width + '" height="' + picture.height
      + '" xlink:href="data:image/png;base64,' + images[index] + '"/></g>'
    return opacity == null ? content : '<g opacity="' + opacity.toFixed(4) + '">' + content + '</g>'
  }
  let previousIndex = null
  for (let i = 0; i < duration * fps; i++) {
    const frame = avatarFrame(resource, cue, i * 1000 / fps, duration * 1000, { transition })
    let avatar = layer(frame.pictureIndex)
    if (frame.overlayIndex != null) avatar += layer(frame.overlayIndex, frame.overlayOpacity)
    // 模板、变换和图片类型固定；模型输出只作为经过 XML 转义的气泡文本。
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
      + ' width="' + width + '" height="' + height + '" viewBox="0 0 512 ' + designHeight
      + '">'
      + '<defs><clipPath id="avatar"><rect x="16" y="8" width="480" height="' + (stageBottom + 16) + '"/></clipPath></defs>'
      + '<g clip-path="url(#avatar)"><g transform="translate(' + (256 + frame.x) + ' ' + (stageBottom + frame.y)
      + ') rotate(' + frame.rotation + ') scale(' + scale + ')">' + avatar + '</g></g></svg>'
    const rgba = await sharp(Buffer.from(svg)).composite([{ input: bubble }]).ensureAlpha().raw().toBuffer()
    // 透明输出：alpha 二值化后按最近色映射到不透明调色板，透明像素指向索引 0。
    binarizeAlpha(rgba, width, height)
    const index = applyPalette(rgba, colors, 'rgb565')
    for (let j = 0; j < index.length; j++) index[j] = rgba[j * 4 + 3] === 0 ? 0 : index[j] + 1
    // 索引滞回：仅轻微移动的像素沿用上一帧索引，避免在量化边界两侧来回跳色。
    if (previousIndex) {
      for (let j = 0; j < index.length; j++) {
        const current = index[j]
        const previous = previousIndex[j]
        if (current === previous || previous === 0) continue
        const pixel = j * 4
        if (rgba[pixel + 3] === 0) continue
        const near = colorDistance(rgba, pixel, palette[current])
        const kept = colorDistance(rgba, pixel, palette[previous])
        if (kept <= near + INDEX_HYSTERESIS) index[j] = previous
      }
    } else {
      previousIndex = new Uint8Array(index.length)
    }
    previousIndex.set(index)
    // GIF 延时单位是百分之一秒；累计舍入保证 15 FPS 的总时长仍准确。
    const delay = (Math.round((i + 1) * 100 / fps) - Math.round(i * 100 / fps)) * 10
    // palette[0] 固定为透明项，dispose 会被 gifenc 在透明帧上强制为 2。
    encoder.writeFrame(index, width, height,
      { palette: i === 0 ? palette : undefined, delay, repeat: 0, transparent: true, transparentIndex: 0 })
    if (encoder.bytesView().byteLength > 8 * 1024 * 1024) throw new Error('角色 GIF 超过 8 MiB')
  }
  encoder.finish()
  const output = Buffer.from(encoder.bytes())
  if (output.length > 8 * 1024 * 1024) throw new Error('角色 GIF 超过 8 MiB')
  return output
}
