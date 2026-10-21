import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REFUSAL_REPLIES, isModerationRefusalError, pickRefusalReply } from '../utils/refusal.js'

test('isModerationRefusalError 准确区分模型安全拒绝与普通运行时错误', () => {
  const geminiBlocked = Object.assign(new Error('模型拒绝回答：PROHIBITED_CONTENT'), {
    noRetry: true,
    refused: true,
    refusalReason: 'PROHIBITED_CONTENT'
  })
  assert.equal(isModerationRefusalError(geminiBlocked), true)
  assert.equal(isModerationRefusalError(new Error('模型拒绝回答：SAFETY')), true)
  assert.equal(isModerationRefusalError(new Error('模型拒绝回答')), true)
  assert.equal(isModerationRefusalError('模型拒绝回答：SAFETY'), true)
  assert.equal(isModerationRefusalError({ refused: true, text: '' }), true)

  assert.equal(isModerationRefusalError(new Error('API 返回的 candidates 为空')), false)
  assert.equal(isModerationRefusalError(new Error('502 Bad Gateway')), false)
  assert.equal(isModerationRefusalError('错误：模型拒绝回答：SAFETY'), false)
  assert.equal(isModerationRefusalError(null), false)
  assert.equal(isModerationRefusalError(undefined), false)
})

test('pickRefusalReply 按 tts_First_person 替换称呼且不含报错字样或英文拦截码', () => {
  for (let i = 0; i < REFUSAL_REPLIES.length; i++) {
    const ratio = (i + 0.1) / REFUSAL_REPLIES.length
    const replyHanhan = pickRefusalReply({ tts_First_person: '憨憨' }, () => ratio)
    assert.ok(replyHanhan.includes('憨憨'), `词条 ${i} 应包含替换后的称呼`)
    assert.equal(replyHanhan.includes('派蒙'), false, `词条 ${i} 不应残留派蒙`)
    assert.equal(/出现错误|PROHIBITED_CONTENT|SAFETY|Error/i.test(replyHanhan), false)
  }

  const fallbackDefault = pickRefusalReply({ tts_First_person: '   ' }, () => 0)
  assert.ok(fallbackDefault.includes('派蒙'))
  assert.equal(fallbackDefault.includes('undefined'), false)

  // 空值、缺省与字符串入参都不得产出 undefined
  for (const empty of ['', null, undefined, {}, 0]) {
    const reply = pickRefusalReply({ tts_First_person: empty }, () => 0)
    assert.ok(reply.includes('派蒙'), `tts_First_person=${String(empty)} 应回退派蒙`)
    assert.equal(reply.includes('undefined'), false)
  }
  assert.ok(pickRefusalReply(undefined, () => 0).includes('派蒙'))
  assert.ok(pickRefusalReply('憨憨', () => 0).includes('憨憨'))

  // 注入非法随机值（越界 / 非整数）时回退第一条，不抛错也不产出空串
  for (const random of [() => 1, () => 2, () => -1, () => Number.NaN]) {
    const reply = pickRefusalReply({ tts_First_person: '憨憨' }, random)
    assert.equal(reply, REFUSAL_REPLIES[0].replace(/派蒙/g, '憨憨'))
  }
})
