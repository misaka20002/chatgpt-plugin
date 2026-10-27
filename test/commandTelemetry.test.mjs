import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { hasRegisteredMatch, isCommandLike } from '../utils/commandMap/telemetry.js'

/**
 * 命令埋点（临时功能）。
 *
 * 这里只测判定逻辑，不测落盘——写文件的行为由端到端观察，避免测试往 data/ 里拉屎。
 * 两个关键点：像不像指令、以及「有没有插件能接住」必须排除我们自己的全匹配观察器。
 */

describe('像不像指令', () => {
  test('井号、全角井号、斜杠开头的才算', () => {
    assert.equal(isCommandLike('#签到'), true)
    assert.equal(isCommandLike('＃签到'), true)
    assert.equal(isCommandLike('/签到'), true)
  })

  test('普通聊天、单 # 号不算', () => {
    assert.equal(isCommandLike('今天天气怎么样'), false)
    assert.equal(isCommandLike('#'), false)
    assert.equal(isCommandLike('  '), false)
    assert.equal(isCommandLike(null), false)
  })
})

describe('有没有插件接得住', () => {
  const loader = {
    priority: [
      { key: 'sign', plugin: { rule: [{ reg: /^#签到$/ }] } },
      { key: 'apps/commandMissObserver.js', plugin: { rule: [{ reg: /[\s\S]*/ }] } }
    ]
  }

  test('注册表里有匹配就算接住', () => {
    assert.equal(hasRegisteredMatch(loader, '#签到'), true)
  })

  test('没有任何规则匹配时判定为没接住', () => {
    assert.equal(hasRegisteredMatch(loader, '#签个到'), false)
  })

  test('自己的全匹配观察器不算「接住」', () => {
    // 只剩观察器时，任何指令都算没接住
    const onlySelf = { priority: [loader.priority[1]] }
    assert.equal(hasRegisteredMatch(onlySelf, '#签到'), false)
  })

  test('没有注册表时保守返回 false，由调用方跳过记录', () => {
    assert.equal(hasRegisteredMatch(null, '#签到'), false)
  })

  test('坏正则不影响其余规则', () => {
    const broken = { priority: [{ key: 'x', plugin: { rule: [{ reg: '([' }, { reg: /^#签到$/ }] } }] }
    assert.equal(hasRegisteredMatch(broken, '#签到'), true)
  })
})
