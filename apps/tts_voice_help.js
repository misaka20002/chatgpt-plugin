import plugin from '../../../lib/plugins/plugin.js';
import common from '../../../lib/common/common.js';
import { Config } from '../utils/config.js'
import { getUserReplySetting } from '../utils/common.js'
import { speakers, vits_emotion_map } from '../utils/tts.js'

export class voicechangehelp extends plugin {
    constructor() {
        super({
            name: 'tts语音替换帮助',
            dsc: 'tts语音替换帮助',
            event: 'message',
            priority: 999,
            rule: [{
                reg: `^#tts(语音)?(替换)?帮助$`,
                fnc: 'voicechangehelp'
            },
            {
                reg: '^#tts情感(设置)?(帮助)?',
                fnc: 'set_vits_emotion',
            },
            {
                reg: '^#tts语言设置(帮助)?',
                fnc: 'set_tts_language',
                permission: 'master'
            },
            {
                reg: '^#ttslength(Scale)?设置(帮助)?',
                fnc: 'set_lengthScale',
                permission: 'master'
            },
            {
                reg: '^#tts(语音)?转日语(帮助)?',
                fnc: 'set_autoJapanese',
                permission: 'master'
            },
            {
                reg: '^#chatgpt设置(AI|ai)?第一人称(称谓)?(帮助)?',
                fnc: 'set_assistantLabel',
                permission: 'master'
            },
            {
                reg: '^#tts(设置|查看)?融合文本(帮助)?',
                fnc: 'set_style_text',
            },
            {
                reg: '^#tts(设置|查看)?融合权重(帮助)?',
                fnc: 'set_style_text_weights',
            },
            {
                reg: '^#chatgpt(设置|查看)?输出黑名单(帮助)?',
                fnc: 'set_blockWords',
                permission: 'master'
            },
            {
                reg: '^#chatgpt(设置|查看)?输入黑名单(帮助)?',
                fnc: 'set_promptBlockWords',
                permission: 'master'
            },
            {
                reg: '^#tts删除所有(chatgpt)?用户回复设置',
                fnc: 'delete_redis_all_user_config',
                permission: 'master'
            },
            {
                reg: '^#tts(可选)?人物(可选)?列表$',
                fnc: 'tts_show_speakers',
            },
            {
                reg: '^#tts查看((当|目)前)?(语音)?设置$',
                fnc: 'show_tts_voice_help_config',
                permission: 'master'
            }
            ]
        })
    }


    /** ^#tts(语音)?(替换)?帮助$ */
    async voicechangehelp(e) {
        let msg1 = `小呆毛tts语音替换帮助：\n` +
            `#tts查看当前语音设置\n` +
            `#chatgpt查看回复设置\n` +
            `#chatgpt(图片|语音)模式\n` +
            `#tts删除所有用户回复设置帮助\n` +
            `（↑每人独立设置且优先级最高）\n` +
            `#tts可选人物列表\n` +
            `#tts语言设置帮助\n` +
            `#tts语音转日语帮助\n` +
            `#ttslength设置帮助\n` +
            `#tts情感帮助\n` +
            `#tts情感设置上锁(开启|关闭)\n` +
            `#tts(查看|设置)融合文本\n` +
            `#tts(查看|设置)融合权重\n` +
            `#chatgpt设置AI第一人称帮助\n` +
            `#chatgpt(查看|设置)输出黑名单\n` +
            `#chatgpt(查看|设置)输入黑名单\n` +
            `#chatgpt必应(开启|关闭)搜索` +
            ''
        let msg2 = `必要锅巴设置：\n1. vits-uma-genshin-honkai语音转换API地址 填入：\n` +
            `https://v2.genshinvoice.top\n` +
            `2. 云转码API发送数据模式 选择：[文件]`
        let msg3 = '感谢genshinvoice.top提供的api支持！'

        let msg1_isn_master = `小呆毛tts语音替换帮助：\n` +
            `#chatgpt查看回复设置\n` +
            `#chatgpt设置语音角色派蒙_ZH\n` +
            `#chatgpt设置语音角色可莉_ZH\n` +
            `#chatgpt(图片|语音)模式\n` +
            `（↑每人独立设置且优先级最高）\n` +
            `#tts可选人物列表\n` +
            `#tts情感设置1\n` +
            `#tts情感设置帮助\n` +
            `#tts(查看|设置)融合文本\n` +
            `#tts(查看|设置)融合权重` +
            ''
        const userSetting = await getUserReplySetting(this.e)
        let msg4_1 = `${this.e.sender.user_id}的回复设置:
图片模式: ${userSetting.usePicture === true ? '开启' : '关闭'}
语音模式: ${userSetting.useTTS === true ? '开启' : '关闭'}
Vits语音角色: ${userSetting.ttsRole}
Azure语音角色: ${userSetting.ttsRoleAzure}
VoiceVox语音角色: ${userSetting.ttsRoleVoiceVox}
${userSetting.useTTS === true ? '当前语音模式为' + Config.ttsMode : ''}`
        msg4_1 = msg4_1.replace(/\n\s*$/, '')
        let msgx
        if (e.isMaster) {
            msgx = await common.makeForwardMsg(e, [msg1, msg2, msg4_1], `tts语音帮助-m`)
        } else {
            msgx = await common.makeForwardMsg(e, [msg1_isn_master, msg4_1], `tts语音帮助`)
        }
        e.reply(msgx);
        return true;
    }

