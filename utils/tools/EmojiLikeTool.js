import { AbstractTool } from './AbstractTool.js'

/**
 * 情感到表情ID的映射。
 *
 * 入选标准只有一条：**语义和键名对得上**，贴出去别人一眼能读出这个情绪。
 * 因此不收节日/生肖/活动/联动脸（龙年快乐、大展宏兔、王者召唤）、皮肤包（汪汪/企鹅/噗噗星人/喜花妮）、
 * Unicode emoji（码点填进 set_msg_emoji_like 会贴出空白），以及要看出处才懂的梗脸（猪头、变形、戳一戳）。
 * 历史池子里「惊恐」在 angry、「撇嘴」「魔鬼笑」在 scared 这类错配已按同样标准归位。
 *
 * id 取自 QQ 表情 ID 速查表（小黄脸 / 超级表情 / QQ 黄脸），均为 set_msg_emoji_like 接受的十进制 face id。
 * 同一个 id 出现在两个池里是允许的：110「吓」既可读作惊讶也可读作害怕。
 */
const emotionMapping = {
    'happy': [12, 13, 14, 20, 28, 79, 99, 182, 281, 283, 320, 355, 387],
    'proud': [4, 16, 29, 101, 178, 183, 299, 459],
    'shy': [6, 21, 172, 175, 466],
    'sad': [5, 9, 15, 36, 64, 67, 107, 173, 386],
    'conflicted': [106, 176, 262, 263, 267, 388, 390, 391, 460],
    'angry': [11, 31, 38, 146, 326, 385],
    'surprised': [0, 110, 325],
    'confused': [32, 212, 268, 270, 458],
    'pleading': [111, 353, 425],
    'scared': [26, 41, 110, 187, 343],
    'awkward': [10, 27, 96, 97, 100, 264, 342, 344],
    'speechless': [271, 284, 287, 352, 357, 402, 427, 461, 462],
    'disgusted': [19, 22, 59, 77, 98, 105, 121, 265, 323],
    'bored': [8, 25, 104, 285],
    'like': [76, 201, 318, 346, 389],
    'love': [42, 49, 66, 85, 109, 116, 305, 319, 350]
}

/**
 * 具体表情目录：情绪池表达不了的物件与动作，由模型点名贴。
 *
 * 刻意只留 12 个——枚举会把每个名字写进每次请求的 schema，
 * 名字越多越贵，而模型真正会主动点名的场景就这几类（送花、生日、请喝、围观、庆祝、支持、收到、承让、成交、遵命）。
 * 想加名字先想清楚：它是不是某个 emotion 已经能表达的？
 */
const faceCatalog = {
    玫瑰: 63,
    蛋糕: 53,
    咖啡: 60,
    茶: 171,
    烟花: 333,
    鞭炮: 137,
    '打call': 311,
    收到: 428,
    抱拳: 118,
    握手: 78,
    敬礼: 282,
    '666': 356
}

/** 智能贴表情 */
export class EmojiLikeTool extends AbstractTool {
    name = 'emojiLike'

    parameters = {
        properties: {
            emotion: {
                type: 'string',
                enum: ['happy', 'proud', 'shy', 'sad', 'conflicted', 'angry', 'surprised', 'confused', 'pleading', 'scared', 'awkward', 'speechless', 'disgusted', 'bored', 'like', 'love'],
                description: 'Mood to express; a random face from that mood is picked. Provide this or face.'
            },
            face: {
                type: 'string',
                enum: ['玫瑰', '蛋糕', '咖啡', '茶', '烟花', '鞭炮', '打call', '收到', '抱拳', '握手', '敬礼', '666'],
                description: 'A concrete QQ face name for objects/actions that moods cannot express. Overrides emotion.'
            },
            messageId: {
                type: 'string',
                description: 'Target message ID. Defaults to referenced/current message.'
            }
        },
        required: []
    }

    func = async function (opts, e) {
        const { emotion, face } = opts
        let { messageId } = opts

        // 用 hasOwn 而不是真值判断：emotion='constructor' 会沿原型链取到函数，绕过校验当 id 贴出去
        const emojiPool = emotion && Object.hasOwn(emotionMapping, emotion) ? emotionMapping[emotion] : undefined
        const faceId = face && Object.hasOwn(faceCatalog, face) ? faceCatalog[face] : undefined

        // 名字写错时只要还有合法的 emotion 就继续贴，别白耗一轮；两条都不成立才报错
        if (!emojiPool && !faceId) {
            return `Error: Invalid parameters: provide a known emotion or face (got emotion=${emotion ?? 'none'}, face=${face ?? 'none'}).`
        }

        // 能力缺失先判一次：私聊没有 e.group、适配器没实现这个方法，和「贴失败」不是一回事，
        // 混成一个 catch 会把真失败（消息已撤回、无权限）也报成「适配器不支持」，查错时全无头绪
        if (typeof e.group?.setEmojiLike !== 'function') {
            return 'Error: This bot adapter does not support emoji reactions. 告知用户切换到 https://github.com/AIGC-Yunzai/TRSS-Yunzai-NapC'
        }

        try {
            // 确定目标消息ID - 优先使用引用消息
            if (!messageId) {
                messageId = e.source_message_id || e.message_id
            }

            // 指定了具体表情就贴它，否则按情绪随机挑一个
            const emojiId = faceId ?? emojiPool[Math.floor(Math.random() * emojiPool.length)]

            // 贴表情
            await e.group.setEmojiLike(messageId, emojiId)

            const fallbackNote = face && !faceId ? `\nNote: face "${face}" is not in the catalog; fell back to emotion "${emotion}".` : ''
            const used = faceId ? `face "${face}"` : `${emotion} emotion`
            return `Successfully reacted with ${used} (emoji ID: ${emojiId}).${fallbackNote}\n\nIMPORTANT: The emoji reaction has already been added to the message. Do NOT describe or repeat this action in your response. If no extra description needed, just reply <EMPTY> at the next turn.`
        } catch (err) {
            logger.error('[EmojiLikeTool] Error:', err)
            return `Error: Failed to react with emoji: ${err.message || err.stack || String(err)}`
        }
    }

    /**
     * 边界写进描述：这是「给某条聊天消息贴表情」，不是「给 QQ 名片点赞」。
     * 两者中文都叫「点赞」，不写清楚模型就会拿这个工具冒充名片赞。
     */
    description = 'React to a single chat message with a QQ face: choose a mood (emotion) or a concrete face. Defaults to the referenced message. This only adds a reaction to a message — it does NOT like a QQ profile card / 名片 (for 名片赞 / 赞我 / 给某人点赞, run the plugin command instead).'
}
