import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { hasRegisteredMatch, isCommandLike, recordMiss } from '../utils/commandMap/telemetry.js'

/**
 * 命令误用埋点观察器（**临时，上线前删掉**）。
 *
 * 位置在消息链最末端：前面的插件都处理完了，这时还没被接住的「指令样」消息才值得记一笔。
 * 必须返回 false——返回非 false 会终结整条消息链，等于把别人的插件也堵死。
 *
 * 它只是记数据，不判断对错、不纠正用户、不联网。
 */
export class commandMissObserver extends plugin {
  constructor () {
    super({
      name: 'ChatGPT-Plugin 命令埋点',
      dsc: '记录用户发过但没有任何插件匹配的「指令样」消息（临时，用于统计常见误用）',
      event: 'message',
      priority: 9999,
      rule: [
        {
          reg: '^[\\s\\S]*$',
          fnc: 'observe',
          log: false
        }
      ]
    })
  }

  async observe (e) {
    if (Config.commandMapTelemetry !== true) return false
    if (!isCommandLike(e?.msg)) return false

    const loader = globalThis.Bot?.loader
    // 拿不到注册表就什么都不记：否则每条指令都会被误记成「没匹配上」
    if (!loader) return false
    if (hasRegisteredMatch(loader, e.msg)) return false

    recordMiss({
      msg: e.msg,
      userId: e?.sender?.user_id || e?.user_id || '',
      groupId: e?.group_id || 'private'
    })
    return false
  }
}
