import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { refreshAvatarFolders } from '../utils/avatar/refresh.js'
import { avatarOptions } from '../utils/avatar/catalog.js'
import { AvatarResourceStore, parseAvatarResource } from '../utils/avatar/resource.js'
import { avatarRoot, AVATAR_FILENAME, checkedAvatarPath } from '../utils/avatar/paths.js'
import { normalizeAvatarReplyConfig } from '../utils/avatar/config.js'
import { renderAvatarGif } from '../utils/avatar/render.js'
import { AvatarReplyService } from '../utils/avatar/reply.js'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-folders-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const pictures = {}
  for (const [name, color] of Object.entries({ normal: 'red', close: 'green', open: 'blue',
    happy: 'yellow', confused: 'cyan', angry: 'purple', shy: 'pink', crying: 'orange' })) {
    pictures[name] = await sharp({ create: { width: 64, height: 64, channels: 4, background: color } }).png().toBuffer()
  }
  const make = async (name, extras = []) => {
    const directory = path.join(avatarRoot(root), name)
    await fs.mkdir(directory, { recursive: true })
    for (const image of ['normal', 'close', 'open', ...extras]) {
      await fs.writeFile(path.join(directory, image + '.png'), pictures[image] ?? pictures.normal)
    }
    return directory
  }
  return { root, make, pictures }
}

test('刷新生成所有表情，保留网站 ID/名称/动作/位置，幂等并备份，单目录失败不影响其他角色', async t => {
  const { root, make } = await fixture(t)
  const directory = await make('角色甲', ['happy', 'confused', 'angry', 'shy', 'crying'])
  await make('角色乙')
  await refreshAvatarFolders(root)
  const file = path.join(directory, AVATAR_FILENAME)
  const existing = JSON.parse(await fs.readFile(file, 'utf8'))
  existing.motion = { breathAmpY: 7 }
  existing.blinkMin = 1100
  existing.images.normal.place = { dx: 3 }
  const happy = existing.customExpressions.find(x => x.sourceFile === 'happy.png')
  happy.id = 'website_happy'
  happy.label = '开心：自定义描述'
  happy.animation = 'nod'
  happy.image.place = { dx: 9, scale: 0.8 }
  happy.buildMode = 'parts'
  // 首次网站导出没有 sourceFile，按标准表情名称匹配。
  for (const exp of existing.customExpressions) delete exp.sourceFile
  await fs.writeFile(file, JSON.stringify(existing))
  const before = await fs.readFile(file)
  const results = await refreshAvatarFolders(root)
  assert.equal(results.find(x => x.avatarId === '角色甲').expressions, 5)
  const next = JSON.parse(await fs.readFile(file, 'utf8'))
  const kept = next.customExpressions.find(x => x.sourceFile === 'happy.png')
  assert.equal(kept.id, 'website_happy')
  assert.equal(kept.label, happy.label)
  assert.equal(kept.animation, 'nod')
  assert.deepEqual(kept.image.place, happy.image.place)
  assert.deepEqual(next.motion, existing.motion)
  assert.equal(next.blinkMin, 1100)
  assert.deepEqual(next.images.normal.place, { dx: 3 })
  const backup = results.find(x => x.avatarId === '角色甲').backup
  assert.deepEqual(await fs.readFile(backup), before)
  const second = await fs.readFile(file)
  assert.equal((await refreshAvatarFolders(root)).find(x => x.avatarId === '角色甲').status, '未变化')
  assert.deepEqual(await fs.readFile(file), second)
  await fs.unlink(path.join(directory, 'normal.png'))
  const failed = await refreshAvatarFolders(root)
  assert.match(failed.find(x => x.avatarId === '角色甲').error, /缺少基础/)
  assert.equal(failed.find(x => x.avatarId === '角色乙').status, '未变化')
  assert.deepEqual(await fs.readFile(file), second)
})

test('源文件记录优先于改过的表情名称，更新图片但不重置参数', async t => {
  const { root, make, pictures } = await fixture(t)
  const directory = await make('改名角色', ['happy'])
  await refreshAvatarFolders(root)
  const file = path.join(directory, AVATAR_FILENAME)
  const config = JSON.parse(await fs.readFile(file, 'utf8'))
  config.customExpressions[0].label = '我自定义的名字'
  await fs.writeFile(file, JSON.stringify(config))
  await fs.writeFile(path.join(directory, 'happy.png'), pictures.angry)
  await refreshAvatarFolders(root)
  const next = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.equal(next.customExpressions[0].label, '我自定义的名字')
  assert.equal(next.customExpressions[0].id, config.customExpressions[0].id)
  assert.notEqual(next.customExpressions[0].image.ref, config.customExpressions[0].image.ref)
})

