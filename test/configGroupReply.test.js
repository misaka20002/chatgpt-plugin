import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const moduleUrl = relative => new URL(relative, import.meta.url).href

test('锅巴群聊判断表格、内置提示词、数值边界与保存后重载一致，旧伪人入口失效', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-group-reply-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const configDir = path.join(cwd, 'plugins/chatgpt-plugin/config')
  fs.mkdirSync(configDir, { recursive: true })
  const file = path.join(configDir, 'config.json')
  fs.writeFileSync(file, JSON.stringify({ enableBYM: true, bymRate: 100, assistantLabel: '旧名字', tts_First_person: '测试称呼', groupReply: { systemPrompt: '旧版只在被点名时回复', decisionPrompt: '旧自定义提示词' } }))
  const run = action => JSON.parse(execFileSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', `
    import { mock } from 'node:test'
    import assert from 'node:assert/strict'
    globalThis.logger = { error: console.error, warn() {}, info() {} }
    globalThis.redis = { get: async () => null }
    mock.module(${JSON.stringify(moduleUrl('../utils/tts.js'))}, { namedExports: { speakers: [], vits_emotion_map: [] } })
    mock.module(${JSON.stringify(moduleUrl('../utils/tts/microsoft-azure.js'))}, { namedExports: { supportConfigurations: [] } })
    const { Config } = await import(${JSON.stringify(moduleUrl('../utils/config.js'))})
    const { supportGuoba } = await import(${JSON.stringify(moduleUrl('../guoba.support.js'))})
    const guoba = supportGuoba().configInfo
    ${action}
    process.stdout.write(JSON.stringify(await guoba.getConfigData()))
    process.exit(0)
  `], { cwd, encoding: 'utf8', timeout: 15000 }))
  const saved = run(`
    const initial = await guoba.getConfigData()
    assert.equal(initial.groupReply.enabled, false)
    assert.equal(initial.groupReply.historyCount, 50)
    assert.equal(initial.groupReply.debounceSeconds, undefined)
    assert.equal(initial.groupReply.decisionPrompt, undefined)
    assert.equal(initial.groupReply.systemPrompt, undefined)
    assert.ok(!guoba.schemas.some(s => s.field === 'groupReply.decisionPrompt'))
    assert.ok(!guoba.schemas.some(s => s.field === 'groupReply.systemPrompt'))
    assert.equal(initial.enableBYM, undefined)
    assert.equal(initial.assistantLabel, undefined)
    assert.equal(initial.tts_First_person, '测试称呼')
    assert.ok(!guoba.schemas.some(s => s.field === 'assistantLabel'))
    assert.equal(guoba.schemas.filter(s => s.field === 'tts_First_person').length, 1)
    const table = guoba.schemas.find(s => s.field === 'groupReply.groups')
    assert.equal(table.component, 'GSubForm')
    assert.deepEqual(table.componentProps.schemas.map(s => s.field), ['groupId', 'switchOn', 'debounceSeconds', 'enthusiasm'])
    const enthusiasm = table.componentProps.schemas.find(s => s.field === 'enthusiasm')
    assert.equal(enthusiasm.label, '热情度（%）')
    assert.equal(enthusiasm.componentProps.placeholder, '默认 40%')
    assert.equal(enthusiasm.componentProps.min, 1)
    assert.equal(enthusiasm.componentProps.max, 100)
    const wait = table.componentProps.schemas.find(s => s.field === 'debounceSeconds')
    assert.equal(wait.componentProps.max, undefined)
    assert.match(wait.label, /每隔多久判断是否回复/)
    assert.ok(!guoba.schemas.some(s => s.field === 'groupReply.debounceSeconds'))
    const tabs = guoba.schemas.filter(s => s.component === 'SOFT_GROUP_BEGIN').map(s => s.label)
    assert.deepEqual(tabs.slice(tabs.indexOf('智能模式'), tabs.indexOf('小功能') + 1), ['智能模式', '主动触发', '小功能'])
    let tab
    for (const schema of guoba.schemas) {
      if (schema.component === 'SOFT_GROUP_BEGIN') tab = schema.label
      if (schema.field?.startsWith('groupReply.') || ['initiativeChatGroups', 'helloPrompt', 'helloInterval', 'helloProbability'].includes(schema.field)) assert.equal(tab, '主动触发')
    }
    assert.ok(!guoba.schemas.some(s => s.field === 'enableBYM'))
    await guoba.setConfigData({
      'groupReply.enabled': true,
      'groupReply.groups': [{ groupId: ' 100 ', switchOn: true, debounceSeconds: 0, enthusiasm: 0 }, { groupId: '200', switchOn: false, debounceSeconds: 3600, enthusiasm: 150 }],
      'groupReply.historyCount': 5,
      'groupReply.provider': 'responses',
      'groupReply.model': ' small-model ',
      'groupReply.decisionPrompt': '仅被点名时才回复'
    }, { Result: { ok() {}, error(message) { throw new Error(message) } } })
  `)
  const reloaded = run('')
  assert.deepEqual(reloaded.groupReply, saved.groupReply)
  assert.equal(reloaded.tts_First_person, '测试称呼')
  assert.equal(JSON.parse(fs.readFileSync(file)).assistantLabel, undefined)
  assert.deepEqual(saved.groupReply.groups, [{ groupId: '100', switchOn: true, debounceSeconds: 0, enthusiasm: 1 }, { groupId: '200', switchOn: false, debounceSeconds: 3600, enthusiasm: 100 }])
  assert.equal(saved.groupReply.historyCount, 20)
  assert.equal(saved.groupReply.debounceSeconds, undefined)
  assert.equal(saved.groupReply.decisionPrompt, undefined)
  assert.equal(JSON.parse(fs.readFileSync(file)).groupReply.decisionPrompt, undefined)
  assert.equal(JSON.parse(fs.readFileSync(file)).groupReply.systemPrompt, undefined)
  assert.equal(saved.groupReply.model, 'small-model')
  assert.equal(JSON.parse(fs.readFileSync(file)).enableBYM, undefined)
  const toggled = run(`
    mock.module(${JSON.stringify(moduleUrl('../../../lib/plugins/plugin.js'))}, { defaultExport: class {} })
    mock.module(${JSON.stringify(moduleUrl('../utils/groupReply.js'))}, { namedExports: { groupReply: { prune() {} } } })
    const { groupReplyObserver } = await import(${JSON.stringify(moduleUrl('../apps/groupReply.js'))})
    Config.getConfig().groupReply.enabled = false
    await new groupReplyObserver().toggle({ isMaster: true, isGroup: true, group_id: '300', msg: '#群聊自主回复开启', reply: async () => {} })
  `)
  assert.equal(toggled.groupReply.enabled, true)
  assert.deepEqual(toggled.groupReply.groups.at(-1), { groupId: '300', switchOn: true, debounceSeconds: 60, enthusiasm: 40 })
  assert.deepEqual(run('').groupReply, toggled.groupReply)
  const defaults = run(`
    await guoba.setConfigData({
      'groupReply.debounceSeconds': 5,
      'groupReply.groups': [
        { groupId: '100', switchOn: true },
        { groupId: '200', switchOn: true, debounceSeconds: null },
        { groupId: '300', switchOn: true, debounceSeconds: '' },
        { groupId: '400', switchOn: true, debounceSeconds: '坏值' }
      ]
    }, { Result: { ok() {} } })
  `)
  assert.deepEqual(defaults.groupReply.groups.map(g => g.debounceSeconds), [60, 60, 60, 60])
  assert.deepEqual(defaults.groupReply.groups.map(g => g.enthusiasm), [40, 40, 40, 40])
  assert.equal(defaults.groupReply.debounceSeconds, undefined)
  assert.deepEqual(run('').groupReply, defaults.groupReply)
  const cleared = run(`
    await guoba.setConfigData({ 'groupReply.groups': [], 'groupReply.decisionPrompt': '', 'groupReply.historyCount': '坏值' }, { Result: { ok() {} } })
  `)
  assert.deepEqual(cleared.groupReply.groups, [])
  assert.equal(cleared.groupReply.decisionPrompt, undefined)
  assert.equal(cleared.groupReply.historyCount, 50)
  assert.equal(cleared.groupReply.debounceSeconds, undefined)
})
