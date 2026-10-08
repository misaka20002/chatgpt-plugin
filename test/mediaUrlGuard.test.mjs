/**
 * 本地辅助验证（随仓库入库）：
 * 不可信媒体地址的来源校验、连接目标固定、MIME 校验与下载资源边界
 *
 * 运行：node --experimental-test-module-mocks --test test/mediaUrlGuard.test.mjs
 *
 * 覆盖点：
 * 1. 拒绝非网络地址（file://、本地绝对路径）与内网/本机地址，含 IPv4-mapped / compatible IPv6 的十六进制写法
 * 2. 拒绝可能被解析器当成整数 IPv4 的纯数字 / 0x 主机名
 * 3. 放行公网地址（含公网 IPv6）
 * 4. 严格模式返回已校验的连接目标（供固定连接，防 DNS rebinding）
 * 5. url2Base64 严格模式不读本地文件、不接受 base64 直传；默认模式保留旧能力（回归）
 * 6. 响应体超过上限时拒绝（声明长度与流式累计两条路径）
 * 7. mediaKind 校验：返回 200 的 text/html 在读 body 前被拒绝
 * 8. base64 恰好等于上限时不被误杀（padding 修正）
 * 9. 识别函数的失败契约与 prompt 语义（显式空 prompt 不回退 e.msg）
 * 10. 二进制视频响应按内容确认类型，拒绝非视频与超限响应，并向识别工具传递正确 MIME
 */
import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Response } from 'node-fetch'

globalThis.logger = {
  info() { }, warn() { }, error() { }, mark() { }, debug() { },
  blue: (s) => s, cyan: (s) => s, red: (s) => s
}
globalThis.redis = { get: async () => 'api', set: async () => 'OK', exists: async () => 0 }
globalThis.Bot = {}
globalThis.segment = {}

const geminiCalls = []

// 只替换公网请求边界，让工具仍执行真实的地址校验、下载、类型探测与 SubLLM 载荷组装。
const { newFetch } = await import('../utils/proxy.js')
const videoUrl = 'https://1.1.1.1/download?format=origin'
const mp4Header = Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex')
const strictVideoOptions = { allowLocalFile: false, allowPrivateNetwork: false, mediaKind: 'video', maxSizeBytes: 1024 }
let videoResponse
mock.module('../utils/proxy.js', {
  namedExports: {
    newFetch: (url, options) => {
      if (url !== videoUrl) return newFetch(url, options)
      assert.equal(options.redirect, 'manual')
      assert.ok(options.agent, '严格模式仍须固定连接目标')
      return new Response(videoResponse.body, { headers: videoResponse.headers })
    }
  }
})

// Gemini 客户端会拉起框架级重依赖（lib/config 等）；本测试只验证下载与地址校验，用记录式桩替换
mock.module('../client/CustomGoogleGeminiClient.js', {
  namedExports: {
    CustomGoogleGeminiClient: class {
      async sendMessage(prompt, option) {
        geminiCalls.push({ prompt, option })
        return { text: 'gemini-ok' }
      }
    }
  }
})

mock.module('../utils/openai/chatgpt-api.js', { namedExports: { ChatGPTAPI: class {} } })
mock.module('../client/ClaudeAPIClient.js', { namedExports: { ClaudeAPIClient: class {} } })
const { Config, providerDefaults } = await import('../utils/config.js')
Object.assign(Config.getConfig(), { modelProviders: { api: [], responses: [], claude: [], gemini: [{ ...providerDefaults.gemini, id: 'gemini', name: '默认', geminiKey: 'test-key' }] }, defaultProviderId: 'gemini', imageProviderId: 'gemini', videoProviderId: 'gemini' })
const {
  assertSafeRemoteMediaUrl,
  resolveSafeRemoteMediaUrl,
  url2Base64,
  recognitionResultsByGemini
} = await import('../utils/paimonFuction.js')
const { RecognitionResultsByGeminiTool } = await import('../utils/tools/RecognitionResultsByGeminiTool.js')

