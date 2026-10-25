import { resolveProvider, providerConfig } from './providers.js'
import { Config } from '../utils/config.js'
// import { parseSourceImg } from '../utils/common.js'
import fetch from 'node-fetch'
import { CustomGoogleGeminiClient } from "../client/CustomGoogleGeminiClient.js";
import dns from 'node:dns/promises'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { newFetch } from './proxy.js'
import { unescapeCqCode } from './cqCode.js'
import { rewriteForwardCQToBeacon } from './forwardMsgParser.js'

/** 媒体识别的默认系统提示词：Gemini 识别与「当前模型」识别共用，避免两处文案漂移 */
const DEFAULT_MEDIA_RECOGNITION_PROMPT = `描述这个媒体中的内容，主要包括：全局分析：描述主体内容、风格类型、核心氛围；细节识别：列出画面中所有可辨识的视觉元素，包括：角色名称（仅限90%以上确定），物体：品牌/型号/文化符号，文字：翻译并定位。回复的时候仅需要用一段话描述内容，不要诸如“全局分析”这样的标题。`

/**
 * 媒体获取失败的统一文案：有真实原因就用它，否则回落到大小提示
 *
 * 不能反过来「一律显示超过 5MB」——早期实现把下载失败、类型不符、地址被拒全归到体积上，排障时误导。
 *
 * @param {string} mediaError `url2Base64` 的 onError 回调带回的原因
 * @param {number} limitMB 本次的体积上限
 * @returns {string}
 */
function describeMediaFetchFailure(mediaError, limitMB) {
  return mediaError
    ? `媒体文件获取失败：${mediaError}`
    : `媒体文件获取失败、为空、或已超过限制大小 ${limitMB}MB`
}

/**
 * @description: 获取gemini的识图/识视频结果，需要填写了gemini的token
 * @param {*} e
 * @param {*} img 图片url数组
 * @param {*} video 视频url数组 (传入的是url字符串数组)
 * @param {*} systemPrompt 自定义识别媒体的系统提示词（可选）
 * @param {object} [options]
 * @param {string} [options.prompt] 本次识别的具体要求，缺省用 e.msg
 * @param {boolean} [options.throwOnError] 失败时抛错，而不是返回「识别出错：...」字符串（工具调用方应传 true）
 * @param {boolean} [options.untrustedSource] 媒体地址来自不可信输入（如模型参数）：只允许公网 http(s)，禁止本地文件与内网地址
 * @param {boolean} [options.trustedMediaSource] 地址确认为本次事件携带的媒体地址：只放开私网/benchmark 拦截，
 *                                              本地文件与媒体类型校验保持严格（两者不能合并成一个开关）
 * @return {string|Promise<string>}
 */
export async function recognitionResultsByGemini(e, img = [], video = [], systemPrompt = DEFAULT_MEDIA_RECOGNITION_PROMPT, options = {}) {
  const { prompt, throwOnError = false, untrustedSource = false, trustedMediaSource = false } = options
  // 可信来源只影响「能否连私网」；本地文件与媒体类型仍按不可信来源收紧
  const allowPrivateNetwork = !untrustedSource || trustedMediaSource

  // 默认保持旧的「返回错误字符串」契约；工具调用方要求失败即抛错时传 throwOnError
  const fail = (message) => {
    if (throwOnError) throw new Error(message)
    return '识别出错：' + message
  }


  // 确定目标 URL 和类型
  let targetUrl = null
  let isVideo = false

  // 优先识别视频url
  if (video && video.length > 0) {
    targetUrl = video[0]
    isVideo = true
  } else if (img && img.length > 0) {
    targetUrl = img[0]
    isVideo = false
  }

  // 从e中确定目标 URL 和类型
  if (!targetUrl)
    ({ targetUrl, isVideo } = getMediaTargetUrl(e));

  if (!targetUrl) return fail('请传入要识别的媒体链接');

  let provider
  try {
    provider = resolveProvider(isVideo ? Config.videoProviderId : Config.imageProviderId)
    if (isVideo && provider.type !== 'gemini') return fail('视频识别只能使用 Gemini 配置')
  } catch (err) { return fail(err.message) }

  const limitMB = Config.mediaMaxSizeInMB || 10;
  const maxSizeInBytes = limitMB * 1024 * 1024;

  let mediaError = '';
  const blobRes = await url2Base64(targetUrl, false, true, {
    maxSizeBytes: maxSizeInBytes,
    allowLocalFile: !untrustedSource,
    allowPrivateNetwork,
    // 可信来源仍要解析并固定连接：回环 / 云元数据不因来源可信而放行
    enforceAlwaysBlocked: trustedMediaSource,
    mediaKind: untrustedSource ? (isVideo ? 'video' : 'image') : undefined,
    // url2Base64 内部吞掉异常并返回 null，只能靠回调拿到真实原因
    onError: (err) => { mediaError = hidePrivacyInfo(err.message || String(err)) }
  });

  if (!blobRes || !blobRes.imageBlob) {
    return fail(describeMediaFetchFailure(mediaError, limitMB))
  }

  try {
    // 自动获取探测到的 MimeType
    let mimeType = blobRes.imageBlob.type;
    if (!mimeType || mimeType === 'application/octet-stream') {
      mimeType = isVideo ? 'video/mp4' : 'image/jpeg'; // Fallback
    }

    // 提取纯 Base64 数据
    const arrayBuffer = await blobRes.imageBlob.arrayBuffer();
    let base64Data = Buffer.from(arrayBuffer).toString('base64');

    const reg_chatgpt_for_firstperson_call = new RegExp(Config.tts_First_person + "[,，.。]*", "g");
    // 显式传了 prompt 字段（即使为空串）就以它为准，不再回退到 e.msg；
    // 只有旧调用方完全没传 options.prompt 时才沿用 e.msg
    const promptText = Object.hasOwn(options, 'prompt')
      ? String(prompt ?? '').trim()
      : (e?.msg || '').replace(reg_chatgpt_for_firstperson_call, '').trim()
    let msg = promptText || 'describe this content in Simplified Chinese'

    const { SubLLM } = await import('../model/SubLLM.js')
    const client = new SubLLM({ provider: provider.id, systemPrompt })
    let res = await client.chat(msg, {
      // 记录点: opt.media
      media: {
        mimeType: mimeType,
        data: base64Data
      }
    })

    const text = res?.text?.trim()
    if (!text) return fail('识别结果为空')
    return text

  } catch (err) {
    // 日志与返回都给调用方，错误信息中的网址/IP 必须脱敏
    logger.warn('[ChatGPT][recognitionResultsByGemini] 识别请求失败: ' + hidePrivacyInfo(err.message || String(err)))
    return fail(hidePrivacyInfo(err.message || "网络或API错误"))
  }
}

/**
 * @description: 解析当前对话使用的模型提供商（apps/chat.js 中 use 的语义）
 * 与沙箱规划子代理（utils/sandboxSubAgent.js）的 current 语义一致：本轮提供商快照 > 全局 defaultProviderId
 * @param {*} e 事件对象
 * @return {Promise<string>} 具体提供商条目 ID，可直接交给 SubLLM 使用
 */
export async function resolveCurrentChatProvider(e) {
  return e?.modelProviderId || Config.defaultProviderId
}

/** 当前模型识别只支持这些对话模式；其余模式（如 chatglm/azure）在 SubLLM 里会落到普通 OpenAI 配置，语义错位，应交给 Gemini 回退 */
const MEDIA_SUPPORTED_USES = ['api', 'responses', 'claude', 'gemini']

