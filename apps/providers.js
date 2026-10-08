import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { listProviders, providerLabel, MODEL_FIELDS, KEY_FIELDS, URL_FIELDS, PROMPT_FIELDS } from '../utils/providerProfiles.js'
import { resolveProvider, updateProvider } from '../utils/providers.js'
import { fetchProviderModels } from '../utils/providerModels.js'

export class ProviderManagement extends plugin {
  constructor() {
    super({ name: 'ChatGPT-Plugin 模型提供商', event: 'message', priority: 450, rule: [
      { reg: /^#chatgpt切换(?:模型(?:提供商|api|gemini|claude|responses)?|提供商|api|gemini|claude|responses)$/i, fnc: 'switchProvider', permission: 'master' },
      { reg: /^#chatgpt设置(api|gemini|claude|responses)?(key|模型|地址|反代|设定)$/i, fnc: 'editProvider', permission: 'master' },
      { reg: /^#chatgpt(开启|关闭)(api流|gemini搜索|gemini代码执行)$/i, fnc: 'toggleProvider', permission: 'master' },
      { reg: /^#chatgpt设置翻译来源.*$/i, fnc: 'translationProvider', permission: 'master' },
      { reg: /^#chatgpt获取可用模型$/i, fnc: 'availableModels', permission: 'master' }
    ] })
  }

  async availableModels(e) {
    if (!e.isMaster) return true
    try {
      const rows = listProviders(Config.getConfig())
      if (!rows.length) throw new Error('请先在锅巴新增模型提供商')
      const id = await this.choose(e, rows, '请选择要获取可用模型的提供商')
      // 按菜单中的稳定 ID 重新解析，避免等待期间重排或删除条目后查询错账号。
      const row = resolveProvider(id)
      await e.reply(`正在获取 ${providerLabel(row)} 的可用模型……`, true)
      const models = await fetchProviderModels(row)
      const title = `${providerLabel(row)} 可用模型（${models.length} 个）`
      const hint = '请复制需要的模型名称，填入锅巴中此提供商的模型字段。列表由接口返回，实际调用权限以服务商为准。'
      const chunks = []
      let chunk = ''
      for (const model of models) {
        if (chunk.length + model.length + 1 > 1800) { chunks.push(chunk); chunk = '' }
        chunk += `${model}\n`
      }
      if (chunk) chunks.push(chunk.trimEnd())
      if (chunks.length === 1) await e.reply(`${title}\n${chunks[0]}\n${hint}`, true)
      else {
        const { makeForwardMsg } = await import('../utils/common.js')
        // 多个模型合并为一个节点，按批发送完整列表，避免逐模型节点触及 QQ 上限。
        for (let i = 0; i < chunks.length; i += 80) {
          await e.reply(await makeForwardMsg(e, [title, ...chunks.slice(i, i + 80), hint], title))
        }
      }
    } catch (err) {
      await e.reply(`获取可用模型未完成：${err.message}`, true)
    }
    return true
  }

  async choose(e, rows, title, allowNone = false) {
    await e.reply(`${title}\n${rows.map((row, i) => `${i + 1}. ${row.label || providerLabel(row)}${row.type ? `（${row[MODEL_FIELDS[row.type]] || '未设置模型'}）` : ''}`).join('\n')}\n${allowNone ? '0. 不启用回退' : '0. 取消'}\n请在 60 秒内回复数字，发送“取消”或“退出”终止。`, true)
    const response = await this.awaitContext(false, 60)
    if (!response || !response.isMaster || String(response.user_id ?? response.sender?.user_id) !== String(e.user_id ?? e.sender?.user_id)) throw new Error('操作已取消或超时')
    const text = response.msg?.trim() || ''
    if (['取消', '退出'].includes(text) || text === '0' && !allowNone) throw new Error('操作已取消')
    if (text === '0' && allowNone) return ''
    if (!/^[1-9]\d*$/.test(text) || Number(text) > rows.length) throw new Error('序号无效，操作已取消')
    return rows[Number(text) - 1].id
  }

  async switchProvider(e) {
    if (!e.isMaster) return true
    try {
      const rows = listProviders(Config.getConfig())
      if (!rows.length) throw new Error('请先在锅巴新增模型提供商')
      const id = await this.choose(e, rows, '请选择主模型提供商')
      const main = resolveProvider(id)
      const backup = await this.choose(e, listProviders(Config.getConfig()).filter(row => row.type === main.type && row.id !== id), '请选择失败回退模型提供商', true)
      // 完成两步前不改变全局选择；保存时重新验证正在编辑的最新配置。
      const candidate = structuredClone(Config.getConfig())
      candidate.defaultProviderId = id
      candidate.fallbackProviderId = backup
      Config.commit(candidate)
      await e.reply(`已切换：${providerLabel(resolveProvider(id))}\n失败回退：${backup ? providerLabel(resolveProvider(backup)) : '不启用'}`, true)
    } catch (err) { await e.reply(err.message, true) }
    return true
  }

  async editProvider(e) {
    if (!e.isMaster) return true
    try {
      const [, type, setting] = e.msg.match(/^#chatgpt设置(api|gemini|claude|responses)?(key|模型|地址|反代|设定)$/i)
      const row = resolveProvider()
      if (type && row.type !== type.toLowerCase()) throw new Error('当前提供商协议不匹配，请先使用 #chatgpt切换模型')
      const fields = { key: KEY_FIELDS, 模型: MODEL_FIELDS, 地址: URL_FIELDS, 反代: URL_FIELDS, 设定: PROMPT_FIELDS }
      await e.reply(`正在修改 ${providerLabel(row)} 的${setting}，请在 60 秒内发送新值；取消或退出终止。`, true)
      const response = await this.awaitContext(false, 60)
      if (!response?.isMaster || String(response.user_id ?? response.sender?.user_id) !== String(e.user_id ?? e.sender?.user_id)) throw new Error('操作已取消或超时')
      const value = response.msg?.trim()
      if (!value || ['取消', '退出'].includes(value)) throw new Error('操作已取消')
      if (['地址', '反代'].includes(setting) && !/^https?:\/\//i.test(value)) throw new Error('地址需要以 http:// 或 https:// 开头')
      updateProvider(row.id, { [fields[setting.toLowerCase()][row.type]]: value })
      await e.reply(`${providerLabel(row)} 的${setting}已保存`, true)
    } catch (err) { await e.reply(err.message, true) }
    return true
  }

  async toggleProvider(e) {
    if (!e.isMaster) return true
    try {
      const row = resolveProvider()
      const gemini = /gemini/i.test(e.msg)
      if (row.type !== (gemini ? 'gemini' : 'api')) throw new Error('当前提供商协议不匹配，请先切换模型')
      const field = gemini ? (e.msg.includes('搜索') ? 'geminiEnableGoogleSearch' : 'geminiEnableCodeExecution') : 'apiStream'
      updateProvider(row.id, { [field]: e.msg.includes('开启') })
      await e.reply(`${providerLabel(row)} 设置已保存`, true)
    } catch (err) { await e.reply(err.message, true) }
    return true
  }

  async translationProvider(e) {
    if (!e.isMaster) return true
    try {
      const id = await this.choose(e, [...listProviders(Config.getConfig()), { id: 'baidu', label: '百度翻译' }], '请选择翻译来源')
      Config.translateSource = id
      await e.reply('翻译来源已保存', true)
    } catch (err) { await e.reply(err.message, true) }
    return true
  }
}
