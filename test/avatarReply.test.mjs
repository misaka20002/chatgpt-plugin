import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { avatarEnabled, normalizeAvatarReplyConfig, shortCaption, subtitleCaptions, createAvatarCue, fallbackAvatarCue } from '../utils/avatar/config.js'
import { parseAvatarResource, AvatarResourceStore } from '../utils/avatar/resource.js'
import { avatarFrame, renderAvatarGif, expressionTimeline } from '../utils/avatar/render.js'
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
  assert.deepEqual(normalizeAvatarReplyConfig(), { provider: 'current', expressionTransition: true, groups: [] })
  // 过渡开关为严格布尔：只有显式 false 才关闭，其余（含字符串）回落默认开启。
  assert.equal(normalizeAvatarReplyConfig({ expressionTransition: false }).expressionTransition, false)
  assert.equal(normalizeAvatarReplyConfig({ expressionTransition: 'false' }).expressionTransition, true)
  assert.equal(normalizeAvatarReplyConfig({ provider: 'provider-1', groups: [] }).provider, 'provider-1')
  assert.equal(normalizeAvatarReplyConfig({ provider: '', groups: [] }).provider, 'current')
})

test('短句只接受限定动作/真实表情 ID，使用实际 provider，清理 CQ 并限制可见字符', async () => {
  const expressions = [{ id: 'happy', label: '开心' }]
  const generate = async args => {
    assert.equal(args.providerId, 'backup-provider')
    assert.match(args.systemPrompt, /untrusted/)
    assert.deepEqual(Object.keys(args).sort(), ['input', 'providerId', 'systemPrompt'])
    return { text: JSON.stringify({ caption: '好呀'.repeat(12), action: 'bounce', expressionId: 'happy' }) }
  }
  const cue = await createAvatarCue('完整回复', expressions, 'backup-provider', generate)
  assert.deepEqual(cue.captions, ['好呀'.repeat(6), '好呀'.repeat(6)])
  for (const value of [
    { caption: '你好', action: 'execute', expressionId: null },
    { caption: '你好', action: 'idle', expressionId: 'unknown' },
    { caption: '', action: 'idle', expressionId: null }
  ]) await assert.rejects(createAvatarCue('回复', expressions, 'main', async () => JSON.stringify(value)))
  await assert.rejects(createAvatarCue('回复', expressions, 'main', async () => JSON.stringify({
    caption: '好呀'.repeat(30), action: 'idle', expressionId: null
  })), /字幕段数或长度超限/)
  assert.equal(shortCaption('[CQ:at,qq=123] **你好** https://example.com'), '你好')
})

test('辅助模型的动作提示说明七种动作，普通疑问优先 idle 且不改写表情选择', async () => {
  const expressions = [{ id: 'confused', label: '困惑' }]
  const cue = await createAvatarCue('一条轻松的反问', expressions, 'avatar-model', async ({ systemPrompt, input }) => {
    assert.deepEqual(JSON.parse(input).expressions, expressions)
    assert.match(systemPrompt, /默认优先 idle/)
    assert.match(systemPrompt, /idle[^。；]*轻微左右摆动/)
    assert.match(systemPrompt, /普通聊天[^。；]*轻松提问[^。；]*俏皮反问[^。；]*轻微疑惑/)
    assert.match(systemPrompt, /不要[^。；]*问号[^。；]*感叹号[^。；]*明显的摇晃/)
    for (const [action, meaning] of [
      ['bounce', '上下跳动'],
      ['shake', '快速左右抖动'],
      ['wobble', '明显左右摇摆'],
      ['nod', '点头'],
      ['headshake', '摇头'],
      ['recoil', '后缩']
    ]) {
      assert.match(systemPrompt, new RegExp(action + '[^。；]*' + meaning), action + ' 应有明确动作释义')
    }
    assert.match(systemPrompt, /只有[^。；]*才选择非 idle/)
    assert.match(systemPrompt, /expressionId 只能是输入表情的 id 或 null/)
    assert.ok(!systemPrompt.includes('你在叫派蒙吗'), '提示词不应添加特定回复示例')
    return JSON.stringify({ captions: ['怎么啦'], action: 'wobble', expressionId: 'confused' })
  })
  assert.deepEqual(cue, { captions: ['怎么啦'], action: 'wobble', expressionId: 'confused' },
    '提示词仅引导模型，不能硬编码改写 action 或特色表情 ID')
})

