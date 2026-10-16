/**
 * 工具参数与凭证脱敏（零依赖模块，可独立单测）
 *
 * 为什么需要：模型提供的 tool_calls.arguments 是**不可信输入**，可能夹带密码、验证码、
 * Token、手机号等。工具调用参数在进入业务校验之前，会先写进两类留痕：
 *   - 合并转发（`sendToolCallForwardMsg`，会作为消息发进会话、群成员可见）——本模块负责脱敏；
 *   - 控制台「工具调用」日志（`logger.info`）——按决策保持明文（仅操作者可见），
 *     见 docs/adr/0002-tool-log-channel-and-redaction.md。
 * 即使业务层随后拒绝（例如证据归属不匹配、置信度不足），转发记录里的明文也已经进了群聊，
 * 所以转发前必须换成"可安全转发"的参数副本。
 *
 * 策略：显式白名单（工具名 + 字段名），不做通用启发式脱敏——避免误伤正常工具的返回值展示。
 * 后续若有别的"正文类"工具需要脱敏，把工具名加入 REDACTED_TOOLS、把字段名加入
 * REDACTED_FIELD_NAMES 即可。
 *
 * 另提供 `maskSecret()`：用于 API Key 之类**凭证本体**的日志掩码（保留首尾便于区分是哪一个 key）。
 */

/** 需要脱敏参数的工具 */
const REDACTED_TOOLS = new Set(['Memory_Tool'])

/** 承载正文与取值的字段；operation / scope / factKey 这类结构性信息保留 */
const REDACTED_FIELD_NAMES = new Set(['text', 'factValue', 'pendingText'])

const REDACTED_PLACEHOLDER = '[REDACTED]'

function deepRedact(value) {
  if (Array.isArray(value)) return value.map(deepRedact)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = REDACTED_FIELD_NAMES.has(key) ? REDACTED_PLACEHOLDER : deepRedact(item)
  }
  return out
}

/**
 * 返回可安全用于合并转发的参数副本。
 *
 * 未列入白名单的工具返回**浅拷贝**：与历史 `{ ...args }` 语义一致，避免后续对 `args.groupId`
 * 之类的原地修改串进转发记录。
 *
 * @param {string} name 工具名
 * @param {Object} args 模型给出的参数（不可信）
 * @returns {Object} 副本
 */
export function redactArgsForLog(name, args) {
  if (!args || typeof args !== 'object') return args
  const copy = Array.isArray(args) ? args.slice() : { ...args }
  if (!REDACTED_TOOLS.has(String(name || ''))) return copy
  return deepRedact(copy)
}

/**
 * 凭证掩码：API Key / Token 写日志时使用，避免明文留痕。
 *
 * 保留首 6 位与末 4 位：既能看出是哪个厂商、哪一把 key（多 key 轮换时便于排障），
 * 又不泄露可用于认证的主体部分。短值整体打码，空值给出明确标记。
 *
 * @param {*} value 凭证原值
 * @returns {string} 掩码后的字符串（可直接拼进日志）
 */
export function maskSecret(value, { head = 6, tail = 4 } = {}) {
  if (value === undefined || value === null) return '[UNSET]'
  const text = String(value).trim()
  if (!text) return '[EMPTY]'
  if (text.length <= head + tail) return '*'.repeat(text.length)
  return `${text.slice(0, head)}***${text.slice(-tail)}`
}