const REJECTED_URLS = [
  'file:///etc/passwd',
  'http://127.0.0.1:8080/a.jpg',
  'http://[::1]/a.jpg',
  // IPv4-mapped 的十六进制写法：只匹配 dotted 写法的正则会漏掉这些
  'http://[::ffff:7f00:1]/a.jpg',
  'http://[::ffff:a00:1]/a.jpg',
  'http://[::ffff:c0a8:1]/a.jpg',
  'http://[::ffff:127.0.0.1]/a.jpg',
  // IPv4-compatible 写法
  'http://[::7f00:1]/a.jpg',
  'http://[fe80::1]/a.jpg',
  'http://[fec0::1]/a.jpg',
  'http://[64:ff9b:1::1]/a.jpg',
  'http://[fd00::1]/a.jpg',
  'http://[ff02::1]/a.jpg',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.0.0.8/a.jpg',
  'http://172.16.0.1/a.jpg',
  'http://192.168.1.5/a.jpg',
  'http://100.64.0.1/a.jpg',
  'http://0.0.0.0/a.jpg',
  'ftp://example.com/a.jpg',
  // inet_aton 兼容的整数 IPv4 写法
  'http://2130706433/a.jpg',
  'http://0x7f000001/a.jpg',
  'not-a-url'
]

for (const url of REJECTED_URLS) {
  test(`不可信来源拒绝地址: ${url}`, async () => {
    await assert.rejects(() => assertSafeRemoteMediaUrl(url))
  })
}

test('放行公网地址（含公网 IPv6 与 WKP NAT64 前缀）', async () => {
  await assertSafeRemoteMediaUrl('http://1.1.1.1/a.jpg')
  await assertSafeRemoteMediaUrl('https://8.8.8.8/a.jpg')
  await assertSafeRemoteMediaUrl('http://[2606:4700:4700::1111]/a.jpg')
  // 64:ff9b::/96 是公网 WKP（其编码私网 IPv4 由 RFC 6052 明令禁止）；
  // 被拒绝的是 local-use 的 64:ff9b:1::/48，两者不能一起拦
  await assertSafeRemoteMediaUrl('http://[64:ff9b::808:808]/a.jpg')
})

test('严格模式返回已校验的连接目标（用于固定连接，防 DNS rebinding）', async () => {
  assert.deepEqual(await resolveSafeRemoteMediaUrl('http://1.1.1.1/a.jpg'), { address: '1.1.1.1', family: 4 })

  const v6 = await resolveSafeRemoteMediaUrl('http://[2606:4700:4700::1111]/a.jpg')
  assert.equal(v6.family, 6)
  assert.ok(v6.address.includes('2606:4700:4700::1111'), '应返回规范化后的 IPv6 地址')
})

test('严格模式不读本地文件，默认模式仍可读（回归）', async () => {
  const tmpFile = path.join(os.tmpdir(), `media-guard-${process.pid}.bin`)
  fs.writeFileSync(tmpFile, 'not-an-image-but-readable')
  const fileUrl = pathToFileURL(tmpFile).href

  try {
    const strict = await url2Base64(fileUrl, false, true, { allowLocalFile: false })
    assert.equal(strict, null, '严格模式必须拒绝本地文件')

    const legacy = await url2Base64(fileUrl, false, true, {})
    assert.ok(legacy?.imageBlob, '默认模式应保持原有能力')
  } finally {
    fs.rmSync(tmpFile, { force: true })
  }
})

test('严格模式不接受 base64 直传', async () => {
  const strict = await url2Base64('base64://QUJD', false, true, { allowLocalFile: false })
  assert.equal(strict, null)
})

test('base64 恰好等于上限时不被误杀，超过上限仍拒绝（padding 修正）', async () => {
  const exact = Buffer.alloc(1024, 7)
  const exactRes = await url2Base64(`base64://${exact.toString('base64')}`, false, true, { maxSizeBytes: 1024 })
  assert.ok(exactRes?.imageBlob, '恰好等于上限应当通过')
  assert.equal(exactRes.contentLength, 1024)

  const over = Buffer.alloc(1025, 7)
  const overRes = await url2Base64(`base64://${over.toString('base64')}`, false, true, { maxSizeBytes: 1024 })
  assert.equal(overRes, null, '超过上限应当拒绝')
})

let server
let baseUrl

before(async () => {
  server = http.createServer((req, res) => {
    res.on('error', () => { })

    if (req.url === '/img') {
      res.writeHead(200, { 'content-type': 'image/jpeg' })
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
      return
    }

    if (req.url === '/html') {
      // 典型的 WAF / 登录页：HTTP 200，但不是媒体
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><body>interstitial</body></html>')
      return
    }

    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/img' })
      res.end()
      return
    }

    if (req.url === '/big-declared') {
      const body = Buffer.alloc(64 * 1024)
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(body.length) })
      res.end(body)
      return
    }

    if (req.url === '/big-chunked') {
      // 不声明 content-length，用于验证流式累计上限
      res.writeHead(200, { 'content-type': 'image/jpeg' })
      const chunk = Buffer.alloc(8 * 1024)
      let sent = 0
      const pump = () => {
        while (sent < 64 * 1024) {
          sent += chunk.length
          if (!res.write(chunk)) {
            res.once('drain', pump)
            return
          }
        }
        res.end()
      }
      pump()
      return
    }

    res.writeHead(404)
    res.end()
  })
  server.on('clientError', (err, socket) => socket.destroy())

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server?.close()
})

