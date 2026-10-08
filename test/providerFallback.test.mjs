import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runProviderFallback, createAttemptHistory } from '../utils/providerFallback.js'

const main = { id: 'main' }, backup = { id: 'backup' }
test('主失败重试一次再备用，下一轮重新优先主；独立任务只调用一次', async () => {
  const calls = []
  const execute = async (row, state) => {
    calls.push(row.id)
    state.requested = true
    if (row === main) throw new Error('额度不足')
    return { text: '备用回复' }
  }
  assert.equal((await runProviderFallback(main, backup, execute)).text, '备用回复')
  assert.deepEqual(calls, ['main', 'main', 'backup'])
  calls.length = 0
  await assert.rejects(runProviderFallback(main, backup, execute, { enabled: false }), /额度不足/)
  assert.deepEqual(calls, ['main'])
})

test('工具或生成输出开始后不重试；拒绝和本地校验失败不切换', async () => {
  for (const kind of ['tool', 'output', 'local', 'refusal', 'cancel']) {
    let count = 0
    await assert.rejects(runProviderFallback(main, backup, async (row, state) => {
      count++
      state.requested = kind !== 'local'
      state.irreversible = ['tool', 'output'].includes(kind)
      throw Object.assign(new Error(kind), { noRetry: ['refusal', 'cancel'].includes(kind) })
    }))
    assert.equal(count, 1, kind)
  }
  let count = 0
  assert.equal((await runProviderFallback(main, backup, async () => { count++; return { text: '拒绝', refused: true } })).refused, true)
  assert.equal(count, 1)
})

test('空回复可回退，全失败只尝试三次；历史缓冲与输入隔离', async () => {
  let count = 0
  await assert.rejects(runProviderFallback(main, backup, async (row, state) => { count++; state.requested = true; return { text: '' } }), /有效回复/)
  assert.equal(count, 3)
  const messages = [{ role: 'user', content: '问题' }, { role: 'assistant', content: '答案' }]
  const first = createAttemptHistory('gemini', messages)
  const second = createAttemptHistory('gemini', messages)
  await first.upsertMessage({ id: first.parentMessageId, text: '失败尝试' })
  assert.deepEqual((await second.getMessageById(second.parentMessageId)).parts, [{ text: '答案' }])
  assert.equal(messages[1].content, '答案')
})
