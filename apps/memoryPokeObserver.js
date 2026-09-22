import plugin from '../../../lib/plugins/plugin.js'
import { groupCapture } from '../utils/memory/capture.js'

/**
 * 戳一戳观察器（独立插件文件）
 *
 * TRSS 的戳一戳走 notice.group.poke，不是消息段，message 观察器看不到它，故单列一个插件。
 * 必须独立成文件：index.js 每个文件只注册第一个导出（`value[Object.keys(value)[0]]`），
 * 与 memoryGroupObserver 同文件会导致本类被静默丢弃。
 *
 * priority = -1011：只读取、不拦截，返回 false 放行；派蒙戳一戳（priority 1000）等既有插件不受影响。
 */
export class memoryPokeObserver extends plugin {
  constructor(e) {
    super({
      name: 'ChatGPT-Plugin 群记忆观察器（戳一戳）',
      dsc: '记录授权群内的戳一戳交互',
      event: 'notice.group.poke',
      priority: -1011,
      rule: [
        {
          fnc: 'observePoke',
          log: false
        }
      ]
    })
  }

  async observePoke(e) {
    await groupCapture.observePoke(e)
    return false // 不拦截，放行给后续插件
  }
}
