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
  { plugin: '签到插件', command: '#签到', description: '每日签到领积分', permission: '', pluginDsc: '每日签到' },
  { plugin: '签到插件', command: '#我的积分', description: '查询自己的积分', permission: '', pluginDsc: '每日签到' },
  { plugin: '公告插件', command: '#看公告', description: '查看本群公告', permission: '', pluginDsc: '群公告' },
  { plugin: '公告插件', command: '#发公告', description: '发布群公告', permission: 'admin', pluginDsc: '群公告' }
]

const config = { enableCapabilityMap: true }
let state = { meta: { directory: '', entries: ENTRIES } }
let stale = false
const rebuilds = []

mock.module('../utils/config.js', { namedExports: { Config: config } })
mock.module('../utils/capability/rebuild.js', {
  namedExports: {
    startCapabilityRebuild: () => {
      rebuilds.push(Date.now())
      return Promise.resolve(state)
    }
  }
})
mock.module('../utils/capability/store.js', {
  namedExports: {
    readCapabilityState: () => state,
    isCapabilityStale: () => stale
  }
})

const { CapabilityLookupTool } = await import('../utils/tools/CapabilityLookupTool.js')

function run (query) {
  return new CapabilityLookupTool().func({ query })
}

test('按指令名命中，并带上归属插件', async () => {
  const text = await run('#签到')
  assert.match(text, /【签到插件】#签到/)
  assert.match(text, /每日签到领积分/)
})

test('按关键词命中多条', async () => {
  const text = await run('公告')
  assert.match(text, /#看公告/)
  assert.match(text, /#发公告/)
  assert.match(text, /找到 2 条相关指令/)
})

test('权限位写进结果，避免让普通成员去试管理员指令', async () => {
  const text = await run('#发公告')
  assert.match(text, /需要 admin 权限/)
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

test('首次没有缓存：不等待生成，先把重建丢到后台', async () => {
  const saved = state
  const before = rebuilds.length
  state = null
  try {
    const text = await run('#签到')
    assert.match(text, /正在首次生成/)
    assert.equal(rebuilds.length, before + 1)
  } finally {
    state = saved
  }
})

test('已过期：用旧数据回答，同时后台刷新', async () => {
  const before = rebuilds.length
  stale = true
  try {
    const text = await run('#签到')
    assert.match(text, /每日签到领积分/)
    assert.equal(rebuilds.length, before + 1)
  } finally {
    stale = false
  }
})
