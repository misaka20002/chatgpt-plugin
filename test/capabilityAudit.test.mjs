import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { auditCapabilityEntries, parseAuditOutput } from '../utils/capability/audit.js'

/**
 * 审核与描述翻译（次缝）。
 *
 * 模型客户端整个被替换成假函数：不产生真实调用，也就不会烧掉真钱。
 * 要守住的是「不通过就不放行」：解析失败、请求失败、输出有问题，一律按不通过处理。
 */

const ENTRIES = [
  { plugin: '签到插件', pluginDsc: '每日签到', reg: '^#签到$', command: '#签到', hintFields: [] },
  { plugin: '签到插件', pluginDsc: '每日签到', reg: '^#打卡$', command: '#打卡', hintFields: [] }
]

function chatReturning (text) {
  return async () => ({ text })
}

describe('审核通过', () => {
  test('翻译结果写回条目，空问题清单算通过', async () => {
    const chat = async prompt => {
      const payload = JSON.parse(prompt)
      return {
        text: JSON.stringify({
          descriptions: payload.map(item => ({ i: item.i, text: `执行 ${item.reg}`, confidence: 'high' })),
          issues: []
        })
      }
    }

    const result = await auditCapabilityEntries(ENTRIES, { chat })

    assert.equal(result.approved, true)
    assert.deepEqual(result.issues, [])
    assert.equal(result.entries[0].description, '执行 ^#签到$')
    assert.equal(result.entries[0].confidence, 'high')
  })

  test('低置信度：描述留空、标记 low，交给渲染层退回插件级描述', async () => {
    const chat = async prompt => {
      const payload = JSON.parse(prompt)
      return {
        text: JSON.stringify({
          descriptions: payload.map(item => ({ i: item.i, text: '', confidence: 'low' })),
          issues: []
        })
      }
    }

    const result = await auditCapabilityEntries(ENTRIES, { chat })

    assert.equal(result.approved, true)
    assert.equal(result.entries[1].description, '')
    assert.equal(result.entries[1].confidence, 'low')
  })

  test('不改动传入的条目对象', async () => {
    const chat = chatReturning(JSON.stringify({ descriptions: [{ i: 0, text: '每日签到', confidence: 'high' }], issues: [] }))
    await auditCapabilityEntries(ENTRIES, { chat })
    assert.equal(ENTRIES[0].description, undefined)
  })
})

describe('不通过一律放行不了', () => {
  test('问题清单非空 → 不通过', async () => {
    const chat = chatReturning(JSON.stringify({ descriptions: [], issues: ['疑似包含绝对路径'] }))
    const result = await auditCapabilityEntries(ENTRIES, { chat })
    assert.equal(result.approved, false)
    assert.deepEqual(result.issues, ['疑似包含绝对路径'])
  })

  test('输出不是 JSON → 不通过，不抛异常', async () => {
    const result = await auditCapabilityEntries(ENTRIES, { chat: chatReturning('我觉得挺好的') })
    assert.equal(result.approved, false)
    assert.match(result.issues[0], /无法解析/)
  })

  test('请求失败 → 不通过，错误进问题清单', async () => {
    const result = await auditCapabilityEntries(ENTRIES, {
      chat: async () => {
        throw new Error('timeout')
      }
    })
    assert.equal(result.approved, false)
    assert.match(result.issues[0], /审核请求失败.*timeout/)
  })

  test('条目为空时直接通过，不发请求', async () => {
    let called = 0
    const result = await auditCapabilityEntries([], {
      chat: async () => {
        called++
        return { text: '' }
      }
    })
    assert.equal(result.approved, true)
    assert.equal(called, 0)
  })

  test('越界索引与非法形状被忽略，不污染结果', async () => {
    const chat = chatReturning(
      JSON.stringify({
        descriptions: [{ i: 99, text: '越界', confidence: 'high' }, { text: '缺索引' }, null],
        issues: []
      })
    )
    const result = await auditCapabilityEntries(ENTRIES, { chat })
    assert.equal(result.approved, true)
    assert.equal(result.entries[0].description, '')
  })
})

describe('并发分批', () => {
  function manyEntries (count) {
    return Array.from({ length: count }, (_, index) => ({
      plugin: '签到插件',
      pluginDsc: '每日签到',
      reg: `^#签到${index}$`,
      command: `#签到${index}`,
      hintFields: []
    }))
  }

  const echoChat = async prompt => {
    const payload = JSON.parse(prompt)
    return {
      text: JSON.stringify({
        descriptions: payload.map(item => ({ i: item.i, text: `执行 ${item.reg}`, confidence: 'high' })),
        issues: []
      })
    }
  }

  test('200 条分成 3 批，全部翻译到位且顺序不乱', async () => {
    const entries = manyEntries(200)
    const progress = []
    const result = await auditCapabilityEntries(entries, {
      chat: echoChat,
      concurrency: 3,
      onProgress: (done, total) => progress.push(`${done}/${total}`)
    })

    assert.equal(result.approved, true)
    assert.equal(result.batches, 3)
    assert.equal(result.entries.length, 200)
    // 顺序必须与输入一致：并发不改变索引映射
    assert.equal(result.entries[0].description, '执行 ^#签到0$')
    assert.equal(result.entries[199].description, '执行 ^#签到199$')
    assert.deepEqual(progress, ['1/3', '2/3', '3/3'])
  })

  test('并发度按输入收敛：1 路也照跑', async () => {
    const result = await auditCapabilityEntries(manyEntries(10), { chat: echoChat, concurrency: 1 })
    assert.equal(result.approved, true)
    assert.equal(result.batches, 1)
  })

  test('某一批请求失败不影响其余批次的翻译', async () => {
    let call = 0
    const flakyChat = async prompt => {
      call += 1
      if (call === 1) throw new Error('rate limited')
      return echoChat(prompt)
    }
    const result = await auditCapabilityEntries(manyEntries(200), { chat: flakyChat, concurrency: 1 })

    assert.equal(result.approved, false)
    assert.match(result.issues.join(' '), /rate limited/)
    // 后两批仍然翻出来了
    assert.equal(result.entries[100].description, '执行 ^#签到100$')
  })
})

describe('输出解析', () => {
  test('能从夹带说明文字的回复里抠出 JSON', () => {
    const parsed = parseAuditOutput('好的，结果如下：{"descriptions":[{"i":0,"text":"x","confidence":"high"}],"issues":[]} 以上。')
    assert.equal(parsed.descriptions.length, 1)
  })

  test('空对象与空串返回 null', () => {
    assert.equal(parseAuditOutput('{}'), null)
    assert.equal(parseAuditOutput(''), null)
    assert.equal(parseAuditOutput('   '), null)
  })

  test('只有 issues 也算有效输出', () => {
    const parsed = parseAuditOutput('{"issues":["有密钥"]}')
    assert.deepEqual(parsed.issues, ['有密钥'])
  })
})
