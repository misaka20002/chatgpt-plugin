import { AbstractTool } from './AbstractTool.js'
import {
  FORWARD_UNTRUSTED_NOTICE_EN,
  ForwardReadError,
  limitForwardText,
  readForward
} from '../forwardMessage.js'

/**
 * Tool: 读取聊天记录里的合并转发（工具名 view_forward_msg）。
 *
 * 引用转发在入 core 前已自动展开，不需要模型再调用本工具；这里只负责模型主动读取
 * 上下文里出现过的 `[CQ:forward,id=…]`。返回值与自动展开共用同一套渲染与预算，
 * 媒体地址同时登记到事件上，供后续 recognize_media 沿用可信来源。
 */
export class ViewForwardMsgTool extends AbstractTool {
  name = 'view_forward_msg'

  parameters = {
    properties: {
      forwardId: {
        type: 'string',
        description: 'Extract the id value from [CQ:forward,id=...]'
      }
    },
    required: ['forwardId']
  }

  description = 'Reads merged forwards `[CQ:forward,id=...]` to return chat records. Use only for unexpanded forwards in context. Skip quoted replies or current message media (already provided). Extracted URLs work with `recognize_media`.'

  func = async function (opts, e) {
    const forwardId = typeof opts?.forwardId === 'string' ? opts.forwardId.trim() : ''
    if (!forwardId) return 'Error: forwardId is required, take it from [CQ:forward,id=...].'

    try {
      const { text } = await readForward(e, forwardId)
      logger.info(`[ChatGPT][合并转发] 工具读取成功: ${forwardId.slice(0, 16)}…`)
      return limitForwardText(`${FORWARD_UNTRUSTED_NOTICE_EN}\n${text}`).text
    } catch (err) {
      const code = err instanceof ForwardReadError ? err.code : 'fetch'
      const reason = err?.message || String(err)
      logger.warn(`[ChatGPT][合并转发] 工具读取失败(${code}): ${reason}`)
      if (code === 'unsupported') return 'Error: this adapter does not support reading merged forwards.'
      if (code === 'invalid-id') return 'Error: forwardId is invalid.'
      if (code === 'empty') return 'Error: the merged forward has no readable content.'
      if (code === 'timeout') return 'Error: reading the merged forward timed out.'
      return `Error: failed to read the merged forward (${reason}).`
    }
  }
}
