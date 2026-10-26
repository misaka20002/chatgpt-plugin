import { test, mock, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeProviders } from '../utils/providerProfiles.js'

let config, commits, replies, root, promptsDir
const replyOptions = []
const defaults = { api: {}, responses: {}, claude: {}, gemini: {} }
const redisStore = {}
const Config = {
  ttsMode: 'none',
  getConfig: () => config,
  commit (candidate) { normalizeProviders(candidate, defaults); config = candidate; commits++ }
}
Object.defineProperty(Config, 'defaultProviderId', { get: () => config.defaultProviderId })
mock.module('../utils/config.js', { namedExports: { Config } })
mock.module('../utils/common.js', {
  namedExports: {
    getMasterQQ: async () => ['1'],
    getUin: e => e.self_id,
    limitString: (text, length) => String(text).slice(0, length),
    makeForwardMsg: async () => '',
    maskQQ: qq => qq,
    mkdirs: dir => fs.mkdirSync(dir, { recursive: true })
  }
})
mock.module('../utils/tts/microsoft-azure.js', { defaultExport: { getEmotionPrompt: async () => '【情绪提示】' } })
mock.module('../../../lib/plugins/plugin.js', { defaultExport: class { constructor (options) { Object.assign(this, options) } } })
globalThis.logger = { info () {}, warn () {}, error () {}, mark () {} }
globalThis.redis = {
  set: async (key, value) => { redisStore[key] = value },
  get: async key => redisStore[key],
  del: async key => { delete redisStore[key] }
}
const { help } = await import('../apps/prompts.js')

const event = {
  isMaster: true,
  user_id: 1,
  msg: '#chatgpt使用设定',
  reply: async (text, quote, data) => {
    replies.push(text)
    replyOptions.push(data)
  }
}

beforeEach(() => {
  commits = 0
  replies = []
  replyOptions.length = 0
  for (const key of Object.keys(redisStore)) delete redisStore[key]
  Config.ttsMode = 'none'
  // 上一个用例的目录要连根删掉，否则每个用例都在临时目录里留一份设定文件。
  if (root) {
    process.chdir(os.tmpdir())
    fs.rmSync(root, { recursive: true, force: true })
  }
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-prompt-menu-'))
  promptsDir = path.join(root, 'plugins', 'chatgpt-plugin', 'prompts')
  fs.mkdirSync(promptsDir, { recursive: true })
  process.chdir(root)
  config = {
    modelProviders: {
      api: [{ id: 'a', name: '默认', model: 'm', promptPrefixOverride: '旧设定' }],
      responses: [],
      claude: [],
      gemini: []
    },
    defaultProviderId: 'a',
    fallbackProviderId: ''
  }
})

