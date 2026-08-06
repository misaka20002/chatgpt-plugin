import md5 from 'md5'
import { Config } from './config.js'
import { ChatGPTAPI } from './openai/chatgpt-api.js'
import { newFetch } from './proxy.js'
import { CustomGoogleGeminiClient } from '../client/CustomGoogleGeminiClient.js'
import XinghuoClient from './xinghuo/xinghuo.js'
import { QwenApi } from './alibaba/qwen-api.js'
import { ResponsesAPI } from './openai/responses-api.js'

// 代码参考：https://github.com/yeyang52/yenai-plugin/blob/b50b11338adfa5a4ef93912eefd2f1f704e8b990/model/api/funApi.js#L25
export const translateLangSupports = [
  { code: 'ar', label: '阿拉伯语', abbr: '阿', alphabet: 'A' },
  { code: 'de', label: '德语', abbr: '德', alphabet: 'D' },
  { code: 'ru', label: '俄语', abbr: '俄', alphabet: 'E' },
  { code: 'fr', label: '法语', abbr: '法', alphabet: 'F' },
  { code: 'ko', label: '韩语', abbr: '韩', alphabet: 'H' },
  { code: 'nl', label: '荷兰语', abbr: '荷', alphabet: 'H' },
  { code: 'pt', label: '葡萄牙语', abbr: '葡', alphabet: 'P' },
  { code: 'ja', label: '日语', abbr: '日', alphabet: 'R' },
  { code: 'th', label: '泰语', abbr: '泰', alphabet: 'T' },
  { code: 'es', label: '西班牙语', abbr: '西', alphabet: 'X' },
  { code: 'en', label: '英语', abbr: '英', alphabet: 'Y' },
  { code: 'it', label: '意大利语', abbr: '意', alphabet: 'Y' },
  { code: 'vi', label: '越南语', abbr: '越', alphabet: 'Y' },
  { code: 'id', label: '印度尼西亚语', abbr: '印', alphabet: 'Y' },
  { code: 'zh-CHS', label: '中文', abbr: '中', alphabet: 'Z' }
]
const BAIDU_LANG_MAP = {
  ar: 'ara',
  de: 'de',
  ru: 'ru',
  fr: 'fra',
  ko: 'kor',
  nl: 'nl',
  pt: 'pt',
  ja: 'jp',
  th: 'th',
  es: 'spa',
  en: 'en',
  it: 'it',
  vi: 'vie',
  id: 'id',
  'zh-CHS': 'zh'
}

function getBaiduTranslateAuth () {
  const rawKey = Config.baiduTranslateKey?.trim()
  if (!rawKey) return null

  const [, appid, key] = rawKey.match(/^([^:：,，\s]+)[:：,，\s]+(.+)$/) || []
  if (!appid || !key?.trim()) return null

  return {
    appid: appid.trim(),
    key: key.trim()
  }
}

async function translateByBaidu (text, to) {
  const auth = getBaiduTranslateAuth()
  if (!auth) return '请先在锅巴配置百度翻译Key，格式为：APPID:密钥'

  const q = String(text ?? '')
  if (!q) return '找不到翻译结果'

  const salt = Date.now().toString()
  const body = new URLSearchParams({
    q,
    from: 'auto',
    to,
    appid: auth.appid,
    salt,
    sign: md5(auth.appid + q + salt + auth.key)
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await newFetch('https://fanyi-api.baidu.com/api/trans/vip/translate', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      signal: controller.signal
    })
    const data = await response.json()
    if (!response.ok || data.error_code) {
      globalThis.logger?.warn?.(`[chatgpt][translateOld] 百度翻译失败：${data.error_code || response.status} ${data.error_msg || response.statusText || ''}`)
      return '翻译服务暂不可用，请稍后再试'
    }

    const result = data.trans_result?.map(item => item.dst).filter(Boolean).join('\n')
    return result || '找不到翻译结果'
  } finally {
    clearTimeout(timer)
  }
}

export async function translateOld (msg, to = 'auto') {
  const langCode = to === 'auto' ? 'zh-CHS' : translateLangSupports.find(item => item.abbr == to)?.code
  const baiduTo = BAIDU_LANG_MAP[langCode]
  if (!baiduTo) return `未找到翻译的语种，支持的语言为：\n${translateLangSupports.map(item => item.abbr).join('，')}\n`

  try {
    if (Array.isArray(msg)) {
      const results = []
      for (let i = 0; i < msg.length; i++) {
        results.push(await translateByBaidu(msg[i], baiduTo))
      }
      return results
    }
    return await translateByBaidu(msg, baiduTo)
  } catch (err) {
    globalThis.logger?.warn?.(`[chatgpt][translateOld] 百度翻译异常：${err.message}`)
    return '翻译服务暂不可用，请稍后再试'
  }
}

