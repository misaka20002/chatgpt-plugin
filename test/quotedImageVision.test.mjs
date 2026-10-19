/**
 * 本地辅助验证（随仓库入库）：引用图接入模型前的预处理与四家 provider 载荷
 *
 * 运行：node --experimental-test-module-mocks --test test/quotedImageVision.test.mjs
 *
 * 覆盖点：
 * 1. 阈值内的 jpeg/png/webp 原样送出（不做无谓重编码）
 * 2. 大尺寸小体积的图不被缩放（保持原始分辨率与画面内容）
 * 3. 超过 2MB 的图转 jpeg 但不改尺寸
 * 4. 超过 10MB 的引用图直接丢弃
 * 5. 动图（gif）只取首帧转 jpeg
 * 6. 引用图上限 4 张，logger.info 记录实际张数
 * 7. 取不到的引用图只累计 failed，不抛错
 * 8. 事件地址按 CQ 还原后比较（&amp; 写法与明文写法等价），模型自造地址不匹配
 * 9. 四家 provider 的载荷形状（OpenAI / Responses / Claude / Gemini）
 */
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import sharp from 'sharp'

const logs = { info: [], warn: [] }
globalThis.logger = {
  info: (message) => logs.info.push(String(message)),
  warn: (message) => logs.warn.push(String(message)),
  error() { }, mark() { }, debug() { }
}
globalThis.redis = { get: async () => 'api', set: async () => 'OK', exists: async () => 0 }
globalThis.Bot = {}
globalThis.segment = {}

// Gemini 客户端会拉起框架级重依赖（lib/config 等），本测试只验证预处理与载荷，用空壳替换
mock.module('../client/CustomGoogleGeminiClient.js', {
  namedExports: { CustomGoogleGeminiClient: class { } }
})

const {
  normalizeVisionImage,
  loadQuotedImageMedias,
  loadQuotedImages,
  collectEventMediaUrls,
  isTrustedEventMediaUrl,
  appendMediaFailureHint,
  resolveTurnSystem
} = await import('../utils/quotedImage.js')
const {
  buildOpenAIContent,
  buildResponsesInput,
  buildClaudeImageBlocks,
  buildGeminiInlineParts,
  pickMediaList
} = await import('../utils/visionPayload.js')

const JPEG_THRESHOLD_BYTES = 2 * 1024 * 1024
const MAX_BYTES = 10 * 1024 * 1024
/** 1x1 透明 gif，只用来验证「动图转首帧」这条路 */
const TINY_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

async function makeSolidPng(width, height) {
  return sharp({ create: { width, height, channels: 3, background: '#3a7' } }).png().toBuffer()
}

