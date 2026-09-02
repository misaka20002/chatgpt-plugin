import plugin from '../../../lib/plugins/plugin.js'
import { groupCapture } from '../utils/memory/capture.js'

/**
 * 全群消息观察器（独立插件文件，避免被其他作者插件干扰）
 * 仅采集授权群的非指令、非 Bot 纯文本，供每日批量提炼。
 *
 * priority = -1011：TRSS 按 priority 升序调度（数字越小越先执行），
 * 且任一插件 fnc 返回非 false 即终止整条消息处理。
 * 观察器必须排在最前（-1011 < memoryManage 500 < chat.js 1144），
 * 确保任何其他插件（含其他作者插件）都无法抢在采集之前终结消息；
 * observe 返回 false 不拦截，放行给后续插件正常处理。
 */
export class memoryGroupObserver extends plugin {
  constructor(e) {
    super({
      name: 'ChatGPT-Plugin 群记忆观察器',
      dsc: '采集授权群的纯文本消息供每日批量提炼',
      event: 'message',
      priority: -1011,
      rule: [
        {
          reg: '^.*$',
          fnc: 'observe'
        }
      ]
    })
  }

  async observe(e) {
    await groupCapture.observe(e)
    return false // 不拦截，继续匹配后续插件
  }
}
