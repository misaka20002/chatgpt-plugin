import fs from 'node:fs'
import path from 'node:path'
import chokidar from 'chokidar'
import { downloadFile } from '../utils/common.js'
import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'

// 表情包配置
// const Config.autoEmoticonsConfig = {
//     // 是否启用表情保存
//     useEmojiSave: true,
//     // 表情过期时间（秒）- 在此时间内发送多次才会被保存
//     expireTimeInSeconds: 259200, // 3天
//     // 需要确认的次数 - 在过期时间内发送多少次才保存表情包
//     confirmCount: 3, // 默认是3次，可以设置为更高的值
//     // 默认发送偷取表情的概率
//     autoEmoticonsReplyRate: 0.05, // 每次消息有5%的概率发送表情包
//     // 表情包最大数量
//     maxEmojiCount: 100,
//     // 表情包大小限制 (字节)
//     maxEmojiSize: 100000,
//     // 需要保存表情包的群号列表，为空数组时表示所有群
//     allowGroups: [1111],
//     // 发送表情时的延迟 (毫秒)
//     replyDelay: {
//         min: 1000,
//         max: 5000
//     }
// }

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

// 存储各群表情列表的缓存
const emojiListCache = new Map()

// 存储目录监视器
const watchers = new Map()

/**
 * 初始化表情目录监视器
 * @param {string} groupId 群号
 */
function initWatcher(groupId) {
    // 如果已有监视器，则返回
    if (watchers.has(groupId)) return

    const emojiSaveDir = path.join(process.cwd(), 'data', 'chatgpt', 'emoji_save', `${groupId}`)

    // 确保目录存在
    if (!fs.existsSync(emojiSaveDir)) {
        fs.mkdirSync(emojiSaveDir, { recursive: true })
    }

    // 初始化表情列表缓存
    if (!emojiListCache.has(groupId)) {
        emojiListCache.set(groupId, [])
    }

    // 读取初始表情列表
    try {
        const files = fs.readdirSync(emojiSaveDir)
        emojiListCache.set(groupId, files)
        logger.info(`[autoEmoticons] 已加载群 ${groupId} 的 ${files.length} 个表情`)
    } catch (err) {
        logger.error(`[autoEmoticons] 读取表情目录失败: ${err}`)
    }

    // 创建监视器
    const watcher = chokidar.watch(emojiSaveDir, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 100
        }
    })

    // 监听文件添加事件
    watcher.on('add', (filepath) => {
        const filename = path.basename(filepath)
        const emojiList = emojiListCache.get(groupId) || []
        if (!emojiList.includes(filename)) {
            emojiList.push(filename)
            emojiListCache.set(groupId, emojiList)
            logger.debug(`[autoEmoticons] 监测到新表情: ${filename}`)
        }
    })

    // 监听文件删除事件
    watcher.on('unlink', (filepath) => {
        const filename = path.basename(filepath)
        const emojiList = emojiListCache.get(groupId) || []
        const index = emojiList.indexOf(filename)
        if (index > -1) {
            emojiList.splice(index, 1)
            emojiListCache.set(groupId, emojiList)
            logger.debug(`[autoEmoticons] 监测到表情删除: ${filename}`)
        }
    })

    // 监听错误事件
    watcher.on('error', (error) => {
        logger.error(`[autoEmoticons] 目录监视器错误: ${error}`)
    })

    // 保存监视器
    watchers.set(groupId, watcher)
}

/**
 * 自动表情包插件
 */
export class autoEmoticons extends plugin {
    constructor() {
        super({
            name: '自动表情包',
            dsc: '自动保存群聊中多次出现的图片作为表情包，并随机发送',
            event: 'message.group',
            priority: 5000,
            rule: [
                {
                    reg: '',
                    fnc: 'autoEmoticonsTrigger',
                    log: false
                },
                {
                    reg: '^#?(哒|达)咩$',
                    fnc: 'deleteEmoji',
                }
            ]
        })
    }

    async autoEmoticonsTrigger(e) {
        this.saveAndSendEmoji(e);
        // 继续执行后续插件
        return false;
    }

    /**
     * 删除表情包
     * @param {*} e 
     * @returns 
     */
    async deleteEmoji(e) {
        if (!e.isGroup || !e.isMaster) return false;

        // 获取回复的消息ID
        const replyMsgId = e.source?.seq || e.reply_id;
        if (!replyMsgId) {
            // await e.reply('请回复要删除的表情消息~');
            return false;
        }

        // 从Redis获取表情文件路径
        const emojiPath = await redis.get(`Yz:autoEmoticons_sent:pic_filePath:${e.group_id}:${replyMsgId}`);
        if (!emojiPath) {
            // await e.reply('找不到这个表情或者已经过期了哦~');
            return false;
        }

        try {
            // 检查文件是否存在
            if (fs.existsSync(emojiPath)) {
                // 获取文件名
                const filename = path.basename(emojiPath);

                // 删除文件
                fs.unlinkSync(emojiPath);

                // 从缓存中删除
                const emojiList = emojiListCache.get(e.group_id) || [];
                const index = emojiList.indexOf(filename);
                if (index > -1) {
                    emojiList.splice(index, 1);
                    emojiListCache.set(e.group_id, emojiList);
                }

                let res = await e.group.recallMsg(m.message_id)
                if (!res) {
                    this.reply("人家不是管理员，不能撤回超过2分钟的消息呢~")
                }

                // 删除Redis记录
                await redis.del(`Yz:autoEmoticons_sent:pic_filePath:${e.group_id}:${replyMsgId}`);

                await e.reply(`呜呜呜~人家错了，以后不发了~呜`);
                // logger.info(`[autoEmoticons] 表情已删除: ${filename}`);
            } else {
                // await e.reply('表情文件不存在，可能已被删除~');
            }
        } catch (error) {
            logger.error(`[autoEmoticons] 删除表情失败: ${error}`);
            // await e.reply('删除表情失败，请查看日志~');
        }

        return true;
    }

