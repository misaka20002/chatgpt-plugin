/**
 * 偷图 / 撤销偷图 行为测试
 *
 * 运行：node --experimental-test-module-mocks --test test/emojiUndo.test.mjs
 *
 * 覆盖点：
 * 1. 指令后的提示文本进识图 prompt，系统提示词要求「提示点名情绪即采用」
 * 2. 成功回执带 `可引用该回复后: #gpt撤销偷图`，回执消息 id 与图片路径、isNew 一起写进 redis（14 天）
 * 3. 重复偷同一张图 isNew=false，撤销只清记录、不删文件
 * 4. 撤销按引用消息 id 找到记录并删文件；未引用 / 记录不存在 / 记录指向库外都有明确回执
 *
 * mock 原则：只 mock 宿主与外部边界（插件基类、配置、识图、fetch、redis），
 * save_EmojiImg / undo_EmojiImg / reNameAndSavePic 执行真实生产代码，删文件走真实 fs。
 */
import { test, mock, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 识图结果由各用例设定；同时记录调用参数供断言 */
let recognizeResult = 'cute: 软萌可爱'
const recognizeCalls = []

const logs = { warn: [], error: [] }
globalThis.logger = {
  info() {},
  debug() {},
  mark() {},
  warn: (...args) => logs.warn.push(args.join(' ')),
  error: (...args) => logs.error.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(' ')),
}

/** 被测代码用 process.cwd() 拼表情库路径，测试整体挪到临时目录，避免往仓库里落文件 */
const originalCwd = process.cwd()
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-emoji-'))
process.chdir(testRoot)
after(() => {
  process.chdir(originalCwd)
  fs.rmSync(testRoot, { recursive: true, force: true })
})

const imageResponse = () => ({
  ok: true,
  headers: {
    get: (name) => {
      if (name === 'content-length') return '1024'
      if (name === 'content-type') return 'image/png'
      return null
    },
  },
  arrayBuffer: async () => Buffer.from('sticker-bytes'),
})

class PluginStub {
  constructor(options = {}) {
    Object.assign(this, options)
  }
}

mock.module('../../../lib/plugins/plugin.js', { defaultExport: PluginStub })
mock.module('../../../lib/common/common.js', { defaultExport: { makeForwardMsg: async () => ({}) } })
mock.module('../../../lib/config/config.js', { defaultExport: { masterQQ: [] } })
mock.module('../utils/config.js', { namedExports: { Config: {} } })
mock.module('../utils/common.js', {
  namedExports: {
    getUserReplySetting: () => ({}),
    parseSourceImg: async () => {},
    generateAudio: async () => null,
  },
})
mock.module('../utils/tts.js', {
  namedExports: {
    get_matce_cn_speaker: () => '',
    speakers: [],
    vits_emotion_map: {},
    post_to_api_fish_audio_for_token: async () => null,
  },
})
mock.module('../utils/paimonFuction.js', {
  namedExports: {
    recognitionResultsByGemini: async (e, img, video, systemPrompt, options = {}) => {
      recognizeCalls.push({ img, systemPrompt, options })
      return recognizeResult
    },
    url2Base64: async () => ({}),
    getOnebotFileOrMediaUrl: async () => null,
  },
})
mock.module('../utils/tts/siliconflow.js', { defaultExport: {} })
mock.module('node-fetch', { defaultExport: async () => imageResponse() })

const { voicechangehelp } = await import('../apps/tts_voice_help.js')
const emoji = new voicechangehelp()

/** redis 只实现被测代码用到的 get/set/del；记录写盘参数供断言 TTL */
const redisStore = new Map()
const redisSets = []
globalThis.redis = {
  async get(key) {
    return redisStore.has(key) ? redisStore.get(key) : null
  },
  async set(key, value, options) {
    redisSets.push({ key, value, options })
    redisStore.set(key, value)
    return 'OK'
  },
  async del(key) {
    return redisStore.delete(key) ? 1 : 0
  },
}

let replySeq = 1000
/** 构造事件：reply 返回递增的消息 id（生产里这是撤销的唯一句柄） */
const mkEvent = (msg, patch = {}) => {
  const e = {
    msg,
    group_id: '777',
    user_id: '10001',
    isGroup: true,
    isMaster: true,
    img: [],
    replies: [],
    replySeqs: [],
    ...patch,
  }
  e.reply = async (m) => {
    e.replies.push(String(m))
    const seq = String(++replySeq)
    e.replySeqs.push(seq)
    return { seq }
  }
  return e
}

/** 取最近一次写入的记录（键、JSON） */
const lastRecord = () => {
  const set = redisSets.at(-1)
  return { key: set.key, value: JSON.parse(set.value), options: set.options }
}

