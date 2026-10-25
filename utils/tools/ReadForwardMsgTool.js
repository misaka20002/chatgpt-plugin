import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'
import { readForwardMsgTree, FORWARD_MAX_DEPTH } from '../forwardMsgParser.js'

/** 层数硬上限由解析器导出，避免两处各写一个 3 而漂移 */

/**
 * 从模型给的原始参数里捞出纯 ID。
 *
 * 模型见过 `<合并转发:id=xxx>`、`id=xxx`、`forward:xxx` 几种写法，
 * 也常常整段照抄或加引号。这里统一清洗，避免因为格式差异白白失败一次。
 *
 * @param {*} input 模型传入的 forward_id
 * @returns {string} 纯 ID；无法识别时为空串
 */
export function sanitizeForwardId(input) {
  const text = String(input ?? '').trim()
  if (!text) return ''

  // 形态一：完整信标，可能带 id= 也可能直接跟着值
  const beacon = text.match(/<合并转发\s*[:：]\s*(?:id\s*=\s*)?([^>\s]+)\s*>/)
  if (beacon && beacon[1]) return beacon[1].trim()

  let out = text
  // 形态二：forward:xxx / forward=xxx
  out = out.replace(/^forward\s*[:=]\s*/i, '')
  // 形态三：id=xxx
  out = out.replace(/^id\s*=\s*/i, '')
  // 去掉包裹引号与反引号
  out = out.replace(/^["'`]+/, '').replace(/["'`]+$/, '')
  // 残留的尖括号
  out = out.replace(/^<+/, '').replace(/>+$/, '')

  return out.trim()
}

/**
 * Tool: 按需读取 QQ 合并转发（聊天记录）的内容
 *
 * 为什么做成工具而不是直接塞进 prompt：
 * 转发记录动辄几十条、还带嵌套，全量塞进去会挤占上下文；
 * 而模型只在「确实需要看内容」时才调这个工具，成本由提问决定。
 */
export class ReadForwardMsgTool extends AbstractTool {
  name = 'read_forward_msg'

  parameters = {
    type: 'object',
    properties: {
      forward_id: {
        type: 'string',
        description: '合并转发的 ID（即 <合并转发:id=xxx> 中的 xxx）'
      },
      max_depth: {
        type: 'number',
        description: '展开层数上限（1~3，默认 3）'
      },
      recognize_images: {
        type: 'boolean',
        description: '是否读取并识别转发记录中的图片（默认 true）'
      }
    },
    required: ['forward_id']
  }

  description =
    '按需读取 QQ 合并转发（聊天记录）的具体内容与其中的图片信息（最高支持 3 层嵌套展开）。当当前消息、引用消息或群聊历史记录中出现 <合并转发:id=xxx> 或 forward:xxx 标签，且你需要查看里面的聊天记录或图片时调用。'

  func = async function (opts, e) {
    // 事件上下文是一切的前提：没有 e 就拿不到 bot / 群对象，也无从发起协议调用
    if (!e) {
      return 'Error: 缺少事件上下文，无法读取合并转发（工具需在对话中调用）'
    }

    if (Config.enableForwardMsgRead === false) {
      return 'Error: 合并转发读取功能当前已关闭'
    }

    const cleanId = sanitizeForwardId(opts?.forward_id)
    if (!cleanId) {
      return 'Error: forward_id 为空或格式无法识别，请传入 <合并转发:id=xxx> 中的 xxx 部分'
    }

    const rawDepth = Number(opts?.max_depth)
    const maxDepth =
      Number.isFinite(rawDepth) && rawDepth > 0
        ? Math.min(Math.max(1, Math.floor(rawDepth)), FORWARD_MAX_DEPTH)
        : FORWARD_MAX_DEPTH

    // 只有显式传 false 才关闭识图，其余情况（未传 / 传错）都按默认开启处理
    const recognizeImages = opts?.recognize_images !== false

    try {
      const result = await readForwardMsgTree(e, cleanId, { maxDepth, recognizeImages })

      if (!result || result.ok !== true) {
        const reason = result?.error || '未知原因'
        return `Error: 读取合并转发失败：${reason}（ID: ${cleanId}）`
      }

      const lines = []
      lines.push(
        `=== 合并转发记录 (ID: ${cleanId}, 展开层数: ${result.depth ?? maxDepth}/${FORWARD_MAX_DEPTH}, 共 ${result.totalNodes ?? 0} 条消息) ===`
      )

      // body 是纯正文（含截断提示），不含图片清单，避免下面重复列一遍图片
      const body = typeof result.body === 'string' && result.body ? result.body : result.text || ''
      if (body) lines.push(body)

      const urls = Array.isArray(result.imageUrls) ? result.imageUrls : []
      if (urls.length) {
        const descriptionMap = new Map(
          (Array.isArray(result.imageDescriptions) ? result.imageDescriptions : [])
            .filter((item) => item && item.url)
            .map((item) => [item.url, item.text])
        )

        lines.push(`=== 包含图片列表（共 ${urls.length} 张） ===`)
        urls.forEach((url, index) => {
          const description = descriptionMap.get(url)
          lines.push(`${index + 1}. ${url}${description ? ` (画面识别: ${description})` : ''}`)
        })
      }

      return lines.filter(Boolean).join('\n')
    } catch (err) {
      // 工具抛错会让整轮对话失败，这里一律收敛成可读文本交回模型
      return `Error: 读取合并转发失败：${err?.message || String(err)}（ID: ${cleanId}）`
    }
  }
}
