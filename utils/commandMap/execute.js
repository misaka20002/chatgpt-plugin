import { FRAMEWORK_LOADER_SPEC } from '../capability/paths.js'
import { commandKey } from './patch.js'

/**
 * 代执行：把拼好的指令发进框架原生的消息分发。
 *
 * 四条硬约束：
 *   1. **走框架自己的 deal()**。自己重造一套匹配必然与框架分叉：框架会按插件启用状态、
 *      事件类型过滤，还会跳过某些插件注册的空正则规则；重造的结果是把指令派给了不相干的
 *      插件——2026-10-28 线上「点赞」就是这样被派给了 example/add.js，插件全程没点赞。
 *   2. **权限交给框架**。放行与否一律由框架的规则与权限位决定（`loader.filtPermission`）。
 *   3. **存在性校验先于执行**。地图可能来自别人的 fork，写法在你装的版本里未必存在；
 *      跑一遍真实匹配是唯一能拦住"调用不存在的指令"的闸门。
 *   4. **不许谎报成功**。插件有没有回话、是不是被框架拒了，都必须如实上报。
 */

const LOG_PREFIX = '[Chatgpt][commandMap]'

/** 框架拒绝权限时的固定话术：出现它就说明插件根本没干活 */
const FRAMEWORK_DENIED = '暂无权限'

/**
 * 代执行事件的标记。
 *
 * 用途：让「只对代执行事件生效」的逻辑能认出这条消息是我们伪造的，
 * 而不影响同一时刻进来的其它正常消息。
 */
const DELEGATE_FLAG = '__chatgpt_delegate'

/**
 * 在插件优先级链上找第一个能匹配这条写法的规则。
 * @param {string} call 完整指令写法
 * @param {{ loader: object, e?: object }} options
 * @returns {{ item: object, rule: object } | null}
 */
export function findRuleByCall (call, { loader, e } = {}) {
  if (!loader || !Array.isArray(loader.priority) || !call) return null

  for (const item of loader.priority) {
    const plugin = resolvePlugin(item)
    if (!plugin || !Array.isArray(plugin.rule)) continue
    for (const rule of plugin.rule) {
      if (!rule?.reg) continue
      if (rule.event && typeof loader.filtEvent === 'function' && !loader.filtEvent(e, rule)) continue
      if (isCatchAll(rule.reg)) continue
      if (!safeTest(rule.reg, call)) continue
      return { item, rule }
    }
  }
  return null
}

/**
 * 执行一条指令。
 *
 * `target` 存在时**以他人身份执行**（仅主人可发起）：换掉发送者与群成员身份，并把 `isMaster`
 * 置 false——不这么做，被 @ 的普通群友就能借主人的壳跑管理指令，等于凭空提权。
 *
 * @param {object} e 真实消息事件（只改文本与身份，执行完还原）
 * @param {string} call 完整指令写法
 * @param {{ loader?: object, target?: { userId: string|number, member?: object } }} [options]
 * @returns {Promise<{ ok: boolean, reason?: string, message?: string }>}
 */
export async function executeCommand (e, call, { loader, target } = {}) {
  const resolved = loader || await loadFrameworkLoader()
  if (!resolved) return { ok: false, reason: 'no-loader' }
  if (typeof resolved.deal !== 'function') return { ok: false, reason: 'no-loader' }

  // 身份：影子事件。原事件一个字段都不动，框架读到的 member/isMaster 是被 @ 的人
  let evt = e
  if (target) {
    try {
      evt = switchIdentity(e, target)
    } catch (err) {
      globalThis.logger?.warn?.(`${LOG_PREFIX} 切换身份失败：${err?.stack || err?.message || err}`)
      return { ok: false, reason: 'handler-error', message: err?.message || String(err) }
    }
  }

  // 存在性校验：写法必须在本机真实存在，否则换了版本就是调了个寂寞
  if (!findRuleByCall(call, { loader: resolved, e: evt })) return { ok: false, reason: 'not-found' }

  const snapshot = snapshotEvent(evt)
  markDelegated(evt)
  prepareMessage(evt, call)

  // 插件多半用 e.reply 回话。数一下有没有回话，才能判断这次到底办没办成——
  // 只看「派发成功」会把插件拒绝执行的情况说成成功（2026-10-28 线上教训）。
  let replies = 0
  let denied = false
  const originalReply = evt.reply
  if (typeof originalReply === 'function') {
    Object.defineProperty(evt, 'reply', {
      value: async (...args) => {
        // 框架拒绝权限时回的是固定话术：那不是插件干活的回话，不能算成功
        if (typeof args[0] === 'string' && args[0].includes(FRAMEWORK_DENIED)) {
          denied = true
          return originalReply.apply(evt, args)
        }
        const res = await originalReply.apply(evt, args)
        // 框架的 reply 会把发送失败包成 { error: [...] }，空消息返回 false。
        // 这两种都说明「话没送到群里」，不能计入成功（2026-10-28 审查发现）。
        if (res === false) return res
        if (res && typeof res === 'object' && res.error) return res
        replies += 1
        return res
      },
      writable: true,
      configurable: true,
      enumerable: false
    })
  }

  let failure = null
  try {
    // accept 阶段会改写 e.msg，代执行必须挡住（见 guardAccept 的说明）
    const unguard = guardAccept(resolved)
    try {
      await resolved.deal(evt)
    } finally {
      unguard()
    }
  } catch (err) {
    // 插件的异常必须落地：否则工具只会说「已执行」，而图/文其实没发出去
    failure = { ok: false, reason: 'handler-error', message: err?.message || String(err) }
    globalThis.logger?.warn?.(`${LOG_PREFIX} 执行 ${call} 时出错：${err?.stack || err?.message || err}`)
  } finally {
    snapshot()
    unmarkDelegated(evt)
  }

  if (failure) return failure
  if (denied) return { ok: false, reason: 'no-permission' }
  if (replies > 0) return { ok: true }

  // 到这里说明：指令派发出去了，但插件既没回话、也没报权限问题。
  // 最常见的原因是插件自己抛了异常（框架会吞掉异常，只写日志），
  // 比如图片处理失败——这种情况必须如实说没办成，不能报成功。
  globalThis.logger?.mark?.(`${LOG_PREFIX} ${call} 派发完毕但没有回话，判定为未完成`)
  return { ok: false, reason: 'no-effect', message: '插件没有回话' }
}

