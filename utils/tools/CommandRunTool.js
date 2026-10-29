import { AbstractTool } from './AbstractTool.js'
import { loadEntries, resolveCommand, suggestEntries, UPDATE_COMMAND } from '../capability/map.js'

const LOG_PREFIX = '[ChatGPT][map]'

const FAILED = 'Error: '

/** 框架 filtPermission 拒绝时的固定话术：出现它就说明插件根本没干活 */
const FRAMEWORK_DENIED = '暂无权限'

/**
 * 派发器。默认走框架的 `loader.deal`，测试与宿主可以换掉。
 *
 * 用可注入而不是直接 import：`lib/` 是宿主的东西，测试环境里没有，
 * 静态 import 会让整个模块加载失败，连带把纯函数的测试也拖下水。
 */
let dispatcher = null
/** 框架加载器实例：accept 守卫要拿它的 priority 链 */
let frameworkLoader = null

/** 注入派发器（测试用） */
export function setCommandDispatcher (fn) {
  dispatcher = fn
}

async function getDispatcher () {
  if (dispatcher) return dispatcher
  const { default: loader } = await import('../../../../lib/plugins/loader.js')
  frameworkLoader = loader
  dispatcher = event => loader.deal(event)
  return dispatcher
}

/** 候选一次最多列几条：再多就该让模型换个说法，而不是把整张表塞回去 */
const MAX_CANDIDATES = 6

/**
 * 挡住 accept 阶段对指令的改写。
 *
 * 框架 `deal()` 的顺序是「先 accept，再按规则匹配」。accept 阶段的插件会把消息改成自己的
 * 规范写法——对真人消息是合理的插件间约定，对代执行却是劫持：2026-10-28 线上「#点赞」被
 * genshin 的 role.js 抢走（「点赞」是角色「班尼特」的别名），改写成了「#角色详情」，点赞
 * 插件根本没被叫醒。我们给的写法已经是地图里的规范写法，不该再被改一次。
 *
 * 做法：派发期间临时包一层 accept——原逻辑照跑（准入判断仍生效），但它一旦改写了 msg，
 * 就还原回我们指定的指令，并且不承认它对这条消息的「抢占」。
 * 只对带标记的事件生效，同一时刻的其它正常消息不受影响。
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
    proto.accept = async function (event) {
      const before = event?.msg
      const res = await original.call(this, event)
      if (!event || !event.__commandMapNested || event.msg === before) return res
      event.msg = before
      if (res === true) return undefined
      return res
    }
    patched.push([proto, original])
  }
  return () => {
    for (const [proto, original] of patched) {
      try {
        proto.accept = original
      } catch (err) {
        // 还原失败会让 accept 守卫留下来：往后每条消息都会被多包一层，必须留痕
        logger.error(`${LOG_PREFIX} accept 守卫还原失败：${err?.message || err}`)
      }
    }
  }
}

/**
 * 把这条消息改写成「用户自己发了这条指令」，返回还原函数。
 *
 * **直接改原事件，不造影子对象**：影子（无论浅拷贝还是原型链）都会让插件读到残缺事件——
 * 框架给 bot / group / member / isMaster 用的是 defineProperty，浅拷贝拿不到；原型链虽然
 * 能读到，但任何 `Object.assign` / `hasOwn` / 序列化都会露馅。能跑通的上一版就是直接改
 * `e.msg` / `e.message`，执行完还原。
 *
 * 三个要点都来自那一版的线上教训：
 *   - `message` 保留 at 段：框架会用消息段重建 `e.msg`，丢了 at 段，「只回应 at」的规则全失配；
 *   - `msg` 置空串：让框架用新 message 重建，而不是沿用我们手写的值；
 *   - `only_reply_at = true`：代执行是明确要求执行某条指令，不该被「只关注主动 at」的策略拦下。
 *
 * @param {object} e 原始消息事件
 * @param {string} text 要执行的完整指令
 * @returns {() => void} 还原函数
 */
function prepareMessage (e, text) {
  const saved = {
    msg: e.msg,
    message: e.message,
    raw_message: e.raw_message,
    only_reply_at: e.only_reply_at
  }

  const segments = Array.isArray(e.message) ? e.message : []
  const ats = segments.filter(seg => seg?.type === 'at').map(seg => ({ ...seg }))

  e.message = [...ats, { type: 'text', text }]
  e.msg = ''
  e.only_reply_at = true

  return () => {
    e.msg = saved.msg
    e.message = saved.message
    e.raw_message = saved.raw_message
    if (saved.only_reply_at === undefined) delete e.only_reply_at
    else e.only_reply_at = saved.only_reply_at
  }
}

