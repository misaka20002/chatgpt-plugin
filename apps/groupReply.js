import plugin from '../../../lib/plugins/plugin.js'
import { groupReply } from '../utils/groupReply.js'
import { Config } from '../utils/config.js'
import { normalizeGroupReplyConfig } from '../utils/groupReplyConfig.js'

export class groupReplyObserver extends plugin {
  constructor() {
    super({
      name: 'ChatGPT-Plugin 群聊自主回复',
      dsc: '采集授权群的消息，定时由 LLM 判断是否进入普通对话',
      event: 'message',
      // 先于聊天入口观察，普通消息始终放行；控制指令在此处理。
      priority: -1010,
      rule: [
        { reg: '^#群聊自主回复\\s*(开启|关闭)\\s*$', fnc: 'toggle', permission: 'master' },
        { reg: '^[\\s\\S]*$', fnc: 'observe', log: false }
      ]
    })
  }

  async observe(e) {
    groupReply.observe(e)
    return false
  }

  async toggle(e) {
    if (!e.isMaster) return false
    if (!e.isGroup || !e.group_id) {
      await e.reply('请在需要设置的群内使用此指令')
      return true
    }
    const match = String(e.msg || '').match(/^#群聊自主回复\s*(开启|关闭)\s*$/)
    if (!match) return false
    const enabled = match[1] === '开启'
    const config = Config.getConfig()
    const previous = config.groupReply
    const next = normalizeGroupReplyConfig(previous)
    const groupId = String(e.group_id)
    const entries = next.groups.filter(g => g.groupId === groupId)
    if (entries.length) entries.forEach(g => { g.switchOn = enabled })
    else next.groups.push({ groupId, switchOn: enabled, debounceSeconds: 60, enthusiasm: 40 })
    if (enabled) next.enabled = true
    config.groupReply = next
    if (!Config.save()) {
      config.groupReply = previous
      await e.reply('群聊自主回复配置保存失败，请检查日志后重试')
      return true
    }
    groupReply.prune()
    await e.reply(`已${enabled ? '开启' : '关闭'}当前群的群聊自主回复${enabled && !previous?.enabled ? '，已同步开启总开关' : ''}`)
    return true
  }
}
