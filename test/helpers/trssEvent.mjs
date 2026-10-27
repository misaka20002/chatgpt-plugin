/**
 * 框架事件的共享夹具。
 *
 * 为什么必须是共享夹具：框架对事件字段的写法是**契约**，不是随便约定的。
 *   - `lib/bot.js` 用 `Object.defineProperty(data, "member", { value })` 定义群成员；
 *   - `lib/plugins/loader.js` 用 `{ value, writable: false, configurable: false }` 定义 isMaster。
 * 也就是说这两个字段**不可写、不可配置**，直接赋值会抛
 * `TypeError: Cannot assign to read only property 'member'`。
 *
 * 各测试各写一遍自己的假事件，夹具迟早跟宿主契约对不上：
 * 一旦夹具把 isMaster 写成普通属性，测试照样「通过」，线上却崩——
 * 2026-10-28 线上真实故障就是这么来的（@他人代执行抛 TypeError，
 * 而当时的测试夹具把 isMaster 写成了可写属性，测不出来）。
 *
 * 所以：**要构造框架事件，就从这里拿**，不要在测试文件里手搓身份字段。
 */

/**
 * 造一个符合宿主契约的消息事件。
 *
 * @param {object} [options]
 * @param {boolean} [options.isMaster] 是否主人（不可写、不可配置）
 * @param {string|number} [options.userId] 发送者
 * @param {string|number} [options.groupId] 群号
 * @param {string|number} [options.selfId] 机器人号
 * @param {string} [options.role] 群角色：member / admin / owner
 * @param {string} [options.msg] 事件文本
 * @param {Array} [options.message] 消息段（框架 dealEvent 会据此重建 e.msg）
 * @param {object} [options.member] 群成员信息
 * @param {Array} [options.replies] 回话收集器
 * @returns {object} 事件
 */
export function makeTrssEvent (options = {}) {
  const {
    isMaster = false,
    userId = 10001,
    groupId = 555,
    selfId = '591272224',
    role = 'member',
    msg = '',
    message = null,
    member = { is_admin: false, is_owner: false },
    replies = []
  } = options

  const segments = message ?? [{ type: 'text', text: msg }]
  const e = {
    self_id: String(selfId),
    user_id: userId,
    group_id: groupId,
    isGroup: true,
    msg,
    message: segments,
    sender: { user_id: userId, role, nickname: '测试用户' },
    reply: async text => {
      replies.push(text)
      return { message_id: replies.length }
    },
    replies
  }

  // 身份字段按宿主写法定义：不可写、不可配置
  Object.defineProperty(e, 'member', { value: member, writable: false, configurable: false })
  Object.defineProperty(e, 'isMaster', { value: isMaster, writable: false, configurable: false })
  return e
}

/**
 * 以另一个人的身份看同一件事——复刻代执行里的「影子事件」。
 *
 * 框架的身份字段不可写，所以只能像生产代码那样建一层影子：
 * `Object.create(e)` + 自己的身份字段，其余读取穿透回原事件。
 *
 * @param {object} e 原事件
 * @param {{ userId?: string|number, member?: object }} target 目标身份
 * @returns {object} 影子事件
 */
export function withIdentity (e, target = {}) {
  const userId = target.userId ?? e.user_id
  const member = target.member ?? e.member
  const shadow = Object.create(e)
  const own = (key, value) => {
    Object.defineProperty(shadow, key, { value, writable: true, enumerable: true, configurable: true })
  }
  own('user_id', userId)
  own('sender', {
    ...e.sender,
    user_id: userId,
    role: member?.is_owner ? 'owner' : member?.is_admin ? 'admin' : 'member'
  })
  own('member', member)
  own('isMaster', false)
  return shadow
}

/**
 * 造一个「读取成员资料会抛错」的目标，用来测异常上报路径。
 *
 * @param {string|number} userId
 * @param {Error} error
 * @returns {object}
 */
export function makeFailingMemberTarget (userId, error) {
  const target = { userId }
  Object.defineProperty(target, 'member', {
    get () {
      throw error
    }
  })
  return target
}
