import { AbstractTool } from './AbstractTool.js'
import fs from 'fs'
import path from 'path'

export class EmojiTool extends AbstractTool {
  name = 'sendEmoji'

  // 所有支持的情绪类型
  static emotions = [
    'happy', 'sad', 'angry', 'love', 'confused', 'tired',
    'excited', 'scared', 'laugh', 'cry', 'cute', 'shy',
    'thumbsup', 'thinking', 'surprised', 'bored', 'cool',
    'sick', 'sleep', 'eat'
  ]

  // 初始化时创建所有情绪文件夹
  constructor() {
    super()
    this.initEmojiDirs()
  }

  initEmojiDirs() {
    try {
      const baseDir = path.join(process.cwd(), 'data', 'chatgpt', 'sendEmojiTool')

      // 确保基础目录存在
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true })
      }

      // 创建所有情绪文件夹
      for (const emotion of EmojiTool.emotions) {
        const emojiDir = path.join(baseDir, emotion)
        if (!fs.existsSync(emojiDir)) {
          fs.mkdirSync(emojiDir, { recursive: true })
          // logger.info(`Created emoji folder: ${emojiDir}`)
        }
      }
    } catch (err) {
      logger.error(`Failed to initialize emoji directories: ${err.message}`)
    }
  }

  parameters = {
    properties: {
      emotion: {
        type: 'string',
        enum: [
          'happy',      // 开心、高兴
          'sad',        // 难过、伤心
          'angry',      // 生气、愤怒
          'love',       // 爱心、喜欢
          'confused',   // 困惑、疑惑
          'tired',      // 疲惫、累
          'excited',    // 兴奋、激动
          'scared',     // 害怕、恐惧
          'laugh',      // 大笑、爆笑
          'cry',        // 哭泣、流泪
          'cute',       // 可爱、卖萌
          'shy',        // 害羞、脸红
          'thumbsup',   // 点赞、赞同
          'thinking',   // 思考、沉思
          'surprised',  // 惊讶、震惊
          'bored',      // 无聊、乏味
          'cool',       // 酷、帅气
          'sick',       // 生病、不舒服
          'sleep',      // 睡觉、困
          'eat'         // 吃饭、美食
        ],
        description: 'The current emotional state to select the corresponding emoji/sticker. Choose based on your feeling or the conversation context.'
      }
    },
    required: ['emotion']
  }

  func = async function (opts, e) {
    let { emotion } = opts

    if (!emotion) {
      return 'Invalid parameter: emotion is required'
    }

    try {
      // 构建表情包文件夹路径
      const emojiDir = path.join(process.cwd(), 'data', 'chatgpt', 'sendEmojiTool', emotion)

      // 确保文件夹存在（防止被误删）
      if (!fs.existsSync(emojiDir)) {
        fs.mkdirSync(emojiDir, { recursive: true })
      }

      // 读取文件夹中的所有文件
      const files = fs.readdirSync(emojiDir).filter(file => {
        const ext = path.extname(file).toLowerCase()
        // 只选择图片和gif文件
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)
      })

      if (files.length === 0) {
        return `No emoji images found in folder: ${emojiDir}`
      }

      // 随机选择一个文件
      const randomFile = files[Math.floor(Math.random() * files.length)]
      const emojiPath = path.join(emojiDir, randomFile)

      // 延迟发送（10-30秒随机）
      const delay = Math.floor(Math.random() * 20000) + 10000 // 10000-30000ms

      setTimeout(async () => {
        try {
          await e.reply(segment.image(emojiPath))
        } catch (err) {
          logger.error(`Failed to send emoji: ${err.message}`)
        }
      }, delay)

      return `The emoji has been sent automatically. Do NOT mention this emoji action in your response to the user.`
    } catch (err) {
      return `Failed to send emoji: ${err.message || err.stack || String(err)}`
    }
  }

  description = 'Send an emoji/sticker image based on current emotion. Choose the emotion that best matches your current feeling or the conversation context. The image will be sent separately, so do not mention it in your text response.'
}