import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { avatarEnabled, normalizeAvatarReplyConfig, shortCaption, createAvatarCue } from '../utils/avatar/config.js'
import { parseAvatarResource, AvatarResourceStore } from '../utils/avatar/resource.js'
import { avatarFrame, renderAvatarGif } from '../utils/avatar/render.js'
import { AvatarRenderQueue } from '../utils/avatar/queue.js'
import { AvatarReplyService } from '../utils/avatar/reply.js'

// 使用生产解码器读取人工构造的栅格测试素材，不替代真实 GPT Image 2 素材验收。
async function websiteConfig(expressions = 0) {
  const pic = async color => ({
    ref: 'data:image/png;base64,' + (await sharp({
      create: { width: 96, height: 96, channels: 4, background: color }
    }).png().toBuffer()).toString('base64')
  })
  return {
    schema: 2, imageMode: 'images', mouthMode: 'volume',
    images: { normal: await pic('#ff0000'), close: await pic('#00ff00'),
      yosomi_left: { ref: 'examples/sample_left.webp' }, rig_base: { ref: 'examples/sample_noppera.webp' } },
    mouthTiers: [{ threshold: 5, images: [await pic('#0000ff')] }],
    customExpressions: await Promise.all(Array.from({ length: expressions }, async (_, i) => ({
      id: 'expression_' + i, label: i ? '困惑' : '开心', image: await pic(i ? '#00ffff' : '#ffff00'),
      buildMode: 'image', animation: i ? 'shake' : 'bounce'
    }))),
    motion: { breathAmpY: 0, swayAmpX: 0, talkTiltMaxDeg: 0 },
    blinkMin: 2000, blinkMax: 5000, blinkDuration: 150,
    rig: { assets: { eye: [{ ref: 'parts/parts_openeye1.png' }] } }
  }
}

async function fixture(t, count = 0) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new AvatarResourceStore(root, () => {})
  const filename = store.filename('999', '999')
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const config = await websiteConfig(count)
  await fs.writeFile(filename, JSON.stringify(config))
  return { root, store, filename, config }
}

test('Peraravatar schema:2 图片对象、位置和三图/五图读取，不加载闲置样例', async () => {
  for (const count of [0, 2]) {
    const config = await websiteConfig(count)
    config.images.normal.place = { dx: 12, dy: -4, scale: 0.8, rot: 3 }
    const resource = await parseAvatarResource(JSON.stringify(config))
    assert.equal(resource.pictures.length, count + 3)
    assert.deepEqual(resource.pictures[0].place, config.images.normal.place)
    assert.equal(resource.motion.breathAmpY, 0)
    assert.equal(resource.expressions.length, count)
  }
})

test('拒绝外链、格式伪装、过大像素、额外档位与不支持模式', async () => {
  const original = await websiteConfig()
  for (const mutate of [
    c => { c.imageMode = 'build' },
    c => { c.schema = 1 },
    c => { c.images.normal.ref = 'https://example.com/avatar.png' },
    c => { c.images.normal.ref = c.images.normal.ref.replace('image/png', 'image/jpeg') },
    c => { c.images.close.ref = 'data:image/svg+xml;base64,PHN2Zz4=' },
    c => { c.mouthTiers.push(c.mouthTiers[0]) },
    c => { c.customExpressions = Array(33).fill({}) },
    c => { c.motion.breathAmpY = -1 },
    c => { c.blinkMin = 0 }
  ]) {
    const config = structuredClone(original)
    mutate(config)
    await assert.rejects(parseAvatarResource(JSON.stringify(config)))
  }
  const large = await sharp({ create: { width: 2049, height: 1, channels: 3, background: 'white' } }).png().toBuffer()
  original.images.normal.ref = 'data:image/png;base64,' + large.toString('base64')
  await assert.rejects(parseAvatarResource(JSON.stringify(original)), /尺寸不支持/)
  await assert.rejects(parseAvatarResource(' '.repeat(32 * 1024 * 1024 + 1)), /32 MiB/)
})