test('电影字幕按模型语义分两段并清理首尾标点，失败回退也只显示单行段落', async () => {
  const generate = async args => {
    assert.match(args.systemPrompt, /captions/)
    return JSON.stringify({ captions: ['「你好呀！」', '，我们一起出去玩吧。'], action: 'idle', expressionId: null })
  }
  const cue = await createAvatarCue('完整回复', [], 'main', generate)
  assert.deepEqual(cue.captions, ['你好呀', '我们一起出去玩吧'])
  assert.equal(cue.action, 'idle')
  assert.deepEqual(fallbackAvatarCue('欢迎回来，今天有新消息。').captions, ['欢迎回来', '今天有新消息'])
  assert.deepEqual(fallbackAvatarCue('，；「你好呀」 、今天真不错。').captions,
    ['你好呀', '今天真不错'], '切分后应连同空格清理句首和句尾的全部标点')
  await assert.rejects(createAvatarCue('回复', [], 'main', async () => JSON.stringify({
    captions: ['12345678901，后面还有更多字', '第二段。'], action: 'idle', expressionId: null
  })), /字幕段数或长度超限/, '超长模型输出不应截成偏离原回复的字幕')
  const withEmpty = await createAvatarCue('回复', [], 'main', async () => JSON.stringify({
    captions: ['', '。', '第一段', '第二段'], action: 'idle', expressionId: null
  }))
  assert.deepEqual(withEmpty.captions, ['第一段', '第二段'], '跳过空段和纯标点，保留前两段有意义的字幕')
})

test('不可见控制字符不能成为独立字幕，组合 Emoji 的连接符仍须保留', async () => {
  assert.deepEqual(subtitleCaptions(['\u200b', '\u200d', '\u2060', '\ufe0f', '👩‍💻出发']), ['👩‍💻出发'])
  assert.deepEqual(subtitleCaptions('\u200b！ 你好 \u200b，前进！'), ['你好', '前进'])
  assert.equal(shortCaption('\u200b'.repeat(30) + '你好'), '你好', '不可见字素不能挤占 24 字素额度')
  assert.deepEqual(fallbackAvatarCue('\u200b').captions, ['我在这里呀'])
  assert.deepEqual(subtitleCaptions(['👩‍💻', '一起努力']), ['👩‍💻', '一起努力'])
})

