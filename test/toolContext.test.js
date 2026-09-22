/**
 * 工具可信上下文（授权）回归测试
 *
 * 背景：`model/core.js` 的 OpenAI 分支曾把模型参数写在后面——
 *   `Object.assign({ isAdmin, sender }, args)`
 * 而 `args` 是模型的 tool_calls.arguments（不可信）。于是模型输出
 * `{"qq":"...","isAdmin":true}` 就能覆盖服务端算出的 isAdmin，
 * `KickOutTool` / `JinyanTool` / `EditCardTool` / `SetTitleTool` 全部放行 = 授权绕过。
 *
 * 现在统一走 `mergeTrustedToolArgs(args, trusted)`（可信值在后覆盖）。
 * 本文件既测这个合并语义，也用真实工具跑一遍端到端，确认绕过路径被封死。
 *
 * 运行：npm run test:tools
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')

const { mergeTrustedToolArgs } = await import('../utils/tools/AbstractTool.js')
const { KickOutTool } = await import('../utils/tools/KickOutTool.js')

/* ================= 合并语义 ================= */

describe('mergeTrustedToolArgs', () => {
  test('模型伪造的 isAdmin 不能覆盖服务端值', () => {
    const merged = mergeTrustedToolArgs({ isAdmin: true }, { isAdmin: false, sender: '10001' })
    assert.equal(merged.isAdmin, false)
  })

  test('模型伪造的 sender 不能覆盖服务端值', () => {
    const merged = mergeTrustedToolArgs({ sender: '88888' }, { isAdmin: false, sender: '10001' })
    assert.equal(merged.sender, '10001')
  })

  test('模型提供的普通业务参数完整保留', () => {
    const merged = mergeTrustedToolArgs(
      { qq: '88888', groupId: '20001', isPunish: 'true' },
      { isAdmin: false, sender: '10001' }
    )
    assert.deepEqual(merged, { qq: '88888', groupId: '20001', isPunish: 'true', isAdmin: false, sender: '10001' })
  })

  test('不修改入参对象（避免污染用于转发展示的 args 快照）', () => {
    const args = { isAdmin: true, qq: '1' }
    const trusted = { isAdmin: false }
    mergeTrustedToolArgs(args, trusted)
    assert.equal(args.isAdmin, true)
    assert.equal(trusted.isAdmin, false)
  })
})

/* ================= 端到端：授权绕过 ================= */

describe('KickOutTool 授权边界（端到端）', () => {
  /** 记录真实发生的踢人调用 */
  function makeEvent({ userId = '10001' } = {}) {
    const kicked = []
    return {
      kicked,
      e: {
        sender: { user_id: userId },
        group_id: '20001',
        bot: {
          pickGroup: async () => ({
            kickMember: async qq => { kicked.push(String(qq)) },
          }),
        },
      },
    }
  }

  test('非管理员伪造 isAdmin + sender，无法踢出他人', async () => {
    const { kicked, e } = makeEvent({ userId: '10001' })
    // 模拟模型被注入后输出的参数：既伪造 isAdmin，又把 sender 伪造成受害者
    const modelArgs = { qq: '88888', groupId: '20001', isAdmin: true, sender: '88888' }
    const result = await new KickOutTool().func(
      mergeTrustedToolArgs(modelArgs, { isAdmin: false, sender: '10001' }),
      e
    )
    assert.match(result, /cannot kickout other people/)
    assert.deepEqual(kicked, [], '不得真的调用踢人接口')
  })

  test('对照：直接传未合并的模型参数时，绕过是成立的（说明该测试确实约束了合并方向）', async () => {
    // 这一条钉住"为什么必须修合并顺序"：把模型参数原样交给工具，鉴权就被绕过。
    const { kicked, e } = makeEvent({ userId: '10001' })
    const modelArgs = { qq: '88888', groupId: '20001', isAdmin: true, sender: '88888' }
    const result = await new KickOutTool().func(modelArgs, e)
    assert.doesNotMatch(result, /cannot kickout/)
    assert.deepEqual(kicked, ['88888'])
  })

  test('真实管理员的正常路径不受影响', async () => {
    const { kicked, e } = makeEvent({ userId: '10001' })
    const modelArgs = { qq: '88888', groupId: '20001' }
    const result = await new KickOutTool().func(
      mergeTrustedToolArgs(modelArgs, { isAdmin: true, sender: '10001' }),
      e
    )
    assert.match(result, /has been kicked out/)
    assert.deepEqual(kicked, ['88888'])
  })
})

/* ================= 源码级守卫 ================= */

describe('core.js 不得回退到不安全的合并顺序', () => {
  const source = fs.readFileSync(path.join(pluginRoot, 'model/core.js'), 'utf8')

  // core.js 依赖全局 logger/redis 与大量插件模块，无法在测试里 import，
  // 因此这里对源码做文本守卫：这个 bug 复现一次就是授权绕过，值得用守卫钉住。
  test('两个执行点都使用 mergeTrustedToolArgs', () => {
    const occurrences = source.match(/mergeTrustedToolArgs\(/g) || []
    assert.ok(occurrences.length >= 2, `期望至少 2 处（Chat Completions + Responses），实际 ${occurrences.length}`)
  })

  test('不再出现 Object.assign({ isAdmin, sender }, args) 这种反向合并', () => {
    assert.doesNotMatch(source, /Object\.assign\(\s*\{\s*isAdmin\s*,\s*sender\s*\}\s*,\s*args\s*\)/)
  })
})
