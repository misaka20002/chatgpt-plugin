/**
 * 派蒙meme 断言套件（离线跑，不需要真实 Yunzai / Redis / 远端）
 *
 * 请通过入口跑，不要直接执行本文件——它需要 cwd 看起来像云崽根目录
 * （`config/default_config/`、`package.json`、`renderers/`），入口会自动搭好临时 cwd 再跑：
 *
 *   node test/meme/run.mjs                 # 完整（含约 48s 的超时用例 K）
 *   node test/meme/run.mjs --skip-slow     # 跳过 K 组
 *   node test/meme/run.mjs --mutant <kind> # 变异验证：预期只有目标断言转红
 *
 * 覆盖：
 *   A 冷启动注册规则 / 读缓存不误报      B 定时任务真拉远端      C 手动更新
 *   D 远端挂掉回退                      E 无旧数据失败          F [#2] 更新期间旧数据仍可用（竞态）
 *   G [#1] 主人保护分支不再把数组塞进 imgUrls                    H [#6] 空候选不崩
 *   I [#4] 部分重建不落地               J [#5] 关键词按字面量匹配（转义）
 *   K [#3] 卡住的响应会被超时中断       L [#7] 取图逐级 fallback
 *   M [#8] 图片下载容错                 N [#9] CD 原子化（并发只放行一条）
 *   O [#10] 参数解析（枚举 0 / number 值域 / 帮助文本）
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

/** plugins/chatgpt-plugin/test/meme -> 云崽根目录 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const url = p => pathToFileURL(path.join(REPO, p)).href
const KEY = 'chatgpt-plugin/派蒙meme.js'
const MEME_CACHE = 'data/memes/dataset.json'
/** 旧版双文件缓存，迁移用 */
const LEGACY_INFOS = 'data/memes/infos.json'
const LEGACY_KEYMAP = 'data/memes/keyMap.json'
/** 读回缓存里的 keyMap，省得每处断言都写一遍解构 */
const cachedKeyMap = () => JSON.parse(fs.readFileSync(MEME_CACHE, 'utf8')).keyMap

const results = []
let pass = 0
let fail = 0
async function check(name, fn) {
  let line
  try {
    await fn()
    pass++
    line = `ok   - ${name}`
  } catch (e) {
    fail++
    line = `FAIL - ${name}\n       ${(e.stack || e.message).split('\n').slice(0, 4).join('\n       ')}`
  }
  results.push(line)
  // 实时落盘：后台跑时可以从日志看到进度，不必等到结束
  console.log(line)
}

/* ---------------- 全局桩 ---------------- */
const logs = []
const logFn = level => (...a) => logs.push(`[${level}] ${a.map(x => (x && x.message) || x).join(' ')}`)
global.logger = new Proxy({}, {
  get: (_, k) => ['mark', 'warn', 'error', 'info', 'debug'].includes(k) ? logFn(k) : (s => s)
})
global.segment = { image: v => ({ type: 'image', file: v }) }
/**
 * 内存版 redis 桩。必须实现真实的 SET 语义（NX/EX + 未抢到时返回 null），
 * 否则 #9 的原子抢占根本测不出来（桩自己把返回值变成 undefined 会让所有消息都被拦）。
 */
const redisStore = new Map()
const redisAlive = k => {
  const e = redisStore.get(k)
  if (!e) return null
  if (e.expireAt && e.expireAt <= Date.now()) {
    redisStore.delete(k)
    return null
  }
  return e
}
/** 事务被开启的次数。用来证明"INCR 与 EXPIRE 在同一事务里"——这是假 redis 观察不到的原子性 */
const redisTxCount = { multi: 0 }
global.redis = {
  get: async k => redisAlive(k)?.value ?? null,
  set: async (k, v, opts = {}) => {
    const alive = redisAlive(k)
    if (opts.NX && alive) return null
    if (opts.XX && !alive) return null
    redisStore.set(k, { value: String(v), expireAt: opts.EX ? Date.now() + opts.EX * 1000 : null })
    return 'OK'
  },
  // 真实 Redis 的 INCR **不会**清除已有 TTL，桩照此实现，否则测不出"漏设 TTL"
  incr: async k => {
    const alive = redisAlive(k)
    const n = Number(alive?.value || 0) + 1
    redisStore.set(k, { value: String(n), expireAt: alive?.expireAt ?? null })
    return n
  },
  expire: async (k, s) => {
    const e = redisAlive(k)
    if (!e) return 0
    e.expireAt = Date.now() + s * 1000
    return 1
  },
  mGet: async keys => keys.map(k => redisAlive(k)?.value ?? null),
  /** 链式事务，语义与 node-redis 一致：命令入队，exec 时按序执行 */
  multi: () => {
    redisTxCount.multi++
    const queue = []
    const tx = {
      incr: k => { queue.push(['incr', [k]]); return tx },
      expire: (k, s) => { queue.push(['expire', [k, s]]); return tx },
      exec: async () => {
        const out = []
        for (const [cmd, args] of queue) out.push(await global.redis[cmd](...args))
        return out
      },
    }
    return tx
  },
}
global.Bot = { makeLog: () => {}, fsStat: async () => false, getTimeDiff: () => '0ms', String: v => String(v) }

/* ---------------- 本地假 meme 服务端 ---------------- */
const infoOf = (key, kw, params_type = {}) => ({
  key,
  keywords: [kw],
  date_created: '2026-09-01T00:00:00.000Z',
  params_type: { min_images: 0, max_images: 0, min_texts: 1, max_texts: 1, default_texts: ['x'], ...params_type },
})
/** 按 {关键词: memeKey} 生成配套 infos */
const stateOf = keyMap => ({
  keyMap,
  infos: Object.fromEntries(Object.entries(keyMap).map(([kw, k]) => [k, infoOf(k, kw)])),
})

const srv = { keyMap: {}, infos: {}, keys: null, down: false, hang: new Set(), failInfo: new Set(), notFound: new Set(), notImage: new Set(), delayMs: 0, posts: [] }
const serverHits = []
/** 请求时间线（判"两次刷新有没有交织执行"），与 serverHits 并存以免动到既有断言 */
const reqLog = []
/** 静态接口同时在飞的请求数与历史峰值 */
let staticInFlight = 0
let staticMaxInFlight = 0
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://127.0.0.1').pathname
  serverHits.push(p)
  reqLog.push({ p, t: Date.now() })
  // 统计"同时在飞的静态接口请求数"：一次刷新内部 infos.json 与 keyMap.json 是串行拉取的，
  // 所以串行化生效时这个峰值只能是 1；两次 init() 并发跑则会出现 2
  if (p.startsWith('/memes/static/')) {
    staticInFlight++
    staticMaxInFlight = Math.max(staticMaxInFlight, staticInFlight)
    res.on('finish', () => { staticInFlight-- })
  }
  if (req.method === 'POST' && p.startsWith('/memes/')) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    srv.posts.push({ path: p, body: Buffer.concat(chunks) })
    // 200 + text/html：模拟反代 / WAF / 登录页的错页。
    // `'*'` 表示所有 POST 都这样（出图路径的 URL 带 meme key，逐条列举太啰嗦）
    if (srv.notImage.has(p) || srv.notImage.has('*')) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end('<html>not an image</html>')
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' })
    return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  }
  if (srv.delayMs) await new Promise(r => setTimeout(r, srv.delayMs))
  if (srv.hang.has(p)) return // 挂起：接受连接但永不响应
  if (srv.notFound.has(p)) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<html>not found</html>') }
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
  if (srv.down) { res.writeHead(500, { 'Content-Type': 'text/html' }); return res.end('<html>down</html>') }
  // #8 用的图片路由
  if (p === '/img/500') { res.writeHead(500, { 'Content-Type': 'text/html' }); return res.end('<html>boom</html>') }
  if (p === '/img/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>not an image</html>') }
  if (p === '/img/big') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(50 * 1024 * 1024) })
    return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  }
  if (p === '/img/ok') {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' })
    return res.end(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('HTTPIMG')]))
  }
  if (p === '/memes/static/infos.json') return json(srv.infos)
  if (p === '/memes/static/keyMap.json') return json(srv.keyMap)
  if (p === '/memes/keys') return json(srv.keys ?? Object.keys(srv.infos))
  const m = p.match(/^\/memes\/([^/]+)\/info$/)
  if (m) {
    const k = decodeURIComponent(m[1])
    if (srv.failInfo.has(k)) { res.writeHead(500); return res.end('fail') }
    if (!srv.infos[k]) { res.writeHead(404); return res.end('nope') }
    return json(srv.infos[k])
  }
  res.writeHead(404); res.end('nope')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const hitsOf = p => serverHits.filter(x => x === p).length
const closeServer = () => new Promise(r => { server.closeAllConnections?.(); server.close(r) })
/** 每阶段重置服务端状态；不能只 patch 部分字段，否则上一阶段的 keys/hang 会漏过来 */
const resetSrv = patch => Object.assign(srv, {
  keyMap: {}, infos: {}, keys: null, down: false, hang: new Set(), failInfo: new Set(), notFound: new Set(), notImage: new Set(), delayMs: 0, posts: [],
}, patch)
/** 事件桩 */
const mkEvent = (msg, over = {}) => ({
  msg,
  isGroup: false,
  user_id: '10001',
  sender: { user_id: '10001', card: '测试', sex: 'unknown' },
  message: [{ type: 'text', text: msg }],
  reply: async m => { events.at(-1)?.replies.push(m); return { message_id: 'm1' } },
  ...over,
})
const events = []
const newEvent = (msg, over) => { const e = mkEvent(msg, over); e.replies = []; events.push(e); return e }

/* ---------------- 主仓库 config 需要存在（loader 会 import） ---------------- */
fs.mkdirSync('config/config', { recursive: true })
fs.writeFileSync('config/config/other.yaml', 'masterQQ:\n  - "12345"\n')

/* ---------------- 加载真实模块（Config 必须在插件之前改） ---------------- */
const { Config } = await import(url('plugins/chatgpt-plugin/utils/config.js'))
// Config 是 Proxy，直接赋值会走 set 陷阱写配置文件，这里绕过它改底层对象
Config.getConfig().meme_baseUrl = `http://127.0.0.1:${PORT}`
if (process.env.MEME_FORCE_SHARP === 'false') Config.getConfig().meme_forceSharp = false
const FORCE = !!Config.meme_forceSharp
const PREFIX = FORCE ? '#' : ''
/**
 * 列表图缓存文件名带 `forceSharp` 身份（见 apps/派蒙meme.js 的 `listCacheFile()`），
 * 所以这里必须跟着 `FORCE` 算，不能再硬编码旧名
 */