/**
 *
 * @param msg 要翻译的
 * @param from 语种
 * @param to 语种
 * @param ai ai来源，支持openai, responses, gemini, xh, qwen, baidu
 * @returns {Promise<*|string>}
 */
export async function translate (msg, to = 'auto', from = 'auto', ai = Config.translateSource) {
  try {
    let lang = '中'
    if (to !== 'auto') {
      lang = translateLangSupports.find(item => item.abbr == to)?.code
    }
    if (!lang) return `未找到翻译的语种，支持的语言为：\n${translateLangSupports.map(item => item.abbr).join('，')}\n`
    // if ai is not in the list, throw error
    if (!['openai', 'responses', 'gemini', 'xh', 'qwen', 'baidu'].includes(ai)) throw new Error('ai来源错误')
    if (ai === 'baidu') return await translateOld(msg, to)
    let system = `You will be provided with a sentence in the language with language code [${from}], and your task is to translate it into [${lang}]. Just print the result without any other words.`
    if (Array.isArray(msg)) {
      let result = []
      for (let i = 0; i < msg.length; i++) {
        let item = msg[i]
        let res = await translate(item, to, from, ai)
        result.push(res)
      }
      return result
    }
    switch (ai) {
      case 'openai': {
        let api = new ChatGPTAPI({
          apiBaseUrl: Config.openAiBaseUrl,
          apiKey: Config.apiKey,
          fetch: newFetch
        })
        const res = await api.sendMessage(msg, {
          systemMessage: system,
          completionParams: {
            model: Config.model
          }
        })
        return res.text
      }
      case 'responses': {
        const completionParams = {}
        if (Config.responsesModel) completionParams.model = Config.responsesModel
        if (typeof Config.responsesTemperature === 'number') completionParams.temperature = Config.responsesTemperature
        if (Config.responsesReasoningEffort) completionParams.reasoning_effort = Config.responsesReasoningEffort
        const api = new ResponsesAPI({
          apiBaseUrl: Config.responsesApiBaseUrl,
          apiKey: Config.responsesApiKey,
          fetch: newFetch,
          maxResponseTokens: Config.responsesApiMaxToken,
          maxModelTokens: Config.responsesMaxModelTokens
        })
        const res = await api.sendMessage(msg, {
          instructions: system,
          completionParams,
          store: false,
          timeoutMs: 600000
        })
        return res.text
      }
      case 'gemini': {
        let client = new CustomGoogleGeminiClient({
          key: Config.getGeminiKey,
          model: Config.gemini_vqa_model,
          baseUrl: Config.geminiBaseUrl,
          debug: Config.debug
        })
        let option = {
          stream: false,
          onProgress: (data) => {
            if (Config.debug) {
              logger.info(data)
            }
          },
          system
        }
        let res = await client.sendMessage(msg, option)
        return res.text
      }
      case 'xh': {
        let client = new XinghuoClient({
          ssoSessionId: Config.xinghuoToken
        })
        let response = await client.sendMessage(msg, { system })
        return response.text
      }
      case 'qwen': {
        let completionParams = {
          parameters: {
            top_p: Config.qwenTopP || 0.5,
            top_k: Config.qwenTopK || 50,
            seed: Config.qwenSeed > 0 ? Config.qwenSeed : Math.floor(Math.random() * 114514),
            temperature: Config.qwenTemperature || 1,
            enable_search: !!Config.qwenEnableSearch
          }
        }
        if (Config.qwenModel) {
          completionParams.model = Config.qwenModel
        }
        let opts = {
          apiKey: Config.qwenApiKey,
          debug: false,
          systemMessage: system,
          completionParams,
          fetch: newFetch
        }
        let client = new QwenApi(opts)
        let option = {
          timeoutMs: 600000,
          completionParams
        }
        let result
        try {
          result = await client.sendMessage(msg, option)
        } catch (err) {
          logger.error(err)
          throw new Error(err)
        }
        return result.text
      }
    }
  } catch (e) {
    logger.error(e)
    logger.info('基于LLM的翻译失败，转用老版翻译')
    return await translateOld(msg, to)
  }
}
