/**
 * 本地辅助验证（随仓库入库）：`generate_html` 的 `send_html_file` 分支
 *
 * 运行：node --experimental-test-module-mocks --test test/htmlToolSend.test.mjs
 *
 * 覆盖点：
 * 1. 默认（不传参数）：只发渲染图片，不落盘、不发文件、工具结果里不提文件
 * 2. `send_html_file: true`：图片之后补发一份 `.html` 文件，内容与渲染用的是同一份清洗结果
 *    （script 已移除、路径在 data/chatgpt/htmlRender 下、显示名用清洗后的标题）
 * 3. 适配器没有 `segment.file` 时：图片照发，工具结果如实说明文件"未发送"（不谎报成功）
 * 4. 只有布尔 `true` 才算开启：字符串 `"false"` / `"true"` 都不触发（与 `new_session` 等参数同一口径）
 *
 * 说明：`render` / `SubLLM` / `resolveCurrentChatProvider` 用 mock 隔离（真实渲染需要浏览器，
 * 真实子模型需要网络），被测的是工具自身的分支与落盘逻辑；落盘写的是真实文件。
 */
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const YUNZAI_ROOT = path.resolve(HERE, '../../..')
// 依赖链会 import 主仓库的 lib/config/config.js，它按 **cwd** 读 config/default_config/
if (!fs.existsSync(path.join(process.cwd(), 'config/default_config'))) {
  if (!fs.existsSync(path.join(YUNZAI_ROOT, 'config/default_config'))) {
    console.error(`找不到云崽根目录（缺 config/default_config/）：${YUNZAI_ROOT}`)
    process.exit(1)
  }
  process.chdir(YUNZAI_ROOT)
}

globalThis.logger = {
  info () { }, warn () { }, error () { }, mark () { }, debug () { },
  green: (s) => s, red: (s) => s, yellow: (s) => s
}
globalThis.redis = { get: async () => null, set: async () => null, del: async () => null }
globalThis.Bot = {}
globalThis.Renderer = {}
globalThis.segment = {
  image: (x) => x,
  file: (localPath, name) => ({ type: 'file', path: localPath, name })
}

// 子代理返回带 script 的 HTML：用于证明"发出去的文件与渲染用的是同一份清洗结果"
const SUB_AGENT_HTML = '<div>hello</div><script>alert(1)</script>'
let renderedHtml = null

mock.module('../utils/common.js', {
  namedExports: {
    render: async (e, pluginKey, htmlPath, data) => {
      renderedHtml = data.html
      return 'IMG'
    }
  }
})
mock.module('../model/SubLLM.js', {
  namedExports: {
    SubLLM: class {
      constructor (opts) { this.opts = opts }

      async chat () { return { text: SUB_AGENT_HTML } }
    }
  }
})
mock.module('../utils/paimonFuction.js', {
  namedExports: { resolveCurrentChatProvider: async () => 'api' }
})

const { GenerateHtmlTool } = await import('../utils/tools/GenerateHtmlTool.js')

// 落盘路径按 cwd 计算，切到临时目录，避免污染真实 data/
const WORK_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlToolSend-'))
process.chdir(WORK_ROOT)

const IMAGE_SEGMENT = 'IMG'

function makeEvent () {
  const replies = []
  return {
    replies,
    e: { isMaster: true, reply: async (msg) => { replies.push(msg); return { message_id: replies.length } } }
  }
}

function fileSegments (replies) {
  return replies.filter((msg) => msg && typeof msg === 'object' && msg.type === 'file')
}

test('默认：只发图片，不落盘也不发文件', async () => {
  const { e, replies } = makeEvent()
  const note = await new GenerateHtmlTool().func({ request: '画个链路图', title: '链路图' }, e)

  assert.equal(replies.length, 1)
  assert.equal(replies[0], IMAGE_SEGMENT)
  assert.equal(fileSegments(replies).length, 0)
  assert.equal(note.includes('source file'), false)
  assert.equal(fs.existsSync(path.join(WORK_ROOT, 'data')), false)
})

test('send_html_file=true：补发一份与渲染同源的清洗后 .html', async () => {
  const { e, replies } = makeEvent()
  const note = await new GenerateHtmlTool().func(
    { request: '画个链路图', title: '链路/图 ..', send_html_file: true },
    e
  )

  assert.equal(replies.length, 2)
  const file = fileSegments(replies)[0]
  assert.ok(file, '没有发出文件段落')
  assert.equal(file.name, '链路 图.html')

  const onDisk = fs.readFileSync(file.path, 'utf8')
  assert.equal(onDisk, renderedHtml, '文件内容与交给渲染的 HTML 不是同一份')
  assert.equal(onDisk.includes('<script'), false, '发出去的文件里还留着 script')
  assert.match(path.relative(WORK_ROOT, file.path).replace(/\\/g, '/'), /^data\/chatgpt\/htmlRender\//)
  assert.match(note, /also sent to the user as an attachment/)
})

test('适配器不支持文件发送：图片照发，结果如实说明未发送', async () => {
  const { e, replies } = makeEvent()
  const saved = globalThis.segment.file
  delete globalThis.segment.file
  try {
    const note = await new GenerateHtmlTool().func({ request: '画个链路图', send_html_file: true }, e)
    assert.equal(replies.length, 1)
    assert.equal(replies[0], IMAGE_SEGMENT)
    assert.match(note, /was NOT sent/)
  } finally {
    globalThis.segment.file = saved
  }
})

test('只有布尔 true 才开启：字符串值不触发发送', async () => {
  for (const value of ['false', 'true', 1, 'yes']) {
    const { e, replies } = makeEvent()
    await new GenerateHtmlTool().func({ request: '画个链路图', send_html_file: value }, e)
    assert.equal(fileSegments(replies).length, 0, `send_html_file=${JSON.stringify(value)} 不应发送文件`)
  }
})