test('规则注册：偷图（含提示）与撤销各归各的，互不吞掉', () => {
  const ruleOf = (fnc) => emoji.rule.find(r => r.fnc === fnc)
  const matches = (fnc, msg) => new RegExp(ruleOf(fnc).reg).test(msg)

  assert.equal(matches('save_EmojiImg', '#gpt偷图'), true)
  assert.equal(matches('save_EmojiImg', '#gpt偷图 派蒙 困惑'), true)
  assert.equal(matches('save_EmojiImg', '#chatgpt偷表情包 可爱'), true)
  assert.equal(matches('save_EmojiImg', '#gpt撤销偷图'), false, '撤销指令不能被偷图规则吞掉')

  assert.equal(matches('undo_EmojiImg', '#gpt撤销偷图'), true)
  assert.equal(matches('undo_EmojiImg', '#chatgpt撤销偷表情包'), true)
  assert.equal(matches('undo_EmojiImg', '#gpt偷图'), false)
  assert.equal(ruleOf('undo_EmojiImg').permission, 'master')
})

test('#gpt偷图 带提示：提示进 prompt，回执多一行撤销指令，并写入 14 天记录', async () => {
  recognizeResult = 'confused: 派蒙的困惑脸'
  const url = 'https://example.test/sticker-hint.png'
  const e = mkEvent('#gpt偷图 派蒙 困惑', { img: [url] })

  await emoji.save_EmojiImg(e)

  assert.deepEqual(e.replies, [
    '偷图成功！\n已将表情包储存在 [confused] 文件夹中~\n可引用该回复后: #gpt撤销偷图\nAI简评: 派蒙的困惑脸',
  ])

  const call = recognizeCalls.at(-1)
  assert.equal(call.options.prompt, '派蒙 困惑', '指令后的文本必须单独作为识图 prompt')
  assert.match(call.systemPrompt, /提示中明确点名了某个情绪/)
  assert.match(call.systemPrompt, /confused\(困惑\/疑惑\)/, '中文含义要进系统提示词，模型才能把“困惑”映射到 confused')

  const record = lastRecord()
  assert.equal(record.key, `CHATGPT:EMOJI_UNDO:777_${e.replySeqs[0]}`)
  assert.equal(record.value.emotion, 'confused')
  assert.equal(record.value.isNew, true)
  assert.equal(path.dirname(record.value.path), path.join(testRoot, 'data', 'chatgpt', 'sendEmojiTool', 'confused'))
  assert.ok(fs.existsSync(record.value.path), '记录必须指向真实落盘的文件')
  assert.equal(record.options.EX, 60 * 60 * 24 * 14, '回执与图片的关联保留两周')
})

test('#gpt偷图 无提示：prompt 用中性文本，不再把命令字喂给模型', async () => {
  recognizeResult = 'cute: 软萌可爱'
  const e = mkEvent('#gpt偷图', { img: ['https://example.test/sticker-nohint.png'] })

  await emoji.save_EmojiImg(e)

  const call = recognizeCalls.at(-1)
  assert.equal(call.options.prompt, '判断这张表情包属于哪个情绪分类')
  assert.ok(!call.options.prompt.includes('#gpt'), 'prompt 里不能出现命令字')
})

test('重复偷同一张图：第二次 isNew=false，指向同一个文件', async () => {
  const url = 'https://example.test/sticker-dup.png'
  await emoji.save_EmojiImg(mkEvent('#gpt偷图', { img: [url] }))
  const first = lastRecord().value
  await emoji.save_EmojiImg(mkEvent('#gpt偷图', { img: [url] }))
  const second = lastRecord().value

  assert.equal(first.isNew, true)
  assert.equal(second.isNew, false)
  assert.equal(second.path, first.path)
})

test('#gpt撤销偷图：删掉图片并按记录清理键', async () => {
  recognizeResult = 'cute: 软萌可爱'
  const url = 'https://example.test/sticker-undo.png'
  const saveEvent = mkEvent('#gpt偷图', { img: [url] })
  await emoji.save_EmojiImg(saveEvent)
  const { key, value } = lastRecord()
  assert.ok(fs.existsSync(value.path))

  const undoEvent = mkEvent('#gpt撤销偷图', { source: { seq: saveEvent.replySeqs[0] } })
  await emoji.undo_EmojiImg(undoEvent)

  assert.deepEqual(undoEvent.replies, [`已撤销：已从 [${value.emotion}] 文件夹移除该图片~`])
  assert.equal(fs.existsSync(value.path), false)
  assert.equal(redisStore.has(key), false, '撤销后记录要删掉，重复撤销才能落到「没找到」')
})

