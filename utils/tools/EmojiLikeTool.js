import { AbstractTool } from './AbstractTool.js'

/** 情感到表情ID的映射 */
const emotionMapping = {
    'happy': [2, 74, 109, 272, 295, 305, 318, 319, 324, 339],
    'proud': [4, 16, 28, 29, 99, 101, 178, 269, 270, 277, 283, 299, 307, 336, 426],
    'shy': [6, 20, 21],
    'sad': [5, 34, 35, 36, 37, 173, 264, 265, 267, 425],
    'conflicted': [106, 176, 262, 263, 270],
    'angry': [11, 26, 31, 105],
    'surprised': [3, 325],
    'confused': [32, 268],
    'pleading': [111, 353],
    'scared': [1, 286],
    'awkward': [100, 306, 342, 344, 347],
    'speechless': [46, 97, 181, 271, 281, 284, 287, 312, 352, 357, 427],
    'disgusted': [19, 59, 323],
    'bored': [8, 25, 285, 293],
    'like': [76],
    'love': [66]
}

/** 智能贴表情 */
export class EmojiLikeTool extends AbstractTool {
    name = 'emojiLike'

    parameters = {
        properties: {
            emotion: {
                type: 'string',
                enum: ['happy', 'proud', 'shy', 'sad', 'conflicted', 'angry', 'surprised', 'confused', 'pleading', 'scared', 'awkward', 'speechless', 'disgusted', 'bored', 'like', 'love'],
                description: 'Emotion to express.'
            },
            messageId: {
                type: 'string',
                description: 'Target message ID. Defaults to referenced/current message.'
            }
        },
        required: ['emotion']
    }

    func = async function (opts, e) {
        let { emotion, messageId } = opts

        if (!emotion) {
            return 'Error: Invalid parameters: emotion is required'
        }

        try {
            // 确定目标消息ID - 优先使用引用消息
            if (!messageId) {
                messageId = e.source_message_id || e.message_id
            }

            // 获取对应情感的表情ID列表
            const emojiPool = emotionMapping[emotion]
            if (!emojiPool || emojiPool.length === 0) {
                return `Error: Unknown emotion: ${emotion}`
            }

            // 随机选择一个表情ID
            const emojiId = emojiPool[Math.floor(Math.random() * emojiPool.length)]

            // 贴表情
            try {
                await e.group.setEmojiLike(messageId, emojiId)
            } catch (err) {
                return 'Error: This bot adapter does not support emoji reactions. 告知用户切换到 https://github.com/AIGC-Yunzai/TRSS-Yunzai-NapC'
            }

            return `Successfully reacted with ${emotion} emotion (emoji ID: ${emojiId}).\n\nIMPORTANT: The emoji reaction has already been added to the message. Do NOT describe or repeat this action in your response. If no extra description needed, just reply <EMPTY> at the next turn.`
        } catch (err) {
            logger.error('[EmojiLikeTool] Error:', err)
            return `Error: Failed to react with emoji: ${err.message || err.stack || String(err)}`
        }
    }

    description = 'React to a message with an emoji based on emotion type. Defaults to referenced message.'
}
