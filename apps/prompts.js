import { currentProviderType, resolveProvider, updateProvider } from '../utils/providers.js'
import { PROMPT_FIELDS, providerLabel } from '../utils/providerProfiles.js'
import { chooseFromMenu, requestBackupOrConfirm } from '../utils/menu.js'
import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { getMasterQQ, limitString, makeForwardMsg, maskQQ, getUin } from '../utils/common.js'
import { deleteOnePrompt, getPromptByName, readPrompts, saveOnePrompt } from '../utils/prompts.js'
import AzureTTS from '../utils/tts/microsoft-azure.js'

/**
 * 找出当前默认模型正在用的设定（正文完全相同的可能不止一份，都算）。
 *
 * 靠正文比对而不是读 redis 里记的设定名：锅巴或 #chatgpt设置设定 改过字段之后，那条记录与真正生效的内容
 * 就脱钩了，菜单会继续标错。应用时开着 azure 语音会往正文后追加情绪提示，所以先找完全相等的，
 * 找不到再按「正文 + 换行」前缀匹配，并且只认最长的那一份——避免一份设定恰好是另一份的前缀时两边都标。
 */
function activePromptNames (current, prompts) {
  const normalize = text => String(text ?? '').replace(/\r\n/g, '\n').trimEnd()
  const applied = normalize(current)
  if (!applied) return new Set()
  const exact = prompts.filter(p => normalize(p.content) === applied)
  if (exact.length) return new Set(exact.map(p => p.name))
  let longest = null
  for (const prompt of prompts) {
    const target = normalize(prompt.content)
    if (!target || !applied.startsWith(`${target}\n`)) continue
    if (!longest || target.length > normalize(longest.content).length) longest = prompt
  }
  return new Set(longest ? [longest.name] : [])
}

/**
 * 当前默认模型里生效的设定正文。
 *
 * 没有配置默认模型时 `resolveProvider()` 会抛错，这里吞成空串：删除设定不该因为「模型还没配」
 * 被拦住，只是菜单里没有「当前使用」标记可标。
 * @returns {string} 生效中的正文；取不到时为空串
 */
function currentPromptValue () {
  try {
    const row = resolveProvider()
    return row[PROMPT_FIELDS[row.type]] || ''
  } catch {
    return ''
  }
}

/**
 * 把回复解析成可用的备份设定名，非法时抛错（调用方的 catch 会把原因回给主人）。
 *
 * 名字最终会拼成 prompts/<名字>.txt，所以先去掉重复的 .txt 后缀，再挡路径分隔符与文件系统不接受的字符。
 * @param {string} text 主人的回复
 * @returns {string} 备份名
 */
