import plugin from '../../../lib/plugins/plugin.js'
import { groupReply } from '../utils/groupReply.js'

export class groupReplyObserver extends plugin {
  constructor() {
    super({
      name: 'ChatGPT-Plugin 群聊自主回复',
      dsc: '采集授权群的消息，防抖后由 LLM 判断是否进入普通对话',
      event: 'message',
      // 先于聊天入口观察，但始终放行消息链；耗时判断由每群独立定时器执行。
      priority: -1010,
      rule: [{ reg: '^[\\s\\S]*$', fnc: 'observe', log: false }]
    })
  }

  async observe(e) {
    groupReply.observe(e)
    return false
  }
}