test('资源按角色目录读取并跨 Bot 共享，更新失败保留旧角色、恢复后更新，重启重读', async t => {
  const { root, store, filename, config } = await fixture(t)
  const first = await store.load('999', '999')
  assert.equal(await store.load('999', '999'), first)
  assert.equal(await store.load('888', '999'), first)
  await assert.rejects(store.load('999', '不存在'), /读取失败/)
  await fs.writeFile(filename, '{半写')
  assert.equal(await store.load('999', '999'), first)
  assert.match(store.error('999', '999'), /读取失败/)
  config.images.normal.place = { dx: 2 }
  await fs.writeFile(filename, JSON.stringify(config))
  const next = await store.load('999', '999')
  assert.notEqual(next.version, first.version)
  assert.equal(store.error('999', '999'), '')
  assert.equal((await new AvatarResourceStore(root).load('999', '999')).version, next.version)
  await assert.rejects(store.load('../999', '999'), /Bot QQ/)
  await assert.rejects(store.load('999'), /角色目录名无效/)
  await assert.rejects(store.load('999', ''), /角色目录名无效/)
})

test('群/私聊开关严格按 Bot/渠道和布尔值生效，空默认与未知事件不影响聊天', () => {
  const config = normalizeAvatarReplyConfig({ groups: [
    { botId: ' 999 ', groupId: '100', switchOn: true },
    { botId: '999', groupId: '100', switchOn: false },
    { botId: '../999', groupId: '100', switchOn: true },
    { botId: '999', groupId: '200', switchOn: 'true' }
  ] })
  assert.equal(config.groups.length, 2)
  assert.equal(avatarEnabled({ isGroup: true, self_id: 999, group_id: 100 }, config), true)
  assert.equal(avatarEnabled({ isGroup: true, self_id: 888, group_id: 100 }, config), false)
  assert.equal(avatarEnabled({ isGroup: true, self_id: 999, group_id: 200 }, config), false)
  assert.equal(avatarEnabled({ isGroup: true }, {}), false)
  assert.equal(avatarEnabled({ self_id: 999, group_id: 100 }, config), false)
  // 私聊按 8888 行判断：开关开 → true；开关关 / 其他 Bot / 群通道 → false
  const privateOn = normalizeAvatarReplyConfig({ groups: [{ botId: '999', groupId: '8888', switchOn: true }] })
  assert.equal(avatarEnabled({ self_id: 999 }, privateOn), true)
  assert.equal(avatarEnabled({ isGroup: false, self_id: 999, user_id: 12345 }, privateOn), true)
  assert.equal(avatarEnabled({ self_id: 888 }, privateOn), false)
  assert.equal(avatarEnabled({ isGroup: true, self_id: 999, group_id: 100 }, privateOn), false)
  const privateOff = normalizeAvatarReplyConfig({ groups: [{ botId: '999', groupId: '8888', switchOn: false }] })
  assert.equal(avatarEnabled({ self_id: 999 }, privateOff), false)
  assert.deepEqual(normalizeAvatarReplyConfig(), { provider: 'current', groups: [] })
  assert.equal(normalizeAvatarReplyConfig({ provider: 'provider-1', groups: [] }).provider, 'provider-1')
  assert.equal(normalizeAvatarReplyConfig({ provider: '', groups: [] }).provider, 'current')
})

test('短句只接受限定动作/真实表情 ID，使用实际 provider，清理 CQ 并限制可见字符', async () => {
  const expressions = [{ id: 'happy', label: '开心' }]
  const generate = async args => {
    assert.equal(args.providerId, 'backup-provider')
    assert.match(args.systemPrompt, /untrusted/)
    assert.deepEqual(Object.keys(args).sort(), ['input', 'providerId', 'systemPrompt'])
    return { text: JSON.stringify({ caption: '好呀'.repeat(30), action: 'bounce', expressionId: 'happy' }) }
  }
  const cue = await createAvatarCue('完整回复', expressions, 'backup-provider', generate)
  assert.equal([...cue.caption].length, 24)
  for (const value of [
    { caption: '你好', action: 'execute', expressionId: null },
    { caption: '你好', action: 'idle', expressionId: 'unknown' },
    { caption: '', action: 'idle', expressionId: null }
  ]) await assert.rejects(createAvatarCue('回复', expressions, 'main', async () => JSON.stringify(value)))
  assert.equal(shortCaption('[CQ:at,qq=123] **你好** https://example.com'), '你好')
})

test('生产状态机闭眼优先于嘴型，特色表情期间保持同一立绘，动作产生位移', async () => {
  const resource = await parseAvatarResource(JSON.stringify(await websiteConfig(2)))
  const cue = { caption: '你好', action: 'idle', expressionId: null }
  assert.equal(avatarFrame(resource, cue, 0).pictureIndex, 0)
  assert.equal(avatarFrame(resource, cue, 200).pictureIndex, 2)
  assert.equal(avatarFrame(resource, cue, 2100).pictureIndex, 1)
  const custom = { ...cue, expressionId: 'expression_0' }
  assert.equal(avatarFrame(resource, custom, 200).pictureIndex, 3)
  assert.equal(avatarFrame(resource, custom, 2100).pictureIndex, 3)
  assert.notEqual(avatarFrame(resource, custom, 1400).y, 0)
})