/**
 * @description: 使用当前对话模型内置的多模态能力识别图片/视频内容，要求该模型本身支持对应的输入类型
 * 识别失败（模式不支持、模型无识图能力、请求报错、返回空结果）时抛错，由调用方决定是否回退其他识别来源
 * @param {*} e
 * @param {*} img 图片url数组
 * @param {*} video 视频url数组 (传入的是url字符串数组)
 * @param {*} systemPrompt 自定义识别媒体的系统提示词（可选）
 * @param {object} [options]
 * @param {string} [options.prompt] 本次识别的具体要求，缺省用 e.msg
 * @param {boolean} [options.untrustedSource] 媒体地址来自不可信输入（如模型参数）：只允许公网 http(s)，禁止本地文件与内网地址
 * @param {boolean} [options.trustedMediaSource] 地址确认为本次事件携带的媒体地址：只放开私网/benchmark 拦截，
 *                                              本地文件与媒体类型校验保持严格
 * @return {Promise<string>} 识别结果文本
 */
export async function recognitionResultsByCurrentModel(e, img = [], video = [], systemPrompt = DEFAULT_MEDIA_RECOGNITION_PROMPT, options = {}) {
  const { prompt, untrustedSource = false, trustedMediaSource = false } = options
  const allowPrivateNetwork = !untrustedSource || trustedMediaSource

  let targetUrl = null
  let isVideo = false

  // 优先识别视频url
  if (video && video.length > 0) {
    targetUrl = video[0]
    isVideo = true
  } else if (img && img.length > 0) {
    targetUrl = img[0]
    isVideo = false
  }

  if (!targetUrl)
    ({ targetUrl, isVideo } = getMediaTargetUrl(e));

  if (!targetUrl) throw new Error('请传入要识别的媒体链接')

  // 先判定模式：不支持的模式没必要先去下载媒体
  const provider = await resolveCurrentChatProvider(e)
  if (!MEDIA_SUPPORTED_USES.includes(resolveProvider(provider).type) || isVideo && resolveProvider(provider).type !== 'gemini') {
    throw new Error(`当前对话模式(${provider})不支持媒体识别`)
  }

  const limitMB = Config.mediaMaxSizeInMB || 10;
  let mediaError = '';
  const blobRes = await url2Base64(targetUrl, false, true, {
    maxSizeBytes: limitMB * 1024 * 1024,
    allowLocalFile: !untrustedSource,
    allowPrivateNetwork,
    // 可信来源仍要解析并固定连接：回环 / 云元数据不因来源可信而放行
    enforceAlwaysBlocked: trustedMediaSource,
    mediaKind: untrustedSource ? (isVideo ? 'video' : 'image') : undefined,
    onError: (err) => { mediaError = hidePrivacyInfo(err.message || String(err)) }
  });

  if (!blobRes || !blobRes.imageBlob) {
    throw new Error(describeMediaFetchFailure(mediaError, limitMB))
  }

  // 自动获取探测到的 MimeType
  let mimeType = blobRes.imageBlob.type;
  if (!mimeType || mimeType === 'application/octet-stream') {
    mimeType = isVideo ? 'video/mp4' : 'image/jpeg'; // Fallback
  }
  const base64Data = Buffer.from(await blobRes.imageBlob.arrayBuffer()).toString('base64');

  const { SubLLM } = await import('../model/SubLLM.js')

  const reg_chatgpt_for_firstperson_call = new RegExp(Config.tts_First_person + "[,，.。]*", "g");
  // 与 recognitionResultsByGemini 同一语义：显式 prompt（含空串）优先，不再回退 e.msg
  const promptText = Object.hasOwn(options, 'prompt')
    ? String(prompt ?? '').trim()
    : (e?.msg || '').replace(reg_chatgpt_for_firstperson_call, '').trim()
  const msg = promptText || 'describe this content in Simplified Chinese'

  const subLLM = new SubLLM({ provider, systemPrompt, timeoutMs: 180000 })
  const res = await subLLM.chat(msg, {
    media: {
      mimeType,
      data: base64Data
    }
  })

  const text = res?.text?.trim()
  if (!text) throw new Error(`当前模型(${provider})未返回识别结果`)
  return text
}

// 块级 markdown 的特征：标题、引用、列表、围栏、表格、HTML 块、分隔线、缩进代码
const BLOCK_MARKDOWN_PATTERN = new RegExp([
  '^[ \\t]*#{1,6}[ \\t]',                           // ATX 标题
  '^[ \\t]*>',                                        // 引用
  '^[ \\t]*([-*+]|\\d+\\.)[ \\t]',               // 有序 / 无序列表
  '^[ \\t]*(```|~~~)',                                // 围栏代码
  '^[ \\t]*\\|',                                    // 表格行
  '^[ \\t]*:?-{3,}:?([ \\t]*\\|[ \\t]*:?-{3,}:?)+', // 无前导竖线的表格分隔行
  '^[ \\t]*<[a-zA-Z!/]',                              // HTML 块
  '^[ \\t]*(---+|\\*\\*\\*+|___+)[ \\t]*$',    // 分隔线
  '^[ \\t]*(=+|-+)[ \\t]*$',                        // setext 标题下划线
  '^(    |\\t)',                                      // 缩进代码
].join('|'), 'm')

/**
 * 原文是否包含块级 markdown。
 * 判断从严：宁可误判成 markdown（少切一条），也不要把代码块、表格、列表拆开。
 * 行内样式（粗体、斜体、行内代码）不算，普通闲聊仍然可以按句分段。
 */
export function containsBlockMarkdown(text) {
  const source = String(text || '')
  if (!source.trim()) return false
  return BLOCK_MARKDOWN_PATTERN.test(source)
}

/**
 * @description: 把句子转为不超过3个元素的数组，自动处理 at对象
 * @param {Array|Object|String} inputArr
 * @return {Array} 
 */
export function convertSentenceToArray(inputArr) {
  // 确保输入是数组格式
  const elements = Array.isArray(inputArr) ? inputArr : [inputArr];

  // 原文含块级 markdown 就整条发送，切开会把代码块、表格、列表拆断
  if (elements.length === 1 && typeof elements[0] === 'string' && containsBlockMarkdown(elements[0])) {
    return [[elements[0]]];
  }

  let flatList = [];
  for (const item of elements) {
    if (typeof item === 'object' && item !== null) {
      // 保留对象元素（如 at, image）
      flatList.push(item);
    } else if (typeof item === 'string') {
      // 更新修改正则
      let arr = item.split(/([。？！!?\n]+[”’）)]*)/).filter(Boolean);
      let tempSentence = '';
      for (let i = 0; i < arr.length; i++) {
        tempSentence += arr[i];
        if (i % 2 !== 0 || i === arr.length - 1) {
          let cleaned = tempSentence.replace(/\n$|^{|}$|^(，|,)/gm, "").trim();
          if (cleaned) {
            flatList.push(cleaned);
          }
          tempSentence = '';
        }
      }
    }
    // 非对象和非字符串的元素会被自动忽略
  }

  // 把长度小于5的字符串元素合并
  for (let i = 0; i < flatList.length; i++) {
    if (typeof flatList[i] === 'string' && flatList[i].length < 5) {
      // 优先往后合并
      if (i + 1 < flatList.length && typeof flatList[i + 1] === 'string') {
        flatList[i] = flatList[i] + flatList[i + 1];
        flatList.splice(i + 1, 1);
        i--;
      } else if (i > 0 && typeof flatList[i - 1] === 'string') {
        flatList[i - 1] = flatList[i - 1] + flatList[i];
        flatList.splice(i, 1);
        i--;
      }
    }
  }

  let logicalGroups = [];
  let currentGroup = [];
  for (const item of flatList) {
    currentGroup.push(item);
    if (typeof item === 'string') {
      logicalGroups.push(currentGroup);
      currentGroup = [];
    }
  }
  if (currentGroup.length > 0) {
    logicalGroups.push(currentGroup);
  }

  // 每次寻找文本总长度最短的相邻两组合并，直到等于3
  while (logicalGroups.length > 3) {
    let minLen = Infinity;
    let mergeIdx = 0;
    for (let i = 0; i < logicalGroups.length - 1; i++) {
      let len1 = logicalGroups[i].filter(x => typeof x === 'string').join('').length;
      let len2 = logicalGroups[i + 1].filter(x => typeof x === 'string').join('').length;
      if (len1 + len2 < minLen) {
        minLen = len1 + len2;
        mergeIdx = i;
      }
    }
    logicalGroups[mergeIdx] = logicalGroups[mergeIdx].concat(logicalGroups[mergeIdx + 1]);
    logicalGroups.splice(mergeIdx + 1, 1);
  }

  // 整合 at对象和字符串 为一个对象
  for (let i = 0; i < logicalGroups.length; i++) {
    let compactedGroup = [];
    for (const item of logicalGroups[i]) {
      const lastItem = compactedGroup[compactedGroup.length - 1];

      if (typeof item === 'string') {
        if (typeof lastItem === 'string') {
          compactedGroup[compactedGroup.length - 1] += item;
        } else if (typeof lastItem === 'object' && lastItem !== null) {
          compactedGroup.push(' ' + item);
        } else {
          compactedGroup.push(item);
        }
      } else {
        compactedGroup.push(item);
      }
    }
    logicalGroups[i] = compactedGroup;

    // 每组最后一个字符串去掉末尾句号（模拟真人，分段末尾不加句号）
    const lastItem = compactedGroup[compactedGroup.length - 1];
    if (typeof lastItem === 'string') {
      compactedGroup[compactedGroup.length - 1] = lastItem.replace(/。+$/g, '');
    }
  }

  return logicalGroups;
}