    /** ^#tts(可选)?人物(可选)?列表$ */
    async tts_show_speakers(e) {
        let msg1 = `tts可选人物列表：`
        let msg2 = `（每名用户都可以单独设置）\n` +
            `#chatgpt设置全局vits语音角色派蒙_ZH\n` +
            `#chatgpt设置语音角色可莉_ZH`
        let speakertip1 = "可选列表：\n"
        let speakertip2 = ""
        let speakertip3 = ""
        for (let i = 0; i < speakers.length; i++) {
            if (i <= (speakers.length / 3)) {
                speakertip1 += speakers[i]
                if (i % 2 == 0) {
                    speakertip1 += "　　"
                }
                else {
                    speakertip1 += "\n"
                }
            }
            if (i <= ((speakers.length * 2) / 3) && i > (speakers.length / 3)) {
                speakertip2 += speakers[i]
                if (i % 2 == 0) {
                    speakertip2 += "　　"
                }
                else {
                    speakertip2 += "\n"
                }
            }
            if (i > ((speakers.length * 2) / 3)) {
                speakertip3 += speakers[i]
                if (i % 2 == 0) {
                    speakertip3 += "　　"
                }
                else {
                    speakertip3 += "\n"
                }
            }

        }
        let msgx = await common.makeForwardMsg(e, [msg1, msg2, speakertip1, speakertip2, speakertip3], `tts可选人物列表`);
        e.reply(msgx);
        return true;
    }


