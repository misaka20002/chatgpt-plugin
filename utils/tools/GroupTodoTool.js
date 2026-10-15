import { AbstractTool } from './AbstractTool.js'
import {
  resolveGroupToolContext,
  extractGroupList,
  messageToText,
  wrapUntrustedGroupData,
  groupToolFailure
} from './groupAdminToolContext.js'

/**
 * `getTodoList` 内部会把每个待办的 `message` 过一遍适配器的 `parseMsg`，
 * 结果是 `{ type, ...data }` 的消息段数组；`messageToText` 统一处理字符串 / 对象 / 数组三种形态。
 */
function normalizeTodo(item) {
  if (!item || typeof item !== 'object') return { message: String(item ?? '') }
  // message 摘出去单独还原，避免消息段对象（可能很大）整块进上下文
  const { message, ...rest } = item
  let text = messageToText(message)
  if (!text && message != null) {
    try {
      text = JSON.stringify(message) ?? ''
    } catch {
      text = '[unserializable message]'
    }
  }
  return { ...rest, text }
}

const ACTION_LABELS = { set: '设为待办', complete: '标记为已完成', cancel: '取消待办' }

export class GroupTodoTool extends AbstractTool {
  name = 'groupTodo'

  parameters = {
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'set', 'complete', 'cancel'],
        description: '要执行的操作：list 查看当前群待办列表；set 把一条消息设为待办；complete 完成一条待办；cancel 取消一条待办'
      },
      messageId: {
        type: 'string',
        description: 'set/complete/cancel 定位待办用的消息 id，默认为被引用（回复）的消息，其次为当前消息；也可以直接用 list 结果里的 message_id'
      }
    },
    required: ['action']
  }

  description = '管理当前群聊的群待办：查看待办列表、把消息设为待办、完成或取消待办。只能操作当前正在对话的这个群。'

  func = async function (opts, e) {
    // 待办会在群里产生公开可见效果，保持主人/群管档
    const { group, error } = resolveGroupToolContext(e, { requireAdmin: true })
    if (error) return error

    const action = String(opts?.action ?? '').trim()
    try {
      if (action === 'list') {
        const todos = extractGroupList(await group.getTodoList()).map(normalizeTodo)
        if (!todos.length) return '当前群没有待办。'
        return wrapUntrustedGroupData('当前群的待办列表', todos)
      }
      if (!ACTION_LABELS[action]) {
        return `Error: 不支持的 action：${action || '(空)'}，只支持 list/set/complete/cancel。`
      }
      // 待办按 message_id 定位：模型没显式给才回退到引用消息、当前消息
      const messageId = String(opts?.messageId ?? '').trim() || e.source_message_id || e.message_id
      if (!messageId) {
        return `Error: 缺少 messageId，无法定位要${ACTION_LABELS[action]}的消息。`
      }
      if (action === 'set') await group.setTodo(messageId)
      else if (action === 'complete') await group.completeTodo(messageId)
      else await group.cancelTodo(messageId)
      return `已将消息 ${messageId} ${ACTION_LABELS[action]}。`
    } catch (err) {
      return groupToolFailure(`groupTodo:${action}`, '群待办操作', err)
    }
  }
}
