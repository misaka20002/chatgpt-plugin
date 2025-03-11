import { AbstractPostProcessor } from './BasicProcessor.js'

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
    const { text, thinkingText } = extractThinkingTextAndText(input.text)
    return {
      text,
      thinking_text: (input.thinking_text ? input.thinking_text : '') + thinkingText
    }
  }
}

/**
 * written by gpt-4o
 * @param str
 * @returns {{thinkingText: string, text: *}|{thinkingText: *, text: *}}
 */
const extractThinkingTextAndText = (str) => {
  // 使用正则表达式提取think标签内容
  const thinkRegex = /<think>(.*?)<\/think>/s
  const match = str.match(thinkRegex)

  // 如果找到了<think>标签内容
  if (match) {
    // thinking_text就是<think>标签内的内容
    const thinkingText = match[1].trim()

    // text就是</think>标签后的部分
    const text = str.slice(match.index + match[0].length).trim()

    return { thinkingText, text }
  }

  // 如果没有<think>标签内容，返回空或原始内容
  return { thinkingText: '', text: str.trim() }
}