test('#gpt撤销偷图：isNew=false 的记录只清记录、不删文件', async () => {
  recognizeResult = 'cute: 软萌可爱'
  const url = 'https://example.test/sticker-reused.png'
  await emoji.save_EmojiImg(mkEvent('#gpt偷图', { img: [url] }))
  const secondEvent = mkEvent('#gpt偷图', { img: [url] })
  await emoji.save_EmojiImg(secondEvent)
  const { key, value } = lastRecord()
  assert.equal(value.isNew, false)

  const undoEvent = mkEvent('#gpt撤销偷图', { source: { seq: secondEvent.replySeqs[0] } })
  await emoji.undo_EmojiImg(undoEvent)

  assert.ok(fs.existsSync(value.path), '早就存在库里的图不能被误删')
  assert.equal(redisStore.has(key), false)
  assert.match(undoEvent.replies[0], /之前就在 \[cute\] 文件夹里，没有删除/)
})

test('#gpt撤销偷图：记录不存在时给出「没找到」', async () => {
  const e = mkEvent('#gpt撤销偷图', { source: { seq: 'not-exist' } })
  await emoji.undo_EmojiImg(e)
  assert.deepEqual(e.replies, ['没找到这条偷图记录（可能已过期或已撤销）'])
})

test('#gpt撤销偷图：没引用消息时提示先引用回执', async () => {
  const e = mkEvent('#gpt撤销偷图')
  await emoji.undo_EmojiImg(e)
  assert.deepEqual(e.replies, ['请引用「偷图成功」那条回复后再发送该指令'])
})

test('#gpt撤销偷图：记录指向表情库之外时拒绝删除并保留记录', async () => {
  const outside = path.join(os.tmpdir(), `chatgpt-emoji-outside-${Date.now()}.png`)
  fs.writeFileSync(outside, 'x')
  const key = 'CHATGPT:EMOJI_UNDO:777_outside-1'
  redisStore.set(key, JSON.stringify({ path: outside, emotion: 'cute', isNew: true }))

  const e = mkEvent('#gpt撤销偷图', { source: { seq: 'outside-1' } })
  await emoji.undo_EmojiImg(e)

  assert.match(e.replies[0], /不在表情库内/)
  assert.ok(fs.existsSync(outside))
  assert.ok(redisStore.has(key), '跳过删除时记录保留，便于人工排查')
  fs.unlinkSync(outside)
})

test('私聊会话用伪群号 8888 隔离记录键', async () => {
  const e = mkEvent('#gpt偷图', { img: ['https://example.test/sticker-private.png'], group_id: undefined, isGroup: false })
  await emoji.save_EmojiImg(e)
  assert.match(lastRecord().key, /^CHATGPT:EMOJI_UNDO:8888_\d+$/)
})

test('只带 reply_id 的引用也能撤销', async () => {
  const url = 'https://example.test/sticker-replyid.png'
  await emoji.save_EmojiImg(mkEvent('#gpt偷图', { img: [url] }))
  const { key, value } = lastRecord()
  redisStore.delete(key)
  const replyIdKey = 'CHATGPT:EMOJI_UNDO:777_reply-id-9'
  redisStore.set(replyIdKey, JSON.stringify(value))

  await emoji.undo_EmojiImg(mkEvent('#gpt撤销偷图', { reply_id: 'reply-id-9' }))

  assert.equal(fs.existsSync(value.path), false)
  assert.equal(redisStore.has(replyIdKey), false)
})

test('回执只带 data.message_id 时按该 id 写键，引用仍能撤销', async () => {
  const url = 'https://example.test/sticker-mid.png'
  const e = mkEvent('#gpt偷图', { img: [url] })
  e.reply = async (m) => {
    e.replies.push(String(m))
    return { data: { message_id: 'mid-42' } }
  }

  await emoji.save_EmojiImg(e)
  const { key, value } = lastRecord()
  assert.equal(key, 'CHATGPT:EMOJI_UNDO:777_mid-42')

  await emoji.undo_EmojiImg(mkEvent('#gpt撤销偷图', { reply_id: 'mid-42' }))
  assert.equal(fs.existsSync(value.path), false)
})

test('回执拿不到消息 id 时只记 warn，不写记录', async () => {
  const before = redisSets.length
  const e = mkEvent('#gpt偷图', { img: ['https://example.test/sticker-noid.png'] })
  e.reply = async (m) => {
    e.replies.push(String(m))
    return {}
  }

  await emoji.save_EmojiImg(e)

  assert.equal(redisSets.length, before)
  assert.ok(logs.warn.some(w => w.includes('缺少消息 id')))
})
