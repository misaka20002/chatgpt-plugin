import { Config } from '../config.js'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

// Prompt Gallery tag 词表（按分类）
export const GALLERY_TAG_CATEGORIES = {
  subject: ['人物', '动物', '风景', '建筑', '交通工具', '食物', '植物/花卉', '机械/工业'],
  style: ['写实/摄影', '动漫/二次元', '古风/传统', '国潮', '油画/绘画', '极简/扁平', '3D渲染', '像素风', '低多边形', '微缩模型', '复古/怀旧', '哥特/暗黑', '赛博朋克', '蒸汽朋克', '波普艺术', '浮世绘'],
  theme: ['科幻', '奇幻/魔法', '仙侠/修仙', '节日/新春', '城市宣传', '游戏', '服装设计', 'UI/网页设计', '表情包/贴纸'],
  technique: ['电影感', '双重曝光', '合成/拼贴', '微距', '长曝光', '全景/广角', '景深效果'],
  composition: ['横版16:9', '竖版9:16', '网格/拼图'],
  mood: ['史诗/宏大', '可爱/萌', '梦幻/浪漫', '温馨/治愈', '孤独/忧郁', '神秘', '黑暗/压抑'],
  color: ['暖色调', '冷色调', '莫兰迪色', '高饱和/鲜艳', '黑白']
}
export const GALLERY_ALL_TAGS = Object.values(GALLERY_TAG_CATEGORIES).flat()

// Prompt Gallery 前端版本号，修改前端后递增此值即可自动推送更新
export const PROMPT_GALLERY_VERSION = 3

/**
 * 判断 Prompt Gallery 是否已启用
 */
export function isGalleryEnabled() {
  return Config.enablePromptGallery ?? false
}

/**
 * 获取 tags 工具参数定义（仅在启用 Gallery 时返回，否则返回 null）
 */
export function getGalleryTagsParameter() {
  if (!isGalleryEnabled()) return null
  const categoryDesc = Object.entries(GALLERY_TAG_CATEGORIES)
    .map(([cat, tags]) => `${cat}: ${tags.join('、')}`)
    .join('\n')
  return {
    type: 'array',
    items: {
      type: 'string'
    },
    description: `为这幅画选择合适的标签（可多选，建议3~8个，尽量覆盖主体、风格、情绪、色调等多个维度）。优先从以下词表中选取，若词表中没有合适的标签，可以自创标签（简洁的中文词组）:\n${categoryDesc}`
  }
}

/**
 * 包装 e.reply，在画廊启用时捕获图片数据
 * @param {object} e - 原始事件对象
 * @param {boolean} enableGallery - 是否启用 gallery
 * @returns {{ new_e: object, capturedImages: string[] }}
 */
export function wrapReplyForGallery(e, enableGallery) {
  const new_e = Object.assign(Object.create(Object.getPrototypeOf(e)), e)
  if (new_e.at === new_e.bot.uin) {
    new_e.at = null
  }
  new_e.atBot = false

  let capturedImages = []

  if (enableGallery && new_e.reply) {
    const originalReply = new_e.reply
    new_e.reply = async function (content, quote, ...args) {
      try {
        const contentArr = Array.isArray(content) ? content : [content]
        const newImages = []
        for (const item of contentArr) {
          if (typeof item === 'object' && item.type === 'image') {
            newImages.push(item.file || item.url || item.src || '')
          } else if (typeof item === 'string' && item.includes('base64://')) {
            newImages.push(item)
          }
        }
        // 本次 reply 包含新图片时替换而非累积，以处理插件内部重试场景
        // （重试时第一次的失败图片会被最后一次成功图片覆盖）
        if (newImages.length > 0) {
          capturedImages.length = 0
          capturedImages.push(...newImages)
        }
      } catch (imgErr) {
        logger.warn('[ChatGPT][PromptGallery] Failed to capture image:', imgErr)
      }
      return await originalReply.call(e, content, quote, ...args)
    }
  }

  return { new_e, capturedImages }
}

