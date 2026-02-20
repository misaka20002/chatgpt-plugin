import { Config } from '../utils/config.js'
// import { getImg } from '../utils/common.js'
import fetch from 'node-fetch'
import { CustomGoogleGeminiClient } from "../client/CustomGoogleGeminiClient.js";

/**
 * @description: 获取gemini的识图/识视频结果，需要填写了gemini的token
 * @param {*} e
 * @param {*} img 图片url数组
 * @param {*} video 视频url数组 (传入的是url字符串数组)
 * @return {*} recognitionResults
 */
export async function recognitionResultsByGemini(e, img = [], video = []) {
  if (Config.geminiKey) {
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

    if (targetUrl) {
      let client = new CustomGoogleGeminiClient({
        e,
        userId: e.sender.user_id,
        key: Config.getGeminiKey,
        model: Config.gemini_vqa_model,
        baseUrl: Config.geminiBaseUrl,
        debug: Config.debug
      })

      try {
        // 增加超时时间，视频下载可能较慢
        const response = await fetch(targetUrl, { timeout: 120000 });
        if (!response.ok) {
          return "媒体链接下载失败或已失效。"
        }

        const base64Data = Buffer.from(await response.arrayBuffer()).toString('base64')
        if (!base64Data) {
          return "媒体文件为空或链接失效。"
        }

        // 自动探测 MimeType
        let mimeType = response.headers.get('content-type')
        // 如果 header 没给或者不准确，回退到默认值
        if (!mimeType || mimeType === 'application/octet-stream') {
          mimeType = isVideo ? 'video/mp4' : 'image/jpeg'
        }

        const reg_chatgpt_for_firstperson_call = new RegExp(Config.tts_First_person + "[,，.。]*", "g");
        let msg = e.msg.replace(reg_chatgpt_for_firstperson_call, '') || 'describe this content in Simplified Chinese'
        let recognitionResults = ''

        // 动态调整 System Prompt 里的措辞
        const mediaTypeStr = isVideo ? "一段视频" : "一张照片";
        const systemPrompt = `我将拿出${mediaTypeStr}，你需要描述${mediaTypeStr}中的内容，主要包括：全局分析：描述主体内容、风格类型、核心氛围；细节识别：列出画面中所有可辨识的视觉元素，包括：角色名称（仅限90%以上确定），物体：品牌/型号/文化符号，文字：翻译并定位。回复的时候仅需要用一段话描述内容，不要诸如“全局分析”这样的标题。`

        let res = await client.sendMessage(msg, {
          system: systemPrompt,
          media: {
            mimeType: mimeType,
            data: base64Data
          }
        })
        recognitionResults = res.text
        return recognitionResults

      } catch (err) {
        logger.error('派蒙第一人称对话-获取gemini的识别结果出错: ' + err)
        return '请告知用户识别出错：' + (err.message || "网络或API错误")
      }
    }
  }
  return null // 如果没有key或者没有url
}

/**
 * @description: 把句子转为不超过3个元素的数组
 * @param {*} str
 * @return {*} array
 */
export function convertSentenceToArray(str) {
  // 用正则表达式来保留句号和问号符号
  // let arr = str.split(/([。？！～~!?“”"'‘’\n]+)/).filter(Boolean);
  let arr = str.split(/([。？！!?”’）)\n]+)/).filter(Boolean);
  let newArr = [];
  let tempSentence = '';
  // 把分隔符号插回去
  for (let i = 0; i < arr.length; i++) {
    tempSentence += arr[i];
    if (i % 2 !== 0) {
      newArr.push(tempSentence);
      tempSentence = '';
    } else if (i === arr.length - 1) {
      newArr.push(tempSentence);
    }
  }
  // 重组为不超过3句话
  while (newArr.length > 3) {
    for (let i = 0; i < newArr.length; i++) {
      newArr[i] = newArr[i] + (newArr[i + 1] || "");
      newArr.splice(i + 1, 1);
    }
  }
  // 把长度小于5的元素合并
  for (let i = 0; i < newArr.length; i++) {
    if (newArr[i].length < 5 || newArr[i + 1]?.length < 5) {
      newArr[i] = newArr[i] + (newArr[i + 1] || "");
      newArr.splice(i + 1, 1);
    }
  }
  // 删除句号和大括号
  for (let i = 0; i < newArr.length; i++) {
    // newArr[i] = newArr[i].replace(/。|\n$|^{|}$|(?<=.)\n|\n(?=.)/gm, "")
    newArr[i] = newArr[i].replace(/。|\n$|^{|}$|^(，|,)/gm, "")
  }

  return newArr;
}