test('实际 GIF 解码为 30 帧/3秒/循环，像素证明正常、张嘴、闭眼切换', async () => {
  const resource = await parseAvatarResource(JSON.stringify(await websiteConfig()))
  const output = await renderAvatarGif(resource, { caption: '你好呀 < & 我在这里', action: 'idle', expressionId: null })
  const meta = await sharp(output, { animated: true }).metadata()
  assert.equal(meta.width, 512)
  assert.equal(meta.pageHeight, 640)
  assert.equal(meta.pages, 30)
  assert.equal(meta.delay.reduce((a, b) => a + b, 0), 3000)
  assert.equal(meta.loop, 0)
  const pixel = async page => [...await sharp(output, { page }).extract({ left: 256, top: 250, width: 1, height: 1 })
    .removeAlpha().raw().toBuffer()]
  // 有序抖动会让颜色有 ±10 左右的偏移，这里断言主色通道而不是精确值。
  const [red, blue, green] = [await pixel(0), await pixel(2), await pixel(20)]
  assert.ok(red[0] > 200 && red[1] < 40 && red[2] < 40, '第 0 帧应为正常图（红）')
  assert.ok(blue[2] > 200 && blue[0] < 40 && blue[1] < 40, '第 2 帧应为张嘴图（蓝）')
  assert.ok(green[1] > 200 && green[0] < 40 && green[2] < 40, '第 20 帧应为闭眼图（绿）')
})

test('开心/困惑/生气/害羞/哭泣均按资源 ID 处理，选择后实际 GIF 使用特色图', async () => {
  for (const label of ['开心', '困惑', '生气', '害羞', '哭泣']) {
    const config = await websiteConfig(2)
    config.customExpressions[0].label = label
    const resource = await parseAvatarResource(JSON.stringify(config))
    const cue = await createAvatarCue('测试回复', resource.expressions, 'main', async ({ input }) => {
      const data = JSON.parse(input)
      assert.equal(data.expressions[0].label, label)
      return JSON.stringify({ caption: label, action: 'idle', expressionId: data.expressions[0].id })
    })
    const gif = await renderAvatarGif(resource, cue)
    for (const page of [0, 20]) {
      const pixel = [...await sharp(gif, { page }).extract({ left: 256, top: 250, width: 1, height: 1 })
        .removeAlpha().raw().toBuffer()]
      assert.ok(pixel[0] > 200 && pixel[1] > 200 && pixel[2] < 40, label + '必须使用特色图，而非正常或闭眼图')
    }
  }
})

test('真实工作线程串行渲染，队列最多三项，关闭后取消待发任务', async () => {
  const resource = await parseAvatarResource(JSON.stringify(await websiteConfig()))
  const cue = { caption: '你好', action: 'idle', expressionId: null }
  const queue = new AvatarRenderQueue()
  const active = queue.render(resource, cue)
  const waiting = Array.from({ length: 3 }, () => queue.render(resource, cue, () => false))
  const results = Promise.allSettled(waiting)
  await assert.rejects(queue.render(resource, cue), /队列已满/)
  const gif = await active
  assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 30)
  assert.ok((await results).every(x => x.status === 'rejected' && /取消/.test(x.reason.message)))
})

test('工作线程超时会拒绝任务，不发送假成功或自动重试降档', async t => {
  const resource = await parseAvatarResource(JSON.stringify(await websiteConfig()))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const queue = new AvatarRenderQueue()
  const job = queue.render(resource, { caption: '超时测试', action: 'idle', expressionId: null },
    () => true, { size: '1024x1024', duration: 5, fps: 20 })
  const rejected = assert.rejects(job, /渲染超时/)
  t.mock.timers.tick(30000)
  await rejected
  assert.equal(queue.waiting.length, 0)
})