// ============================================================
// Master Key 架构加密/解密
// 核心思路：密码不直接加密数据，只加密 master key。
// 改密码时只添加新 key_slot，旧 key_slot 保留，新旧密码都能解密。
// 服务端用 token_slot（以 token 派生密钥加密 master key）始终能解密。
// 图片同样用 master key 加密，密码怎么变都不影响解密。
//
// 数据结构：
// {
//   _encrypted: true,
//   _token_slot: { iv, data },           // master key 用 SHA256(token) 加密
//   key_slots: [                          // master key 用各密码加密
//     { pw_hash, iv, data },
//     { pw_hash, iv, data }, ...          // 旧密码的 slot 保留
//   ],
//   iv: "...",                             // 数据加密 iv
//   data: "..."                            // 数据用 master key 加密
// }
//
// 图片加密格式（二进制文件）：
//   iv(12字节) + AES-256-GCM密文 + authTag(16字节)
//   文件扩展名 .enc（明文图片仍为 .png）
// ============================================================

/**
 * AES-256-GCM 加密 Buffer
 * @param {Buffer} plaintext
 * @param {Buffer} key - 32 字节密钥
 * @returns {{ iv: string, data: string }}
 */
function aesGcmEncrypt(plaintext, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    iv: iv.toString('base64'),
    data: Buffer.concat([encrypted, authTag]).toString('base64')
  }
}

/**
 * AES-256-GCM 解密为 Buffer
 * @param {{ iv: string, data: string }} encObj
 * @param {Buffer} key - 32 字节密钥
 * @returns {Buffer}
 */
function aesGcmDecrypt(encObj, key) {
  const iv = Buffer.from(encObj.iv, 'base64')
  const combined = Buffer.from(encObj.data, 'base64')
  const ciphertext = combined.subarray(0, combined.length - 16)
  const authTag = combined.subarray(combined.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/** 从密码派生 AES-256 密钥 */
function deriveKeyFromPassword(password) {
  return crypto.createHash('sha256').update(password).digest()
}

/** 从 token 派生 AES-256 密钥（用于 token_slot） */
function deriveKeyFromToken(token) {
  return crypto.createHash('sha256').update(token + ':prompt-gallery').digest()
}

/**
 * 用 master key 加密图片二进制数据，返回加密后的二进制 Buffer
 * 格式：iv(12) + ciphertext + authTag(16)
 * @param {Buffer} imageBuffer - 原始图片二进制
 * @param {Buffer} masterKey - 32 字节 master key
 * @returns {Buffer}
 */
function encryptImageBuffer(imageBuffer, masterKey) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv)
  const encrypted = Buffer.concat([cipher.update(imageBuffer), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, authTag])
}

/**
 * 从已有加密对象中恢复 master key（通过 token_slot）
 * @param {object} existingEncrypted
 * @param {string} token
 * @returns {Buffer|null}
 */
function recoverMasterKey(existingEncrypted, token) {
  if (!existingEncrypted || !existingEncrypted._token_slot) return null
  try {
    const tokenKey = deriveKeyFromToken(token)
    return aesGcmDecrypt(existingEncrypted._token_slot, tokenKey)
  } catch { return null }
}

/**
 * 加密 gallery 数据（master key 架构）
 * @param {string} jsonStr - 要加密的 JSON 字符串
 * @param {string} password - 当前密码
 * @param {string} token - GitHub token（用于 token_slot）
 * @param {Buffer} masterKey - 已确定的主密钥
 * @param {Array} keySlots - 已有的 key_slots（旧密码 slot 保留）
 * @returns {object}
 */
function encryptGalleryData(jsonStr, password, token, masterKey, keySlots) {
  // 用当前密码加密 master key，生成新 key_slot
  const pwKey = deriveKeyFromPassword(password)
  const pwHash = crypto.createHash('sha256').update(password).digest('hex').slice(0, 16)
  const newSlot = { pw_hash: pwHash, ...aesGcmEncrypt(masterKey, pwKey) }

  // 替换同密码的旧 slot（刷新 iv），或追加新 slot（密码变更时保留旧 slot）
  const existingIdx = keySlots.findIndex(s => s.pw_hash === pwHash)
  if (existingIdx >= 0) {
    keySlots[existingIdx] = newSlot
  } else {
    keySlots.push(newSlot)
  }

  // 用 master key 加密实际数据
  const encryptedData = aesGcmEncrypt(Buffer.from(jsonStr, 'utf8'), masterKey)

  // 用 token 加密 master key（服务端恢复用，密码怎么变都不影响）
  const tokenKey = deriveKeyFromToken(token)
  const tokenSlot = aesGcmEncrypt(masterKey, tokenKey)

  return {
    _encrypted: true,
    _token_slot: tokenSlot,
    key_slots: keySlots,
    iv: encryptedData.iv,
    data: encryptedData.data
  }
}

