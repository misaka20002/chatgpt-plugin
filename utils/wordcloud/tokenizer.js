import { Config } from '../config.js'
import fs from 'fs'
import nodejieba from '@node-rs/jieba'
import { msgHistoryMgr } from '../../model/Onebot11_MessageHistoryManager.js'


class Tokenizer {
  async getHistory(e, groupId, date = new Date(), duration = 0, userId) {
    if (!groupId) {
      throw new Error('no valid group id')
    }

    let group = e.bot.pickGroup(groupId)
    let sourceArr = await msgHistoryMgr.getChatHistorySafe(group, 1000, e.source?.seq || e.reply_id, duration, date);

    logger.info(`[Tokenizer.getHistory] 获取到${sourceArr.length}个群消息`);
    if (userId) {
      sourceArr = sourceArr.filter(chat => {
        const chatUserId = chat.sender?.user_id || chat.user_id || '';
        return String(chatUserId) === String(userId);
      });
      logger.info(`[Tokenizer.getHistory] 筛选出${sourceArr.length}个 "${userId}" 发送的群消息`);
    }

    return sourceArr

    // let group = e.bot.pickGroup(groupId, true)
    let latestChat = await group.getChatHistory(undefined, 1)
    let seq = latestChat[0].seq || latestChat[0].message_id
    let chats = latestChat
    function compareByTime(a, b) {
      const timeA = a.time
      const timeB = b.time
      if (timeA < timeB) {
        return -1
      }
      if (timeA > timeB) {
        return 1
      }
      return 0
    }
    // Get the current timestamp
    let currentTime = date.getTime()

    // Step 2: Set the hours, minutes, seconds, and milliseconds to 0
    date.setHours(0, 0, 0, 0)

    // Step 3: Calculate the timestamp representing the start of the specified date
    // duration represents the number of hours to go back
    // if duration is 0, keeping the original date (start of today)
    let startOfSpecifiedDate = date.getTime()
    // if duration > 0, go back to the specified number of hours
    if (duration > 0) {
      // duration should be in range [0, 24]
      // duration = Math.min(duration, 24)
      startOfSpecifiedDate = currentTime - (duration * 60 * 60 * 1000)
    }

    // Step 4: Get the end of the specified date by current time
    const endOfSpecifiedDate = currentTime
    while (isTimestampInDateRange(chats[0]?.time, startOfSpecifiedDate, endOfSpecifiedDate) &&
      isTimestampInDateRange(chats[chats.length - 1]?.time, startOfSpecifiedDate, endOfSpecifiedDate)) {
      let chatHistory
      try {
        chatHistory = await group.getChatHistory(seq, 20)
      }
      catch (err) {
        break
      }

      if (chatHistory.length === 1) {
        if ((chats[0].seq || chats[0].message_id) === (chatHistory[0].seq || chatHistory[0].message_id)) {
          // 昨天没有聊天记录 比如新建的群 新进群的机器人 会卡在某一条
          break
        }
      }
      chats.push(...chatHistory)
      chats.sort(compareByTime)
      seq = chatHistory?.[0]?.seq || chatHistory?.[0]?.message_id
      if (!seq) {
        break
      }
      if (Config.debug) {
        logger.info(`拉取到${chatHistory.length}条聊天记录，当前已累计获取${chats.length}条聊天记录，继续拉...`)
      }
    }
    chats = chats.filter(chat => isTimestampInDateRange(chat.time, startOfSpecifiedDate, endOfSpecifiedDate))
    if (userId) {
      chats = chats.filter(chat => String(chat.sender?.user_id || chat.user_id || '') === String(userId))
    }
    return chats
  }

