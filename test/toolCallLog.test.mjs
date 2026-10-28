import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logToolCall, readToolCallLog } from '../utils/toolCallLog.js'

/**
 * 工具调用的落盘诊断日志。
 *
 * 要钉住的是三件事：写进的是**插件自己的**诊断文件（不是群聊日志 command.*.log）、
 * 参数落盘前脱敏、超长内容被截断。
 */

let workDir = ''
let originCwd = ''

before(() => {
  originCwd = process.cwd()
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-diag-'))
  process.chdir(workDir)
})

after(() => {
  process.chdir(originCwd)
  try {
    fs.rmSync(workDir, { recursive: true, force: true })
  } catch {}
})

function diagFile () {
  return path.join(workDir, 'data', 'chatgpt', 'diag', 'tool-calls.log')
}

describe('工具调用落盘日志', () => {
  test('写到插件自己的诊断目录，不是群聊日志', async () => {
    await logToolCall({ provider: 'API', kind: '调用', name: 'runPluginCommand', args: { query: '给他点个赞' } })
    assert.ok(fs.existsSync(diagFile()), '诊断文件应落在 data/chatgpt/diag/ 下')
    assert.ok(!fs.existsSync(path.join(workDir, 'logs')), '不应写进 logs/ 目录')
  })

  test('记录里含提供方、类型、工具名与时间', async () => {
    await logToolCall({ provider: 'Claude', kind: '返回', name: 'lookupPluginCapability', result: 'ok' })
    const text = fs.readFileSync(diagFile(), 'utf8')
    const lines = text.split('\n').filter(Boolean).map(line => JSON.parse(line))
    const last = lines.at(-1)

    assert.equal(last.provider, 'Claude')
    assert.equal(last.kind, '返回')
    assert.equal(last.name, 'lookupPluginCapability')
    assert.equal(last.result, 'ok')
    assert.ok(last.t && !Number.isNaN(Date.parse(last.t)), '应带可解析的时间戳')
  })

  test('参数落盘前脱敏', async () => {
    await logToolCall({
      provider: 'API',
      kind: '调用',
      name: 'Memory_Tool',
      args: { apiKey: 'sk-should-not-appear', content: '普通内容' }
    })
    const text = fs.readFileSync(diagFile(), 'utf8')
    assert.ok(!text.includes('sk-should-not-appear'), '密钥类参数不得原样落盘')
    assert.ok(text.includes('普通内容'), '非敏感内容应保留，便于排障')
  })

  test('超长内容被截断', async () => {
    await logToolCall({ provider: 'API', kind: '返回', name: 'big', result: 'x'.repeat(5000) })
    const text = fs.readFileSync(diagFile(), 'utf8')
    const last = JSON.parse(text.split('\n').filter(Boolean).at(-1))
    assert.ok(last.result.length < 5000, '超长结果应被截断')
    assert.match(last.result, /已截断/)
  })

  test('readToolCallLog 能读回记录', async () => {
    const text = await readToolCallLog(10)
    assert.ok(text.includes('big'), '应能读回落盘记录')
  })

  test('读不到文件时返回空串而不是抛错', async () => {
    const origin = process.cwd()
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-diag-empty-'))
    process.chdir(emptyDir)
    try {
      assert.equal(await readToolCallLog(), '')
    } finally {
      process.chdir(origin)
      fs.rmSync(emptyDir, { recursive: true, force: true })
    }
  })
})
