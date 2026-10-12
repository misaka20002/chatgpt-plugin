import { Config } from './config.js'
import { AvatarReplyService } from './avatar/reply.js'

export const avatarReply = new AvatarReplyService({
  getConfig: () => Config.avatarReply,
  generate: async ({ providerId, systemPrompt, input }) => {
    const { SubLLM } = await import('../model/SubLLM.js')
    const model = new SubLLM({ provider: providerId, systemPrompt, timeoutMs: 8000 })
    return model.chat(input)
  },
  sendImage: (e, filename) => e.reply(segment.image(filename))
})