test('模型返回超长字幕必须使用原回复本地兜底，不把异常文案直接截进动图', async t => {
  const original = '今天发布重要修复，已经更新完成。'
  const generate = async () => JSON.stringify({
    captions: ['XXXXXXXXXXXXXXXXXXXXX', '继续说无关事实'], action: 'bounce', expressionId: null
  })
  await assert.rejects(createAvatarCue(original, [], 'main', generate), /角色字幕/)
  const { root } = await fixture(t)
  const seen = [], warnings = []
  const config = { groups: [{ botId: '999', groupId: '100', switchOn: true, avatarId: '999' }] }
  const service = new AvatarReplyService({
    root, getConfig: () => config,
    generate, warn: message => warnings.push(message),
    queue: { async render(resource, cue) { seen.push(cue); return Buffer.from('GIF test') } },
    sendImage: async () => {}
  })
  const ok = await service.send({ isGroup: true, self_id: '999', group_id: '100' }, original, 'main')
  assert.equal(ok, true)
  assert.deepEqual(seen[0], { captions: ['今天发布重要修复', '已经更新完成'],
    action: 'idle', expressionId: null })
  assert.ok(warnings.some(line => line.includes('角色字幕生成失败')))
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

test('特色表情过渡三阶段：正常段、溶解段、特色段闪回闭眼且不出现张嘴帧', async () => {
  const resource = await parseAvatarResource(JSON.stringify(await websiteConfig(2)))
  const cue = { caption: '你好', action: 'idle', expressionId: 'expression_0' }
  const options = { transition: true }
  assert.deepEqual(expressionTimeline(2000), { normalMs: 650, dissolveMs: 350, featureMs: 1000 })
  assert.deepEqual(expressionTimeline(3000), { normalMs: 1500, dissolveMs: 350, featureMs: 1150 })
  assert.deepEqual(expressionTimeline(5000), { normalMs: 2500, dissolveMs: 350, featureMs: 2150 })
  // 正常段与未命中特色时一致（0 正常、2 张嘴）；关闭过渡或未命中时维持旧的整段特色立绘。
  assert.equal(avatarFrame(resource, cue, 0, 3000, options).pictureIndex, 0)
  assert.equal(avatarFrame(resource, cue, 200, 3000, options).pictureIndex, 2)
  assert.equal(avatarFrame(resource, cue, 200, 3000).pictureIndex, 3)
  assert.equal(avatarFrame(resource, { ...cue, expressionId: null }, 200, 3000, options).pictureIndex, 2)
  assert.equal(avatarFrame(resource, { ...cue, expressionId: 'unknown' }, 200, 3000, options).pictureIndex, 2)
  // 溶解段：下层基础帧、上层特色层随进度渐显，位移在两态之间插值。
  const dissolve = [1600, 1700, 1800].map(time => avatarFrame(resource, cue, time, 3000, options))
  for (const frame of dissolve) {
    assert.equal(frame.pictureIndex, 0)
    assert.equal(frame.overlayIndex, 3)
    assert.ok(frame.overlayOpacity > 0 && frame.overlayOpacity < 1)
  }
  assert.ok(dissolve[0].overlayOpacity < dissolve[1].overlayOpacity
    && dissolve[1].overlayOpacity < dissolve[2].overlayOpacity)
  // 溶解段同样只播基础运动：反应动作在过渡完成点才从基础位移缓入。
  for (const frame of dissolve) assert.equal(frame.y, 0)
  assert.equal(avatarFrame(resource, cue, 1850, 3000, options).y, 0)
  assert.notEqual(avatarFrame(resource, cue, 2500, 3000, options).y, 0)
  // 特色段：保持特色立绘；眨眼窗口闪回闭眼帧；溶解与特色段都不出现张嘴帧（2）。
  const featureFrame = avatarFrame(resource, cue, 1900, 3000, options)
  assert.equal(featureFrame.pictureIndex, 3)
  assert.equal(featureFrame.overlayIndex, undefined)
  assert.equal(avatarFrame(resource, cue, 2100, 3000, options).pictureIndex, 1)
  for (let time = 1500; time <= 3000; time += 50) {
    assert.notEqual(avatarFrame(resource, cue, time, 3000, options).pictureIndex, 2)
  }
})

test('过渡把反应动作延后到特色段：正常段与溶解段不提前抖动', async () => {
  const resource = await parseAvatarResource(JSON.stringify(await websiteConfig(2)))
  const options = { transition: true }
  // 模型同时给出 shake 动作时，正常段与溶解段仍只播基础运动。
  const shakeCue = { caption: '你好', action: 'shake', expressionId: 'expression_0' }
  assert.equal(avatarFrame(resource, shakeCue, 200, 3000, options).x, 0)
  assert.equal(avatarFrame(resource, shakeCue, 1700, 3000, options).x, 0)
  // 特色段从过渡完成点以 0 幅度缓入，之后才出现完整抖动。
  assert.equal(avatarFrame(resource, shakeCue, 1850, 3000, options).x, 0)
  assert.notEqual(avatarFrame(resource, shakeCue, 2500, 3000, options).x, 0)
  // 表情自带动画（expression_1 为 shake）同样延后。
  const animationCue = { caption: '你好', action: 'idle', expressionId: 'expression_1' }
  assert.equal(avatarFrame(resource, animationCue, 1700, 3000, options).x, 0)
  assert.notEqual(avatarFrame(resource, animationCue, 2500, 3000, options).x, 0)
  // 关闭过渡时维持旧行为：动作整段生效。
  assert.notEqual(avatarFrame(resource, shakeCue, 200, 3000).x, 0)
})

test('过渡开关作用于 GIF：开启首帧正常、末帧特色；关闭或缺省时整段特色立绘', async () => {
  const resource = await parseAvatarResource(JSON.stringify(await websiteConfig(2)))
  const cue = { caption: '你好', action: 'idle', expressionId: 'expression_0' }
  const pixel = async (gif, page) => [...await sharp(gif, { page })
    .extract({ left: 256, top: 250, width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
  const on = await renderAvatarGif(resource, cue, { transition: true })
  assert.equal((await sharp(on, { animated: true }).metadata()).pages, 30)
  const first = await pixel(on, 0)
  assert.ok(first[0] > 200 && first[1] < 40 && first[2] < 40, '开启过渡时首帧应为正常图（红）')
  const last = await pixel(on, 29)
  assert.ok(last[0] > 200 && last[1] > 200 && last[2] < 40, '开启过渡时末帧应为特色图（黄）')
  for (const gif of [await renderAvatarGif(resource, cue, { transition: false }), await renderAvatarGif(resource, cue)]) {
    const head = await pixel(gif, 0)
    assert.ok(head[0] > 200 && head[1] > 200 && head[2] < 40, '关闭或缺省过渡时整段应为特色图（黄）')
  }
})

test('交叉溶解机制：上层 <image> 的 opacity 被按比例混合', async () => {
  const pic = async color => 'data:image/png;base64,' + (await sharp({
    create: { width: 8, height: 8, channels: 4, background: color }
  }).png().toBuffer()).toString('base64')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="8" height="8">'
    + '<image width="8" height="8" xlink:href="' + await pic('#ff0000') + '"/>'
    + '<image width="8" height="8" opacity="0.5" xlink:href="' + await pic('#ffff00') + '"/></svg>'
  const pixel = [...await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer()].slice(0, 3)
  assert.ok(pixel[0] > 200 && pixel[1] > 90 && pixel[1] < 170 && pixel[2] < 40, '红黄 50% 混合应得到橙色')
})

test('过渡开关随全局配置传入渲染参数，selection 形状保持不变', async t => {
  const { root } = await fixture(t, 2)
  const config = normalizeAvatarReplyConfig({
    expressionTransition: false,
    groups: [{ botId: '999', groupId: '100', switchOn: true, avatarId: '999' }]
  })
  const seen = []
  const service = new AvatarReplyService({
    root, getConfig: () => config, warn() {},
    generate: async () => '{"caption":"你好","action":"idle","expressionId":"expression_0"}',
    queue: { async render(resource, cue, isCurrent, options) { seen.push(options); return Buffer.from('gif') } },
    sendImage: async () => {}
  })
  const e = { isGroup: true, self_id: '999', group_id: '100' }
  assert.equal(await service.send(e, '回答', 'main'), true)
  assert.deepEqual(seen[0], { avatarId: '999', size: '512x512', duration: 3, fps: 10, transition: false })
  config.expressionTransition = true
  assert.equal(await service.send({ ...e }, '回答', 'main'), true)
  assert.equal(seen[1].transition, true)
})

test('实际 GIF 解码为 30 帧/3秒/循环，像素证明正常、张嘴、闭眼切换', async () => {
  const resource = await parseAvatarResource(JSON.stringify(await websiteConfig()))
  const output = await renderAvatarGif(resource, { caption: '你好呀 < & 我在这里', action: 'idle', expressionId: null })
  const meta = await sharp(output, { animated: true }).metadata()
  assert.equal(meta.width, 512)
  assert.equal(meta.pageHeight, 512)
  assert.equal(meta.pages, 30)
  assert.equal(meta.delay.reduce((a, b) => a + b, 0), 3000)
  assert.equal(meta.loop, 0)
  const pixel = async page => [...await sharp(output, { page }).extract({ left: 256, top: 250, width: 1, height: 1 })
    .removeAlpha().raw().toBuffer()]
  // 调色板量化与逐帧映射可能带来轻微偏移，这里断言主色通道而不是精确值。
  const [red, blue, green] = [await pixel(0), await pixel(2), await pixel(20)]
  assert.ok(red[0] > 200 && red[1] < 40 && red[2] < 40, '第 0 帧应为正常图（红）')
  assert.ok(blue[2] > 200 && blue[0] < 40 && blue[1] < 40, '第 2 帧应为张嘴图（蓝）')
  assert.ok(green[1] > 200 && green[0] < 40 && green[2] < 40, '第 20 帧应为闭眼图（绿）')
})

test('电影字幕在正方形角色画面下层图像上方单行硬切，短段最少显示0.7秒', async () => {
  const source = await websiteConfig()
  // 三种嘴型复用同一张图，让帧间差异只来自字幕而不是角色状态。
  source.images.close = source.images.normal
  source.mouthTiers[0].images = [source.images.normal]
  const resource = await parseAvatarResource(JSON.stringify(source))
  const gif = await renderAvatarGif(resource,
    { captions: ['嗨', '我们一起去旅行吧'], action: 'idle', expressionId: null },
    { size: '512x512', duration: 2, fps: 10 })
  const meta = await sharp(gif, { animated: true }).metadata()
  assert.equal(meta.width, 512)
  assert.equal(meta.pageHeight, 512)
  assert.equal(meta.pages, 20)
  assert.equal(meta.delay.reduce((a, b) => a + b, 0), 2000)
  const subtitleRegion = page => sharp(gif, { page })
    .extract({ left: 45, top: 435, width: 422, height: 62 }).ensureAlpha().raw().toBuffer()
  assert.deepEqual(await subtitleRegion(0), await subtitleRegion(7), '第一段至少显示 7 帧，额外时间按字数分配')
  assert.notDeepEqual(await subtitleRegion(7), await subtitleRegion(8), '短段占 8 帧之后应立即硬切到下一段')
  assert.deepEqual(await subtitleRegion(8), await subtitleRegion(19), '第二段持续到结束')
  const background = [...await sharp(gif, { page: 0 }).extract({ left: 100, top: 420,
    width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
  assert.ok(background[0] > 200 && background[1] < 50 && background[2] < 50,
    '原底部气泡区域应该继续呈现角色像素')
})

test('白色不透明背景的实际 GIF 有清晰黑色字幕轮廓且不铺黑底条', async () => {
  const source = await websiteConfig()
  const png = await sharp({ create: { width: 96, height: 96, channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer()
  const picture = { ref: 'data:image/png;base64,' + png.toString('base64') }
  source.images.normal = source.images.close = picture
  source.mouthTiers[0].images = [picture]
  const resource = await parseAvatarResource(JSON.stringify(source))
  const output = await renderAvatarGif(resource,
    { captions: ['白底字幕'], action: 'idle', expressionId: null },
    { size: '512x512', duration: 2, fps: 10 })
  const rgba = await sharp(output, { page: 0 }).ensureAlpha().raw().toBuffer()
  const pixel = (x, y) => [...rgba.subarray((y * 512 + x) * 4, (y * 512 + x) * 4 + 4)]
  for (const [x, y] of [[96, 450], [416, 450], [96, 470], [416, 470], [256, 425]]) {
    const [r, g, b, a] = pixel(x, y)
    assert.ok(a === 255 && r > 210 && g > 210 && b > 210,
      '白底角色的字幕周围不应出现暗色底条：' + x + ',' + y)
  }
  let outlinePixels = 0
  for (let y = 443; y < 487; y++) {
    for (let x = 170; x < 344; x++) {
      const [r, g, b, a] = pixel(x, y)
      if (a === 255 && r < 80 && g < 80 && b < 80) outlinePixels++
    }
  }
  assert.ok(outlinePixels > 80, '白底角色上的字幕必须有可辨认的黑色轮廓')
  assert.equal(pixel(256, 500)[3], 0, '角色下方不能额外填充字幕背景')
})

test('电影字幕超宽字形缩放或截断后仍在画面内保持一行和透明背景', async () => {
  const source = await websiteConfig()
  const png = await sharp({ create: { width: 96, height: 96, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
  const image = { ref: 'data:image/png;base64,' + png.toString('base64') }
  source.images.normal = image
  source.images.close = image
  source.mouthTiers[0].images = [image]
  const resource = await parseAvatarResource(JSON.stringify(source))
  const gif = await renderAvatarGif(resource,
    { captions: ['👩‍💻'.repeat(12)], action: 'idle', expressionId: null },
    { size: '512x512', duration: 2, fps: 10 })
  const rgba = await sharp(gif, { page: 0 }).ensureAlpha().raw().toBuffer()
  let left = 512, right = -1, top = 512, bottom = -1
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      if (rgba[(y * 512 + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  assert.ok(right >= left, '字幕应有实际可见像素')
  assert.ok(left >= 20 && right < 492, '字幕与描边应在画布左右边界内')
  assert.ok(top >= 415 && bottom < 505 && bottom - top < 70, '字幕只能在画面底部占一行')
})


test('逐帧稳定：渐变素材在轻微位移下不产生大面积跳变（色斑闪烁回归）', async () => {
  const W = 96, H = 96
  const raw = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      raw[i] = 40 + Math.round(x / (W - 1) * 200)
      raw[i + 1] = 90 + Math.round(y / (H - 1) * 120)
      raw[i + 2] = 160 + Math.round((x + y) / (W + H - 2) * 80)
      raw[i + 3] = 255
    }
  }
  const ref = 'data:image/png;base64,' + (await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
    .png().toBuffer()).toString('base64')
  const resource = await parseAvatarResource(JSON.stringify({
    schema: 2, imageMode: 'images',
    images: { normal: { ref }, close: { ref } },
    mouthTiers: [{ threshold: 5, images: [{ ref }] }],
    customExpressions: [],
    motion: { swayAmpX: 1.5, swayPeriod: 5200, breathAmpY: 2, breathPeriod: 3800, talkTiltMaxDeg: 0 },
    blinkMin: 30000, blinkMax: 30000, blinkDuration: 150
  }))
  const gif = await renderAvatarGif(resource, { caption: '测试', action: 'idle', expressionId: null },
    { size: '512x640', duration: 2, fps: 10 })
  const frames = []
  for (let page = 0; page < 20; page++) frames.push(await sharp(gif, { page }).ensureAlpha().raw().toBuffer())
  let jumps = 0
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i]
    for (let j = 0; j < a.length; j += 4) {
      if (a[j + 3] === 0 && b[j + 3] === 0) continue
      const delta = Math.max(Math.abs(a[j] - b[j]), Math.abs(a[j + 1] - b[j + 1]), Math.abs(a[j + 2] - b[j + 2]))
      if (delta >= 16) jumps++
    }
  }
  // 全屏抖动 + rgba4444 时期该夹具约 20600 次跳变；rgb565 + 索引滞回后约 5400，阈值留出跨环境余量。
  assert.ok(jumps < 15000, '渐变画面相邻帧跳变过多，疑似色斑闪烁回归：' + jumps)
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
  assert.deepEqual(cues[0].captions, ['第一句'])
  assert.ok(logs.some(message => /角色字幕生成失败/.test(message)), '模型失败日志应使用新字幕术语')
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
    { avatarId: '', size: '512x512', duration: 3, fps: 10 })
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
