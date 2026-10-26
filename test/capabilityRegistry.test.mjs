import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { loadPluginSnapshot } from '../utils/capability/registry.js'
import { SELF_PLUGIN_ROOT } from '../utils/capability/paths.js'

/**
 * 取插件总表（次缝）。
 *
 * 真实加载器被替换成一份假的总表，插件根目录换成临时目录：不依赖框架、不依赖本机装了什么。
 * 要守住的三件事：只收第三方插件、本插件与框架内置被排除、取不到总表时降级而不是崩。
 */

const SELF_NAME = path.basename(SELF_PLUGIN_ROOT)

async function makeRoot () {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capability-'))
  await fs.mkdir(path.join(root, 'sign-plugin'))
  await fs.mkdir(path.join(root, SELF_NAME))
  await fs.mkdir(path.join(root, 'lib', 'plugins', 'system-plugin'), { recursive: true })
  return root
}

function loaderWith (items) {
  return { priority: items }
}

describe('从总表提取第三方插件', () => {
  test('只保留第三方插件，本插件与框架内置都不收', async t => {
    const root = await makeRoot()
    t.after(() => fs.rm(root, { recursive: true, force: true }))

    const loader = loaderWith([
      {
        key: SELF_NAME,
        plugin: { name: 'ChatGPT 对话', dsc: '与 AI 对话', rule: [{ reg: /^#chat/ }] }
      },
      {
        key: 'sign-plugin',
        plugin: {
          name: '签到插件',
          dsc: '每日签到',
          rule: [
            { reg: /^#签到$/, permission: '' },
            { reg: '^#打卡$', permission: 'master' }
          ]
        }
      },
      {
        key: 'lib/plugins/system-plugin',
        plugin: { name: '系统插件', dsc: '框架自带', rule: [{ reg: /^#帮助$/ }] }
      }
    ])

    const snapshot = await loadPluginSnapshot({ loader, pluginsRoot: root })

    assert.equal(snapshot.degraded, false)
    assert.equal(snapshot.plugins.length, 1)
    const [plugin] = snapshot.plugins
    assert.equal(plugin.name, '签到插件')
    assert.equal(plugin.dsc, '每日签到')
    assert.equal(plugin.rules.length, 2)
    // RegExp 与字符串两种写法都要能取到 source
    assert.equal(plugin.rules[0].reg, '^#签到$')
    assert.equal(plugin.rules[1].reg, '^#打卡$')
    assert.equal(plugin.rules[1].permission, 'master')
  })

  test('总表只给构造器不给实例时，实例化后照样取到 name / rule', async t => {
    const root = await makeRoot()
    t.after(() => fs.rm(root, { recursive: true, force: true }))

    class FakePlugin {
      constructor () {
        this.name = '抽卡插件'
        this.dsc = '模拟抽卡'
        this.rule = [{ reg: /^#抽卡$/ }]
      }
    }

    const snapshot = await loadPluginSnapshot({
      loader: loaderWith([{ key: 'sign-plugin', class: FakePlugin }]),
      pluginsRoot: root
    })

    assert.equal(snapshot.plugins.length, 1)
    assert.equal(snapshot.plugins[0].name, '抽卡插件')
    assert.equal(snapshot.plugins[0].rules[0].reg, '^#抽卡$')
  })

  test('本插件靠目录名也能排掉（总表 key 与目录名不一致时）', async t => {
    const root = await makeRoot()
    t.after(() => fs.rm(root, { recursive: true, force: true }))

    const loader = loaderWith([{ key: SELF_NAME, plugin: { name: 'x', rule: [{ reg: /^#a$/ }] } }])
    const snapshot = await loadPluginSnapshot({ loader, pluginsRoot: root })
    assert.deepEqual(snapshot.plugins, [])
  })
})

describe('取不到总表时降级', () => {
  test('loader 没有 priority → 降级并标记', async () => {
    const snapshot = await loadPluginSnapshot({
      loader: {},
      sourceScan: async () => [
        { key: 'sign-plugin', name: '签到插件', dsc: '每日签到', dir: '/tmp/sign-plugin', rules: [{ reg: '^#签到$', permission: '' }] }
      ]
    })

    assert.equal(snapshot.degraded, true)
    assert.equal(snapshot.plugins.length, 1)
    assert.equal(snapshot.plugins[0].rules[0].reg, '^#签到$')
  })

  test('降级扫描返回空时不抛异常', async () => {
    const snapshot = await loadPluginSnapshot({ loader: null, sourceScan: async () => [] })
    assert.deepEqual(snapshot, { degraded: true, plugins: [] })
  })
})
