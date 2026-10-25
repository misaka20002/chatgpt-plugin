/**
 * 合并转发展开（引用路径与读取工具共用）的行为测试。
 *
 * 渲染与预算是纯逻辑，拉取通过假事件注入，不需要真实 QQ 连接。
 * 只断言对外的可观察结果：渲染文本、预算标记、错误分类、事件上登记的媒体地址、工具的返回。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.logger = { info() {}, warn() {}, error() {} }

const {
  FORWARD_MAX_CHARS,
  FORWARD_MAX_NODES,
  FORWARD_MAX_NESTED_LEVELS,
  collectForwardIds,
  expandQuotedForwards,
  readForward,
  rememberForwardMediaUrls
} = await import('../utils/forwardMessage.js')
const { ViewForwardMsgTool } = await import('../utils/tools/ViewForwardMsgTool.js')
const { collectEventMediaUrls, isTrustedEventMediaUrl } = await import('../utils/quotedImage.js')

function makeEvent(nodesById = {}) {
  const calls = []
  const e = {
    calls,
    group: {
      async getForwardMsg(id) {
        calls.push(id)
        const value = nodesById[id]
        if (value === undefined) throw new Error('no such forward')
        return value
      }
    }
  }
  return e
}

function node(...segments) {
  return { sender: { nickname: '张三', user_id: '123456' }, message: segments }
}

function textNode(text) {
  return node({ type: 'text', text })
}

/* ================= 渲染 ================= */

