// manual test: 依赖 TRSS-Yunzai 运行时（config/default_config/ 目录 + 全局 Bot/logger/redis），插件仓库独立 checkout 的 CI 环境跑不了；需在 TRSS-Yunzai 根目录手工执行：
//   node plugins/chatgpt-plugin/test/forwardMsg.test.js
// 回归目的：合并转发读取链路（信标改写 / 分层拉取 / 防环 / 截断 / 缓存 / 降级）
/**
 * 合并转发读取链路 —— 全量回归测试
 *
 * 覆盖：信标改写 / 工具参数自愈 / 多层嵌套 / 防环 / 格式与图片 / 截断 /
 * 超时重试降级 / LRU 缓存 / 纯转发事件识别
 *
 * 运行：node test/forwardMsg.test.js
 * 独立进程需要先补齐 TRSS 注入的全局对象，否则 config.js 加载即失败。
 */

import assert from 'node:assert/strict'

globalThis.Bot = { uin: [], nickname: 'bot', avatar: '', config: {} }
globalThis.logger = { info() {}, warn() {}, error() {}, mark() {}, debug() {}, trace() {} }
globalThis.redis = { get: async () => null, set: async () => 'OK', del: async () => 0, keys: async () => [] }

const { processCQMessage } = await import('../utils/paimonFuction.js')
const { readForwardMsgTree, extractForwardIdsFromEvent, resolveForwardImageLimit } = await import('../utils/forwardMsgParser.js')
const { ReadForwardMsgTool, sanitizeForwardId } = await import('../utils/tools/ReadForwardMsgTool.js')
const { Config } = await import('../utils/config.js')

let pass = 0
let fail = 0

function check(name, fn) {
  try {
    fn()
    console.log(`PASS  ${name}`)
    pass++
  } catch (err) {
    console.log(`FAIL  ${name}`)
    console.log(`      ${err?.message || err}`)
    fail++
  }
}

async function checkAsync(name, fn) {
  try {
    await fn()
    console.log(`PASS  ${name}`)
    pass++
  } catch (err) {
    console.log(`FAIL  ${name}`)
    console.log(`      ${err?.message || err}`)
    fail++
  }
}

const NOW = 1761364800 // 2026-10-25 12:00:00 +08:00
const mkNode = (name, text, extra = {}) => ({
  sender: { user_id: 123456, card: name },
  time: NOW,
  message: [
    ...(text ? [{ type: 'text', text }] : []),
    ...(extra.image ? [{ type: 'image', url: extra.image }] : []),
    ...(extra.forward ? [{ type: 'forward', id: extra.forward }] : [])
  ]
})

/** 构造一个 mock bot：用 map 模拟不同 id 返回不同消息层 */
function mockBot(map, counter) {
  return {
    sendApi: async (api, params) => {
      if (counter) counter.calls++
      const id = params?.message_id ?? params?.id
      const layer = map[id]
      if (typeof layer === 'function') return layer()
      if (!layer) throw new Error('forward not found: ' + id)
      return { data: { messages: layer } }
    }
  }
}

// ============ 测试 1：信标保留 / 反转义 / at 剔除 ============
check('T1-a 纯转发信标保留', () => {
  assert.equal(processCQMessage('[CQ:forward,id=BEACON1]', '999'), '<合并转发:id=BEACON1>')
})

check('T1-b at 被剔除且不误伤信标与周围文本', () => {
  const out = processCQMessage('[CQ:at,qq=999]//bot/[CQ:forward,id=B2]尾巴', '999')
  assert.equal(out, '//bot/<合并转发:id=B2>尾巴')
})

check('T1-c CQ 参数里的 &amp; 反转义', () => {
  const out = processCQMessage('[CQ:forward,id=a&amp;b]', '999')
  assert.equal(out, '<合并转发:id=a&b>')
})

check('T1-d 其他 CQ 码仍被清除', () => {
  assert.equal(processCQMessage('[CQ:image,file=x.jpg][CQ:forward,id=B3]看', '999'), '<合并转发:id=B3>看')
})

