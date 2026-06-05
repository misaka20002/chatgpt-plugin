/**
 * innerOs（思考模式/全局破限）统一管理器。
 *
 * 所有路线的 innerOs 注入/更新/清除都通过此文件处理。
 *
 * === 清理方法（该功能可能在未来版本废弃） ===
 * 1. 删除此文件
 * 2. 删除 guoba.support.js 中的 paimon_globalInnerOs 配置项
 * 3. 删除 apps/chat.js 中的 INNER_OS_BEGIN/END 导入和注入行
 * 4. 删除 CustomGoogleGeminiClient.js 中的 syncInnerOs 导入和调用
 * 5. 删除 chatgpt-api.js / .ts 中的 syncInnerOs 导入和调用
 * 6. 删除 model/core.js 中的 paimon_globalInnerOs 传参
 * 7. 删除 utils/config.js 中的 paimon_globalInnerOs 默认值
 */

// ========== 标记常量 ==========

export const INNER_OS_BEGIN = '\n[os]\n'
export const INNER_OS_END = '\n[/os]\n'

// ========== 核心内容替换函数 ==========

/**
 * 在 content 中查找 innerOs 标记，替换为 newInnerOs。
 *
 * - 有标记 → 替换或删除标记间内容
 * - 无标记 + newInnerOs 有值 → 尝试剥离末尾可能存在的旧 innerOs 裸文本，
 *   然后追加带标记的内容（兼容旧版本直接 += 的迁移）
 * - 无标记 + newInnerOs 为空 → 返回原内容（非清除模式，清除需要已有标记）
 *
 * 剥离逻辑（兼容旧版本直接 `+= innerOs` 到 content 末尾的行为）：
 *   1. 先试 `'\n' + newInnerOs` 结尾 → 剥离
 *   2. 再试 `newInnerOs` 结尾 → 剥离
 *   (仅当 newInnerOs 与旧 innerOs 相同时才精确匹配。不同时不剥离，旧内容
 *   会保留在标记外，但标记内的新 innerOs 优先级更高，且后续可以被覆盖)
 *
 * @param {string} content
 * @param {string|undefined} newInnerOs
 * @returns {string}
 */
export function replaceInnerOsContent(content, newInnerOs) {
  const beginIdx = content.indexOf(INNER_OS_BEGIN)
  const endIdx = content.indexOf(INNER_OS_END)

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // 有标记 → 替换或删除标记间内容
    if (!newInnerOs) {
      return content.substring(0, beginIdx) + content.substring(endIdx + INNER_OS_END.length)
    }
    return content.substring(0, beginIdx) + INNER_OS_BEGIN + newInnerOs + INNER_OS_END + content.substring(endIdx + INNER_OS_END.length)
  }

  // 无标记：首次迁移或新对话，追加带标记的内容
  if (newInnerOs) {
    // 尝试剥离末尾可能存在的旧 innerOs 裸文本（兼容旧版直接 += 的行为）
    let cleanContent = content
    const withNewline = '\n' + newInnerOs
    if (cleanContent.endsWith(withNewline)) {
      cleanContent = cleanContent.slice(0, -withNewline.length)
    }
    if (cleanContent.endsWith(newInnerOs)) {
      cleanContent = cleanContent.slice(0, -newInnerOs.length)
    }
    return cleanContent + '\n' + INNER_OS_BEGIN + newInnerOs + INNER_OS_END
  }

  return content
}

// ========== 统一入口 ==========

/**
 * 在消息列表中找首条 user 消息，应用 innerOs 替换。
 *
 * 自动兼容三种消息结构：
 * - OpenAI 原始消息：{ text, originalContent, content }
 * - OpenAI API 请求消息：{ role, content }
 * - Gemini 历史消息：{ role, parts: [{ text }] }
 *
 * @param {object[]} items     消息列表
 * @param {string|undefined} innerOs  innerOs 配置值。空/undefined=跳过，有值=注入
 * @param {object} [opts]
 * @param {function} [opts.getText]   (msg) => string | undefined，自定义文本提取。默认先取 text ?? content
 * @param {function} [opts.setText]   (msg, text) => void，自定义文本写入。默认同时写 text / content / originalContent
 * @param {function} [opts.upsert]    (msg) => Promise，持久化到 Redis
 * @param {function} [opts.onError]   (err) => void，持久化失败回调
 * @returns {{ changed: boolean, text?: string }} 是否发生了修改，以及新文本
 */
export function syncInnerOs(items, innerOs, opts = {}) {
  if (!innerOs) return { changed: false }

  const firstUser = items.find(m => m.role === 'user')
  if (!firstUser) return { changed: false }

  const text = opts.getText
    ? opts.getText(firstUser)
    : (firstUser.text ?? firstUser.content)

  if (typeof text !== 'string') return { changed: false }

  const newText = replaceInnerOsContent(text, innerOs)
  if (newText === text) return { changed: false }

  if (opts.setText) {
    opts.setText(firstUser, newText)
  } else {
    // 默认行为：同时更新所有常见字段
    if (firstUser.text !== undefined) firstUser.text = newText
    if (firstUser.content !== undefined) firstUser.content = newText
    if (typeof firstUser.originalContent === 'string') firstUser.originalContent = newText
  }

  if (opts.upsert) {
    const p = opts.upsert(firstUser)
    if (p?.catch) {
      p.catch(opts.onError || (err => logger.warn('[innerOs] 更新消息到持久化层失败', err)))
    }
  }

  const hasMark = text.includes(INNER_OS_BEGIN)
  const userAssistantCount = items.filter(m => m.role === 'user' || m.role === 'assistant').length

  let scenario
  if (hasMark) {
    scenario = '更新标记内容'
  } else if (userAssistantCount <= 1) {
    scenario = '新对话-首次注入'
  } else {
    // 旧数据迁移：看原始 text 末尾是否匹配旧 innerOs 裸文本
    const withNewline = '\n' + innerOs
    if (text.endsWith(withNewline)) {
      scenario = '旧数据迁移-含旧换行追加文本-剥离'
    } else if (text.endsWith(innerOs)) {
      scenario = '旧数据迁移-含旧裸追加文本-剥离'
    } else {
      scenario = '旧数据迁移-无旧 innerOs 或内容变化-直接注入'
    }
  }
  logger.debug(`[innerOs] ${scenario}，消息 ID: ${firstUser.id ?? 'unknown'}，列表共 ${items.length} 条，其中 user/assistant ${userAssistantCount} 条`)

  return { changed: true, text: newText }
}
