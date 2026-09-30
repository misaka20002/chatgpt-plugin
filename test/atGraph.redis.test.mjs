// 协议兼容检查：node --test test/atGraph.redis.test.mjs（需本机安装 redis-server）。
// 独立 Unix socket、临时目录、禁用持久化，不连接或改写云崽正在使用的 Redis。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createClient } from 'redis'
import { MemoryStore } from '../utils/memory/store.js'

test('图谱查询通过真实 Redis 协议取得截止时间内最新记录，保留读取上限', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'at-redis-'))
  const socket = path.join(directory, 'redis.sock')
  const server = spawn('redis-server', [
    '--port', '0', '--unixsocket', socket, '--unixsocketperm', '700',
    '--save', '', '--appendonly', 'no', '--dir', directory
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let client
  let startup = ''
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`测试 Redis 启动超时：${startup}`)), 5000)
      const finish = error => {
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      server.stdout.on('data', data => {
        startup += data.toString()
        if (/ready to accept connections/i.test(startup)) finish()
      })
      server.stderr.on('data', data => { startup += data.toString() })
      server.once('error', finish)
      server.once('exit', code => finish(new Error(`测试 Redis 提前退出（${code}）：${startup}`)))
    })
    client = createClient({ socket: { path: socket, reconnectStrategy: false } })
    client.on('error', error => t.diagnostic(`测试 Redis 连接异常：${error.message}`))
    await client.connect()
    const version = (await client.info('server')).match(/^redis_version:(.+)$/m)?.[1]?.trim()
    t.diagnostic(`Redis ${version}`)
    const store = new MemoryStore(client)
    const groupId = 'compat'
    const index = `CHATGPT:MEMORY:V2:rawIdx:${groupId}`
    const raw = id => `CHATGPT:MEMORY:V2:raw:${groupId}:${id}`
    const endTime = 1790780000
    assert.deepEqual(await store.getRecentRawMessages(groupId, endTime), { rows: [], limited: false, limit: 20000 })

    await client.zAdd(index, [
      { score: endTime - 20, value: 'old' },
      { score: endTime - 10, value: 'expired' },
      { score: endTime, value: 'latest' },
      { score: endTime + 1, value: 'future' }
    ])
    for (const id of ['old', 'latest', 'future']) {
      await client.set(raw(id), JSON.stringify({ messageId: id }))
    }
    const recent = await store.getRecentRawMessages(groupId, endTime)
    assert.deepEqual(recent.rows.map(row => row.messageId), ['latest', 'old'])
    assert.equal(recent.limited, false)

    await client.del(index)
    const records = Array.from({ length: 20002 }, (_, i) => ({ score: endTime - i, value: String(i) }))
    await client.zAdd(index, records)
    // 仅在边界保存正文，验证批量读取没有越过第 20000 条；其他记录模拟 TTL 到期。
    for (const id of ['0', '19999', '20000']) await client.set(raw(id), JSON.stringify({ messageId: id }))
    const bounded = await store.getRecentRawMessages(groupId, endTime)
    assert.equal(bounded.limited, true)
    assert.deepEqual(bounded.rows.map(row => row.messageId), ['0', '19999'])
  } finally {
    try {
      if (client?.isOpen) await client.disconnect()
    } finally {
      if (server.pid && server.exitCode === null && server.signalCode === null) {
        const exited = once(server, 'exit')
        server.kill('SIGTERM')
        await exited
      }
      await rm(directory, { recursive: true, force: true })
    }
  }
})
