/**
 * webContent 单元测试
 *
 * 三个网页读取工具共用同一套输出契约，切片、截断标记、偏移归一与封顶都在这里，
 * 所以单独测这一层（工具测试只验证自己那条通道的接线）。
 *
 * 覆盖点：
 *  1. 输出头：Provider / URL / Title / 不可信声明
 *  2. 续读：start 切片、截断标记给出下一次偏移、越界与空正文按失败文本返回
 *  3. 字符安全：不在 emoji 的代理对中间切开；start 落在代理对中间时向后对齐
 *  4. resolveStart：非数字/负数按 0，超上限显式报错（不能夹回，否则标记原地重放）
 *  5. capForModel：搜索结果封顶与标记
 *
 * 运行：npm run test:tools（或 node --test test/webContent.test.js）
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const {
  MAX_CONTENT_CHARS,
  MAX_START,
  UNTRUSTED_NOTICE,
  capForModel,
  formatWebContent,
  resolveStart
} = await import('../utils/tools/webContent.js')

const PAGE = { provider: 'Exa', url: 'https://example.com/a', title: '示例标题' }

/** 拆出正文部分（头部与 Title 行之后） */
const bodyOf = result => result.slice(result.indexOf('\n\n') + 2)

describe('输出契约', () => {
  test('头部含来源、地址、标题与不可信声明', () => {
    const result = formatWebContent({ ...PAGE, text: 'hello' })

    assert.ok(result.startsWith(`Web page content from Exa for https://example.com/a (${UNTRUSTED_NOTICE}):\nTitle: 示例标题\n\n`))
    assert.equal(bodyOf(result), 'hello')
  })

  test('标题缺失时给占位，不输出空行', () => {
    const result = formatWebContent({ provider: 'Parallel', url: 'https://example.com/b', text: 'x' })

    assert.ok(result.includes('\nTitle: (untitled)\n\n'))
  })

  test('空正文按失败文本返回', () => {
    assert.equal(formatWebContent({ ...PAGE, text: '   ' }), 'Error: 页面没有可读文本')
  })
})

describe('续读与截断', () => {
  test('超过 20000 字符：截断并给出下一次的 start', () => {
    const result = formatWebContent({ ...PAGE, text: 'a'.repeat(25000) })

    assert.equal(bodyOf(result).length, MAX_CONTENT_CHARS + `\n[truncated to ${MAX_CONTENT_CHARS} characters; continue with start=${MAX_CONTENT_CHARS}]`.length)
    assert.ok(result.endsWith(`continue with start=${MAX_CONTENT_CHARS}]`))
  })

  test('start 切片：正文从偏移处开始，尾段不再有标记', () => {
    const result = formatWebContent({ ...PAGE, text: 'a'.repeat(25000), start: MAX_CONTENT_CHARS })

    assert.equal(bodyOf(result), 'a'.repeat(5000))
    assert.ok(!result.includes('[truncated'))
  })

  test('start 越界按失败文本返回', () => {
    assert.equal(formatWebContent({ ...PAGE, text: 'abc', start: 10 }), 'Error: start 10 超出正文长度（共 3 字符）')
  })
})

describe('字符安全', () => {
  test('切点落在 emoji 代理对中间时向前退一个字，不产生半个字符', () => {
    const text = 'a'.repeat(MAX_CONTENT_CHARS - 1) + '😀' + 'b'

    const result = formatWebContent({ ...PAGE, text })
    const body = bodyOf(result).replace(/\n\[truncated.*$/, '')

    const last = body.charCodeAt(body.length - 1)
    assert.ok(last < 0xd800 || last > 0xdbff, '正文末尾不应是孤立的高位代理')
    assert.ok(result.includes(`continue with start=${MAX_CONTENT_CHARS - 1}`))

    const next = formatWebContent({ ...PAGE, text, start: MAX_CONTENT_CHARS - 1 })
    assert.equal(bodyOf(next), '😀b')
  })

  test('start 落在低位代理上时向后对齐，不从半个 emoji 开始', () => {
    const result = formatWebContent({ ...PAGE, text: '😀abc', start: 1 })

    assert.equal(bodyOf(result), 'abc')
  })
})

describe('resolveStart', () => {
  test('非数字、负数、小数按契约折算', () => {
    assert.equal(resolveStart(undefined).start, 0)
    assert.equal(resolveStart('abc').start, 0)
    assert.equal(resolveStart(-5).start, 0)
    assert.equal(resolveStart(12.9).start, 12)
  })

  test('超上限显式报错，不夹回（夹回会让标记原地重放）', () => {
    const { error } = resolveStart(MAX_START + 1)

    assert.match(error, /超出可续读上限/)
    assert.equal(resolveStart(MAX_START).error, undefined)
  })
})

describe('capForModel', () => {
  test('未超限原样返回，超限截断并加标记', () => {
    assert.equal(capForModel('short'), 'short')

    const capped = capForModel('a'.repeat(MAX_CONTENT_CHARS + 5))
    assert.ok(capped.endsWith(`\n[truncated to ${MAX_CONTENT_CHARS} characters]`))
    assert.equal(capped.length, MAX_CONTENT_CHARS + `\n[truncated to ${MAX_CONTENT_CHARS} characters]`.length)
  })
})
