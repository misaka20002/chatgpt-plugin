import { UserInfo } from './user_data.js'
import { Config } from '../../utils/config.js'
import { deleteOnePrompt, getPromptByName, readPrompts, saveOnePrompt } from '../../utils/prompts.js'

async function Prompt (fastify, options) {
  for (const route of ['/getPromptList', '/addPrompt', '/deletePrompt', '/usePrompt']) {
    fastify.post(route, async (request, reply) => reply.code(410).send({ state: false, error: 'Web 配置功能已移除，请使用锅巴或 QQ' }))
  }
}
export default Prompt