function normalizeBackupName (text) {
  const name = text.replace(/\.txt$/i, '')
  if (!name) throw new Error('备份名字不能为空，操作已取消')
  if (name.length > 40) throw new Error('备份名字太长（超过 40 个字符），操作已取消')
  if (/[\\/:*?"<>|]/.test(name) || name.startsWith('.')) throw new Error('备份名字不能包含 / \\ : * ? " < > | 或以 . 开头，操作已取消')
  if (getPromptByName(name)) throw new Error(`已存在同名设定「${name}」，为避免覆盖它，操作已取消`)
  return name
}

/**
 * 本地没有设定时的统一提示。
 */
const NO_PROMPTS_HINT = '本地还没有设定。使用 #chatgpt添加设定 新建，或把设定文件放到 prompts 目录'

/**
 * 把设定列表转成菜单条目：当前生效的那份追加「（当前使用）」。
 * 使用与删除共用，免得两边的标记规则各写一遍、日后一边改了另一边没改。
 * @param {{name: string}[]} prompts 本地设定
 * @param {Set<string>} active 当前生效的设定名
 * @returns {{label: string, value: string}[]} 菜单条目
 */
function promptMenuItems (prompts, active) {
  return prompts.map(p => ({
    label: active.has(p.name) ? `${p.name}（当前使用）` : p.name,
    value: p.name
  }))
}

/**
 * 条目过多时的出路提示：序号仍覆盖全表，但直发名字更快。
 * @param {number} count 条目数
 * @param {string} command 直接发送的指令前缀
 * @returns {string} 菜单末的提示；条目不多时为空串
 */
function countHint (count, command) {
  return count > 30 ? `数量较多，也可以直接发送 ${command}<设定名>` : ''
}

export class help extends plugin {
  constructor (e) {
    super({
      name: 'ChatGPT-Plugin 人物设定',
      dsc: '让你的聊天更加有趣！本插件支持丰富的人物设定拓展，可以在线浏览并导入喜欢的设定和上传自己的设定。让你的聊天更加生动有趣！',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#(chatgpt|ChatGPT)设定列表$',
          fnc: 'listPrompts',
          permission: 'master'
        },
        {
          reg: '^#(chatgpt|ChatGPT)查看设定',
          fnc: 'detailPrompt',
          permission: 'master'
        },
        {
          reg: '^#(chatgpt|ChatGPT)使用设定',
          fnc: 'usePrompt',
          permission: 'master'
        },
        {
          reg: '^#(chatgpt|ChatGPT)添加设定',
          fnc: 'addPrompt',
          permission: 'master'
        },
        {
          reg: '^#(chatgpt|ChatGPT)(删除|移除)设定',
          fnc: 'removePrompt',
          permission: 'master'
        },
        {
          reg: '^#(chatgpt|ChatGPT)(上传|分享|共享)设定',
          fnc: 'uploadPrompt',
          permission: 'master'
        },
        {
          reg: '^#(chatgpt|ChatGPT)(删除|取消|撤销)共享设定',
          fnc: 'removeSharePrompt',
          permission: 'master'
        },
        {
          reg: '^#(chatgpt|ChatGPT)导入设定',
          fnc: 'importPrompt',
          permission: 'master'
        },
        {
          reg: '^#(chatgpt|ChatGPT)(在线)?(浏览|查找)设定',
          fnc: 'browsePrompt'
        },
        {
          reg: '^#(chatgpt|ChatGPT)(在线)?预览设定详情',
          fnc: 'detailCloudPrompt'
        },
        {
          reg: '^#(chatgpt|ChatGPT)设定帮助$',
          fnc: 'helpPrompt',
          permission: 'master'
        }
      ]
    })
  }

  // 当前不可用：主人 2026-10 确认此指令无法使用。实现本身只读本地 prompts 目录、不访问云端，
  // 恢复前需要先在真实环境复现失败点，不要把它当作「云端已下线」的同类。
  async listPrompts (e) {
    let prompts = []
    let defaultPrompt = {
      name: 'API默认',
      content: Config.promptPrefixOverride
    }
    let defaultSydneyPrompt = {
      name: 'Sydney默认',
      content: Config.sydney
    }
    prompts.push(...[defaultPrompt, defaultSydneyPrompt])
    prompts.push(...readPrompts())
    console.log(prompts)
    e.reply(await makeForwardMsg(e, prompts.map(p => `《${p.name}》\n${limitString(p.content, 100)}`), '设定列表'))
  }

  async detailPrompt (e) {
    let promptName = e.msg.replace(/^#(chatgpt|ChatGPT)查看设定/, '').trim()
    let prompt = getPromptByName(promptName)
    if (!prompt) {
      if (promptName === 'API默认') {
        prompt = {
          name: 'API默认',
          content: Config.promptPrefixOverride
        }
      } else if (promptName === 'Sydney默认') {
        prompt = {
          name: 'Sydney默认',
          content: Config.sydney
        }
      } else {
        await e.reply('没有这个设定', true)
        return
      }
    }
    await e.reply(`《${prompt.name}》\n${limitString(prompt.content, 500)}`, true)
  }

  async usePrompt (e) {
    try {
      // 指令执行时就把默认模型定下来：确认文案里写的是哪个模型，最终就写入哪个模型。
      // 等待期间他人切换主模型也不会让文案与实际落点错位。
      const row = resolveProvider()
      const current = row[PROMPT_FIELDS[row.type]] || ''
      const name = await this.pickPromptName(e, current)
      const backupName = current ? await this.askBackupName(e, row, name, current) : ''
      // 菜单和确认两次等待之间设定可能已被删除。先确认它还在，再落备份和覆盖，避免留下半套结果。
      const prompt = getPromptByName(name)
      if (!prompt) throw new Error(`没有找到设定「${name}」，可能刚被删除，未做任何改动`)
      if (backupName) saveOnePrompt(backupName, current)
      const content = Config.ttsMode === 'azure' ? prompt.content + '\n' + await AzureTTS.getEmotionPrompt(e) : prompt.content
      updateProvider(row.id, { [PROMPT_FIELDS[row.type]]: content })
      await e.reply([
        backupName ? `当前设定已备份为「${backupName}」。` : '',
        `已将设定「${name}」应用到 ${providerLabel(row)}。`,
        '建议结束当前对话，使新设定在下一轮对话中生效。'
      ].filter(Boolean).join('\n'), true)
    } catch (err) {
      // 这里只回主人能看懂的那句：取消、名字不存在都属于正常结果，不该再往控制台丢栈；
      // 带 code 的是真正的系统错误，留一条日志再回。
      if (err.code) logger.error(`[ChatGPT] 应用设定失败：${err.message}`)
      await e.reply(err.message, true)
    }
  }

  /**
   * 解析出要应用的设定名：带名字就直接用，不带就列出本地设定让主人选序号。
   * @returns {Promise<string>} 设定名
   */
  async pickPromptName (e, current) {
    const prompts = readPrompts()
    if (!prompts.length) throw new Error(NO_PROMPTS_HINT)
    const typed = e.msg.replace(/^#(chatgpt|ChatGPT)使用设定/, '').trim()
    if (typed) {
      // 云端设定站已经下线，名字对不上时没有联网回退，只剩本地文件这一条路。
      if (!prompts.some(p => p.name === typed)) throw new Error(`没有这个设定。发送 #chatgpt使用设定 可以查看本地已保存的 ${prompts.length} 个设定`)
      return typed
    }
    const active = activePromptNames(current, prompts)
    return chooseFromMenu(this, e, promptMenuItems(prompts, active), `请选择要使用的设定（共 ${prompts.length} 个）`, {
      hint: countHint(prompts.length, '#chatgpt使用设定')
    })
  }

  /**
   * 覆盖前问一次要不要留底：0 取消、确定 直接覆盖、其它内容当备份设定名。
   * @returns {Promise<string>} 备份名；空串表示不备份
   */
  async askBackupName (e, row, name, current) {
    return requestBackupOrConfirm(this, e, {
      header: `即将把设定「${name}」应用到 ${providerLabel(row)}，会覆盖它当前的设定：`,
      preview: limitString(current, 200),
      confirmWords: ['确定', '覆盖', '直接覆盖'],
      confirmHint: '确定',
      actionLabel: '覆盖',
      resolveBackup: normalizeBackupName
    })
  }

  async setSydneyBrainWashName (e) {
    let name = e.msg.replace(/^#(chatgpt|ChatGPT)设置洗脑名称/, '')
    if (name) {
      Config.sydneyBrainWashName = name
      await e.reply('操作成功', true)
    }
  }

  async setSydneyBrainWash (e) {
    if (e.msg.indexOf('开启') > -1) {
      Config.sydneyBrainWash = true
    } else {
      Config.sydneyBrainWash = false
    }
    await e.reply('操作成功', true)
  }

  async setSydneyBrainWashStrength (e) {
    let strength = e.msg.replace(/^#(chatgpt|ChatGPT)(设置)?洗脑强度/, '')
    if (!strength) {
      return
    }
    strength = parseInt(strength)
    if (strength > 0) {
      Config.sydneyBrainWashStrength = strength
      await e.reply('操作成功', true)
    }
  }

  /**
   * 删除本地设定：不带名字列出本地设定选序号，带名字跳过菜单；两条路都要过一次确认，
   * 确认时可以先把原内容另存为新名字，再删原件。
   */
  async removePrompt (e) {
    try {
      const prompts = readPrompts()
      if (!prompts.length) throw new Error(NO_PROMPTS_HINT)
      const typed = e.msg.replace(/^#(chatgpt|ChatGPT)(删除|移除)设定/, '').trim()
      if (typed && !prompts.some(p => p.name === typed)) {
        throw new Error(`没有这个设定「${typed}」。发送 #chatgpt删除设定 可以查看本地已保存的 ${prompts.length} 个设定`)
      }
      // 「当前使用」只用来提示，删不删都不该被它拦住；没有默认模型时这里是空集合。
      const active = activePromptNames(currentPromptValue(), prompts)
      const name = typed || await this.pickDeleteName(e, prompts, active)
      const prompt = getPromptByName(name)
      if (!prompt) throw new Error(`没有找到设定「${name}」，可能刚被删除，未做任何改动`)
      const backupName = await requestBackupOrConfirm(this, e, {
        header: `即将删除设定「${name}」${active.has(name) ? '（当前使用）' : ''}，它当前的正文是：`,
        preview: limitString(prompt.content, 120),
        note: active.has(name) ? '删除后，当前默认模型里已生效的正文不会改变，只是列表里不再有它。' : '',
        confirmWords: ['确定', '删除'],
        actionLabel: '删除',
        resolveBackup: normalizeBackupName,
        // 正文会留在群里，选完之后让它自己消失；119 是宿主允许的最长秒数（0-120）。
        recallMsg: 119
      })
      // 确认期间设定可能已被别人删掉：落备份之前再查一次，避免只留下备份、原件却早就没了。
      if (!getPromptByName(name)) throw new Error(`没有找到设定「${name}」，可能刚被删除，未做任何改动`)
      if (backupName) saveOnePrompt(backupName, prompt.content)
      try {
        deleteOnePrompt(name)
      } catch (err) {
        // 复检到 unlink 之间仍有窗口，ENOENT 属于「已经没了」，不该把系统错误原样甩给主人。
        if (err.code === 'ENOENT') throw new Error(`没有找到设定「${name}」，可能刚被删除`)
        throw err
      }
      const left = readPrompts().length
      await e.reply([
        backupName ? `原内容已另存为「${backupName}」。` : '',
        `已删除设定「${name}」。`,
        `本地还剩 ${left} 个设定。`
      ].filter(Boolean).join('\n'), true)
    } catch (err) {
      // 取消、名字不存在、备份名非法都是正常结果，回给主人就够；带 code 的是真正的系统错误
      // （权限、文件被占用），留一条日志，否则磁盘出问题只会在群里一闪而过。
      if (err.code) logger.error(`[ChatGPT] 删除设定失败：${err.message}`)
      await e.reply(err.message, true)
    }
  }

  /**
   * 列出本地设定让主人选一个删除。
   * @param {object} e 发起指令的事件
   * @param {{name: string, content: string}[]} prompts 本地设定
   * @param {Set<string>} active 当前生效的设定名
   * @returns {Promise<string>} 选中的设定名
   */
  async pickDeleteName (e, prompts, active) {
    return chooseFromMenu(this, e, promptMenuItems(prompts, active), `请选择要删除的设定（共 ${prompts.length} 个）`, {
      hint: countHint(prompts.length, '#chatgpt删除设定')
    })
  }

  async addPrompt (e) {
    this.setContext('addPromptName')
    await e.reply('请输入设定名称', true)
  }

  async addPromptName () {
    if (!this.e.msg) return
    let name = this.e.msg
    let prompt = getPromptByName(name)
    if (prompt) {
      await this.e.reply('【警告】该设定已存在，新增的内容将会覆盖之前的设定', true)
      // this.finish('addPromptName')
      // return
    }
    await redis.set('CHATGPT:ADD_PROMPT_NAME', name)
    await this.reply('请输入设定内容', true)
    this.finish('addPromptName')
    this.setContext('addPromptContext')
  }

  async addPromptContext () {
    if (!this.e.msg) return
    let content = this.e.msg
    let name = await redis.get('CHATGPT:ADD_PROMPT_NAME')
    saveOnePrompt(name, content)
    await redis.del('CHATGPT:ADD_PROMPT_NAME')
    await this.reply('设定添加成功', true)
    this.finish('addPromptContext')
  }

  async removeSharePrompt (e) {
    let master = (await getMasterQQ())[0]
    let name = e.msg.replace(/^#(chatgpt|ChatGPT)(删除|取消|撤销)共享设定/, '')
    let response = await fetch(`https://prompt.ikechan8370.com/prompt?name=${name}&qq=${master || (getUin(e) + '')}`, {
      method: 'DELETE',
      headers: {
        'FROM-CHATGPT': 'ikechan8370'
      }
    })
    if (response.status === 200) {
      let json = await response.json()
      if (json.code === 200 && json.data) {
        await e.reply('已从云端删除该设定')
      } else {
        await e.reply('操作失败：' + json.msg)
      }
    } else {
      await e.reply('操作失败：' + await response.text())
    }
  }

  // 当前不可用：依赖已下线的云端设定站（prompt.ikechan8370.com），入口仅为兼容旧指令而保留。
  async uploadPrompt (e) {
    if (await redis.get('CHATGPT:UPLOAD_PROMPT')) {
      await redis.del('CHATGPT:UPLOAD_PROMPT')
      // await this.reply('本机器人存在其他人正在上传设定，请稍后')
      // return
    }
    let use = currentProviderType()
    let currentUse = e.msg.replace(/^#(chatgpt|ChatGPT)(上传|分享|共享)设定/, '')
    if (!currentUse) {
      // 这个键原本由「使用设定」写入，记录当前生效的设定名；写入已于 2026-10 移除，
      // 所以这里恒为 undefined。保留读取只为兼容旧数据，不要据此判断当前设定。
      currentUse = await redis.get(`CHATGPT:PROMPT_USE_${use}`)
    }
    await this.reply(`即将向云端上传设定${currentUse}，确定请回复确定，取消请回复取消，或者回复其他本地存在设定的名字`, true)
    let extraData = {
      currentUse,
      use
    }
    await redis.set('CHATGPT:UPLOAD_PROMPT', JSON.stringify(extraData), 300)
    this.setContext('uploadPromptConfirm')
  }

  async uploadPromptConfirm () {
    if (!this.e.msg) return
    let name = this.e.msg.trim()
    if (name === '取消') {
      await redis.del('CHATGPT:UPLOAD_PROMPT')
      await this.reply('已取消上传', true)
      this.finish('uploadPromptConfirm')
      return
    }
    let extraData = JSON.parse(await redis.get('CHATGPT:UPLOAD_PROMPT'))
    if (name !== '确定') {
      extraData.currentUse = name
      await redis.set('CHATGPT:UPLOAD_PROMPT', JSON.stringify(extraData), 300)
    }
    if (!getPromptByName(extraData.currentUse)) {
      await redis.del('CHATGPT:UPLOAD_PROMPT')
      await this.reply(`设定${extraData.currentUse}不存在，已取消上传`, true)
      this.finish('uploadPromptConfirm')
      return
    }
    // await redis.set('CHATGPT:UPLOAD_PROMPT', JSON.stringify(extraData), 300)
    await this.reply('请输入对该设定的描述或备注，便于其他人快速了解该设定', true)
    this.finish('uploadPromptConfirm')
    this.setContext('uploadPromptDescription')
  }

  async uploadPromptDescription () {
    if (!this.e.msg) return
    let description = this.e.msg.trim()
    if (description === '取消') {
      // await redis.del('CHATGPT:UPLOAD_PROMPT')
      await this.reply('已取消上传', true)
      this.finish('uploadPromptDescription')
      return
    }
    let extraData = JSON.parse(await redis.get('CHATGPT:UPLOAD_PROMPT'))
    extraData.description = description
    await redis.set('CHATGPT:UPLOAD_PROMPT', JSON.stringify(extraData), 300)
    await this.reply('该设定是否是R18设定？请回复是或否', true)
    this.finish('uploadPromptDescription')
    this.setContext('uploadPromptR18')
  }

  async uploadPromptR18 () {
    let master = (await getMasterQQ())[0]
    if (Config.debug) {
      logger.mark('主人qq号：' + master)
    }
    if (this.e.msg.trim() === '取消') {
      await redis.del('CHATGPT:UPLOAD_PROMPT')
      await this.reply('已取消上传', true)
      this.finish('uploadPromptR18')
      return
    }
    if (!this.e.msg || (this.e.msg !== '是' && this.e.msg !== '否')) {
      return
    }
    let r18 = this.e.msg.trim() === '是'
    await this.reply('资料录入完成，正在上传中……', true)
    let extraData = JSON.parse(await redis.get('CHATGPT:UPLOAD_PROMPT'))
    const { currentUse, description } = extraData
    const { content } = getPromptByName(currentUse)
    let examples = []
    for (let i = 1; i < 4; i++) {
      if (Config[`chatExampleUser${i}`]) {
        examples.push({
          user: Config[`chatExampleUser${i}`],
          bot: Config[`chatExampleBot${i}`]
        })
      }
    }
    let toUploadBody = {
      title: currentUse,
      prompt: content,
      qq: master || (getUin(this.e) + ''), // 上传者设定为主人qq或机器人qq
      use: extraData.use === 'bing' ? 'Bing' : 'ChatGPT',
      r18,
      description,
      examples
    }
    logger.info(toUploadBody)
    let response = await fetch('https://prompt.ikechan8370.com/prompt', {
      method: 'POST',
      body: JSON.stringify(toUploadBody),
      headers: {
        'Content-Type': 'application/json',
        'FROM-CHATGPT': 'ikechan8370'
      }
    })
    await redis.del('CHATGPT:UPLOAD_PROMPT')
    if (response.status === 200) {
      response = await response.json()
      if (response.data === true) {
        await this.reply(`设定${currentUse}已上传，其他人可以通过#chatgpt导入设定${currentUse} 来快速导入该设定。感谢您的分享。`, true)
      } else {
        await this.reply(`设定上传失败，原因：${response.msg}`)
      }
    } else {
      await this.reply(`设定上传失败: ${await response.text()}`)
    }
    this.finish('uploadPromptR18')
  }

  async detailCloudPrompt (e) {
    let name = e.msg.replace(/^#(chatgpt|ChatGPT)(在线)?预览设定详情/, '')
    let response = await fetch('https://prompt.ikechan8370.com/prompt?name=' + name, {
      method: 'GET',
      headers: {
        'FROM-CHATGPT': 'ikechan8370'
      }
    })
    if (response.status === 200) {
      let r = await response.json()
      if (r.code === 200) {
        const { prompt, title, description, r18, qq, use } = r.data
        await e.reply(`设定名称：【${title}】\n贡献者：${qq}\n作者备注：${description}\n是否r18：${r18 ? '是' : '否'}\n建议使用场景：${use}\n设定内容预览：${limitString(prompt, 500)}`)
      } else {
        await e.reply('获取设定详情失败：' + r.msg)
      }
    } else {
      await this.reply('获取设定详情失败：' + await response.text())
    }
  }

  async browsePrompt (e) {
    let search = e.msg.replace(/^#(chatgpt|ChatGPT)(在线)?(浏览|查找)设定/, '')
    let split = search.split('页码')
    let page = 1
    if (split.length > 1) {
      search = split[0]
      page = parseInt(split[1])
    }
    let response = await fetch('https://prompt.ikechan8370.com/prompt/list?search=' + search + `&page=${page - 1}`, {
      method: 'GET',
      headers: {
        'FROM-CHATGPT': 'ikechan8370'
      }
    })
    if (response.status === 200) {
      const { totalElements, content, pageable } = (await response.json()).data
      let output = '| 【设定名称】 |  上传者QQ  |  上传时间  ｜  是否R18  ｜  使用场景  ｜\n'
      output += '----------------------------------------------------------------------------------------\n'
      content.forEach(c => {
        output += `|  【${c.title}】  |  ${maskQQ(c.qq)}  | ${c.createTime} | ${c.r18} | ${c.use}｜\n`
      })
      output += '**************************************************************************\n'
      output += `                       当前为第${pageable.pageNumber + 1}页，共${totalElements}个设定\n`
      output += `                       您可以使用#chatgpt浏览设定页码${pageable.pageNumber + 2}跳转到第${pageable.pageNumber + 2}页\n`
      await this.reply(output)
    } else {
      await this.reply('查询失败：' + await response.text())
    }
  }

  // 当前不可用：依赖已下线的云端设定站（prompt.ikechan8370.com），入口仅为兼容旧指令而保留。
  async importPrompt (e) {
    let promptName = e.msg.replace(/^#(chatgpt|ChatGPT)导入设定/, '')
    if (!promptName) {
      await e.reply('设定名字呢？', true)
      return true
    }
    let response = await fetch('https://prompt.ikechan8370.com/prompt?name=' + promptName, {
      method: 'GET',
      headers: {
        'FROM-CHATGPT': 'ikechan8370'
      }
    })
    if (response.status === 200) {
      let r = await response.json()
      if (r.code === 200) {
        if (!r.data) {
          await e.reply('没有这个设定', true)
          return true
        }
        const { prompt, title, examples } = r.data
        saveOnePrompt(title, prompt, examples)
        e.reply(`导入成功。您现在可以使用 #chatgpt使用设定${title} 来体验这个设定了。`)
      } else {
        await e.reply('导入失败：' + r.msg)
      }
    } else {
      await this.reply('导入失败：' + await response.text())
    }
    // await this.reply('敬请期待', true)
  }

  async helpPrompt () {
    await this.reply('设定目录为/plugins/chatgpt-plugin/prompts，将会读取该目录下的所有[设定名].txt文件作为设定列表', true)
  }
}
