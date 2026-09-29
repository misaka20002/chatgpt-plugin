/**
 * 配置加载的数组合并回归测试（utils/config.js）
 *
 * 背景：加载配置曾用 `lodash.merge(defaultConfig, 用户配置)`，它把数组当成对象按下标合并——
 * 用户保存的数组比默认值短时，默认数组末尾的元素会被补回来：多选工具列表里取消勾选的默认项重启后又出现
 * （或与已选项重复，实测出现过两个 "GithubAPI"），清空的列表变回默认值。现在数组整体采用用户的值。
 *
 * 配置在 import 阶段就从 `${cwd}/plugins/chatgpt-plugin/config/config.json` 读取，所以每次加载都起一个
 * 子进程、把 cwd 指到临时目录，走真实的加载与保存代码（不 mock lodash / fs）。
 *
 * 运行：npm run test:config（或 node --test test/configArrayMerge.test.js）
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const configModuleUrl = pathToFileURL(path.resolve(here, '../utils/config.js')).href

/** 子进程：加载配置 → 往用户从没保存过的默认数组里原地 push（同 ScheduleTaskTool）→ 保存 */
const CHILD_SCRIPT = `
globalThis.logger = { info() {}, warn() {}, debug() {}, mark() {}, error: (...args) => console.error(...args) }
const { Config } = await import(${JSON.stringify(configModuleUrl)})
const cfg = Config.getConfig()
const loaded = JSON.parse(JSON.stringify(cfg))
cfg.ScheduleTask_CronTasks.push({ taskId: 'cron-1' })
const saved = Config.save()
process.stdout.write(JSON.stringify({ loaded, saved }))
process.exit(0)
`

const tempDirs = []

/**
 * 用给定的 config.json 内容加载一次配置。
 * @param {object|null} userConfig null 表示没有 config.json（纯默认值）
 * @returns {{ loaded: object, saved: boolean, written: object|null }}
 */
function loadConfigIn(userConfig) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-config-'))
  tempDirs.push(cwd)
  const configDir = path.join(cwd, 'plugins', 'chatgpt-plugin', 'config')
  fs.mkdirSync(configDir, { recursive: true })
  const configFile = path.join(configDir, 'config.json')
  if (userConfig) {
    fs.writeFileSync(configFile, JSON.stringify(userConfig, null, 2))
  }
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', CHILD_SCRIPT], { cwd, encoding: 'utf8' })
  const result = JSON.parse(stdout)
  result.written = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : null
  return result
}

const USER_CONFIG = {
  // 比默认值短：取消勾选了大部分默认工具
  serpSourceArr: ['SerpImageTool_Baidu', 'GithubAPI'],
  // 全部取消勾选
  toolGroupAdminArr: [],
  // 删掉两个预置音色、只留一个自定义音色
  siliconflow_VoiceApi: [{ siliconflow_Voice_Model: 'm', siliconflow_Voice_ReferenceId: 'custom:1', siliconflow_Voice_ReferenceText: 't', remark: '自定义' }],
  // 嵌套对象只保存了其中一个键
  memoryGroupCapture: { groups: [{ groupId: '10001', switchOn: true }] },
}

describe('配置加载：数组整体采用用户保存的值', () => {
  let defaults
  let custom

  before(() => {
    defaults = loadConfigIn(null)
    custom = loadConfigIn(USER_CONFIG)
  })

  after(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
  })

  test('前提：这些默认数组都比用户保存的长，旧的按下标合并会补回尾部', () => {
    assert.ok(defaults.loaded.serpSourceArr.length > USER_CONFIG.serpSourceArr.length)
    assert.ok(defaults.loaded.toolGroupAdminArr.length > 0)
    assert.ok(defaults.loaded.siliconflow_VoiceApi.length > USER_CONFIG.siliconflow_VoiceApi.length)
  })

  test('回归：多选工具列表比默认值短时，加载结果与保存的完全一致（取消勾选的默认项不回来、也不出现重复项）', () => {
    assert.deepEqual(custom.loaded.serpSourceArr, USER_CONFIG.serpSourceArr)
  })

  test('回归：清空的列表保持为空，不回退成默认值', () => {
    assert.deepEqual(custom.loaded.toolGroupAdminArr, [])
  })

  test('回归：对象数组同样整体采用（删掉的预置音色不回来）', () => {
    assert.deepEqual(custom.loaded.siliconflow_VoiceApi, USER_CONFIG.siliconflow_VoiceApi)
  })

  test('嵌套对象仍按键深合并：只保存了 groups 时，其余键沿用默认值', () => {
    assert.deepEqual(custom.loaded.memoryGroupCapture, { ...defaults.loaded.memoryGroupCapture, groups: USER_CONFIG.memoryGroupCapture.groups })
  })

  test('用户没保存过的数组拿到的是默认值副本：原地 push 后保存能写进 config.json（定时任务不丢）', () => {
    for (const run of [defaults, custom]) {
      assert.equal(run.saved, true)
      assert.deepEqual(run.written.ScheduleTask_CronTasks, [{ taskId: 'cron-1' }])
    }
    // 保存时用户的数组原样写回
    assert.deepEqual(custom.written.serpSourceArr, USER_CONFIG.serpSourceArr)
    assert.deepEqual(custom.written.toolGroupAdminArr, [])
  })
})