const RENDER_CACHE = `data/memes/render_list${FORCE ? '_sharp' : '_plain'}.jpg`
/** 旧版固定名 / 另一种身份，`clearRenderListCache()` 也应当一并清理 */
const RENDER_CACHE_OTHERS = [
  'data/memes/render_list.jpg',
  FORCE ? 'data/memes/render_list_plain.jpg' : 'data/memes/render_list_sharp.jpg',
]
const loader = (await import(url('lib/plugins/loader.js'))).default
const PLUGIN = process.env.MEME_PLUGIN || 'plugins/chatgpt-plugin/apps/派蒙meme.js'
const { memes } = await import(url(PLUGIN))
console.log(`# 被测文件: ${PLUGIN}   forceSharp=${FORCE}`)

/* ---------------- 模拟 loadPlugin 注册出来的条目 ---------------- */
const entry = { plugin: new memes(), class: memes, key: KEY, name: '派蒙meme表情制作', priority: 5000, namespace: KEY }
loader.priority = [entry]
const fncs = () => entry.plugin.rule.map(r => r.fnc)
/** 完全按 PluginsLoader.deal() 的匹配方式取命中的 fnc（deal 读的就是 i.plugin.rule） */
const hit = msg => entry.plugin.rule.filter(r => r.reg.test(msg)).map(r => r.fnc)
const baseFncs = ['memesList', 'randomMemes', 'memesHelp', 'memesSearch', 'memesUpdate']
/** 等价 loader.startTask(i) */
const runCron = async () => new memes().task.fnc()
const runCmd = async (msg, over) => {
  redisStore.clear()
  const e = newEvent(msg, over)
  await new memes().memes(e)
  return e
}

/* ---------------- P0 前置 ---------------- */
await check('P0.1 注册实例初始只有 5 条基础规则', () => {
  assert.deepEqual(fncs(), baseFncs)
})
await check(`P0.2 forceSharp=${FORCE} 时基础命令${FORCE ? '必须带' : '可以不带'} #`, () => {
  assert.deepEqual(hit('meme列表'), FORCE ? [] : ['memesList'])
  assert.deepEqual(hit('#meme列表'), ['memesList'])
  assert.deepEqual(hit(`${PREFIX}表情包帮助`), ['memesHelp'])
  assert.deepEqual(hit('表情包搜索xx'), FORCE ? [] : ['memesSearch'])
})

/* ---------------- A 冷启动 ---------------- */
fs.rmSync('data', { recursive: true, force: true })
resetSrv({ ...stateOf({ 测试A: 'k_a' }) })
await new memes().init()

await check('A1 冷启动后注册实例拿到 meme 关键词规则', () => {
  assert.deepEqual(hit(PREFIX + '测试A'), ['memes'])
})
await check('A2 基础规则没有被丢掉', () => {
  assert.deepEqual(fncs().slice(0, 5), baseFncs)
})
await check('A3 所有 reg 都是 RegExp（deal 直接 .reg.test）', () => {
  for (const r of entry.plugin.rule) assert.ok(r.reg instanceof RegExp)
})
await check('A4 本地缓存已落盘，且确实走了远端接口', () => {
  assert.ok(fs.existsSync(MEME_CACHE), `缓存文件 ${MEME_CACHE} 不存在`)
  assert.ok(serverHits.includes('/memes/static/keyMap.json'))
})
await check('A5 启动时只是读本地缓存，不应误报"更新完成"、不应清列表图缓存', async () => {
  fs.writeFileSync(RENDER_CACHE, 'fake-jpg')
  const before = logs.filter(l => l.includes('更新完成')).length
  await new memes().init() // force=false，缓存齐备
  assert.equal(logs.filter(l => l.includes('更新完成')).length, before, '读缓存却报了更新完成')
  assert.ok(fs.existsSync(RENDER_CACHE), '列表图缓存被误清')
  fs.rmSync(RENDER_CACHE, { force: true })
})

/* ---------------- B 定时任务真拉远端 ---------------- */
resetSrv({ ...stateOf({ 测试A: 'k_a', 测试B: 'k_b' }) })
fs.writeFileSync(RENDER_CACHE, 'fake-jpg')
const hitsBefore = hitsOf('/memes/static/keyMap.json')
await runCron()

await check('B1 [核心] 定时任务真的请求了远端（不再空转）', () => {
  assert.ok(hitsOf('/memes/static/keyMap.json') > hitsBefore, 'keyMap 请求次数没有增加')
})
await check('B2 新关键词立即可匹配（无需重启）', () => {
  assert.deepEqual(hit(PREFIX + '测试B'), ['memes'])
})
await check('B3 旧关键词仍可匹配', () => {
  assert.deepEqual(hit(PREFIX + '测试A'), ['memes'])
})
await check('B4 本地缓存被远端内容覆盖', () => {
  assert.equal(cachedKeyMap().测试B, 'k_b')
})
await check('B5 更新成功后列表图缓存被清理', () => {
  assert.ok(!fs.existsSync(RENDER_CACHE))
})

/* ---------------- C 手动更新 ---------------- */
resetSrv({ ...stateOf({ 测试C: 'k_c' }) })
const manual = newEvent(`${PREFIX}表情包更新`)
await new memes().memesUpdate(manual)

await check('C1 手动更新后新关键词可匹配', () => {
  assert.deepEqual(hit(PREFIX + '测试C'), ['memes'])
})
await check('C2 手动更新整体替换规则（旧关键词消失）', () => {
  assert.deepEqual(hit(PREFIX + '测试A'), [])
  assert.equal(entry.plugin.rule.length, 6)
})
await check('C3 回执提示已注册', () => {
  assert.equal(manual.replies.at(-1), '更新完成，已注册 1 个 meme 规则')
})

/* ---------------- D 远端挂掉：回退 ---------------- */
resetSrv({ down: true })
const downed = newEvent(`${PREFIX}表情包更新`)
await new memes().memesUpdate(downed)

await check('D1 拉取失败回执说明沿用原有规则', () => {
  assert.match(String(downed.replies.at(-1)), /^更新失败：未拉取到新资源，继续沿用原有 \d+ 个 meme 规则$/)
})
await check('D2 失败不会清空可用规则', () => {
  assert.deepEqual(hit(PREFIX + '测试C'), ['memes'])
})

/* ---------------- E 无旧数据 + 远端挂掉 ---------------- */
const { memes: memesV2 } = await import(url(PLUGIN) + '?v=2')
let fresh = null
await check('E1 无旧数据时返回 refreshed=false / keys=0 / fallback=false', async () => {
  fresh = await new memesV2().init(true)
  // 逐字段断言，不用 deepEqual 比整个对象：这条断言关心的是这三个语义，
  // 返回值以后再加字段（比如 persisted）不该把测试弄红
  assert.equal(fresh.refreshed, false)
  assert.equal(fresh.keys, 0)
  assert.equal(fresh.fallback, false)
  // 本次没有需要落盘的数据，persisted 默认 true（语义见 doRefresh 的注释）
  assert.equal(fresh.persisted, true)
})
await check('E2 这种情况也不会清空已注册的规则', () => {
  assert.deepEqual(hit(PREFIX + '测试C'), ['memes'])
})

/* ---------------- F [#2] 更新期间旧数据仍可用 ---------------- */
resetSrv({ ...stateOf({ 测试A: 'k_a' }) })
await new memes().init(true) // 先让内存里有一份可用数据
resetSrv({ ...stateOf({ 测试A: 'k_a', 测试F新: 'k_f' }), delayMs: 1500 })
const inFlight = new memes().init(true).catch(e => { throw new Error(`in-flight init 抛错: ${e.message}`) })
const during = await runCmd(PREFIX + '测试A').then(() => 'ok', e => e)
await inFlight

await check('F1 [竞态] 更新进行中，旧关键词仍能正常出图（不抛错）', () => {
  assert.equal(during, 'ok', `更新期间调用命令失败: ${during && during.message}`)
})
await check('F2 更新期间旧数据未丢失（请求确实打到了服务端）', () => {
  assert.equal(srv.posts.length, 1)
  assert.equal(srv.posts[0].path, '/memes/k_a/')
})
await check('F3 更新完成后新数据原子生效', () => {
  assert.deepEqual(hit(PREFIX + '测试F新'), ['memes'])
  assert.deepEqual(hit(PREFIX + '测试A'), ['memes'])
})

/* ---------------- H [#6] 随机 meme 无候选 ---------------- */
resetSrv({ ...stateOf({ 测试H: 'k_h' }) })
await new memes().init(true)
const randEvent = newEvent(`${PREFIX}随机meme`)
await check('H1 [空候选] 不抛错并给出提示', async () => {
  await new memes().randomMemes(randEvent)
  assert.equal(randEvent.replies.at(-1), '暂无可用随机 meme')
})
await check('H2 [有候选] 能正常走到请求（不因空数组逻辑崩溃）', async () => {
  resetSrv({ infos: { k_p: infoOf('k_p', '测试P', { min_images: 1, max_images: 1, min_texts: 0, max_texts: 0 }) } })
  await new memes().init(true)
  redisStore.clear() // 清 CD，否则 randomMemes 转发的 memes() 会被限流静默 return
  const e = newEvent(`${PREFIX}随机meme`, { user_id: '20001', sender: { user_id: '20001', card: '测试', sex: 'unknown' }, getAvatarUrl: async () => `data:image/jpeg;base64,${Buffer.from('MEFLAG').toString('base64')}` })
  await new memes().randomMemes(e)
  assert.ok(e.replies.length > 0, '没有产生任何回复')
  assert.equal(srv.posts.length, 1, '没有发出 meme 请求')
})