test('默认模式：重定向会被跟随', async () => {
  const res = await url2Base64(`${baseUrl}/redirect`, false, true, { maxSizeBytes: 1024 * 1024 })
  assert.ok(res?.imageBlob)
})

test('严格模式：内网地址在下载前就被拒绝', async () => {
  const res = await url2Base64(`${baseUrl}/img`, false, true, {
    maxSizeBytes: 1024 * 1024,
    allowPrivateNetwork: false
  })
  assert.equal(res, null)
})

test('声明长度超限时拒绝', async () => {
  const res = await url2Base64(`${baseUrl}/big-declared`, false, true, { maxSizeBytes: 1024 })
  assert.equal(res, null)
})

test('无 content-length 时按流式累计字节拒绝', async () => {
  const res = await url2Base64(`${baseUrl}/big-chunked`, false, true, { maxSizeBytes: 1024 })
  assert.equal(res, null)
})

test('mediaKind 校验：返回 200 的 text/html 被拒绝，image/* 正常放行', async () => {
  const html = await url2Base64(`${baseUrl}/html`, false, true, {
    maxSizeBytes: 1024 * 1024,
    mediaKind: 'image'
  })
  assert.equal(html, null, 'HTML 响应不能当成图片')

  const img = await url2Base64(`${baseUrl}/img`, false, true, {
    maxSizeBytes: 1024 * 1024,
    mediaKind: 'image'
  })
  assert.ok(img?.imageBlob, 'image/* 应正常放行')

  const asVideo = await url2Base64(`${baseUrl}/img`, false, true, {
    maxSizeBytes: 1024 * 1024,
    mediaKind: 'video'
  })
  assert.equal(asVideo, null, '按视频请求时 image/* 应被拒绝')
})

test('视频响应为通用二进制或缺少类型时，按文件内容确认 MP4 并修正 MIME', async () => {
  for (const headers of [{ 'content-type': 'Application/Octet-Stream; charset=binary' }, {}]) {
    videoResponse = { body: mp4Header, headers }
    const result = await url2Base64(videoUrl, false, true, strictVideoOptions)
    assert.ok(result?.imageBlob, '无扩展名的视频下载地址应能通过内容探测')
    assert.equal(result.imageBlob.type, 'video/mp4')
    assert.equal(result.fileName, 'video.mp4')
    assert.deepEqual(Buffer.from(await result.imageBlob.arrayBuffer()), mp4Header)
  }
})

test('兼容旧版 file-type 的 CommonJS fromBuffer 导出', async (t) => {
  // 仅改变依赖的导出形状，文件签名仍由真实解析器检测。
  const installedFileType = await import('file-type')
  const fromBuffer = installedFileType.fileTypeFromBuffer || installedFileType.default?.fromBuffer || installedFileType.fromBuffer
  t.mock.module('file-type', { defaultExport: { fromBuffer } })
  videoResponse = { body: mp4Header, headers: { 'content-type': 'application/octet-stream' } }
  const result = await url2Base64(videoUrl, false, true, strictVideoOptions)
  assert.equal(result?.imageBlob.type, 'video/mp4')
  assert.deepEqual(Buffer.from(await result.imageBlob.arrayBuffer()), mp4Header)

  videoResponse = { body: Buffer.from('<html>登录失效</html>'), headers: { 'content-type': 'application/octet-stream' } }
  assert.equal(await url2Base64(videoUrl, false, true, strictVideoOptions), null)
})

test('通用二进制响应中的非视频、空内容与截断文件仍被拒绝', async () => {
  const invalidBodies = [
    Buffer.from('<html>登录失效</html>'),
    Buffer.from('{"error":"expired"}'),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    Buffer.from('00000018667479704d3441200000000069736f6d4d344120', 'hex'),
    Buffer.alloc(0),
    mp4Header.subarray(0, 8)
  ]
  for (const body of invalidBodies) {
    videoResponse = { body, headers: { 'content-type': 'application/octet-stream' } }
    assert.equal(await url2Base64(videoUrl, false, true, strictVideoOptions), null)
  }
})

test('二进制视频兼容仍执行声明长度和流式累计大小限制', async () => {
  for (const response of [
    { body: mp4Header, headers: { 'content-type': 'application/octet-stream', 'content-length': '2048' } },
    { body: Buffer.concat([mp4Header, Buffer.alloc(2048)]), headers: { 'content-type': 'application/octet-stream' } }
  ]) {
    videoResponse = response
    assert.equal(await url2Base64(videoUrl, false, true, strictVideoOptions), null)
  }
})