test('手工 JSON 模式可用、角色下拉原地刷新和跨 Bot 资源缓存共享', async t => {
  const { root, make } = await fixture(t)
  const a = await make('角色一', ['happy', 'angry', 'shy', 'crying'])
  await refreshAvatarFolders(root)
  const raw = JSON.parse(await fs.readFile(path.join(a, AVATAR_FILENAME), 'utf8'))
  for (const x of raw.customExpressions) x.buildMode = 'parts'
  const manual = path.join(avatarRoot(root), '手工角色')
  await fs.mkdir(manual)
  await fs.writeFile(path.join(manual, AVATAR_FILENAME), JSON.stringify(raw))
  const opts = avatarOptions(root)
  const b = await make('角色二', ['confused'])
  await refreshAvatarFolders(root)
  assert.ok(opts.some(o => o.value === '角色二'))
  assert.ok(!opts.some(o => o.value === ''), '旧版默认角色选项必须移除')
  assert.equal((await refreshAvatarFolders(root)).find(x => x.avatarId === '手工角色').status, '手工 JSON，未重建')
  const store = new AvatarResourceStore(root)
  const first = await store.load('999', '手工角色')
  assert.equal(first.expressions.length, 4)
  assert.equal(await store.load('888', '手工角色'), first)
  assert.notEqual((await store.load('999', '角色二')).version, first.version)
  await fs.mkdir(path.join(avatarRoot(root), '999'))
  await fs.copyFile(path.join(b, AVATAR_FILENAME), store.filename('999', '999'))
  assert.equal((await store.load('999', '999')).expressions.length, 1)
  await assert.rejects(store.load('999'), /角色目录名无效/)
})

test('非法路径、链接越界、图片名称冲突和损坏图片均不覆盖旧 JSON', async t => {
  const { root, make, pictures } = await fixture(t)
  const directory = await make('合法角色')
  await refreshAvatarFolders(root)
  const filename = path.join(directory, AVATAR_FILENAME)
  const before = await fs.readFile(filename)
  await fs.writeFile(path.join(directory, 'normal.webp'), pictures.normal)
  assert.match((await refreshAvatarFolders(root))[0].error, /名称冲突/)
  assert.deepEqual(await fs.readFile(filename), before)
  await fs.unlink(path.join(directory, 'normal.webp'))
  await fs.writeFile(path.join(directory, 'open.png'), 'not an image')
  assert.equal((await refreshAvatarFolders(root))[0].status, '失败')
  assert.deepEqual(await fs.readFile(filename), before)
  for (const name of ['../合法角色', 'C:/outside', '..', '.']) {
    await assert.rejects(checkedAvatarPath(root, name))
  }
  const outside = path.join(root, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, AVATAR_FILENAME), before)
  await fs.symlink(outside, path.join(avatarRoot(root), '越界'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(new AvatarResourceStore(root).load('999', '越界'), /超出/)
  assert.ok(!avatarOptions(root).some(o => o.value === '越界'))
})

test('最多32种表情与累计像素边界；旧配置和档位默认兼容', async t => {
  const { root, make, pictures } = await fixture(t)
  const directory = await make('多表情')
  for (let i = 0; i < 32; i++) await fs.writeFile(path.join(directory, '表情' + i + '.png'), pictures.happy)
  assert.equal((await refreshAvatarFolders(root))[0].expressions, 32)
  const before = await fs.readFile(path.join(directory, AVATAR_FILENAME))
  await fs.writeFile(path.join(directory, '第33种.png'), pictures.happy)
  assert.match((await refreshAvatarFolders(root))[0].error, /32/)
  assert.deepEqual(await fs.readFile(path.join(directory, AVATAR_FILENAME)), before)
  const config = JSON.parse(before)
  const big = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: 'white' } }).png().toBuffer()
  for (const x of config.customExpressions) x.image.ref = 'data:image/png;base64,' + big.toString('base64')
  await assert.rejects(parseAvatarResource(JSON.stringify(config)), /累计像素/)
  assert.deepEqual(normalizeAvatarReplyConfig({ groups: [{ botId: '999', groupId: '100', switchOn: true }] }).groups[0],
    { botId: '999', groupId: '100', switchOn: true, avatarId: '', size: '512x512', duration: 3, fps: 10 })
  assert.equal(normalizeAvatarReplyConfig({ groups: [{ botId: '999', groupId: '100', size: '512x640' }] }).groups[0].size,
    '512x512', '历史长方形设置需要无损迁移到正方形最低档')
})