/* ---------------- I [#4] 部分重建不落地 ---------------- */
resetSrv({ ...stateOf({ 测试旧: 'k_old' }) })
await new memes().init(true)
resetSrv({
  infos: { k_a: infoOf('k_a', '测试I1'), k_b: infoOf('k_b', '测试I2'), k_c: infoOf('k_c', '测试I3') },
  keyMap: {},
  keys: ['k_a', 'k_b', 'k_c'],
  failInfo: new Set(['k_b', 'k_c']),
})
let partial = null
await check('I1 [#4] 逐项重建不完整时整批丢弃并回退', async () => {
  partial = await new memes().init(true)
  assert.equal(partial.refreshed, false)
  assert.equal(partial.fallback, true)
})
await check('I2 残缺数据没有顶掉原有完整数据', () => {
  assert.deepEqual(hit(PREFIX + '测试旧'), ['memes'])
  assert.deepEqual(hit(PREFIX + '测试I1'), [])
})
await check('I3 磁盘缓存也没被残缺数据写坏', () => {
  assert.equal(cachedKeyMap().测试旧, 'k_old')
})
await check('I4 日志说明丢弃原因', () => {
  assert.ok(logs.some(l => l.includes('逐项重建不完整')))
})

/* ---------------- G [#1] 主人保护分支 ---------------- */
resetSrv({ infos: { do: infoOf('do', '测试保护', { min_images: 1, max_images: 1, min_texts: 0, max_texts: 0 }) } })
await new memes().init(true)
const protectEvent = newEvent(PREFIX + '测试保护', {
  user_id: '12345',
  sender: { user_id: '12345', card: '测试', sex: 'unknown' },
  img: ['https://q1.qlogo.cn/g?b=qq&s=40&nk=12345'],
  getAvatarUrl: async () => `data:image/jpeg;base64,${Buffer.from('MEFLAG').toString('base64')}`,
})
await check('G1 [#1] 主人保护分支不抛错，且把图换成了发送者头像', async () => {
  redisStore.clear() // 清掉前面阶段留下的 CD，否则命令会被限流直接 return
  await new memes().memes(protectEvent)
  assert.ok(srv.posts.length, '没有发出 meme 请求')
  const body = srv.posts.at(-1).body
  assert.ok(body.includes(Buffer.from('MEFLAG')), '上传的图片不是发送者头像（可能仍是主人头像）')
  assert.ok(!body.includes(Buffer.from('q1.qlogo.cn')), '上传体里不该出现 qlogo 地址')
})

/* ---------------- J [#5] 关键词转义 ---------------- */
resetSrv({ ...stateOf({ '测试(': 'k_paren', 'a.b': 'k_dot', 测试正常: 'k_ok' }) })
let escOk = null
await check('J1 [#5] 含正则元字符的关键词不会让规则构造抛错', async () => {
  escOk = await new memes().init(true)
  assert.equal(escOk.refreshed, true)
  assert.deepEqual(hit(PREFIX + '测试('), ['memes'])
})
await check('J2 [#5] 关键词按字面量匹配（a.b 不命中 aXb）', () => {
  assert.deepEqual(hit(PREFIX + 'a.b'), ['memes'])
  assert.deepEqual(hit(PREFIX + 'aXb'), [], '未转义：. 被当成通配符了')
  assert.deepEqual(hit(PREFIX + '测试XYZ'), [])
})

/* ---------------- L [#7] 取图逐级 fallback ---------------- */
const mkDataImg = tag => `data:image/jpeg;base64,${Buffer.from(tag).toString('base64')}`
const postedHas = tag => !!srv.posts.at(-1)?.body.includes(Buffer.from(tag))
let imgSeq = 0
/** 造一个带图事件：头像固定返回 MEFLAG，便于判断是否退化成了发送者头像 */
const imgEvent = (kw, over = {}) => {
  const uid = String(40000 + (++imgSeq))
  return newEvent(PREFIX + kw, {
    getAvatarUrl: async () => mkDataImg('MEFLAG'),
    ...over,
    user_id: uid,
    sender: { user_id: uid, card: '测试', sex: 'unknown' },
  })
}
const replyWith = urls => async () => ({ message: urls.map(url => ({ type: 'image', url })) })
const REPLY_SRC = { seq: 1, time: 1 }

resetSrv({ infos: { k_img: infoOf('k_img', '测试图', { min_images: 1, max_images: 2, min_texts: 0, max_texts: 0 }) } })
await new memes().init(true)

await check('L1 [#7] 回复里没有图时，回退到本条消息的图（不再退化成发送者头像）', async () => {
  redisStore.clear(); srv.posts.length = 0
  const e = imgEvent('测试图', {
    source: REPLY_SRC,
    getReply: async () => ({ message: [{ type: 'text', text: '纯文字' }] }),
    img: [mkDataImg('OWNIMG')],
  })
  await new memes().memes(e)
  assert.ok(srv.posts.length, '没有发出 meme 请求')
  assert.ok(postedHas('OWNIMG'), '没有使用本条消息附带的图片')
  assert.ok(!postedHas('MEFLAG'), '退化成了发送者头像')
})

await check('L2 [#7] 回复里有图时回复图优先，且不再追加本条图', async () => {
  redisStore.clear(); srv.posts.length = 0
  const e = imgEvent('测试图', {
    source: REPLY_SRC,
    getReply: replyWith([mkDataImg('REPLYIMG')]),
    img: [mkDataImg('OWNIMG')],
  })
  await new memes().memes(e)
  assert.ok(postedHas('REPLYIMG'), '没有用回复里的图')
  assert.ok(!postedHas('OWNIMG'), '不该再追加本条图（min_images 已满足）')
})

await check('L3 [#7] min_images=2 时按缺口补齐（回复 1 张 + 本条 1 张）', async () => {
  resetSrv({ infos: { k_img2: infoOf('k_img2', '测试图2', { min_images: 2, max_images: 2, min_texts: 0, max_texts: 0 }) } })
  await new memes().init(true)
  redisStore.clear(); srv.posts.length = 0
  const e = imgEvent('测试图2', { source: REPLY_SRC, getReply: replyWith([mkDataImg('REPLYIMG')]), img: [mkDataImg('OWNIMG')] })
  await new memes().memes(e)
  assert.ok(postedHas('REPLYIMG') && postedHas('OWNIMG'), '没有按缺口补齐第二张图')
})

/* ---------------- M [#8] 图片下载容错 ---------------- */
const imgUrl = p => `http://127.0.0.1:${PORT}${p}`
resetSrv({ infos: { k_img: infoOf('k_img', '测试图', { min_images: 1, max_images: 1, min_texts: 0, max_texts: 0 }) } })
await new memes().init(true)

await check('M1 [#8] 图片返回 500 不再让命令 reject，给出明确提示', async () => {
  redisStore.clear(); srv.posts.length = 0
  const e = imgEvent('测试图', { img: [imgUrl('/img/500')] })
  await new memes().memes(e) // 旧代码这里会 reject
  // 来源够（带了 1 张图）但下载失败 → 报清差几张，用户才知道要不要重发
  assert.equal(e.replies.at(-1), '需要 1 张图片，其中 1 张下载失败，请重发图片或检查链接后重试')
  assert.equal(srv.posts.length, 0, '不该再拿残缺请求去打远端')
})

await check('M2 [#8] content-type 不是图片时跳过（404 HTML 不会被当成图上传）', async () => {
  redisStore.clear(); srv.posts.length = 0
  const e = imgEvent('测试图', { img: [imgUrl('/img/html')] })
  await new memes().memes(e)
  assert.equal(e.replies.at(-1), '需要 1 张图片，其中 1 张下载失败，请重发图片或检查链接后重试')
  assert.equal(srv.posts.length, 0)
})

await check('M3 [#8] 声明长度超限时在读入内存前就拒绝', async () => {
  redisStore.clear(); srv.posts.length = 0
  const e = imgEvent('测试图', { img: [imgUrl('/img/big')] })
  await new memes().memes(e)
  assert.match(String(e.replies.at(-1)), /文件大小超出限制/)
  assert.equal(srv.posts.length, 0)
})

await check('M4 [#8] 下载失败但 min_images=0 时仍然继续出图（不中断命令）', async () => {
  resetSrv({ infos: { k_img0: infoOf('k_img0', '测试图0', { min_images: 0, max_images: 1, min_texts: 1, max_texts: 1 }) } })
  await new memes().init(true)
  redisStore.clear(); srv.posts.length = 0
  const e = imgEvent('测试图0', { img: [imgUrl('/img/500')] })
  await new memes().memes(e)
  assert.equal(srv.posts.length, 1, '命令被单张图下载失败中断了')
})

// 放在 M4 之后：它自己会换掉 keyMap，不能再让后面的用例沿用 M 组开头的 fixture
await check('M5 [#12] 需要多张图但没带图也没 @ 人时，直接告诉用户该怎么做', async () => {
  // #撅（do）就是这种：min_images=2，一张发送者头像填不上缺口。
  // 旧行为是把 1 张头像当成残缺请求丢给远端，由服务端回一句校验错，用户看不懂也照做不了
  resetSrv({ infos: { k_two: infoOf('k_two', '测试两张', { min_images: 2, max_images: 2, min_texts: 0, max_texts: 0 }) } })
  await new memes().init(true)
  redisStore.clear(); srv.posts.length = 0
  const e = imgEvent('测试两张') // 不带图、不 @ 人
  await new memes().memes(e)
  const last = String(e.replies.at(-1))
  assert.match(last, /至少要 2 张图片/, `没提示最小图片数量: ${last}`)
  assert.match(last, /@/, `没告诉用户可以 @ 人: ${last}`)
  assert.equal(srv.posts.length, 0, '残缺请求不该打到远端')
})

/* ---------------- N [#9] CD 原子化 ---------------- */
resetSrv({ ...stateOf({ 测试N: 'k_n' }) })
await new memes().init(true)
const mkSameUser = (n, uid, over = {}) =>
  Array.from({ length: n }, () => newEvent(PREFIX + '测试N', { ...over, user_id: uid, sender: { user_id: uid, card: '测试', sex: 'unknown' } }))

await check('N1 [#9] 同一用户并发 5 条，只有 1 条通过 CD', async () => {
  redisStore.clear(); srv.posts.length = 0
  const es = mkSameUser(5, '50001')
  await Promise.all(es.map(e => new memes().memes(e)))
  assert.equal(srv.posts.length, 1, `并发下放行了 ${srv.posts.length} 条（GET→SET 非原子）`)
})

await check('N2 [#9] 主人不受 CD 限制，仍然全部放行', async () => {
  redisStore.clear(); srv.posts.length = 0
  const es = mkSameUser(3, '12345', { isMaster: true })
  await Promise.all(es.map(e => new memes().memes(e)))
  assert.equal(srv.posts.length, 3)
})

