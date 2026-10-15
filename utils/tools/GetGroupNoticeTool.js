import { AbstractTool } from './AbstractTool.js'
import {
  resolveGroupToolContext,
  extractGroupList,
  messageToText,
  wrapUntrustedGroupData,
  groupToolFailure
} from './groupAdminToolContext.js'

/**
 * 只保留公告正文与少量元信息。
 * 协议端返回的 `message.images` 里带着图片 id/尺寸等对象，整块回填没有价值还占上下文。
 */
function normalizeNotice(item) {
  if (!item || typeof item !== 'object') return { text: String(item ?? '') }
  const message = item.message
  const images = Array.isArray(message?.images) ? message.images.length : 0
  return {
    notice_id: item.notice_id,
    sender_id: item.sender_id,
    publish_time: item.publish_time,
    text: messageToText(message),
    ...(images ? { image_count: images } : {})
  }
}

export class GetGroupNoticeTool extends AbstractTool {
  name = 'getGroupNotice'

  parameters = {
    properties: {},
    required: []
  }

  description = '获取当前群聊的群公告内容。只能读取当前正在对话的这个群，无法读取其他群，也无法发布或修改公告。'

  func = async function (opts, e) {
    // 群公告是群里公开的只读信息，不限提问者身份，也不要求 Bot 有管理权限
    const { group, error } = resolveGroupToolContext(e)
    if (error) return error

    try {
      const notices = extractGroupList(await group.getNotice()).map(normalizeNotice)
      if (!notices.length) return '当前群没有群公告。'
      return wrapUntrustedGroupData('当前群的群公告', notices)
    } catch (err) {
      return groupToolFailure('getGroupNotice', '获取群公告', err)
    }
  }
}
