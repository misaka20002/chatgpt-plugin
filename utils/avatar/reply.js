import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { avatarEnabled, avatarChannelId, avatarIdentity, avatarReplyRow, avatarRenderOptions, validateAvatarId,
  createAvatarCue, fallbackAvatarCue, normalizeAvatarReplyConfig } from './config.js'
import { AvatarResourceStore } from './resource.js'
import { AvatarRenderQueue } from './queue.js'

export class AvatarReplyService {
  constructor({ root = process.cwd(), getConfig, generate, sendImage,
    warn = message => globalThis.logger?.warn(message), queue = new AvatarRenderQueue() } = {}) {
    this.getConfig = getConfig
    this.generate = generate
    this.sendImage = sendImage
    this.warn = warn
    this.queue = queue
    this.store = new AvatarResourceStore(root, warn)
    this.sent = new WeakSet()
    this.groupVersions = new Map()
  }

  enabled(e) { return avatarEnabled(e, this.getConfig()) }

  selection(e, explicitAvatarId) {
    const row = avatarReplyRow(e, this.getConfig())
    const avatarId = explicitAvatarId === undefined ? row?.avatarId || '' : validateAvatarId(explicitAvatarId)
    return { avatarId, ...avatarRenderOptions(row) }
  }

  changed(e) {
    const { botId, groupId } = avatarIdentity(e)
    const key = botId + ':' + groupId
    this.groupVersions.set(key, (this.groupVersions.get(key) || 0) + 1)
  }

  async send(e, text, providerId, preview = false, explicitAvatarId) {
    if (!preview && (!this.enabled(e) || this.sent.has(e))) return false
    if (!preview) this.sent.add(e)
    let directory
    try {
      const { botId, groupId } = avatarIdentity(e)
      const key = botId + ':' + groupId
      const generation = this.groupVersions.get(key) || 0
      const selection = this.selection(e, explicitAvatarId)
      // 旧版 Bot 默认角色已移除：未选择角色文件夹时没有可用资源，不再渲染。
      if (!selection.avatarId) throw new Error('未选择角色文件夹')
      const selectionKey = JSON.stringify(selection)
      // 在原始配置数组上按通道查行：配置提交换行后 includes 失配即取消旧任务（归一化后的行是新对象，不能复用）。
      const authorizedRow = this.getConfig()?.groups?.find(g =>
        String(g.botId) === botId && String(g.groupId) === avatarChannelId(e))
      const resource = await this.store.load(botId, selection.avatarId)
      // 配置提交会替换群表行；关闭再开启也不能放行之前的任务。
      const isCurrent = () => JSON.stringify(this.selection(e, explicitAvatarId)) === selectionKey
        && (preview || this.enabled(e) && this.getConfig()?.groups?.includes(authorizedRow)
          && (this.groupVersions.get(key) || 0) === generation)
      let cue = fallbackAvatarCue(text)
      if (!preview) {
        try {
          // 'current' 保持跟随本轮对话实际使用的条目；未取到时由 SubLLM 回落全局默认。
          const { provider } = normalizeAvatarReplyConfig(this.getConfig())
          cue = await createAvatarCue(text, resource.expressions,
            provider === 'current' ? providerId : provider, this.generate)
        } catch (err) {
          this.warn('[ChatGPT] 角色短句生成失败，使用首句：' + err.message)
        }
      }
      const gif = await this.queue.render(resource, cue, isCurrent, selection)
      const latest = await this.store.load(botId, selection.avatarId)
      if (!isCurrent() || latest.version !== resource.version) return false
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-avatar-'))
      const filename = path.join(directory, 'reply.gif')
      await fs.writeFile(filename, gif)
      if (!isCurrent()) return false
      await this.sendImage(e, filename)
      return true
    } catch (err) {
      this.warn('[ChatGPT] 角色动图未发送：' + err.message)
      if (preview) throw err
      return false
    } finally {
      if (directory) {
        try { await fs.rm(directory, { recursive: true, force: true }) }
        catch (err) { this.warn('[ChatGPT] 角色临时文件清理失败：' + err.message) }
      }
    }
  }
}
