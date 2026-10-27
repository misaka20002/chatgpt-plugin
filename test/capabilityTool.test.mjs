import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 详情查询工具（工具缝）。
 *
 * 直接在工具入口调用，存储被替换成一份假的能力状态：不读文件、不重建、不调模型。
 * 要守住的是「查得准」与「查不到就说查不到」——后者比前者更重要，
 * 因为模型最容易在查不到时自己编一条指令出来。
 */

const ENTRIES = [
  { plugin: '签到插件', pluginKey: 'sign', command: '#签到', description: '每日签到领积分', permission: '' },
  { plugin: '签到插件', pluginKey: 'sign', command: '#我的积分', description: '查询自己的积分', permission: '' },
  { plugin: '公告插件', pluginKey: 'notice', command: '#看公告', description: '查看本群公告', permission: '' },
  { plugin: '公告插件', pluginKey: 'notice', command: '#发公告', description: '发布群公告', permission: 'admin' }
]

const config = { enableCapabilityMap: true }
let state = { meta: { directory: '', entries: ENTRIES } }

mock.module('../utils/config.js', { namedExports: { Config: config } })
mock.module('../utils/capability/store.js', {
  namedExports: {
    readCapabilityState: () => state
  }
})

// 地图补丁只覆盖一条指令，用来断言「有补丁时会多给参数与示例」
const { normalizePatch } = await import('../utils/commandMap/patch.js')
const PATCH = normalizePatch({
  schema: 1,
  plugin: { key: 'sign', fingerprint: 'f1' },
  commands: {
    '#我的积分': { keys: ['我的积分', '我多少积分'], args: { p1: '页码，可留空' }, ex: '#我的积分 2', risk: 'q' }
  }
})
mock.module('../utils/commandMap/mapStore.js', {
  namedExports: {
    readAllPatches: () => [PATCH]
  }
})

const { CapabilityLookupTool } = await import('../utils/tools/CapabilityLookupTool.js')

function run (query) {
  return new CapabilityLookupTool().func({ query })
}

test('按指令名命中，展开所属插件类并带上说明', async () => {
  const text = await run('#签到')
  assert.match(text, /插件类【签到插件】共 2 条指令/)
  assert.match(text, /#签到 \[查询\] —— 每日签到领积分/)
})

test('按关键词命中多条', async () => {
  const text = await run('公告')
  // 「公告」命中插件类名，按两级目录展开该类全部指令
  assert.match(text, /插件类【公告插件】共 2 条指令/)
  assert.match(text, /#看公告/)
  assert.match(text, /#发公告/)
})

test('权限位与风险档写进结果，避免让普通成员去试管理员指令', async () => {
  const text = await run('#发公告')
  assert.match(text, /需 admin/)
  // 没有地图补丁时，带权限位的指令按保守方向判成「有副作用」
  assert.match(text, /有副作用/)
})

test('有地图补丁时给出参数与示例', async () => {
  const text = await run('#我的积分')
  assert.match(text, /\[查询\]/)
  assert.match(text, /参数：p1=页码，可留空/)
  assert.match(text, /示例：#我的积分 2/)
})

test('查不到时明确否定，并说明「不代表不存在」', async () => {
  const text = await run('原神抽卡')
  assert.match(text, /未在本机已安装的第三方插件里找到/)
  assert.match(text, /不代表该功能不存在/)
})

test('查询词为空时要求补充，不返回整张表', async () => {
  const text = await run('   ')
  assert.match(text, /请给出要查询的指令名或功能关键词/)
})

test('功能开关关闭时不查询', async () => {
  config.enableCapabilityMap = false
  try {
    const text = await run('#签到')
    assert.match(text, /已关闭/)
  } finally {
    config.enableCapabilityMap = true
  }
})

test('没有能力表时不自行重建，只提示主人发刷新指令', async () => {
  const saved = state
  state = null
  try {
    const text = await run('#签到')
    assert.match(text, /^Error: /)
    assert.match(text, /#chatgpt刷新功能表/)
  } finally {
    state = saved
  }
})

test('能力表再旧也照用，不触发任何自动重建', async () => {
  const saved = state
  state = { meta: { directory: '', entries: ENTRIES, generatedAt: '2020-01-01T00:00:00.000Z' } }
  try {
    const text = await run('#签到')
    assert.match(text, /每日签到领积分/)
  } finally {
    state = saved
  }
})