await check('N3 [#9] CD 关闭时沿用旧行为：残留的 CD 仍然拦一次', async () => {
  const raw = Config.getConfig()
  const oldCD = raw.meme_CD
  raw.meme_CD = 0
  try {
    redisStore.clear()
    await redis.set('Yz:paimon_meme_cd:undefined:50002', 1, { EX: 60 })
    srv.posts.length = 0
    const e = mkSameUser(1, '50002')[0]
    await new memes().memes(e)
    assert.equal(srv.posts.length, 0, '残留 CD 没有拦住')
  } finally {
    raw.meme_CD = oldCD
  }
})

/* ---------------- O [#10] 参数解析 ---------------- */
resetSrv({
  keyMap: { 测试参数: 'k_args' },
  infos: {
    k_args: {
      key: 'k_args',
      keywords: ['测试参数'],
      date_created: '2026-09-01T00:00:00.000Z',
      params_type: {
        min_images: 0, max_images: 0, min_texts: 0, max_texts: 1, default_texts: ['x'],
        args_type: {
          args_model: {
            properties: {
              user_infos: { type: 'array' },
              // 合法枚举值包含 0（左右/角度这类真实 schema 就是这样）
              rotation: { type: 'integer', enum: [0, 1], default: 1, minimum: 0, maximum: 1 },
              scale: { type: 'number', default: 1 },
              count: { type: 'integer', default: 5, minimum: 1, maximum: 10 },
            },
          },
          parser_options: [
            { dest: 'rotation', action: { type: 0, value: 0 }, names: ['左', '--left'] },
            { dest: 'rotation', action: { type: 0, value: 1 }, names: ['右', '--right'] },
            { dest: 'scale', action: { type: 1, value: null }, names: ['--scale'] },
            { dest: 'count', action: { type: 1, value: null }, names: ['--count'] },
          ],
        },
      },
    },
  },
})
await new memes().init(true)
// 注意：参数是用 `#` 跟正文分隔的（memes() 里 `text1.split('#')`），不是空格
const argsEvent = (args, uid) => newEvent(`${PREFIX}测试参数${args ? '#' + args : ''}`, { user_id: uid, sender: { user_id: uid, card: '测试', sex: 'unknown' } })
const postedArgs = () => srv.posts.at(-1)?.body.toString('utf8') || ''
const sendArgs = async (args, uid) => {
  redisStore.clear(); srv.posts.length = 0
  const e = argsEvent(args, uid)
  await new memes().memes(e)
  return postedArgs()
}

await check('O1 [#10] 合法枚举值 0 不再被默认值吞掉', async () => {
  const body = await sendArgs('左', '60001')
  assert.ok(body.includes('"rotation":0'), `args 里 rotation 不是 0: ${body.slice(-160)}`)
})

await check('O2 [#10] number 接受小数与负数', async () => {
  const body = await sendArgs('1.5', '60002')
  assert.ok(body.includes('"scale":1.5'), `scale 未按小数解析: ${body.slice(-160)}`)
  const body2 = await sendArgs('-3', '60003')
  assert.ok(body2.includes('"scale":-3'), `scale 未接受负数: ${body2.slice(-160)}`)
})

await check('O3 [#10] 越界数值被丢弃，而不是传给远端挨拒', async () => {
  const body = await sendArgs('100', '60004') // count 上限 10
  assert.ok(!body.includes('"count"'), `越界的 count 仍被传出去了: ${body.slice(-160)}`)
  assert.ok(body.includes('"scale":100'), '无范围限制的 scale 应保留')
  const body2 = await sendArgs('1.5', '60005') // count 是 integer
  assert.ok(!body2.includes('"count"'), `integer 不该接受 1.5: ${body2.slice(-160)}`)
})

await check('O4 [#10] 帮助文本会列出值为 0 的枚举名', async () => {
  redisStore.clear(); srv.posts.length = 0
  // 详情命令不能带参数分隔符，否则会被当成 args
  const e = newEvent(`${PREFIX}测试参数详情`, { user_id: '60006', sender: { user_id: '60006', card: '测试', sex: 'unknown' } })
  await new memes().memes(e)
  const text = String(e.replies.at(-1) ?? '')
  assert.ok(text.includes('左'), `枚举说明里缺少合法值 0 对应的名字: ${text}`)
  assert.ok(text.includes('右'), '枚举说明缺少另一个值')
})

/* ---------------- K [#3] 卡住的响应会被超时中断 ---------------- */
// 变异矩阵里除 timeout 之外的用例可跳过这一段（K 自身要等 3 × 15s，很慢）
if (!process.env.MEME_SKIP_K) {
  resetSrv({ ...stateOf({ 测试K: 'k_k1' }), hang: new Set(['/memes/static/infos.json']) })
  let stuck = null
  const t0 = Date.now()
  await check('K1 [#3] infos.json 卡住时不永久挂住，且能经重建拿到数据', async () => {
    stuck = await new memes().init(true)
    assert.equal(stuck.refreshed, true)
  })
  await check('K2 [#3] 确实发生了 3 次超时重试（而非快速跳过）', () => {
    const elapsed = Date.now() - t0
    assert.ok(elapsed >= 44000, `耗时 ${elapsed}ms，看起来没有真的等超时（3 × 15s + 退避）`)
    assert.ok(elapsed < 120000, `耗时 ${elapsed}ms，超时没有生效`)
  })
  await check('K3 重建结果已生效', () => {
    assert.deepEqual(hit(PREFIX + '测试K'), ['memes'])
  })
  console.log(`# K 阶段: ${JSON.stringify(stuck)} 耗时 ${Date.now() - t0}ms`)
}

/* ---------------- P [#11] #meme列表 分组与渲染 ---------------- */
const { buildMemeGroups, buildMemeListData, resolveOtherIp, FALLBACK_GROUP_NAME } = await import(
  url('plugins/chatgpt-plugin/utils/memeCategory.js')
)

/** 造一条与远端同构的 info */
const mkInfo = (key, keywords, extra = {}) => ({
  key,
  keywords,
  date_created: '2026-09-01T00:00:00.000Z',
  tags: [],
  params_type: { min_images: 0, max_images: 0, min_texts: 0, max_texts: 1 },
  ...extra,
})

/** 找出 key 落在哪个分组；顺带断言它只出现一次（互斥性） */
const groupOf = (data, key) => {
  const hits = data.groups.filter(g => g.memes.some(m => m.key === key))
  assert.equal(hits.length, 1, `${key} 应恰好归属 1 个分组，实际 ${hits.length}`)
  return hits[0].name
}

/** 分组测试用的合成 infos，覆盖 tag / 前缀 / 关键词 / 全无 四条识别路径 */
const catInfos = {
  hutao_bite: mkInfo('hutao_bite', ['胡桃啃'], { tags: ['胡桃', '米哈游', '原神'] }),
  kurogames_abby_eat: mkInfo('kurogames_abby_eat', ['阿布吃'], { tags: ['鸣潮'] }),
  mihoyo_amber_frame: mkInfo('mihoyo_amber_frame', ['安柏相框'], { tags: ['米哈游', '原神'] }),
  ba_shiroko: mkInfo('ba_shiroko', ['白子'], {}),
  smash: mkInfo('smash', ['砸'], {}),
  shock: mkInfo('shock', ['震惊'], {}),
  raise_sign: mkInfo('raise_sign', ['举牌'], {}),
  petpet: mkInfo('petpet', ['摸'], {}),
  hello_world: mkInfo('hello_world', ['helloworld'], {}),
  capoo_draw: mkInfo('capoo_draw', ['咖波画'], { tags: ['猫猫虫', '咖波'] }),
}

await check('P1 [#11] 每个 meme 恰好归属一个分组（互斥且无遗漏）', () => {
  const { groups, stats } = buildMemeGroups(catInfos, { scheme: 'hybrid' })
  const seen = groups.flatMap(g => g.memes.map(m => m.key))
  assert.equal(seen.length, Object.keys(catInfos).length, '出现次数与总数不一致（有重复或遗漏）')
  assert.equal(new Set(seen).size, seen.length, '存在重复归属')
  assert.deepEqual([...seen].sort(), Object.keys(catInfos).sort(), '有 meme 没被分到任何组')
  assert.equal(stats.totalMemes, Object.keys(catInfos).length)
})

await check('P2 [#11] tag 命中题材分组（米哈游 / 鸣潮）', () => {
  const data = buildMemeListData(catInfos, { scheme: 'hybrid' })
  assert.equal(groupOf(data, 'hutao_bite'), '米哈游')
  assert.equal(groupOf(data, 'kurogames_abby_eat'), '鸣潮')
})

await check('P3 [#11] key 前缀在无 tag 时仍能识别题材', () => {
  const data = buildMemeListData(catInfos, { scheme: 'hybrid' })
  // mihoyo_amber_frame 有 tag，这里用一条只有前缀的来验前缀通路
  const onlyPrefix = { mihoyo_bailu_kick: mkInfo('mihoyo_bailu_kick', ['白露踢'], {}) }
  const d2 = buildMemeListData(onlyPrefix, { scheme: 'hybrid' })
  assert.equal(groupOf(d2, 'mihoyo_bailu_kick'), '米哈游')
  // kong 前缀：ba_ 归蔚蓝档案
  const d3 = buildMemeListData({ ba_shiroko: catInfos.ba_shiroko }, { scheme: 'hybrid' })
  assert.equal(groupOf(d3, 'ba_shiroko'), '蔚蓝档案')
})

await check('P4 [#11] 无 tag 时按关键词语义落到功能分组', () => {
  const data = buildMemeListData(catInfos, { scheme: 'hybrid' })
  assert.equal(groupOf(data, 'smash'), '动作互动')
  assert.equal(groupOf(data, 'petpet'), '动作互动')
  assert.equal(groupOf(data, 'shock'), '情绪表情')
  assert.equal(groupOf(data, 'raise_sign'), '举牌写字')
})

await check('P5 [#11] 三条线索都不命中时落到兜底分组', () => {
  const data = buildMemeListData(catInfos, { scheme: 'hybrid' })
  assert.equal(groupOf(data, 'hello_world'), FALLBACK_GROUP_NAME)
})

