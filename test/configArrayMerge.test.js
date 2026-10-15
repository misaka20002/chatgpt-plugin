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

/** 子进程：只加载配置并回报 toolGroupAdminArr，不主动 save()（迁移与它触发的保存在 import 阶段完成） */
const LOAD_ONLY_SCRIPT = `
globalThis.logger = { info() {}, warn() {}, debug() {}, mark() {}, error: (...args) => console.error(...args) }
const { Config } = await import(${JSON.stringify(configModuleUrl)})
process.stdout.write(JSON.stringify(Config.getConfig().toolGroupAdminArr))
process.exit(0)
`

/**
 * 用给定 config.json 加载一次（迁移发生在 import 阶段），
 * 回报内存里的数组与文件在加载后是否被改写及改写后的内容。
 * @param {object|null} userConfig null 表示没有 config.json
 */
function loadForMigration(userConfig) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-migrate-'))
  tempDirs.push(cwd)
  const configDir = path.join(cwd, 'plugins', 'chatgpt-plugin', 'config')
  fs.mkdirSync(configDir, { recursive: true })
  const configFile = path.join(configDir, 'config.json')
  if (userConfig) fs.writeFileSync(configFile, JSON.stringify(userConfig, null, 2))
  const readFile = () => (fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : null)
  const before = readFile()
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', LOAD_ONLY_SCRIPT], { cwd, encoding: 'utf8' })
  const after = readFile()
  return {
    loaded: JSON.parse(stdout),
    written: after === null ? null : JSON.parse(after),
    fileChanged: before !== after,
  }
}

