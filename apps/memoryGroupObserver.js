import plugin from '../../../lib/plugins/plugin.js'
import { groupCapture } from '../utils/memory/capture.js'

/**
 * 全群消息观察器（独立插件文件，避免被其他作者插件干扰）
 * 采集授权群的非 Bot 消息（**含指令**，指令打 `isCommand` 标记供提炼层排除）；
 * 文本供每日批量提炼，@/引用/合并转发/卡片另存为结构化字段。
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
      dsc: '采集授权群的消息（文本 + @/引用等结构化段）供每日批量提炼',
      event: 'message',
      priority: -1011,
      rule: [
        {
          // 全量匹配必须显式跨换行：loader.js 用 `v.reg.test(e.msg)` 筛选，而 JS 的 `.` 与 `$`
          // 都不跨行——`'^.*$'` 对含换行的消息返回 false（实测 'a\nb' 与 'a\n' 都是 false），
          // 多行消息会在 rule 层被直接丢掉，observe() 根本没机会执行。
          reg: '^[\\s\\S]*$',
          fnc: 'observe',
          log: false // 观察器全量匹配，命中日志降为 debug，避免刷屏（同 bym.js / 派蒙戳一戳.js 写法）
        }
      ]
    })
  }

  async observe(e) {
    await groupCapture.observe(e)
    return false // 不拦截，继续匹配后续插件
  }
}
