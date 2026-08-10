/**
 * 历史消息获取与缓存管理器
 */
class MessageHistoryManager {
  constructor() {
    this.cfg = {
      per_query_count: 200       // 每次 API 请求拉取的消息数
    };

    // 群级扫描断点：groupId -> message_seq
    this._group_cursor = new Map();
    // 用户消息缓存：groupId -> targetId -> Array<String>
    this._user_cache = new Map();
  }

  // 休眠函数（防风控使用）
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取缓存
   */
  _getUserCache(groupId, targetId) {
    const groupCache = this._user_cache.get(groupId);
    if (!groupCache) return null;
    return groupCache.get(targetId) || null;
  }

  /**
   * 清空缓存
   */
  clearCache() {
    this._group_cursor.clear();
    this._user_cache.clear();
  }

  /**
   * 从 OneBot 消息中提取纯文本。
   * @param {Object} msg
   * @returns {String}
   */
  _extractText(msg) {
    if (typeof msg?.message === 'string') {
      return msg.message.trim();
    }
    if (Array.isArray(msg?.message)) {
      return msg.message
        .filter(segment => segment?.type === 'text')
        .map(segment => segment?.data?.text || segment?.text || '')
        .join('')
        .trim();
    }
    if (typeof msg?.raw_message === 'string') {
      return msg.raw_message.trim();
    }
    return '';
  }

  /**
   * 收集并提取群消息中的纯文本，存入缓存
   */
  _collectMessages(groupId, messages) {
    if (!this._user_cache.has(groupId)) {
      this._user_cache.set(groupId, new Map());
    }
    const groupCache = this._user_cache.get(groupId);

    for (const msg of messages) {
      const senderId = String(msg.sender?.user_id || msg.user_id || '');
      if (!senderId) continue;

      if (!groupCache.has(senderId)) {
        groupCache.set(senderId, []);
      }

      const text = this._extractText(msg);

      if (text) {
        groupCache.get(senderId).push(text);
      }
    }
  }

  /**
   * @description: 获取聊天历史记录，带安全重试与防风控机制
   * @param {Object} target 目标对象 (e.group 或 e.friend)
   * @param {Number} count 最大获取条数 (如 2000)
   * @param {String|Number} seq 序列号或 message_id
   * @param {Number} duration_hours 统计的小时数，默认为 0（不限制时间）
   * @param {Date} date_end 计算时间范围的结束时间，默认为当前时间
   * @return {Promise<Array>} 聊天历史记录数组
   */
  async getChatHistorySafe(target, count, seq = null, duration_hours = 0, date_end = new Date()) {
    const maxBatchSize = 200; // API硬限制
    let allResults = [];
    let remainingCount = count;

    const seenMsgIds = new Set();
    const endTime = Math.floor(date_end.getTime() / 1000);
    const cutoffTime = duration_hours > 0 ? endTime - (duration_hours * 60 * 60) : 0;

    const sortMessagesByTime = (messages) => {
      return messages.sort((a, b) => (a.time || 0) - (b.time || 0));
    };

    let currentSeq = seq || 0;

    while (remainingCount > 0) {
      const batchSize = Math.min(remainingCount, maxBatchSize);
      let success = false;
      let maxRetries = 3;

      for (let retry = 1; retry <= maxRetries; retry++) {
        try {
          const result = await target.getChatHistory(currentSeq, batchSize, true);

          if (!result || !Array.isArray(result) || result.length === 0) {
            // 彻底没有历史消息了
            return sortMessagesByTime(allResults);
          }

          // 过滤掉已经获取过的边界消息
          let newMessages = result.filter(msg => {
            const id = msg.message_id || msg.seq;
            if (seenMsgIds.has(id)) return false;
            seenMsgIds.add(id);
            return true;
          });

          // 如果过滤后为空，说明获取到了重复的页（通常是已经触底或API不支持继续翻页）
          if (newMessages.length === 0) {
            return sortMessagesByTime(allResults);
          }

          // 如果是群消息，自动存入你的类级缓存
          if (target.group_id) {
            this._collectMessages(target.group_id, newMessages);
          }

          let filteredResult = newMessages;
          // 时间过滤逻辑
          if (duration_hours > 0) {
            filteredResult = newMessages.filter(msg => (msg.time || 0) >= cutoffTime);
            // 发现有比 cutoffTime 还老的消息，说明到达时间边界，无需再往前找了
            const hasOlderMsg = newMessages.some(msg => (msg.time || 0) < cutoffTime);
            if (hasOlderMsg) {
              allResults.push(...filteredResult);
              return sortMessagesByTime(allResults);
            }
          }

          allResults.push(...filteredResult);
          remainingCount -= filteredResult.length;

          // 更新 seq (YunZai 通常 result[0] 是本批次最老的消息)
          const firstMessage = result[0];
          const nextSeq = firstMessage.message_id || firstMessage.seq;

          // 如果 seq 没有变化，说明底层API卡住了，强制退出防止死循环
          if (currentSeq === nextSeq && currentSeq !== 0) {
            return sortMessagesByTime(allResults);
          }
          currentSeq = nextSeq;

          success = true;
          // 成功获取，跳出重试循环
          break;
        } catch (err) {
          logger.warn(`[历史消息获取] 拉取失败，正在重试 (${retry}/${maxRetries})，错误: ${err.message || err}`);
          await this._sleep(1500 * retry);
        }
      }

      if (!success) {
        logger.error(`[历史消息获取] 连续失败 ${maxRetries} 次，终止获取。已获取 ${allResults.length} 条。`);
        return sortMessagesByTime(allResults);
      }

      // 防风控：加点随机休眠，避免被 QQ 判定为刷接口
      if (remainingCount > 0) {
        await this._sleep(500 + Math.random() * 500);
      }
    }

    return sortMessagesByTime(allResults);
  }

