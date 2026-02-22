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
                cron: Config.ScheduleTask_Tool ? '0 * * * * *' : "0 0 1 1 * *", // 每分钟的第 0 秒执行一次
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

                // 成功解析后立即从 Redis 移除该任务，防止后续报错导致任务死循环
                await redis.zRem(redisKey, taskJson);

                // 主动构建完整的 mockE，包含 sender 对象
                let mockE = {
                    self_id: taskData.bot_id,
                    group_id: taskData.group_id,
                    user_id: taskData.user_id,
                    post_type: 'message',
                    message_type: 'group',
                    // 补充 prepareEvent 漏处理的值
                    isGroup: true,
                    isPrivate: false,
                    isMaster: taskData.isMaster,
                    sender: {
                        user_id: taskData.user_id,
                        nickname: taskData.nickname || '定时任务'
                    },
                    message: []
                }

                // 调用云崽的原生装配函数
                if (global.Bot && typeof Bot.prepareEvent === 'function') {
                    Bot.prepareEvent(mockE)
                }

                // // 发送定时内容
                // const messageToSend = [
                //     segment.at(taskData.user_id),
                //     `\n叮！您设定的定时提醒已触发：\n${taskData.content}`
                // ]
                // if (mockE.reply) {
                //     mockE.reply(messageToSend)
                // } else {
                //     logger.warn(`[ChatGPT-定时任务] 找不到群 ${taskData.group_id} 的发送方法，Bot可能掉线或群不存在。`)
                // }

                // 植入chatgpt插件
                const chatgptTask = new chatgpt(mockE);
                mockE.msg = `设定的定时提醒已触发：\n${taskData.content}`;
                // 【核心修复】：手动为插件实例挂载上下文 e，补足云崽框架原本做的事！
                chatgptTask.e = mockE;

                // 触发LLM
                let groupId = mockE.isGroup ? mockE.group_id : ''
                if (await redis.get('CHATGPT:SHUT_UP:ALL') || await redis.get(`CHATGPT:SHUT_UP:${groupId}`)) {
                    logger.info('[chatgpt] chatgpt闭嘴中，不予理会')
                    continue;
                }
                const userData = await getUserData(mockE.user_id)
                const use = (userData.mode === 'default' ? null : userData.mode) || await redis.get('CHATGPT:USE') || 'api'
                // // 关闭私聊通道后不回复 // 仅群聊
                // if (!mockE.isMaster && mockE.isPrivate && !Config.enablePrivateChat) {
                //     return false
                // }
                if (!chatgptTask.canGPT_blackAndWhitelist(mockE)) continue;

                // 捕获单个任务执行的异常，避免一个任务报错中断后续所有正常任务
                try {
                    await chatgptTask.abstractChat(mockE, mockE.msg, use)
                } catch (chatErr) {
                    logger.error(`[ChatGPT-定时任务] 任务 ${taskData.content} 执行异常:`, chatErr);
                }
            }
        } catch (err) {
            logger.error(`[ChatGPT-定时任务插件] 发生错误: ${err}`);
        }
    }
}