async function makeNoisePng(edge) {
  const raw = crypto.randomBytes(edge * edge * 3)
  return sharp(raw, { raw: { width: edge, height: edge, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
}

test('阈值内的 png 原样送出，不重编码', async () => {
  const png = await makeSolidPng(64, 64)
  const media = await normalizeVisionImage(png)
  assert.equal(media.mimeType, 'image/png')
  assert.equal(media.data, png.toString('base64'))
})

test('大尺寸小体积的图不缩放，按原始尺寸送出', async () => {
  const png = await makeSolidPng(3000, 3000)
  assert.ok(png.length < JPEG_THRESHOLD_BYTES, `构造的 png 有 ${png.length} 字节，不应触发转码`)
  const media = await normalizeVisionImage(png)
  assert.equal(media.mimeType, 'image/png')
  const meta = await sharp(Buffer.from(media.data, 'base64')).metadata()
  assert.equal(meta.width, 3000)
  assert.equal(meta.height, 3000)
})

test('超过 2 MB 转 jpeg，但不改尺寸（2–5 MB 区间也要转）', async () => {
  const png = await makeNoisePng(1000)
  assert.ok(png.length > JPEG_THRESHOLD_BYTES && png.length < 5 * 1024 * 1024, `构造的 png 有 ${png.length} 字节，应落在 2–5 MB 区间`)
  const media = await normalizeVisionImage(png)
  assert.equal(media.mimeType, 'image/jpeg')
  const meta = await sharp(Buffer.from(media.data, 'base64')).metadata()
  assert.equal(meta.width, 1000)
  assert.equal(meta.height, 1000)
})

test('超过 10 MB 的引用图直接丢弃', async () => {
  const png = await makeNoisePng(2000)
  assert.ok(png.length > MAX_BYTES, `构造的 png 只有 ${png.length} 字节`)
  const { medias, failed } = await loadQuotedImageMedias({ img: [`base64://${png.toString('base64')}`] })
  assert.equal(medias.length, 0)
  assert.equal(failed, 1)
})

test('动图只取首帧转 jpeg', async () => {
  const media = await normalizeVisionImage(Buffer.from(TINY_GIF, 'base64'))
  assert.equal(media.mimeType, 'image/jpeg')
  const meta = await sharp(Buffer.from(media.data, 'base64')).metadata()
  assert.equal(meta.format, 'jpeg')
})

test('引用图最多 4 张，info 日志记录实际张数', async () => {
  const gifUrl = `base64://${TINY_GIF}`
  const e = { img: Array.from({ length: 6 }, () => gifUrl) }
  logs.info.length = 0
  const { medias, failed } = await loadQuotedImageMedias(e)
  assert.equal(medias.length, 4)
  assert.equal(failed, 0)
  const line = logs.info.find(text => text.includes('[ChatGPT][引用图]'))
  assert.ok(line && line.includes('6 张') && line.includes('实际送入 4 张'), `实际日志：${line}`)
})

test('取不到的引用图只累计 failed，不影响其它图', async () => {
  const e = { img: ['base64://不是图片的字节', `base64://${TINY_GIF}`] }
  const { medias, failed } = await loadQuotedImageMedias(e)
  assert.equal(medias.length, 1)
  assert.equal(failed, 1)
})

test('事件地址按 CQ 还原后比较', () => {
  const plain = 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=abc&rkey=xyz'
  const escaped = plain.replace(/&/g, '&amp;')
  const e = { img: [escaped], get_Video: [{ url: 'https://example.com/v.mp4' }] }
  assert.ok(collectEventMediaUrls(e).has(plain))
  assert.ok(isTrustedEventMediaUrl(e, plain))
  assert.ok(isTrustedEventMediaUrl(e, escaped))
  assert.ok(isTrustedEventMediaUrl(e, 'https://example.com/v.mp4'))
  assert.equal(isTrustedEventMediaUrl(e, plain.replace('xyz', 'other')), false)
  assert.equal(isTrustedEventMediaUrl(e, 'https://evil.example/a.jpg'), false)
  assert.equal(isTrustedEventMediaUrl(undefined, plain), false)
})

test('OpenAI / Responses 载荷：多图展开，无图保持字符串', () => {
  const medias = [{ mimeType: 'image/png', data: 'AAA' }, { mimeType: 'image/jpeg', data: 'BBB' }]

  const openai = buildOpenAIContent('hi', medias)
  assert.equal(openai.length, 3)
  assert.deepEqual(openai[0], { type: 'text', text: 'hi' })
  assert.deepEqual(openai[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } })
  assert.equal(buildOpenAIContent('hi', []), 'hi')

  const responses = buildResponsesInput('hi', medias)
  assert.equal(responses[0].role, 'user')
  assert.equal(responses[0].content.length, 3)
  assert.deepEqual(responses[0].content[1], { type: 'input_image', image_url: 'data:image/png;base64,AAA' })
  assert.equal(buildResponsesInput('hi', []), 'hi')
})

test('Claude / Gemini 载荷：每个媒体一段，MIME 原样保留', () => {
  const medias = [{ mimeType: 'image/png', data: 'AAA' }, { mimeType: 'image/jpeg', data: 'BBB' }]

  const blocks = buildClaudeImageBlocks(medias)
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } })

  const parts = buildGeminiInlineParts(medias)
  assert.equal(parts.length, 2)
  assert.deepEqual(parts[1], { inline_data: { mime_type: 'image/jpeg', data: 'BBB' } })
  // data URL 头部要被剥掉，否则 Gemini 会收到非法 base64
  assert.deepEqual(
    buildGeminiInlineParts([{ data: 'data:image/webp;base64,ZZZ' }])[0],
    { inline_data: { mime_type: 'image/webp', data: 'ZZZ' } }
  )
})

test('pickMediaList 优先多图，SubLLM 的单 media 仍然兼容', () => {
  const multi = [{ mimeType: 'image/png', data: 'A' }, { mimeType: 'image/png', data: 'B' }]
  assert.deepEqual(pickMediaList({ medias: multi }), multi)
  assert.deepEqual(pickMediaList({ media: { data: 'S' } }), [{ data: 'S' }])
  assert.deepEqual(pickMediaList({}), [])
  // 空数组不能挡住单图契约
  assert.deepEqual(pickMediaList({ medias: [], media: { data: 'S' } }), [{ data: 'S' }])
})

test('引用图失败提示只进 system，不进用户消息', () => {
  const withHint = appendMediaFailureHint('你是助手。')
  assert.ok(withHint.startsWith('你是助手。'))
  assert.ok(withHint.includes('引用的图片获取失败'))
  // 空 system 也要能独立成句
  assert.ok(appendMediaFailureHint('').includes('引用的图片获取失败'))
})

test('主备复用 prepared 时，失败提示不写进缓存也不重复累加', () => {
  const prepared = {}
  const first = resolveTurnSystem(prepared, '基础系统', true)
  assert.ok(first.startsWith('基础系统'))
  assert.ok(first.includes('引用的图片获取失败'))
  assert.equal(prepared.system, '基础系统', '缓存必须保持基础版本')

  // 备用 provider 这次取图成功：不得带着主 provider 那次的失败提示
  const second = resolveTurnSystem(prepared, '备用基础系统', false)
  assert.ok(!second.includes('引用的图片获取失败'))

  // 连续两次都失败：提示只出现一次（缓存里没有，不会叠加）
  const third = resolveTurnSystem(prepared, '基础系统', true)
  assert.equal(third.split('引用的图片获取失败').length - 1, 1)
})

test('一轮只取一次：同一 prepared 复用取图结果，换 prepared 重新取', async () => {
  const gif = `base64://${TINY_GIF}`
  const prepared = {}
  logs.info.length = 0
  const first = await loadQuotedImages({ img: [gif] }, prepared)
  const second = await loadQuotedImages({ img: [gif] }, prepared)
  assert.equal(first, second, '同一轮必须复用同一个结果对象')
  assert.equal(second.medias.length, 1)
  // 下载日志只出现一次，证明没有重复取图
  assert.equal(logs.info.filter(text => text.includes('[ChatGPT][引用图]')).length, 1)

  const fresh = await loadQuotedImages({ img: [gif] }, {})
  assert.notEqual(fresh, first)
})
