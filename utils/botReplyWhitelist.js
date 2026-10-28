import { Config } from './config.js'

/**
 * 事件所属的 Bot 账号。
 *
 * 与 utils/groupReply.js 的 botId 同口径（这里额外去掉了空白）：先看事件上的 self_id，
 * 再回落到实例的 uin。
 * 不读 Config.trssBotUin——那是「主人认可的主账号」，用于取 uin，不参与准入。
 *
 * @param {object} e 服务端事件
 * @returns {string} 账号标识；取不到时为空串
 */
export function eventBotId(e) {
  return String(e?.self_id || e?.bot?.uin || '').trim()
}

/**
 * 白名单条目：转字符串、去空白、丢空项。
 * 非数组（手工改坏的配置）按未启用处理——宁可全放行，也不要让一个脏值把整个插件静默掉。
 */
function whitelistEntries() {
  const list = Config.botReplyWhitelist
  if (!Array.isArray(list)) return []
  return list.map(item => String(item ?? '').trim()).filter(Boolean)
}

/**
 * Bot 响应白名单闸：决定这个账号要不要响应对话触发。
 *
 * 空列表表示未启用（所有账号都响应，与既有行为一致）；非空时只有命中的账号放行。
 * 取不到账号身份时放行（fail-open）：单号部署或影子事件缺少 self_id 时拦下来，
 * 会让整个插件对所有消息静默，代价远高于多号抢答。
 *
 * @param {object} e 服务端事件
 * @param {object} [options]
 * @param {string} [options.label] 触发入口，只用于日志区分（对话 / 第一人称呼叫 / 自主回复 / 其他模式）
 * @param {boolean} [options.silent] 不写日志。自主回复的准入对每条群消息都会跑，需要静默
 * @returns {boolean} 是否允许该账号响应
 */
export function isBotReplyAllowed(e, { label = '对话', silent = false } = {}) {
  const entries = whitelistEntries()
  if (!entries.length) return true
  const botId = eventBotId(e)
  if (!botId) {
    if (!silent) logger.info(`[ChatGPT][Bot响应白名单] 无法确定账号，按放行处理（${label}）`)
    return true
  }
  if (entries.includes(botId)) return true
  if (!silent) logger.info(`[ChatGPT][Bot响应白名单] 账号 ${botId} 不在白名单，忽略${label}`)
  return false
}
