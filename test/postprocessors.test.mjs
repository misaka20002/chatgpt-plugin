import { test } from 'node:test'
import assert from 'node:assert/strict'

// ReasonerProcessor.processInner 会调用宿主 logger，这里只补宿主边界
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, mark() {} }

const { collectProcessors } = await import('../utils/postprocessors/BasicProcessor.js')

// 回归背景：曾用纯路径 import(fullPath)，Windows 下抛 ERR_UNSUPPORTED_ESM_URL_SCHEME，
// 又被空 catch 吞掉，导致本机所有后处理器从未真正加载。修复后必须以 file:// URL 导入。
test('collectProcessors 能加载 postprocessors 目录下的后处理器（Windows 路径回归）', async () => {
  const processors = await collectProcessors('post')
  assert.ok(processors.some(processor => processor.name === 'ReasonerPostProcessor'), '应能加载到 ReasonerPostProcessor')
})

test('ReasonerProcessor 剥离思考标签：支持 <thinking> 且保留标签前正文', async () => {
  const { ReasonerProcessor } = await import('../utils/postprocessors/ReasonerProcessor.js')
  const processor = new ReasonerProcessor()
  const output = await processor.processInner({ text: 'x<think>甲</think>y<thinking>乙</thinking>z', thinking_text: '已有' })
  assert.equal(output.text, 'xyz')
  assert.equal(output.thinking_text, '已有甲\n乙')
})
