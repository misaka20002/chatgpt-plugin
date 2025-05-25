import fs from 'node:fs'
import path from 'node:path'
import chokidar from 'chokidar'
import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import fetch from 'node-fetch'

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

// 存储共享图片列表的缓存
const sharedPicturesCache = []

// 存储目录监视器
const watchers = new Map()

// 共享图片目录监视器
let sharedPicturesWatcher = null

/**
 * 初始化共享图片目录监视器
 */
function initSharedPicturesWatcher() {
    if (sharedPicturesWatcher) return

    const sharedPicturesDir = path.join(process.cwd(), 'data', 'chatgpt', 'PaimonChuoYiChouPictures')

    // 确保目录存在
    if (!fs.existsSync(sharedPicturesDir)) {
        fs.mkdirSync(sharedPicturesDir, { recursive: true })
    }

    // 递归读取所有图片文件
    function loadSharedPictures(dir) {
        const pictures = []
        try {
            const items = fs.readdirSync(dir, { withFileTypes: true })
            for (const item of items) {
                const fullPath = path.join(dir, item.name)
                if (item.isDirectory()) {
                    // 递归处理子目录
                    pictures.push(...loadSharedPictures(fullPath))
                } else if (item.isFile()) {
                    // 检查是否为图片文件
                    const ext = path.extname(item.name).toLowerCase()
                    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
                        pictures.push(fullPath)
                    }
                }
            }
        } catch (err) {
            logger.error(`[autoEmoticons] 读取共享图片目录失败: ${err}`)
        }
        return pictures
    }

    // 初始加载共享图片
    const initialPictures = loadSharedPictures(sharedPicturesDir)
    sharedPicturesCache.splice(0, sharedPicturesCache.length, ...initialPictures)
    logger.info(`[autoEmoticons] 已加载 ${sharedPicturesCache.length} 个共享图片`)

    // 创建监视器
    sharedPicturesWatcher = chokidar.watch(sharedPicturesDir, {
        persistent: true,
        ignoreInitial: true,
        recursive: true, // 递归监视子目录
        awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 100
        }
    })

    // 监听文件添加事件
    sharedPicturesWatcher.on('add', (filepath) => {
        const ext = path.extname(filepath).toLowerCase()
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
            if (!sharedPicturesCache.includes(filepath)) {
                sharedPicturesCache.push(filepath)
                logger.debug(`[autoEmoticons] 监测到新共享图片: ${path.relative(sharedPicturesDir, filepath)}`)
            }
        }
    })

    // 监听文件删除事件
    sharedPicturesWatcher.on('unlink', (filepath) => {
        const index = sharedPicturesCache.indexOf(filepath)
        if (index > -1) {
            sharedPicturesCache.splice(index, 1)
            logger.debug(`[autoEmoticons] 监测到共享图片删除: ${path.relative(sharedPicturesDir, filepath)}`)
        }
    })

    // 监听错误事件
    sharedPicturesWatcher.on('error', (error) => {
        logger.error(`[autoEmoticons] 共享图片目录监视器错误: ${error}`)
    })
}

/**
 * 获取可用的图片列表（群专属 + 共享图片）
 * @param {string} groupId 群号
 * @returns {Array} 图片路径列表
 */
