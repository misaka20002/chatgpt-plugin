import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { avatarReply } from '../utils/avatarReply.js'
import { avatarIdentity, normalizeAvatarReplyConfig } from '../utils/avatar/config.js'
import { refreshAvatarFolders } from '../utils/avatar/refresh.js'

export class avatarReplyManagement extends plugin {
  constructor() {
    super({ name: 'ChatGPT 角色动图', event: 'message', priority: 450, rule: [
      { reg: /^#chatgpt角色(预览|开启|关闭|状态)(?:\s+.+)?$/, fnc: 'manage', permission: 'master' },
      { reg: /^#chatgpt刷新角色文件夹$/, fnc: 'refresh', permission: 'master' }
    ] })
  }

  async refresh(e) {
    if (!e.isMaster) return true
    try {
      const results = await refreshAvatarFolders()
      await e.reply('角色文件夹刷新完成：\n' + (results.map(x => x.avatarId + '：' + x.status
        + (x.error ? '，' + x.error : '，特色表情 ' + x.expressions + ' 种')).join('\n') || '没有角色文件夹'), true)
    } catch (err) {
      await e.reply('角色文件夹刷新失败：' + err.message, true)
    }
    return true
  }

  async manage(e) {
    if (!e.isMaster) return true
    try {
      const { botId, groupId } = avatarIdentity(e)
      const [, action, requested] = e.msg.match(/^#chatgpt角色(预览|开启|关闭|状态)(?:\s+(.+))?$/) || []
      if (requested && (e.isGroup || action !== '预览')) throw new Error('仅私聊角色预览可附加角色目录名')
      const selection = avatarReply.selection(e, requested?.trim())
      if (action === '开启' || action === '关闭') {
        if (!e.isGroup) throw new Error('请在需要配置的群内使用开启或关闭命令')
        if (action === '开启') await avatarReply.store.load(botId, selection.avatarId)
        const candidate = structuredClone(Config.getConfig())
        candidate.avatarReply = normalizeAvatarReplyConfig(candidate.avatarReply)
        const groups = candidate.avatarReply.groups
        const row = groups.find(g => g.botId === botId && g.groupId === groupId)
        if (row) row.switchOn = action === '开启'
        else groups.push({ botId, groupId, switchOn: action === '开启' })
        Config.commit(candidate)
        avatarReply.changed(e)
        await e.reply('本群角色动图已' + action, true)
      } else if (action === '预览') {
        await avatarReply.send(e, '你好呀，我准备好啦！', undefined, true, requested?.trim())
      } else {
        let resource
        let error
        try { resource = await avatarReply.store.load(botId, selection.avatarId) } catch (err) { error = err.message }
        await e.reply('角色文件：' + avatarReply.store.filename(botId, selection.avatarId)
          + '\n输出：' + selection.size + '，' + selection.duration + ' 秒，' + selection.fps + ' FPS'
          + '\n当前群：' + (avatarReply.enabled(e) ? '已开启' : '未开启')
          + '\n资源：' + (resource ? resource.pictures.length + ' 张图片' : '未加载')
          + '\n特色表情：' + (resource?.expressions.map(x => x.label).join('、') || '无')
          + ((error || avatarReply.store.error(botId, selection.avatarId))
            ? '\n读取提示：' + (error || avatarReply.store.error(botId, selection.avatarId)) : ''), true)
      }
    } catch (err) {
      await e.reply('角色动图操作未完成：' + err.message, true)
    }
    return true
  }
}
