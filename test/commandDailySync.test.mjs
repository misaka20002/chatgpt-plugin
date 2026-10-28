import { test, describe, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 每日地图检查（工具缝：假 fetch + 假 pull）。
 *
 * 要守住的是成本控制本身：云端版本号没变大就一个补丁都不许下；
 * 只同步本机装了的插件；有失败就不能把版本号记成新的（否则漏掉的补丁永远不重试）。
 */

const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdmap-daily-'))
const CAPABILITY_DIR = path.join(WORKSPACE, 'data', 'chatgpt', 'capability')
const REVISION_FILE = path.join(WORKSPACE, 'data', 'chatgpt', 'commandMaps', '.revision')
const INDEX_URL = 'https://raw.example.com/command-maps/main/index.json'

// 能力表按 cwd 定位，且 store 有进程内缓存：整个文件共用一个工作目录，只写一次
fs.mkdirSync(CAPABILITY_DIR, { recursive: true })
fs.writeFileSync(
  path.join(CAPABILITY_DIR, 'feature-form.meta.json'),
  JSON.stringify({ entries: [{ pluginKey: 'delta' }, { pluginKey: 'yenai' }] }),
  'utf8'
)
fs.writeFileSync(path.join(CAPABILITY_DIR, 'feature-form.md'), '# 能力表\n', 'utf8')
process.chdir(WORKSPACE)

// 真实 config.js 会拉 lodash（宿主才有），这里注入一份够用的假配置
const config = { enableCapabilityMap: true, commandMapIndexUrl: INDEX_URL }
mock.module('../utils/config.js', { namedExports: { Config: config } })

const { dailyMapSync } = await import('../utils/commandMap/dailySync.js')
const { readLocalRevision } = await import('../utils/commandMap/mapStore.js')
const { readIndex } = await import('../utils/commandMap/sync.js')

function indexText (revision) {
  return JSON.stringify({
    schema: 1,
    revision,
    plugins: {
      delta: { file: 'maps/delta.json', fingerprint: 'aaa', sha256: 'h1' },
      yenai: { file: 'maps/yenai.json', fingerprint: 'bbb', sha256: 'h2' },
      // 本机没装的插件：不应该被下载
      unknown: { file: 'maps/unknown.json', fingerprint: 'ccc', sha256: 'h3' }
    }
  })
}

function fakeFetch (text) {
  return async url => ({ ok: true, url, headers: { get: () => null }, text: async () => text })
}

function writeRevision (value) {
  fs.mkdirSync(path.dirname(REVISION_FILE), { recursive: true })
  fs.writeFileSync(REVISION_FILE, `${value}\n`, 'utf8')
}

function recorder () {
  const pulled = []
  const pull = async target => {
    pulled.push(target.pluginKey)
    return { source: 'test' }
  }
  return { pulled, pull }
}

beforeEach(() => {
  config.enableCapabilityMap = true
  config.commandMapIndexUrl = INDEX_URL
  fs.rmSync(path.dirname(REVISION_FILE), { recursive: true, force: true })
})

describe('readIndex：索引结构', () => {
  test('schema 不是 1 就拒绝', async () => {
    const text = JSON.stringify({ schema: 2, revision: 1, plugins: {} })
    await assert.rejects(() => readIndex({ indexUrl: INDEX_URL, fetchImpl: fakeFetch(text) }), /索引结构不合法/)
  })

  test('不是 JSON 就拒绝', async () => {
    await assert.rejects(() => readIndex({ indexUrl: INDEX_URL, fetchImpl: fakeFetch('<html>') }), /不是 JSON/)
  })
})

describe('dailyMapSync：开关与版本号', () => {
  test('能力地图关着就直接跳过（没有开关，跟着总开关走）', async () => {
    config.enableCapabilityMap = false
    const result = await dailyMapSync({ fetchImpl: fakeFetch(indexText(9)) })
    assert.equal(result.skipped, 'capability-off')
  })

  test('云端版本号没变大时不下任何补丁', async () => {
    writeRevision(7)
    const { pulled, pull } = recorder()
    const result = await dailyMapSync({ fetchImpl: fakeFetch(indexText(7)), pull })
    assert.equal(result.skipped, 'up-to-date')
    assert.deepEqual(pulled, [])
  })

  test('云端版本号变大才下载，且只下本机装了的插件', async () => {
    writeRevision(7)
    const { pulled, pull } = recorder()
    const sent = []
    const result = await dailyMapSync({
      fetchImpl: fakeFetch(indexText(8)),
      pull,
      notify: text => sent.push(text)
    })

    assert.equal(result.updated, 2)
    assert.deepEqual(pulled.sort(), ['delta', 'yenai'])
    assert.equal(readLocalRevision(), 8)
    assert.equal(sent.length, 1)
    assert.match(sent[0], /版本 8/)
  })

  test('有补丁失败时不记新版本号，留给明天重试', async () => {
    writeRevision(7)
    const pull = async target => {
      if (target.pluginKey === 'yenai') throw new Error('镜像都不通')
      return { source: 'test' }
    }
    const result = await dailyMapSync({ fetchImpl: fakeFetch(indexText(8)), pull, notify: () => {} })

    assert.equal(result.failed, 1)
    assert.equal(readLocalRevision(), 7)
  })
})
