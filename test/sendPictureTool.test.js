/**
 * sendPicture 的会话边界
 *
 * 这个工具对全员开放，参数名 `targetGroupIdOrQQNumber` 既能填群号也能填 QQ 号：
 *  - 填群号且 Bot 在那个群 → `pickGroup(那个群).sendMsg`，**发到任意群**；
 *  - 填 QQ 号 → 私聊，已有 `enableToolPrivateSend` 闸。
 *
 * 群这一侧原来没有「是不是当前会话」的判断，等于任何群友都能借 Bot 往它所在的
 * 任意群投放任意图片（2026-10-28 由 tool-calls.log 实证）。这里收口到当前会话。
 *
 * 运行：npm run test:tools（或 node --test test/sendPictureTool.test.js）
 */
import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'

if (!globalThis.logger) {
  globalThis.logger = { info() {}, warn() {}, error() {}, debug() {}, mark() {}, trace() {}, log() {} }
}
globalThis.segment = {
  image: url => ({ type: 'image', data: { file: url } }),
  at: qq => ({ type: 'at', data: { qq } })
}

// 隔离配置与主人口查询：config/default_config 在 .gitignore 里，检出后不存在；
// common.js 又拖着整个运行环境。这个工具只需要「私聊开关」和「主人是谁」。
const configStub = { enableToolPrivateSend: false }
const masterStub = { master: ['999'] }
mock.module('../utils/config.js', { namedExports: { Config: configStub } })
mock.module('../utils/common.js', {
  namedExports: { getMasterQQ: async () => masterStub.master }
})

const { SendPictureTool } = await import('../utils/tools/SendPictureTool.js')

const PIC = 'https://q1.qlogo.cn/g?b=qq&nk=2105272371&s=100'

/**
 * 造事件。`sent` 记录真的发出去的东西。
 *
 * @param {object} [options]
 * @param {boolean} [options.isMaster]
 * @param {number} [options.groupId] 当前会话所在群
 * @param {number[]} [options.knownGroups] Bot 还在哪些群
 */
function makeEvent ({ isMaster = false, groupId = 70001, userId = 70002, knownGroups = [70001, 79999] } = {}) {
  const sent = []
  const makeGroup = id => ({ sendMsg: async msg => { sent.push({ to: id, msg }) } })
  const groups = new Map(knownGroups.map(id => [id, makeGroup(id)]))
  return {
    sent,
    e: {
      isGroup: true,
      isMaster,
      group_id: groupId,
      user_id: userId,
      sender: { user_id: userId },
      bot: {
        uin: 999,
        getGroupList: async () => groups,
        pickGroup: async id => groups.get(id) || makeGroup(id),
        pickUser: () => ({ asMember: () => ({ sendMsg: async () => {} }) })
      }
    }
  }
}

describe('sendPicture：群友只能发当前会话，主人可跨群', () => {
  test('普通群友不填目标：发当前群', async () => {
    const { e, sent } = makeEvent()
    const result = await new SendPictureTool().func({ urlOfPicture: PIC }, e)

    assert.doesNotMatch(result, /^Error:/)
    assert.deepEqual(sent.map(item => item.to), [e.group_id])
  })

  test('普通群友填当前群号：照常发出', async () => {
    const { e, sent } = makeEvent()
    const result = await new SendPictureTool().func({ urlOfPicture: PIC, targetGroupIdOrQQNumber: String(e.group_id) }, e)

    assert.doesNotMatch(result, /^Error:/)
    assert.deepEqual(sent.map(item => item.to), [e.group_id])
  })

  test('普通群友填别的群号：拒绝，且一条都没发', async () => {
    const { e, sent } = makeEvent({ knownGroups: [70001, 79999] })
    const result = await new SendPictureTool().func({ urlOfPicture: PIC, targetGroupIdOrQQNumber: '79999' }, e)

    assert.match(result, /^Error: /)
    assert.match(result, /master/i)
    assert.deepEqual(sent, [], '拒绝时不能往任何群发东西')
  })

  test('主人填别的群号：放行，图真的发到那个群', async () => {
    const { e, sent } = makeEvent({ isMaster: true, knownGroups: [70001, 79999] })
    const result = await new SendPictureTool().func({ urlOfPicture: PIC, targetGroupIdOrQQNumber: '79999' }, e)

    assert.doesNotMatch(result, /^Error:/)
    assert.deepEqual(sent.map(item => item.to), [79999], '主人跨群要真的发到目标群')
  })
})

describe('sendPicture：私聊分支仍受原有开关约束', () => {
  test('私聊开关关着、填他人的 QQ：拒绝', async () => {
    const origin = configStub.enableToolPrivateSend
    try {
      configStub.enableToolPrivateSend = false
      const { e } = makeEvent({ userId: 70003 })
      const result = await new SendPictureTool().func({ urlOfPicture: PIC, targetGroupIdOrQQNumber: '79998', sender: '70003' }, e)

      assert.match(result, /not allowed to pm/i)
    } finally {
      configStub.enableToolPrivateSend = origin
    }
  })
})
