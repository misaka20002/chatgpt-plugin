import { Config } from '../utils/config.js'
// import { parseSourceImg } from '../utils/common.js'
import fetch from 'node-fetch'
import { CustomGoogleGeminiClient } from "../client/CustomGoogleGeminiClient.js";
import dns from 'node:dns/promises'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { newFetch } from './proxy.js'

/** 媒体识别的默认系统提示词：Gemini 识别与「当前模型」识别共用，避免两处文案漂移 */
const DEFAULT_MEDIA_RECOGNITION_PROMPT = `描述这个媒体中的内容，主要包括：全局分析：描述主体内容、风格类型、核心氛围；细节识别：列出画面中所有可辨识的视觉元素，包括：角色名称（仅限90%以上确定），物体：品牌/型号/文化符号，文字：翻译并定位。回复的时候仅需要用一段话描述内容，不要诸如“全局分析”这样的标题。`

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
 * @return {string|Promise<string>}
 */
export async function recognitionResultsByGemini(e, img = [], video = [], systemPrompt = DEFAULT_MEDIA_RECOGNITION_PROMPT, options = {}) {
  const { prompt, throwOnError = false, untrustedSource = false } = options

  // 默认保持旧的「返回错误字符串」契约；工具调用方要求失败即抛错时传 throwOnError
  const fail = (message) => {
    if (throwOnError) throw new Error(message)
    return '识别出错：' + message
  }

  if (!Config.geminiKey)
    return fail('请先配置Gemini对话接口')

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

  let client = new CustomGoogleGeminiClient({
    e,
    userId: e.sender.user_id,
    key: Config.getGeminiKey,
    model: Config.gemini_vqa_model,
    baseUrl: Config.geminiBaseUrl,
    debug: Config.debug
  })

  const limitMB = Config.mediaMaxSizeInMB || 10;
  const maxSizeInBytes = limitMB * 1024 * 1024;

  const blobRes = await url2Base64(targetUrl, false, true, {
    maxSizeBytes: maxSizeInBytes,
    allowLocalFile: !untrustedSource,
    allowPrivateNetwork: !untrustedSource,
    mediaKind: untrustedSource ? (isVideo ? 'video' : 'image') : undefined
  }).catch(err => {
    logger.warn('[recognitionResultsByGemini] 媒体获取失败: ' + hidePrivacyInfo(err.message || String(err)))
    return null
  });

  if (!blobRes || !blobRes.imageBlob) {
    return fail(`媒体文件获取失败、为空、或已超过限制大小 ${limitMB}MB`)
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

    let res = await client.sendMessage(msg, {
      system: systemPrompt,
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
    logger.warn('[recognitionResultsByGemini] 识别请求失败: ' + hidePrivacyInfo(err.message || String(err)))
    return fail(hidePrivacyInfo(err.message || "网络或API错误"))
  }
}

/**
 * @description: 解析当前对话使用的模型提供商（apps/chat.js 中 use 的语义）
 * 与沙箱规划子代理（utils/sandboxSubAgent.js）的 current 语义一致：用户自定义模式 > 全局 CHATGPT:USE > api
 * @param {*} e 事件对象
 * @return {Promise<string>} 如 api / responses / claude / gemini，可直接交给 SubLLM 使用
 */
export async function resolveCurrentChatProvider(e) {
  let mode = ''
  try {
    const userId = e?.sender?.user_id || e?.user_id
    if (userId) {
      // common.js 反向依赖本文件，惰性引入以避免循环导入
      const { getUserData } = await import('./common.js')
      const userData = await getUserData(userId)
      mode = userData?.mode === 'default' ? '' : (userData?.mode || '')
    }
  } catch (err) {
    logger.warn(`[resolveCurrentChatProvider] 读取用户对话模式失败，改用全局模式: ${err.message || err}`)
  }
  return mode || await redis.get('CHATGPT:USE') || 'api'
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
 * @return {Promise<string>} 识别结果文本
 */
export async function recognitionResultsByCurrentModel(e, img = [], video = [], systemPrompt = DEFAULT_MEDIA_RECOGNITION_PROMPT, options = {}) {
  const { prompt, untrustedSource = false } = options

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
  if (!MEDIA_SUPPORTED_USES.includes(provider)) {
    throw new Error(`当前对话模式(${provider})不支持媒体识别`)
  }

  const limitMB = Config.mediaMaxSizeInMB || 10;
  const blobRes = await url2Base64(targetUrl, false, true, {
    maxSizeBytes: limitMB * 1024 * 1024,
    allowLocalFile: !untrustedSource,
    allowPrivateNetwork: !untrustedSource,
    mediaKind: untrustedSource ? (isVideo ? 'video' : 'image') : undefined
  });

  if (!blobRes || !blobRes.imageBlob) {
    throw new Error(`媒体文件获取失败、为空、或已超过限制大小 ${limitMB}MB`)
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

  const subLLM = new SubLLM({ provider, systemPrompt, timeoutMs: 120000 })
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

/**
 * @description: 把句子转为不超过3个元素的数组，自动处理 at对象
 * @param {Array|Object|String} inputArr
 * @return {Array} 
 */
export function convertSentenceToArray(inputArr) {
  // 确保输入是数组格式
  const elements = Array.isArray(inputArr) ? inputArr : [inputArr];

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
export async function getGeminiModelsByFetch(apiKey = Config.getGeminiKey, geminiBaseUrl = Config.geminiBaseUrl) {
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
  // 删除所有非 CQ:at 的 CQ 码
  let result = rawMessage.replace(/\[CQ:(?!at\b)[^\]]*\]/g, '');
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
 * 获取图片的 base64 字符串
 * @param {string} url - 图片的 URL，可以是 http(s), data:URI 或 base64://
 * @returns {Promise<string | undefined>} - 返回纯 base64 字符串，失败返回 undefined
 */
export async function getImageBase64(url) {
  if (!url) return undefined;

  try {
    // 1. 处理 data: URI (例如: data:image/png;base64,iVBORw0KGgo...)
    if (url.startsWith('data:')) {
      // 提取逗号后面的纯 base64 数据部分
      return url.includes(',') ? url.split(',')[1] : url;
    }

    // 2. 处理 base64:// 自定义协议前缀
    if (url.startsWith('base64://')) {
      return url.replace(/^base64:\/\//, '');
    }

    // 3. 处理普通的 http / https 网络请求
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    // 注意：Buffer.from 是 Node.js 环境的 API
    return Buffer.from(arrayBuffer).toString('base64');

  } catch (error) {
    console.error(`Failed to convert image to base64: ${url}`, error);
    return undefined;
  }
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
    logger.error(`[paimonFuction] 获取文件/Record链接异常:`, error);
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
 * 判断 IPv4 是否为不应被外部输入访问的网段
 *
 * @param {string} address
 * @returns {boolean}
 */
function isDisallowedIpv4(address) {
  const [a, b] = address.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmark
  if (a >= 224) return true // 组播与保留
  return false
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

  if (groups.every((g) => g === 0)) return true // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1

  // IPv4-mapped (::ffff:0:0/96, groups[5]=0xffff) 与 IPv4-compatible (::/96, groups[5]=0)：
  // 都按内嵌的末 32 位重新交给 IPv4 判定
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    const ipv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
    return isDisallowedIpv4(ipv4)
  }

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
 * 校验「不可信来源」的媒体地址，并返回本次连接应当使用的目标地址
 *
 * 模型的 tool arguments 属于不可信输入；直接交给下载函数等于开放 SSRF 与任意本地文件读取通道。
 * 返回值里的 address 必须交给 createPinnedAgent 固定连接：只校验不固定的话，实际建连时 Node 会
 * 再解析一次域名，攻击者可以让第一次解析返回公网、第二次返回内网（DNS rebinding / TOCTOU）。
 *
 * @param {string} url
 * @returns {Promise<{address: string, family: number}>}
 * @throws {Error} 地址不合法、协议不允许或指向内网时抛错
 */
export async function resolveSafeRemoteMediaUrl(url) {
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
  const literal = net.isIP(hostname)
  if (literal) {
    if (isDisallowedIpAddress(hostname)) throw new Error('媒体地址指向内网或本机，已拒绝')
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
  for (const { address } of resolved) {
    if (isDisallowedIpAddress(address)) throw new Error('媒体地址解析到内网或本机，已拒绝')
  }
  const picked = resolved[0]
  return { address: picked.address, family: picked.family }
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
 * @param {'image'|'video'} [options.expectedKind] 期望的媒体大类，仅在严格校验时传入
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{buffer: Buffer, contentType: string, contentLength: number}>}
 */
async function downloadMediaToBuffer(url, { maxSizeBytes, verifyUrl, expectedKind, timeoutMs = 60000 }) {
  let currentUrl = url
  const sizeTip = `${(maxSizeBytes / 1024 / 1024).toFixed(1)}MB`

  for (let hop = 0; hop <= MEDIA_MAX_REDIRECTS; hop++) {
    // 严格模式：先校验并把本次连接固定到已审核的地址，避免建连时二次解析
    let pinnedAgent
    if (verifyUrl) {
      const target = await resolveSafeRemoteMediaUrl(currentUrl)
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

      // 类型校验放在读 body 之前：URL 返回 200 的 WAF/登录 HTML 不该被当成媒体送进模型
      if (expectedKind) {
        const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
        const accepted = expectedKind === 'video' ? mimeType.startsWith('video/') : mimeType.startsWith('image/')
        if (!accepted) {
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

      return {
        buffer: Buffer.concat(chunks),
        contentType: response.headers.get('content-type') || '',
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
 * @param {number} opt.onlyCheck 仅检查大小不下载
 * @param {boolean} opt.allowLocalFile 是否允许 file://、本地绝对路径与 base64 直传，默认 true；
 *                                     处理不可信来源（如模型提供的地址）时必须传 false
 * @param {boolean} opt.allowPrivateNetwork 是否允许访问内网/本机地址，默认 true；
 *                                          处理不可信来源时必须传 false（只允许公网 http/https，逐跳校验并固定连接目标）
 * @param {'image'|'video'} opt.mediaKind 期望的媒体大类；传入后响应 Content-Type 必须是 image/* 或 video/*，
 *                                        用于在读 body 前拒绝返回 200 的 HTML/JSON 等非媒体响应
 * @param {*} e e 可选，用于回复
 * @return {*}
 */
export async function url2Base64(url, isReturnBuffer = false, isReturnBlob = false, opt = {}, e = {}) {
  try {
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
        logger.warn('[url2Base64] 不可信来源不接受 base64 直传地址，已拒绝');
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
        logger.warn(`[url2Base64] base64 数据超过限制大小 ${sizeTip}，已拒绝`);
        return null;
      }

      buffer = Buffer.from(base64Str, 'base64');
      contentLength = buffer.length;

    }
    // 2. 判断是否为 file:// 协议或本地绝对路径 (兼容 Windows / Linux)
    else if (url.startsWith('file://') || /^[a-zA-Z]:(\\|\/)|^\//.test(url)) {
      if (!allowLocalFile) {
        logger.warn('[url2Base64] 不可信来源不接受本地文件地址，已拒绝');
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
        logger.warn(`[url2Base64] 文件超过限制大小 ${sizeTip}，已拒绝`);
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
        verifyUrl: !allowPrivateNetwork,
        expectedKind: opt.mediaKind
      });
      buffer = downloaded.buffer;
      contentLength = downloaded.contentLength;
      contentType = downloaded.contentType || 'image/jpeg';
    }

    // 4. 校验文件大小
    if (contentLength && parseInt(contentLength) > maxSizeInBytes) {
      logger.mark(logger.blue('[派蒙nai]'), logger.cyan(`[url2Base64 出错]`), logger.red(`文件大小超过${maxSizeInBytes / 1024 / 1024}MB，已中断执行`));
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
    //       logger.mark(logger.blue('[派蒙nai]'), logger.cyan(`[url2Base64 错误]`), logger.red(`图片处理超时`));
    //       if (e.reply && !e.isFromHandUpRepaint) e.reply('引用的图片过大，sharp处理失败.', true);
    //       return null;
    //     } else {
    //       logger.mark(logger.blue('[派蒙nai]'), logger.cyan(`[url2Base64 错误]`), logger.red(`图片处理失败: ${err.message}`));
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
    logger.mark(logger.blue('[派蒙nai]'), logger.cyan(`[url2Base64 错误]`), logger.red(hidePrivacyInfo(error.message || String(error))));
    if (e.reply) {
      if (!e.isFromHandUpRepaint) e.reply('引用的文件地址已失效或解析失败，请重新发送.', true);
    }
    return null;
  }
}
