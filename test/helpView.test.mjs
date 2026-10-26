import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

// apps/help.js 本身只是数据容器，但它在模块顶层读了 Config.version 并导入宿主基类与渲染函数，
// 这三条边界换成空实现即可；helpData 用的是真实数据，不造假。
mock.module('../utils/config.js', { namedExports: { Config: { version: 'test' } } })
mock.module('../utils/common.js', { namedExports: { render: async () => {} } })
mock.module('../../../lib/plugins/plugin.js', { defaultExport: class {} })

const { helpData } = await import('../apps/help.js')
const { helpEntries } = await import('../utils/helpView.js')

const itemsOf = groups => helpData.filter(g => groups.includes(g.group)).flatMap(g => g.list)

// 期望值在测试里写死，不从 helpView 的别名表推出来：拿实现当期望值，别名写错了测试会跟着错。
const WEB_CARDS = {
  AI聊天: ['聊天'],
  插件管理: ['管理'],
  设定: ['设定'],
  系统设置: ['设置', '其他']
}

for (const [card, groups] of Object.entries(WEB_CARDS)) {
  test(`「${card}」映射到 ${groups.join(' + ')} 的全部指令`, () => {
    assert.deepEqual(
      helpEntries(helpData, card).map(item => item.title),
      itemsOf(groups).map(item => item.title)
    )
  })
}

test('每条都带图标、标题、说明，list 与 tip 为空', () => {
  const entries = helpEntries(helpData, '设定')
  assert.ok(entries.length > 0)
  for (const item of entries) {
    assert.match(item.icon, /^fas fa-/)
    assert.ok(item.title)
    assert.equal(typeof item.text, 'string')
    assert.deepEqual(item.list, [])
    assert.equal(item.tip, '')
  }
})

test('图标名确实按表换成了 FontAwesome 类名，不是清一色兜底值', () => {
  const icons = new Set(helpEntries(helpData, 'AI聊天').map(item => item.icon))
  assert.ok([...icons].some(icon => icon !== 'fas fa-circle'))
})

test('没有对应分组的卡片名返回空数组', () => {
  assert.deepEqual(helpEntries(helpData, 'AI画图'), [])
  assert.deepEqual(helpEntries(helpData, '不存在的分组'), [])
})
