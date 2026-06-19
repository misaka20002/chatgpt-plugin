import plugin from '../../../lib/plugins/plugin.js'
import * as skillsManager from '../utils/skills.js'

export class SkillsAction extends plugin {
  constructor() {
    super({
      name: 'chatgpt-skills-action',
      dsc: 'Skills 管理 - 手动触发监控 repo 刷新',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#skills刷新repo$',
          fnc: 'refreshRepoMonitors'
        }
      ]
    })
  }

  async refreshRepoMonitors(e) {
    if (!e.isMaster) {
      await this.reply('仅主人可触发 skills repo 刷新')
      return false
    }
    await this.reply('开始刷新 skills repo 监控...')
    try {
      const candidates = await skillsManager.refreshRepoMonitors()
      const count = candidates.length
      await this.reply(`刷新完成，扫到 ${count} 个候选 skill${count > 0 ? '，请到锅巴「Skills 管理」->「已装 Skills 管理」下拉选项中勾选安装' : ''}`)
    } catch (err) {
      await this.reply(`刷新失败: ${err.message}`)
    }
    return true
  }
}