/**
 * 使用 token 解密 gallery 数据（服务端用，密码无关）
 * @param {object} encryptedObj
 * @param {string} token
 * @returns {Array}
 */
function decryptGalleryDataByToken(encryptedObj, token) {
  const tokenKey = deriveKeyFromToken(token)
  const masterKey = aesGcmDecrypt(encryptedObj._token_slot, tokenKey)
  const decrypted = aesGcmDecrypt(encryptedObj, masterKey)
  return JSON.parse(decrypted.toString('utf8'))
}

/**
 * 画图完成后，异步推送记录到 Prompt Gallery
 * @param {{ prompt: string, plugin: string, tags: string[], images: string[] }} data
 */
export async function pushToGallery({ prompt, plugin, tags, images }) {
  const repo = Config.promptGalleryRepo
  const token = Config.promptGalleryToken
  const branch = Config.promptGalleryBranch || 'main'
  const filePath = Config.promptGalleryFilePath || 'gallery.json'

  if (!repo || !token) {
    logger.warn('[ChatGPT][PromptGallery] repo or token not configured, skip push')
    return
  }

  const password = Config.promptGalleryPassword || ''
  const githubApi = Config.githubAPI || 'https://api.github.com'
  const headers = { Authorization: `token ${token}`, 'User-Agent': 'chatgpt-plugin' }

  // ===== 第1步：读取已有 gallery.json，获取 master key =====
  const url = `${githubApi}/repos/${repo}/contents/${filePath}?ref=${branch}`
  let sha = null
  let existingData = []
  let masterKey = null
  let keySlots = []
  let isFirstPush = false
  try {
    const resp = await fetch(url, { headers })
    if (resp.ok) {
      const data = await resp.json()
      sha = data.sha
      const content = Buffer.from(data.content, 'base64').toString('utf-8')
      const parsed = JSON.parse(content)

      if (parsed._encrypted) {
        if (parsed._token_slot && parsed.key_slots) {
          // 新格式（master key 架构）：用 token_slot 恢复 master key
          try {
            masterKey = recoverMasterKey(parsed, token)
            if (!masterKey) throw new Error('failed to recover master key')
            existingData = decryptGalleryDataByToken(parsed, token)
            keySlots = [...parsed.key_slots]
            logger.info('[ChatGPT][PromptGallery] decrypted existing gallery data via token_slot')
          } catch (decErr) {
            logger.error('[ChatGPT][PromptGallery] failed to decrypt gallery.json:', decErr.message)
            return
          }
        } else if (password) {
          // 旧格式兼容：用密码直接解密，之后会自动迁移为新格式
          try {
            const oldKey = deriveKeyFromPassword(password)
            const iv = Buffer.from(parsed.iv, 'base64')
            const combined = Buffer.from(parsed.data, 'base64')
            const ciphertext = combined.subarray(0, combined.length - 16)
            const authTag = combined.subarray(combined.length - 16)
            const decipher = crypto.createDecipheriv('aes-256-gcm', oldKey, iv)
            decipher.setAuthTag(authTag)
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
            existingData = JSON.parse(decrypted.toString('utf8'))
            // 旧格式没有 master key，下面会生成新的
            logger.info('[ChatGPT][PromptGallery] migrated old-format encrypted data to master key format')
          } catch (decErr) {
            logger.warn('[ChatGPT][PromptGallery] cannot decrypt old-format data (password changed?). Starting fresh')
            isFirstPush = true
          }
        } else {
          logger.warn('[ChatGPT][PromptGallery] encrypted data without password. Starting fresh')
          isFirstPush = true
        }
      } else if (parsed._master_key && parsed.data) {
        // 密码已移除的格式：明文数据 + 暴露的 master key（用于解密旧 .enc 图片）
        existingData = parsed.data
        masterKey = Buffer.from(parsed._master_key, 'base64')
        logger.info('[ChatGPT][PromptGallery] loaded plaintext data with public master key for .enc images')
      } else {
        // 纯明文数组（无加密历史）
        existingData = Array.isArray(parsed) ? parsed : (parsed.data || parsed)
        if (password) {
          logger.info('[ChatGPT][PromptGallery] migrating plaintext gallery.json to encrypted format')
        }
      }
      if (!Array.isArray(existingData)) existingData = []
    } else {
      isFirstPush = true
    }
  } catch (err) {
    isFirstPush = true
    logger.info('[ChatGPT][PromptGallery] no existing file, will create new one')
  }

  // 确定或生成 master key
  if (password && !masterKey) {
    masterKey = crypto.randomBytes(32)
  }

  // ===== 第2步：上传图片（有密码时加密上传） =====
  async function uploadImage(rawImageBuffer, index) {
    const timestamp = Date.now()

    if (password && masterKey) {
      // 加密图片
      const encryptedBuf = encryptImageBuffer(rawImageBuffer, masterKey)
      const fileName = `${timestamp}_${index}.enc`
      const imgPath = `images/${fileName}`
      const content = encryptedBuf.toString('base64')

      const resp = await fetch(`${githubApi}/repos/${repo}/contents/${imgPath}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `feat: upload encrypted image ${fileName}`, content, branch })
      })
      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`Upload encrypted image failed ${resp.status}: ${errText}`)
      }
      return imgPath
    } else {
      // 明文上传
      const fileName = `${timestamp}_${index}.png`
      const imgPath = `images/${fileName}`
      const content = rawImageBuffer.toString('base64')

      const resp = await fetch(`${githubApi}/repos/${repo}/contents/${imgPath}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `feat: upload image ${fileName}`, content, branch })
      })
      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`Upload image failed ${resp.status}: ${errText}`)
      }
      return imgPath
    }
  }

  // 处理图片：URL 直存，base64/本地文件 加密后上传
  const resolvedImages = []
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    if (!img) continue

    if (img.startsWith('http://') || img.startsWith('https://')) {
      // URL 直存（外部图片无法加密，保持原样）
      resolvedImages.push(img)
    } else if (img.startsWith('base64://')) {
      try {
        const raw = Buffer.from(img.replace(/^base64:\/\//, ''), 'base64')
        const relativePath = await uploadImage(raw, i)
        resolvedImages.push(relativePath)
        logger.info(`[ChatGPT][PromptGallery] uploaded image to ${relativePath}`)
      } catch (err) {
        logger.warn(`[ChatGPT][PromptGallery] failed to upload image ${i}:`, err.message)
      }
    } else {
      try {
        const fs = await import('fs')
        if (fs.existsSync(img)) {
          const raw = fs.readFileSync(img)
          const relativePath = await uploadImage(raw, i)
          resolvedImages.push(relativePath)
        }
      } catch (err) {
        logger.warn(`[ChatGPT][PromptGallery] skipping unresolvable image: ${img}`)
      }
    }
  }

  // ===== 第3步：首次推送或版本变更时上传 index.html 和 netlify.toml =====
  let needUploadFrontend = isFirstPush
  if (!needUploadFrontend) {
    // 检查仓库中的 version.json
    try {
      const verResp = await fetch(`${githubApi}/repos/${repo}/contents/version.json?ref=${branch}`, { headers })
      if (verResp.ok) {
        const verData = await verResp.json()
        const verContent = JSON.parse(Buffer.from(verData.content, 'base64').toString('utf-8'))
        if (verContent.version !== PROMPT_GALLERY_VERSION) {
          needUploadFrontend = true
          logger.info(`[ChatGPT][PromptGallery] version mismatch (remote=${verContent.version}, local=${PROMPT_GALLERY_VERSION}), will update frontend`)
        }
      } else {
        // version.json 不存在，需要上传
        needUploadFrontend = true
        logger.info('[ChatGPT][PromptGallery] version.json not found in repo, will upload frontend')
      }
    } catch (err) {
      needUploadFrontend = true
      logger.info('[ChatGPT][PromptGallery] failed to check version, will upload frontend:', err.message)
    }
  }

  if (needUploadFrontend) {
    const fs = await import('fs')
    const filesToUpload = [
      { local: '../../resources/promptGallery/index.html', remote: 'index.html', msg: 'update prompt gallery page' },
      { local: '../../resources/promptGallery/netlify.toml', remote: 'netlify.toml', msg: 'update netlify deploy config' }
    ]
    for (const { local, remote, msg } of filesToUpload) {
      try {
        const localPath = fileURLToPath(new URL(local, import.meta.url))
        if (fs.existsSync(localPath)) {
          const content = fs.readFileSync(localPath).toString('base64')
          // 获取已有文件 SHA（如果存在），用于更新
          let fileSha = null
          try {
            const shaResp = await fetch(`${githubApi}/repos/${repo}/contents/${remote}?ref=${branch}`, { headers })
            if (shaResp.ok) {
              const shaData = await shaResp.json()
              fileSha = shaData.sha
            }
          } catch (_) { /* 文件不存在，首次创建 */ }
          const body = { message: `feat: ${msg}`, content, branch }
          if (fileSha) body.sha = fileSha
          const resp = await fetch(`${githubApi}/repos/${repo}/contents/${remote}`, {
            method: 'PUT',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          })
          if (resp.ok) {
            logger.info(`[ChatGPT][PromptGallery] uploaded ${remote} to repo`)
          } else {
            const errText = await resp.text()
            logger.warn(`[ChatGPT][PromptGallery] failed to upload ${remote}:`, errText)
          }
        }
      } catch (err) {
        logger.warn(`[ChatGPT][PromptGallery] failed to upload ${remote}:`, err.message)
      }
    }

    // 上传/更新 version.json
    try {
      const versionContent = Buffer.from(JSON.stringify({ version: PROMPT_GALLERY_VERSION })).toString('base64')
      let verSha = null
      try {
        const verShaResp = await fetch(`${githubApi}/repos/${repo}/contents/version.json?ref=${branch}`, { headers })
        if (verShaResp.ok) {
          const verShaData = await verShaResp.json()
          verSha = verShaData.sha
        }
      } catch (_) { /* version.json 不存在 */ }
      const verBody = { message: `feat: update gallery version to ${PROMPT_GALLERY_VERSION}`, content: versionContent, branch }
      if (verSha) verBody.sha = verSha
      const verResp = await fetch(`${githubApi}/repos/${repo}/contents/version.json`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(verBody)
      })
      if (verResp.ok) {
        logger.info(`[ChatGPT][PromptGallery] uploaded version.json (v${PROMPT_GALLERY_VERSION}) to repo`)
      } else {
        const errText = await verResp.text()
        logger.warn('[ChatGPT][PromptGallery] failed to upload version.json:', errText)
      }
    } catch (err) {
      logger.warn('[ChatGPT][PromptGallery] failed to upload version.json:', err.message)
    }
  }

  // ===== 第4步：构建 entry 并追加 =====
  const tagsByCategory = {}
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      let categorized = false
      for (const [cat, catTags] of Object.entries(GALLERY_TAG_CATEGORIES)) {
        if (catTags.includes(tag)) {
          if (!tagsByCategory[cat]) tagsByCategory[cat] = []
          tagsByCategory[cat].push(tag)
          categorized = true
          break
        }
      }
      // 自创标签归入 custom 分类
      if (!categorized) {
        if (!tagsByCategory.custom) tagsByCategory.custom = []
        tagsByCategory.custom.push(tag)
      }
    }
  }

  const entry = {
    timestamp: new Date().toISOString(),
    plugin,
    prompt,
    images: resolvedImages,
    tags: tags || [],
    tags_by_category: tagsByCategory
  }

  existingData.push(entry)

  // ===== 第5步：序列化并推送 =====
  let pushContent
  if (password) {
    const jsonStr = JSON.stringify(existingData, null, 2)
    pushContent = Buffer.from(JSON.stringify(encryptGalleryData(jsonStr, password, token, masterKey, keySlots))).toString('base64')
  } else if (masterKey) {
    // 无密码但有 master key：明文数据 + 暴露 master key（前端可解密旧 .enc 图片）
    const dataObj = {
      _encrypted: false,
      _master_key: masterKey.toString('base64'),
      data: existingData
    }
    pushContent = Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64')
  } else {
    // 无密码也无 master key：纯明文数组
    pushContent = Buffer.from(JSON.stringify(existingData, null, 2)).toString('base64')
  }

  const pushUrl = `${githubApi}/repos/${repo}/contents/${filePath}`
  const body = {
    message: `feat: add draw record - ${plugin} ${new Date().toISOString().slice(0, 10)}`,
    content: pushContent,
    branch
  }
  if (sha) body.sha = sha

  const pushResp = await fetch(pushUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!pushResp.ok) {
    const errText = await pushResp.text()
    throw new Error(`Push gallery.json failed ${pushResp.status}: ${errText}`)
  }

  logger.info(`[ChatGPT][PromptGallery] pushed record to ${repo}/${filePath}`)
}