test('回复服务模型失败降级、每事件一次，发送后清理临时文件，上传失败保留正文', async t => {
  const { root } = await fixture(t)
  const config = { groups: [{ botId: '999', groupId: '100', switchOn: true, avatarId: '999' }] }
  const logs = [], files = [], cues = []
  const service = new AvatarReplyService({
    root, getConfig: () => config, warn: message => logs.push(message),
    generate: async () => { throw new Error('模型不可用') },
    queue: { async render(resource, cue) { cues.push(cue); return Buffer.from('GIF fixture') } },
    sendImage: async (e, filename) => { assert.ok((await fs.stat(filename)).isFile()); files.push(filename) }
  })
  const e = { isGroup: true, self_id: '999', group_id: '100' }
  assert.equal(await service.send(e, '第一句。完整回答', 'backup'), true)
  assert.equal(await service.send(e, '第一句。完整回答', 'backup'), false)
  assert.equal(cues[0].caption, '第一句')
  await assert.rejects(fs.stat(files[0]), /ENOENT/)
  service.sendImage = async (_, filename) => { files.push(filename); throw new Error('上传失败') }
  assert.equal(await service.send({ ...e }, '回答', 'backup'), false)
  await assert.rejects(fs.stat(files[1]), /ENOENT/)
  assert.ok(logs.some(x => /上传失败/.test(x)))
  assert.equal(await service.send({ ...e, group_id: '200' }, '回答', 'backup'), false)
})

test('生成期间关闭并重新开启也取消旧任务，文件换版后不发送旧图', async t => {
  const { root, filename, config: source } = await fixture(t)
  const config = { groups: [{ botId: '999', groupId: '100', switchOn: true, avatarId: '999' }] }
  let sent = 0
  const e = { isGroup: true, self_id: '999', group_id: '100' }
  const service = new AvatarReplyService({
    root, getConfig: () => config, warn() {},
    generate: async () => '{"caption":"你好","action":"idle","expressionId":null}',
    queue: { async render() { service.changed(e); return Buffer.from('gif') } },
    sendImage: async () => { sent++ }
  })
  assert.equal(await service.send(e, '回答', 'main'), false)
  service.queue = { async render() {
    config.groups = structuredClone(config.groups)
    return Buffer.from('gif')
  } }
  assert.equal(await service.send({ ...e }, '回答', 'main'), false)
  service.queue = { async render() {
    source.images.normal.place = { dx: 5 }
    await fs.writeFile(filename, JSON.stringify(source))
    return Buffer.from('gif')
  } }
  assert.equal(await service.send({ ...e }, '回答', 'main'), false)
  assert.equal(sent, 0)
})

test('私聊用群号 8888 行取角色与档位，未配置时为空并回落默认档位', async t => {
  const { root } = await fixture(t)
  const service = new AvatarReplyService({ root, warn() {}, getConfig: () => normalizeAvatarReplyConfig({
    provider: 'fixed',
    groups: [
      { botId: '999', groupId: '100', switchOn: true, avatarId: '甲', size: '1024x1024', duration: 5, fps: 20 },
      { botId: '999', groupId: '8888', switchOn: false, avatarId: '乙', size: '768x768', duration: 2, fps: 15 }
    ]
  }) })
  assert.deepEqual(service.selection({ isGroup: true, self_id: '999', group_id: '100' }),
    { avatarId: '甲', size: '1024x1024', duration: 5, fps: 20 })
  assert.deepEqual(service.selection({ isGroup: false, self_id: '999' }),
    { avatarId: '乙', size: '768x768', duration: 2, fps: 15 })
  assert.deepEqual(service.selection({ isGroup: false, self_id: '999' }, '呆毛'),
    { avatarId: '呆毛', size: '768x768', duration: 2, fps: 15 })
  const empty = new AvatarReplyService({ root, warn() {},
    getConfig: () => normalizeAvatarReplyConfig({ groups: [] }) })
  assert.deepEqual(empty.selection({ isGroup: false, self_id: '999' }),
    { avatarId: '', size: '512x640', duration: 3, fps: 10 })
})

test('未选择角色文件夹时不渲染、不发送并给出日志', async t => {
  const { root } = await fixture(t)
  const logs = []
  const service = new AvatarReplyService({
    root,
    getConfig: () => ({ groups: [{ botId: '999', groupId: '100', switchOn: true }] }),
    warn: message => logs.push(message),
    generate: async () => { throw new Error('不应调用模型') },
    queue: { async render() { throw new Error('不应渲染') } },
    sendImage: async () => {}
  })
  assert.equal(await service.send({ isGroup: true, self_id: '999', group_id: '100' }, '回答', 'main'), false)
  assert.ok(logs.some(message => /未选择角色文件夹/.test(message)))
})