await check('P6 [#11] 别的方案同样保持全覆盖（params / ip）', () => {
  // catInfos 全是纯文字表情，params 方案只够测出 1 组，这里补一份三种参数形态齐全的 fixture
  const mix = {
    only_img: mkInfo('only_img', ['甲'], { params_type: { min_images: 1, max_images: 1, min_texts: 0, max_texts: 0 } }),
    only_txt: mkInfo('only_txt', ['乙'], { params_type: { min_images: 0, max_images: 0, min_texts: 1, max_texts: 1 } }),
    both: mkInfo('both', ['丙'], { params_type: { min_images: 1, max_images: 1, min_texts: 1, max_texts: 1 } }),
  }
  const p = buildMemeGroups(mix, { scheme: 'params' })
  assert.deepEqual(p.groups.map(g => g.name).sort(), ['只需文字', '只需图片', '图文都要'].sort())
  assert.deepEqual(
    p.groups.flatMap(g => g.memes.map(m => m.key)).sort(),
    Object.keys(mix).sort(),
    'params 方案有重复或遗漏'
  )

  const ip = buildMemeGroups(catInfos, { scheme: 'ip' })
  assert.deepEqual(
    ip.groups.flatMap(g => g.memes.map(m => m.key)).sort(),
    Object.keys(catInfos).sort(),
    'ip 方案有重复或遗漏'
  )
  assert.ok(ip.groups.some(g => g.name === '米哈游'), 'ip 方案丢了题材分组')
})

await check('P7 [#11] 猫猫虫与咖波合并为同一 IP（远端两个 tag 并存）', () => {
  // 远端同一批 meme 的 tags 顺序不一致，还有只带其一的、和只靠 key 前缀的。
  // 若不把两个 tag 映射到同一个名字，这 4 条会被按 tags 顺序拆进两个二级区块。
  const mergeInfos = {
    capoo_a: mkInfo('capoo_a', ['咖波画'], { tags: ['猫猫虫', '咖波'] }),
    capoo_b: mkInfo('capoo_b', ['咖波撕'], { tags: ['咖波', '猫猫虫'] }),
    capoo_c: mkInfo('capoo_c', ['咖波爱心'], { tags: [] }),
    capoo_d: mkInfo('capoo_d', ['咖波照'], { tags: ['咖波'] }),
  }
  // 二级 IP 只在 buildMemeGroups 这一层，列表图不再渲染它，所以断言钉在分类层
  const { groups } = buildMemeGroups(mergeInfos, { scheme: 'hybrid' })
  const other = groups.find(g => g.name === '其他作品')
  assert.ok(other, '没有「其他作品」分组')
  assert.deepEqual(other.subgroups.map(s => s.name), ['猫猫虫咖波'], '二级区块名不对')
  assert.equal(other.subgroups[0].count, 4, `4 条同 IP 的 meme 应合进同一个二级区块`)
  assert.deepEqual(
    other.subgroups[0].memes.map(m => m.key).sort(),
    ['capoo_a', 'capoo_b', 'capoo_c', 'capoo_d']
  )
  // 视图层只关心它有没有被正确归到「其他作品」
  assert.equal(groupOf(buildMemeListData(mergeInfos, { scheme: 'hybrid' }), 'capoo_d'), '其他作品')
})

await check('P8 [#11] 展示字段：别名折叠、isNew、热标、参数需求', () => {
  const now = Date.parse('2026-09-14T00:00:00Z')
  const recent = new Date(now - 2 * 86400000).toISOString()
  const old = new Date(now - 400 * 86400000).toISOString()
  const data = buildMemeListData(
    {
      many_alias: mkInfo('many_alias', ['甲', '乙', '丙', '丁', '戊'], { date_created: old }),
      fresh_hot: mkInfo('fresh_hot', ['新热'], {
        date_created: recent,
        params_type: { min_images: 1, max_images: 1, min_texts: 1, max_texts: 1 },
      }),
      text_only: mkInfo('text_only', ['纯文'], {
        date_created: old,
        params_type: { min_images: 0, max_images: 0, min_texts: 1, max_texts: 1 },
      }),
      img_only: mkInfo('img_only', ['纯图'], {
        date_created: old,
        params_type: { min_images: 1, max_images: 1, min_texts: 0, max_texts: 0 },
      }),
      // 需要两张图：min_images=2，一张发送者头像填不上缺口 → 标「图」
      need_two_img: mkInfo('need_two_img', ['要两张图'], {
        date_created: old,
        params_type: { min_images: 2, max_images: 2, min_texts: 0, max_texts: 0 },
      }),
    },
    { scheme: 'hybrid', now, newThresholdDays: 30, hotThreshold: 10, usageCounts: { fresh_hot: 99 } }
  )
  const chip = key => data.groups.flatMap(g => g.memes).find(m => m.key === key)

  const a = chip('many_alias')
  assert.equal(a.aliasText, '乙 · 丙 · 丁 +1', `别名折叠不对: ${a.aliasText}`)
  assert.equal(a.hasAliases, true)

  const b = chip('fresh_hot')
  // 胶囊右侧的标记全部走 badges（模板只有一条渲染路径）：
  // 「新」不做徽标（整颗胶囊翻蓝底已表达，含义由顶部图例说明，多出 kind='new' 即说明有人加回来了）；
  // 输入需求只有两种：「图」= min_images >= 2、「文」= min_texts > 0，两者不重叠
  assert.deepEqual(
    b.badges.map(x => `${x.kind}:${x.text}`),
    ['hot:热', 'text:文'],
    `徽标不对: ${JSON.stringify(b.badges)}`
  )
  // isNew 是模板把整颗胶囊翻成实心蓝灰的唯一依据，得单独钉住
  assert.equal(b.isNew, true, '新表情的 isNew 应为 true')
  assert.equal(a.isNew, false, '400 天前创建的表情不该判为 new')

  // min_texts=1 → 文
  assert.deepEqual(
    chip('text_only').badges.map(x => `${x.kind}:${x.text}`),
    ['text:文'],
    `纯文字表情的徽标不对: ${JSON.stringify(chip('text_only').badges)}`
  )
  // min_images=2 → 图（一张头像填不上缺口，用户必须自己发图或 @ 人）
  assert.deepEqual(
    chip('need_two_img').badges.map(x => `${x.kind}:${x.text}`),
    ['img:图'],
    `需要两张图的徽标不对: ${JSON.stringify(chip('need_two_img').badges)}`
  )
  // min_images=1 且不要文字 → 一张发送者头像就够，不挂标记（971 个里 762 个都是这种，全挂等于满屏徽标）
  assert.deepEqual(chip('img_only').badges, [], 'min_images=1 不该有输入标记')
  assert.equal(chip('img_only').hasAliases, false, '只有 1 个关键词时不该显示别名分隔')
  assert.equal(data.stats.newMemes, 1, `新增统计不对: ${data.stats.newMemes}`)
})

await check('P9 [#11] 组内按使用次数降序，用得多的排前面', () => {
  const data = buildMemeListData(
    { a: mkInfo('a', ['甲']), b: mkInfo('b', ['乙']), c: mkInfo('c', ['丙']) },
    { scheme: 'hybrid', usageCounts: { b: 100, c: 5 } }
  )
  const names = data.groups.flatMap(g => g.memes).map(m => m.key)
  assert.deepEqual(names, ['b', 'c', 'a'], `排序不对: ${names}`)
})

await check('P10 [#11] infos 为空时不抛错，返回空分组', () => {
  const data = buildMemeListData({}, { scheme: 'hybrid' })
  assert.deepEqual(data.groups, [])
  assert.equal(data.stats.totalMemes, 0)
})

/* ---------------- Q [#11] #meme列表 命令层 ---------------- */
// 直接调 memesList():测试环境没有可用渲染后端，可确定地验证"本地失败 → 远端兜底"这条链
const listCmd = () => `${PREFIX}meme列表`

await check('Q1 [#11] 有 24h 缓存时直接发缓存，不再重新渲染', async () => {
  resetSrv(stateOf({ 列表测试: 'k_list' }))
  await new memes().init(true)
  fs.mkdirSync('data/memes', { recursive: true })
  fs.writeFileSync(RENDER_CACHE, 'fake-jpg')
  try {
    srv.posts.length = 0
    const e = newEvent(listCmd())
    await new memes().memesList(e)
    const last = e.replies.at(-1)
    // 图片回复是 segment.image(...) 对象，String(obj) 只会得到 [object Object]，得看 file 字段。
    // 断言到"当前 forceSharp 身份对应的那个文件名"，而不是写死 render_list.jpg ——
    // 后者在 _sharp / _plain 命名下反而匹配不上，等于把缓存身份漏测了
    assert.ok(
      String(last?.file || '').includes(RENDER_CACHE.split('/').pop()),
      `没有发缓存图: ${JSON.stringify(last)}`
    )
    assert.equal(srv.posts.length, 0, '缓存命中时不该再请求远端渲染')
  } finally {
    fs.rmSync(RENDER_CACHE, { force: true })
  }
})

await check('Q2 [#11] 无渲染后端时退回远端 render_list，命令不崩且有出图', async () => {
  resetSrv(stateOf({ 列表测试: 'k_list' }))
  await new memes().init(true)
  fs.rmSync(RENDER_CACHE, { force: true })
  const e = newEvent(listCmd())
  let ok
  await assert.doesNotReject(async () => { ok = await new memes().memesList(e) }, 'memesList 抛错了')
  assert.ok(ok, 'memesList 没有成功出图')
  const posted = srv.posts.filter(p => p.path === '/memes/render_list')
  assert.ok(posted.length >= 1, `没有请求远端 render_list，实际 POST: ${JSON.stringify(srv.posts.map(p => p.path))}`)
  // 远端返回的图应落盘，下一次才能命中缓存
  assert.ok(fs.existsSync(RENDER_CACHE), '远端返回的图没有落盘')
  fs.rmSync(RENDER_CACHE, { force: true })
})

/* ---------------- R [#12] review 修复项的回归断言 ---------------- */
await check('R1 [#12] resolveOtherIp 不受 tags 顺序影响（远端 tags 是 set，顺序不保证）', () => {
  const a = resolveOtherIp({ key: 'k_ml', tags: ['喜欢', '猫和老鼠'] })
  const b = resolveOtherIp({ key: 'k_ml', tags: ['猫和老鼠', '喜欢'] })
  assert.equal(a, b, `tags 顺序改变了二级 IP：${a} vs ${b}`)
  assert.equal(a, '猫和老鼠')
  // 只有「喜欢」这类无身份 tag 时仍归「综合」
  assert.equal(resolveOtherIp({ key: 'k_x', tags: ['喜欢'] }), '综合')
  // 顺序颠倒时不能被误判成「综合」，否则这张 meme 会掉进功能分组
  const data = buildMemeListData(
    { k_ml: mkInfo('k_ml', ['杰瑞踩'], { tags: ['喜欢', '猫和老鼠'] }) },
    { scheme: 'hybrid' }
  )
  assert.equal(groupOf(data, 'k_ml'), '其他作品', '带「喜欢」前置 tag 的 IP meme 未归入「其他作品」')
})

