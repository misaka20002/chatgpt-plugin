import { AbstractTool } from './AbstractTool.js'
import { SubLLM } from '../../model/SubLLM.js'
import { msgHistoryMgr } from '../../model/Onebot11_MessageHistoryManager.js'
import { getUserData } from '../common.js'

const PROFILE_SYSTEM_PROMPT = `你是一个专业的用户画像分析助手。你的任务是根据用户在群聊中的历史消息，生成一份简洁、客观的用户画像。

请从以下维度分析：
1. **兴趣偏好**：用户关注哪些话题、领域
2. **交流风格**：用户的语言习惯、语气特点
3. **活跃特征**：发言频率、活跃时段倾向
4. **性格倾向**：外向/内向、幽默/严肃等

要求：
- 基于消息内容客观推断，不要凭空臆测
- 使用简洁的要点形式，每条不超过15字
- 如果信息不足以判断某个维度，标注"数据不足"
- 不要泄露具体聊天内容，只做抽象概括`

export class UserProfileTool extends AbstractTool {
  name = 'userProfile'

  parameters = {
    properties: {
      target_id: {
        type: 'string',
        description: 'The QQ number of the target user to analyze.'
      },
      max_msg_count: {
        type: 'number',
        description: 'Maximum number of text messages to retrieve for analysis. Default 200.'
      }
    },
    required: ['target_id']
  }

  func = async function (opts, e) {
    let { target_id, max_msg_count = 200 } = opts

    if (!target_id) {
      return 'Error: target_id (QQ number) is required.'
    }

    if (!e?.group_id) {
      return 'Error: This tool can only be used in group chats.'
    }

    try {
      // 1. 获取用户历史文本消息
      const result = await msgHistoryMgr.getUserTexts(e, target_id, 10, max_msg_count)

      if (!result.texts || result.texts.length === 0) {
        return `未找到用户 ${target_id} 的历史文本消息，无法生成画像。`
      }

      const textCount = result.texts.length
      // 拼接消息文本，控制总长度避免 token 过长
      const MAX_CONTENT_LENGTH = 8000
      let messageContent = ''
      for (const text of result.texts) {
        const line = typeof text === 'string' ? text : text?.text || text?.content || String(text)
        if (messageContent.length + line.length + 1 > MAX_CONTENT_LENGTH) break
        messageContent += line + '\n'
      }

      // 2. 获取当前默认 use，SubLLM 构造函数会自动映射为 provider
      const userData = await getUserData(e.user_id)
      const use = (userData.mode === 'default' ? null : userData.mode) || await redis.get('CHATGPT:USE') || 'api'

      // 3. 使用 SubLLM 生成用户画像
      const subLLM = new SubLLM({
        provider: use,
        systemPrompt: PROFILE_SYSTEM_PROMPT,
        maxTokens: 1024,
        temperature: 0.3,
        timeoutMs: 60000
      })

      const profilePrompt = `以下是用户（QQ: ${target_id}）在群聊中的 ${textCount} 条历史消息（已截取前 ${MAX_CONTENT_LENGTH} 字符）：

---
${messageContent}
---

请根据以上消息内容，生成该用户的画像。`

      const profile = await subLLM.chat(profilePrompt)

      return `用户 ${target_id} 的画像（基于 ${textCount} 条消息，缓存: ${result.from_cache}）：\n\n${profile.text}`
    } catch (err) {
      logger.error('[UserProfileTool] Error:', err)
      return `Error: Failed to generate user profile: ${err.message || err.stack || String(err)}`
    }
  }

  description = 'Generate a user profile/portrait based on their recent chat history in the group. Analyzes interests, communication style, activity patterns, and personality traits.'
}
