import { AbstractPostProcessor } from './BasicProcessor.js'
import { extractThinkTags } from '../thinking.js'

export class ReasonerProcessor extends AbstractPostProcessor {
  constructor () {
    super()
    this.name = 'ReasonerPostProcessor'
    this.type = 'post'
  }

  /**
   *
   * @param {{
   *   text: string,
   *   thinking_text?: string
   * }} input
   * @returns {Promise<{
   *   text: string,
   *   thinking_text?: string
   * }>}
   */
  async processInner (input) {
    logger.debug('Running into ReasonerPostProcessor')
    // 统一委托 utils/thinking.js：支持 <thinking>、多个标签块与未闭合标签；
    // 与原实现相比会保留标签前的正文（原实现会把它整段丢弃）
    const { text, thinking } = extractThinkTags(input.text)
    return {
      text,
      thinking_text: (input.thinking_text ? input.thinking_text : '') + thinking // 作用：把思考的内容组合 = chatMessage.thinking_text + extractThinkTags(input.text).thinking
    }
  }
}