await check('R2 [#12] recordMemeUsage 用 MULTI 把 INCR+EXPIRE 合成原子事务', async () => {
  redisStore.clear()
  const before = redisTxCount.multi
  await new memes().recordMemeUsage('k_usage')
  assert.equal(redisTxCount.multi, before + 1, '没有开启事务——INCR+EXPIRE 两步之间断连会留下无 TTL 的永久 key')
  const stored = redisStore.get('Yz:paimon_meme_usage:k_usage')
  assert.ok(stored, '计数没写进去')
  assert.equal(stored.value, '1')
  assert.ok(stored.expireAt && stored.expireAt > Date.now(), '计数 key 没有 TTL')
})

await check('R3 [#12] 静态接口 404 判定为永久失败，不再重试 3 次', async () => {
  resetSrv({
    ...stateOf({ 测试R: 'k_r' }),
    notFound: new Set(['/memes/static/infos.json', '/memes/static/keyMap.json']),
  })
  // hitsOf 统计的是整个套件的累计命中，必须比增量而不是绝对值
  const beforeInfo = hitsOf('/memes/static/infos.json')
  const beforeKey = hitsOf('/memes/static/keyMap.json')
  const t0 = Date.now()
  await new memes().init(true)
  const elapsed = Date.now() - t0
  assert.equal(
    hitsOf('/memes/static/infos.json') - beforeInfo,
    1,
    `404 被重试了 ${hitsOf('/memes/static/infos.json') - beforeInfo} 次，退避纯属白等`
  )
  assert.equal(hitsOf('/memes/static/keyMap.json') - beforeKey, 1, 'keyMap 404 也被重试了')
  // 两次 404 若走重试路径，光退避就要 1s+2s ×2 ≈ 6s
  assert.ok(elapsed < 3000, `耗时 ${elapsed}ms，看起来仍在重试 404`)
})

await check('R4 [#12] 空关键词不会被注册成规则（否则会劫持消息路由）', async () => {
  // 纯上游重建路径：/memes/keys 给出 1 个 key，它的 keywords 是空串
  resetSrv({
    keyMap: {},
    infos: {
      k_bad: {
        key: 'k_bad',
        keywords: [''],
        date_created: '2026-09-01T00:00:00.000Z',
        params_type: { min_images: 0, max_images: 0, min_texts: 1, max_texts: 1, default_texts: ['x'] },
      },
    },
  })
  await new memes().init(true)
  // 空关键词会生成 cmdReg('')，即 /^#/（forceSharp 开启）或 /^#?/（关闭），能匹配任意 # 开头消息
  assert.deepEqual(hit('#随便一句普通消息'), [], '空关键词把普通消息也匹配了，等于劫持了消息路由')
})

await check('R5 [#12] 「图」按 min_images >= 2 判，不看 max_*', () => {
  // one 与 two 的 max_images 一样都是 2，只有 min_images 不同。
  // min_images=1 时一张发送者头像就够，不该标「图」——否则 762 个表情全挂上标记
  const data = buildMemeListData({
    one: mkInfo('one', ['一张'], { params_type: { min_images: 1, max_images: 2, min_texts: 0, max_texts: 0 } }),
    two: mkInfo('two', ['两张'], { params_type: { min_images: 2, max_images: 2, min_texts: 0, max_texts: 0 } }),
    txt: mkInfo('txt', ['文字'], { params_type: { min_images: 0, max_images: 0, min_texts: 1, max_texts: 1 } }),
  }, { scheme: 'hybrid' })
  const chip = key => data.groups.flatMap(g => g.memes).find(m => m.key === key)
  assert.deepEqual(chip('one').badges, [], 'min_images=1 被误标成需要图片')
  assert.deepEqual(chip('two').badges.map(x => x.text), ['图'], 'min_images=2 没标「图」')
  assert.deepEqual(chip('txt').badges.map(x => x.text), ['文'], 'min_texts=1 没标「文」')
})

await check('R6 [#12] 并发 init() 串行执行，不会拿旧快照互相覆盖', async () => {
  resetSrv({ ...stateOf({ 串行: 'k_ser' }), delayMs: 400 })
  reqLog.length = 0
  staticInFlight = 0
  staticMaxInFlight = 0
  const before = hitsOf('/memes/static/infos.json')

  // 不 await 第一次就发第二次：这正是旧实现的竞态窗口
  const [r1, r2] = await Promise.all([new memes().init(true), new memes().init(true)])

  assert.equal(r1.refreshed, true, '第一次刷新没成功')
  assert.equal(r2.refreshed, true, '第二次刷新没成功')
  // 两次都真的拉了一轮（而不是被合并/丢弃），否则下面的峰值断言会假通过
  assert.equal(hitsOf('/memes/static/infos.json') - before, 2, '两次刷新没有各拉一轮静态资源')
  // 一次刷新内部 infos.json 与 keyMap.json 是串行拉取的；若两次 init 并发跑，峰值会到 2
  assert.equal(staticMaxInFlight, 1, `静态接口同时在飞峰值 ${staticMaxInFlight}，说明两次刷新交织执行了`)
})

await check('R7 [#12] 不自洽的缓存会在冷启动时自愈（丢弃并重新拉远端）', async () => {
  // 旧实现只看"两个文件都非空"就绕过远端拉取，于是这种缓存会把插件卡死
  fs.mkdirSync('data/memes', { recursive: true })
  fs.writeFileSync(MEME_CACHE, JSON.stringify({
    v: 1,
    savedAt: Date.now(),
    infos: { k_only: { key: 'k_only', keywords: ['测试自愈'], params_type: { min_images: 0, max_images: 0, min_texts: 0, max_texts: 0 } } },
    // 这个关键词指向一个 infos 里不存在的 meme → 数据集不自洽
    keyMap: { 测试自愈: 'k_missing' },
  }))
  resetSrv(stateOf({ 自愈后: 'k_heal' }))
  const before = hitsOf('/memes/static/infos.json')

  const r = await new memes().init() // 非强制：就是正常的启动路径
  assert.ok(hitsOf('/memes/static/infos.json') > before, '坏缓存没被丢弃，冷启动没去拉远端')
  assert.equal(r.refreshed, true, '自愈后没拿到新数据')
  assert.deepEqual(hit(PREFIX + '自愈后'), ['memes'], '自愈后新关键词没注册')
})

await check('R8 [#12] 被截断但自洽的 keyMap 会被校验拒绝（反向一致性）', async () => {
  // infos 有 2 条，keyMap 只覆盖 1 条：单向检查（keyMap 的目标都存在）会放行，
  // 于是这份残缺 keyMap 会被永久写回缓存。反向检查必须把它拦下
  fs.mkdirSync('data/memes', { recursive: true })
  fs.writeFileSync(MEME_CACHE, JSON.stringify({
    v: 1,
    savedAt: Date.now(),
    infos: {
      k_a: { key: 'k_a', keywords: ['截断甲'], params_type: { min_images: 0, max_images: 0, min_texts: 0, max_texts: 0 } },
      k_b: { key: 'k_b', keywords: ['截断乙'], params_type: { min_images: 0, max_images: 0, min_texts: 0, max_texts: 0 } },
    },
    keyMap: { 截断甲: 'k_a' }, // k_b 没有任何关键词指回来 → 截断
  }))
  resetSrv(stateOf({ 截断后: 'k_trunc' }))
  const before = hitsOf('/memes/static/infos.json')

  const r = await new memes().init()
  assert.ok(hitsOf('/memes/static/infos.json') > before, '截断缓存没被拒绝，冷启动没去拉远端')
  assert.equal(r.refreshed, true)
  assert.deepEqual(hit(PREFIX + '截断后'), ['memes'])
})

await check('R9 [#13] 列表图缓存按 forceSharp 分身份，清理时三种名字都删', async () => {
  // 图上的指令格式由 forceSharp 决定，所以它必须进缓存身份：
  // 只靠 24h 缓存 + "更新成功才清"，改配置重启（dataset 走本地缓存 → refreshed=false）会用到旧格式的图
  fs.mkdirSync('data/memes', { recursive: true })
  const names = ['render_list_sharp.jpg', 'render_list_plain.jpg', 'render_list.jpg']
  for (const n of names) fs.writeFileSync(`data/memes/${n}`, 'x')

  new memes().clearRenderListCache()
  for (const n of names) assert.ok(!fs.existsSync(`data/memes/${n}`), `没清掉 ${n}`)

  // 当前身份必须落在带身份的文件名上，不能再是旧版固定名
  assert.ok(RENDER_CACHE.includes(FORCE ? '_sharp' : '_plain'), `缓存名没带身份: ${RENDER_CACHE}`)
})

/* ---------------- R10+ [#13] 第二轮 review 的修复项 ---------------- */
/** 合法的 params_type（数据集校验要求它存在且自洽） */
const ptype = (over = {}) => ({ min_images: 0, max_images: 0, min_texts: 0, max_texts: 1, default_texts: [''], ...over })
/** 造一个带 args_type 的 info */
const argsInfo = (key, kw, properties, parser_options) => {
  const base = infoOf(key, kw)
  return {
    ...base,
    params_type: {
      ...base.params_type,
      args_type: { args_model: { properties: { user_infos: { type: 'array' }, ...properties } }, parser_options },
    },
  }
}
/** 指定关键词发一次并取回 args JSON */
const sendArgsFor = async (kw, args, uid) => {
  redisStore.clear(); srv.posts.length = 0
  const e = newEvent(`${PREFIX}${kw}${args ? '#' + args : ''}`, {
    user_id: uid, sender: { user_id: uid, card: '测试', sex: 'unknown' },
  })
  await new memes().memes(e)
  return postedArgs()
}