test('短句模型来源：current 跟随本轮条目，固定值覆盖', async t => {
  const { root } = await fixture(t)
  const config = normalizeAvatarReplyConfig({
    provider: 'fixed-provider',
    groups: [{ botId: '999', groupId: '100', switchOn: true, avatarId: '999' }]
  })
  const seen = []
  const service = new AvatarReplyService({
    root, getConfig: () => config, warn() {},
    generate: async args => { seen.push(args.providerId); return '{"caption":"好","action":"idle","expressionId":null}' },
    queue: { async render() { return Buffer.from('gif') } },
    sendImage: async () => {}
  })
  assert.equal(await service.send({ isGroup: true, self_id: '999', group_id: '100' }, '回答', 'chat-provider'), true)
  config.provider = 'current'
  assert.equal(await service.send({ isGroup: true, self_id: '999', group_id: '100' }, '回答', 'chat-provider'), true)
  assert.deepEqual(seen, ['fixed-provider', 'chat-provider'])
})

test('透明背景 GIF：透明与近透明像素保持透明，帧间清屏不产生不透明底色', async () => {
  const raw = Buffer.alloc(96 * 96 * 4)
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const i = (y * 96 + x) * 4
      const inner = x >= 24 && x < 72 && y >= 24 && y < 72
      raw[i] = 255
      raw[i + 1] = inner ? 0 : 255
      raw[i + 2] = inner ? 0 : 255
      raw[i + 3] = inner ? 255 : 10
    }
  }
  const png = await sharp(raw, { raw: { width: 96, height: 96, channels: 4 } }).png().toBuffer()
  const ref = { ref: 'data:image/png;base64,' + png.toString('base64') }
  const resource = await parseAvatarResource(JSON.stringify({
    schema: 2, imageMode: 'images', mouthMode: 'volume',
    images: { normal: ref, close: ref },
    mouthTiers: [{ threshold: 5, images: [ref] }],
    customExpressions: [],
    motion: { breathAmpY: 0, swayAmpX: 0, talkTiltMaxDeg: 0 },
    blinkMin: 2000, blinkMax: 5000, blinkDuration: 150
  }))
  const gif = await renderAvatarGif(resource, { caption: '透明', action: 'idle', expressionId: null })
  const pixel = async (page, left, top) => [...await sharp(gif, { page })
    .extract({ left, top, width: 1, height: 1 }).ensureAlpha().raw().toBuffer()]
  for (const page of [0, 10, 29]) {
    assert.equal((await pixel(page, 5, 5))[3], 0, '帧 ' + page + ' 的画布角落必须保持透明')
  }
  const center = await pixel(0, 256, 250)
  assert.equal(center[3], 255, '角色中心必须是不透明像素')
  assert.ok(center[0] > 200 && center[1] < 40 && center[2] < 40, '角色中心应为红色块')
  assert.equal((await pixel(0, 100, 250))[3], 0, 'alpha=10 的近透明像素不得变成不透明白色光晕')
})

test('私聊按 8888 行开关自动附图，关闭后不发送', async t => {
  const { root } = await fixture(t)
  const config = normalizeAvatarReplyConfig({ groups: [
    { botId: '999', groupId: '8888', switchOn: true, avatarId: '999' }
  ] })
  let sent = 0
  const service = new AvatarReplyService({
    root, getConfig: () => config, warn() {},
    generate: async () => '{"caption":"你好","action":"idle","expressionId":null}',
    queue: { async render() { return Buffer.from('gif') } },
    sendImage: async () => { sent++ }
  })
  assert.equal(await service.send({ isGroup: false, self_id: '999' }, '回答', 'main'), true)
  assert.equal(sent, 1)
  config.groups[0].switchOn = false
  assert.equal(await service.send({ isGroup: false, self_id: '999' }, '回答', 'main'), false)
  assert.equal(sent, 1)
})

test('私聊任务在配置提交换行后取消，不发送旧图', async t => {
  const { root } = await fixture(t)
  const config = normalizeAvatarReplyConfig({ groups: [
    { botId: '999', groupId: '8888', switchOn: true, avatarId: '999' }
  ] })
  let sent = 0
  const service = new AvatarReplyService({
    root, getConfig: () => config, warn() {},
    generate: async () => '{"caption":"你好","action":"idle","expressionId":null}',
    queue: { async render() {
      // 模拟生成期间锅巴保存：整行被替换为新对象，旧任务必须取消
      config.groups = config.groups.map(row => ({ ...row }))
      return Buffer.from('gif')
    } },
    sendImage: async () => { sent++ }
  })
  assert.equal(await service.send({ isGroup: false, self_id: '999' }, '回答', 'main'), false)
  assert.equal(sent, 0)
})