    /** ^#tts情感(设置)?(帮助)?  #tts情感设置上锁(开启|关闭) */
    async set_vits_emotion(e) {
        let input_tts = e.msg.replace(/^#tts情感(设置)?(帮助)?/, '').trim()
        if (!input_tts) {
            let msg1 = `tts情感设置帮助：`
            let msg_show = `tts语音当前情感：${Config.vits_emotion}`
            let msg1_1 = `#tts情感设置为空值`
            let msg2 = `目前api仅支持Happy！输入整数，如：\n#tts情感设置1`
            let msg3 = JSON.stringify(vits_emotion_map, null, 2).replace(/\"|,/g, "")
            let msgx = await common.makeForwardMsg(e, [msg1, msg_show, msg1_1, msg2, msg3], `tts情感设置帮助`);
            return e.reply(msgx, false)
        }
        if (input_tts === '上锁开启' || input_tts === '上锁关闭') {
            if (!e.isMaster) return e.reply('只有主人可以使用#tts情感设置上锁开启|关闭')
            Config.vits_emotion_locker = input_tts === '上锁开启' ? true : false
            return e.reply(`#tts情感设置已${input_tts}！`)
        } else if (input_tts === '为空' || input_tts === '为空值') {
            if (!e.isMaster && Config.vits_emotion_locker) {
                return e.reply('tts情感设置已上锁，请主人使用#tts情感设置上锁开启|关闭')
            }
            Config.vits_emotion = ''
            return e.reply(`tts情感已修改为空值！`)
        } else if (RegExp("^([1-9]|[1-9]\\d|100)$").test(input_tts)) {
            if (!e.isMaster && Config.vits_emotion_locker) {
                return e.reply('tts情感设置已上锁，请主人使用#tts情感设置上锁开启|关闭')
            }
            let input_vits_map = vits_emotion_map[input_tts - 1].replace(/(\s+)|([(].*[)])/g, "").replace(/:|([0-9]*)/g, '')
            /* 	.replace()
                '1: Happy (开心)',
                '2: Sad (伤心)',
                '3: Excited (兴奋)',
                ... */
            Config.vits_emotion = input_vits_map
            return e.reply(`tts情感已修改为${input_tts}：${input_vits_map}！`)
        } else {
            return e.reply('喵?请输入#tts情感设置帮助', false)
        }
    }

    /** ^#tts语言设置(帮助)? */
    async set_tts_language(e) {
        let input_tts = e.msg.replace(/^#tts语言设置(帮助)?/, '').trim()
        if (!input_tts) {
            return e.reply(`选择发音的语言（但不会自动翻译过去哦，你用外语和人家说话人家可能就会用外语回复你了）。\n可选ZH, JP, EN, mix(api暂不支持), auto(支持中日英自动,但api目前罗马数字会用英文)\n例如#tts语言设置auto`, false)
        }
        input_tts = input_tts.toLowerCase()
        if (/^zh$|^jp$|^en$|^mix$|^auto$/.test(input_tts)) {
            if (/^zh$|^jp$|^en$/.test(input_tts)) input_tts = input_tts.toUpperCase()
            Config.tts_language = input_tts
            return e.reply(`tts语言已设置为${input_tts}！`)
        } else {
            return e.reply('可选ZH, JP, EN, mix(api暂不支持), auto\n例如#tts语言设置auto', false)
        }
    }

    /** '^#ttslength(Scale)?设置(帮助)?' */
    async set_lengthScale(e) {
        let input_tts = e.msg.replace(/^#ttslength(Scale)?设置(帮助)?/, '').trim()
        if (!input_tts) {
            return e.reply(`控制整体语速，范围0.1-2.0，越小语速越快。\n例如#ttslength设置1`, false)
        }
        input_tts = parseFloat(input_tts).toFixed(1)
        if (input_tts > 0 && input_tts <= 2) {
            Config.lengthScale = input_tts
            return e.reply(`tts的lengthScale已设置为${input_tts}！`)
        } else {
            return e.reply('输入范围0.1-2.0哦。\n例如#ttslength设置1', false)
        }
    }

    /** '^#chatgpt设置(AI|ai)?第一人称(称谓)?(帮助)?' */
    async set_assistantLabel(e) {
        let input_tts = e.msg.replace(/^#chatgpt设置(AI|ai)?第一人称(称谓)?(帮助)?/, '').trim()
        if (!input_tts) {
            let msg1 = `tts第一人称帮助：`
            let msg_show = `指定某些情况指定回复下AI的第一人称`
            let msg1_1 = `#chatgpt设置AI第一人称派蒙`
            let msg2 = `如果需要触发“AI回应第一人称呼叫”，请重启；\n如果不触发，则考虑指令冲突，例如先去锅巴把喵仔设置里面的机器人别名给删掉。`
            let msgx = await common.makeForwardMsg(e, [msg1, msg_show, msg1_1, msg2], `tts第一人称帮助`);
            return e.reply(msgx, false)
        } else {
            Config.tts_First_person = input_tts
            Config.chatViewBotName = input_tts
            return e.reply(`AI的第一人称已设置为“${input_tts}”！\n如果需要触发“AI回应第一人称呼叫”请重启。`)
        }
    }

    /** ^#tts(设置|查看)?融合权重(帮助)? */
    async set_style_text_weights(e) {
        let input_tts = e.msg.replace(/^#tts(设置|查看)?融合权重(帮助)?/, '').trim()
        if (!input_tts) {
            let show_msg1 = 'tts当前融合权重：'
            let show_msg2 = `${Config.style_text_weights}`
            let show_msg3 = '主文本和辅助文本的bert混合比率，0表示仅主文本，1表示仅辅助文本，范围0.0-1.0，默认0.7'
            let show_msg4_1 = '#tts设置融合权重0.7'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg2, show_msg3, show_msg4_1], 'tts融合文本帮助');
            return e.reply(show_msgx, false);
        }
        input_tts = parseFloat(input_tts).toFixed(1)
        if (input_tts >= 0 && input_tts <= 1) {
            if (!e.isMaster && Config.vits_emotion_locker) {
                return e.reply('tts设置已上锁，请主人使用#tts情感设置上锁开启|关闭')
            }
            Config.style_text_weights = input_tts
            return e.reply(`tts融合权重已设置为${input_tts}！`)
        } else {
            return e.reply('输入范围0.0-1.0哦。\n例如#tts设置融合权重0.7', false)
        }
    }

    /** ^#tts(设置|查看)?融合文本(帮助)? */
    async set_style_text(e) {
        let input_tts = e.msg.replace(/^#tts(设置|查看)?融合文本(帮助)?/, '').trim()
        if (!input_tts) {
            let show_msg1 = 'tts当前融合文本：'
            let show_msg2 = `${Config.style_text}`
            let show_msg3 = '使用辅助文本的语意来辅助生成对话（语言保持与主文本相同）注意：不要使用指令式文本（如：开心），要使用带有强烈情感的文本（如：我好快乐！！！）效果较不明确，留空即为不使用该功能。'
            let show_msg4_1 = '#tts设置融合文本为空值'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg2, show_msg3, show_msg4_1], 'tts融合文本帮助');
            return e.reply(show_msgx, false);
        } else if (input_tts === '为空' || input_tts === '为空值') {
            if (!e.isMaster && Config.vits_emotion_locker) {
                return e.reply('tts设置已上锁，请主人使用#tts情感设置上锁开启|关闭')
            }
            Config.style_text = ""
            let show_msg1 = '融合文本已设置为空值'
            let show_msg3 = '可使用#tts查看融合文本'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg3], 'tts融合文本');
            return e.reply(show_msgx);
        } else {
            if (!e.isMaster && Config.vits_emotion_locker) {
                return e.reply('tts设置已上锁，请主人使用#tts情感设置上锁开启|关闭')
            }
            Config.style_text = input_tts
            let show_msg1 = '融合文本已设置为：'
            let show_msg2 = `${input_tts}`
            let show_msg3 = '可使用#tts查看融合文本'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg2, show_msg3], 'tts融合文本');
            return e.reply(show_msgx);
        }
    }

    /** ^#chatgpt(设置|查看)?输出黑名单(帮助)? */
    async set_blockWords(e) {
        let input_tts = e.msg.replace(/^#chatgpt(设置|查看)?输出黑名单(帮助)?/, '').trim()
        if (!input_tts) {
            let show_msg1 = 'chatgpt当前输出黑名单：'
            let show_msg2 = `${Config.blockWords}`
            let show_msg3 = '检查输出结果中是否有违禁词，如果存在黑名单中的违禁词则不输出。英文逗号隔开。如：\n#chatgpt设置输出黑名单屏蔽词1,屏蔽词b'
            let show_msg4 = '#chatgpt设置输出黑名单是bing,this is bing,是 bing,これはBing,これは Bing'
            let show_msg4_1 = '#chatgpt设置输出黑名单为空值'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg2, show_msg3, show_msg4, show_msg4_1], 'chatgpt输出黑名单帮助');
            return e.reply(show_msgx, false);
        } else if (input_tts === '为空' || input_tts === '为空值') {
            Config.blockWords = ['']
            let show_msg1 = '输出黑名单已设置为空值'
            let show_msg3 = '可使用#chatgpt查看输出黑名单'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg3], 'chatgpt输出黑名单');
            return e.reply(show_msgx);
        } else {
            let input_array = input_tts.split(",");
            Config.blockWords = input_array
            let show_msg1 = '输出黑名单已设置为：'
            let show_msg2 = `${input_array}`
            let show_msg3 = '可使用#chatgpt查看输出黑名单'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg2, show_msg3], 'chatgpt输出黑名单');
            return e.reply(show_msgx);
        }
    }

    /** ^#chatgpt(设置|查看)?输入黑名单(帮助)? */
    async set_promptBlockWords(e) {
        let input_tts = e.msg.replace(/^#chatgpt(设置|查看)?输入黑名单(帮助)?/, '').trim()
        if (!input_tts) {
            let show_msg1 = 'chatgpt当前输入黑名单：'
            let show_msg2 = `${Config.promptBlockWords}`
            let show_msg3 = '检查对话输入中是否有违禁词，如果存在黑名单中的违禁词则不输出。英文逗号隔开。如：\n#chatgpt设置输入黑名单屏蔽词1,屏蔽词b'
            let show_msg4_1 = '#chatgpt设置输入黑名单为空值'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg2, show_msg3, show_msg4_1], 'chatgpt输入黑名单帮助');
            return e.reply(show_msgx, false);
        } else if (input_tts === '为空' || input_tts === '为空值') {
            Config.promptBlockWords = ['']
            let show_msg1 = '输入黑名单已设置为空值'
            let show_msg3 = '可使用#chatgpt查看输入黑名单'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg3], 'chatgpt输入黑名单');
            return e.reply(show_msgx);
        } else {
            let input_array = input_tts.split(",");
            Config.promptBlockWords = input_array
            let show_msg1 = '输入黑名单已设置为：'
            let show_msg2 = `${input_array}`
            let show_msg3 = '可使用#chatgpt查看输入黑名单'
            let show_msgx = await common.makeForwardMsg(e, [show_msg1, show_msg2, show_msg3], 'chatgpt输入黑名单');
            return e.reply(show_msgx);
        }
    }

    /** ^#tts(语音)?转日语(帮助)? */
    async set_autoJapanese(e) {
        let input_tts = e.msg.replace(/^#tts(语音)?转日语(帮助)?/, '').trim()
        if (!input_tts) {
            let msg1 = `可以选择把文本翻译成日语再发音哦`
            let msg_show = `tts语音转日语当前设置：${Config.autoJapanese}`
            let msg1_1 = `#tts语音转日语(开启|关闭)`
            let msgx = await common.makeForwardMsg(e, [msg1, msg_show, msg1_1], `tts语音转日语帮助`);
            return e.reply(msgx, false)
        }
        if (input_tts === '开启' || input_tts === '关闭') {
            Config.autoJapanese = input_tts === '开启' ? true : false
        } else {
            return e.reply('喵？可以选择把文本翻译成日语再发音哦\n#tts转日语(开启|关闭)')
        }
    }

    /** ^#tts删除所有(chatgpt)?用户回复设置 */
    async delete_redis_all_user_config(e) {
        let input_tts = e.msg.replace(/^#tts删除所有(chatgpt)?用户回复设置/, '').trim()
        if (input_tts) {
            let msg1 = `删除所有用户回复设置，所有用户将重新使用默认配置。用户回复设置的优先级高于默认设置，删除后用户可重新设置。`
            let msg_show = `#chatgpt查看回复设置`
            let msg1_1 = `请注意你知道你在做什么\n#tts删除所有用户回复设置`
            let msgx = await common.makeForwardMsg(e, [msg1, msg_show, msg1_1], `tts删除所有用户回复设置`);
            return e.reply(msgx, false)
        }
        let qcs = await redis.keys('CHATGPT:USER:*')
        let deleted = 0
        for (let i = 0; i < qcs.length; i++) {
            await redis.del(qcs[i])
            // todo clean last message id
            if (Config.debug) {
                logger.info('delete gemini conversation bind: ' + qcs[i])
            }
            deleted++
        }
        return e.reply(`已经删除${deleted}个用户的回复设置，所有用户将使用默认配置。\n#chatgpt查看回复设置`, true)
    }

    /** 发送当前设置 */
    async show_tts_voice_help_config(e) {
        let show_tts_voice_help_config_msg1 = 'tts语音当前设置：'
        let show_tts_voice_help_config_msg2 = ` 默认角色：${Config.defaultTTSRole}\n 发音语言：${Config.tts_language}\n tts情感设置上锁：${Config.vits_emotion_locker}\n vits_emotion：${Config.vits_emotion}\n noiseScale：${Config.noiseScale}\n noiseScaleW：${Config.noiseScaleW}\n lengthScale：${Config.lengthScale}\n sdp_ratio：${Config.sdp_ratio}\n 融合文本：${Config.style_text}\n 融合权重：${Config.style_text_weights}\n 全局语音模式：${Config.defaultUseTTS}\n AI第一人称：${Config.tts_First_person}`

        const userSetting = await getUserReplySetting(this.e)
        let msg4_1 = `${this.e.sender.user_id}的回复设置:
图片模式: ${userSetting.usePicture === true ? '开启' : '关闭'}
语音模式: ${userSetting.useTTS === true ? '开启' : '关闭'}
Vits语音角色: ${userSetting.ttsRole}
Azure语音角色: ${userSetting.ttsRoleAzure}
VoiceVox语音角色: ${userSetting.ttsRoleVoiceVox}
${userSetting.useTTS === true ? '当前语音模式为' + Config.ttsMode : ''}`
        msg4_1 = msg4_1.replace(/\n\s*$/, '')

        let show_tts_voice_help_config_msg2_msgx = await common.makeForwardMsg(e, [show_tts_voice_help_config_msg1, show_tts_voice_help_config_msg2, msg4_1], '小呆毛tts语音当前设置');
        return e.reply(show_tts_voice_help_config_msg2_msgx);
    }




}
