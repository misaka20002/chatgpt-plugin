/**
 * 多模态载荷构造（纯函数，无外部依赖）
 *
 * 四个 provider 的图片入参结构各不相同，集中在这里既方便对照，也能在测试里直接断言形状。
 * 入参统一是 `{ mimeType, data }[]`（data 为纯 base64，不含 data URL 前缀）。
 */

/**
 * 统一取本次要送的媒体：主对话用 `medias`（多图），SubLLM 的 `media`（单图/视频）保持兼容
 *
 * @param {{medias?: Array<object>, media?: object}} opt 客户端 sendMessage 的选项
 * @returns {Array<object>}
 */
export function pickMediaList(opt) {
  if (Array.isArray(opt.medias) && opt.medias.length) return opt.medias
  return opt.media ? [opt.media] : []
}

/**
 * 媒体转 data URL（OpenAI Chat / Responses 的图片入参格式）
 *
 * @param {{mimeType?: string, data: string}} media
 * @returns {string}
 */
export function toMediaDataUrl(media) {
  return `data:${media.mimeType || 'image/jpeg'};base64,${media.data}`
}

/**
 * OpenAI Chat Completions 的多模态 content；无媒体时保持纯字符串，不改变既有形态
 *
 * @param {string} prompt
 * @param {Array<{mimeType?: string, data: string}>} medias
 * @returns {string|Array<object>}
 */
export function buildOpenAIContent(prompt, medias) {
  if (!medias?.length) return prompt
  return [
    { type: 'text', text: prompt },
    ...medias.map(media => ({ type: 'image_url', image_url: { url: toMediaDataUrl(media) } }))
  ]
}

/**
 * Responses API 的多模态 input
 *
 * @param {string} prompt
 * @param {Array<{mimeType?: string, data: string}>} medias
 * @returns {string|Array<object>}
 */
export function buildResponsesInput(prompt, medias) {
  if (!medias?.length) return prompt
  return [{
    role: 'user',
    content: [
      { type: 'input_text', text: prompt },
      ...medias.map(media => ({ type: 'input_image', image_url: toMediaDataUrl(media) }))
    ]
  }]
}

/**
 * Claude 的图片 block（content 数组里与文本块并列）
 *
 * @param {Array<{mimeType?: string, data: string}>} medias
 * @returns {Array<object>}
 */
export function buildClaudeImageBlocks(medias) {
  return (medias || []).map(media => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: media.mimeType || 'image/jpeg',
      data: media.data
    }
  }))
}

/**
 * Gemini 的 inline_data part
 *
 * @param {Array<{mimeType?: string, data: string}>} medias
 * @returns {Array<object>}
 */
export function buildGeminiInlineParts(medias) {
  return (medias || []).map(media => {
    let mimeType = media.mimeType
    let data = media.data
    // 去除可能携带的 data URL scheme 头部
    if (data.startsWith('data:')) {
      const match = data.match(/^data:(.*?);base64,(.*)$/)
      if (match) {
        mimeType = mimeType || match[1]
        data = match[2]
      }
    }
    return { inline_data: { mime_type: mimeType, data } }
  })
}
