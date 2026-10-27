import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { ensureCapabilityState } from '../utils/capability/rebuild.js'
import { readCapabilityState } from '../utils/capability/store.js'
import { previewList } from '../utils/capability/form.js'

/**
 * 能力地图的入口：手动刷新指令 + 每 7 天的过期检查。
 *
 * 只做两件事，不含取表/合并/审核逻辑——那些在 utils/capability/ 下，可以脱离框架测试。
 */
export class capabilityMap extends plugin {
  constructor () {
    super({
      name: 'ChatGPT-Plugin 能力地图',
      dsc: '扫描本机其他插件的指令，生成能力表单供对话 AI 检索',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#chatgpt刷新功能表$',
          fnc: 'refresh',
          permission: 'master'
        }
      ]
    })

    this.task = [
      {
        // 每天凌晨 4:30 检查一次，只有过期才真重建（7 天节奏由 TTL 控制，不是 cron 控制）
        cron: '0 30 4 * * ?',
        name: 'ChatGPT插件能力表过期重建',
        fnc: this.rebuildIfStale.bind(this)
      }
    ]
  }

  async refresh (e) {
    if (Config.enableCapabilityMap === false) {
      await e.reply('能力自省功能已关闭，请先在锅巴「智能模式 能力地图」里开启。', true)
      return true
    }

    await e.reply('开始重建插件能力表：扫描本机第三方插件 → 脱敏 → 主模型分批审核。实测 1161 条指令（15 批）约 3 分钟；指令更多或模型较慢会更久，完成后会再发一条结果。', true)

    try {
      const before = readCapabilityState()?.meta?.generatedAt || ''
      const startedAt = Date.now()
      await ensureCapabilityState({ force: true })
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
      const state = readCapabilityState()
      const after = state?.meta?.generatedAt || ''

      // 没换新表有两种可能：审核未通过（沿用旧版，告警已私聊）、或本机没有第三方插件
      if (!after || after === before) {
        const detail = state?.meta
          ? `当前仍使用 ${state.meta.generatedAt} 生成的版本（${state.meta.pluginCount} 个插件 / ${state.meta.entryCount} 条指令）。`
          : '当前没有任何可用版本。'
        await e.reply(`本次未生成新表（审核未通过，或本机没有第三方插件）。${detail}耗时 ${elapsed}s。`, true)
        return true
      }

      const { meta } = state
      const lines = [
        `能力表已更新（耗时 ${elapsed}s${meta.auditBatches ? `，分 ${meta.auditBatches} 批审核` : ''}）`,
        `插件类：${meta.pluginCount} 个 ｜ 指令：${meta.entryCount} 条 ｜ 目录已展开：${meta.listedCount ?? meta.entryCount} 条`,
        `数据来源：${meta.degraded ? '源码粗提（可能不完整）' : '框架插件总表'}`,
        `生成时间：${meta.generatedAt}`
      ]
      if (meta.unlistedPlugins?.length) {
        lines.push(`未展开插件（${meta.unlistedPlugins.length} 个）：${previewList(meta.unlistedPlugins, 10)}`)
      }
      await e.reply(lines.join('\n'), true)
    } catch (err) {
      globalThis.logger?.warn?.(`[Chatgpt][capability] 手动重建失败：${err.message}`)
      await e.reply(`Error: 重建失败 —— ${err.message}`, true)
    }
    return true
  }

  /** 定时入口：只有过期才真重建，避免每天扫一遍 */
  async rebuildIfStale () {
    if (Config.enableCapabilityMap === false) return
    await ensureCapabilityState({ force: false })
  }
}