  async getKeywordTopK(e, groupId, topK = 100, duration = 0, userId) {
    if (!nodejieba) {
      throw new Error('未安装node-rs/jieba，娱乐功能-词云统计不可用')
    }
    if (!this.loaded) {
      nodejieba.load()
      this.loaded = true
    }
    // duration represents the number of hours to go back, should in range [0, 24]
    let chats = await this.getHistory(e, groupId, new Date(), duration, userId)
    let durationStr = duration > 0 ? `${duration}小时` : '今日'
    logger.mark(`[词云生成] 聊天记录拉取完成，获取到${durationStr}内${chats.length}条聊天记录，准备分词中`)

    const _path = process.cwd()
    let stopWordsPath = `${_path}/plugins/chatgpt-plugin/utils/wordcloud/cn_stopwords.txt`
    let stopWords = []
    try {
      const data = fs.readFileSync(stopWordsPath, 'utf8')
      stopWords = String(data).split('\n').map(s => s.trim())
    } catch (err) {
      logger.warn(`[词云生成] 停用词表读取失败，将使用默认分词。原因: ${err.message}`)
    }

    // 预处理：提取所有纯文本内容，过滤掉空消息
    let chatTexts = chats
      .map(c => c.message
        .filter(item => item.type === 'text')
        .map(textItem => textItem.text)
        .join('').trim()
      )
      .filter(text => text.length > 0)

    let chatContent = chatTexts
      .map(text => {
        // 根据句子长度动态决定提取多少个关键词：大约每 10 个字提取 1 个词，最少 2 个，最多 20 个
        let threshold = Math.max(2, Math.min(20, Math.ceil(text.length / 10)))
        return nodejieba.extract(text, threshold)
      })
      .reduce((acc, curr) => acc.concat(curr), [])
      .map(c => c.keyword)
      // 过滤停用词，并建议过滤掉单字（单字在词云中通常是无意义的助词或标点）
      .filter(c => c.length > 1 && stopWords.indexOf(c) < 0)

    if (Config.debug) {
      logger.info(chatContent)
    }

    // 统计词频
    const countMap = {}
    for (const value of chatContent) {
      countMap[value] = (countMap[value] || 0) + 1
    }

    // 转换为数组并按词频降序排序 (简化了排序函数)
    let list = Object.entries(countMap).sort((a, b) => b[1] - a[1])

    // 消息少的时候放宽（允许只出现 1 次的词），消息多的时候严格（要求出现 3 次以上）
    let msgCount = chatTexts.length;
    let minFreq = 1; // 默认最宽松
    if (msgCount > 800) {
      minFreq = 4;
    } else if (msgCount > 300) {
      minFreq = 3;
    } else if (msgCount > 100) {
      minFreq = 2;
    }

    // 按动态门槛过滤并截取
    let finalKeywords = list.filter(s => s[1] >= minFreq).slice(0, topK)

    // 如果过滤后发现词汇量连预期的一半都不到，说明大家聊天可能太碎片化，自动降低门槛再试一次
    if (finalKeywords.length < (topK / 3) && minFreq > 1) {
      logger.mark(`[词云生成] 当前严格模式(>=${minFreq}次)提取词数(${finalKeywords.length})过少，自动降低门槛...`)
      minFreq -= 1;
      finalKeywords = list.filter(s => s[1] >= minFreq).slice(0, topK)
    }

    logger.mark(`[词云生成] 分词统计完成，最低词频阈值: ${minFreq}，列表长度: ${finalKeywords.length}，绘制词云中...`)
    return finalKeywords
  }
}

class ShamrockTokenizer extends Tokenizer {
  async getHistory(e, groupId, date = new Date(), duration = 0, userId) {
    logger.mark('当前使用Shamrock适配器')
    if (!groupId) {
      throw new Error('no valid group id')
    }
    let group = e.bot.pickGroup(groupId, true)
    // 直接加大力度
    let pageSize = 500
    let chats = (await group.getChatHistory(0, pageSize, false)) || []
    // Get the current timestamp
    let currentTime = date.getTime()

    // Step 2: Set the hours, minutes, seconds, and milliseconds to 0
    date.setHours(0, 0, 0, 0)

    // Step 3: Calculate the timestamp representing the start of the specified date
    // duration represents the number of hours to go back
    // if duration is 0, keeping the original date (start of today)
    let startOfSpecifiedDate = date.getTime()
    // if duration > 0, go back to the specified number of hours
    if (duration > 0) {
      // duration should be in range [0, 24]
      // duration = Math.min(duration, 24)
      startOfSpecifiedDate = currentTime - (duration * 60 * 60 * 1000)
    }

    // Step 4: Get the end of the specified date by currentTime
    const endOfSpecifiedDate = currentTime
    let cursor = chats.length
    // -------------------------------------------------------
    //               |             |            |
    // -------------------------------------------------------
    //                             ^            ^
    // long ago           cursor+pageSize     cursor       current
    while (isTimestampInDateRange(chats[0]?.time, startOfSpecifiedDate, endOfSpecifiedDate)) {
      // 由于Shamrock消息是从最新的开始拉，结束时由于动态更新，一旦有人发送消息就会立刻停止，所以不判断结束时间
      // 拉到后面会巨卡，所以增大page减少次数
      pageSize = Math.floor(Math.max(cursor / 2, pageSize))
      cursor = cursor + pageSize
      let retries = 3
      let chatHistory
      while (retries >= 0) {
        try {
          chatHistory = await group.getChatHistory(0, cursor, false)
          break
        } catch (err) {
          if (retries === 0) {
            logger.error(err)
          }
          retries--
        }
      }
      if (retries < 0) {
        logger.warn('拉不动了，就这样吧')
        break
      }
      if (chatHistory.length === 1) {
        break
      }
      if (chatHistory.length === chats.length) {
        // 没有了！再拉也没有了
        break
      }
      let oldLength = chats.length
      chats = chatHistory
      // chats.sort(compareByTime)
      if (Config.debug) {
        logger.info(`拉取到${chats.length - oldLength}条聊天记录，当前已累计获取${chats.length}条聊天记录，继续拉...`)
      }
    }
    chats = chats.filter(chat => isTimestampInDateRange(chat.time, startOfSpecifiedDate, endOfSpecifiedDate))
    if (userId) {
      chats = chats.filter(chat => String(chat.sender?.user_id || chat.user_id || '') === String(userId))
    }
    return chats
  }
}

function isTimestampInDateRange(timestamp, startOfSpecifiedDate, endOfSpecifiedDate) {
  if (!timestamp) {
    return false
  }
  timestamp = timestamp * 1000

  // Step 5: Compare the given timestamp with the start and end of the specified date
  return timestamp >= startOfSpecifiedDate && timestamp < endOfSpecifiedDate
}

export default {
  default: new Tokenizer(),
  shamrock: new ShamrockTokenizer()
}