await check('R10 [#13] 「每个 meme 只残留 1 个关键词」的截断 keyMap 也会被拒', async () => {
  // 只查"可达性"（这个 meme 至少被某个关键词指到）时，这种截断能完全通过 —— 必须逐关键词比对
  fs.mkdirSync('data/memes', { recursive: true })
  fs.writeFileSync(MEME_CACHE, JSON.stringify({
    v: 1, savedAt: Date.now(),
    infos: {
      k_a: { key: 'k_a', keywords: ['甲一', '甲二'], params_type: ptype() },
      k_b: { key: 'k_b', keywords: ['乙一', '乙二'], params_type: ptype() },
    },
    keyMap: { 甲一: 'k_a', 乙一: 'k_b' }, // 两个 meme 都还"可达"，但各丢了 1 个关键词
  }))
  resetSrv(stateOf({ 严格后: 'k_strict' }))
  const before = hitsOf('/memes/static/infos.json')
  const r = await new memes().init()
  assert.ok(hitsOf('/memes/static/infos.json') > before, '截断的 keyMap 没被拒绝，冷启动没去拉远端')
  assert.equal(r.refreshed, true)
  assert.deepEqual(hit(PREFIX + '严格后'), ['memes'])
})

await check('R11 [#13] params_type 不合法的数据集会被拒（否则要等命令执行时才炸）', async () => {
  fs.mkdirSync('data/memes', { recursive: true })
  fs.writeFileSync(MEME_CACHE, JSON.stringify({
    v: 1, savedAt: Date.now(),
    infos: { k_p: { key: 'k_p', keywords: ['参数坏'] } }, // 整个 params_type 都没有
    keyMap: { 参数坏: 'k_p' },
  }))
  resetSrv(stateOf({ 参数修好: 'k_fixed' }))
  const before = hitsOf('/memes/static/infos.json')
  await new memes().init()
  assert.ok(hitsOf('/memes/static/infos.json') > before, 'params_type 缺失的数据集没被拒绝')
})

await check('R12 [#13] 远端 static pair 不一致时自动转逐项重建', async () => {
  // 两个接口都 200 + 非空，但彼此不一致。旧逻辑只看"空不空"就不会进重建分支
  resetSrv({
    infos: { k_only: infoOf('k_only', '远端甲') },
    keyMap: { 远端乙: 'k_missing' }, // 指向不存在的 meme
    keys: ['k_only'],
  })
  const beforeKeys = hitsOf('/memes/keys')
  const r = await new memes().init(true)
  assert.ok(hitsOf('/memes/keys') > beforeKeys, 'pair 不一致时没有转逐项重建')
  assert.equal(r.refreshed, true, `重建后应拿到可用数据: ${JSON.stringify(r)}`)
  assert.deepEqual(hit(PREFIX + '远端甲'), ['memes'])
})

await check('R13 [#13] 单字段模板的 string / boolean 参数不再被丢弃', async () => {
  resetSrv({
    keyMap: { 测试证书: 'k_cert', 测试小丑: 'k_clown' },
    infos: {
      k_cert: argsInfo('k_cert', '测试证书', { time: { type: 'string', default: '' } },
        [{ names: ['-t', '--time'], args: [{ name: 'time', value: 'str' }], dest: null, action: null, help_text: '指定时间' }]),
      k_clown: argsInfo('k_clown', '测试小丑', { person: { type: 'boolean', default: false } },
        [{ names: ['--person', '爷'], args: null, dest: null, action: { type: 0, value: true }, help_text: '是否使用爷爷头轮廓' }]),
    },
  })
  await new memes().init(true)

  const cert = JSON.parse((await sendArgsFor('测试证书', '2026年9月19日', '80001')).match(/name="args"\r?\n\r?\n([\s\S]*?)\r?\n--/)[1])
  assert.equal(cert.time, '2026年9月19日', `string 字段没传出去: ${JSON.stringify(cert)}`)

  const clown = JSON.parse((await sendArgsFor('测试小丑', '爷', '80002')).match(/name="args"\r?\n\r?\n([\s\S]*?)\r?\n--/)[1])
  assert.equal(clown.person, true, `boolean 字段没被开关名触发: ${JSON.stringify(clown)}`)
})

await check('R14 [#13] 没有文字时不提交 texts 字段（否则会顶掉上游 default_texts）', async () => {
  // `''.split('/', n)` 得到 `['']`，服务端过滤空串后等于显式传了个空文本，
  // 上游 default_texts 就被覆盖成空，可选文本的模板会渲染成空文字版
  resetSrv({ infos: { k_opt: infoOf('k_opt', '测试可选文', { min_images: 0, max_images: 0, min_texts: 0, max_texts: 1 }) } })
  await new memes().init(true)
  const body = await sendArgsFor('测试可选文', '', '80003')
  assert.ok(!body.includes('name="texts"'), `没文字却提交了 texts: ${body.slice(-200)}`)
})

await check('R15 [#13] 升级后第一次启动会迁移旧版双文件缓存', async () => {
  fs.mkdirSync('data/memes', { recursive: true })
  fs.rmSync(MEME_CACHE, { force: true })
  fs.writeFileSync('data/memes/infos.json', JSON.stringify({ k_old: { key: 'k_old', keywords: ['旧缓存词'], params_type: ptype() } }))
  fs.writeFileSync('data/memes/keyMap.json', JSON.stringify({ 旧缓存词: 'k_old' }))
  // 远端直接挂掉：没有迁移的话，这份完好的旧缓存会被无视、meme 全没了
  resetSrv({ down: true })
  const r = await new memes().init()
  assert.equal(r.refreshed, false, '本地迁移不该被算成远端刷新')
  assert.deepEqual(hit(PREFIX + '旧缓存词'), ['memes'], '旧缓存没被迁移，meme 全没了')
  assert.ok(fs.existsSync(MEME_CACHE), '没落成 dataset.json')
  assert.ok(!fs.existsSync('data/memes/infos.json'), '旧文件没删掉')
})

await check('R16 [#14] keyMap 里的「额外触发词」会被拒（否则它会变成一条消息路由）', async () => {
  fs.mkdirSync('data/memes', { recursive: true })
  fs.writeFileSync(MEME_CACHE, JSON.stringify({
    v: 1, savedAt: Date.now(),
    infos: { k_a: { key: 'k_a', keywords: ['甲'], params_type: ptype() } },
    // 「乙」不属于 k_a。只查"目标存在"的正向检查会放行，而 memeKeyRules() 会把它注册成命令
    keyMap: { 甲: 'k_a', 乙: 'k_a' },
  }))
  resetSrv(stateOf({ 额外别名后: 'k_extra' }))
  const before = hitsOf('/memes/static/infos.json')
  const r = await new memes().init()
  assert.ok(hitsOf('/memes/static/infos.json') > before, '额外触发词没被拒绝，冷启动没去拉远端')
  assert.equal(r.refreshed, true)
  assert.deepEqual(hit(PREFIX + '乙'), [], '「乙」被当成命令注册了')
})

await check('R17a [#14] 出图接口返回 200 text/html 时不发图，并给出明确提示', async () => {
  resetSrv({ ...stateOf({ 测试非图: 'k_notimg' }), notImage: new Set(['*']) })
  await new memes().init(true)
  redisStore.clear(); srv.posts.length = 0
  const e = newEvent(`${PREFIX}测试非图`, { user_id: '90001', sender: { user_id: '90001', card: '测试', sex: 'unknown' } })
  await new memes().memes(e)
  assert.equal(srv.posts.length, 1, '应当已经打到远端')
  assert.ok(
    String(e.replies.at(-1)).includes('不是图片'),
    `没给出明确提示: ${JSON.stringify(e.replies.at(-1))}`
  )
  assert.ok(!e.replies.some(r => r && r.type === 'image'), '把 HTML 错页当成图片发出去了')
})

await check('R17b [#14] 远端 render_list 返回 200 text/html 时不落盘（否则错页会被缓存 24h）', async () => {
  resetSrv({ ...stateOf({ 列表非图: 'k_l1' }), notImage: new Set(['/memes/render_list']) })
  await new memes().init(true)
  fs.rmSync(RENDER_CACHE, { force: true })
  const e = newEvent(listCmd())
  await new memes().memesList(e) // 测试环境没有本地渲染后端，必然走远端兜底
  assert.ok(!fs.existsSync(RENDER_CACHE), 'HTML 错页被当成图片落盘了')
})

await check('R18 [#14] 详情会告诉用户 string / boolean 参数怎么传', async () => {
  // 功能支持了但帮助不写，用户猜不出 `#万花筒#圆`，等于没支持
  resetSrv({
    keyMap: { 测试万花筒: 'k_kale', 测试奖状2: 'k_cert2' },
    infos: {
      k_kale: argsInfo('k_kale', '测试万花筒', { circle: { type: 'boolean', default: false, description: '是否将图片变为圆形' } },
        [{ names: ['--circle', '圆'], args: null, dest: null, action: { type: 0, value: true }, help_text: '是否将图片变为圆形' }]),
      k_cert2: argsInfo('k_cert2', '测试奖状2', { time: { type: 'string', default: '', description: '指定时间' } },
        [{ names: ['-t', '--time'], args: [{ name: 'time', value: 'str' }], dest: null, action: null, help_text: '指定时间' }]),
    },
  })
  await new memes().init(true)

  const detailOf = async (kw, uid) => {
    redisStore.clear(); srv.posts.length = 0
    const e = newEvent(`${PREFIX}${kw}详情`, { user_id: uid, sender: { user_id: uid, card: '测试', sex: 'unknown' } })
    await new memes().memes(e)
    return String(e.replies.at(-1) ?? '')
  }

  const boolText = await detailOf('测试万花筒', '90002')
  assert.ok(boolText.includes('圆'), `boolean 的开关名没出现在详情里: ${boolText}`)
  assert.ok(boolText.includes('如 #'), `没给出可照抄的写法: ${boolText}`)

  const strText = await detailOf('测试奖状2', '90003')
  assert.ok(strText.includes('指定时间'), `string 字段的说明丢了: ${strText}`)
})