// ============ 测试 2：工具参数自愈 ============
check('T2-a 完整信标', () => assert.equal(sanitizeForwardId('<合并转发:id=xyz>'), 'xyz'))
check('T2-b forward: 前缀', () => assert.equal(sanitizeForwardId('forward:xyz'), 'xyz'))
check('T2-c 空值', () => {
  assert.equal(sanitizeForwardId(''), '')
  assert.equal(sanitizeForwardId(null), '')
  assert.equal(sanitizeForwardId(undefined), '')
})
await checkAsync('T2-d 超长字符串被拒', async () => {
  const tool = new ReadForwardMsgTool()
  const longId = 'x'.repeat(300)
  const out = await tool.func({ forward_id: longId, recognize_images: false }, { bot: mockBot({}) })
  assert.ok(out.includes('读取合并转发失败') || out.includes('格式无法识别'), out)
})

// ============ 测试 3：4 层嵌套，只展开前 3 层 ============
await checkAsync('T3 4层嵌套仅展开3层并给出上限提示', async () => {
  const map = {
    F1: [mkNode('第一层', '这是第一层', { forward: 'F2' })],
    F2: [mkNode('第二层', '这是第二层', { forward: 'F3' })],
    F3: [mkNode('第三层', '这是第三层', { forward: 'F4' })],
    F4: [mkNode('第四层', '这是第四层不该出现')]
  }
  const r = await readForwardMsgTree({ bot: mockBot(map) }, 'F1', { maxDepth: 3, recognizeImages: false })
  assert.equal(r.ok, true, r.error)
  assert.ok(r.text.includes('[L1] 【第一层】'), '缺 L1')
  assert.ok(r.text.includes('[L2] 【第二层】'), '缺 L2')
  assert.ok(r.text.includes('[L3] 【第三层】'), '缺 L3')
  assert.equal(r.text.includes('第四层不该出现'), false, '第4层内容不应展开')
  assert.match(r.text, /已达3层上限/)
})

// ============ 测试 4：循环套娃 F1 -> F2 -> F1 ============
await checkAsync('T4 循环引用不死循环', async () => {
  const map = {
    C1: [mkNode('循环A', 'A的内容', { forward: 'C2' })],
    C2: [mkNode('循环B', 'B的内容', { forward: 'C1' })]
  }
  const r = await readForwardMsgTree({ bot: mockBot(map) }, 'C1', { maxDepth: 3, recognizeImages: false })
  assert.equal(r.ok, true, r.error)
  assert.ok(r.totalNodes <= 3, `节点数异常: ${r.totalNodes}`)
  assert.ok(r.text.includes('A的内容'))
})

// ============ 测试 5：颗粒度与图片上限 ============
await checkAsync('T5 昵称/QQ/时间/正文齐全且图片受4张限制', async () => {
  const imgs = Array.from({ length: 6 }, (_, i) => `https://cdn.example.com/${i}.png`)
  const nodes = [
    {
      sender: { user_id: 88889999, card: '测试用户' },
      time: NOW,
      message: [{ type: 'text', text: '图片合集' }, ...imgs.map((url) => ({ type: 'image', url }))]
    }
  ]
  const r = await readForwardMsgTree({ bot: mockBot({ P1: nodes }) }, 'P1', { maxDepth: 3, recognizeImages: false })
  assert.equal(r.ok, true, r.error)
  assert.match(r.text, /\[L1\] 【测试用户】（qq：88889999，时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}） 说：/)
  assert.ok(r.text.includes('图片合集'))
  assert.ok(r.text.includes('[图片: https://cdn.example.com/0.png]'))
  assert.equal(r.imageUrls.length, 4, `图片应限制为4张，实际 ${r.imageUrls.length}`)
})

// ============ 测试 6：80 条截断到 60 ============
await checkAsync('T6 80条消息在60条处截断并附统计后缀', async () => {
  const many = Array.from({ length: 80 }, (_, i) => mkNode('用户' + i, '第' + i + '条消息'))
  const r = await readForwardMsgTree({ bot: mockBot({ T80: many }) }, 'T80', { maxDepth: 3, recognizeImages: false })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.totalNodes, 60, `应为60条，实际 ${r.totalNodes}`)
  assert.equal(r.truncated, true)
  assert.ok(r.text.includes('...[合并转发内容过长，已截断，共 60 条消息]'), r.text.slice(-60))
})