export function getAvailablePictures(groupId) {
    const groupEmojis = emojiListCache.get(groupId) || []
    const emojiSaveDir = path.join(process.cwd(), 'data', 'chatgpt', 'emoji_save', groupId)

    // 群专属表情的完整路径
    const groupEmojiPaths = groupEmojis.map(filename => path.join(emojiSaveDir, filename))

    // 合并群专属表情和共享图片
    return [...groupEmojiPaths, ...sharedPicturesCache]
}

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
                fnc: this.sendimg.bind(this),
                log: false
            },
        ]
    }

    async autoEmoticonsTrigger(e) {
        this.saveAndSendEmoji(e);
        // 继续执行后续插件
        return false;
    }

    async saveAndSendEmoji(e) {
        if (!Config.autoEmoticons_useEmojiSave) return false
        if (!e.isGroup) return false
        // 检查群号是否在允许列表中（如果配置了特定群号）
        const groupId = String(e.group_id)
        if (Config.autoEmoticons_allowGroups.length > 0 && !Config.autoEmoticons_allowGroups.includes(groupId)) {
            return false
        }

        // 初始化该群的监视器和共享图片监视器
        initWatcher(groupId)
        initSharedPicturesWatcher()

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

                    // 从filename获取图片类型，如果没有则从URL获取或默认使用jpg
                    const imgType = item.filename
                        ? item.filename.split('.').pop()
                        : (item.file.split('.').pop() || 'jpg')
                    const filename = `${fileUnique}.${imgType}`

                    // 检查是否已经保存过此表情
                    if (!emojiList.includes(`${fileUnique}.jpg`) && !emojiList.includes(`${filename}`)) {
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
                        // 保存表情
                        logger.mark(`[autoEmoticons] 保存表情: ${filename}`)

                        // 使用URL下载图片
                        const downloadResult = await downloadImageFile(
                            item.url,
                            `emoji_save/${groupId}/${fileUnique}`,
                            Config.autoEmoticons_maxEmojiSize
                        )

                        if (!downloadResult.success) {
                            logger.error(`[autoEmoticons] 下载表情失败: ${downloadResult.error}`)

                            // 如果是因为文件过大而失败，添加到黑名单
                            if (downloadResult.error && downloadResult.error.includes('文件过大')) {
                                const ONE_MONTH_IN_SECONDS = 30 * 24 * 60 * 60 // 30天的秒数
                                await redis.set(blockKey, '1', {
                                    EX: ONE_MONTH_IN_SECONDS
                                })
                                logger.mark(`[autoEmoticons] 表情文件过大，已加入黑名单: ${fileUnique}，大小: ${downloadResult.size}，30天内不再下载`)
                            }
                            continue
                        }

                        const actualFilename = `${fileUnique}.${downloadResult.actualExt}`
                        logger.mark(`[autoEmoticons] 保存表情成功: ${actualFilename}，大小: ${downloadResult.size} 字节`)


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


        // 随机发送表情包（包含共享图片）
        const availablePictures = getAvailablePictures(groupId)
        if (Math.random() < Config.autoEmoticons_autoEmoticonsReplyRate && availablePictures.length > 0) {
            let msgRet, msgRet_id
            try {
                // 随机选择一个图片
                const randomIndex = Math.floor(Math.random() * availablePictures.length)
                const picturePath = availablePictures[randomIndex]

                // 添加随机延迟
                const delay = randomInt(Config.autoEmoticons_replyDelay_min, Config.autoEmoticons_replyDelay_max)
                logger.debug(`[autoEmoticons] 将在${delay}毫秒后发送图片: ${picturePath}`)
                await sleep(delay)

                // 发送图片
                msgRet = await e.reply(segment.image(picturePath))
                msgRet_id = msgRet.seq || msgRet.data.message_id

                // 存储文件信息（用于删除功能）
                const isSharedPicture = sharedPicturesCache.includes(picturePath)
                const fileInfo = isSharedPicture
                    ? `shared:${path.relative(path.join(process.cwd(), 'data', 'chatgpt', 'PaimonChuoYiChouPictures'), picturePath)}`
                    : path.basename(picturePath)

                redis.set(`Yz:autoEmoticons_sent:pic_filePath:${groupId}:${msgRet_id}`, fileInfo, { EX: 60 * 60 * 24 * 1 })
                logger.info(`[autoEmoticons] 概率发送图片成功: ${picturePath}`)
            } catch (error) {
                logger.error(`[autoEmoticons] 发送图片失败: ${error}`)
            }
        }

        return false
    }

    async sendimg() {
        // 如果表情自动发送功能未开启，则不执行
        if (!Config.autoEmoticons_useEmojiSave) return false;

        // 初始化共享图片监视器
        initSharedPicturesWatcher()

        // 遍历配置的群列表
        for (const groupId of Config.autoEmoticons_allowGroups) {
            try {
                // 使用与手动触发相同的概率判断
                if (Math.random() >= Config.autoEmoticons_autoEmoticonsReplyRate) {
                    logger.debug(`[autoEmoticons] 群 ${groupId} 随机概率未触发发送`);
                    continue;
                }

                // 初始化该群的监视器
                initWatcher(groupId);

                // 获取可用图片列表（群专属 + 共享）
                const availablePictures = getAvailablePictures(groupId)

                // 如果没有可用图片，跳过此群
                if (availablePictures.length === 0) {
                    logger.debug(`[autoEmoticons] 群 ${groupId} 没有可用图片，跳过`);
                    continue;
                }

                // 随机选择一个图片
                const randomIndex = Math.floor(Math.random() * availablePictures.length);
                const picturePath = availablePictures[randomIndex];

                // 添加随机延迟
                const delay = randomInt(Config.autoEmoticons_replyDelay_min, Config.autoEmoticons_replyDelay_max)
                logger.debug(`[autoEmoticons] 将在${delay}毫秒后发送图片: ${picturePath}`)
                await sleep(delay)

                // 发送图片
                try {
                    const group = Bot.pickGroup(parseInt(groupId));
                    if (!group) {
                        logger.error(`[autoEmoticons] 无法获取群 ${groupId} 的实例`);
                        continue;
                    }

                    const msgRet = await group.sendMsg(segment.image(picturePath));
                    const msgId = msgRet.seq || msgRet.message_id;

                    // 存储文件信息
                    const isSharedPicture = sharedPicturesCache.includes(picturePath)
                    const fileInfo = isSharedPicture
                        ? `shared:${path.relative(path.join(process.cwd(), 'data', 'chatgpt', 'PaimonChuoYiChouPictures'), picturePath)}`
                        : path.basename(picturePath)

                    await redis.set(`Yz:autoEmoticons_sent:pic_filePath:${groupId}:${msgId}`, fileInfo, {
                        EX: 60 * 60 * 24 * 1
                    });

                    logger.info(`[autoEmoticons] 定时任务发送图片到群 ${groupId}: ${picturePath}`);
                } catch (error) {
                    logger.error(`[autoEmoticons] 定时任务发送图片到群 ${groupId} 失败: ${error}`);
                }
            } catch (error) {
                logger.error(`[autoEmoticons] 处理群 ${groupId} 定时发送任务出错: ${error}`);
            }
        }

        return false;
    }

    /**
     * 删除表情包（需要修改以支持共享图片）
     */
    async deleteEmoji(e) {
        const groupId = String(e.group_id)
        if (!e.isGroup || !e.isMaster) return false;

        const replyMsgId = e.source?.seq || e.reply_id;
        if (!replyMsgId) {
            return false;
        }

        const fileInfo = await redis.get(`Yz:autoEmoticons_sent:pic_filePath:${groupId}:${replyMsgId}`);
        if (!fileInfo) {
            return false;
        }

        try {
            let filePath;
            let canDelete = true;

            if (fileInfo.startsWith('shared:')) {
                // 共享图片 - 不允许删除
                canDelete = false;
                await e.reply('这是共享图片，不能删除哦~');
            } else {
                // 群专属表情
                filePath = path.join(process.cwd(), 'data', 'chatgpt', 'emoji_save', groupId, fileInfo);
            }

            if (canDelete && filePath && fs.existsSync(filePath)) {
                const filename = path.basename(filePath);
                fs.unlinkSync(filePath);

                const emojiList = emojiListCache.get(groupId) || [];
                const index = emojiList.indexOf(filename);
                if (index > -1) {
                    emojiList.splice(index, 1);
                    emojiListCache.set(groupId, emojiList);
                }

                let res = await e.group.recallMsg(replyMsgId)
                if (!res) {
                    this.reply("人家不是管理员，不能撤回超过2分钟的消息呢~")
                }

                await e.reply(`呜呜呜~人家错了，以后不发了~呜`);
            }

            await redis.del(`Yz:autoEmoticons_sent:pic_filePath:${groupId}:${replyMsgId}`);
        } catch (error) {
            logger.error(`[autoEmoticons] 删除表情失败: ${error}`);
        }

        return true;
    }

}