const USER_CONFIG = {
  cloudMode: 'file',
  ttsHD: true,
  focus_CloudTranscode: true,
  tts_ffmpeg_path: '/旧转码程序',
  cloudTranscode: 'https://media.example.com',

  enableAtGraph: false,
  // 比默认值短：取消勾选了大部分默认工具
  serpSourceArr: ['SerpImageTool_Baidu', 'GithubAPI'],
  // 全部取消勾选
  toolGroupAdminArr: [],
  // 删掉两个预置音色、只留一个自定义音色
  siliconflow_VoiceApi: [{ siliconflow_Voice_Model: 'm', siliconflow_Voice_ReferenceId: 'custom:1', siliconflow_Voice_ReferenceText: 't', remark: '自定义' }],
  // 嵌套对象只保存了其中一个键
  memoryGroupCapture: { groups: [{ groupId: '10001', switchOn: true }] },
  // 当前位置版本保存出来的配置都会带上这个迁移标记（saveDiff 会显式写入）。
  // 带上它才代表「该实例已经历过迁移」，下面「清空的列表保持为空」才是用户主动取消的语义——
  // 少了这一行，那份配置在迁移眼里就是「老配置」，两项新工具会被补进这个空数组。
  toolGroupAdminArrMigration: 1,
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

  test('旧语音转码配置加载与保存时移除，共用云服务地址保留', () => {
    for (const key of ['cloudMode', 'ttsHD', 'focus_CloudTranscode', 'tts_ffmpeg_path']) {
      assert.equal(Object.hasOwn(custom.loaded, key), false)
      assert.equal(Object.hasOwn(custom.written, key), false)
    }
    assert.equal(custom.loaded.cloudTranscode, USER_CONFIG.cloudTranscode)
    assert.equal(custom.written.cloudTranscode, USER_CONFIG.cloudTranscode)
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

  test('AT 图谱默认开启，用户显式关闭后加载和保存仍保留 false', () => {
    assert.equal(defaults.loaded.enableAtGraph, true)
    assert.equal(custom.loaded.enableAtGraph, false)
    assert.equal(custom.written.enableAtGraph, false)
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

/* ================= toolGroupAdminArr 的升级迁移 ================= */

describe('toolGroupAdminArr 迁移：老实例首次升级时补齐新增工具', () => {
  const ADDED = ['GroupNotice', 'GroupTodo']
  // providerConfigVersion: 1 用来隔离出本次迁移，否则提供方迁移也会触发一次保存
  const migrationConfig = arr => ({ providerConfigVersion: 1, toolGroupAdminArr: arr })

  let defaultArr
  let oldDefaultArr
  let firstRun

  before(() => {
    defaultArr = loadForMigration(null).loaded
    oldDefaultArr = defaultArr.filter(key => !ADDED.includes(key))
    firstRun = loadForMigration(migrationConfig(['EditCard', 'KickOut']))
  })

  after(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
  })

  test('前提：本次迁移要补的项确实不在旧默认值里', () => {
    assert.ok(ADDED.every(key => !oldDefaultArr.includes(key)))
  })

  test('首次加载：追加缺失项、保留用户已有顺序，并把标记一起落盘', () => {
    assert.deepEqual(firstRun.loaded, ['EditCard', 'KickOut', ...ADDED])
    assert.deepEqual(firstRun.written.toolGroupAdminArr, ['EditCard', 'KickOut', ...ADDED])
    assert.equal(firstRun.written.toolGroupAdminArrMigration, 1)
  })

  test('幂等：拿迁移后的文件再启动一次，结果不变、不写文件、不出现重复项', () => {
    const secondRun = loadForMigration(firstRun.written)
    assert.deepEqual(secondRun.loaded, firstRun.loaded)
    assert.equal(secondRun.fileChanged, false)
  })

  test('用户主动取消后不会被重新加回：只看标记，不看数组缺不缺项', () => {
    const run = loadForMigration({ providerConfigVersion: 1, toolGroupAdminArr: ['GroupTodo'], toolGroupAdminArrMigration: 1 })
    assert.deepEqual(run.loaded, ['GroupTodo'])
    assert.equal(run.fileChanged, false)
  })

  test('端到端：迁移落盘 → 用户在锅巴取消勾选 → 再启动不会被追加回来', () => {
    // 用户取消 GroupNotice：数组变了，标记不变
    const userEdited = { ...firstRun.written, toolGroupAdminArr: ['EditCard', 'GroupTodo'] }
    const run = loadForMigration(userEdited)
    assert.deepEqual(run.loaded, ['EditCard', 'GroupTodo'])
    assert.equal(run.fileChanged, false)
  })

  test('用户把数组清空时同样追加：迁移只认标记，不替用户猜意图', () => {
    const run = loadForMigration(migrationConfig([]))
    assert.deepEqual(run.loaded, ADDED)
  })

  test('从未保存过该数组：整体采用默认值（本已含两项），标记仍要落盘', () => {
    const run = loadForMigration({ providerConfigVersion: 1 })
    assert.deepEqual(run.loaded, defaultArr)
    // 数组无需追加，但进过迁移分支就得把标记写下去——否则每次启动都重判为「未迁移」，
    // 迁移的「首次更新执行一次」永远没完成
    assert.equal(run.fileChanged, true)
    assert.equal(run.written.toolGroupAdminArrMigration, 1)
    // 数组与默认值相同，差量保存本来就会略过它
    assert.equal(Object.hasOwn(run.written, 'toolGroupAdminArr'), false)
  })

  test('幂等：标记落盘后再次启动不再重入迁移分支', () => {
    const first = loadForMigration({ providerConfigVersion: 1 })
    const second = loadForMigration(first.written)
    assert.equal(second.fileChanged, false, '第二次启动不应再写文件')
    assert.deepEqual(second.loaded, defaultArr)
  })

  test('数组已含两项但缺标记（老实例已手动勾选）：不重复追加，只补标记', () => {
    const run = loadForMigration({ providerConfigVersion: 1, toolGroupAdminArr: defaultArr })
    assert.deepEqual(run.loaded, defaultArr, '不得出现重复项')
    assert.equal(run.written.toolGroupAdminArrMigration, 1)
    assert.equal(Object.hasOwn(run.written, 'toolGroupAdminArr'), false, '与默认值相同，差量保存不写这一项')
  })

  test('全新安装（无 config.json）：不创建文件，默认值已含两项', () => {
    const run = loadForMigration(null)
    assert.deepEqual(run.loaded, defaultArr)
    assert.equal(run.written, null)
  })

  test('追加后恰好等于默认值时数组也必须落盘（差量保存会整条略过，否则标记已迁移而文件里还是旧数组）', () => {
    const run = loadForMigration(migrationConfig(oldDefaultArr))
    assert.deepEqual(run.written.toolGroupAdminArr, defaultArr)
    assert.equal(run.written.toolGroupAdminArrMigration, 1)
  })
})
