/*
 * 数字菜单与二次确认共用的等待原语。
 *
 * 切模型、用设定这类指令都要在发完菜单后等下一条消息，而这条消息可能是别人插话、可能是超时、
 * 也可能是主人自己取消。校验只写一份，两条指令才不会在「谁能回答」「几秒超时」上悄悄分叉。
 */

/** 等待窗口里视为「主人反悔」的回复。`0` 另有 allowNone 的语义，所以在调用处单独判断。 */
export const CANCEL_REPLIES = ['取消', '退出']

/**
 * 等发起者本人的下一条消息。
 * @param {{awaitContext: Function}} plugin 插件实例（提供 awaitContext）
 * @param {object} e 发起指令的事件
 * @param {number} timeout 等待秒数
 * @returns {Promise<string>} 已 trim 的回复正文；超时或换人回答时抛错
 */
export async function awaitOwnerReply (plugin, e, timeout = 60) {
  const response = await plugin.awaitContext(false, timeout)
  // setContext 超时后 resolve 的是 false；他人代答时 isMaster 或 user_id 对不上。
  if (!response || !response.isMaster || String(response.user_id ?? response.sender?.user_id) !== String(e.user_id ?? e.sender?.user_id)) throw new Error('操作已取消或超时')
  return response.msg?.trim() || ''
}

/**
 * 列出编号菜单并取回选中项。
 * @param {{awaitContext: Function}} plugin 插件实例
 * @param {object} e 发起指令的事件
 * @param {{label: string, value: any}[]} items 菜单条目，序号按数组顺序从 1 开始
 * @param {string} title 菜单标题
 * @param {{allowNone?: boolean, timeout?: number, hint?: string}} options allowNone 时 0 返回空字符串而不是取消
 * @returns {Promise<any>} 选中条目的 value
 */
export async function chooseFromMenu (plugin, e, items, title, { allowNone = false, timeout = 60, hint = '' } = {}) {
  const lines = items.map((item, i) => `${i + 1}. ${item.label}`)
  // 提示放在取消项之前：末尾固定是「0. 取消」，主人扫到最后一眼看到的是出口。
  if (hint) lines.push(hint)
  lines.push(allowNone ? '0. 不启用回退' : '0. 取消')
  await e.reply(`${title}\n${lines.join('\n')}\n请在 ${timeout} 秒内回复数字，发送“取消”或“退出”终止。`, true)
  const text = await awaitOwnerReply(plugin, e, timeout)
  if (CANCEL_REPLIES.includes(text)) throw new Error('操作已取消')
  if (text === '0') {
    if (!allowNone) throw new Error('操作已取消')
    return ''
  }
  if (!/^[1-9]\d*$/.test(text) || Number(text) > items.length) throw new Error('序号无效，操作已取消')
  return items[Number(text) - 1].value
}

/**
 * 覆盖或删除前问一次要不要留底：`0` 取消、确认词直接执行、其它内容当备份设定名。
 *
 * 「使用设定」与「删除设定」共用这一段：两条指令都要在动手前把当前正文摆给主人看，
 * 允许他把这份内容另存成新的设定文件，再继续原来的动作。校验只写一份，才不会一边能取消、另一边不能。
 * @param {{awaitContext: Function}} plugin 插件实例（提供 awaitContext）
 * @param {object} e 发起指令的事件
 * @param {object} options 询问参数
 * @param {string} options.header 首行，说明要对谁做什么
 * @param {string} [options.preview] 首行下方展示的当前正文（调用方自行截断）
 * @param {string} [options.note] 预览之后的一句补充说明
 * @param {string[]} options.confirmWords 视为「直接执行」的回复
 * @param {string} [options.confirmHint] 文案里展示的确认词，默认把 confirmWords 全列出来
 * @param {string} options.actionLabel 动作名（覆盖 / 删除），用于两句提示
 * @param {(text: string) => string} options.resolveBackup 把回复解析成合法备份名，非法时抛错
 * @param {number} [options.timeout] 等待秒数
 * @param {number} [options.recallMsg] 大于 0 时让宿主在该秒数后撤回这条询问
 * @returns {Promise<string>} 备份名；空串表示不留底、直接执行
 */
export async function requestBackupOrConfirm (plugin, e, {
  header,
  preview = '',
  note = '',
  confirmWords,
  confirmHint = confirmWords.join(' 或 '),
  actionLabel,
  resolveBackup,
  timeout = 60,
  recallMsg = 0
}) {
  const lines = [header]
  if (preview) lines.push(preview)
  if (note) lines.push(note)
  lines.push(`回复 0 取消；回复 ${confirmHint} 直接${actionLabel}；`)
  lines.push(`回复其它内容则先把当前内容另存为新的本地设定，再${actionLabel}。`)
  lines.push(`请在 ${timeout} 秒内回复。`)
  await e.reply(lines.join('\n'), true, recallMsg ? { recallMsg } : {})
  const text = await awaitOwnerReply(plugin, e, timeout)
  if (['0', ...CANCEL_REPLIES].includes(text)) throw new Error('操作已取消')
  if (confirmWords.includes(text)) return ''
  return resolveBackup(text)
}
