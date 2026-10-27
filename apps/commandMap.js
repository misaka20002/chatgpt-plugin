import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { readCapabilityState } from '../utils/capability/store.js'
import { syncPatches } from '../utils/commandMap/sync.js'

/**
 * 指令地图的入口：只做一件事——把地图补丁拉到本地。
 *
 * 不生成地图（生成是离线流水线的事），不重建能力表（那是能力地图的活）。
 * 拉回来的补丁只补「关键词 / 参数 / 示例 / 风险档」，写法与权限仍然来自能力表。
 */
export class commandMap extends plugin {
  constructor () {
    super({
      name: 'ChatGPT-Plugin 指令地图',
      dsc: '拉取插件指令地图补丁：关键词、参数、示例、风险档',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#chatgpt更新指令地图$',
          fnc: 'sync',
          permission: 'master'
        }
      ]
    })
  }

  async sync (e) {
    const indexUrl = String(Config.commandMapIndexUrl || '').trim()
    if (!indexUrl) {
      await e.reply('还没有配置地图仓库地址：锅巴 →「智能模式 能力地图」→ 地图索引地址（index.json 的完整 URL）。', true)
      return true
    }

    const state = readCapabilityState()
    const pluginKeys = [...new Set((state?.meta?.entries || []).map(entry => entry.pluginKey).filter(Boolean))]
    if (!pluginKeys.length) {
      await e.reply('还没有能力表可对齐：先发送 #chatgpt刷新功能表 生成后再更新地图。', true)
      return true
    }

    await e.reply(`开始更新指令地图：本机 ${pluginKeys.length} 个插件，按索引匹配云端补丁。`, true)

    const startedAt = Date.now()
    try {
      const result = await syncPatches({ indexUrl, pluginKeys })
      const lines = [
        `更新完成（耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）`,
        `已更新 ${result.updated} 份 ｜ 云端没有 ${result.skipped} 份 ｜ 失败 ${result.failed} 份`
      ]
      if (result.errors.length) lines.push(`失败原因：${result.errors.slice(0, 3).join('；')}`)
      await e.reply(lines.join('\n'), true)
    } catch (err) {
      globalThis.logger?.warn?.(`[Chatgpt][commandMap] 地图同步失败：${err.message}`)
      await e.reply(`Error: 地图更新失败 —— ${err.message}`, true)
    }
    return true
  }
}