/**
 * 根据文件头信息判断图片格式
 * @param {Buffer} buffer 文件缓冲区
 * @returns {string} 图片扩展名
 */
function getImageTypeFromBuffer(buffer) {
    if (!buffer || buffer.length < 8) return 'jpg'

    // JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'jpg'
    }

    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return 'png'
    }

    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return 'gif'
    }

    // WebP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'webp'
    }

    // BMP
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
        return 'bmp'
    }

    // 默认返回 jpg
    return 'jpg'
}

/**
 * 下载文件并自动识别图片格式
 * @param {string} url 下载链接
 * @param {string} relativePath 相对路径（不包含扩展名）
 * @param {number} maxSize 最大文件大小（字节），可选
 * @returns {Promise<{success: boolean, filePath: string, actualExt: string, size: number, error?: string}>}
 */
export async function downloadImageFile(url, relativePath, maxSize = null) {
    try {
        // 首先发送 HEAD 请求检查文件大小
        let contentLength = null
        try {
            const headResponse = await fetch(url, {
                method: 'HEAD',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            if (headResponse.ok && headResponse.headers.has('content-length')) {
                contentLength = parseInt(headResponse.headers.get('content-length'))

                // 如果指定了最大大小且文件超过限制，直接返回错误
                if (maxSize && contentLength > maxSize) {
                    return {
                        success: false,
                        filePath: null,
                        actualExt: null,
                        size: contentLength,
                        error: `文件过大: ${contentLength} 字节，超过限制 ${maxSize} 字节`
                    }
                }

                logger.debug(`[downloadImageFile] 文件大小检查通过: ${contentLength} 字节`)
            } else {
                logger.debug(`[downloadImageFile] 无法获取文件大小，继续下载`)
            }
        } catch (headError) {
            logger.debug(`[downloadImageFile] HEAD 请求失败，继续下载: ${headError.message}`)
        }

        // 下载文件
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
        }

        const buffer = await response.arrayBuffer()
        const bufferData = Buffer.from(buffer)

        // 二次检查：如果 HEAD 请求没有返回大小，在下载后再次检查
        if (maxSize && bufferData.length > maxSize) {
            return {
                success: false,
                filePath: null,
                actualExt: null,
                size: bufferData.length,
                error: `下载后发现文件过大: ${bufferData.length} 字节，超过限制 ${maxSize} 字节`
            }
        }

        // 根据文件头判断真实格式
        const actualExt = getImageTypeFromBuffer(bufferData)

        // 构建完整文件路径
        const baseDir = path.join(process.cwd(), 'data', 'chatgpt')
        const fullPath = path.join(baseDir, `${relativePath}.${actualExt}`)

        // 确保目录存在
        const dir = path.dirname(fullPath)
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }

        // 写入文件
        fs.writeFileSync(fullPath, bufferData)

        return {
            success: true,
            filePath: fullPath,
            actualExt: actualExt,
            size: bufferData.length
        }
    } catch (error) {
        logger.error(`[downloadImageFile] 下载失败: ${error}`)
        return {
            success: false,
            filePath: null,
            actualExt: null,
            size: 0,
            error: error.message
        }
    }
}
