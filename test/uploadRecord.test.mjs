import { test } from 'node:test'
import assert from 'node:assert/strict'
import uploadRecord from '../utils/uploadRecord.js'

test('音频交给适配器处理，保留 URL、本地路径和二进制输入', async (t) => {
  const originalSegment = globalThis.segment
  t.after(() => { globalThis.segment = originalSegment })
  const inputs = [
    'https://example.com/voice.wav',
    '/tmp/voice.wav',
    'base64://UklGRg==',
    Buffer.from('RIFF原始音频')
  ]
  for (const input of inputs) {
    const record = { type: 'record', data: { file: input } }
    let calls = 0
    globalThis.segment = {
      record(file) {
        calls++
        assert.strictEqual(file, input)
        return record
      }
    }
    assert.strictEqual(await uploadRecord(input), record)
    assert.equal(calls, 1)
  }
})

test('适配器构造语音失败时保留原始异常', async (t) => {
  const originalSegment = globalThis.segment
  t.after(() => { globalThis.segment = originalSegment })
  const error = new Error('适配器拒绝音频')
  globalThis.segment = { record() { throw error } }
  await assert.rejects(uploadRecord('/tmp/voice.wav'), err => err === error)
})
