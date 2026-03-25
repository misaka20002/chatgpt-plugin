import plugin from '../../../lib/plugins/plugin.js';
import { Config } from '../utils/config.js'
import { chatgpt } from './chat.js';
import { getUserData } from '../utils/common.js';

export class ScheduleTaskPlugin extends plugin {
    constructor(e) {
        super({
            name: 'ChatGPT-定时任务执行器',
            dsc: '读取Redis定时任务并在提前一分钟时执行',
            event: 'message',
            priority: 500,
            rule: []
        })

        // 配置定时任务
        this.task = [
            {
                cron: Config.ScheduleTask_Tool ? '0 * * * * *' : "0 0 1 1 * *",
                name: 'Check_LLM_Scheduled_Tasks',
                fnc: this.checkAndExecuteTasks.bind(this),
                log: false
            }
        ]
    }

    async checkAndExecuteTasks() {
        try {
            const now = Date.now()
            const targetTime = now + 60 * 1000
            const redisKey = 'CHATGPT:ScheduledTasks'

            // 过期任务清理逻辑
            const expireThreshold = now - 10 * 60 * 1000;
            const removedCount = await redis.zRemRangeByScore(redisKey, 0, expireThreshold);
            if (removedCount > 0) {
                logger.mark(`[ChatGPT-定时任务] 自动清理了 ${removedCount} 个因bug或离线未执行的过期积压任务`);
            }

            // 获取定时任务
            const tasks = await redis.zRangeByScore(redisKey, expireThreshold, targetTime)
            if (!tasks || tasks.length === 0) {
                return;
            }

            for (const taskJson of tasks) {
                let taskData;
                try {
                    taskData = JSON.parse(taskJson);
                } catch (err) {
                    await redis.zRem(redisKey, taskJson);
                    continue;
                }

                // 成功解析后立即从 Redis 移除该任务
                await redis.zRem(redisKey, taskJson);

                // 【修改1】兼容旧数据，判断是群聊还是私聊
                const isGroup = taskData.isGroup !== undefined ? taskData.isGroup : !!taskData.group_id;

                // 主动构建完整的 mockE，包含 sender 对象
                let mockE = {
                    self_id: taskData.bot_id,
                    user_id: taskData.user_id,
                    post_type: 'message',
                    // 【修改2】动态设定消息类型
                    message_type: isGroup ? 'group' : 'private',
                    isGroup: isGroup,
                    isPrivate: !isGroup,
                    isMaster: taskData.isMaster,
                    sender: {
                        user_id: taskData.user_id,
                        nickname: taskData.nickname || '定时任务'
                    },
                    message: []
                }

                // 【修改3】如果是群聊才带入 group_id，以便 bot.js 正确装配
                if (isGroup && taskData.group_id) {
                    mockE.group_id = taskData.group_id;
                }

                // 调用云崽的原生装配函数
                if (global.Bot && typeof Bot.prepareEvent === 'function') {
                    Bot.prepareEvent(mockE)
                }

                // 【修改4】设置 abstractChat() 因为LLM API出错后回复的定时内容
                // 区分群聊和私聊，私聊通常不支持或不需要 @ 人
                const messageToSend = []
                if (isGroup) {
                    messageToSend.push(segment.at(taskData.user_id));
                    messageToSend.push(`\n叮！您设定的定时提醒：\n${taskData.content}`);
                } else {
                    messageToSend.push(`叮！您设定的定时提醒：\n${taskData.content}`);
                }

                mockE.checkAndExecuteContent = messageToSend;

                // 植入chatgpt插件
                const chatgptTask = new chatgpt(mockE);
                const sourceStr = isGroup ? "群聊" : "私聊";
                mockE.msg = `${taskData.nickname}(ID:${taskData.user_id})在${sourceStr}设定的定时提醒已触发：\n${taskData.content}`;

                // 手动为插件实例挂载上下文 e
                chatgptTask.e = mockE;

                // 触发LLM
                let groupId = mockE.isGroup ? mockE.group_id : ''
                // 确保在私聊 (groupId为空) 的情况下闭嘴逻辑不报错
                if (await redis.get('CHATGPT:SHUT_UP:ALL') || (groupId && await redis.get(`CHATGPT:SHUT_UP:${groupId}`))) {
                    logger.info('[chatgpt] chatgpt闭嘴中，不予理会')
                    continue;
                }
                const userData = await getUserData(mockE.user_id)
                const use = (userData.mode === 'default' ? null : userData.mode) || await redis.get('CHATGPT:USE') || 'api'

                // 关闭私聊通道后不回复
                if (!mockE.isMaster && mockE.isPrivate && !Config.enablePrivateChat) {
                    continue; // 原本是 return false，在 for 循环中应改为 continue
                }

                if (!(await chatgptTask.canGPT_blackAndWhitelist(mockE))) continue;

                await chatgptTask.abstractChat(mockE, mockE.msg, use)
            }
        } catch (err) {
            logger.error(`[ChatGPT-定时任务插件] 发生错误: ${err}`);
        }
    }
}