after(() => {
  process.chdir(os.tmpdir())
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

function writePrompt (name, content) {
  fs.writeFileSync(path.join(promptsDir, `${name}.txt`), content)
}

/**
 * 按顺序回放待回复消息；answer 是 `{ msg, ...覆盖字段 }`，undefined 表示超时（awaitContext 返回 false）。
 * beforeAnswer 在每个回复被消费前执行，用来模拟「等主人回话期间磁盘被改了」。
 */
function instance (answers, beforeAnswer) {
  const app = new help()
  app.awaitContext = async () => {
    const answer = answers.shift()
    if (beforeAnswer) beforeAnswer(answer)
    return answer === undefined ? false : { ...event, ...answer }
  }
  return app
}

test('裸指令列出本地设定，序号应用写入默认模型字段', async () => {
  writePrompt('alpha', '你是 alpha')
  writePrompt('beta', '你是 beta')
  await instance([{ msg: '1' }, { msg: '确定' }]).usePrompt(event)
  assert.match(replies[0], /^请选择要使用的设定（共 2 个）/)
  assert.match(replies[0], /1\. alpha/)
  assert.match(replies[0], /2\. beta/)
  assert.match(replies[0], /0\. 取消/)
  assert.match(replies[1], /即将把设定「alpha」应用到 Chat API - 默认/)
  assert.match(replies[1], /会覆盖它当前的设定/)
  assert.match(replies[1], /旧设定/)
  assert.equal(commits, 1)
  assert.equal(config.modelProviders.api[0].promptPrefixOverride, '你是 alpha')
  // 这份记录只给已下线的「上传设定」用，写入已移除，别再让它悄悄回来。
  assert.equal(redisStore['CHATGPT:PROMPT_USE_api'], undefined)
  assert.match(replies.at(-1), /已将设定「alpha」应用到 Chat API - 默认/)
})

test('默认模型是 gemini 时写入 gemini 行自己的设定字段', async () => {
  writePrompt('alpha', '你是 alpha')
  config.modelProviders.gemini = [{ id: 'g', name: '谷歌', geminiModel: 'gemini-2', geminiPrompt: '旧 gemini 设定' }]
  config.defaultProviderId = 'g'
  await instance([{ msg: '1' }, { msg: '确定' }]).usePrompt(event)
  assert.equal(config.modelProviders.gemini[0].geminiPrompt, '你是 alpha')
  assert.equal(config.modelProviders.api[0].promptPrefixOverride, '旧设定')
  assert.equal(redisStore['CHATGPT:PROMPT_USE_gemini'], undefined)
  assert.match(replies.at(-1), /应用到 Gemini - 谷歌/)
})

test('超过 30 个设定时菜单追加「直接用名字」的提示', async () => {
  for (let i = 0; i < 31; i++) writePrompt(`p${String(i).padStart(2, '0')}`, `设定 ${i}`)
  await instance([{ msg: '0' }]).usePrompt(event)
  assert.match(replies[0], /共 31 个/)
  assert.match(replies[0], /直接发送 #chatgpt使用设定<设定名>/)
  assert.equal(commits, 0)
})


test('带设定名直接应用，不弹菜单', async () => {
  writePrompt('alpha', '你是 alpha')
  writePrompt('beta', '你是 beta')
  await instance([{ msg: '确定' }]).usePrompt({ ...event, msg: '#chatgpt使用设定beta' })
  assert.equal(replies.length, 2)
  assert.doesNotMatch(replies[0], /请选择要使用的设定/)
  assert.equal(config.modelProviders.api[0].promptPrefixOverride, '你是 beta')
})

test('设定名只去掉 .txt 后缀，菜单按名字排序', async () => {
  writePrompt('cat', '猫')
  writePrompt('dog', '狗')
  await instance([{ msg: '0' }]).usePrompt(event)
  assert.match(replies[0], /1\. cat/)
  assert.match(replies[0], /2\. dog/)
  assert.match(replies.at(-1), /取消/)
})

test('覆盖前回 0 取消：不备份也不写入', async () => {
  writePrompt('alpha', '你是 alpha')
  await instance([{ msg: '1' }, { msg: '0' }]).usePrompt(event)
  assert.equal(commits, 0)
  assert.equal(config.modelProviders.api[0].promptPrefixOverride, '旧设定')
  assert.deepEqual(fs.readdirSync(promptsDir), ['alpha.txt'])
  assert.match(replies.at(-1), /取消/)
})

test('回备份名：先把当前设定存成新设定，再覆盖', async () => {
  writePrompt('alpha', '你是 alpha')
  await instance([{ msg: '1' }, { msg: '旧设定留底' }]).usePrompt(event)
  assert.equal(fs.readFileSync(path.join(promptsDir, '旧设定留底.txt'), 'utf8'), '旧设定')
  assert.equal(config.modelProviders.api[0].promptPrefixOverride, '你是 alpha')
  assert.match(replies.at(-1), /当前设定已备份为「旧设定留底」/)
})

test('备份名含路径字符或与已有设定重名时取消，不写入', async () => {
  writePrompt('alpha', '你是 alpha')
  writePrompt('beta', '你是 beta')
  for (const name of ['a/b', 'alpha', '..', 'x'.repeat(41)]) {
    await instance([{ msg: '1' }, { msg: name }]).usePrompt(event)
    assert.equal(commits, 0)
    assert.equal(config.modelProviders.api[0].promptPrefixOverride, '旧设定')
    assert.deepEqual(fs.readdirSync(promptsDir).sort(), ['alpha.txt', 'beta.txt'])
  }
})

test('超时、他人代答、非主人、无效序号都不写入', async () => {
  writePrompt('alpha', '你是 alpha')
  writePrompt('beta', '你是 beta')
  const cases = [
    [],
    [{ msg: '1' }, { msg: '确定', user_id: 2 }],
    [{ msg: '1' }, { msg: '确定', isMaster: false }],
    [{ msg: '99' }],
    [{ msg: '1abc' }]
  ]
  for (const answers of cases) {
    await instance([...answers]).usePrompt(event)
    assert.equal(commits, 0)
    assert.equal(config.modelProviders.api[0].promptPrefixOverride, '旧设定')
  }
})

test('当前设定为空时不再询问备份，直接应用', async () => {
  writePrompt('alpha', '你是 alpha')
  config.modelProviders.api[0].promptPrefixOverride = ''
  await instance([{ msg: '1' }]).usePrompt(event)
  assert.equal(replies.length, 2)
  assert.doesNotMatch(replies[1], /会覆盖它当前的设定/)
  assert.equal(commits, 1)
  assert.equal(config.modelProviders.api[0].promptPrefixOverride, '你是 alpha')
})

test('没有本地设定时提示先添加，不进入等待；名字找不到时不再联网导入', async () => {
  await instance([]).usePrompt(event)
  assert.match(replies.at(-1), /本地还没有设定/)
  writePrompt('alpha', '你是 alpha')
  await instance([{ msg: '确定' }]).usePrompt({ ...event, msg: '#chatgpt使用设定云端设定' })
  assert.match(replies.at(-1), /没有这个设定/)
  assert.equal(commits, 0)
})

test('「当前使用」按正文标注，azure 情绪后缀在关掉语音后仍算同一份设定', async () => {
  writePrompt('alpha', '你是 alpha')
  writePrompt('beta', '你是 beta')
  config.modelProviders.api[0].promptPrefixOverride = '你是 beta\n【情绪提示】'
  Config.ttsMode = 'azure'
  await instance([{ msg: '0' }]).usePrompt(event)
  assert.match(replies[0], /2\. beta（当前使用）/)
  assert.doesNotMatch(replies[0], /alpha（当前使用）/)
  // 应用时开着 azure、之后关掉，正文里还留着情绪提示，标记不能因此消失。
  Config.ttsMode = 'none'
  replies = []
  await instance([{ msg: '0' }]).usePrompt(event)
  assert.match(replies[0], /2\. beta（当前使用）/)
})

test('一份设定是另一份的前缀时，只标最长的那份', async () => {
  writePrompt('alpha', '你是猫娘')
  writePrompt('beta', '你是猫娘\n再热情一点')
  config.modelProviders.api[0].promptPrefixOverride = '你是猫娘\n再热情一点\n【情绪提示】'
  await instance([{ msg: '0' }]).usePrompt(event)
  assert.match(replies[0], /2\. beta（当前使用）/)
  assert.doesNotMatch(replies[0], /alpha（当前使用）/)
})

// ---- 删除设定 ----

const deleting = msg => ({ ...event, msg })

test('裸指令列出本地设定，选序号后确认删除', async () => {
  writePrompt('alpha', '你是 alpha')
  writePrompt('beta', '你是 beta')
  await instance([{ msg: '1' }, { msg: '确定' }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.match(replies[0], /^请选择要删除的设定（共 2 个）/)
  assert.match(replies[0], /1\. alpha/)
  assert.match(replies[0], /2\. beta/)
  assert.match(replies[0], /0\. 取消/)
  // 菜单不撤回，带正文的确认才撤回。
  assert.equal(replyOptions[0], undefined)
  assert.match(replies[1], /即将删除设定「alpha」/)
  assert.match(replies[1], /你是 alpha/)
  assert.deepEqual(replyOptions[1], { recallMsg: 119 })
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha.txt')), false)
  assert.equal(fs.existsSync(path.join(promptsDir, 'beta.txt')), true)
  assert.match(replies.at(-1), /已删除设定「alpha」/)
  assert.match(replies.at(-1), /还剩 1 个设定/)
})

test('回复 0 取消删除，文件保持原样', async () => {
  writePrompt('alpha', '你是 alpha')
  await instance([{ msg: '1' }, { msg: '0' }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha.txt')), true)
  assert.match(replies.at(-1), /操作已取消/)
})

test('带名字（含 移除 别名、多余空格）跳过菜单，但仍要确认一次', async () => {
  writePrompt('alpha', '你是 alpha')
  await instance([{ msg: '删除' }]).removePrompt(deleting('#chatgpt移除设定 alpha'))
  assert.match(replies[0], /^即将删除设定「alpha」/)
  assert.doesNotMatch(replies[0], /请选择要删除的设定/)
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha.txt')), false)
})

test('确认时回复其它内容，先把原内容另存再删除', async () => {
  writePrompt('alpha', '你是 alpha')
  await instance([{ msg: '1' }, { msg: 'alpha-backup' }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha.txt')), false)
  assert.equal(fs.readFileSync(path.join(promptsDir, 'alpha-backup.txt'), 'utf8'), '你是 alpha')
  assert.match(replies.at(-1), /另存为「alpha-backup」/)
})

test('备份名带路径分隔符时取消，原件不动', async () => {
  writePrompt('alpha', '你是 alpha')
  await instance([{ msg: '1' }, { msg: 'a/b' }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.match(replies.at(-1), /不能包含/)
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha.txt')), true)
})

test('备份名与已有设定重名时取消，两份都不动', async () => {
  writePrompt('alpha', '你是 alpha')
  writePrompt('beta', '你是 beta')
  await instance([{ msg: '1' }, { msg: 'beta' }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.match(replies.at(-1), /已存在同名设定「beta」/)
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha.txt')), true)
  assert.equal(fs.readFileSync(path.join(promptsDir, 'beta.txt'), 'utf8'), '你是 beta')
})

test('名字不存在时提示本地设定数量，不做任何改动', async () => {
  writePrompt('alpha', '你是 alpha')
  await instance([]).removePrompt(deleting('#chatgpt删除设定nope'))
  assert.match(replies[0], /没有这个设定「nope」/)
  assert.match(replies[0], /1 个设定/)
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha.txt')), true)
})

test('确认期间设定已被删掉时提示，且不留下备份', async () => {
  writePrompt('alpha', '你是 alpha')
  const app = instance([{ msg: '1' }, { msg: 'alpha-backup' }], answer => {
    if (answer?.msg === 'alpha-backup') fs.rmSync(path.join(promptsDir, 'alpha.txt'))
  })
  await app.removePrompt(deleting('#chatgpt删除设定'))
  assert.match(replies.at(-1), /可能刚被删除/)
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha-backup.txt')), false)
})

test('菜单标出当前默认模型正在用的设定', async () => {
  writePrompt('alpha', '你是 alpha')
  writePrompt('beta', '你是 beta')
  config.modelProviders.api[0].promptPrefixOverride = '你是 beta'
  await instance([{ msg: '0' }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.match(replies[0], /2\. beta（当前使用）/)
  assert.doesNotMatch(replies[0], /alpha（当前使用）/)
})

test('删除正在使用的设定时，确认文案标出当前使用并说明正文不变', async () => {
  writePrompt('beta', '你是 beta')
  config.modelProviders.api[0].promptPrefixOverride = '你是 beta'
  await instance([{ msg: '1' }, { msg: '0' }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.match(replies[1], /即将删除设定「beta」（当前使用）/)
  assert.match(replies[1], /不会改变/)
})

test('超过 30 个设定时菜单追加直接发名字的提示，且出口仍在最后一行', async () => {
  for (let i = 0; i < 31; i++) writePrompt(`p${String(i).padStart(2, '0')}`, `设定 ${i}`)
  await instance([{ msg: '0' }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.match(replies[0], /共 31 个/)
  assert.match(replies[0], /直接发送 #chatgpt删除设定<设定名>/)
  assert.ok(replies[0].indexOf('0. 取消') > replies[0].indexOf('直接发送 #chatgpt删除设定'))
})

test('他人代答时取消，文件不动', async () => {
  writePrompt('alpha', '你是 alpha')
  await instance([{ msg: '1' }, { msg: '确定', isMaster: false, user_id: 2 }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.match(replies.at(-1), /操作已取消或超时/)
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha.txt')), true)
})

test('没有默认模型时仍能删除，只是不标「当前使用」', async () => {
  writePrompt('alpha', '你是 alpha')
  config.defaultProviderId = 'missing'
  await instance([{ msg: '1' }, { msg: '确定' }]).removePrompt(deleting('#chatgpt删除设定'))
  assert.doesNotMatch(replies[0], /当前使用/)
  assert.equal(fs.existsSync(path.join(promptsDir, 'alpha.txt')), false)
})
