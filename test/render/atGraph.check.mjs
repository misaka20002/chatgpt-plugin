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
    rows.push({ groupId: '100', messageId: String(++serial), senderId: sent ? '10001' : peer, senderName: sent ? '小夏' : names[i], at: [sent ? peer : '10001'], time: generatedAt - 86400 * 12 + serial * 150 })
  }
  // 只有收到 @ 的成员也可能留下不含 @ 的普通消息，昵称从其最新原文取得。
  rows.push({ groupId: '100', messageId: String(++serial), senderId: peer, senderName: names[i], time: generatedAt - 10 })
}
const options = { groupId: '100', targetId: '10001', targetName: '「🥝狼女」c', groupName: '群聊互动 · 示例数据', generatedAt }
const dense = buildAtGraph({ ...options, rows })
// 默认用本地位图夹具检查真实 img 解码；视觉预览可显式提供已有头像目录。
const avatar = `data:image/png;base64,${(await sharp({ create: { width: 80, height: 80, channels: 3, background: '#79adc7' } }).png().toBuffer()).toString('base64')}`
const avatars = Object.fromEntries([dense.target, ...dense.nodes, ...dense.outgoingRank, ...dense.incomingRank].map(p => [p.id, avatar]))
if (process.env.AT_GRAPH_PREVIEW_AVATARS) {
  const sources = JSON.parse(await fs.readFile(process.env.AT_GRAPH_PREVIEW_AVATARS, 'utf8'))
  Object.assign(avatars, sources)
}
const hostileName = '<img src="https://invalid.test/x" onerror="location=\'https://invalid.test\'">'
const cases = [
  ['dense', dense],
  ['sparse', buildAtGraph({ ...options, rows: [rows[0]] })],
  ['outer-ring', buildAtGraph({ ...options, rows: rows.filter(r => r.senderId === '10001' ? Number(r.at?.[0]) < 20007 : Number(r.senderId) < 20007) })],
  ['long-names', buildAtGraph({ ...options, rows: rows.map(r => ({ ...r, senderName: `「🥝${'很长的群友昵称'.repeat(10)}」c` })) })],
  ['hostile', buildAtGraph({ ...options, rows, targetName: hostileName, groupName: hostileName, limited: true })]
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
      const girl = document.querySelector('.footer-girl')?.getBoundingClientRect()
      const footerCopy = document.querySelector('.footer-copy').getBoundingClientRect()
      const nodes = [...document.querySelectorAll('.node, .center')].map(el => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }
      })
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
        active: document.querySelectorAll('script:not([src$="/atGraph/layout.js"]), iframe, object, meta[http-equiv="refresh"]').length,
        imagesLoaded: [...document.images].every(img => img.src.startsWith('data:image/') && img.naturalWidth > 0),
        namesFit: [...document.querySelectorAll('[data-fit]')].every(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1),
        names: [...document.querySelectorAll('.node-name')].map(el => el.textContent),
        counts: [...document.querySelectorAll('.count-badge')].map(el => Number(el.textContent)),
        oldCaptions: document.querySelectorAll('.node-count').length,
        girlCount: document.querySelectorAll('.footer-girl img').length,
        girlFits: !!girl && girl.left >= footerCopy.right && girl.right <= box.right && girl.bottom <= box.bottom,
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
    assert.deepEqual(info.counts, data.nodes.map(n => n.total))
    assert.equal(info.oldCaptions, 0)
    assert.equal(info.girlCount, 1)
    assert.ok(info.girlFits, '女孩图片不能遮挡页脚文字或超出图片边界')
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(requests.filter(url => /^https?:/.test(url)), [])
    assert.equal(page.url(), url)
    assert.equal(info.escapedName, data.target.name)
    console.log(`${name}：尺寸 ${info.width}×${info.height}，布局、文本转义与网络边界通过`)
    await page.close()
  }
} finally {
  if (browser) await closeBrowser(browser)
  if (!process.argv.includes('--shot')) await fs.rm(directory, { recursive: true, force: true })
}
