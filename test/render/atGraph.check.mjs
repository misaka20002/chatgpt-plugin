// 运行：node test/render/atGraph.check.mjs [--shot]；浏览器环境变量与其他渲染套件一致。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import template from 'art-template'
import { buildAtGraph } from '../../utils/memory/atGraph.js'
import { openBrowser, closeBrowser } from './harnessBrowser.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = await fs.readFile(path.join(root, 'resources/atGraph/index.html'), 'utf8')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'at-graph-'))
const generatedAt = 1790780000
const names = ['月见', '北岛与海', '薄荷气泡', '星野', '晚风来信', '小满', '橘子汽水', '云间', '知更鸟', '眠羊', '青柠', '白日梦', '松间月', '晴川', '桃子乌龙', '林深', '流萤', '听雨', '小舟', '向晚', '远山']
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
const options = { groupId: '100', targetId: '10001', targetName: '小夏', groupName: '春日茶话会 · 示例数据', generatedAt }
const dense = buildAtGraph({ ...options, rows })
const hostileName = '<img src="https://invalid.test/x" onerror="location=\'https://invalid.test\'">'
const cases = [
  ['dense', dense],
  ['sparse', buildAtGraph({ ...options, rows: [rows[0]] })],
  ['outer-ring', buildAtGraph({ ...options, rows: rows.filter(r => r.senderId === '10001' ? Number(r.at?.[0]) < 20007 : Number(r.senderId) < 20007) })],
  ['hostile', buildAtGraph({ ...options, rows, targetName: hostileName, groupName: hostileName, limited: true })]
]
let browser
try {
  browser = await openBrowser()
  for (const [name, data] of cases) {
    const htmlPath = path.join(directory, `${name}.html`)
    await fs.writeFile(htmlPath, template.render(source, { ...data, pluResPath: pathToFileURL(path.join(root, 'resources')).href }))
    const page = await browser.newPage()
    const requests = []
    const pageErrors = []
    page.on('request', req => requests.push(req.url()))
    page.on('pageerror', err => pageErrors.push(err.message))
    const url = pathToFileURL(htmlPath).href
    await page.goto(url, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    const info = await page.evaluate(() => {
      const graph = document.querySelector('.graph').getBoundingClientRect()
      const box = document.querySelector('#container').getBoundingClientRect()
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
        escapedName: document.querySelector('.subject strong').textContent,
        active: document.querySelectorAll('script, iframe, object, img, meta[http-equiv="refresh"]').length,
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
    assert.ok(info.height < 3500)
    assert.equal(info.nodes, data.nodes.length + 1)
    assert.ok(info.fits, `${name} 节点越界`)
    assert.deepEqual(info.overlaps, [], `${name} 节点标签重叠`)
    assert.equal(info.overflow, false)
    assert.equal(info.active, 0)
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