test('渲染成 Markdown 引用块，节点带昵称与 QQ', async () => {
  const e = makeEvent({
    F1: [
      { sender: { nickname: '张三', user_id: '123456' }, message: [{ type: 'text', text: '第一行' }] },
      { sender: { card: '李四', user_id: '654321' }, message: [{ type: 'text', text: '第二行' }] }
    ]
  })
  const { text, count } = await readForward(e, 'F1')

  assert.equal(count, 2)
  assert.match(text, /^> ##### 合并转发：聊天记录（2 条）\n> ---\n/)
  assert.match(text, /> 张三\(QQ 123456\)：第一行/)
  assert.match(text, /> 李四\(QQ 654321\)：第二行/)
})

test('匿名节点与缺昵称节点都有可读标签', async () => {
  const e = makeEvent({
    F1: [
      { sender: { user_id: '111' }, message: [{ type: 'text', text: '只有QQ' }] },
      { message: [{ type: 'text', text: '什么都没有' }] }
    ]
  })
  const { text } = await readForward(e, 'F1')
  assert.match(text, /> QQ 111：只有QQ/)
  assert.match(text, /> 未知用户：什么都没有/)
})

test('多媒体段用 Markdown 给出地址，语音与文件只给占位', async () => {
  const e = makeEvent({
    F1: [node(
      { type: 'image', url: 'https://multimedia.nt.qq.com.cn/a.jpg' },
      { type: 'video', url: 'https://multimedia.nt.qq.com.cn/b.mp4' },
      { type: 'record', file: 'c.amr' },
      { type: 'file', name: '报告.pdf' }
    )]
  })
  const { text, mediaUrls } = await readForward(e, 'F1')

  assert.match(text, /!\[图片\]\(https:\/\/multimedia\.nt\.qq\.com\.cn\/a\.jpg\)/)
  assert.match(text, /\[视频\]\(https:\/\/multimedia\.nt\.qq\.com\.cn\/b\.mp4\)/)
  assert.match(text, /\[语音\]/)
  assert.match(text, /\[文件：报告\.pdf\]/)
  assert.deepEqual(mediaUrls, [
    'https://multimedia.nt.qq.com.cn/a.jpg',
    'https://multimedia.nt.qq.com.cn/b.mp4'
  ])
  assert.deepEqual(e.forwardMediaUrls, mediaUrls, '媒体地址要登记到事件上')
})

test('图片缺地址时退回占位，且不登记任何地址', async () => {
  const e = makeEvent({ F1: [node({ type: 'image', file: 'x.image' })] })
  const { text, mediaUrls } = await readForward(e, 'F1')
  assert.match(text, /\[图片\]/)
  assert.deepEqual(mediaUrls, [])
  assert.equal(e.forwardMediaUrls, undefined)
})

test('地址含括号时用尖括号包住 Markdown 目标', async () => {
  const e = makeEvent({ F1: [node({ type: 'image', url: 'https://cdn.example.com/a(1).jpg' })] })
  const { text } = await readForward(e, 'F1')
  assert.match(text, /!\[图片\]\(<https:\/\/cdn\.example\.com\/a\(1\)\.jpg>\)/)
})

test('卡片、表情、at、回复各有确定形态', async () => {
  const e = makeEvent({
    F1: [node(
      { type: 'json', data: '{"app":"x"}' },
      { type: 'face', id: '1' },
      { type: 'at', qq: '88888', name: '王五' },
      { type: 'reply', id: '9' }
    )]
  })
  const { text } = await readForward(e, 'F1')
  assert.match(text, /\[卡片消息\]\[表情\]@王五\[回复\]/)
})

test('节点文本里的换行继续带引用前缀', async () => {
  const e = makeEvent({ F1: [textNode('第一行\n第二行')] })
  const { text } = await readForward(e, 'F1')
  assert.match(text, /> 张三\(QQ 123456\)：第一行\n> 第二行/)
})

/* ================= 嵌套 ================= */

test('嵌套转发只展开一层，再深留占位', async () => {
  const e = makeEvent({
    F1: [node({ type: 'text', text: '外层' }, { type: 'forward', id: 'F2' })],
    F2: [node({ type: 'text', text: '内层' }, { type: 'forward', id: 'F3' })],
    F3: [textNode('不该被读到')]
  })
  const { text } = await readForward(e, 'F1')

  assert.equal(FORWARD_MAX_NESTED_LEVELS, 1)
  assert.match(text, /外层/)
  assert.match(text, /##### ↳ 嵌套合并转发（1 条）/)
  assert.match(text, /内层/)
  assert.match(text, /\[合并转发\]/, '第二层嵌套只留占位')
  assert.ok(!e.calls.includes('F3'), '达到层数上限后不再拉取')
})

test('互相引用的转发不会无限拉取', async () => {
  const e = makeEvent({
    F1: [node({ type: 'text', text: '一' }, { type: 'forward', id: 'F2' })],
    F2: [node({ type: 'text', text: '二' }, { type: 'forward', id: 'F1' })]
  })
  const { text } = await readForward(e, 'F1')
  assert.match(text, /二/)
  assert.deepEqual(e.calls, ['F1', 'F2'])
})

/* ================= 预算 ================= */

test(`节点数超过 ${FORWARD_MAX_NODES} 条时停止渲染并标记`, async () => {
  const nodes = Array.from({ length: FORWARD_MAX_NODES + 5 }, (_, i) => textNode(`第${i}条`))
  const e = makeEvent({ F1: nodes })
  const { text, count } = await readForward(e, 'F1')

  assert.equal(count, FORWARD_MAX_NODES)
  assert.match(text, new RegExp(`已达节点上限 ${FORWARD_MAX_NODES} 条`))
  assert.ok(!text.includes(`第${FORWARD_MAX_NODES + 4}条`))
})

test(`字符数超过 ${FORWARD_MAX_CHARS} 时截断并标记`, async () => {
  const e = makeEvent({ F1: [textNode('长'.repeat(FORWARD_MAX_CHARS + 100))] })
  const { text, truncated } = await readForward(e, 'F1')

  assert.equal(truncated, true)
  assert.equal(text.length, FORWARD_MAX_CHARS)
  assert.ok(text.endsWith('[已截断]'))
})

/* ================= 失败分类 ================= */

test('适配器不支持时给出对应错误与提示行', async () => {
  const bare = {}
  await assert.rejects(() => readForward(bare, 'F1'), err => err.code === 'unsupported')

  bare.sourceForwards = ['F1']
  assert.equal(await expandQuotedForwards(bare), '（当前适配器不支持读取合并转发）')
})

test('拉取超时按超时分类，不阻塞', async () => {
  const e = { group: { getForwardMsg: () => new Promise(() => {}) } }
  await assert.rejects(
    () => readForward(e, 'F1', { timeoutMs: 10 }),
    err => err.code === 'timeout'
  )
})

test('空转发与接口异常分开报告', async () => {
  const empty = makeEvent({ F1: [] })
  await assert.rejects(() => readForward(empty, 'F1'), err => err.code === 'empty')
  empty.sourceForwards = ['F1']
  assert.equal(await expandQuotedForwards(empty), '（引用的合并转发没有可读内容）')

  const broken = makeEvent({})
  await assert.rejects(() => readForward(broken, 'F1'), err => err.code === 'fetch')
})

test('forwardId 为空或过长时直接拒绝，不发请求', async () => {
  const e = makeEvent({})
  await assert.rejects(() => readForward(e, '   '), err => err.code === 'invalid-id')
  await assert.rejects(() => readForward(e, 'x'.repeat(300)), err => err.code === 'invalid-id')
  assert.deepEqual(e.calls, [])
})

/* ================= 引用路径 ================= */

test('没有引用转发时零接口调用、零文本', async () => {
  const e = makeEvent({})
  assert.equal(await expandQuotedForwards(e), '')
  assert.deepEqual(e.calls, [])
})

test('引用解析只收集 forward id：兼容扁平淡与 data 包裹、去重、忽略其它段', () => {
  assert.deepEqual(
    collectForwardIds([
      { type: 'text', text: '看这个' },
      { type: 'forward', id: 'F1' },
      { type: 'forward', data: { id: 'F2' } },
      { type: 'forward', id: 'F1' },
      { type: 'image', url: 'https://example.com/a.jpg' }
    ]),
    ['F1', 'F2']
  )
})

test('超时与接口失败给同一行「读取失败」提示', async () => {
  const timedOut = { group: { getForwardMsg: () => new Promise(() => {}) }, sourceForwards: ['F1'] }
  assert.equal(await expandQuotedForwards(timedOut, { timeoutMs: 10 }), '（引用的合并转发读取失败）')

  const broken = makeEvent({})
  broken.sourceForwards = ['F1']
  assert.equal(await expandQuotedForwards(broken), '（引用的合并转发读取失败）')
})

test('转发内部的 at 只渲染成文本，不置 atBot', async () => {
  const e = makeEvent({ F1: [node({ type: 'at', qq: '999', name: '机器人' })] })
  e.self_id = '999'
  e.atBot = false

  const { text } = await readForward(e, 'F1')
  assert.match(text, /@机器人/)
  assert.equal(e.atBot, false)
})

test('引用转发展开带不可信声明，并登记媒体地址', async () => {
  const e = makeEvent({
    F1: [node({ type: 'image', url: 'https://multimedia.nt.qq.com.cn/a.jpg' })]
  })
  e.sourceForwards = ['F1']
  const text = await expandQuotedForwards(e)

  assert.match(text, /^以下是引用的合并转发内容/)
  assert.match(text, /!\[图片\]/)
  assert.deepEqual(e.forwardMediaUrls, ['https://multimedia.nt.qq.com.cn/a.jpg'])
})

test('不可信声明也计入 20000 字符上限', async () => {
  const e = makeEvent({ F1: [textNode('长'.repeat(FORWARD_MAX_CHARS))] })
  e.sourceForwards = ['F1']
  const text = await expandQuotedForwards(e)

  assert.ok(text.length <= FORWARD_MAX_CHARS)
  assert.ok(text.endsWith('[已截断]'))
})

/* ================= 可信媒体地址 ================= */

test('转发媒体地址进入可信来源集合，文本里的 URL 不进入', async () => {
  const e = {}
  rememberForwardMediaUrls(e, ['https://multimedia.nt.qq.com.cn/a.jpg'])

  const collected = collectEventMediaUrls(e)
  assert.ok(collected.has('https://multimedia.nt.qq.com.cn/a.jpg'))
  assert.equal(isTrustedEventMediaUrl(e, 'https://multimedia.nt.qq.com.cn/a.jpg'), true)
  assert.equal(isTrustedEventMediaUrl(e, 'https://evil.example.com/a.jpg'), false)
})

test('Markdown 尖括号包裹的地址仍按可信来源识别', async () => {
  const e = {}
  rememberForwardMediaUrls(e, ['https://cdn.example.com/a(1).jpg'])
  assert.equal(isTrustedEventMediaUrl(e, '<https://cdn.example.com/a(1).jpg>'), true)
})

test('媒体地址去重并限制在 100 条', async () => {
  const e = {}
  const urls = Array.from({ length: 120 }, (_, i) => `https://example.com/${i}.jpg`)
  rememberForwardMediaUrls(e, urls)
  rememberForwardMediaUrls(e, urls)

  assert.equal(e.forwardMediaUrls.length, 100)
  assert.equal(new Set(e.forwardMediaUrls).size, 100)
})

/* ================= 工具 ================= */

test('工具按 id 读取，返回不可信声明与渲染结果', async () => {
  const e = makeEvent({ F1: [node({ type: 'image', url: 'https://example.com/a.jpg' })] })
  const tool = new ViewForwardMsgTool()
  const result = await tool.func({ forwardId: 'F1' }, e)

  assert.equal(tool.name, 'view_forward_msg')
  assert.match(result, /^\[Untrusted third-party data/)
  assert.match(result, /> 张三\(QQ 123456\)：!\[图片\]/)
  assert.deepEqual(e.forwardMediaUrls, ['https://example.com/a.jpg'])
})

test('工具的错误按类别返回 Error 文本', async () => {
  const tool = new ViewForwardMsgTool()
  assert.match(await tool.func({}, makeEvent({})), /^Error: forwardId is required/)
  assert.match(await tool.func({ forwardId: 'F1' }, {}), /^Error: this adapter does not support/)

  const empty = makeEvent({ F1: [] })
  assert.match(await tool.func({ forwardId: 'F1' }, empty), /^Error: the merged forward has no readable content/)

  const broken = makeEvent({})
  assert.match(await tool.func({ forwardId: 'F1' }, broken), /^Error: failed to read the merged forward/)
})