/** 取一条消息里的文字，用来认框架的拒绝话术 */
function textOf (msg) {
  if (typeof msg === 'string') return msg
  if (!Array.isArray(msg)) return ''
  return msg.filter(seg => seg?.type === 'text').map(seg => seg.text || '').join('')
}

/**
 * 数这次派发真的发出了几条消息。
 *
 * 只看 `deal()` 的返回值会把「派发出去、插件没吭声」当成成功——线上就是这么翻车的：
 * 工具回「已派发」，模型接着说「帮你签好啦」，而群里一张图都没有。插件真正办成事的
 * 标志是它自己发了消息，所以这里必须数得到。
 *
 * 出口覆盖：
 *   - `e.reply`（常规回复）；
 *   - `e.group.sendMsg` / `e.friend.sendMsg`（直接往会话对象发图/发合并转发）；
 *   - `e.group.makeForwardMsg` / `e.friend.makeForwardMsg` / `e.bot.makeForwardMsg`（2026-10-30 01:52 线上实例：
 *     次元小镇 `#p站`/`#图集` 组装完合并转发并发出，但未命中单一 `sendMsg` 口径，被误判为「没有回话」）；
 *   - `e.bot.sendGroupMsg` / `e.bot.sendPrivateMsg` / `e.bot.sendForwardMsg`（部分插件直接调协议端发送方法）。
 * 每条消息只数一次：发送过程中再套一层发送（长消息分段、先制转发再发消息）不算新消息。
 *
 * @param {object} delegated 派发用的消息事件
 * @returns {{ state: { replies: number, denied: boolean }, restore: () => void }}
 */
function countReplies (delegated) {
  const state = { replies: 0, denied: false }
  const restores = []
  let busy = false

  /** 包一个发送函数：只数真发出去的那次，嵌套调用与发送失败都不算 */
  const guarded = (original, self) => async (...args) => {
    // 已经在外层那次发送里：套着发的分段不算新消息，也不能重复计数
    if (busy) return original.apply(self, args)
    // 框架 filtPermission 的拒绝（「暂无权限，只有…才能操作」）也走这里，
    // 但它不是插件干活的回话——插件压根没被叫醒
    if (textOf(args[0]).trim().startsWith(FRAMEWORK_DENIED)) {
      state.denied = true
      return original.apply(self, args)
    }
    busy = true
    try {
      const res = await original.apply(self, args)
      // 框架把发送失败包成 { error: [...] }，空消息返回 false：这两种都不算办成
      if (res === false) return res
      if (res && typeof res === 'object' && res.error) return res
      state.replies += 1
      return res
    } finally {
      busy = false
    }
  }

  /**
   * 跟踪 makeForwardMsg：如果插件在派发期间成功构造了非空合并转发节点，且后续经由未包裹通道
   * （如 `Bot.pickGroup(id).sendMsg` 或协议端底层接口）发了出去导致 `state.replies` 仍为 0，
   * 在派发收尾时作为有效产出兜底计 1 条；若后续已走 `e.reply` / `group.sendMsg` 计过数，则不重复累加。
   */
  let forwardMade = 0
  const wrapForwardMaker = (owner, key) => {
    const original = owner?.[key]
    if (!owner || typeof original !== 'function') return
    const wrapped = async (...args) => {
      const res = await original.apply(owner, args)
      if (res && (typeof res === 'object' || Array.isArray(res)) && !res.error) {
        forwardMade += 1
      }
      return res
    }
    if (Reflect.set(owner, key, wrapped)) {
      restores.push(() => {
        Reflect.set(owner, key, original)
      })
    }
  }

  if (typeof delegated.reply === 'function') {
    const original = delegated.reply
    if (Reflect.set(delegated, 'reply', guarded(original, delegated))) {
      restores.push(() => {
        Reflect.set(delegated, 'reply', original)
      })
    }
  }

  // 群与好友的会话对象由宿主按群缓存、跨事件共用。事件上这两个字段是只读的
  // （线上实测：Cannot assign to read only property 'group'，只读来自原型链，
  // 查描述符也查不全），换不了视图，只能包实例上的 sendMsg，派发一结束立刻还原。
  //
  // 代价：还原窗口内同群别人发的消息会被算进这一次。宁可这样，也不要整个代执行抛错——
  // 少一次假成功，好过多一次「工具直接崩、指令根本没执行」。类被冻结时连实例也写不了，
  // 那就只数 e.reply，少一路口径。三种情况都用 Reflect.set，失败只返回 false 不抛。
  for (const key of ['group', 'friend']) {
    const contact = delegated[key]
    if (!contact || typeof contact !== 'object') continue
    for (const method of ['sendMsg', 'sendForwardMsg']) {
      const original = contact[method]
      if (typeof original !== 'function') continue
      if (!Reflect.set(contact, method, guarded(original, contact))) continue
      restores.push(() => {
        Reflect.set(contact, method, original)
      })
    }
    wrapForwardMaker(contact, 'makeForwardMsg')
  }

  if (delegated.bot && typeof delegated.bot === 'object') {
    for (const method of ['sendGroupMsg', 'sendPrivateMsg', 'sendForwardMsg', 'sendGroupForwardMsg']) {
      const original = delegated.bot[method]
      if (typeof original !== 'function') continue
      if (!Reflect.set(delegated.bot, method, guarded(original, delegated.bot))) continue
      restores.push(() => {
        Reflect.set(delegated.bot, method, original)
      })
    }
    wrapForwardMaker(delegated.bot, 'makeForwardMsg')
  }

  return {
    get state () {
      if (state.replies === 0 && !state.denied && forwardMade > 0) {
        return { replies: 1, denied: false }
      }
      return state
    },
    restore () {
      for (const fn of restores) fn()
    }
  }
}