  /**
   * @description: 业务包装层：获取指定事件 e 的群历史消息上下文，并自动补全群员名片
   * @param {Object} e YunZai/Miao-Yunzai 的事件对象
   * @param {Number} num 需要获取的总消息条数（包含当前这条 e）
   * @return {Promise<Array>} 补全了发送者信息的历史消息数组（时间升序）
   */
  async getGroupHistoryContext(e, num) {
    if (!e.group) return [e];

    this._collectMessages(e.group_id, [e]);

    const startSeq = e.seq || e.message_id;

    let chats = await this.getChatHistorySafe(e.group, num - 1, startSeq);

    const seenIds = new Set(chats.map(msg => msg.message_id || msg.seq));
    const currentId = e.message_id || e.seq;
    if (!seenIds.has(currentId)) {
      chats.push(e);
    }

    chats.sort((a, b) => (a.time || 0) - (b.time || 0));
    if (chats.length > num) {
      chats = chats.slice(chats.length - num);
    }

    // 补全发送者名片信息
    try {
      if (e.bot && e.bot.gml) {
        const memberMap = await e.bot.gml;
        if (memberMap && typeof memberMap.get === 'function') {
          for (const chat of chats) {
            if (chat.sender?.user_id) {
              const fullSender = memberMap.get(chat.sender.user_id);
              if (fullSender) {
                chat.sender = { ...chat.sender, ...fullSender };
              }
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`[群历史上下文] 补全发送者名片失败: ${err.message || err}`);
    }

    return chats;
  }

  /**
   * 获取指定用户在群内的历史文本消息
   * @param {Object} e 云崽的消息事件对象 e
   * @param {String|Number} target_id 目标用户的 QQ 号
   * @param {Number} max_rounds 最大请求轮数（推荐10轮，查询2000条就差不多了）
   * @param {Number} max_msg_count 目标用户最多获取的文本消息条数
   * @returns {Promise<Object>} 结果对象
   */
  async getUserTexts(e, target_id, max_rounds = 10, max_msg_count = 2000) {
    const group_id = String(e.group_id);
    target_id = String(target_id);

    // ---------- cache first (优先读缓存) ----------
    let cached = this._getUserCache(group_id, target_id);
    if (cached && cached.length >= max_msg_count) {
      return {
        texts: cached.slice(0, max_msg_count),
        scanned_messages: 0,
        from_cache: true
      };
    }

    let texts = cached ? [...cached] : [];
    let rounds = 0;

    // 群级扫描断点
    let message_seq = this._group_cursor.get(group_id) || 0;
    // 强制每次获取不能超过 200
    const count = Math.min(this.cfg.per_query_count, 200);

    // ---------- scan group messages (扫描群消息) ----------
    while (rounds < max_rounds && texts.length < max_msg_count) {
      try {
        // 调用云崽的 e.group.getChatHistory 接口
        const messages = await e.group.getChatHistory(message_seq, count, true);

        if (!messages || messages.length === 0) {
          break;
        }

        // 更新群扫描断点 (以第一条消息的 message_id 作为下一次拉取的起点)
        message_seq = messages[0].message_id;
        this._group_cursor.set(group_id, message_seq);

        // 关键点：这一页给所有人缓存
        this._collectMessages(group_id, messages);

        // 再取目标用户
        cached = this._getUserCache(group_id, target_id);
        if (cached) {
          texts = [...cached];
        }

      } catch (err) {
        logger.error(`获取群历史消息异常: ${err}`);
        // 这里查询的消息可能不存在，重置序号并清空缓存
        message_seq = 0;
        this.clearCache();
      }

      rounds += 1;
    }

    return {
      texts: texts.slice(0, max_msg_count),
      scanned_messages: rounds * count,
      from_cache: cached !== null
    };
  }

  /**
   * 为需要可追溯证据的分析任务获取指定群员的结构化历史文本。
   * 本方法每次都从当前消息向前独立扫描，不复用 getUserTexts 的群级游标。
   *
   * @param {Object} e 云崽群消息事件
   * @param {String|Number} target_id 目标群员 QQ
   * @param {Object} options
   * @param {Number} options.maxTargetMessages 最多返回的目标消息数
   * @param {Number} options.maxScannedMessages 最多扫描的群消息数
   * @returns {Promise<{records: Array, scanned_messages: Number, filtered: Object}>}
   */
  async getUserMessageRecords(e, target_id, options = {}) {
    if (!e?.group || !e?.group_id) {
      throw new Error('getUserMessageRecords 只能在群聊中使用');
    }

    const maxTargetMessages = Math.min(Math.max(Number(options.maxTargetMessages) || 500, 1), 500);
    const maxScannedMessages = Math.min(Math.max(Number(options.maxScannedMessages) || 10000, 1), 10000);
    const targetId = String(target_id);
    const records = [];
    const seenMessageIds = new Set();
    const seenTexts = new Set();
    const filtered = { empty: 0, command: 0, duplicate: 0, non_target: 0 };

    let currentSeq = e.seq || e.message_id || 0;
    let scannedMessages = 0;
    let finished = false;

    while (!finished && scannedMessages < maxScannedMessages && records.length < maxTargetMessages) {
      const batchSize = Math.min(this.cfg.per_query_count, 200, maxScannedMessages - scannedMessages);
      let messages = null;

      for (let retry = 1; retry <= 3; retry++) {
        try {
          messages = await e.group.getChatHistory(currentSeq, batchSize, true);
          break;
        } catch (err) {
          logger.warn(`[结构化历史消息] 拉取失败，正在重试 (${retry}/3): ${err.message || err}`);
          if (retry < 3) await this._sleep(750 * retry);
        }
      }

      if (!Array.isArray(messages) || messages.length === 0) break;

      const newMessages = messages.filter(msg => {
        const id = msg?.message_id ?? msg?.seq;
        const dedupeKey = id === undefined || id === null
          ? `${msg?.time || 0}:${msg?.sender?.user_id || msg?.user_id || ''}:${this._extractText(msg)}`
          : String(id);
        if (seenMessageIds.has(dedupeKey)) return false;
        seenMessageIds.add(dedupeKey);
        return true;
      });

      if (newMessages.length === 0) break;
      scannedMessages += newMessages.length;

      for (const msg of newMessages) {
        const senderId = String(msg?.sender?.user_id || msg?.user_id || '');
        if (senderId !== targetId) {
          filtered.non_target += 1;
          continue;
        }

        const text = this._extractText(msg).replace(/\s+/g, ' ').trim();
        if (!text) {
          filtered.empty += 1;
          continue;
        }
        if (/^#[^\s]+(?:\s+.*)?$/u.test(text)) {
          filtered.command += 1;
          continue;
        }
        if (seenTexts.has(text)) {
          filtered.duplicate += 1;
          continue;
        }
        seenTexts.add(text);

        records.push({
          message_id: msg?.message_id ?? msg?.seq ?? null,
          time: Number(msg?.time) || 0,
          text
        });
      }

      const firstMessage = messages[0];
      const nextSeq = firstMessage?.message_id ?? firstMessage?.seq;
      if (nextSeq === undefined || nextSeq === null || (String(nextSeq) === String(currentSeq) && currentSeq !== 0)) {
        finished = true;
      } else {
        currentSeq = nextSeq;
      }

      if (!finished && scannedMessages < maxScannedMessages && records.length < maxTargetMessages) {
        await this._sleep(500 + Math.random() * 500);
      }
    }

    records.sort((a, b) => a.time - b.time);
    const limitedRecords = records.length > maxTargetMessages
      ? records.slice(records.length - maxTargetMessages)
      : records;

    return {
      records: limitedRecords,
      scanned_messages: scannedMessages,
      filtered
    };
  }
}

/** 历史消息获取与缓存管理器实例 */
export const msgHistoryMgr = new MessageHistoryManager();
