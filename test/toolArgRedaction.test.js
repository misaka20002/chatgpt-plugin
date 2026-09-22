import assert from 'node:assert'
import { test } from 'node:test'
import { redactArgsForLog, maskSecret } from '../utils/toolArgRedaction.js'

test('Memory_Tool 参数脱敏：只保留结构性字段，正文与取值替换为 [REDACTED]', () => {
  const args = {
    candidates: [
      { operation: 'add', scope: 'user', factKey: 'identity.phone', factValue: '13812345678', text: '用户的手机号是13812345678', kind: 'identity', confidence: 0.9 },
    ],
  }
  const redacted = redactArgsForLog('Memory_Tool', args)
  const serialized = JSON.stringify(redacted)

  assert.ok(!serialized.includes('13812345678'), '取值不得出现在日志/转发副本里')
  assert.ok(!serialized.includes('用户的手机号'), '正文不得出现在日志/转发副本里')
  assert.equal(redacted.candidates[0].factValue, '[REDACTED]')
  assert.equal(redacted.candidates[0].text, '[REDACTED]')
  // 结构性字段保留，便于定位是哪条槽位触发了问题
  assert.equal(redacted.candidates[0].factKey, 'identity.phone')
  assert.equal(redacted.candidates[0].operation, 'add')
  assert.equal(redacted.candidates[0].scope, 'user')
  // 原对象不得被修改（脱敏只作用于副本）
  assert.equal(args.candidates[0].factValue, '13812345678')
})

test('非白名单工具：返回浅拷贝且不改内容，避免原地修改串进转发记录', () => {
  const args = { url: 'https://example.com' }
  const copy = redactArgsForLog('web_search', args)

  assert.notEqual(copy, args, '必须是副本')
  assert.equal(copy.url, 'https://example.com')
  args.url = 'https://changed.example.com'
  assert.equal(copy.url, 'https://example.com', '原参数后续修改不得串到副本')
})

test('非对象参数原样返回', () => {
  assert.equal(redactArgsForLog('Memory_Tool', undefined), undefined)
  assert.equal(redactArgsForLog('Memory_Tool', 'raw'), 'raw')
})

test('maskSecret：凭证日志掩码保留首尾、不泄露主体', () => {
  const key = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const masked = maskSecret(key)

  assert.ok(!masked.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), '主体不得出现在掩码里')
  assert.equal(masked.slice(0, 6), key.slice(0, 6), '保留前缀便于识别厂商')
  assert.equal(masked.slice(-4), key.slice(-4), '保留后缀便于区分多把 key')
  assert.ok(masked.includes('***'))
  // 长度不足以掩码时整体打码
  assert.equal(maskSecret('short'), '*****')
  assert.equal(maskSecret('sk-1234567890'), 'sk-123***7890')
  // 空值给出明确标记，避免日志出现 "undefined"
  assert.equal(maskSecret(undefined), '[UNSET]')
  assert.equal(maskSecret(null), '[UNSET]')
  assert.equal(maskSecret('   '), '[EMPTY]')
  // 原值不应被改写（纯函数）
  assert.equal(key, 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
})
