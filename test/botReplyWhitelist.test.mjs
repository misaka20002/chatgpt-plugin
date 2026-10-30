/**
 * Bot 响应白名单
 *
 * 闸（utils/botReplyWhitelist.js）：空列表 = 全部放行（老配置升级后无感）；非空 = 只放行命中的账号；
 * 取不到账号身份时 fail-open——拦下来会让整个插件对所有消息静默，代价高于多号抢答。
 *
 * 锅巴候选（guoba.support.js）：只列真正的账号，不把宿主与第三方插件写进 Bot 的键当账号。
 *
 * 配置只在内存里替换，不落盘：Config.getConfig() 返回的就是运行中的那个对象。
 * 候选那条要走子进程：guoba.support.js 需要 mock 掉 tts 依赖，且配置从 cwd 读取。
 *
 * 运行：npm run test:config（或 node --test test/botReplyWhitelist.test.mjs）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const logs = []
globalThis.logger = {
  info: (...args) => logs.push(args.join(' ')),
  mark() {},
  warn() {},
  debug() {},
  error() {}
}
globalThis.redis = { get: async () => null }

const { Config } = await import('../utils/config.js')
const { eventBotId, isBotReplyAllowed } = await import('../utils/botReplyWhitelist.js')

function withWhitelist(list, run) {
  const config = Config.getConfig()
  const original = config.botReplyWhitelist
  config.botReplyWhitelist = list
  try {
    return run()
  } finally {
    config.botReplyWhitelist = original
  }
}

const groupEvent = fields => ({ isGroup: true, group_id: 10001, ...fields })

test('空列表表示未启用：所有账号都放行，且不写日志', () => {
  logs.length = 0
  withWhitelist([], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 111 })), true)
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 })), true)
  })
  assert.deepEqual(logs, [])
})

test('命中的账号放行', () => {
  logs.length = 0
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 111 }), { label: '对话' }), true)
  })
  assert.deepEqual(logs, [])
})

test('配置里存成数字也照样命中（手工改过 config.json 的情况）', () => {
  withWhitelist([111], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 111 })), true)
  })
})

test('未命中的账号被拦下，并留下带账号的日志', () => {
  logs.length = 0
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 }), { label: '对话' }), false)
  })
  assert.equal(logs.length, 1)
  assert.match(logs[0], /^\[ChatGPT\]\[Bot响应白名单\]/)
  assert.match(logs[0], /222/)
})

test('self_id 缺失时退到 bot.uin 判定', () => {
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ bot: { uin: 111 } })), true)
    assert.equal(isBotReplyAllowed(groupEvent({ bot: { uin: 222 } })), false)
  })
})

test('取不到账号身份时放行（fail-open），并留一条带前缀的线索', () => {
  logs.length = 0
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({})), true)
  })
  assert.equal(logs.length, 1)
  assert.match(logs[0], /^\[ChatGPT\]\[Bot响应白名单\]/)
})

test('silent 不写日志：自主回复的准入对每条群消息都会跑', () => {
  logs.length = 0
  withWhitelist(['111'], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 }), { silent: true }), false)
    assert.equal(isBotReplyAllowed(groupEvent({}), { silent: true }), true)
  })
  assert.deepEqual(logs, [])
})

test('只有空白条目的列表按未启用处理，不会把全插件静默掉', () => {
  withWhitelist(['', '   '], () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 })), true)
  })
})

test('非数组（手工改坏的配置）按未启用处理', () => {
  withWhitelist('111', () => {
    assert.equal(isBotReplyAllowed(groupEvent({ self_id: 222 })), true)
  })
})

test('eventBotId 优先 self_id，其次 bot.uin，都没有时为空串', () => {
  assert.equal(eventBotId({ self_id: 111, bot: { uin: 222 } }), '111')
  assert.equal(eventBotId({ bot: { uin: 222 } }), '222')
  assert.equal(eventBotId({}), '')
})

test('锅巴候选只列真正的账号：宿主与第三方插件写进 Bot 的键不算账号', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-whitelist-candidates-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const file = path.join(cwd, 'plugins/chatgpt-plugin/config/config.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({
    providerConfigVersion: 1,
    modelProviders: { api: [], responses: [], claude: [], gemini: [] },
    // 已登录账号也在名单里（去重）、一个离线账号、一个空白项
    botReplyWhitelist: ['3654696278', '离线账号', '  ']
  }))

  const url = relative => JSON.stringify(new URL(relative, import.meta.url).href)
  const output = execFileSync(process.execPath,
    ['--experimental-test-module-mocks', '--input-type=module', '-e', [
      "import { mock } from 'node:test'",
      'globalThis.logger = { mark() {}, debug() {}, info() {}, warn() {}, error: console.error }',
      'mock.module(' + url('../utils/tts.js') + ', { namedExports: { speakers: [], vits_emotion_map: [] } })',
      'mock.module(' + url('../utils/tts/microsoft-azure.js') + ', { namedExports: { supportConfigurations: [] } })',
      // 宿主的 uin 是带自定义 toJSON / toString / includes 的数组，遍历时不能把它们当账号
      "const uin = Object.assign(['3654696278', 'stdin'], { toJSON() { return '3654696278' }, toString() { return '3654696278' }, includes(v) { return this.some(i => i == v) } })",
      // bots 里混着宿主与第三方插件写进去的键：Bot 是无 set 陷阱的代理，任何 Bot.xxx = … 都落在这里
      "globalThis.Bot = { uin, bots: { '3654696278': { info: { nickname: '小派蒙' }, adapter: { name: 'OneBotv11' } }, stdin: { adapter: { name: '标准输入' } }, url: 'http://localhost:2536', _events: {}, _eventsCount: 1, xiaofei_plugin: {} } }",
      'const { supportGuoba } = await import(' + url('../guoba.support.js') + ')',
      "const options = () => supportGuoba().configInfo.schemas.find(s => s.field === 'botReplyWhitelist').componentProps.options",
      'const trss = options()',
      // 原版 Yunzai v3：uin 是标量、没有 bots
      'globalThis.Bot = { uin: 12345678 }',
      'const v3 = options()',
      'process.stdout.write(JSON.stringify({ trss, v3 }))',
      'process.exit(0)'
    ].join('\n')], { cwd, encoding: 'utf8', timeout: 15000 })

  const { trss, v3 } = JSON.parse(output)
  // 名单里重复的已登录账号被去重、空白项被丢弃，离线账号补在最后
  assert.deepEqual(trss, [
    { label: '3654696278（小派蒙｜OneBotv11）', value: '3654696278' },
    { label: 'stdin（标准输入）', value: 'stdin' },
    { label: '离线账号（当前未登录）', value: '离线账号' }
  ])
  // v3 下候选退化成 uin 那一个，已保存的账号按「未登录」补上
  assert.deepEqual(v3.map(o => o.value), ['12345678', '3654696278', '离线账号'])
})
