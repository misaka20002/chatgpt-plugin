import plugin from '../../../lib/plugins/plugin.js'
import { createHash, randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Config } from '../utils/config.js'
import { render } from '../utils/common.js'
import { MemoryStore } from '../utils/memory/store.js'
import { extractStructured, getBotUin } from '../utils/memory/capture.js'
import { buildAtGraph } from '../utils/memory/atGraph.js'
import { loadAtGraphAvatars } from '../utils/atGraphAvatars.js'

const inFlight = new Set()
const girlImages = ['girl.webp', 'girl01.webp', 'girl02.webp', 'girl03.webp', 'girl04.webp', 'girl05.webp']

export class atGraph extends plugin {
  constructor() {
    super({
      name: 'ChatGPT-Plugin AT图谱',
      dsc: '从本群记忆原文统计 @ 互动并直接出图，不调用模型',
      event: 'message',
      priority: 500,
      rule: [{ reg: '^#(?:[aA][tT]|艾特)图谱(?:\\s*[\\s\\S]*)?$', fnc: 'graph' }]
    })
  }

  async graph(e) {
    if (!e.isGroup || !e.group_id) {
      await e.reply('请在已开启群记忆的群聊中使用 #at图谱。', true)
      return true
    }
    if (Config.enableAtGraph === false) {
      await e.reply('AT图谱已关闭，请主人在锅巴「智能模式 记忆设置」中开启「启用 AT 图谱」。', true)
      return true
    }
    const gid = String(e.group_id)
    const authorized = () => Config.enableMemory && MemoryStore.isGroupAuthorized(Config.memoryGroupCapture?.groups, gid)
    if (!authorized()) {
      await e.reply('AT图谱需要启用记忆系统并授权本群采集，请主人启用后在本群使用 #群记忆开启。', true)
      return true
    }
    const botId = getBotUin(e)
    const mentions = extractStructured(e.message ?? e.raw_message ?? e.msg)
    const targets = mentions.at.filter(id => id !== botId)
    const suffix = String(e.msg || '').replace(/^#(?:at|艾特)图谱/i, '').trim()
    if (mentions.atAll || targets.length > 1 || (suffix && !/^\d{5,20}$/.test(suffix))) {
      await e.reply('用法：#at图谱 查看自己；#at图谱 @某人（或 QQ 号）查看该成员在本群的互动。\n好感度固定展示前 5 位，一次只能查看一人的图谱。', true)
      return true
    }
    if (targets.length && suffix && targets[0] !== suffix) {
      await e.reply('请只指定一个图谱对象：@某人或填写 QQ 号。', true)
      return true
    }
    const selected = targets[0] || suffix || String(e.user_id)
    const targetId = selected === botId ? String(e.user_id) : selected
    if (inFlight.has(gid) || inFlight.size >= 2) {
      await e.reply('AT图谱正在生成，请稍后再试。', true)
      return true
    }
    inFlight.add(gid)
    try {
      const generatedAt = Math.floor(Date.now() / 1000)
      const snapshot = await new MemoryStore().getRecentRawMessages(gid, generatedAt)
      const graph = buildAtGraph({
        ...snapshot, groupId: gid, targetId, botId, generatedAt,
        targetName: targetId === String(e.user_id) ? e.sender?.card || e.sender?.nickname : '',
        groupName: e.group_name || e.group?.name || e.group?.info?.group_name
      })
      if (!graph.total) {
        await e.reply(`${graph.target.name} 在本群当前保留的记录中还没有可统计的 @ 互动${snapshot.limited ? `（本次仅检查最近 ${snapshot.limit} 条记录）` : ''}。\n只统计明确的成员 @，不含指令、机器人、自我 @、@全体、引用和戳一戳；旧记录未保存的 @ 无法补算。`, true)
        return true
      }
      const girlFile = new URL(`../resources/girls/${girlImages[randomInt(girlImages.length)]}`, import.meta.url)
      const [avatars, girlBuffer] = await Promise.all([loadAtGraphAvatars(graph), readFile(girlFile)])
      // 本地固定素材转成 data URI，保持模板不开放 file: 图片读取的边界。
      const girlImage = `data:image/webp;base64,${girlBuffer.toString('base64')}`
      // 同群已有并发互斥；分群复用模板文件，避免串图或每次请求遗留一份 HTML。
      const img = await render(e, 'chatgpt-plugin', 'atGraph/index', {
        ...graph, avatars, girlImage, saveId: `at-${createHash('sha256').update(gid).digest('hex').slice(0, 16)}`
      }, { retType: 'base64' })
      if (!img) throw new Error('渲染器未返回图片')
      // 读取和截图期间可能关闭群采集；发送前再次检查实时授权。
      if (Config.enableAtGraph === false || !authorized()) {
        await e.reply('AT图谱开关或本群记忆采集已关闭，本次图谱已取消。', true)
        return true
      }
      const sent = await e.reply(img, true)
      if (sent === false) throw new Error('图片发送失败')
    } catch (err) {
      logger.error(`[MemoryV2] AT图谱生成失败（群 ${gid}，成员 ${targetId}）：${err.stack || err.message}`)
      await e.reply('AT图谱生成失败，请稍后重试；具体原因已记录到日志。', true)
    } finally {
      inFlight.delete(gid)
    }
    return true
  }
}