/**
 * @description: 获取Gemini可用的模型列表
 * @param {string} apiKey - Google AI API密钥，默认从配置中获取
 * @return {Promise<Array>} 返回可用模型的数组
 */
export async function getGeminiModelsByFetch(apiKey = Config.getGeminiKey) {
  // 构建请求URL（考虑自定义baseUrl的情况）
  const baseUrl = Config.geminiBaseUrl || 'https://generativelanguage.googleapis.com';
  const endpoint = baseUrl.endsWith('/') ?
    `${baseUrl.slice(0, -1)}/v1beta/models` :
    `${baseUrl}/v1beta/models`;

  // 将API密钥作为URL参数
  const url = `${endpoint}?key=${apiKey}`;

  // 发送请求
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Node/1.0.0',
      'Accept': '*/*'
    },
    timeout: 60000 // 60秒超时
  });

  if (!response.ok) {
    throw new Error(`获取Gemini模型API请求失败: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (Config.debug) {
    logger.debug('获取Gemini模型列表响应:', JSON.stringify(data));
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
 * @description: 获取聊天历史记录，带错误重试机制
 * @param {*} target 目标对象 (e.group 或 e.friend)
 * @param {*} count 最大获取条数，若大于 20 则需要适配器的 getChatHistory 返回的数组是正序排列（即最早的信息是数组的第一个）
 * @param {*} seq 序列号或时间戳
 * @param {number} duration_hours 统计的小时数，默认为 0（不限制时间）。如果设置了此参数，则只获取指定小时数内的消息。
 * @param {Date} date_end 计算时间范围的结束时间，默认为当前时间
 * @return {Array} 聊天历史记录数组
 */
export async function getChatHistory_w(target, count, seq = null, duration_hours = 0, date_end = new Date()) {
  const maxBatchSize = 20; // 单次最大获取数量
  let allResults = []; // 存储所有获取到的消息
  let remainingCount = count; // 剩余需要获取的数量
  let total_err_count = 0; // 总错误次数

  // 计算时间范围的截止时间戳，使用传入的结束时间
  const endTime = Math.floor(date_end.getTime() / 1000); // 将 Date 对象转换为秒级时间戳
  const cutoffTime = duration_hours > 0 ? endTime - (duration_hours * 60 * 60) : 0;

  // 辅助函数：对消息数组按时间排序（从旧到新）
  const sortMessagesByTime = (messages) => {
    return messages.sort((a, b) => {
      const timeA = a.time || 0;
      const timeB = b.time || 0;
      return timeA - timeB; // 升序：最早的消息在前
    });
  };

  if (!seq) {
    let latestChat = await target.getChatHistory(undefined, 1)
    seq = latestChat[0].seq || latestChat[0].message_id
  }
  let currentSeq = seq; // 当前的序列号

  while (remainingCount > 0) {
    // 计算本次获取的数量
    const batchSize = Math.min(remainingCount, maxBatchSize);
    let currentCount = batchSize;

    // 重试机制
    while (currentCount >= 1) {
      try {
        const result = await target.getChatHistory(currentSeq, currentCount);

        if (!result || !Array.isArray(result) || result.length === 0) {
          // 如果没有更多消息了，返回已获取的消息（排序后）
          return sortMessagesByTime(allResults);
        }

        // 如果设置了时间范围，过滤消息
        let filteredResult = result;
        if (duration_hours > 0) {
          filteredResult = result.filter(msg => {
            const msgTime = msg.time || 0;
            return msgTime >= cutoffTime;
          });

          // 如果过滤后没有消息在时间范围内，说明已经超出时间范围
          if (filteredResult.length === 0) {
            // 检查是否有消息时间小于截止时间，如果有则说明已经超出时间范围
            const hasOlderMsg = result.some(msg => (msg.time || 0) < cutoffTime);
            if (hasOlderMsg) {
              return sortMessagesByTime(allResults);
            }
          }
        }

        // 将本次获取的消息添加到总结果中
        allResults.push(...filteredResult);

        // 更新剩余需要获取的数量
        remainingCount -= filteredResult.length;

        // 如果获取的消息数量少于请求数量，说明已经没有更多消息了
        if (result.length < currentCount) {
          return sortMessagesByTime(allResults);
        }

        // 如果设置了时间范围且过滤后的消息数量为0但原始消息有内容，可能需要继续获取
        if (duration_hours > 0 && filteredResult.length === 0 && result.length > 0) {
          // 检查最后一条消息是否还在时间范围内
          const lastMessage = result[result.length - 1];
          const lastMsgTime = lastMessage.time || 0;
          if (lastMsgTime < cutoffTime) {
            // 已经超出时间范围，停止获取
            return sortMessagesByTime(allResults);
          }
        }

        // 更新下次获取的起始序列号为本次结果的第一个消息的 seq || message_id
        if (result.length > 0) {
          const firstMessage = result[0];
          currentSeq = firstMessage.seq || firstMessage.message_id;
        }

        break; // 本批次获取成功，跳出重试循环
      } catch (err) {
        // logger.info(`[派蒙nai辅助]获取聊天历史失败，count=${currentCount}，正在尝试count=${currentCount - 1}`);
        currentCount--;
        total_err_count++;
        if (currentCount < 1 || total_err_count > 200) {
          // 如果已经有部分结果，返回已获取的部分
          if (allResults.length > 0) {
            logger.info(`[派蒙nai辅助]部分获取聊天历史失败，返回已获取的${allResults.length}条消息`);
            logger.info(`[派蒙nai辅助]部分获取聊天历史失败 err: ${err}`);
            return sortMessagesByTime(allResults);
          }
          // throw new Error(`获取聊天历史失败，已重试到count=1仍然失败`, err);
        }
      }
    }
  }

  return sortMessagesByTime(allResults);
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

/** 未使用 */
export async function generateHello_by_gemini(prompt, target) {
  prompt = prompt || "用简短的话用中文在群里打个招呼，活跃气氛";

  if (!Config.geminiKey.length) {
    return null
  }

  let sourceArr = await getChatHistory_w(target, 50);

  prompt += "下面是我们群的聊天记录：\n"
  prompt += sourceArr?.join("\n")

  logger.info(`Gemini Input: ${prompt}`)

  const opt = {
    toolMode: 'NONE',
    search: true,
    system: Config.helloPrompt || "用简短的话用中文在群里打个招呼，活跃气氛",
  };

  let client = new CustomGoogleGeminiClient({
    key: Config.getGeminiKey,
    model: Config.geminiModel,
    baseUrl: Config.geminiBaseUrl,
    debug: Config.debug
  })

  try {
    let res = await client.sendMessage(prompt, opt)
    return res.text || null
  } catch (err) {
    return null
  }
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
  // 如果是数组, 使用 reduce 进行处理和过滤
  if (Array.isArray(msg)) {
    return msg.reduce((acc, item) => {
      if (typeof item === 'string') {
        // 替换 CQ 码
        const cleanedText = item.replace(/\[CQ:[^\]]+\]/g, '').trim()
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
  // 匹配 [CQ:...] 格式的 CQ 码
  return msg.replace(/\[CQ:[^\]]+\]/g, '').trim()
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
