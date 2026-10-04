import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const moduleUrl = relative => new URL(relative, import.meta.url).href

test('锅巴群聊判断表格、默认提示词、数值边界与保存后重载一致，旧伪人入口失效', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-group-reply-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const configDir = path.join(cwd, 'plugins/chatgpt-plugin/config')
  fs.mkdirSync(configDir, { recursive: true })
  const file = path.join(configDir, 'config.json')
  fs.writeFileSync(file, JSON.stringify({ enableBYM: true, bymRate: 100, assistantLabel: '旧名字', tts_First_person: '测试称呼' }))
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
    assert.equal(initial.groupReply.debounceSeconds, 10)
    assert.match(initial.groupReply.systemPrompt, /QQ 群聊/)
    assert.equal(initial.enableBYM, undefined)
    assert.equal(initial.assistantLabel, undefined)
    assert.equal(initial.tts_First_person, '测试称呼')
    assert.ok(!guoba.schemas.some(s => s.field === 'assistantLabel'))
    assert.equal(guoba.schemas.filter(s => s.field === 'tts_First_person').length, 1)
    const table = guoba.schemas.find(s => s.field === 'groupReply.groups')
    assert.equal(table.component, 'GSubForm')
    assert.deepEqual(table.componentProps.schemas.map(s => s.field), ['groupId', 'switchOn'])
    assert.ok(!guoba.schemas.some(s => s.field === 'enableBYM'))
    await guoba.setConfigData({
      'groupReply.enabled': true,
      'groupReply.groups': [{ groupId: ' 100 ', switchOn: true }, { groupId: '200', switchOn: false }],
      'groupReply.historyCount': 5,
      'groupReply.debounceSeconds': 0,
      'groupReply.provider': 'responses',
      'groupReply.model': ' small-model ',
      'groupReply.systemPrompt': '仅被点名时才回复'
    }, { Result: { ok() {}, error(message) { throw new Error(message) } } })
  `)
  const reloaded = run('')
  assert.deepEqual(reloaded.groupReply, saved.groupReply)
  assert.equal(reloaded.tts_First_person, '测试称呼')
  assert.equal(JSON.parse(fs.readFileSync(file)).assistantLabel, undefined)
  assert.deepEqual(saved.groupReply.groups, [{ groupId: '100', switchOn: true }, { groupId: '200', switchOn: false }])
  assert.equal(saved.groupReply.historyCount, 20)
  assert.equal(saved.groupReply.debounceSeconds, 0)
  assert.equal(saved.groupReply.systemPrompt, '仅被点名时才回复')
  assert.equal(saved.groupReply.model, 'small-model')
  assert.equal(JSON.parse(fs.readFileSync(file)).enableBYM, undefined)
  const cleared = run(`
    await guoba.setConfigData({ 'groupReply.groups': [], 'groupReply.systemPrompt': '', 'groupReply.historyCount': '坏值', 'groupReply.debounceSeconds': null }, { Result: { ok() {} } })
  `)
  assert.deepEqual(cleared.groupReply.groups, [])
  assert.match(cleared.groupReply.systemPrompt, /QQ 群聊/)
  assert.equal(cleared.groupReply.historyCount, 50)
  assert.equal(cleared.groupReply.debounceSeconds, 10)
})
