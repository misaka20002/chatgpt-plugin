import fs from 'node:fs'
import path from 'node:path'
import chokidar from 'chokidar'
import { downloadFile } from '../utils/common.js'
import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { json } from 'node:stream/consumers'

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
//     allowGroups: ["1111"],
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
            ],
        })
        this.task = [
            {
                // 每5分钟执行一次
                cron: '0 */5 * * * *',
                name: '自动表情包-发送表情',
                fnc: this.sendimg.bind(this)
            },
        ]
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
        const groupId = String(e.group_id)
        if (!e.isGroup || !e.isMaster) return false;

        // 获取回复的消息ID
        const replyMsgId = e.source?.seq || e.reply_id;
        if (!replyMsgId) {
            // await e.reply('请回复要删除的表情消息~');
            return false;
        }

        // 从Redis获取表情文件路径
        const emojiPath = await redis.get(`Yz:autoEmoticons_sent:pic_filePath:${groupId}:${replyMsgId}`);
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
                const emojiList = emojiListCache.get(groupId) || [];
                const index = emojiList.indexOf(filename);
                if (index > -1) {
                    emojiList.splice(index, 1);
                    emojiListCache.set(groupId, emojiList);
                }

                let res = await e.group.recallMsg(m.message_id)
                if (!res) {
                    this.reply("人家不是管理员，不能撤回超过2分钟的消息呢~")
                }

                // 删除Redis记录
                await redis.del(`Yz:autoEmoticons_sent:pic_filePath:${groupId}:${replyMsgId}`);

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
        if (!Config.autoEmoticons_useEmojiSave) return false
        if (!e.isGroup) return false
        // 检查群号是否在允许列表中（如果配置了特定群号）
        const groupId = String(e.group_id)
        if (Config.autoEmoticons_allowGroups.length > 0 && !Config.autoEmoticons_allowGroups.includes(groupId)) {
            return false
        }

        // 初始化该群的监视器
        initWatcher(groupId)

        // 获取表情保存目录路径
        const emojiSaveDir = path.join(process.cwd(), 'data', 'chatgpt', 'emoji_save', `${groupId}`)

        // 从缓存获取表情列表
        const emojiList = emojiListCache.get(groupId) || []

        // 处理消息中的图片
        for (const item of e.message) {
            if (item.type === 'image') {
                // 检查图片大小，如果没有file_size字段则直接处理
                if (item.file_size && item.file_size >= Config.autoEmoticons_maxEmojiSize) continue

                // 获取图片唯一ID - 优先使用filename字段
                const fileUnique = item.filename
                    ? item.filename.split('.')[0]
                    : item.file.split('/').pop().split('.')[0] || item.url.split('/').pop().split('.')[0]

                try {
                    // 检查是否在黑名单中（过大的图片不再下载）
                    const blockKey = `Yz:autoEmoticons:blocked:${fileUnique}`
                    const isBlocked = await redis.get(blockKey)
                    if (isBlocked) {
                        logger.debug(`[autoEmoticons] 不下载已知过大的表情/图片: ${fileUnique}`)
                        continue
                    }

                    // 检查是否已经保存过此表情
                    if (!emojiList.includes(`${fileUnique}.jpg`) && !emojiList.includes(`${fileUnique}.png`) && !emojiList.includes(`${fileUnique}.gif`)) {
                        let canBeStored = false
                        // 检查Redis中是否已有记录
                        const redisKey = `Yz:autoEmoticons:${groupId}:${fileUnique}`
                        const currentCount = await redis.get(redisKey)

                        if (!currentCount) {
                            // 首次发现，设置为1并设置过期时间
                            await redis.set(redisKey, '1', {
                                EX: Config.autoEmoticons_expireTimeInSeconds
                            })
                            logger.debug(`[autoEmoticons] 表情首次出现: ${fileUnique} (1/${Config.autoEmoticons_confirmCount})`)
                        } else {
                            // 增加计数
                            const newCount = parseInt(currentCount) + 1
                            await redis.set(redisKey, String(newCount), {
                                EX: Config.autoEmoticons_expireTimeInSeconds
                            })

                            // 检查是否达到保存阈值
                            if (newCount >= Config.autoEmoticons_confirmCount) {
                                // 达到指定次数，可以保存
                                await redis.del(redisKey)
                                canBeStored = true
                                logger.debug(`[autoEmoticons] 已达到确认次数: ${fileUnique} (${Config.autoEmoticons_confirmCount}/${Config.autoEmoticons_confirmCount})`)
                            } else {
                                logger.debug(`[autoEmoticons] 表情再次出现: ${fileUnique} (${newCount}/${Config.autoEmoticons_confirmCount})`)
                            }
                        }

                        if (!canBeStored) continue

                        // 从filename获取图片类型，如果没有则从URL获取或默认使用jpg
                        const imgType = item.filename
                            ? item.filename.split('.').pop()
                            : (item.file.split('.').pop() || 'jpg')
                        const filename = `${fileUnique}.${imgType}`
                        // 保存表情
                        logger.mark(`[autoEmoticons] 保存表情: ${filename}`)

                        // 使用URL下载图片
                        await downloadFile(item.url, `emoji_save/${groupId}/${filename}`)

                        // 下载后检查文件大小
                        const filePath = path.join(process.cwd(), 'data', 'chatgpt', `emoji_save/${groupId}/${filename}`)
                        const ONE_MONTH_IN_SECONDS = 3 * 24 * 60 * 60 // 3天的秒数

                        try {
                            const stats = fs.statSync(filePath)
                            if (stats.size > Config.autoEmoticons_maxEmojiSize) {
                                // 文件太大，删除它
                                fs.unlinkSync(filePath)
                                // 设置redis记录防止重复下载
                                await redis.set(blockKey, '1', {
                                    EX: ONE_MONTH_IN_SECONDS
                                })
                                logger.mark(`[autoEmoticons] 表情文件过大已删除: ${filename}，大小: ${stats.size}，一个月内不再下载`)
                                continue
                            }
                        } catch (err) {
                            logger.error(`[autoEmoticons] 检查文件大小失败: ${err}`)
                        }

                        // 控制表情数量
                        if (emojiList.length > Config.autoEmoticons_maxEmojiCount) {
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
        if (Math.random() < Config.autoEmoticons_autoEmoticonsReplyRate && emojiList.length > 0) {
            let msgRet, msgRet_id
            try {
                // 随机选择一个表情
                const randomIndex = Math.floor(Math.random() * emojiList.length)
                const emojiPath = path.join(emojiSaveDir, emojiList[randomIndex])

                // 添加随机延迟
                const delay = randomInt(Config.autoEmoticons_replyDelay_min, Config.autoEmoticons_replyDelay_max)
                logger.debug(`[autoEmoticons] 将在${delay}毫秒后发送表情: ${emojiList[randomIndex]}`)
                await sleep(delay)

                // 发送表情
                msgRet = await e.reply(segment.image(emojiPath))
                msgRet_id = msgRet.seq || msgRet.data.message_id
                redis.set(`Yz:autoEmoticons_sent:pic_filePath:${groupId}:${msgRet_id}`, emojiPath, { EX: 60 * 60 * 24 * 3 }); // 储存3天
                logger.debug(`[autoEmoticons] 发送表情成功: ${emojiList[randomIndex]}`)
            } catch (error) {
                logger.error(`[autoEmoticons] 发送表情失败: ${error}`)
            }
        }

        return false
    }

    async sendimg() {
        // 如果表情自动发送功能未开启，则不执行
        if (!Config.autoEmoticons_useEmojiSave) return false;

        // 遍历配置的群列表
        for (const groupId of Config.autoEmoticons_allowGroups) {
            try {
                // 使用与手动触发相同的概率判断
                if (Math.random() >= Config.autoEmoticons_autoEmoticonsReplyRate) {
                    logger.debug(`[autoEmoticons] 群 ${groupId} 随机概率未触发发送`);
                    continue;
                }

                // 初始化该群的监视器（确保表情列表已加载）
                initWatcher(groupId);

                // 获取该群的表情列表
                const emojiList = emojiListCache.get(groupId) || [];

                // 如果没有表情，跳过此群
                if (emojiList.length === 0) {
                    logger.debug(`[autoEmoticons] 群 ${groupId} 没有可用表情，跳过`);
                    continue;
                }

                // 获取表情保存目录路径
                const emojiSaveDir = path.join(process.cwd(), 'data', 'chatgpt', 'emoji_save', groupId);

                // 随机选择一个表情
                const randomIndex = Math.floor(Math.random() * emojiList.length);
                const emojiFile = emojiList[randomIndex];
                const emojiPath = path.join(emojiSaveDir, emojiFile);

                // 发送表情
                try {
                    // 使用Bot API发送
                    const group = Bot.pickGroup(parseInt(groupId));
                    if (!group) {
                        logger.error(`[autoEmoticons] 无法获取群 ${groupId} 的实例`);
                        continue;
                    }

                    // 发送表情
                    const msgRet = await group.sendMsg(segment.image(emojiPath));
                    const msgId = msgRet.seq || msgRet.message_id;

                    // 记录发送的表情路径
                    await redis.set(`Yz:autoEmoticons_sent:pic_filePath:${groupId}:${msgId}`, emojiPath, {
                        EX: 60 * 60 * 24 * 3  // 储存3天
                    });

                    logger.debug(`[autoEmoticons] 定时任务发送表情到群 ${groupId}: ${emojiFile}`);
                } catch (error) {
                    logger.error(`[autoEmoticons] 定时任务发送表情到群 ${groupId} 失败: ${error}`);
                }
            } catch (error) {
                logger.error(`[autoEmoticons] 处理群 ${groupId} 定时发送任务出错: ${error}`);
            }
        }

        return false;
    }
}