/** 一条候选压成一行，够模型念给用户听 */
function describeCandidate (entry) {
  return `- [${entry.plugin}] ${entry.command}${entry.description ? `：${entry.description}` : ''}`
}

/**
 * 替用户执行指令。
 *
 * 关键取舍：**不自己调插件函数**，而是把指令交回框架派发。权限、频率限制、事件过滤、
 * 上下文还原都是框架已经做好的事，自己调一遍等于绕开它们重写一遍，迟早不一致。
 *
 * 不做任何「先问用户」的确认，也不在这里预判权限：用户明确要了就直接执行，能不能执行
 * 由框架的规则与插件自己的校验决定——它们拒绝时本来就会把自己的话发到群里。
 */
export class CommandRunTool extends AbstractTool {
  name = 'commandRun'

  parameters = {
    properties: {
      command: {
        type: 'string',
        description: '要执行的完整指令（含参数，例如「#签到」「#点赞」）或用户明确要求代劳的意图（如「帮我签到」「给我点个赞」）。建议优先使用 commandLookup 查到的准确写法。'
      }
    },
    required: ['command']
  }

  func = async function (opts = {}, e) {
    const input = String(opts?.command ?? opts?.query ?? '').trim()
    if (!input) return `${FAILED}要给出完整写法（含参数），例如「#签到」。`

    const { entries } = loadEntries()
    if (!entries.length) {
      return `${FAILED}本机还没有任何指令地图，不能代执行。让主人先发 ${UPDATE_COMMAND} 拉一次。`
    }

    const resolved = resolveCommand(entries, input)
    if (resolved.candidates?.length) {
      return [
        `${FAILED}「${input}」对上了不止一条指令，一条都没有执行。先让用户挑一条，再用挑中的完整写法调本工具：`,
        ...resolved.candidates.slice(0, MAX_CANDIDATES).map(describeCandidate)
      ].join('\n')
    }
    if (!resolved.entry) {
      const near = suggestEntries(entries, input)
      const hint = near.length
        ? `\n相近的可执行指令有：${near.map(item => `[${item.plugin}] ${item.command}`).join('、')}。`
        : ''
      return `${FAILED}没找到「${input}」这条指令，所以什么都没执行。先用 commandLookup 查准确写法，不要自己编一个。${hint}`
    }

    const entry = resolved.entry
    const sender = e?.sender?.card || e?.sender?.nickname || '你'

    // 权限与风险都不在这里判：用提问者本人身份派发，框架会按插件规则里的 permission 拦，
    // 插件自己也会校验绑定/额度。地图里的 risk 只用来写日志，不用来挡执行——
    // 挡在这里只会出现「插件本来能用，却被地图数据按住」。
    const baseCommand = resolved.matchedCommand || entry.command
    const target = `${baseCommand}${resolved.args ? ` ${resolved.args}` : ''}`
    // 每次调用都留一行：线上「AI 说它执行了但没动静」时，唯一能分辨「没调用」与
    // 「调了没派发成功」的证据就是这行（v1 有类似日志，v2 一开始漏了）
    logger.info(`${LOG_PREFIX} 代执行：${target}（risk=${entry.risk}）`)

    let dispatch
    try {
      dispatch = await getDispatcher()
    } catch (err) {
      logger.error(`${LOG_PREFIX} 派发器加载失败：${err?.message || err}`)
      return `${FAILED}代执行暂时不可用（框架接口没接上），这次没有执行。`
    }

    const delegated = e
    const restore = prepareMessage(delegated, target)
    delegated.__commandMapNested = true
    const counter = countReplies(delegated)

    const unguard = guardAccept(frameworkLoader)
    try {
      const handled = await dispatch(delegated)
      if (handled === false) {
        logger.warn(`${LOG_PREFIX} 代执行「${target}」派发后没有插件认领`)
        return `${FAILED}已经把「${target}」交给框架，但没有插件认领它——可能这条指令已经改过，或者 ${sender} 的权限不够。没有别的办法替你执行，如实告诉用户即可。`
      }
      if (counter.state.denied) {
        logger.warn(`${LOG_PREFIX} 代执行「${target}」被框架拒绝（权限不足）`)
        return `${FAILED}「${target}」被框架拒绝（${sender} 没有这条指令的权限）。直接告诉用户权限不够，不要编造成果。`
      }
      if (counter.state.replies === 0) {
        logger.warn(`${LOG_PREFIX} 代执行「${target}」派发了但插件没有回话`)
        const offHint = entry.enabledByDefault === false ? '该指令在插件中默认关闭（需先开启对应开关）、' : ''
        return `${FAILED}「${target}」没有执行成功：插件一个字都没回，多半是${offHint}它自己拒绝了（没绑定账号、登录已过期、额度不够或外部站点不可达）。直接告诉用户这次没成功、为什么，绝对不要编造「已经帮你签好了」「给你赞过了」这类结果。`
      }
      logger.info(`${LOG_PREFIX} 代执行「${target}」已完成（插件回了 ${counter.state.replies} 条）`)
      return `执行成功。插件已经把结果（${counter.state.replies} 条消息，含图片/文字）直接发到聊天里了。你不要再说任何话——不复述、不总结、不追加「已经帮你签好了」这类话，保持沉默。`
    } catch (err) {
      logger.error(`${LOG_PREFIX} 代执行「${target}」出错：${err?.message || err}`)
      return `${FAILED}「${target}」执行时出错了，已经停下来。多半是插件自身的问题，可以让主人看一下日志。`
    } finally {
      unguard()
      // 换成本事件视图的三个字段（reply / group / friend）都得换回去
      counter.restore()
      // 借用的是真人那条消息的事件对象：改完不还原，外层框架后续处理（引用回复、日志、
      // 统计）会看到被改坏的 msg。三样都得还回去。
      try {
        restore()
      } catch (err) {
        // 还原失败意味着外层会拿着被改写的消息继续跑，必须留痕
        logger.error(`${LOG_PREFIX} 事件还原失败：${err?.message || err}`)
      }
      try {
        delete delegated.__commandMapNested
      } catch (err) {
        // 标记留在事件上只会让这一轮的后续回合少注册工具，降级不致命，记警告即可
        logger.warn(`${LOG_PREFIX} 嵌套标记清除失败：${err?.message || err}`)
      }
    }
  }

  description = '替当前用户执行一条插件指令，以他本人的身份交回框架派发。用户明确要求代劳时（如「帮我签到」「给我点个赞」「刷新面板」）直接调，不要问「要不要我帮你执行」，也不要自己预判权限——框架与插件会处理，没有权限时它们自己会回话。注意：给名片点赞走本工具执行 `#点赞`，不要调 emojiLike。插件执行完会自己把结果（图片、文字）发到聊天里，你不需要复述。'
}