/**
 * @description: 获取Gemini可用的模型列表
 * @param {string} apiKey - Google AI API密钥
 * @param {string} geminiBaseUrl - Google AI API基础URL
 * @return {Promise<Array>} 返回可用模型的数组
 */
export async function getGeminiModelsByFetch(apiKey, geminiBaseUrl) {
  if (apiKey === undefined) {
    const row = resolveProvider()
    if (row.type !== 'gemini') throw new Error('请先切换到 Gemini 模型提供商')
    const config = providerConfig(row)
    apiKey = config.getGeminiKey
    geminiBaseUrl = config.geminiBaseUrl
  }
  // 构建请求URL（考虑自定义baseUrl的情况）
  const baseUrl = geminiBaseUrl || 'https://generativelanguage.googleapis.com';
  const endpoint = baseUrl.endsWith('/') ?
    `${baseUrl.slice(0, -1)}/v1beta/models` :
    `${baseUrl}/v1beta/models`;

  // 将API密钥作为URL参数
  const url = `${endpoint}?key=${apiKey}`;
  const timeoutMs = 60000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 发送请求
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Node/1.0.0',
        'Accept': '*/*'
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`获取Gemini模型API请求超时: ${timeoutMs / 1000}秒`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`获取Gemini模型API请求失败: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (Config.debug) {
    logger.info('获取Gemini模型列表响应:', JSON.stringify(data));
  }

  // Extract model names from the models array and return them
  return (data.models || []).map(model => model.name?.replace(/models\//g, '').trim()).filter(Boolean);
}

/**
 * @description: 从标签中提取角色名称
 * @param {string} tags - 需要处理的标签字符串
 * @return {object} 包含角色名和处理后的标签
 */
export function extractCharacterName(tags) {
  // 为角色添加作品名
  const charactersList = Config.get_draw_PluginCharactersList();
  let charactersName = "";
  let processedTags = tags;

  // 从配置的角色列表中查找匹配
  for (const key of Object.keys(charactersList)) {
    const reg_characters = new RegExp(key, "im");
    charactersName = processedTags.match(reg_characters) ?
      charactersList[key] + ", " + charactersName : charactersName;
  }

  // 如果没有匹配到角色的话就把 tags 的第一段作为角色名
  if (!charactersName) {
    const firstPart = processedTags.split(',')?.[0]?.trim();
    if (firstPart) {
      charactersName = firstPart;
      // 把 charactersName 按 from 切割，把 from 后面的部分作为作品名
      const [char_name, ...extraInfo] = charactersName.split(/from/i);
      charactersName = char_name + (extraInfo.length ? "(" + extraInfo.map(m => m.trim()).join("") + ")" : "")
      // 从原始标签中移除第一部分
      processedTags = processedTags.replace(firstPart, "").replace(/^,\s*/, "");
    } else {
      charactersName = "";
    }
  }

  return {
    charactersName,
    processedTags
  };
}

/**
 * @description: 获取指定QQ号的Bot对象，如果都不存在则返回默认的Bot对象
 * @param {Array} targetQQArr bot qq号数组
 * @return {Object} Bot实例对象
 */
export function getBotByQQ(targetQQArr) {
  for (const targetQQ of targetQQArr) {
    // 检查目标QQ的Bot是否存在
    if (targetQQ && Bot[targetQQ]) {
      return Bot[targetQQ];
    }
  }
  // 最后的兜底：返回Bot对象本身（适用于单Bot环境）
  return Bot;
}

/**
 * 隐藏错误信息中的隐私信息（网址、IP地址等）
 * @param {string} text 需要处理的文本
 * @returns {string} 处理后的文本
 */
export function hidePrivacyInfo(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  // URL正则表达式 - 匹配 http/https/ftp 协议的网址
  const urlRegex = /(https?:\/\/|ftp:\/\/)([\w\-._~:/?#[\]@!$&'()*+,;=%]+)/gi;
  // IPv4地址正则表达式
  const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
  // IPv6地址正则表达式
  const ipv6Regex = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|::1\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b|\b:(?:[0-9a-fA-F]{1,4}:){1,6}[0-9a-fA-F]{1,4}\b/g;
  let result = text;
  // 处理URL - 保留协议和域名开头，隐藏其他部分
  result = result.replace(urlRegex, (match, protocol, rest) => {
    if (rest.length <= 10) {
      return protocol + '****';
    }
    // 保留前3个字符和后2个字符，中间用****替换
    const visible = rest.substring(0, 3) + '****' + rest.substring(rest.length - 2);
    return protocol + visible;
  });
  // 处理IPv4地址 - 隐藏后两段
  result = result.replace(ipv4Regex, (match) => {
    const parts = match.split('.');
    return parts[0] + '.' + parts[1] + '.***.***.';
  });
  // 处理IPv6地址 - 保留前两段，其他用****替换
  result = result.replace(ipv6Regex, (match) => {
    if (match === '::1') {
      return '****';
    }
    const parts = match.split(':');
    if (parts.length >= 2) {
      return parts[0] + ':' + parts[1] + ':****';
    }
    return '****';
  });
  return result;
}

/**
 * 删除消息中的 CQ 码
 * @param {string|Array} msg - 原始消息文本或数组
 * @returns {string|Array} 删除 CQ 码后的文本或数组
 */
export function removeCQCode(msg) {
  if (!msg) return ''
  const cqCodeRegex = /\[CQ[:,，][^\]]+\]/g
  // 如果是数组, 使用 reduce 进行处理和过滤
  if (Array.isArray(msg)) {
    return msg.reduce((acc, item) => {
      if (typeof item === 'string') {
        // 替换 CQ 码
        const cleanedText = item.replace(cqCodeRegex, '').trim()
        // 只有当文本不为空时才推入结果数组
        if (cleanedText) {
          acc.push(cleanedText)
        }
      } else {
        // 非字符串对象（如图片、表情对象）直接保留
        acc.push(item)
      }
      return acc
    }, [])
  }
  // 如果不是字符串, 直接返回原值
  if (typeof msg !== 'string') return msg
  // 匹配 [CQ:...] 和 [CQ,...] 格式的 CQ 码
  return msg.replace(cqCodeRegex, '').trim()
}

/**
 * @description: 把超长字符串按照每 回车 与 chunkSize 字分割成数组
 * @param {string|Array} str
 * @param {number} chunkSize
 * @return {Array}
 */
export function splitString_Enter(str, chunkSize = 1000) {
  // 如果 str 是数组,先转换为字符串
  if (Array.isArray(str)) {
    str = str.join('\n');
  }
  const result = [];
  const lines = str.split('\n');
  let currentChunk = '';
  for (const line of lines) {
    // 如果当前行加上当前块不超过限制,就追加
    if ((currentChunk + line + '\n').length <= chunkSize) {
      currentChunk += (currentChunk ? '\n' : '') + line;
    } else {
      // 如果当前块不为空,先保存
      if (currentChunk) {
        result.push(currentChunk);
        currentChunk = '';
      }
      // 如果单行就超过限制,需要强制分割
      if (line.length > chunkSize) {
        for (let i = 0; i < line.length; i += chunkSize) {
          result.push(line.slice(i, i + chunkSize));
        }
      } else {
        currentChunk = line;
      }
    }
  }
  // 保存最后一个块
  if (currentChunk) {
    result.push(currentChunk);
  }
  return result;
}

/**
 * 从传入的对象中提取目标URL和类型，优先返回单个视频URL，无视频时返回单个图片URL
 * @param {Object} e - 包含视频/图片URL的源对象
 * @returns {Object} 包含目标URL和类型的对象 { targetUrl: string|null, isVideo: boolean }
 */
export function getMediaTargetUrl(e) {
  let targetUrl = null
  let isVideo = false

  const videoUrl = e.get_Video && Array.isArray(e.get_Video) && e.get_Video.length > 0
    ? e.get_Video[0].url
    : null;

  if (videoUrl) {
    targetUrl = videoUrl
    isVideo = true
  } else {
    if (e.img && Array.isArray(e.img) && e.img.length > 0) {
      targetUrl = e.img[0]
      isVideo = false
    }
  }

  return { targetUrl, isVideo }
}

/**
 * 处理 raw_message 中的 CQ 码
 * - 删除所有非 CQ:at 的 CQ 码
 * - 如果传入的 qq 号与某个 CQ:at 中的 qq 匹配，删除第一个匹配到的 CQ:at
 *
 * @param {string} rawMessage - 原始消息字符串
 * @param {string} targetQQ - （可选）要匹配并删除的 QQ 号，删除第一个匹配到的 CQ:at （用于 At Bot 启动的对话）
 * @returns {string} 处理后的消息字符串
 */
export function processCQMessage(rawMessage, targetQQ) {
  if (typeof rawMessage !== 'string' || !rawMessage) return rawMessage || ''

  // 合并转发必须抢在清理之前改写：下面的正则会把所有非 at 的 CQ 码整段删掉，
  // [CQ:forward,id=xxx] 一旦被删，转发 id 就彻底丢了，后续无从读取。
  // 改写成不含 "[CQ:" 前缀的信标后，那条正则匹配不到它，id 得以保留到解析阶段。
  let result = rawMessage
  if (Config.enableForwardMsgRead !== false) {
    result = rewriteForwardCQToBeacon(result)
  }

  // 删除所有非 CQ:at 的 CQ 码
  result = result.replace(/\[CQ:(?!at\b)[^\]]*\]/g, '');
  // 找到第一个 qq 匹配的 CQ:at，删除它
  if (targetQQ !== undefined && targetQQ !== null) {
    const qqStr = String(targetQQ);
    // 匹配 CQ:at，捕获其中的 qq 字段
    const cqAtRegex = /\[CQ:at,qq=(\d+)[^\]]*\]/g;
    let firstMatchDeleted = false;
    result = result.replace(cqAtRegex, (match, qq) => {
      if (!firstMatchDeleted && qq === qqStr) {
        firstMatchDeleted = true;
        return ''; // 删除第一个匹配到的
      }
      return match; // 其余保留
    });
  }
  // 清理多余空格
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/**
 * @description: 获取指定用户的详细信息对象
 * @param {*} e 如果要获取指定群的群聊信息，传递：{ isGroup: true, group_id: group_id }
 * @param {*} qq 指定的QQ号
 * @return {Object} 获取到的用户信息对象，包含 card, name, gender, age, role, level, join_time, last_sent_time, title
 */
export async function getUserDetailedInfo(e, qq = null) {
  qq = qq || e.user_id;

  // 辅助函数：格式化提取你需要的数据，并保留原始对象供调试
  const formatResult = (info, sourceName) => {
    // 兼容某些适配器把信息包裹在 sender 属性里的情况
    const data = info.sender ? { ...info, ...info.sender } : info;

    // 优先取群名片，其次取昵称，都没有则取QQ号
    const nickname = data.nickname || String(qq);
    const card = data.card || nickname;

    // 在 OICQ/ICQQ 等常见框架中，性别字段通常是 sex 或 gender (一般值为 'male', 'female', 'unknown')
    const gender = data.sex || data.gender || 'unknown';

    return {
      card: card,
      name: nickname,
      gender: gender,
      age: data.age ?? 'unknown',      // 年龄
      role: data.role || 'unknown',    // 群身份 (owner:群主, admin:管理, member:成员)
      source: sourceName,              // 记录是哪个代码块成功获取到了数据，极大地缩短你的排错时间
      level: info.level, // 成员的群等级
      join_time: info.join_time, // 成员的入群时间 单位 时间戳
      last_sent_time: info.last_sent_time, // 成员的上次发言时间 单位 时间戳
      title: info.title, // 成员的群头衔
      // rawInfo: info                    // 返回完整的原始对象，供你使用 console.log 打印查看还能取到啥
    };
  };

  // 如果e是群聊消息，则尝试获取群名片等信息
  if (e && e.isGroup) {
    // 1. 优先使用 gml (群成员列表) 获取
    try {
      const gml = await e.bot?.gml;
      if (gml) {
        const groupMembers = gml.get(e.group_id);
        if (groupMembers) {
          const member = groupMembers.get(qq);
          if (member && (member.card || member.nickname)) {
            return formatResult(member, 'gml');
          }
        }
      }
    } catch (err) { }

    // 2. 喵崽版
    try {
      const usrinfo = await e.bot.getGroupMemberInfo?.(e.group_id, qq) || await e.bot.pickMember?.(e.group_id, qq);
      if (usrinfo && (usrinfo.card || usrinfo.nickname)) {
        return formatResult(usrinfo, 'e.bot.getGroupMemberInfo / pickMember');
      }
    } catch (err) { }

    // 3. 其他适配器版 - 单开qq
    try {
      const member = await Bot.getGroupMemberInfo?.(e.group_id, qq) || await Bot.pickMember?.(e.group_id, qq);
      if (member != undefined) {
        const userName_Bot = member.card || member.sender?.card || member.nickname || member.sender?.nickname;
        if (userName_Bot) {
          return formatResult(member, 'Bot.getGroupMemberInfo (单开)');
        }
      }
    } catch (err) { }

    // 4. 其他适配器版 - 多开qq
    try {
      const memberInfo = await executeBotMethod('pickMember', e.group_id, qq);
      const userName_Bot = extractProperty(memberInfo, 'card').value || extractProperty(memberInfo, 'nickname').value;
      if (userName_Bot) {
        return formatResult(memberInfo, 'executeBotMethod (多开)');
      }
    } catch (err) { }

    // 5. 其他适配器版 - 未知适配器1
    try {
      const info = await e.group.pickMember(qq).getInfo();
      if (info && info.nickname) {
        return formatResult(info, 'e.group.pickMember');
      }
    } catch (err) { }

    // 6. 其他适配器版 - 未知适配器2
    try {
      const info = await Bot.pickGroup(e.group_id).pickMember(qq).getInfo();
      if (info && info.nickname) {
        return formatResult(info, 'Bot.pickGroup');
      }
    } catch (err) { }
  }

  // 7. 私聊通用版
  try {
    const info = await Bot.pickUser(qq).getSimpleInfo();
    if (info && info.nickname) {
      return formatResult(info, 'Bot.pickUser');
    }
  } catch (error) {
    try {
      const info = await e.bot.pickUser(qq).getInfo();
      if (info && info.nickname) {
        return formatResult(info, 'e.bot.pickUser');
      }
    } catch (error) { }
  }

  // 都失败了就返回保底对象
  return {
    card: String(qq),
    name: String(qq),
    gender: 'unknown',
    age: 'unknown',
    role: 'unknown',
    source: 'fallback (全部失败)',
    // rawInfo: null
  };
}

/**
 * 从 e.message[i] 的 file_id 提取文件，或直接获取图片 (image)、音频 (record) 等消息类型的直链 (url) 或本地路径

        let fileUrl = '';
        for (let msg of e.message) {
          if (msg.type === 'record' || msg.type === 'file') { // 想要什么类型自己写
            fileUrl = await getOnebotFileOrMediaUrl(e, msg);
            if (fileUrl) break;
          }
        }

 * @param {Object} e - Yunzai 的事件对象
 * @param {Object} msg - 消息体对象片段，例如 e.message[i]
 * @returns {Promise<string>} 返回文件的 URL、base64 字符串或本地绝对路径
 */
export async function getOnebotFileOrMediaUrl(e, msg) {
  let fileUrl = '';

  // 1. 如果消息本身自带直接可用的 url (例如部分适配器的 image, record 或 http 链接)，直接返回
  if (msg.url && (msg.url.startsWith('http') || msg.url.startsWith('base64://') || msg.url.startsWith('data:'))) {
    return msg.url;
  }

  // 2. 尝试提取 file_id 各种消息类型中的标识：
  let fileId = msg.file_id || msg.id || msg.fid || msg.file;
  if (!fileId) return '';
  try {
    if (e.isGroup) {
      // TRSS-Yunzai
      if (msg.type === 'file' && typeof e.group?.fs?.download === 'function') {
        let res = await e.group.fs.download(fileId, msg.busid || 0);
        fileUrl = res?.url || res?.data?.url || res?.file || res?.data?.file;
      }
      // Miao-Yunzai
      else if (typeof e.group?.getFileUrl === 'function') {
        fileUrl = await e.group.getFileUrl(fileId);
      }
      // TRSS-Yunzai
      else if (typeof e.group?.getLocalFileInfo === 'function') {
        let res = await e.group.getLocalFileInfo(fileId);
        fileUrl = res?.url || res?.data?.url || res?.file || res?.data?.file;
      }
    } else {
      // TRSS-Yunzai
      if (typeof e.friend?.getLocalFileInfo === 'function') {
        let res = await e.friend.getLocalFileInfo(fileId);
        fileUrl = res?.url || res?.data?.url || res?.file || res?.data?.file;
      }
      // Miao-Yunzai
      else if (typeof e.friend?.getFileUrl === 'function') {
        fileUrl = await e.friend.getFileUrl(fileId);
      }
    }
  } catch (error) {
    logger.error(`[ChatGPT][paimonFuction] 获取文件/Record链接异常:`, error);
  }

  return fileUrl || '';
}

/** 媒体下载允许的最大重定向跳数（每一跳都会重新校验目标地址） */
const MEDIA_MAX_REDIRECTS = 3

/**
 * 把 IPv6 文本解析成 8 个 16 位分组（支持 `::` 压缩、末尾 IPv4 写法与 zone id）
 *
 * @param {string} address
 * @returns {number[]|null} 非法时返回 null
 */
function parseIpv6Groups(address) {
  let text = address.toLowerCase()
  const zoneIndex = text.indexOf('%')
  if (zoneIndex >= 0) text = text.slice(0, zoneIndex)
  if (text.indexOf('::') !== text.lastIndexOf('::')) return null

  const parseSegment = (segment) => {
    if (!segment) return []
    const groups = []
    for (const part of segment.split(':')) {
      if (!part) return null
      if (part.includes('.')) {
        const nums = part.split('.').map(Number)
        if (nums.length !== 4 || nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
        groups.push((nums[0] << 8) | nums[1], (nums[2] << 8) | nums[3])
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null
        groups.push(parseInt(part, 16))
      }
    }
    return groups
  }

  const doubleColon = text.indexOf('::')
  if (doubleColon < 0) {
    const groups = parseSegment(text)
    return groups && groups.length === 8 ? groups : null
  }

  const head = parseSegment(text.slice(0, doubleColon))
  const tail = parseSegment(text.slice(doubleColon + 2))
  if (!head || !tail) return null
  const fill = 8 - head.length - tail.length
  if (fill < 1) return null
  return [...head, ...new Array(fill).fill(0), ...tail]
}

/**
 * IPv4 网段分类表
 *
 * 两档语义必须分开：
 * - `always`：回环、链路本地（含云元数据）、未指定、组播——即便域名可信也不连；
 * - `disallowed`：私网 / CGNAT / benchmark——不可信来源拒绝，可信的 QQ 图 CDN 允许。
 * 网段定义只维护这一份，别在别处再抄一遍（抄两遍迟早分叉）。
 */
const IPV4_BLOCKS = [
  { tier: 'always', test: (a) => a === 0 }, // 未指定地址
  { tier: 'always', test: (a) => a === 127 }, // 回环
  { tier: 'always', test: (a, b) => a === 169 && b === 254 }, // 链路本地（含云元数据 169.254.169.254）
  { tier: 'always', test: (a) => a >= 224 }, // 组播与保留
  { tier: 'disallowed', test: (a) => a === 10 }, // 私网 A
  { tier: 'disallowed', test: (a, b) => a === 172 && b >= 16 && b <= 31 },
  { tier: 'disallowed', test: (a, b) => a === 192 && b === 168 },
  { tier: 'disallowed', test: (a, b) => a === 100 && b >= 64 && b <= 127 }, // CGNAT
  { tier: 'disallowed', test: (a, b) => a === 198 && (b === 18 || b === 19) } // benchmark
]

/**
 * 查 IPv4 属于哪一档
 *
 * @param {string} address
 * @returns {'always'|'disallowed'|null}
 */
function ipv4BlockTier(address) {
  const [a, b] = address.split('.').map(Number)
  return IPV4_BLOCKS.find((block) => block.test(a, b))?.tier ?? null
}

/**
 * 判断 IPv4 是否为不应被外部输入访问的网段
 *
 * @param {string} address
 * @returns {boolean}
 */
function isDisallowedIpv4(address) {
  return ipv4BlockTier(address) !== null
}

/**
 * 可信来源可以豁免的地址：只有 IPv4 私网 / CGNAT / benchmark（含 mapped、WKP NAT64 变形）
 *
 * ULA（fc00::/7）、site-local（fec0::/10）、local-use NAT64（64:ff9b:1::/48）不在豁免范围——
 * 它们不是 CDN 调度会给出的地址，没有理由因为「来源可信」就放行。
 *
 * @param {string} address
 * @returns {boolean}
 */
function isTrustedBypassable(address) {
  const version = net.isIP(address)
  if (version === 4) return ipv4BlockTier(address) === 'disallowed'
  if (version !== 6) return false
  const embedded = embeddedIpv4(parseIpv6Groups(address))
  return embedded ? ipv4BlockTier(embedded) === 'disallowed' : false
}

/**
 * 取 IPv6 里内嵌的 IPv4（IPv4-mapped / compatible / WKP NAT64），没有则返回 null
 *
 * 前缀本身不代表目标：`::ffff:7f00:1`、`::7f00:1`、`64:ff9b::a9fe:a9fe` 真正连的都是末 32 位。
 * 两处判定（disallowed / always-blocked）共用这一份，别各写各的（写两遍必然有一处漏 NAT64）。
 *
 * @param {number[]|null} groups parseIpv6Groups 的结果
 * @returns {string|null} 点分十进制 IPv4
 */
function embeddedIpv4(groups) {
  if (!groups || groups.length !== 8) return null
  const mapped = groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)
  const nat64 = groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)
  if (!mapped && !nat64) return null
  return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
}

/**
 * 判断 IP 是否属于不应被外部输入访问的网段（loopback / 私网 / link-local / 保留 / 组播）
 *
 * IPv6 必须按 128 位真实解析后再判定：只识别 `::ffff:1.2.3.4` 这种 dotted 写法会漏掉
 * `::ffff:7f00:1`（十六进制写法，等价 127.0.0.1）等同义绕过。非法地址一律视为不安全。
 *
 * @param {string} address
 * @returns {boolean}
 */
function isDisallowedIpAddress(address) {
  const version = net.isIP(address)
  if (version === 4) return isDisallowedIpv4(address)
  if (version !== 6) return true

  const groups = parseIpv6Groups(address)
  if (!groups) return true

  const embedded = embeddedIpv4(groups)
  if (embedded) return isDisallowedIpv4(embedded)

  if ((groups[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((groups[0] & 0xffc0) === 0xfec0) return true // fec0::/10 已废弃的 site-local（RFC 3879）
  if ((groups[0] & 0xfe00) === 0xfc00) return true // fc00::/7 ULA
  if ((groups[0] & 0xff00) === 0xff00) return true // ff00::/8 组播
  // 64:ff9b:1::/48：RFC 8215 保留给「域内 IPv4/IPv6 translation」的 local-use 前缀，
  // 在部署 NAT64/翻译的网络里可能成为访问域内 IPv4 资源的入口（注意与公网 WKP 64:ff9b::/96 不同）
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups[2] === 0x0001) return true
  return false
}

/**
 * 即使域名可信也不应连接的地址：回环、链路本地（含云元数据 169.254.169.254）、
 * 未指定地址与组播。这类地址不可能承载 CDN 内容，命中即视为异常。
 *
 * @param {string} address
 * @returns {boolean}
 */
function isAlwaysBlockedIp(address) {
  const version = net.isIP(address)
  if (version === 4) return ipv4BlockTier(address) === 'always'
  if (version !== 6) return true
  const groups = parseIpv6Groups(address)
  if (!groups) return true
  // 内嵌 IPv4（mapped / compatible / WKP NAT64）按真实目标判定：
  // `::ffff:a9fe:a9fe`、`64:ff9b::a9fe:a9fe` 都是云元数据地址
  const embedded = embeddedIpv4(groups)
  if (embedded) return isAlwaysBlockedIp(embedded)
  if ((groups[0] & 0xffc0) === 0xfe80) return true // link-local
  if ((groups[0] & 0xff00) === 0xff00) return true // 组播
  return false
}

/**
 * 可信媒体域名：解析结果由平台方控制，模型只能挑选 URL、无法影响解析结果。
 * 群图 CDN 会调度到 CGNAT（100.64/10）等非常规网段，严格拦截会误伤正常下载。
 * 豁免只覆盖私网/CGNAT/保留段，回环与链路本地（含云元数据地址）仍然一律拒绝。
 */
const TRUSTED_MEDIA_HOSTS = ['.qq.com', '.qq.com.cn', '.qpic.cn', '.qlogo.cn', '.gtimg.cn']

function isTrustedMediaHost(hostname) {
  const h = String(hostname || '').toLowerCase()
  if (!h) return false
  return TRUSTED_MEDIA_HOSTS.some((suffix) => h === suffix.slice(1) || h.endsWith(suffix))
}
/**
 * 校验「不可信来源」的媒体地址，并返回本次连接应当使用的目标地址
 *
 * 模型的 tool arguments 属于不可信输入；直接交给下载函数等于开放 SSRF 与任意本地文件读取通道。
 * 返回值里的 address 必须交给 createPinnedAgent 固定连接：只校验不固定的话，实际建连时 Node 会
 * 再解析一次域名，攻击者可以让第一次解析返回公网、第二次返回内网（DNS rebinding / TOCTOU）。
 *
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.trusted] 调用方已确认地址来自服务端事件：只豁免私网/CGNAT/benchmark 判定，
 *                                    回环、链路本地与云元数据仍然拒绝
 * @returns {Promise<{address: string, family: number}>}
 * @throws {Error} 地址不合法、协议不允许或指向内网时抛错
 */
export async function resolveSafeRemoteMediaUrl(url, { trusted: forcedTrusted = false } = {}) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('媒体地址不是合法的 URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('媒体地址只允许 http/https 协议')
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  // forcedTrusted：调用方已确认地址来自服务端事件，只豁免私网/CGNAT 判定
  const trusted = forcedTrusted || isTrustedMediaHost(hostname)
  const literal = net.isIP(hostname)
  if (literal) {
    // 字面量分支与域名分支必须同口径：永远拒绝优先，其次才看「可信来源 + 可豁免网段」
    if (isAlwaysBlockedIp(hostname)) throw new Error('媒体地址指向内网或本机，已拒绝')
    if (isDisallowedIpAddress(hostname) && !(trusted && isTrustedBypassable(hostname))) {
      throw new Error('媒体地址指向内网或本机，已拒绝')
    }
    return { address: hostname, family: literal }
  }
  // 纯数字 / 0x 主机名可能被部分解析器当成整数形式的 IPv4（inet_aton 兼容写法），保守拒绝
  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
    throw new Error('媒体地址主机名不合法，已拒绝')
  }

  let resolved
  try {
    resolved = await dns.lookup(hostname, { all: true })
  } catch (err) {
    throw new Error('媒体地址域名解析失败')
  }
  if (!resolved.length) throw new Error('媒体地址域名没有解析结果')
  let picked = null
  let fallback = null
  for (const item of resolved) {
    // 回环 / 链路本地 / 云元数据与域名可信度无关，一律不连。
    // 必须先判：WKP NAT64 这类地址在 isDisallowedIpAddress 眼里是公网前缀，
    // 只有拆开内嵌 IPv4 才能看出它指向 127.0.0.1 或 169.254.169.254。
    if (isAlwaysBlockedIp(item.address)) {
      logger.warn(`[ChatGPT][resolveSafeRemoteMediaUrl] 拒绝 ${hostname} -> ${item.address}`)
      throw new Error('媒体地址解析到内网或本机，已拒绝')
    }
    if (!isDisallowedIpAddress(item.address)) {
      if (!picked) picked = item
      continue
    }
    // 可信来源只豁免私网/CGNAT/benchmark；ULA、site-local、local-use NAT64 仍拒绝
    if (!trusted || !isTrustedBypassable(item.address)) {
      logger.warn(`[ChatGPT][resolveSafeRemoteMediaUrl] 拒绝 ${hostname} -> ${item.address}`)
      throw new Error('媒体地址解析到内网或本机，已拒绝')
    }
    // 可信来源遇到 CGNAT/私网：留作兜底，优先用同批次里的公网地址
    if (!fallback) fallback = item
  }
  const target = picked || fallback
  if (!target) throw new Error('媒体地址没有可用的解析结果，已拒绝')
  return { address: target.address, family: target.family }
}

/**
 * 只做校验的兼容入口（测试与其他调用方使用）
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function assertSafeRemoteMediaUrl(url) {
  await resolveSafeRemoteMediaUrl(url)
}

/**
 * 创建把域名固定解析到指定地址的 agent
 *
 * 用于消除「先校验、后连接」之间的二次解析（DNS rebinding）。注意 agent 会覆盖 newFetch 的
 * 代理配置：严格模式下必须直连到已校验的地址，否则代理侧的目标解析无法由本机保证。
 *
 * @param {string} protocol
 * @param {{address: string, family: number}} target
 * @returns {import('node:http').Agent}
 */
function createPinnedAgent(protocol, { address, family }) {
  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback
    const lookupOptions = typeof options === 'function' ? {} : options
    if (lookupOptions?.all) return done(null, [{ address, family }])
    return done(null, address, family)
  }
  return protocol === 'https:' ? new https.Agent({ lookup }) : new http.Agent({ lookup })
}

/**
 * 下载媒体到 Buffer：手动接管重定向（逐跳校验）并限制响应体字节数
 *
 * 响应头与 body 的读取必须留在同一个 try 内——超时也可能发生在「响应头已到、body 很慢」阶段，
 * 此时错误只在读取 body 时抛出。
 *
 * @param {string} url
 * @param {object} options
 * @param {number} options.maxSizeBytes 响应体字节上限
 * @param {boolean} options.verifyUrl 是否按不可信来源逐跳校验地址（并固定连接目标）
 * @param {boolean} [options.trustPrivate] 校验时把私网/CGNAT/benchmark 视作可放行（来源已确认为事件媒体）
 * @param {'image'|'video'} [options.expectedKind] 期望的媒体大类，仅在严格校验时传入
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{buffer: Buffer, contentType: string, contentLength: number}>}
 */
async function downloadMediaToBuffer(url, { maxSizeBytes, verifyUrl, trustPrivate, expectedKind, timeoutMs = 60000 }) {
  let currentUrl = url
  const sizeTip = `${(maxSizeBytes / 1024 / 1024).toFixed(1)}MB`

  for (let hop = 0; hop <= MEDIA_MAX_REDIRECTS; hop++) {
    // 严格模式：先校验并把本次连接固定到已审核的地址，避免建连时二次解析
    let pinnedAgent
    if (verifyUrl) {
      const target = await resolveSafeRemoteMediaUrl(currentUrl, { trusted: trustPrivate })
      pinnedAgent = createPinnedAgent(new URL(currentUrl).protocol, target)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await newFetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; YunzaiBot)' },
        ...(pinnedAgent ? { agent: pinnedAgent } : {})
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        response.body?.destroy?.()
        if (!location) throw new Error(`媒体地址重定向缺少 Location（HTTP ${response.status}）`)
        if (hop === MEDIA_MAX_REDIRECTS) throw new Error('媒体地址重定向次数过多')
        // 相对地址按当前跳解析，下一轮循环会重新校验，避免被跳进内网
        currentUrl = new URL(location, currentUrl).href
        continue
      }

      if (!response.ok) {
        response.body?.destroy?.()
        throw new Error(`媒体下载失败：HTTP ${response.status || response.statusText}`)
      }

      let contentType = response.headers.get('content-type') || ''
      const mimeType = contentType.split(';')[0].trim().toLowerCase()
      // QQ 视频下载常返回通用二进制类型；只对未声明具体类型的视频改用内容探测。
      const detectVideoType = expectedKind === 'video' && (!mimeType || mimeType === 'application/octet-stream')
      // 明确的非媒体响应仍在读 body 前拒绝，避免把 WAF/登录 HTML 当成媒体送进模型。
      if (expectedKind) {
        const accepted = expectedKind === 'video' ? mimeType.startsWith('video/') : mimeType.startsWith('image/')
        if (!accepted && !detectVideoType) {
          response.body?.destroy?.()
          throw new Error(`媒体类型不符：期望 ${expectedKind}/*，实际 ${mimeType || '未知'}`)
        }
      }

      const declaredLength = Number(response.headers.get('content-length') || 0)
      if (declaredLength > maxSizeBytes) {
        response.body?.destroy?.()
        throw new Error(`媒体文件超过限制大小 ${sizeTip}`)
      }

      const chunks = []
      let total = 0
      for await (const chunk of response.body) {
        total += chunk.length
        if (total > maxSizeBytes) {
          response.body.destroy?.()
          throw new Error(`媒体文件超过限制大小 ${sizeTip}`)
        }
        chunks.push(chunk)
      }

      const buffer = Buffer.concat(chunks)
      if (detectVideoType) {
        // 复用宿主的文件签名检测，在大小校验后执行；不能仅凭 URL 后缀或请求参数信任视频类型。
        const fileType = await import('file-type')
        // 宿主可能安装 v16（CommonJS fromBuffer）或 v17+（ESM fileTypeFromBuffer）。
        const detect = fileType.fileTypeFromBuffer || fileType.fromBuffer || fileType.default?.fromBuffer
        if (typeof detect !== 'function') throw new Error('当前 file-type 版本不支持媒体文件类型检测')
        const detected = await detect(buffer)
        if (!detected?.mime.startsWith('video/')) {
          throw new Error(`媒体类型不符：期望 video/*，内容探测为 ${detected?.mime || '未知类型'}`)
        }
        contentType = detected.mime
      }

      return {
        buffer,
        contentType,
        contentLength: total
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw new Error('媒体地址重定向次数过多')
}

/**
 * @description: URL下载图片(或视频)转Base64 （默认） 或 Buffer 或 Blob，支持 base64:// 协议及 file:// 本地路径
 * @param {string} url 可以是 http(s)://, base64://, data:image/...;base64, 或 file:// (及本地绝对路径)
 * @param {*} isReturnBuffer 是否返回 Buffer ，默认 false
 * @param {*} isReturnBlob 是否返回 blob ，默认 false
 * @param {object} opt 可选
 * @param {number} opt.maxPixels 图片缩放选项 { maxPixels: 1048576 } 表示最大像素为 1024*1024=1048576
 * @param {number} opt.maxSizeBytes 最大下载字节
 * @param {Function} [opt.onError] 失败原因回调：本函数失败时返回 null，调用方只能通过它拿到真实原因
 * @param {number} opt.onlyCheck 仅检查大小不下载
 * @param {boolean} opt.allowLocalFile 是否允许 file://、本地绝对路径与 base64 直传，默认 true；
 *                                     处理不可信来源（如模型提供的地址）时必须传 false
 * @param {boolean} opt.allowPrivateNetwork 是否允许访问内网/本机地址，默认 true；
 *                                          处理不可信来源时必须传 false（只允许公网 http/https，逐跳校验并固定连接目标）
 * @param {boolean} opt.enforceAlwaysBlocked 私网/CGNAT 放行，但仍校验并固定连接目标，
 *                                           用来拦回环、链路本地与云元数据（服务端事件来源的媒体用这个）
 * @param {'image'|'video'} opt.mediaKind 期望的媒体大类；明确的非媒体 Content-Type 在读 body 前拒绝，
 *                                        视频的空类型或 application/octet-stream 在限量下载后按文件签名确认类型
 * @param {*} e e 可选，用于回复
 * @return {*}
 */
export async function url2Base64(url, isReturnBuffer = false, isReturnBlob = false, opt = {}, e = {}) {
  // 本函数对外契约是「失败返回 null」，调用方拿不到异常，只能通过回调取真实原因
  const reportError = (message) => {
    if (typeof opt.onError !== 'function') return
    try { opt.onError(new Error(message)) } catch (err) { logger.warn('[ChatGPT][url2Base64] onError 回调异常: ' + (err?.message || err)) }
  }

  try {
    // NapCat 下发的 URL 是 HTML 转义的（&amp;），不解码会被 CDN 当作非法 rkey 拒绝
    url = unescapeCqCode(url)
    let buffer;
    let contentLength;
    let contentType = 'image/jpeg'; // 默认类型

    const maxSizeInBytes = opt.maxSizeBytes || 10 * 1024 * 1024; // 10MB in bytes
    // 不可信来源（模型提供的地址等）必须显式关闭本地文件与内网访问
    const allowLocalFile = opt.allowLocalFile !== false;
    const allowPrivateNetwork = opt.allowPrivateNetwork !== false;
    const sizeTip = `${(maxSizeInBytes / 1024 / 1024).toFixed(1)}MB`;

    // 1. 判断是否为 base64 直传 (兼容 base64:// 和标准的 data: URL)
    if (url.startsWith('base64://') || url.startsWith('data:')) {
      if (!allowLocalFile) {
        logger.warn('[ChatGPT][url2Base64] 不可信来源不接受 base64 直传地址，已拒绝');
        reportError('不可信来源不接受 base64 直传地址');
        return null;
      }

      let base64Str = url;

      // 提取纯 Base64 字符串 和 Content-Type
      if (url.startsWith('base64://')) {
        base64Str = url.replace(/^base64:\/\//i, '');
      } else if (url.startsWith('data:')) {
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          contentType = match[1];
          base64Str = match[2];
        }
      }

      // 解码前先按 base64 长度估算（扣除末尾 padding，避免恰好等于上限的数据被误杀），
      // 避免先分配大块内存再判断
      const paddingLength = base64Str.endsWith('==') ? 2 : (base64Str.endsWith('=') ? 1 : 0);
      const estimatedBytes = Math.floor(base64Str.length / 4) * 3 - paddingLength;
      if (estimatedBytes > maxSizeInBytes) {
        logger.warn(`[ChatGPT][url2Base64] base64 数据超过限制大小 ${sizeTip}，已拒绝`);
        reportError(`base64 数据超过限制大小 ${sizeTip}`);
        return null;
      }

      buffer = Buffer.from(base64Str, 'base64');
      contentLength = buffer.length;

    }
    // 2. 判断是否为 file:// 协议或本地绝对路径 (兼容 Windows / Linux)
    else if (url.startsWith('file://') || /^[a-zA-Z]:(\\|\/)|^\//.test(url)) {
      if (!allowLocalFile) {
        logger.warn('[ChatGPT][url2Base64] 不可信来源不接受本地文件地址，已拒绝');
        reportError('不可信来源不接受本地文件地址');
        return null;
      }

      const fs = await import('node:fs');
      let localPath = url;

      // 解析 file:// 协议为实际路径
      if (localPath.startsWith('file://')) {
        const urlModule = await import('node:url');
        localPath = urlModule.fileURLToPath(localPath);
      }

      // 先 stat 再读取：避免为了判断大小把整个文件读进内存
      const stat = fs.statSync(localPath, { throwIfNoEntry: false });
      if (!stat?.isFile()) {
        throw new Error(`找不到本地文件: ${localPath}`);
      }
      if (stat.size > maxSizeInBytes) {
        logger.warn(`[ChatGPT][url2Base64] 文件超过限制大小 ${sizeTip}，已拒绝`);
        reportError(`文件超过限制大小 ${sizeTip}`);
        return null;
      }

      buffer = fs.readFileSync(localPath);
      contentLength = buffer.length;

      // 简单推断 contentType，用于后续 Blob 和格式化
      const ext = localPath.split('.').pop().toLowerCase();
      const mimeMap = {
        'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
        'gif': 'image/gif', 'webp': 'image/webp',
        'mp4': 'video/mp4', 'webm': 'video/webm',
        'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg', 'm4a': 'audio/mp4'
      };
      contentType = mimeMap[ext] || 'application/octet-stream';

    } else {
      // 3. 常规 URL 下载：手动接管重定向 + 流式累计字节上限
      const downloaded = await downloadMediaToBuffer(url, {
        maxSizeBytes: maxSizeInBytes,
        // enforceAlwaysBlocked：私网/CGNAT 放行，但仍要校验并固定连接（拦回环与云元数据）
        verifyUrl: !allowPrivateNetwork || opt.enforceAlwaysBlocked === true,
        trustPrivate: opt.enforceAlwaysBlocked === true,
        expectedKind: opt.mediaKind
      });
      buffer = downloaded.buffer;
      contentLength = downloaded.contentLength;
      contentType = downloaded.contentType || 'image/jpeg';
    }

    // 4. 校验文件大小
    if (contentLength && parseInt(contentLength) > maxSizeInBytes) {
      logger.mark(logger.blue('[派蒙nai]'), logger.cyan(`[ChatGPT][url2Base64 出错]`), logger.red(`文件大小超过${maxSizeInBytes / 1024 / 1024}MB，已中断执行`));
      reportError(`下载内容超过 ${maxSizeInBytes / 1024 / 1024}MB`);
      if (e.reply) {
        if (!e.isFromHandUpRepaint) e.reply(`文件大小超过${maxSizeInBytes / 1024 / 1024}MB，已中断执行`, true);
      }
      return null;
    }

    if (opt.onlyCheck) return true;

    // 4. 图片处理逻辑 (增加对视频类型的放行过滤，防止处理 MP4 时 sharp 报错)
    const isVideo = contentType.includes('video') || url.endsWith('.mp4');

    // if (opt.maxPixels && !isVideo) {
    //   try {
    //     // 获取图片尺寸
    //     let dimensions = imageSize(buffer);
    //     dimensions = proportionalCalculationWidthHeight(dimensions.width, dimensions.height, opt.maxPixels);
    //     // 使用 sharp 缩放图片
    //     buffer = await sharp(buffer)
    //       .resize(dimensions.width, dimensions.height, { withoutEnlargement: true })
    //       .timeout({ seconds: 10 })
    //       .toBuffer();
    //   } catch (err) {
    //     // sharp 处理超时或失败
    //     if (err.message.includes('timeout')) {
    //       logger.mark(logger.blue('[派蒙nai]'), logger.cyan(`[ChatGPT][url2Base64 错误]`), logger.red(`图片处理超时`));
    //       if (e.reply && !e.isFromHandUpRepaint) e.reply('引用的图片过大，sharp处理失败.', true);
    //       return null;
    //     } else {
    //       logger.mark(logger.blue('[派蒙nai]'), logger.cyan(`[ChatGPT][url2Base64 错误]`), logger.red(`图片处理失败: ${err.message}`));
    //       if (e.reply && !e.isFromHandUpRepaint) e.reply('sharp图片处理失败.', true);
    //       return null;
    //     }
    //   }
    // }

    // 5. 格式化输出
    if (isReturnBuffer) {
      return buffer;
    } else if (isReturnBlob) {
      const imageBlob = new Blob([buffer], { type: contentType });
      const fileName = isVideo ? 'video.mp4' : 'image.png';
      return { imageBlob, contentLength, fileName };
    } else {
      return buffer.toString('base64');
    }

  } catch (error) {
    logger.mark(logger.blue('[派蒙nai]'), logger.cyan(`[ChatGPT][url2Base64 错误]`), logger.red(hidePrivacyInfo(error.message || String(error))));
    if (e.reply) {
      if (!e.isFromHandUpRepaint) e.reply('引用的文件地址已失效或解析失败，请重新发送.', true);
    }
    // 本函数对外契约是「失败返回 null」，调用方只能通过回调拿到真实原因
    reportError(hidePrivacyInfo(error.message || String(error)))
    return null;
  }
}