/**
 * 把事件改写成「这条消息就是这条指令」。
 *
 * 框架的 dealEvent 会用消息段重建 e.msg，所以这里必须重建段数组：
 * **只保留 at 段 + 一条指令文本段**。
 * 原消息的第一段通常是 at（框架只看 at 段上的 qq，不看它的 text），
 * 照原样改写 text 的话 e.msg 会被还原成用户原话，规则一个都匹配不上
 * （2026-10-28 线上：代执行「点赞」派发出去却没有任何插件接手）。
 *
 * @param {object} e
 * @param {string} call
 */
function prepareMessage (e, call) {
  const segments = Array.isArray(e.message) ? e.message : []
  const ats = segments.filter(seg => seg?.type === 'at').map(seg => ({ ...seg }))
  e.message = [...ats, { type: 'text', text: call }]
  e.msg = ''
  // 代执行是明确要求执行某条指令，不该被「只关注主动 at」的策略拦下
  e.only_reply_at = true
}

/**
 * 记下事件里会被我们改掉的字段，执行完原样还回去。
 *
 * 代执行借用的是真人那条消息的事件对象；改完不还原的话，
 * 外层框架的后续处理（比如回复引用、日志）会看到被改坏的 msg。
 *
 * @param {object} e
 * @returns {() => void} 还原函数
 */
function snapshotEvent (e) {
  const saved = {
    msg: e.msg,
    message: e.message,
    only_reply_at: e.only_reply_at,
    replyDesc: Object.getOwnPropertyDescriptor(e, 'reply')
  }
  return () => {
    e.msg = saved.msg
    e.message = saved.message
    e.only_reply_at = saved.only_reply_at
    try {
      // 框架的 deal() 会把 e.reply 再包一层；派发完要还原成我们进来时的样子
      if (saved.replyDesc) Object.defineProperty(e, 'reply', saved.replyDesc)
      else delete e.reply
    } catch {}
  }
}

function markDelegated (e) {
  try {
    Object.defineProperty(e, DELEGATE_FLAG, {
      value: true,
      writable: true,
      enumerable: false,
      configurable: true
    })
  } catch {}
}

function unmarkDelegated (e) {
  try {
    delete e[DELEGATE_FLAG]
  } catch {}
}

/**
 * 挡住 accept 阶段对指令的改写。
 *
 * 框架 deal() 的顺序是「先 accept，再按规则匹配」。accept 阶段的插件会改写 e.msg，
 * 把消息换成自己的规范写法——这是插件之间的约定，对真人消息是合理的。
 * 但对代执行它是劫持：2026-10-28 线上「#点赞」被 genshin 的 role.js 抢走，
 * 因为「点赞」是角色「班尼特」的别名，它把指令改写成了「#角色详情」，
 * 结果派给了游戏角色插件，点赞插件根本没被叫醒（真人手打「#点赞」也一样会中招）。
 *
 * 我们给的写法来自能力地图，本身已经是规范写法，不该再被改一次。
 * 做法：派发期间临时包一层 accept——原 accept 照跑（它的准入判断还得生效），
 * 但只要它改写了 e.msg，就还原回我们指定的指令，并且不承认它对这条消息的「抢占」。
 *
 * 只对带标记的事件生效：同一时刻进来的其它正常消息不受影响。
 *
 * @param {object} loader 框架加载器
 * @returns {() => void} 还原函数
 */
