import { Config } from '../utils/config.js'
// import { parseSourceImg } from '../utils/common.js'
import fetch from 'node-fetch'
import { CustomGoogleGeminiClient } from "../client/CustomGoogleGeminiClient.js";
import axios from 'axios'

/**
 * @description: 获取gemini的识图/识视频结果，需要填写了gemini的token
 * @param {*} e
 * @param {*} img 图片url数组
 * @param {*} video 视频url数组 (传入的是url字符串数组)
 * @param {*} systemPrompt 自定义识别媒体的系统提示词（可选）
 * @return {string}
 */
export async function recognitionResultsByGemini(e, img = [], video = [], systemPrompt = `描述这个媒体中的内容，主要包括：全局分析：描述主体内容、风格类型、核心氛围；细节识别：列出画面中所有可辨识的视觉元素，包括：角色名称（仅限90%以上确定），物体：品牌/型号/文化符号，文字：翻译并定位。回复的时候仅需要用一段话描述内容，不要诸如“全局分析”这样的标题。`) {
  if (!Config.geminiKey)
    return "识别出错：请先配置Geimin对话接口"

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

  if (!targetUrl) return "识别出错：请传入要识别的媒体链接";

  let client = new CustomGoogleGeminiClient({
    e,
    userId: e.sender.user_id,
    key: Config.getGeminiKey,
    model: Config.gemini_vqa_model,
    baseUrl: Config.geminiBaseUrl,
    debug: Config.debug
  })

  try {
    const limitMB = Config.mediaMaxSizeInMB || 10;
    const maxSizeInBytes = limitMB * 1024 * 1024;

    const blobRes = await url2Base64(targetUrl, false, true, { maxSizeBytes: maxSizeInBytes });

    if (!blobRes || !blobRes.imageBlob) {
      return `识别出错：媒体文件获取失败、为空、或已超过限制大小 ${limitMB}MB。`;
    }

    // 自动获取探测到的 MimeType
    let mimeType = blobRes.imageBlob.type;
    if (!mimeType || mimeType === 'application/octet-stream') {
      mimeType = isVideo ? 'video/mp4' : 'image/jpeg'; // Fallback
    }

    // 提取纯 Base64 数据
    const arrayBuffer = await blobRes.imageBlob.arrayBuffer();
    let base64Data = Buffer.from(arrayBuffer).toString('base64');

    const reg_chatgpt_for_firstperson_call = new RegExp(Config.tts_First_person + "[,，.。]*", "g");
    let msg = e.msg.replace(reg_chatgpt_for_firstperson_call, '') || 'describe this content in Simplified Chinese'

    let res = await client.sendMessage(msg, {
      system: systemPrompt,
      // 记录点: opt.media
      media: {
        mimeType: mimeType,
        data: base64Data
      }
    })
    return res.text

  } catch (err) {
    logger.error('[recognitionResultsByGemini] 识别结果出错: ' + err)
    return '识别出错：' + (err.message || "网络或API错误")
  }
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
          let cleaned = tempSentence.replace(/。|\n$|^{|}$|^(，|,)/gm, "").trim();
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

/**
 * @description: URL下载图片(或视频)转Base64 （默认） 或 Buffer 或 Blob，支持 base64:// 协议及 file:// 本地路径
 * @param {string} url 可以是 http(s)://, base64://, data:image/...;base64, 或 file:// (及本地绝对路径)
 * @param {*} isReturnBuffer 是否返回 Buffer ，默认 false
 * @param {*} isReturnBlob 是否返回 blob ，默认 false
 * @param {object} opt 可选
 * @param {number} opt.maxPixels 图片缩放选项 { maxPixels: 1048576 } 表示最大像素为 1024*1024=1048576
 * @param {number} opt.maxSizeBytes 最大下载字节
 * @param {number} opt.onlyCheck 仅检查大小不下载
 * @param {*} e e 可选，用于回复
 * @return {*}
 */
export async function url2Base64(url, isReturnBuffer = false, isReturnBlob = false, opt = {}, e = {}) {
  try {
    let buffer;
    let contentLength;
    let contentType = 'image/jpeg'; // 默认类型

    const maxSizeInBytes = opt.maxSizeBytes || 10 * 1024 * 1024; // 10MB in bytes

    // 1. 判断是否为 base64 直传 (兼容 base64:// 和标准的 data: URL)
    if (url.startsWith('base64://') || url.startsWith('data:')) {
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

      buffer = Buffer.from(base64Str, 'base64');
      contentLength = buffer.length;

    }
    // 2. 判断是否为 file:// 协议或本地绝对路径 (兼容 Windows / Linux)
    else if (url.startsWith('file://') || /^[a-zA-Z]:(\\|\/)|^\//.test(url)) {
      const fs = await import('node:fs');
      let localPath = url;

      // 解析 file:// 协议为实际路径
      if (localPath.startsWith('file://')) {
        const urlModule = await import('node:url');
        localPath = urlModule.fileURLToPath(localPath);
      }

      if (!fs.existsSync(localPath)) {
        throw new Error(`找不到本地文件: ${localPath}`);
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
      // 3. 常规 URL 下载
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000 // 设置超时时间为60秒
      });

      // 获取长度和类型
      contentLength = response.headers?.['content-length'] || response.headers?.get('size') || response.data.byteLength;
      // 兼容 axios 不同版本的 headers 获取方式
      contentType = response.headers?.['content-type'] || response.headers?.get('content-type') || 'image/jpeg';

      buffer = Buffer.from(response.data, 'binary');
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
    logger.mark(logger.blue('[派蒙nai]'), logger.cyan(`[url2Base64 错误]`), logger.red(error.message || error));
    if (e.reply) {
      if (!e.isFromHandUpRepaint) e.reply('引用的文件地址已失效或解析失败，请重新发送.', true);
    }
    return null;
  }
}