test('视频类型探测不放行明确的 HTML 类型，也不放宽图片类型校验', async () => {
  videoResponse = { body: mp4Header, headers: { 'content-type': 'text/html' } }
  assert.equal(await url2Base64(videoUrl, false, true, strictVideoOptions), null)

  videoResponse = { body: mp4Header, headers: { 'content-type': 'application/octet-stream' } }
  assert.equal(await url2Base64(videoUrl, false, true, { ...strictVideoOptions, mediaKind: 'image' }), null)
})

test('视频识别工具两种来源均将探测后的 MIME 与原始数据传给 Gemini', async () => {
  const cfg = Config.getConfig()
  const originalSource = cfg.mediaRecognitionSource
  try {
    for (const source of ['Orignal', 'Gemini']) {
      cfg.mediaRecognitionSource = source
      geminiCalls.length = 0
      videoResponse = { body: mp4Header, headers: { 'content-type': 'application/octet-stream' } }
      const result = await new RecognitionResultsByGeminiTool().func(
        { videoUrl, question: '描述视频内容' },
        { sender: { user_id: '1' }, modelProviderId: 'gemini', msg: '原始问题' }
      )
      assert.match(result, /^\[Untrusted media content\./)
      assert.match(result, /gemini-ok/)
      assert.equal(geminiCalls.length, 1)
      assert.deepEqual(geminiCalls[0].option.media, { mimeType: 'video/mp4', data: mp4Header.toString('base64') })
    }

    geminiCalls.length = 0
    videoResponse = { body: Buffer.from('<html>登录失效</html>'), headers: { 'content-type': 'application/octet-stream' } }
    const errorResult = await new RecognitionResultsByGeminiTool().func({ videoUrl }, { sender: { user_id: '1' } })
    assert.match(errorResult, /^Error: /)
    assert.equal(geminiCalls.length, 0, '非视频内容不得提交模型')
  } finally {
    cfg.mediaRecognitionSource = originalSource
  }
})

test('识别函数默认保持「返回错误字符串」旧契约（供非工具调用点使用）', async () => {
  const cfg = Config.getConfig()
  const originalKey = cfg.geminiKey
  cfg.geminiKey = ''
  try {
    const result = await recognitionResultsByGemini({ sender: { user_id: '1' }, msg: 'hi' }, ['https://example.com/a.jpg'])
    assert.match(result, /^识别出错：/)
  } finally {
    cfg.geminiKey = originalKey
  }
})

test('throwOnError 时识别函数抛错（工具靠它区分失败并回退）', async () => {
  const cfg = Config.getConfig()
  const originalKey = cfg.geminiKey
  cfg.geminiKey = ''
  try {
    await assert.rejects(() => recognitionResultsByGemini(
      { sender: { user_id: '1' }, msg: 'hi' },
      ['https://example.com/a.jpg'],
      [],
      undefined,
      { throwOnError: true }
    ))
  } finally {
    cfg.geminiKey = originalKey
  }
})

test('显式传入空 prompt 时识别函数不再回退到 e.msg', async () => {
  const cfg = Config.getConfig()
  const originalKey = cfg.geminiKey
  cfg.geminiKey = 'test-key'
  geminiCalls.length = 0
  try {
    const result = await recognitionResultsByGemini(
      { sender: { user_id: '1' }, msg: '完全不同的原始用户问题' },
      [`${baseUrl}/img`],
      [],
      undefined,
      { prompt: '' }
    )

    assert.equal(result, 'gemini-ok')
    assert.equal(geminiCalls.length, 1, '应真的调用到识别客户端')
    assert.notEqual(geminiCalls[0].prompt, '完全不同的原始用户问题')
    assert.match(geminiCalls[0].prompt, /describe this content/)
  } finally {
    cfg.geminiKey = originalKey
  }
})

test('未传 options.prompt 的旧调用方仍沿用 e.msg（回归）', async () => {
  const cfg = Config.getConfig()
  const originalKey = cfg.geminiKey
  cfg.geminiKey = 'test-key'
  geminiCalls.length = 0
  try {
    const result = await recognitionResultsByGemini(
      { sender: { user_id: '1' }, msg: '完全不同的原始用户问题' },
      [`${baseUrl}/img`]
    )

    assert.equal(result, 'gemini-ok')
    assert.equal(geminiCalls[0].prompt, '完全不同的原始用户问题')
  } finally {
    cfg.geminiKey = originalKey
  }
})