function guardAccept (loader) {
  const patched = []
  const seen = new Set()
  for (const item of loader?.priority || []) {
    const proto = item?.class?.prototype
    if (!proto || typeof proto.accept !== 'function' || seen.has(proto)) continue
    seen.add(proto)
    const original = proto.accept
    proto.accept = async function (e) {
      const before = e?.msg
      const res = await original.call(this, e)
      if (!e || !e[DELEGATE_FLAG] || e.msg === before) return res
      // 撤销指令改写：代执行的指令以我们给的写法为准
      e.msg = before
      // 原 accept 因为「抢到了这条消息」返回 true；代执行不认这个抢占，
      // 让 accept 阶段继续往下走，规则匹配才能拿到我们指定的指令。
      if (res === true) return undefined
      return res
    }
    patched.push([proto, original])
  }
  return () => {
    for (const [proto, original] of patched) {
      try {
        proto.accept = original
      } catch {}
    }
  }
}

/**
 * 造一个"以被 @ 者身份出现"的影子事件。
 *
 * 不改原事件，原因：框架在 `lib/bot.js` 用
 * `Object.defineProperty(data, "member", { value: ... })` 定义成员，
 * 在 `lib/plugins/loader.js` 用 `{ value: ..., writable: false, configurable: false }`
 * 定义 `isMaster`——直接赋值必抛 TypeError，且描述符也改不掉。
 *
 * 做法：`Object.create(e)` 建一层影子，身份字段写为自己的属性，其余读取穿透回原事件。
 * 插件拿到的仍是完整事件（group / reply / message 全在），只是身份换成了被 @ 的人。
 *
 * @param {object} e
 * @param {{ userId: string|number, member?: object }} target
 * @returns {object} 影子事件；目标缺失时原样返回 e
 */
function switchIdentity (e, target) {
  const userId = String(target?.userId ?? '')
  const member = target?.member
  if (!userId && !member) return e

  const shadow = Object.create(e)
  const id = Number(userId) || userId
  const own = (key, value) => {
    Object.defineProperty(shadow, key, { value, writable: true, enumerable: true, configurable: true })
  }

  own('user_id', id)
  // 连角色一起换：只改 user_id 会留下主人的 role/nickname，插件按发送者判权限时会误判
  own('sender', {
    ...(e.sender || {}),
    user_id: id,
    role: member?.is_owner ? 'owner' : member?.is_admin ? 'admin' : 'member'
  })
  if (member) own('member', member)
  // 关键：不能保留主人的 isMaster，否则等于用主人权限替别人执行
  own('isMaster', false)
  return shadow
}

function resolvePlugin (item) {
  if (item?.plugin && Array.isArray(item.plugin.rule)) return item.plugin
  if (typeof item?.class === 'function') {
    try {
      const instance = new item.class({})
      if (instance && Array.isArray(instance.rule)) return instance
    } catch {
      return null
    }
  }
  return null
}

function safeTest (reg, call) {
  try {
    return reg instanceof RegExp ? reg.test(call) : new RegExp(reg).test(call)
  } catch {
    return false
  }
}

/** 用一段不会出现在任何指令里的文字，探这条正则是不是「什么都匹配」 */
const CATCH_ALL_PROBE = 'probe'

/**
 * 是不是「匹配一切」的正则。
 *
 * 有些插件注册了「匹配任意文本」的空规则（框架会按插件启用状态把它们滤掉，
 * 但我们做存在性校验时不能被它们骗到：否则任何写法都被判成「本机有这条指令」）。
 * @param {RegExp|string} reg
 * @returns {boolean}
 */
function isCatchAll (reg) {
  try {
    const probe = reg instanceof RegExp ? new RegExp(reg.source, reg.flags.replace('g', '')) : new RegExp(reg)
    return probe.test(CATCH_ALL_PROBE)
  } catch {
    return false
  }
}

async function loadFrameworkLoader () {
  try {
    const mod = await import(FRAMEWORK_LOADER_SPEC)
    const loader = mod?.default ?? mod
    if (loader && Array.isArray(loader.priority)) return loader
  } catch (err) {
    globalThis.logger?.warn?.(`${LOG_PREFIX} 读取框架加载器失败：${err.message}`)
  }
  return globalThis.Bot?.loader || null
}

/** 按写法在索引里找条目；查不到返回 null，由调用方决定降级策略 */
export function findCommandEntry (entries, call) {
  const key = commandKey(call)
  return (entries || []).find(entry => commandKey(entry.command) === key) || null
}

/**
 * 这条写法在本机能不能真的派发出去。
 *
 * 索引可能来自别人的 fork，也可能混着展开正则时留下的伪写法（`#^服务器状态`）：
 * 它们在索引里排得上名次，却过不了存在性校验。选候选前先用同一把尺子筛一遍，
 * 好过派发出去再报 not-found——那时用户已经收到「没匹配到」了。
 *
 * @param {string} call 完整指令写法
 * @param {{ e?: object }} [options]
 * @returns {Promise<boolean>}
 */
export async function isCallableCall (call, { e } = {}) {
  if (!call) return false
  const loader = await loadFrameworkLoader()
  return Boolean(loader && findRuleByCall(call, { loader, e }))
}
