import { PLUGINS_ROOT, SELF_PLUGIN_ROOT } from './paths.js'

/**
 * 脱敏：双过滤 + 占位替换。
 *
 * 两道防线，缺一不可：
 *   1) 双过滤在**扫描阶段**丢弃凭证——字段名像凭证就整条丢，值像长随机串也整条丢。
 *      原始值从不进入表单，不是"进了表单再让审核删掉"。
 *   2) 占位替换处理路径与号段——AI 需要知道"在哪个模块"，不需要知道装在哪台机器。
 */

/**
 * 凭证类字段名的**词元**集合。
 *
 * 用词元而不是子串匹配：`keywords` 含 "key"，但它是描述性字段，子串匹配会把它误杀——
 * 而关键词表恰恰是本功能最想要的信息。`apiKey` / `apiBaseUrl` / `appSalt` 拆成词元后照样命中。
 */
const SENSITIVE_TOKENS = new Set([
  'key', 'apikey', 'token', 'secret', 'pass', 'passwd', 'password', 'pwd',
  'cookie', 'cookies', 'auth', 'authorization', 'webhook', 'url', 'uri',
  'salt', 'sign', 'signature', 'credential', 'credentials', 'session', 'private'
])

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/

export function isSensitiveFieldName (name) {
  if (typeof name !== 'string' || !name.trim()) return false
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(token => token.toLowerCase())
  return tokens.some(token => SENSITIVE_TOKENS.has(token))
}

/**
 * 值是否像凭证。
 *
 * 判据是「长 + 字符集混杂」：真正的密钥几乎都满足，而中文描述一定不满足（早退）。
 * 长度门槛 30 是经验值：短于此的随机串误杀率太高，长于此的正常描述又很少。
 */
export function looksLikeSecret (value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text.length < 30) return false
  if (CJK_RE.test(text)) return false
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(text)).length
  return classes >= 3 || /^[A-Za-z0-9_\-:.=+/]{30,}$/.test(text)
}

/**
 * 把绝对路径、QQ 号、群号替换成占位形式。
 * @param {string} text
 * @returns {string}
 */
export function redactText (text) {
  if (typeof text !== 'string' || !text) return ''
  let out = text

  // 1. 本项目已知的两个根，替换成框架根占位（含 Windows / POSIX 两种分隔符写法）
  for (const root of [PLUGINS_ROOT, SELF_PLUGIN_ROOT]) {
    if (!root) continue
    for (const variant of [root, root.replace(/\\/g, '/'), root.replace(/\//g, '\\')]) {
      if (variant) out = out.split(variant).join('[YUNZAI_ROOT]/plugins')
    }
  }

  // 2. 其余绝对路径：Windows 盘符路径、三段以上的 POSIX 路径
  out = out.replace(/[A-Za-z]:[\\/][^\s'"`]{3,}/g, '[PATH]')
  out = out.replace(/\/(?:[\w.-]+\/){2,}[\w.-]+/g, '[PATH]')

  // 3. 号段：紧跟在「群」后面的算群号，其余 6~12 位连号算 QQ 号。
  //    必须在同一次 replace 里处理：分两步做的话，先写入的 123456 会被第二遍再替换一次。
  out = out.replace(/(?<!\d)(群[^\d]{0,4})?(\d{6,12})(?!\d)/g, (_, prefix) => (prefix ? `${prefix}123456` : '10001'))

  return out
}

/**
 * 从一段配置里挑出「可以直接给模型看的描述性文本」。
 *
 * 只收字符串、只下钻两层、只留短文本：够拿到关键词表与别名，又不会把整份配置搬进表单。
 *
 * @param {unknown} source 已解析的配置对象
 * @param {{ limit?: number, depth?: number, maxLength?: number }} [options]
 * @returns {{ field: string, value: string }[]}
 */
export function collectDescriptiveStrings (source, { limit = 30, depth = 2, maxLength = 120 } = {}) {
  const picked = []

  const walk = (node, fieldPath, level) => {
    if (picked.length >= limit || level > depth) return
    if (node === null || node === undefined) return

    if (Array.isArray(node)) {
      if (isSensitiveFieldName(fieldPath)) return
      for (const item of node) walk(item, fieldPath, level)
      return
    }

    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (picked.length >= limit) return
        const childPath = fieldPath ? `${fieldPath}.${key}` : key
        walk(value, childPath, level + (fieldPath ? 1 : 0))
      }
      return
    }

    if (typeof node !== 'string') return
    if (isSensitiveFieldName(fieldPath)) return

    const raw = String(node).trim()
    // 先用**原始值**判凭证，再脱敏：反过来的话，密钥里的长数字段会被先替换成 10001，
    // 长度掉到门槛以下，looksLikeSecret 就放行了——原始值于是进了表单。
    if (looksLikeSecret(raw)) return

    const value = redactText(raw)
    if (!value || value.length > maxLength) return
    picked.push({ field: fieldPath, value })
  }

  walk(source, '', 0)
  return picked
}