// ============ 测试 7：重试与全失败兜底 ============
await checkAsync('T7-a 首轮失败后重试成功', async () => {
  let calls = 0
  const bot = {
    sendApi: async () => {
      calls++
      // 前 4 次（第一轮的 4 种调用方式）全部失败，第 5 次进入第二轮后成功
      if (calls <= 4) throw new Error('network hiccup')
      return { data: { messages: [mkNode('重试成功', '终于拿到了')] } }
    }
  }
  const r = await readForwardMsgTree({ bot }, 'R1', { maxDepth: 3, recognizeImages: false })
  assert.equal(r.ok, true, r.error)
  assert.ok(r.text.includes('终于拿到了'))
  assert.ok(calls >= 5, `应触发重试，实际调用 ${calls} 次`)
})

await checkAsync('T7-b 全部失败时安全兜底不抛异常', async () => {
  const bot = { sendApi: async () => { throw new Error('always down') } }
  const r = await readForwardMsgTree({ bot }, 'R2', { maxDepth: 3, recognizeImages: false })
  assert.equal(r.ok, false)
  assert.ok(r.fallbackText.includes('内容拉取失败'))
  assert.equal(typeof r.error, 'string')
})

// ============ 测试 8：LRU 缓存命中 ============
await checkAsync('T8 同ID重复读取只打一次底层接口', async () => {
  const counter = { calls: 0 }
  const e = { bot: mockBot({ L1: [mkNode('缓存', '只该拉一次')] }, counter) }

  const first = await readForwardMsgTree(e, 'L1', { maxDepth: 3, recognizeImages: false })
  const callsAfterFirst = counter.calls
  const second = await readForwardMsgTree(e, 'L1', { maxDepth: 3, recognizeImages: false })

  assert.equal(first.fromCache, false)
  assert.equal(second.fromCache, true, '第二次应命中缓存')
  assert.equal(counter.calls, callsAfterFirst, '缓存命中后不应再调接口')
  assert.equal(callsAfterFirst, 1, `首次应只调 1 次，实际 ${callsAfterFirst}`)
})

// ============ 测试 9：纯转发事件识别 ============
check('T9-a e.msg 为空但 message 含 forward 段', () => {
  const ids = extractForwardIdsFromEvent({ msg: '', message: [{ type: 'forward', id: 'PURE1' }] })
  assert.deepEqual(ids, ['PURE1'])
})

check('T9-b 纯转发 + CQ 兜底 + 去重', () => {
  const ids = extractForwardIdsFromEvent({
    msg: '',
    message: [{ type: 'forward', id: 'PURE1' }],
    raw_message: '[CQ:forward,id=PURE1]'
  })
  assert.deepEqual(ids, ['PURE1'])
})

check('T9-c 普通消息不误判', () => {
  assert.deepEqual(extractForwardIdsFromEvent({ msg: '你好', message: [{ type: 'text', text: '你好' }] }), [])
})

// ============ 测试 10：展开层数如实上报（回归：曾恒等于配置值） ============
await checkAsync('T10-a 单层转发报告 1/3', async () => {
  const r = await readForwardMsgTree({ bot: mockBot({ S1: [mkNode('单人', '只有一层')] }) }, 'S1', {
    maxDepth: 3,
    recognizeImages: false
  })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.depth, 1, `单层转发应报告 1，实际 ${r.depth}`)
})

await checkAsync('T10-b 两层嵌套报告 2/3', async () => {
  const map = {
    D1: [mkNode('外', '外层', { forward: 'D2' })],
    D2: [mkNode('内', '内层')]
  }
  const r = await readForwardMsgTree({ bot: mockBot(map) }, 'D1', { maxDepth: 3, recognizeImages: false })
  assert.equal(r.depth, 2, `两层嵌套应报告 2，实际 ${r.depth}`)
})

await checkAsync('T10-c 工具输出使用实际层数', async () => {
  const tool = new ReadForwardMsgTool()
  const out = await tool.func({ forward_id: 'S2', recognize_images: false }, {
    bot: mockBot({ S2: [mkNode('单', '单层')] })
  })
  assert.ok(out.includes('展开层数: 1/3'), out.slice(0, 100))
})

// ============ 测试 11：图片上限 0 不被 || 吞掉 ============
check('T11 forwardMaxImages=0 时保留 0 而非回落 4', () => {
  const original = Config.forwardMaxImages
  Config.forwardMaxImages = 0
  const limit = resolveForwardImageLimit()
  Config.forwardMaxImages = original
  assert.equal(limit, 0, '0 有业务语义（不取图），不能被 || 吞成 4')
})

// ============ 汇总 ============
console.log('')
console.log(`总计 ${pass + fail} 项：PASS ${pass} / FAIL ${fail}`)
if (fail > 0) process.exit(1)