test('实际编码验证三档正方形分辨率、时长和15 FPS累计延时，字幕不添加背景底条', async t => {
  const { root, make } = await fixture(t)
  await make('测试角色')
  await refreshAvatarFolders(root)
  const resource = await new AvatarResourceStore(root).load('999', '测试角色')
  for (const [size, duration, fps] of [['512x512', 2, 10], ['768x768', 3, 15], ['1024x1024', 5, 20]]) {
    const output = await renderAvatarGif(resource, { captions: ['测试字幕'], action: 'idle', expressionId: null }, { size, duration, fps })
    const meta = await sharp(output, { animated: true }).metadata()
    const [width, height] = size.split('x').map(Number)
    assert.equal(meta.width, width)
    assert.equal(meta.pageHeight, height)
    assert.equal(meta.pages, duration * fps)
    assert.equal(meta.delay.reduce((a, b) => a + b, 0), duration * 1000)
    assert.equal(meta.loop, 0)
    const rgba = await sharp(output, { page: 0 }).ensureAlpha().raw().toBuffer()
    const pixel = (x, y) => [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
    const at = (x, y) => pixel(Math.round(x * width / 512), Math.round(y * height / 512))
    // 首帧是整块红色角色图；字幕周围多个位置仍须保留原始角色像素。
    // 只查角落透明无法发现画面中部新增的气泡或半透明黑条。
    for (const [x, y] of [[96, 440], [416, 440], [96, 466], [416, 466], [256, 425]]) {
      const [r, g, b, alpha] = at(x, y)
      assert.ok(alpha === 255 && r > 200 && g < 50 && b < 50,
        '字幕周围不能被底条遮住角色像素：' + x + ',' + y)
    }
    for (const x of [96, 256, 416]) {
      assert.equal(at(x, 500)[3], 0, '电影字幕不能在角色下方额外铺底条')
    }
  }
})

test('每群角色和档位传到队列，私聊显式预览及生成中修改档位取消旧图', async t => {
  const { root, make } = await fixture(t)
  await make('甲')
  await make('乙', ['happy'])
  await refreshAvatarFolders(root)
  const config = normalizeAvatarReplyConfig({ groups: [
    { botId: '999', groupId: '100', switchOn: true, avatarId: '甲', size: '1024x1024', duration: 5, fps: 20 },
    { botId: '999', groupId: '200', switchOn: true, avatarId: '乙', size: '768x768', duration: 2, fps: 15 }
  ] })
  const jobs = []
  let sent = 0
  const service = new AvatarReplyService({ root, getConfig: () => config, warn() {},
    generate: async () => '{"caption":"测试","action":"idle","expressionId":null}',
    queue: { async render(resource, cue, isCurrent, options) { jobs.push({ count: resource.expressions.length, options }); return Buffer.from('gif') } },
    sendImage: async () => { sent++ }
  })
  await service.send({ isGroup: true, self_id: '999', group_id: '100' }, '回复', 'main')
  await service.send({ isGroup: true, self_id: '999', group_id: '200' }, '回复', 'main')
  assert.deepEqual(jobs.map(x => x.options), [
    { avatarId: '甲', size: '1024x1024', duration: 5, fps: 20, transition: true },
    { avatarId: '乙', size: '768x768', duration: 2, fps: 15, transition: true }
  ])
  assert.deepEqual(jobs.map(x => x.count), [0, 1])
  await service.send({ self_id: '999', isMaster: true }, '预览', undefined, true, '乙')
  assert.equal(jobs.at(-1).options.size, '512x512')
  service.queue = { async render() { config.groups[0].fps = 10; return Buffer.from('gif') } }
  assert.equal(await service.send({ isGroup: true, self_id: '999', group_id: '100' }, '回复', 'main'), false)
  assert.equal(sent, 3)
})
