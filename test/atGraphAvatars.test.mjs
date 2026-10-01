import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import sharp from 'sharp'

const requests = []
const warnings = []
globalThis.logger = { warn: message => warnings.push(message) }
let respond
mock.module('node-fetch', { defaultExport: async (url, options) => { requests.push({ url, options }); return respond(url, options) } })
const { loadAtGraphAvatars } = await import('../utils/atGraphAvatars.js')
const graph = ids => ({ target: { id: ids[0] }, nodes: ids.slice(1).map(id => ({ id })), outgoingRank: [], incomingRank: [], affectionRank: [], mutualRank: [] })
const response = (body, { status = 200, type = 'image/png', length, location } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: new Map([['content-type', type], ['content-length', length], ['location', location]]),
  body: Readable.from([body])
})

test('头像经固定服务获取、重编码为 data URI，重复成员与缓存不重复下载', async () => {
  const png = await sharp({ create: { width: 12, height: 10, channels: 3, background: '#74adc4' } }).png().toBuffer()
  respond = async () => response(png)
  const result = await loadAtGraphAvatars(graph(['12345', '12345', 'https://127.0.0.1/x']))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://q1.qlogo.cn/g?b=qq&s=160&nk=12345')
  assert.equal(requests[0].options.redirect, 'manual')
  assert.match(result['12345'], /^data:image\/jpeg;base64,/)
  const metadata = await sharp(Buffer.from(result['12345'].split(',')[1], 'base64')).metadata()
  assert.equal(metadata.width, 160)
  assert.equal(metadata.height, 160)
  assert.equal((await loadAtGraphAvatars(graph(['12345'])))['12345'], result['12345'])
  assert.equal(requests.length, 1)
})

test('头像服务失败、类型不符、声明或流式超限均降级；跨域重定向不跟随', async () => {
  const scenarios = [
    response(Buffer.alloc(0), { status: 500 }),
    response(Buffer.from('<html>'), { type: 'text/html' }),
    response(Buffer.alloc(1), { length: String(600 * 1024) }),
    response(Buffer.alloc(600 * 1024)),
    response(Buffer.alloc(0), { status: 302, location: 'http://127.0.0.1/private' })
  ]
  for (let i = 0; i < scenarios.length; i++) {
    const id = String(20000 + i)
    const before = requests.length
    respond = async () => scenarios[i]
    const avatars = await loadAtGraphAvatars(graph([id]))
    assert.equal(avatars[id], '')
    assert.equal(requests.length, before + 1)
    assert.ok(scenarios[i].body.destroyed)
  }
  assert.equal(warnings.length, scenarios.length)
})

test('允许服务内重定向，响应正文阶段超时也会终止并降级', async () => {
  let calls = 0
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#aabbcc' } }).png().toBuffer()
  respond = async () => ++calls === 1 ? response(Buffer.alloc(0), { status: 302, location: '/avatar.jpg' }) : response(png)
  assert.match((await loadAtGraphAvatars(graph(['33333'])))['33333'], /^data:image\/jpeg/)
  assert.equal(requests.at(-1).url, 'https://q1.qlogo.cn/avatar.jpg')
  respond = async (url, { signal }) => {
    const body = new Readable({ read() {} })
    signal.addEventListener('abort', () => body.destroy(new Error('头像正文读取超时')), { once: true })
    return { ...response(Buffer.alloc(0)), body }
  }
  assert.equal((await loadAtGraphAvatars(graph(['44444'])))['44444'], '')
  assert.match(warnings.at(-1), /头像正文读取超时/)
})