    async saveAndSendEmoji(e) {
        if (!Config.autoEmoticonsConfig.useEmojiSave) return false
        if (!e.isGroup) return false

        // 检查群号是否在允许列表中（如果配置了特定群号）
        if (Config.autoEmoticonsConfig.allowGroups.length > 0 && !Config.autoEmoticonsConfig.allowGroups.includes(e.group_id)) {
            return false
        }

        // 初始化该群的监视器
        initWatcher(e.group_id)

        // 获取表情保存目录路径
        const emojiSaveDir = path.join(process.cwd(), 'data', 'chatgpt', 'emoji_save', `${e.group_id}`)

        // 从缓存获取表情列表
        const emojiList = emojiListCache.get(e.group_id) || []

        // 处理消息中的图片
        for (const item of e.message) {
            if (item.type === 'image' && item.size < Config.autoEmoticonsConfig.maxEmojiSize) {
                // 获取图片唯一ID
                const fileUnique = item.file.split('.')[0] || item.url.split('/').pop().split('.')[0]

                try {
                    // 检查是否已经保存过此表情
                    if (!emojiList.includes(`${fileUnique}.jpg`) && !emojiList.includes(`${fileUnique}.png`)) {
                        let canBeStored = false

                        // 检查Redis中是否已有记录
                        const redisKey = `Yz:autoEmoticons:${e.group_id}:${fileUnique}`
                        const currentCount = await redis.get(redisKey)

                        if (!currentCount) {
                            // 首次发现，设置为1并设置过期时间
                            await redis.set(redisKey, '1', {
                                EX: Config.autoEmoticonsConfig.expireTimeInSeconds
                            })
                            logger.debug(`[autoEmoticons] 表情首次出现: ${fileUnique} (1/${Config.autoEmoticonsConfig.confirmCount})`)
                        } else {
                            // 增加计数
                            const newCount = parseInt(currentCount) + 1
                            await redis.set(redisKey, String(newCount), {
                                EX: Config.autoEmoticonsConfig.expireTimeInSeconds
                            })

                            // 检查是否达到保存阈值
                            if (newCount >= Config.autoEmoticonsConfig.confirmCount) {
                                // 达到指定次数，可以保存
                                await redis.del(redisKey)
                                canBeStored = true
                                logger.debug(`[autoEmoticons] 已达到确认次数: ${fileUnique} (${Config.autoEmoticonsConfig.confirmCount}/${Config.autoEmoticonsConfig.confirmCount})`)
                            } else {
                                logger.debug(`[autoEmoticons] 表情再次出现: ${fileUnique} (${newCount}/${Config.autoEmoticonsConfig.confirmCount})`)
                            }
                        }

                        if (!canBeStored) continue

                        // 保存表情
                        logger.info(`[autoEmoticons] 保存表情: ${fileUnique}`)
                        const imgType = item.file.split('.').pop() || 'jpg'
                        const filename = `${fileUnique}.${imgType}`

                        await downloadFile(item.url, `emoji_save/${e.group_id}/${filename}`)


                        // 控制表情数量
                        if (emojiList.length > Config.autoEmoticonsConfig.maxEmojiCount) {
                            const randomIndex = Math.floor(Math.random() * emojiList.length)
                            const fileToDelete = emojiList[randomIndex]
                            try {
                                fs.unlinkSync(path.join(emojiSaveDir, fileToDelete))
                                logger.debug(`[autoEmoticons] 表情数量过多，删除: ${fileToDelete}`)
                            } catch (err) {
                                logger.error(`[autoEmoticons] 删除表情失败: ${err}`)
                            }
                        }
                    }
                } catch (error) {
                    logger.error(`[autoEmoticons] 处理表情出错: ${error}`)
                }
            }
        }

        // 随机发送表情包
        if (Math.random() < Config.autoEmoticonsConfig.autoEmoticonsReplyRate && emojiList.length > 0) {
            let msgRet, msgRet_id
            try {
                // 随机选择一个表情
                const randomIndex = Math.floor(Math.random() * emojiList.length)
                const emojiPath = path.join(emojiSaveDir, emojiList[randomIndex])

                // 添加随机延迟
                const delay = randomInt(Config.autoEmoticonsConfig.replyDelay.min, Config.autoEmoticonsConfig.replyDelay.max)
                logger.debug(`[autoEmoticons] 将在${delay}毫秒后发送表情: ${emojiList[randomIndex]}`)
                await sleep(delay)

                // 发送表情
                msgRet = await e.reply(segment.image(emojiPath))
                msgRet_id = msgRet.seq || msgRet.data.message_id
                redis.set(`Yz:autoEmoticons_sent:pic_filePath:${e.group_id}:${msgRet_id}`, emojiPath, { EX: 60 * 60 * 24 * 3 }); // 储存3天
                logger.debug(`[autoEmoticons] 发送表情成功: ${emojiList[randomIndex]}`)
            } catch (error) {
                logger.error(`[autoEmoticons] 发送表情失败: ${error}`)
            }
        }

        return false
    }
}
