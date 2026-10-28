import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { rebuildCapabilityState } from '../utils/capability/rebuild.js'
import { readCapabilityState } from '../utils/capability/store.js'
import { previewList } from '../utils/capability/form.js'
import { syncPatches } from '../utils/commandMap/sync.js'

const DISABLED_HINT = '能力地图功能已关闭，请先在锅巴「插件能力地图（AI 代执行）」里打开「启用插件能力地图」。'

/**
 * 两张地图的维护入口：能力表只能手动重建，指令地图补丁也只能手动拉取。
 *
 * 刻意不注册定时任务，也不做过期自动重建：一次重建要把本机全部指令分批发给模型审核，
 * 条数取决于装了多少插件；这是一笔真金白银的支出，什么时候花由主人按指令决定，不能在凌晨自己发生。
 * 代价是表单不会自己变新——装了新插件要记得发一次刷新。
 *
 * 两个指令放在同一个类里：都属于「主人手动触发的地图维护」，
 * 且框架每个 app 文件只注册第一个导出，拆成两个文件就得多一份注册样板。
 * 指令地图补丁只补「关键词 / 参数 / 示例 / 风险档」，写法与权限仍然来自能力表。
 */
export class mapMaintenance extends plugin {
  constructor () {
    super({
      name: 'ChatGPT-Plugin 地图维护',
      dsc: '重建插件能力表（扫描本机指令供对话 AI 检索），并同步指令地图补丁（关键词 / 参数 / 示例 / 风险档）；均仅主人手动触发',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#chatgpt刷新功能表$',
          fnc: 'refresh',
          permission: 'master'
        },
        {
          reg: '^#chatgpt更新指令地图$',
          fnc: 'sync',
          permission: 'master'
        }
      ]
    })
  }

  async refresh (e) {
    if (Config.enableCapabilityMap === false) {
      await e.reply(DISABLED_HINT, true)
      return true
    }

    await e.reply('开始重建插件能力表：扫描本机第三方插件 → 脱敏 → 主模型分批审核。指令越多或模型越慢，耗时越长，完成后会再发一条结果。', true)

    try {
      const before = readCapabilityState()?.meta?.generatedAt || ''
      const startedAt = Date.now()
      await rebuildCapabilityState()
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
      const state = readCapabilityState()
      const after = state?.meta?.generatedAt || ''

      // 没换新表有三种可能：审核未通过（沿用旧版，且只有完全没有旧版时才私聊告警）、
      // 重建过程出错（异常已被 rebuildCapabilityState 吞掉，只留日志）、或本机没有第三方插件
      if (!after || after === before) {
        const detail = state?.meta
          ? `当前仍使用 ${state.meta.generatedAt} 生成的版本（${state.meta.pluginCount} 个插件类 / ${state.meta.entryCount} 条指令）。`
          : '当前没有任何可用版本。'
        await e.reply(`本次未生成新表（审核未通过、重建出错，或本机没有第三方插件）。${detail}耗时 ${elapsed}s，原因见日志。`, true)
        return true
      }

      const { meta } = state
      const lines = [
        `能力表已更新（耗时 ${elapsed}s${meta.auditBatches ? `，分 ${meta.auditBatches} 批审核` : ''}）`,
        `插件类：${meta.pluginCount} 个 ｜ 指令：${meta.entryCount} 条`,
        `目录展开：${meta.listedCount ?? '?'} 个类（覆盖 ${meta.listedEntryCount ?? '?'} 条）｜ 未展开：${meta.unlistedPlugins?.length || 0} 个类`,
        `数据来源：${meta.degraded ? '源码粗提（可能不完整）' : '框架插件总表'}`,
        `生成时间：${meta.generatedAt}`
      ]
      if (meta.unlistedPlugins?.length) {
        lines.push(`未展开的类（仍可查询）：${previewList(meta.unlistedPlugins, 10)}`)
      }
      await e.reply(lines.join('\n'), true)
    } catch (err) {
      globalThis.logger?.warn?.(`[Chatgpt][capability] 手动重建失败：${err.message}`)
      await e.reply(`Error: 重建失败 —— ${err.message}`, true)
    }
    return true
  }

  async sync (e) {
    // 与每日自动同步、手动重建共用总开关：关掉后三个入口都不许动地图数据
    if (Config.enableCapabilityMap === false) {
      await e.reply(DISABLED_HINT, true)
      return true
    }

    const indexUrl = String(Config.commandMapIndexUrl || '').trim()
    if (!indexUrl) {
      await e.reply('还没有配置地图仓库地址：内置地址只在 config.json 的 commandMapIndexUrl 被清空时才会缺失，补回后重试（一般不用改）。', true)
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
        `更新完成（版本 ${result.revision}，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）`,
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
