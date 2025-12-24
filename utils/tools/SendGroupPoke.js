import { AbstractTool } from './AbstractTool.js'

export class SendGroupPokeTool extends AbstractTool {
  name = 'sendGroupPoke'

  parameters = {
    properties: {
      userIds: {
        type: 'string',
        description: '要戳一戳的用户QQ号，多个用户用英文逗号分隔，例如：123456789,987654321'
      }
    },
    required: ['userIds']
  }

  func = async function (opts, e) {
    let { userIds } = opts

    // 检查是否在群聊中
    if (!e.isGroup) {
      return 'failed: this tool can only be used in group chat'
    }

    // 处理用户输入的QQ号
    let qqNumbers = userIds.toString().split(/[,，]/).map(qq => qq.trim()).filter(qq => qq)

    if (qqNumbers.length === 0) {
      return 'failed: no valid QQ number provided'
    }

    let successList = []
    let failList = []
    let cooldownList = []

    // 遍历每个QQ号进行戳一戳
    for (let qq of qqNumbers) {
      // 验证QQ号格式
      if (!/^\d{5,12}$/.test(qq)) {
        failList.push(`${qq} (invalid format)`)
        continue
      }

      // 检查冷却时间
      const cooldownKey = `CHATGPT:GROUP_POKE_COOLDOWN:${e.group_id}:${qq}`
      const lastPokeTime = await redis.get(cooldownKey)

      if (lastPokeTime) {
        const remainingTime = Math.ceil((10000 - (Date.now() - parseInt(lastPokeTime))) / 1000)
        if (remainingTime > 0) {
          cooldownList.push(`${qq} (cooldown: ${remainingTime}s)`)
          continue
        }
      }

      try {
        await e.group.pokeMember(parseInt(qq))
        // 设置冷却时间，10秒过期
        await redis.set(cooldownKey, Date.now().toString(), { EX: 10 })
        successList.push(qq)
        // 添加延迟避免操作过快
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (err) {
        failList.push(`${qq} (${err.message || 'unknown error'})`)
      }
    }

    let result = []
    if (successList.length > 0) {
      result.push(`successfully poked: ${successList.join(', ')}`)
    }
    if (cooldownList.length > 0) {
      result.push(`on cooldown: ${cooldownList.join(', ')}`)
    }
    if (failList.length > 0) {
      result.push(`failed to poke: ${failList.join(', ')}`)
    }

    return result.join('; ')
  }

  description = 'Useful when you want to poke group members. Can only be used in group chat. Provide QQ numbers separated by commas.'
}

