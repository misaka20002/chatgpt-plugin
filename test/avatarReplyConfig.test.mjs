import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

test('配置、锅巴和主人命令按 Bot/群持久化，关闭后旧授权行失效', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-config-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const file = path.join(cwd, 'plugins/chatgpt-plugin/config/config.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({
    providerConfigVersion: 1, modelProviders: { api: [], responses: [], claude: [], gemini: [] },
    avatarReply: { groups: [] }
  }))
  const url = relative => JSON.stringify(new URL(relative, import.meta.url).href)
  const run = action => JSON.parse(execFileSync(process.execPath,
    ['--experimental-test-module-mocks', '--input-type=module', '-e', [
      "import { mock } from 'node:test'",
      "import assert from 'node:assert/strict'",
      'globalThis.logger = { error: console.error, warn() {}, info() {} }',
      'mock.module(' + url('../utils/tts.js') + ', { namedExports: { speakers: [], vits_emotion_map: [] } })',
      'mock.module(' + url('../utils/tts/microsoft-azure.js') + ', { namedExports: { supportConfigurations: [] } })',
      'const { Config } = await import(' + url('../utils/config.js') + ')',
      'const { supportGuoba } = await import(' + url('../guoba.support.js') + ')',
      'const guoba = supportGuoba().configInfo',
      action,
      'process.stdout.write(JSON.stringify(await guoba.getConfigData()))',
      'process.exit(0)'
    ].join('\n')], { cwd, encoding: 'utf8', timeout: 15000 }))
  const saved = run([
    "assert.deepEqual(Config.avatarReply, { provider: 'current', expressionTransition: true, groups: [] })",
    "const providerSchema = guoba.schemas.find(s => s.field === 'avatarReply.provider')",
    "assert.equal(providerSchema.component, 'Select')",
    "assert.deepEqual(providerSchema.componentProps.options[0], { label: '跟随当前对话模型', value: 'current' })",
    "const transitionSchema = guoba.schemas.find(s => s.field === 'avatarReply.expressionTransition')",
    "assert.equal(transitionSchema.component, 'Switch')",
    "const schema = guoba.schemas.find(s => s.field === 'avatarReply.groups')",
    "assert.equal(schema.component, 'GSubForm')",
    "assert.deepEqual(schema.componentProps.schemas.map(s => s.field), ['botId', 'groupId', 'switchOn', 'avatarId', 'size', 'duration', 'fps'])",
    "await guoba.setConfigData({ 'avatarReply.expressionTransition': false, 'avatarReply.groups': [{ botId: '999', groupId: '100', switchOn: true, avatarId: '角色甲', size: '1024x1024', duration: 5, fps: 20 }, { botId: '888', groupId: '100', switchOn: false, avatarId: '角色甲' }, { botId: '999', groupId: '8888', switchOn: false, avatarId: '角色甲' }, { botId: '../999', groupId: '200', switchOn: true }] }, { Result: { ok() {}, error(m) { throw new Error(m) } } })",
    "const fs = await import('node:fs/promises'); await fs.mkdir('data/chatgpt/avatars/角色甲', { recursive: true }); await fs.writeFile('data/chatgpt/avatars/角色甲/peraravatar-plus-config.json', '{}')",
    "const options = schema.componentProps.schemas.find(s => s.field === 'avatarId').componentProps.options; await guoba.getConfigData(); assert.ok(options.some(o => o.value === '角色甲'))",
    "await fs.mkdir('data/chatgpt/avatars/角色乙', { recursive: true }); await fs.writeFile('data/chatgpt/avatars/角色乙/peraravatar-plus-config.json', '{}'); const { avatarOptions } = await import(" + url('../utils/avatar/catalog.js') + "); avatarOptions(); assert.ok(options.some(o => o.value === '角色乙'))"
  ].join('\n'))
  assert.equal(saved.avatarReply.provider, 'current')
  assert.equal(saved.avatarReply.expressionTransition, false)
  assert.deepEqual(saved.avatarReply.groups, [
    { botId: '999', groupId: '100', switchOn: true, avatarId: '角色甲', size: '1024x1024', duration: 5, fps: 20 },
    { botId: '888', groupId: '100', switchOn: false, avatarId: '角色甲', size: '512x640', duration: 3, fps: 10 },
    { botId: '999', groupId: '8888', switchOn: false, avatarId: '角色甲', size: '512x640', duration: 3, fps: 10 }])
  assert.deepEqual(run('').avatarReply, saved.avatarReply)
  const commands = run([
    'mock.module(' + url('../../../lib/plugins/plugin.js') + ', { defaultExport: class { constructor(o) { Object.assign(this, o) } } })',
    'const { avatarReplyManagement } = await import(' + url('../apps/avatarReply.js') + ')',
    'const { avatarReply } = await import(' + url('../utils/avatarReply.js') + ')',
    "avatarReply.store.load = async () => ({ pictures: [], expressions: [] })",
    "const command = new avatarReplyManagement()",
    "assert.equal(command.rule.length, 2)",
    "assert.equal(command.rule[0].permission, 'master')",
    "assert.equal(command.rule[1].permission, 'master')",
    "let replies = []; const e = { self_id: '999', group_id: '100', isGroup: true, isMaster: false, msg: '#chatgpt角色关闭', reply: async m => replies.push(m) }",
    "await command.manage(e); assert.equal(Config.avatarReply.groups[0].switchOn, true); await command.refresh(e); assert.equal(replies.length, 0)",
    "e.isMaster = true; await command.refresh(e); assert.match(replies.at(-1), /角色文件夹刷新完成/); await command.manage(e); assert.equal(Config.avatarReply.groups[0].switchOn, false)",
    "e.self_id = '888'; e.msg = '#chatgpt角色开启'; await command.manage(e)",
    "assert.equal(Config.avatarReply.groups.find(g => g.botId === '888').switchOn, true)",
    "e.self_id = '777'; e.msg = '#chatgpt角色开启'; await command.manage(e); assert.match(replies.at(-1), /请先在锅巴为本群选择角色文件夹/); assert.ok(!Config.avatarReply.groups.some(g => g.botId === '777'))",
    "e.isGroup = false; e.self_id = '777'; e.msg = '#chatgpt角色预览'; await command.manage(e); assert.match(replies.at(-1), /8888/)",
    "e.self_id = '999'; e.msg = '#chatgpt角色开启'; await command.manage(e); assert.match(replies.at(-1), /私聊角色动图已开启/); assert.equal(Config.avatarReply.groups.find(g => g.botId === '999' && g.groupId === '8888').switchOn, true)",
    "e.msg = '#chatgpt角色关闭'; await command.manage(e); assert.match(replies.at(-1), /私聊角色动图已关闭/); assert.equal(Config.avatarReply.groups.find(g => g.botId === '999' && g.groupId === '8888').switchOn, false)",
    "assert.ok(!Config.avatarReply.groups.some(g => !g.groupId))"
  ].join('\n'))
  assert.deepEqual(commands.avatarReply.groups, [
    { botId: '999', groupId: '100', switchOn: false, avatarId: '角色甲', size: '1024x1024', duration: 5, fps: 20 },
    { botId: '888', groupId: '100', switchOn: true, avatarId: '角色甲', size: '512x640', duration: 3, fps: 10 },
    { botId: '999', groupId: '8888', switchOn: false, avatarId: '角色甲', size: '512x640', duration: 3, fps: 10 }
  ])
  assert.deepEqual(run('').avatarReply, commands.avatarReply)
})