await check('R15b [#14] 迁移时新缓存写失败 → 绝不能删旧缓存', async () => {
  // 典型事故：saveMemeDataset() 把写盘失败吞成一句日志 → 迁移继续往下删旧文件
  // → 新缓存没落盘 + 旧缓存被删 + 下次启动远端又挂 = 无任何可用数据
  fs.mkdirSync('data/memes', { recursive: true })
  fs.rmSync(MEME_CACHE, { force: true })
  // 用同名目录占住 .tmp 路径，让 saveMemeDataset 的 writeFileSync 必然失败（EISDIR）
  fs.rmSync(`${MEME_CACHE}.tmp`, { recursive: true, force: true })
  fs.mkdirSync(`${MEME_CACHE}.tmp`, { recursive: true })
  try {
    fs.writeFileSync(LEGACY_INFOS, JSON.stringify({ k_keep: { key: 'k_keep', keywords: ['保命词'], params_type: ptype() } }))
    fs.writeFileSync(LEGACY_KEYMAP, JSON.stringify({ 保命词: 'k_keep' }))
    resetSrv({ down: true }) // 远端也挂着，只剩旧缓存这一条命
    await new memes().init()

    assert.ok(fs.existsSync(LEGACY_INFOS), '写盘失败却把旧 infos.json 删了')
    assert.ok(fs.existsSync(LEGACY_KEYMAP), '写盘失败却把旧 keyMap.json 删了')
    assert.ok(!fs.existsSync(MEME_CACHE), '写盘失败却出现了 dataset.json')
    // 本次启动也要能用（数据已进内存），否则"保住了文件但这次不可用"同样不合格
    assert.deepEqual(hit(PREFIX + '保命词'), ['memes'], '迁移失败时本次启动也该可用')
  } finally {
    fs.rmSync(`${MEME_CACHE}.tmp`, { recursive: true, force: true })
  }
})

/* ---------------- R19+ [#15] 第三轮 review 的修复项 ---------------- */
/** 写一份 dataset.json 当"坏缓存"，把脏输入喂给校验器 */
const seedCache = (infos, keyMap) => {
  fs.mkdirSync('data/memes', { recursive: true })
  fs.writeFileSync(MEME_CACHE, JSON.stringify({ v: 1, savedAt: Date.now(), infos, keyMap }))
}
/** 断言这份坏缓存没有被采纳（冷启动会去拉远端），且校验器本身不抛错 */
const assertRejectedAndHealed = async (srvState, nextKeyword) => {
  resetSrv(stateOf(srvState))
  const before = hitsOf('/memes/static/infos.json')
  let threw = null
  const r = await new memes().init().catch(e => { threw = e; return null })
  assert.equal(threw, null, `校验器被脏输入打崩了: ${threw && threw.message}`)
  assert.ok(hitsOf('/memes/static/infos.json') > before, '脏数据集没被拒绝，冷启动没去拉远端')
  assert.equal(r.refreshed, true)
  assert.deepEqual(hit(PREFIX + nextKeyword), ['memes'], '自愈后没拿到新数据')
}

await check('R19a [#15] args_model.properties 里有非对象节点 → 数据集被拒', async () => {
  // 容器类型对了但节点是 null：旧校验会放行，之后 `propInfo.enum` 直接 TypeError
  seedCache(
    { k_bad: { key: 'k_bad', keywords: ['坏节点'], params_type: ptype({
      args_type: { args_model: { properties: { user_infos: { type: 'array' }, foo: null } }, parser_options: [] },
    }) } },
    { 坏节点: 'k_bad' }
  )
  await assertRejectedAndHealed({ 坏节点后: 'k_fix1' }, '坏节点后')
})

await check('R19b [#15] parser_options 里有非对象项 → 数据集被拒', async () => {
  seedCache(
    { k_bad2: { key: 'k_bad2', keywords: ['坏选项'], params_type: ptype({
      args_type: { args_model: { properties: { user_infos: { type: 'array' }, foo: { type: 'string' } } }, parser_options: [null] },
    }) } },
    { 坏选项: 'k_bad2' }
  )
  await assertRejectedAndHealed({ 坏选项后: 'k_fix2' }, '坏选项后')
})

await check('R22 [#15] keyMap 指向 toString / __proto__ 时被拒而不是抛错', async () => {
  // 这两个键在 Object.prototype 上是 truthy，旧的 `infos[target]` 会取到函数/对象，
  // 下一句 `infos[target].keywords` 就 TypeError —— 校验器被脏输入打崩
  const dirtyKeyMap = JSON.parse('{"甲":"k_a","恶意词1":"toString","恶意词2":"__proto__"}')
  seedCache({ k_a: { key: 'k_a', keywords: ['甲'], params_type: ptype() } }, dirtyKeyMap)
  await assertRejectedAndHealed({ 原型后: 'k_proto' }, '原型后')
})

await check('R20 [#15] 随机 meme 不会选中没有可用关键词的条目', async () => {
  resetSrv({
    keyMap: { 随机种子: 'k_seed' },
    infos: {
      // 符合随机筛选条件（min_images=1 / min_texts=0），但关键词会被归一化清空
      k_empty: { key: 'k_empty', keywords: [], params_type: ptype({ min_images: 1, max_images: 1, min_texts: 0, max_texts: 0 }) },
      k_seed: { key: 'k_seed', keywords: ['随机种子'], params_type: ptype() },
    },
  })
  await new memes().init(true)
  redisStore.clear(); srv.posts.length = 0
  const e = newEvent(`${PREFIX}随机meme`, { user_id: '90004', sender: { user_id: '90004', card: '测试', sex: 'unknown' } })
  await new memes().randomMemes(e) // 修之前会 e.msg = undefined → memes() 里 `.replace` 抛错
  assert.equal(srv.posts.length, 0, '抽中了空关键词条目并打了远端')
  assert.match(String(e.replies.at(-1)), /暂无可用随机 meme/, `没给出明确提示: ${JSON.stringify(e.replies)}`)
})

await check('R21 [#15] string 参数里能带 #（只按第一个 # 切分）', async () => {
  resetSrv({
    keyMap: { 测试链接: 'k_url' },
    infos: {
      k_url: argsInfo('k_url', '测试链接', { message: { type: 'string', default: '' } },
        [{ names: ['-m', '--message'], args: [{ name: 'message', value: 'str' }], dest: null, action: null, help_text: '内容' }]),
    },
  })
  await new memes().init(true)
  const body = await sendArgsFor('测试链接', 'https://example.com/page#section', '90005')
  const args = JSON.parse(body.match(/name="args"\r?\n\r?\n([\s\S]*?)\r?\n--/)[1])
  assert.equal(args.message, 'https://example.com/page#section', `# 之后的内容被截断了: ${JSON.stringify(args)}`)
})

await check('R23 [#15] 更新成功但落盘失败时，回执要说清楚', async () => {
  resetSrv(stateOf({ 落盘测试: 'k_persist' }))
  // 用同名目录占住 .tmp，让 saveMemeDataset 必然失败
  fs.rmSync(`${MEME_CACHE}.tmp`, { recursive: true, force: true })
  fs.mkdirSync(`${MEME_CACHE}.tmp`, { recursive: true })
  try {
    const e = newEvent(`${PREFIX}表情包更新`, { user_id: '12345', isMaster: true, sender: { user_id: '12345', card: '测试', sex: 'unknown' } })
    await new memes().memesUpdate(e)
    const last = String(e.replies.at(-1) ?? '')
    assert.match(last, /本地缓存写入失败/, `没提示落盘失败: ${last}`)
    assert.match(last, /重启后/, `没说明重启后的后果: ${last}`)
  } finally {
    fs.rmSync(`${MEME_CACHE}.tmp`, { recursive: true, force: true })
  }
})

await check('R24 [#16] parser_options[].args / names 里的坏元素 → 数据集被拒且不抛错', async () => {
  // `args: [null]` 能过"args 是数组"这关，但 buildOptionValueMap() 里
  // `(opt.args || []).some(a => a.name === prop)` 会直接解引用 null —— 校验器自己被脏输入打崩
  seedCache(
    { k_bad3: { key: 'k_bad3', keywords: ['坏元素'], params_type: ptype({
      args_type: {
        args_model: { properties: { user_infos: { type: 'array' }, foo: { type: 'string' } } },
        parser_options: [{ action: { type: 0, value: true }, args: [null], names: ['--foo'] }],
      },
    }) } },
    { 坏元素: 'k_bad3' }
  )
  await assertRejectedAndHealed({ 坏元素后: 'k_fix3' }, '坏元素后')

  // 顺手把 names[] 也钉住
  seedCache(
    { k_bad4: { key: 'k_bad4', keywords: ['坏名字'], params_type: ptype({
      args_type: {
        args_model: { properties: { user_infos: { type: 'array' }, bar: { type: 'string' } } },
        parser_options: [{ action: { type: 0, value: true }, args: null, names: [null] }],
      },
    }) } },
    { 坏名字: 'k_bad4' }
  )
  await assertRejectedAndHealed({ 坏名字后: 'k_fix4' }, '坏名字后')
})

await check('R25 [#17] 关键词被多个 meme 共用时必须接受，不能判成「截断」', async () => {
  // 实测 971 个 meme 里有 15 个关键词被 ≥2 个 meme 声明（「嗦」属于 suck + kou）。
  // 一个关键词在 keyMap 里只能有一个目标，所以要求"回指自己"必然误杀合法数据 ——
  // 曾经因此让逐项重建出的数据整体被判不合法，#表情包更新 直接失败
  seedCache(
    {
      k_s1: { key: 'k_s1', keywords: ['共用词', '甲'], params_type: ptype() },
      k_s2: { key: 'k_s2', keywords: ['共用词', '乙'], params_type: ptype() },
    },
    { 共用词: 'k_s2', 甲: 'k_s1', 乙: 'k_s2' } // 共用词指向 s2，s1 那侧"回指不到自己"
  )
  resetSrv(stateOf({ 共享后: 'k_shared' }))
  const before = hitsOf('/memes/static/infos.json')
  const r = await new memes().init()
  assert.equal(hitsOf('/memes/static/infos.json'), before, '共享关键词的合法数据被误判为截断，又去拉远端了')
  assert.equal(r.refreshed, false, '走本地缓存时不该算成刷新')
  // 两个 meme 都要能用，且共用词落在 keyMap 指定的那个上
  assert.deepEqual(hit(PREFIX + '共用词'), ['memes'])
  assert.deepEqual(hit(PREFIX + '甲'), ['memes'])
})

/* ---------------- 汇总 ---------------- */
await closeServer()
// 每条断言已在 check() 里实时打印过，这里只重列失败项 + 小计，避免同一行出现两次
const failedLines = results.filter(r => r.startsWith('FAIL'))
if (failedLines.length) console.log(`\n======== 失败项 ========\n${failedLines.join('\n')}`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
