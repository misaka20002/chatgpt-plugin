// 运行：node test/render/atGraph.check.mjs [--shot]；浏览器环境变量与其他渲染套件一致。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import template from 'art-template'
import sharp from 'sharp'
import { buildAtGraph } from '../../utils/memory/atGraph.js'
import { openBrowser, closeBrowser } from './harnessBrowser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = await fs.readFile(path.join(root, 'resources/atGraph/index.html'), 'utf8')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'at-graph-'))
const generatedAt = 1790780000
const names = ['「糖果精灵🍬」小呆毛', '北岛与海', '薄荷气泡🫧', '星野', '晚风来信', '「记者📝」吉吉原神国王', '橘子汽水', '云间', '「和风🌸女仆」鲱鱼鳕鳕', '眠羊', '青柠', '白日梦', '松间月', '晴川', '桃子乌龙', '林深', '流萤', '听雨', '小舟', '向晚', '远山']
let serial = 0
const rows = []
for (let i = 0; i < names.length; i++) {
  const peer = String(20000 + i)
  const outgoing = i % 4 === 3 ? 0 : Math.max(1, 103 - i * 6)
  const incoming = i % 4 === 2 ? 0 : Math.max(1, 139 - i * 8)
  for (let j = 0; j < outgoing + incoming; j++) {
    const sent = j < outgoing
    rows.push({ groupId: '100', messageId: String(++serial), senderId: sent ? '10001' : peer, senderName: sent ? '小夏' : names[i], at: [sent ? peer : '10001'], time: generatedAt - 86400 * 12 + serial * 150, text: '刚才那张星图好好看！\n下次也一起记录群里的小日常吧 🌟' })
  }
  // 只有收到 @ 的成员也可能留下不含 @ 的普通消息，昵称从其最新原文取得。
  rows.push({ groupId: '100', messageId: String(++serial), senderId: peer, senderName: names[i], time: generatedAt - 10 })
}
const options = { groupId: '100', targetId: '10001', targetName: '「🥝狼女」c', groupName: '群聊互动 · 示例数据', generatedAt }
const dense = buildAtGraph({ ...options, rows })
// 默认用本地位图夹具检查真实 img 解码；视觉预览可显式提供已有头像目录。
const avatar = `data:image/png;base64,${(await sharp({ create: { width: 80, height: 80, channels: 3, background: '#79adc7' } }).png().toBuffer()).toString('base64')}`
const avatars = Object.fromEntries([dense.target, dense.latestMention, ...dense.nodes, ...dense.outgoingRank, ...dense.incomingRank].map(p => [p.id, avatar]))
if (process.env.AT_GRAPH_PREVIEW_AVATARS) {
  const sources = JSON.parse(await fs.readFile(process.env.AT_GRAPH_PREVIEW_AVATARS, 'utf8'))
  Object.assign(avatars, sources)
}
const hostileName = '<img src="https://invalid.test/x" onerror="location=\'https://invalid.test\'">'
const cases = [
  ['dense', dense],
  ['sparse', buildAtGraph({ ...options, rows: [rows[0]] })],
  ['large-counts', buildAtGraph({ ...options, rows: Array.from({ length: 20000 }, (_, i) => ({ ...rows[0], messageId: `large-${i}`, senderId: i % 2 ? '10001' : '20000', at: [i % 2 ? '20000' : '10001'] })) })],
  ['outer-ring', buildAtGraph({ ...options, rows: rows.filter(r => r.senderId === '10001' ? Number(r.at?.[0]) < 20007 : Number(r.senderId) < 20007) })],
  ['long-names', buildAtGraph({ ...options, rows: rows.map(r => ({ ...r, senderName: `「🥝${'很长的群友昵称'.repeat(10)}」c` })) })],
  ['long-message', buildAtGraph({ ...options, rows: rows.map(r => ({ ...r, text: `${'消息🌟'.repeat(100)}\n${'第二行\n'.repeat(100)}` })) })],
  ['mention-only', buildAtGraph({ ...options, rows: [{ ...rows.find(r => r.senderId === '20000'), text: '' }] })],
  ['hostile', buildAtGraph({ ...options, rows: rows.map(r => ({ ...r, text: hostileName })), targetName: hostileName, groupName: hostileName, limited: true })]
]
let browser
try {
  browser = await openBrowser()
  const girls = (await fs.readdir(path.join(root, 'resources/girls'))).filter(name => name.endsWith('.webp')).sort()
  let girlIndex = 0
  for (const [name, data] of cases) {
    const htmlPath = path.join(directory, `${name}.html`)
    const girlBuffer = await fs.readFile(path.join(root, 'resources/girls', girls[girlIndex++ % girls.length]))
    const girlImage = `data:image/webp;base64,${girlBuffer.toString('base64')}`
    await fs.writeFile(htmlPath, template.render(source, { ...data, avatars, girlImage, pluResPath: pathToFileURL(path.join(root, 'resources')).href }))
    const page = await browser.newPage()
    const requests = []
    const pageErrors = []
    page.on('request', req => requests.push(req.url()))
    page.on('pageerror', err => pageErrors.push(err.message))
    const url = pathToFileURL(htmlPath).href
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.documentElement.dataset.atGraphReady === 'true')
    const info = await page.evaluate(() => {
      const graph = document.querySelector('.graph').getBoundingClientRect()
      const box = document.querySelector('#container').getBoundingClientRect()
      const symbol = document.querySelector('.hero-symbol')
      const icon = symbol.querySelector('svg')
      const frame = symbol.getBoundingClientRect()
      const iconRect = icon?.getBoundingClientRect()
      const ink = icon?.getBBox()
      const view = icon?.viewBox.baseVal
      const girlElement = document.querySelector('.graph-girl')
      const girl = girlElement?.getBoundingClientRect()
      const girlStyle = girlElement && getComputedStyle(girlElement)
      const centerAvatar = document.querySelector('.center-avatar').getBoundingClientRect()
      const avatarSizes = [...document.querySelectorAll('.node .avatar')].map(el => {
        const rect = el.getBoundingClientRect()
        return { size: rect.width, distance: Math.hypot(rect.x + rect.width / 2 - centerAvatar.x - centerAvatar.width / 2, rect.y + rect.height / 2 - centerAvatar.y - centerAvatar.height / 2) }
      })
      const nodes = [...document.querySelectorAll('.node, .center')].map(el => {
        const parts = [el, ...el.querySelectorAll('.direction-pill')].map(part => part.getBoundingClientRect())
        return { x: Math.min(...parts.map(r => r.x)), y: Math.min(...parts.map(r => r.y)), right: Math.max(...parts.map(r => r.right)), bottom: Math.max(...parts.map(r => r.bottom)) }
      })
      const directionPlacement = [...document.querySelectorAll('.node')].every(el => {
        const avatar = el.querySelector('.avatar').getBoundingClientRect()
        const name = el.querySelector('.node-name').getBoundingClientRect()
        const ax = avatar.x + avatar.width / 2, ay = avatar.y + avatar.height / 2
        const dx = ax - centerAvatar.x - centerAvatar.width / 2, dy = ay - centerAvatar.y - centerAvatar.height / 2
        const distance = Math.hypot(dx, dy)
        return ['sent', 'received'].every((kind, index) => {
          const pill = el.querySelector(`.${kind}`).getBoundingClientRect()
          const px = pill.x + pill.width / 2 - ax, py = pill.y + pill.height / 2 - ay
          const projection = (px * dx + py * dy) / distance
          return (index ? projection > 0 : projection < 0)
            && Math.abs((px * dy - py * dx) / distance) < 0.1
            && Math.hypot(px, py) >= avatar.width / 2 - 6
            && Math.hypot(px, py) <= avatar.width / 2 + Math.hypot(pill.width, pill.height) / 2 + 1
            && pill.bottom < name.top
        })
      })
      const mention = document.querySelector('.mention-message')
      const mentionText = mention?.querySelector('.mention-text')
      const overlaps = []
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]
        if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 2) overlaps.push([i, j])
      }
      return {
        width: box.width, height: box.height, nodes: nodes.length,
        symbolCentered: !!icon && Math.abs(iconRect.x + iconRect.width / 2 - frame.x - frame.width / 2) < 0.5
          && Math.abs(iconRect.y + iconRect.height / 2 - frame.y - frame.height / 2) < 0.5
          && Math.abs(ink.x + ink.width / 2 - view.x - view.width / 2) < 0.1
          && Math.abs(ink.y + ink.height / 2 - view.y - view.height / 2) < 0.1,
        escapedName: document.querySelector('.subject strong').textContent,
        mention: mention && {
          name: mention.querySelector('.mention-name').textContent,
          time: mention.querySelector('.mention-time').textContent,
          text: mentionText.textContent,
          avatar: mention.querySelector('img')?.src,
          textFits: mentionText.scrollWidth <= mentionText.clientWidth + 1 && mentionText.scrollHeight <= mentionText.clientHeight + 1,
          truncated: !!mention.querySelector('.mention-truncated')
        },
        active: document.querySelectorAll('script:not([src$="/atGraph/layout.js"]), iframe, object, meta[http-equiv="refresh"]').length,
        imagesLoaded: [...document.images].every(img => img.src.startsWith('data:image/') && img.naturalWidth > 0),
        namesFit: [...document.querySelectorAll('[data-fit]')].every(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1),
        names: [...document.querySelectorAll('.node-name')].map(el => el.textContent),
        directions: [...document.querySelectorAll('.node')].map(el => [Number(el.querySelector('.sent strong').textContent), Number(el.querySelector('.received strong').textContent)]),
        countsFit: [...document.querySelectorAll('.direction-pill')].every(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1),
        directionPlacement,
        avatarSizes,
        girlCount: document.querySelectorAll('.graph-girl img').length,
        girlFits: !!girl && girl.left >= graph.x + graph.width / 2 && girl.top >= graph.y + graph.height / 2 && girl.right <= graph.right && girl.bottom <= graph.bottom,
        girlBehind: !!girlStyle && Number(girlStyle.opacity) > 0 && Number(girlStyle.opacity) < 0.5
          && [...document.querySelectorAll('.graph > svg, .node, .center')].every(el => Number(getComputedStyle(el).zIndex) > Number(girlStyle.zIndex)),
        fits: nodes.every(n => n.x >= graph.x && n.right <= graph.right && n.y >= graph.y && n.bottom <= graph.bottom),
        overlaps, overflow: document.querySelector('.sheet').scrollWidth > document.querySelector('.sheet').clientWidth
      }
    })
    if (process.argv.includes('--shot')) {
      const shot = path.join(directory, `${name}.png`)
      await (await page.$('#container')).screenshot({ path: shot })
      console.log(`截图：${shot}`)
    }
    assert.equal(info.width, 1600)
    assert.ok(info.symbolCentered, '右上角 @ 的图形边界和框中心必须对齐')
    assert.ok(info.height < 4400)
    assert.equal(info.nodes, data.nodes.length + 1)
    assert.ok(info.fits, `${name} 节点越界`)
    assert.deepEqual(info.overlaps, [], `${name} 节点标签重叠`)
    assert.equal(info.overflow, false)
    assert.equal(info.active, 0)
    assert.ok(info.imagesLoaded)
    assert.ok(info.namesFit, `${name} 昵称未完整排入文本框`)
    assert.deepEqual(info.names, data.nodes.map(n => n.name))
    assert.deepEqual(info.directions, data.nodes.map(n => [n.outgoing, n.incoming]))
    assert.ok(info.countsFit, `${name} 双向次数胶囊溢出`)
    assert.ok(info.directionPlacement, `${name} 胶囊未贴合头像内外两侧或遮挡昵称`)
    assert.equal(info.girlCount, 1)
    assert.ok(info.girlFits, '女孩图片须在图谱内部右下角')
    assert.ok(info.girlBehind, '女孩图片须半透明并位于连线和头像下方')
    for (let i = 0; i < data.nodes.length; i++) {
      assert.ok(Math.abs(info.avatarSizes[i].size - data.nodes[i].avatarSize) < 0.1, '头像须使用布局计算的尺寸')
      assert.ok(Math.abs(info.avatarSizes[i].distance - data.nodes[i].radius) < 0.1, '缩放不能偏移头像中心')
    }
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(requests.filter(url => /^https?:/.test(url)), [])
    assert.equal(page.url(), url)
    assert.equal(info.escapedName, data.target.name)
    if (data.latestMention) {
      assert.equal(info.mention.name, data.latestMention.name)
      assert.equal(info.mention.time, data.latestMention.timeLabel)
      assert.equal(info.mention.text, data.latestMention.text || '这条 @ 没有留下文字内容（纯 @ 或正文未保存）')
      assert.equal(info.mention.avatar, avatars[data.latestMention.id])
      assert.ok(info.mention.textFits, '最近 @ 正文不能溢出或被静默裁剪')
      assert.equal(info.mention.truncated, data.latestMention.truncated)
    } else assert.equal(info.mention, null)
    console.log(`${name}：尺寸 ${info.width}×${info.height}，布局、文本转义与网络边界通过`)
    await page.close()
  }
} finally {
  if (browser) await closeBrowser(browser)
  if (!process.argv.includes('--shot')) await fs.rm(directory, { recursive: true, force: true })
}
