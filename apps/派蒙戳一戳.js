import plugin from '../../../lib/plugins/plugin.js';
import cfg from '../../../lib/config/config.js'
import common from '../../../lib/common/common.js'
import moment from 'moment'
import fetch from 'node-fetch'
import { Config } from '../utils/config.js'
import uploadRecord from '../utils/uploadRecord.js'
import {
    generate_msg_Daiyu,
    generateHello,
    generate_msg_randomHellow_TuWeiLoveSpeech,
    generate_msg_randomPlayingMsg
} from '../utils/randomMessage.js'
import {
    generateAudio,
    getUin,
    getUserReplySetting,
} from '../utils/common.js'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { getAvailablePictures } from './autoEmoticons.js'

// 如使用非icqq请在此处填写机器人QQ号
let BotQQ = ''

// 随机本地图片地址：如果需要发送随机图片则把图片放在这个文件夹，支持子文件夹和中文文件夹；没有本地图片则返回随机文本。为减轻Cpu负担，该目录文件每30分钟的触发戳一戳才索引一次，不触发不索引（其实也没有多少负担啦）。。
const paimonChuoYiChouPicturesDirectory = `${process.cwd()}/data/chatgpt/PaimonChuoYiChouPictures`
const paimonChuoYiChouSavePicDirectory = `${process.cwd()}/data/chatgpt/PaimonChuoYiChouPictures/savePics`
if (!Config.paimon_chou_IsSendLocalpic) {
    Config.paimon_chou_reply_text += Config.paimon_chou_randowLocalPic
    Config.paimon_chou_randowLocalPic = 0
}
// 初始化
redis.del(`Yz:PaimongChuoLocalPicIndex`);
if (!fs.existsSync(paimonChuoYiChouPicturesDirectory)) fs.mkdirSync(paimonChuoYiChouPicturesDirectory);
if (!fs.existsSync(paimonChuoYiChouSavePicDirectory)) fs.mkdirSync(paimonChuoYiChouSavePicDirectory);

export class PaimonChuo extends plugin {
    constructor() {
        super({
            name: '派蒙戳一戳',
            dsc: '戳一戳机器人触发效果',
            event: 'notice.group.poke',
            priority: 1000,
            rule: [
                {
                    fnc: 'chuoyichuo',
                    log: false
                }
            ]
        }
        )
        // init()  // 写在这里的函数每次戳一戳都会触发
    }

    async chuoyichuo(e) {
        if (!Config.paimon_chuoyichuo_open) return false

        // 戳一戳响应CD
        let lastTime = await redis.get(`Yz:PaimongChuoCD:${e.group_id}:${e.operator_id}`);
        if (lastTime) return false;
        else {
            // 写入cd
            let paimon_chou_cd = Config.paimon_chou_cd
            if (paimon_chou_cd > 0) redis.set(`Yz:PaimongChuoCD:${e.group_id}:${e.operator_id}`, 1, { EX: paimon_chou_cd });
        }

        if (cfg.masterQQ.includes(e.target_id)) {
            if (Config.debug) {
                logger.mark('[戳一戳-戳主人生效]')
            }
            if (cfg.masterQQ.includes(e.operator_id) || cfg.qq == e.operator_id || BotQQ == e.operator_id) {
                return;
            }
            let mutetype = Math.ceil(Math.random() * 3)
            switch (mutetype) {
                case 1:
                    await e.reply(`呜呜，有什么开心不开心的都冲${Config.tts_First_person}来吧QAQ`, true)
                    break;
                case 2:
                    await e.reply(`请戳${Config.tts_First_person}吧，${Config.tts_First_person}...${Config.tts_First_person}什么都愿意做QAQ`, true)
                    break;
                case 3:
                    await e.reply(`呜呜呜，${Config.tts_First_person}愿意为你做任何事情`, true)
                    break;
            }
            await common.sleep(1000);
            e.group.pokeMember(e.operator_id);
            return true
        }

        if (e.target_id == e.self_id || e.target_id == cfg.qq || e.target_id == BotQQ || e.target_id == getUin(e)) {
            /**统计每日被戳次数 */
            let count = await redis.incr(`paimon_pokecount`);
            // redis记录每日被戳次数，次日零点过期
            let time = moment(Date.now())
                .add(1, "days")
                .format("YYYY-MM-DD 00:00:00");
            let exTime = Math.round(
                (new Date(time).getTime() - new Date().getTime()) / 1000
            );
            redis.expire(`paimon_pokecount`, exTime);

            /**戳一戳次数生效 */
            if (Math.ceil(Math.random() * 100) <= 10 && count >= 10) {
                if (Config.debug) {
                    logger.mark('[戳一戳次数生效]')
                }
                let text_number = Math.ceil(Math.random() * ciku['length'])
                await e.reply(ciku[text_number - 1].replace(/派蒙/g, Config.tts_First_person).replace("_num_", count))
                return true;
            }


            //生成0-100%的随机数
            let random_type = Math.random()

            /**回复随机文字 */
            if (random_type < Config.paimon_chou_reply_text) {
                if (Config.debug) {
                    logger.mark('[戳一戳回复随机文字生效]')
                }
                this.send_randow_text_msg(e)
            }

            /**回复随机图片 */
            else if (random_type < (Config.paimon_chou_reply_text + Config.paimon_chou_reply_img)) {
                if (Config.debug) {
                    logger.mark('[戳一戳回复随机图片生效]')
                }
                let mutetype
                if (Config.paimon_chou_IsUseLoliconApi) mutetype = Math.ceil(Math.random() * 5)
                else mutetype = Math.ceil(Math.random() * 3)
                let url
                switch (mutetype) {
                    case 1:
                        url = getRandomUrl("ecywebp");
                        await e.reply(`喵>_< ${Config.tts_First_person}有点开心，这是${Config.tts_First_person}私藏的画片哦`)
                        await e.reply([await segment.image(await convertWebpToJpg(url))]);
                        break;
                    case 2:
                        url = getRandomUrl("scy");
                        await e.reply(`这是${Config.tts_First_person}今天找到的画片哦，主人喜欢吗？`)
                        await e.reply([await segment.image(await convertWebpToJpg(url))]);
                        break;
                    case 3:
                        url = getRandomUrl("ecy");
                        await e.reply(`主人，快看快看${Config.tts_First_person}发现了什么？`)
                        await e.reply([await segment.image(await convertWebpToJpg(url))]);
                        break;
                    case 4:
                        url = await get_url_from_api_lolicon('ロリ|loli|萝莉|风景|壁纸', '');
                        await this.reply(`主人主人，${Config.tts_First_person}今天捡到了一张奇怪的明信片，拿给你看看`, false, { recallMsg: 100 })
                        await this.reply([await segment.image(await convertWebpToJpg(url))], false, { recallMsg: 100 });
                        break;
                    case 5:
                        url = await get_url_from_api_lolicon('ロリ|loli|萝莉', 'vtb|fgo|pcr|AzurLane|Genshin Impact|原神|BlueArchive|ブルーアーカイブ');
                        await this.reply(`呜呜，${Config.tts_First_person}给你一张涩涩的画片，不要再戳戳人家了`, false, { recallMsg: 100 })
                        await this.reply([await segment.image(await convertWebpToJpg(url))], false, { recallMsg: 100 });
                        break;
                }
            }

            /**返回随机音频 */
            else if (random_type < (Config.paimon_chou_reply_text + Config.paimon_chou_reply_img + Config.paimon_chou_reply_voice)) {
                if (Config.debug) {
                    logger.mark('[戳一戳回复随机语音生效]')
                }
                let mutetype = 1
                const userSetting = await getUserReplySetting({ sender: { user_id: e.operator_id } })
                if (Config.paimon_chou_text_generateAndSendAudio && userSetting.useTTS) mutetype = Math.ceil(Math.random() * 2)
                switch (mutetype) {
                    case 1:
                        // 匹配发音人物
                        let defaultTTSRole = Config.defaultTTSRole
                        let voice_lists

                        // 匹配 AI的第一人称
                        const tts_First_person = Config.tts_First_person
                        if (tts_First_person.includes('派蒙') || tts_First_person.includes('白露')) {
                            defaultTTSRole = '派蒙_ZH'
                        } else if (tts_First_person.includes('可莉')) {
                            defaultTTSRole = '可莉_ZH'
                        } else if (tts_First_person.includes('纳西妲')) {
                            defaultTTSRole = '纳西妲_ZH'
                        } else if (tts_First_person.includes('心奈')) {
                            defaultTTSRole = '春原心奈'
                        } else if (tts_First_person.includes('小春')) {
                            defaultTTSRole = '下江小春'
                        } else if (/缇宝|缇安|缇宁|缇里西庇俄丝/.test(tts_First_person)) {
                            defaultTTSRole = '缇宝'
                        }

                        switch (defaultTTSRole) {
                            case '可莉_ZH':
                            case '可莉_JP':
                            case 'keli_hailuo':
                                voice_lists = voice_list_klee_cn.concat(voice_list_klee_jp);
                                break;
                            case '纳西妲_ZH':
                            case '纳西妲_JP':
                                voice_lists = voice_list_nahida_cn.concat(voice_list_nahida_jp);
                                break;
                            case '派蒙_ZH':
                            case '白露_ZH':
                            case '派蒙_JP':
                            case 'Paimeng_hailuo':
                                voice_lists = voice_list_bailu_cn.concat(voice_list_paimon_cn);
                                break;
                            case '春原心菜':
                            case '春原心奈':
                                voice_lists = voice_list_Sunohara_Kokona_jp;
                                break;
                            case '下江小春':
                                voice_lists = voice_list_Shimoe_Koharu_jp;
                                break;
                            case '缇宝':
                                voice_lists = voice_list_Tribbie_cn;
                                break;
                            // 缺省时将返回随机音频替换为返回随机文本
                            default:
                                this.send_randow_text_msg(e);
                                return
                        }
                        let voice_number = Math.ceil(Math.random() * voice_lists['length'])
                        let voice_url = voice_lists[voice_number - 1]
                        await e.reply(await chuo_silk_voice(voice_url, e))
                        break;
                    case 2:
                        let message2 = await generateHello()
                        chuo_text_generateAndSendAudio(message2, e);
                        // await e.reply(message2)
                        break;
                }
            }
            /**禁言 */
            else if (random_type < (Config.paimon_chou_reply_text + Config.paimon_chou_reply_img + Config.paimon_chou_reply_voice + Config.paimon_chou_mutepick)) {
                if (Config.debug) {
                    logger.mark('[戳一戳禁言生效]')
                }
                // 计算今日被禁言次数
                let jinyan_times = await redis.get(`Yz:PaimongChuoYiChuo:JinYanTimes:${e.operator_id}`) || 0;
                jinyan_times++
                this.addJinyanTimes(e.operator_id, 1);
                // 如果不是主人戳
                if (!cfg.masterQQ.includes(e.operator_id)) {
                    const usrinfo = await e.bot.getGroupMemberInfo?.(e.group_id, e.operator_id) || await e.bot.pickMember?.(e.group_id, e.operator_id)
                    const botinfo = await e.bot.getGroupMemberInfo?.(e.group_id, e.self_id) || await e.bot.pickMember?.(e.group_id, e.self_id)
                    // bot是群主||bot是管理员时用户不是群主或管理员
                    if ((botinfo.role === 'owner' || botinfo.is_owner) || ((botinfo.role === 'admin' || botinfo.is_admin) && ((usrinfo.role !== 'owner' || !usrinfo.is_owner) && (usrinfo.role !== 'admin' || !usrinfo.is_admin)))) {
                        // logger.mark('派蒙戳一戳调试：\nusrinfo=',JSON.stringify(usrinfo),'；\nbotinfo=',JSON.stringify(botinfo))
                        /* botinfo = { "group_id": __num__, "user_id": __num__, "nickname": "小派蒙", "card": "", "sex": "female", "age": 9, "join_time": 1698625488, "last_sent_time": 1706151598, "level": 1, "role": "owner", "title": "", "title_expire_time": 0, "shutup_time": 0, "update_time": 0 }
                        usrinfo = { "group_id": __num__, "user_id": __num__, "nickname": "_昵称_", "card": "_群昵称_", "sex": "male", "age": 88, "area": "", "join_time": 1705783666, "last_sent_time": 1706152333, "level": 1, "rank": "潜水", "role": "member", "title": "", "title_expire_time": 4294967295, "shutup_time": 0, "update_time": 1706151633 } ； */
                        let mutetype = Math.ceil(Math.random() * 4)
                        if (mutetype == 1) {
                            await e.reply(`是不是要${Config.tts_First_person}揍揍你才开心呀！`)
                            await common.sleep(100)
                            await e.group.muteMember(e.operator_id, 60 * jinyan_times);
                            await common.sleep(100)
                            await e.reply('哼！')
                        }
                        else if (mutetype == 2) {
                            await e.reply('不！！')
                            await common.sleep(10);
                            await e.reply('准！！')
                            await common.sleep(10);
                            await e.reply('戳！！');
                            await common.sleep(10);
                            await e.reply('人！！');
                            await common.sleep(10)
                            await e.reply('家！！')
                            await common.sleep(10);
                            await e.group.muteMember(e.operator_id, 120 * jinyan_times);
                            await common.sleep(50)
                            await e.reply(`让你面壁思过${2 * jinyan_times}分钟，哼😤～`)
                        }
                        else if (mutetype == 3) {
                            await e.reply(`要怎么样才能让你不戳${Config.tts_First_person}啊!`)
                            await common.sleep(100)
                            await e.group.muteMember(e.operator_id, 60 * jinyan_times);
                            await common.sleep(100)
                            await e.reply('大变态！')
                        }
                        else if (mutetype == 4) {
                            await e.reply(`干嘛戳${Config.tts_First_person}，${Config.tts_First_person}要惩罚你！`)
                            await common.sleep(100)
                            await e.group.muteMember(e.operator_id, 60 * jinyan_times);

                        }
                    } else {
                        let mutetype = Math.ceil(Math.random() * 4)
                        if (mutetype == 1) {
                            e.reply(`呜呜呜你欺负${Config.tts_First_person}QAQ`)
                        }
                        else if (mutetype == 2) {
                            e.reply(`主人有坏淫欺负${Config.tts_First_person}QAQ`)
                        }
                        else if (mutetype == 3) {
                            e.reply(`气死${Config.tts_First_person}了不要戳了！`)
                        }
                        else if (mutetype == 4) {
                            let text_number = Math.ceil(Math.random() * paimon_word_list['length'])
                            e.reply((paimon_word_list[text_number - 1] + '...呜呜，如果派蒙有管理员权限就禁言你1分钟QAQ').replace(/派蒙/g, Config.tts_First_person))
                        }
                    }
                }
                // 如果是主人戳
                else if (cfg.masterQQ.includes(e.operator_id)) {
                    let mutetype = Math.ceil(Math.random() * 2)
                    if (mutetype == 1) {
                        e.reply(`主人连你也欺负${Config.tts_First_person}，呜呜呜~`)
                    }
                    else if (mutetype == 2) {
                        e.reply('主人有什么事吗？喵~')
                    }
                } else {
                    logger.mark('[戳一戳禁言]bot无法判断主人是谁')
                }
            }

            //随机meme表情包api
            else if (random_type < (Config.paimon_chou_reply_text + Config.paimon_chou_reply_img + Config.paimon_chou_reply_voice + Config.paimon_chou_mutepick + Config.paimon_chou_paimonChuoMeme)) {
                if (Config.debug) {
                    logger.mark('[戳一戳随机表情包生效]')
                }
                let mutetype = Math.ceil(Math.random() * 14)
                switch (mutetype) {
                    case 1:
                        await e.reply(await segment.image(`http://oiapi.net/API/face_pat/?QQ=${e.operator_id}`))
                        break;
                    case 2:
                        await e.reply(await segment.image(`https://oiapi.net/API/Face_Diu?QQ=${e.operator_id}`))
                        break;
                    case 3:
                        await e.reply(await segment.image(`https://oiapi.net/API/Face_Pound?QQ=${e.operator_id}`))
                        break;
                    case 4:
                        await e.reply(await segment.image(`https://oiapi.net/API/Face_Petpet?QQ=${e.operator_id}`))
                        break;
                    case 5:
                        await e.reply(await segment.image(`https://oiapi.net/API/Face_Kiss?QQ=${e.operator_id}`))
                        break;
                    case 6:
                        await e.reply(await segment.image(`https://oiapi.net/API/Face_Pat/?QQ=${e.operator_id}`))
                        break;
                    case 7:
                        await e.reply(await segment.image(await convertWebpToJpg(getRandomUrl("bq_img"))))
                        break;
                    case 8:
                        await e.reply(await segment.image(await convertWebpToJpg(getRandomUrl("bqwebp"))))
                        break;
                    case 9:
                    case 10:
                        const randomPlayingMsg = await generate_msg_randomPlayingMsg()
                        const usrinfo = await e.bot.getGroupMemberInfo?.(e.group_id, e.operator_id) || await e.bot.pickMember?.(e.group_id, e.operator_id)
                        // await e.reply(await segment.image(`https://oiapi.net/API/QQ_quote/?message={"user_id":${e.operator_id},"user_nickname":"${usrinfo.card || usrinfo.nickname}","message":"${randomPlayingMsg}"}`))
                        // break;
                        // 上面的api获取不到用户头像了，改用 meme #我朋友说
                        try {
                            let { memes } = await import('./派蒙meme.js')
                            // 注入参数
                            e.sender = usrinfo
                            e.user_id = e.operator_id
                            e.msg = "#我朋友说" + randomPlayingMsg
                            e.at = e.operator_id
                            e.isFromPaimonChuo = true;
                            e.message = [
                                {
                                    "type": "text",
                                    "text": "#我朋友说" + randomPlayingMsg
                                },
                                {
                                    "type": "at",
                                    "qq": e.operator_id,
                                    "text": "@" + (usrinfo.card || usrinfo.nickname)
                                },
                            ]
                            const chuoMeme = new memes();
                            chuoMeme.memes(e);
                        } catch (err) {
                            logger.error('[派蒙戳一戳]调用meme #我朋友说 出错:', err)
                        }
                        break;
                    default:
                        // 调用 #随机meme
                        try {
                            let { memes } = await import('./派蒙meme.js')
                            // 注入参数
                            const usrinfo = await e.bot.getGroupMemberInfo?.(e.group_id, e.operator_id) || await e.bot.pickMember?.(e.group_id, e.operator_id)
                            e.sender = usrinfo
                            e.user_id = e.operator_id
                            e.isFromPaimonChuo = true;
                            e.message = [
                                {
                                    "type": "text",
                                    "text": "戳"
                                },
                            ]
                            // 轮到派蒙撅你咯
                            if (Math.random() < 0.1) {
                                const botinfo = await e.bot.getGroupMemberInfo?.(e.group_id, e.self_id) || await e.bot.pickMember?.(e.group_id, e.self_id)
                                e.sender = botinfo
                                e.user_id = e.self_id
                                e.message = [
                                    {
                                        "type": "text",
                                        "text": "#撅"
                                    },
                                ]
                                e.message.push({ type: 'at', qq: e.operator_id, text: usrinfo.card || usrinfo.nickname })
                                chuoMeme.memes(e);
                                return true
                            }
                            const chuoMeme = new memes();
                            chuoMeme.randomMemes(e, true);
                        } catch (err) {
                            logger.error('[派蒙戳一戳]调用随机meme出错:', err)
                        }
                        break
                }
            }

            //随机本地图片
            else if (random_type < (Config.paimon_chou_reply_text + Config.paimon_chou_reply_img + Config.paimon_chou_reply_voice + Config.paimon_chou_mutepick + Config.paimon_chou_paimonChuoMeme + Config.paimon_chou_randowLocalPic)) {
                if (Config.debug) {
                    logger.mark('[戳一戳随机本地图片生效]')
                }
                // 传入群号以获取该群的专属表情和共享图片
                let pic_path = await sendRandomPictureInFolder(e.group_id)
                if (pic_path) {
                    await e.reply(await segment.image(pic_path))
                } else {
                    this.send_randow_text_msg(e)
                    return
                }
            }

            //触发每日英语
            else if (random_type < (Config.paimon_chou_reply_text + Config.paimon_chou_reply_img + Config.paimon_chou_reply_voice + Config.paimon_chou_mutepick + Config.paimon_chou_paimonChuoMeme + Config.paimon_chou_randowLocalPic + Config.paimon_chou_dailyEnglish)) {
                if (Config.debug) {
                    logger.mark('[戳一戳每日英语生效]')
                }
                send_msg_DailyEnglish(e);
            }

            //反击
            else {
                if (Config.debug) {
                    logger.mark('[戳一戳反击生效]')
                }
                let mutetype = Math.round(Math.random() * 3)
                if (mutetype == 1) {
                    e.reply(`${Config.tts_First_person}也要戳戳你>_<`)
                    await common.sleep(1000)
                    await e.group.pokeMember(e.operator_id)
                }
                else if (mutetype == 2) {
                    e.reply(`你刚刚是不是戳${Config.tts_First_person}了?${Config.tts_First_person}要戳回去！`)
                    await common.sleep(1000)
                    await e.group.pokeMember(e.operator_id)
                }
                else if (mutetype == 3) {
                    e.reply(`让你戳${Config.tts_First_person}，哼！！！`)
                    await common.sleep(1000)
                    await e.group.pokeMember(e.operator_id)
                }
            }

        }

    }

    /** 随机回复预设派蒙文案 */
    async send_paimon_msg(e) {
        let text_number = Math.ceil(Math.random() * paimon_word_list['length'])
        let message0 = paimon_word_list[text_number - 1].replace(/派蒙/g, Config.tts_First_person)
        // chuo_text_generateAndSendAudio(message0, e);
        await e.reply(message0)
    }

    /** 随机回复文案 */
    async send_randow_text_msg(e) {
        let mutetype = Math.ceil(Math.random() * 20)
        let message = ''
        switch (mutetype) {
            case 1:
                // 要今天使用过绘图的人才能激活这个奖励
                if (await redis.get(`Yz:PaimongNai:usageLimit_day:${e.operator_id}`)) {
                    let random_nai_time = Math.ceil(Math.random() * 4)
                    if (random_nai_time == 1 || random_nai_time == 4) random_nai_time = Math.ceil(Math.random() * 6)
                    if (random_nai_time == 6) random_nai_time = Math.ceil(Math.random() * 8)
                    if (random_nai_time == 8) random_nai_time = Math.ceil(Math.random() * 10)
                    this.addNai3UsageLimit_day(e.operator_id, random_nai_time);
                    e.reply(`喵>_< 谢谢你和${Config.tts_First_person}玩，${Config.tts_First_person}偷偷送给你${random_nai_time}次绘画次数哦~`, false, { recallMsg: 55 })
                    break;
                }
                this.send_paimon_msg(e);
                break;
            case 2:
                await e.reply(kaomoji_list[(Math.ceil(Math.random() * kaomoji_list['length'])) - 1].replace(/派蒙/g, Config.tts_First_person))
                break;
            case 3:
                message = await generate_msg_randomHellow_TuWeiLoveSpeech()
                await e.reply(message)
                break;
            case 4:
            case 5:
                let today = new Date();
                if (today.getDay() === 4) {
                    message = await get_msg_KFC()
                    if (message) {
                        chuo_text_generateAndSendAudio(message, e);
                        await e.reply((`“咳咳~”派蒙：\n`).replace(/派蒙/g, Config.tts_First_person) + `${message}`)
                        break
                    }
                }
                this.send_paimon_msg(e);
                break;
            case 6:
                message = await get_msg_hitokoto(false)
                if (message) {
                    chuo_text_generateAndSendAudio(message, e);
                    await e.reply((`“咳咳~”派蒙开始了模仿：`).replace(/派蒙/g, Config.tts_First_person) + `“${message}”`)
                    break
                }
            // case 7:
            //     message = await get_msg_pphua()
            //     if (message) {
            //         chuo_text_generateAndSendAudio(message, e);
            //         await e.reply((`“咳咳~”派蒙开始模仿讲冷笑话：`).replace(/派蒙/g, Config.tts_First_person) + `“${message}”`)
            //         break
            //     }
            case 8:
                message = await get_msg_mingyanjingju()
                if (message) {
                    chuo_text_generateAndSendAudio(message, e);
                    await e.reply((`“咳咳~”派蒙开始模仿伟人讲话：`).replace(/派蒙/g, Config.tts_First_person) + `“${message}”`)
                    break
                }
            case 9:
                message = await get_msg_gushici()
                if (message) {
                    chuo_text_generateAndSendAudio(message, e);
                    await e.reply((`“咳咳~”派蒙开始模仿古人讲话：`).replace(/派蒙/g, Config.tts_First_person) + `“${message}”`)
                    break
                }
            // case 10:
            //     message = await get_msg_wyyrp() // 句子的效果不好，禁用
            //     if (message) {
            //         chuo_text_generateAndSendAudio(message, e);
            //         await e.reply((`“咳咳~”派蒙开始网抑云：`).replace(/派蒙/g, Config.tts_First_person) + `“${message}”`)
            //         break
            //     }
            case 11:
                message = await get_msg_AWord()
                if (message) {
                    chuo_text_generateAndSendAudio(message, e);
                    await e.reply((`“咳咳~”派蒙开始模仿别人讲话：`).replace(/派蒙/g, Config.tts_First_person) + `“${message}”`)
                    break
                }
            case 12:
                message = await get_msg_SickMsg()
                if (message) {
                    chuo_text_generateAndSendAudio(message, e);
                    await e.reply((`“咳咳~”派蒙开始说胡话：`).replace(/派蒙/g, Config.tts_First_person) + `“${message}”`)
                    break
                }

                // 如果这个第6~12都失效就发送派蒙戳一戳默认一言
                this.send_paimon_msg(e);
                break;

            // 新增的本地一言
            case 15:
                message = await generate_msg_Daiyu()
                chuo_text_generateAndSendAudio(message, e);
                await e.reply(message)
                break;
            default:
                this.send_paimon_msg(e);
                break;
        }
    }

    /**指定用户使用nai3次数加num次  
* @param qq 用户qq号
* @param num 数据库中用户使用记录要增加的次数
*/
    async addNai3UsageLimit_day(qq, num) {
        // 该用户的当日可用次数
        let usageLimit_day = await redis.get(`Yz:PaimongNai:usageLimit_day:${qq}`);
        if (usageLimit_day) {
            // 当前时间
            let time = moment(Date.now()).add(1, "days").format("YYYY-MM-DD 00:00:00");
            // 到明日零点的剩余秒数
            let exTime = Math.round(
                (new Date(time).getTime() - new Date().getTime()) / 1000
            );
            await redis.set(`Yz:PaimongNai:usageLimit_day:${qq}`, usageLimit_day * 1 + num, { EX: exTime });
        }
        return true;
    }


    /**指定用户禁言次数加num次  
 * @param qq 用户qq号
 * @param num 数据库中用户使用记录要增加的次数
 */
    async addJinyanTimes(qq, num) {
        // logger.info(num);
        // 该用户的使用次数
        let usageData = await redis.get(`Yz:PaimongChuoYiChuo:JinYanTimes:${qq}`);
        // 当前时间
        let time = moment(Date.now()).add(1, "days").format("YYYY-MM-DD 00:00:00");
        // 到明日零点的剩余秒数
        let exTime = Math.round(
            (new Date(time).getTime() - new Date().getTime()) / 1000
        );
        if (!usageData) {
            await redis.set(`Yz:PaimongChuoYiChuo:JinYanTimes:${qq}`, num * 1, { EX: exTime });
        } else {
            await redis.set(`Yz:PaimongChuoYiChuo:JinYanTimes:${qq}`, usageData * 1 + num, { EX: exTime });
        }
        return true;
    }

}

/**从https://api.lolicon.app/setu/v2/ 中返回图片地址，支持2个tag参数，tag中支持20个或| */
async function get_url_from_api_lolicon(tag1 = 'ロリ|loli|萝莉', tag2 = '') {
    const url = `https://api.lolicon.app/setu/v2?size=regular&tag=${tag1}&tag=${tag2}`;
    for (let i = 0; i < 3; i++) {
        try {
            const response = await fetch(url)
            const result = await response.json()
            if (Array.isArray(result.data) && result.data.length === 0) {
                logger.info('派蒙戳一戳api_lolicon未获取到图片')
                throw new Error(result)
            }
            let pic_url = result.data[0].urls?.original || result.data[0].urls?.regular || result.data[0].urls?.small
            if (!pic_url) throw new Error(result)
            return pic_url
        } catch (err) {
            logger.info(err)
        }
    }
    logger.warn(`派蒙戳一戳获取api_lolicon pic_url失败3次`)
}

/**
 * @description: 一言api
 * @param {*} is_return_from_who 是否返回一言作者
 * @return {*} 返回文本/错误则返回null
 */
async function get_msg_hitokoto(is_return_from_who = false) {
    let url = 'https://v1.hitokoto.cn/'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][一言] 接口请求失败')
        }
        res = await res.json()
        let msg
        if (is_return_from_who) msg = res.hitokoto + '——' + res.from + (res.from_who == res.from ? '' : (res.from_who ? (' ' + res.from_who) : ''))
        else msg = res.hitokoto
        return msg
    } catch (err) {
        logger.error(err)
        return null
    }
}

/**网易云热评 返回文本/错误则返回null */
async function get_msg_wyyrp() {
    let url = 'https://api.xingzhige.com/API/NetEase_CloudMusic_hotReview/'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][网易云热评] 接口请求失败')
        }
        res = await res.json()
        return res.data.content
    }
    catch (err) {
        logger.error(err)
        return null
    }
}

/**随机名言警句 返回文本/错误则返回null */
async function get_msg_mingyanjingju() {
    let url = 'https://oiapi.net/API/Saying'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][随机名言警句] 接口请求失败')
        }
        res = await res.json()
        return res.data.content
    }
    catch (err) {
        logger.error(err)
        return null
    }
}

/**随机古诗词 返回文本/错误则返回null */
async function get_msg_gushici() {
    let url = 'https://oiapi.net/API/Sentences'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][随机古诗词] 接口请求失败')
        }
        res = await res.json()
        return res.data.content
    }
    catch (err) {
        logger.error(err)
        return null
    }
}


/**随机疯狂星期四 返回文本/错误则返回null */
async function get_msg_KFC() {
    let url = 'https://oiapi.net/API/KFC/'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][随机疯狂星期四] 接口请求失败')
        }
        res = await res.json()
        return res.message
    }
    catch (err) {
        logger.error(err)
        return null
    }
}

/**随机一言 返回文本/错误则返回null */
async function get_msg_AWord() {
    let url = 'https://oiapi.net/API/AWord'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][随机一言] 接口请求失败')
        }
        res = await res.json()
        return res.message
    }
    catch (err) {
        logger.error(err)
        return null
    }
}

/**随机发病语录 返回文本/错误则返回null */
async function get_msg_SickMsg() {
    let url = 'https://oiapi.net/API/SickL/'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][随机发病语录] 接口请求失败')
        }
        res = await res.json()
        return res.message
    }
    catch (err) {
        logger.error(err)
        return null
    }
}

/**
 * @description: 从群专属表情和共享图片中随机返回一张图片
 * @param {string} groupId 群号
 * @return {string|null} 返回图片路径，若无则返回null
 */
async function sendRandomPictureInFolder(groupId) {
    try {
        // 使用 getAvailablePictures 获取所有可用图片（群专属 + 共享）
        const availablePictures = getAvailablePictures(groupId)

        if (availablePictures.length === 0) {
            return null
        }

        // 随机选择一张图片
        for (let i = 0; i < 20; i++) {
            const randomIndex = Math.floor(Math.random() * availablePictures.length)
            const picPath = availablePictures[randomIndex]

            // 检查文件是否存在且为图片格式
            if (fs.existsSync(picPath) && picPath.match(/\.(gif|jpg|jpeg|png|webp|bmp)$/i)) {
                return picPath
            }
        }

        return null
    } catch (err) {
        logger.error(`[派蒙戳一戳] 获取随机图片失败: ${err}`)
        return null
    }
}

/**
 * @description: 每日英语 直接回复 传递e
 * @param {*} e
 * @return {*}
 */
async function send_msg_DailyEnglish(e) {
    let url = 'https://oiapi.net/API/Daily'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][每日英语] 接口请求失败')
        }
        res = await res.json()

        if (res.data) {
            e.reply(`来和${Config.tts_First_person}一起学英语吧，老师读一遍，${Config.tts_First_person}读一遍>_<\n${res.data.en}`);
            // 图片
            await e.reply(await segment.image(res.data.image))
            await common.sleep(100);
            // 音频
            e.reply(await chuo_silk_voice(res.data.tts, e))
            // 使用tts语音发送
            chuo_text_generateAndSendAudio(res.data.en, e);
        }
        return true
    }
    catch (err) {
        logger.error(err)
        return null
    }
}

/**
 * @description: 使用插件内置的silk服务发送音频
 * @param {*} tts_url
 * @param {*} e
 * @return {*} sendable - e.reply(await silk_tts(tts_url))
 */
async function chuo_silk_voice(tts_url, e) {
    let ignoreEncode = e.adapter === 'shamrock'
    let sendable
    try {
        sendable = await uploadRecord(tts_url, 'fromPaimonChuo', ignoreEncode)
        if (!sendable) {
            // 如果合成失败，尝试使用ffmpeg合成
            sendable = segment.record(tts_url)
        }
    } catch (err) {
        logger.error(err)
        sendable = segment.record(tts_url)
    }
    if (!sendable) {
        await e.reply('silk云转码和ffmpeg都失败惹喵，呜呜人家的麦克风坏了', false, { recallMsg: 8 })
        return
    }
    return sendable
}

/**
 * @description: 文本转tts语音并发送
 * @param {*} message
 * @param {*} e
 * @return {*}
 */
async function chuo_text_generateAndSendAudio(message, e) {
    if (!Config.paimon_chou_text_generateAndSendAudio) return
    let sendable
    if (Config.defaultUseTTS) sendable = await generateAudio(e, message)
    if (sendable) await e.reply(sendable)
}


/**
 * @description: 输入返回 webp 图片格式的 url，返回 png 格式的 buffer
 * @param {*} url
 * @return {*} pngBuffer
 */
async function convertWebpToJpg(url) {
    try {
        // 从指定 URL 获取图像
        const res = await fetch(url);
        // if (!res.ok) throw new Error('[派蒙戳一戳][Webp图站]Network response was not ok');
        // 将响应体转换为 Buffer
        const arrayBuffer = await res.arrayBuffer();
        const webpBuffer = Buffer.from(arrayBuffer);
        // 使用 sharp 将 WebP 转换为 PNG
        const imgBuffer = await sharp(webpBuffer)
            .jpeg({
                quality: 80, // 默认值 80
            })
            .toBuffer(); // 返回 Buffer
        return imgBuffer;
    } catch (err) {
        logger.error("[派蒙戳一戳][下载webp]" + err);
        throw new Error("[派蒙戳一戳][下载webp]" + err);
    }
}

/**回复文字列表 */
let paimon_word_list = [
    '怎么了吗？',
    '派蒙可是会很多东西的哦，快点快点发送#帮助',
    '想知道怎么使用派蒙吗？快点给派蒙发送#帮助',
    '喵？查询遇到困难了吗？试试派蒙的#扫码登录',
    '派蒙肚子饿了，帮派蒙炒一盘菜（躺）',
    '想...想要搞大派蒙的肚子吗？v50请派蒙吃肯德基>_<',
    '呜呜...可以亲亲派蒙吗？',
    '再戳派蒙要生气了！',
    '派蒙也是有脾气的！',
    '派蒙有种被兰纳罗拿胡萝卜指着的感觉',
    '别戳派蒙了别戳派蒙了QAQ嘤嘤嘤',
    '就算你喜欢派蒙也不能老戳派蒙呀~',
    '不要再戳了！派蒙真的要被你气死了！！！',
    '你、你不要这么用力嘛！戳疼派蒙了呜呜呜~~~',
    '别戳派蒙了别戳派蒙了......',
    '派蒙要被揉坏了',
    '请，请轻一点，派蒙会痛的......',
    '呜呜，你别戳派蒙了',
    '请不要不可以戳派蒙啦~',
    '别戳派蒙了可以嘛',
    '派蒙要戳坏掉了>_<，呜呜呜',
    '你老是欺负派蒙，哭哭惹',
    '别戳派蒙了啊！再戳派蒙就要坏掉了呀',
    '不可以，不可以，不可以！戳疼派蒙了！',
    '派蒙痛QAQ...',
    '不要戳戳派蒙…',
    '派蒙诅咒你买方便面没有叉子！',
    '救救派蒙呀，有变态>_<！！！',
    '不要再戳了！派蒙真的要被你气洗了！！！',
    '你是不是喜欢派蒙呀？',
    '变态萝莉控！',
    '派蒙要戳坏掉了>_<',
    '你没睡醒吗？一天天就知道戳派蒙',
    '不可以戳戳派蒙>_<',
    '不要戳派蒙了，再戳派蒙就坏掉啦>_<',
    '是不是要可爱的派蒙，揍你一顿才开心，哼',
    '讨厌死了，你好烦人啊，派蒙不陪你玩了',
    '不要再戳了！派蒙真的要被你气洗了>_<',
    '不要再戳派蒙了！',
    '你要是再戳派蒙！！派蒙~派蒙就打你，哼！',
    '哼~派蒙才不是傲娇呢，那是什么不知道鸭',
    '派蒙，派蒙才不会这样子！真正的派蒙从来不是傲娇！傲，傲娇什么 的，都，都是别人杜摆~嗯，一点，一点也没有呢',
    '派蒙……派蒙……才不是傲娇呢',
    '只是刚好路过而已，才不是因为你戳派蒙特地来看你的呢！你可不要异想天开',
    '派蒙可不是因为喜欢才这样做的哦',
    '笨蛋，派蒙才，，，才不是特地来找你们的呢',
    '啊~好舒服喵，其实派蒙也不是很想要这个~如果你硬要给派蒙，派蒙就勉为其难的收下了',
    '只要你需要派蒙就会在哦',
    '你这个变态，大变态，超级变态！不要再碰派蒙了！',
    '你在想对派蒙涩涩对吗，不可以哦',
    '派蒙在哦！是有什么事情吗？',
    '你会一直记得派蒙吗',
    '派蒙不但可爱而且可爱你啦',
    '派蒙发脾气了你就听着,结束了派蒙会怂给你看',
    '劝你别整天对派蒙戳戳戳的有本事你来亲亲派蒙',
    '你走上了爱派蒙这条不归路。',
    '宝宝是不是又熬夜了，派蒙看你还在线',
    '派蒙把自己送给你好了虽然派蒙很可爱但是派蒙养不起自己了',
    '派蒙偏偏要无理取闹除非抱抱派蒙',
    '要派蒙给你暖被窝吗~诶嘿嘿~',
    '啊...温柔一点...把派蒙戳疼辣..',
    '要戳坏派蒙了！',
    '你欺负派蒙，呜呜',
    '派蒙怕疼...轻一点~ ',
    '再戳派蒙就坏了！！！ ',
    '请...请...不要戳派蒙那里...',
    '要轻一点戳派蒙哦~',
    '派蒙都快要被你气孕了',
    '快带派蒙去玩！（打滚）',
    '是哪个笨蛋在戳派蒙？',
    '你是准备对派蒙负责了吗，喵~',
    '哭哭，真的戳的派蒙很疼啦QAQ',
    '派蒙今天想吃糖霜史莱姆！给派蒙买嘛~',
    '再喜欢派蒙也不能这样戳啦，真的会坏掉的笨蛋!',
    '你带来新的故事吗？派蒙用派蒙亲手做的派蒙烤鱼与你交换',
    '猫咪和狗狗和派蒙你更喜欢哪一个喵？',
    '谢谢你 在这世界的角落 发现了派蒙QAQ',
    '派蒙派蒙 - ( ゜- ゜)つロ 乾杯~',
    '把嘴张开（抬起脚）',
    '啊……你戳疼派蒙了Ծ‸Ծ',
    '你干嘛！（公鸭嗓）',
    '再...再戳派蒙的话，派蒙就咬你！',
    '现在是派蒙学习的时间',
    '派蒙陪你玩就是了！',
    '派蒙已经不算是小孩了，一个人也可以战斗！',
    '虽然派蒙现在还是孩子，不过很快就会长大的，到了那时……那个……',
    '好想快点长大，长到和主人一样大',
    '派蒙听说男孩子都是变态……',
    '派蒙、派蒙要按响防狼魔石了哦！？',
    '你是小孩子吗？！（生气）',
    '摸摸派蒙的头吧！ 就一下下啦~',
    '变态！？是、是你啊～你果然是变态！',
    '呼——呼——没有看到危险就证明没有危险——呼——呼zZZ...',
    '你不用担心派蒙会紧张或者害怕，派蒙好得很！派蒙已经不是必须开灯睡觉的小孩子了！',
    '诶，要派蒙上阵！？',
];

/**颜文字 */
let kaomoji_list = [
    '(˳˘ ɜ˘)˳ ♬♪♫',
    '（＾3＾♪',
    '˳/(˘ε ˘)♬♪♫',
    '♪(´ε｀ )',
    '♪～(´ε｀ )',
    'ヽ(´з｀)ﾉ',
    'ヽ(´・｀)ﾉ',
    '(๑ › ₃ ू‹)₋₃ ♪',
    '((; =ﾟ３ﾟ=))～♪',
    'ヾ(´〇`)ﾉ♪♪♪',
    'ヽ(o´∀`)ﾉ♪♬',
    '(ﾉ≧∀≦)ﾉ',
    '(〜￣△￣)〜',
    '~(˘▽˘)~',
    '(｢• ω •)｢',
    '⁽⁽◝( • ω • )◜⁾⁾',
    '(￣▽￣)/♫•¨•.¸¸♪',
    '٩(◕‿◕｡)۶',
    '⁙ὸ‿ό⁙',
    '(..＞◡＜..)',
    '(◕ᴗ◕✿)',
    '(◕◡◕✿)',
    '(◔◡◔✿)',
    '(｡◕‿◕｡✿)',
    '(◡‿◡✿)',
    '(◠‿◠✿)',
    '(◕ܫ◕✿)',
    '(◕▿◕✿)',
    '(#ﾟﾛﾟ#)',
    '=＾• ⋏ •＾=',
    '（ฅ＾・ﻌ・＾）ฅ',
    '（＾・ﻌ・＾✿）',
    '̳ ៱˳_˳៱ ̳ ∫',
    '∪･ω･∪',
    '▽･ｪ･▽ﾉ”',
    '(≧ڡ≦*)',
    '(๑•́ ω •̀๑)',
    '(๑•́ω•̀๑)',
    '(๑ゝω╹๑)',
    '(⊙﹏⊙✿)',
    'Σ_(꒪ཀ꒪」∠)_',
    '(✽´ཫ`✽)',
    '╭〳 ° ڡ ° 〵─∈',
    '( ≧Д≦)',
    '(⊙︿⊙✿)',
    '(๑◕︵◕๑)',
    '(｡•́︿•̀｡)',
    '(⌯˃̶᷄ ﹏ ˂̶᷄⌯)ﾟ',
    '(◕︿◕✿)',
    '┏༼ ◉ ╭╮ ◉༽┓',
    '(๑´╹‸╹`๑)',
    '(⌯˃̶᷄ ﹏ ˂̶᷄⌯)',
    '(´°̥̥̥̥̥̥̥̥ω°̥̥̥̥̥̥̥̥｀)',
    '(━┳━ _ ━┳━)',
    '(┳Д┳)',
    '(╥_╥)',
    '(ᗒᗩᗕ)',
    '(◞ ‸ ◟ㆀ)',
    '▄█▀█●',
    '〜(＞＜)〜',
    '(((＞＜)))',
    '〣( ºΔº )〣',
    '( >﹏<。)',
    '(ノ ˘_˘)ノ ζ|||ζ ζ|||ζ ζ|||ζ',
    '(ﾉ≧∀≦)ﾉ ‥…━━━★',
    '(ﾉ>ω<)ﾉ :｡･::･ﾟ’★,｡･::･ﾟ’☆',
    '(ノ°∀°)ノ⌒･:.｡. .｡.:･゜ﾟ･*☆',
];

// 纳西妲中文，扒文件改地址： https://bbs.mihoyo.com/ys/obc/content/5111/detail?bbs_presentation_style=no_header 在浏览器F12的网络截取到之后复制全部为node.js，用notepad++的crrl+M标记和正则表达式提取，正则表达式（包括,）： "https:\S*(ogg|mp3|wav)",
// 替换戳一戳语音角色在429行
/**纳西妲中文语音 */
let voice_list_nahida_cn = [
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/4d9feb71760c5e8eb5f6c700df12fa0c_6824265537002152805.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c9e517b38d68161fb74cfa0b4349cc65_4347861218592112317.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c3c7e9debabb94e3727336c4ce96afeb_224389990055717799.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8a3db4b5fbdc4b20213a6f7339782015_4928929162694702539.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/991bdd5a3cbc3d4c6f3d9fb6e7b820cd_5388252366411848285.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/207cb052df963f3dcf54fc020d19e419_4430928199053665394.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7832e76193d1097de2ff80337b6f5e66_3236404328533189135.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a7400070efbfddd3e3b0e51ab5bd416e_2613139511899834526.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/ab080a46b594bbea4b8b6b102b57ca52_4873007682934420446.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/fc230f074229f92b1dc53f0e2912c1ef_1475816756907451157.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/d3536f987165303f9cec049968aee8e8_448052117450978550.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/f8dd1a21bd89bfb2fbeafc41a6e6105b_2464061296080033511.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/045279c37eabf825a3ead02cd7f63201_2864513860075272994.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/301a47bae0994cdb3c760ef12e89e8dd_5268233442388273437.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/edcfe93b22d3740491bb9faae1af4fa4_7131208721654597216.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9945b7d5018f0f9ec85a795404d71578_6482272657391702471.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9e95f2369323fdd2b3f1263c2c166c6f_1762500052641269578.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cefd8ce810abfd78c6138bb4a5495a4f_3406507472490730277.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7177d5d7c9e6bceea17dfa19246a8311_947270987568402613.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/3dc9d80439bf04c025d6b2fc3ef65690_8740168104152480190.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/705ad5d58037b7ede9c375b79e136db5_5484548306134050243.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a03d821bfe14fe67be85a63f2e4b2ea8_8723240068787191136.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cf45c3b44b9b0ef5f4a7b25376895f1e_3211550444048016001.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/33367d47ecae0d6ad4cf5d08ce310749_5860058669268042217.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9f3f251b63bc4ecbae0c459c86728645_6727447996337295219.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6914a5800526fc5d1fe280c4e7da2ba6_4711627706989616356.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6bcb97d5c63275be4df00507d1a5e738_7884988217586192652.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cf144a233e0971ef0176a0794ee45ecb_8925036841630699252.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/118487fde490b4eb60fbf1b061eabf60_7337639419392007909.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cd7c3d1a69ab87ca2339e6d2d947073a_4052119550327167358.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b4301d67ff0b9b8ed5f20f8677548490_7133441774208169621.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/38413f05cc7dc3fcd4f9940565701921_1980759413293826277.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/99540436483aacba2d3ce1930554b79a_3245245943114192654.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c070cfee21a5b2155d35c78c714c62a0_6654082250841516882.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a5a1b0b56ee4ce1f2a8fd8f0da780477_5778202358371881056.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a92b16367b39d6533e15d5be368877fa_609355584691653441.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/42cfc993aedbd34011dfb507d98ebc06_1021613602285924429.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b7f9bd671e5f663e2468fae6d70e8fc7_4321126464476483388.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b48a9ca50c160247f092d1c94e895779_5468104429965887517.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/0af43c60e3618ab87754455ae898aa5f_7139785141669538993.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8ae62e175ce0bce2fd154e1b97b6fa63_7159626485468514250.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1c2429b34597c975d0463798b632e507_2104120770632135635.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6472b7b374d3f1b2c853bae4ff9d8b26_6402755683915596310.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6ea026eb2691f06e5c972320178ae537_6325311739293565017.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/67a95b896924cc53b283fc06cd2de52c_6914840829824874357.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/29b267cc6748c7a0d4d465d5e333dea5_3065502828430227261.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/3514888ba1f2d3f06bbc226451ec129d_221575416949828224.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/30b19865c6d20be04366ac742e8a67b9_3786598944525696408.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/ccb495a319c34444adbcef7aa155cb1f_2757660068721522026.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/349d2de21774da45c1e97745b365ee1f_4992449842647632459.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/830ee05eba1aacc607dff41e51516f5e_4807239196801935478.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/06a6fda8919bfef6bfff5199c437d032_2713778252536393556.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/d1919304f637ea8dc455dc92afe2ff6e_1431902895779023323.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1f7eaf7451f9cfcbd3e8cd844b28b17e_6176061356688600031.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/df32f2eab30a7f5879c4606dc09a0502_3078148866148088063.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e61ce14dd018af855e212944c3a86e07_6946138339125005920.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6c346a693c656f3f116d3d428b8b3438_3072149138534909048.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/11c664bd848770184eca5dfd66e89c51_5444646554291536369.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cccd5f5057045c12d8fdde98d4b4116a_7845851735624884706.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1ee24a163e78f8885ed81a0b47b8cae7_6346729070751566019.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1943b45de93aa4ecf3c2bc50e2c37072_5570205242708460822.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/af2ad8de369553cbd7b1c1ecf78b241c_4350686237074109248.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/228f1ae88824bbbdc4f0e96b02b93df2_3172196917569681075.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8931896ce03ab4d2724ff861a5eb14fe_59418760023336306.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/fbc208b80518b91634964ba0783b0f9c_7720219259750270894.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/d02246a2fff6395411f7a1077191725c_3194055208944981775.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/24ad23ef5fde4fead48b52e4492562a8_8054702825063625720.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/f876c09d556b23b9231e9df8d39be246_4572440346090611863.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b84885f5b6a2ebd7bc377984b641ea80_1270250062214132580.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/d9f3e353f1b71d3c601cfa28f15e8ed5_1074679710559344807.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/803a65c8cb872ec0e0038ff35db35cc4_2447311778799308880.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/f5b6ddb7454cbb750e6c02d258c3e03d_8129408147390523371.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/ddf937ea4aac1282901270ba491ece88_986083904906531255.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/f514abfbe4a9358e96038850d6d64742_5784748521077424357.mp3"
]

/**纳西妲日语语音 */
let voice_list_nahida_jp = [
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9618f394ecbcb26441aa52eddd33bfea_1309297346298226467.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/da7ef28976f01a042fafa0a8ed0eae34_6015099485464698110.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/2099cdc449d22b3ec7b1fca5af2965c9_5909736773452979388.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/4dfaaa13142dc6dd0a8f0c55166402b2_9075709493690235973.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c57fec49e84dc39d95529a17681aa0f0_426385927153947444.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/5e5a70f09172748dd165e328631bf4d7_3751941488114806451.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b84e7b4de66995db78e58ef0cdff4a07_7586749649183181787.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/0a3957f08aeb243093ad68ec31067563_6856811942352366302.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/255cbd8bf1d713144e9cab7ffeb519aa_3093463931187389797.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/bc18511e239f33dc99a7a8ede2fcf6f7_28649543757173053.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/26956f53be88db3361cc90d49ca24fcf_692549954931591459.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/12695e6c4175db08ad78b5f350dbeb18_8902102561885638896.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b753e7342a3917a973955cbbddc81a10_6051768560482094263.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e08f96eb7fb4c800672284e21666679d_2910250819374153953.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1ab5024bfad5cffae3c375e808b14685_8559437828000753362.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a39a640b62b4f9c847c724d698b14d6d_7906246816109175069.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/faf5dd91228f031716eaea2d0f49b6dd_4491756252149822900.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/19d8bc1279c85f68759e10e6a569dc1d_2356692341249374554.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cfc975665aca75a23525790e6b97d1d7_6310360448788764608.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/fcfc3fed2d1f18c8fc6cfc81300daabb_3979752703275654144.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/bf43986aa06f00e14b156fe29a6416e8_8556317221197109748.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e6b8128c274c65f37a6f76dad501b120_7955838119123029804.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9ae81461f4d48c2570a9be7b53a7aec8_160042443352611798.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/446b71d6d529548231ddd996f71b3e39_8529422098314723436.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/fbb7609415ddbb300fa3d604159c17a9_5722754449130766043.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7e333be00d9170e9a3552e3635679ca5_2379556676548757741.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8bf2bc49c4650a726d5e2e3ddd3446b3_4366611915468452784.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1d3b1ace4828d38c6bdabc8730c81862_3508012725900435523.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9bde2d2a1835dc70b98d00ff55f13465_6033197253734364906.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/5bdf8fa3be6b807d37522609452a4e07_3289261393587027226.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/83832044d640f7f5038d9d1fc27ecc35_7358589581799564527.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/754f04fb6804b4db8a38659722344f62_8495326194597949691.mp3",
    "https://act-upload.mihoyo.com/wiki-user-upload/2023/11/17/16576950/73e8dfc659b10d1ad62454297b4bbf23_4227008222739534384.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/48abf0cf8d521025d42cc7d23b77582c_7798263473768881813.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7db7379310a533831daa13488b53f26e_7101089858692314715.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b34236eb7c75c02a012a46f57bac5327_1540930641236554801.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e17b1b340687fa819c3e00f69c8a84d6_7730856045764622661.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cac4856677691616580be0b5e3e77f1c_4211314302908436967.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/2a45b61f00dbc5f3041e233fa685dfec_782536588715147611.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/58d27d7166d910ed2212117f3b1cd6e1_7285089167605199483.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b786ca5bdb1fd156325e858b5a5ff3e0_6313769510382178712.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a17fe49d93f1544f9ed0b628ce37b49a_6824289757577162245.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a54c12252d0b5750b057533f4b426f7a_4659443818001566940.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7b435d79354e67d107b6992aad63ab12_8855377249169909275.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1d013e4bad5ba805d201509824364911_407770335210358019.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9a631eeeaa9f267339b58ad2f5168869_5240043013157031755.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8f61f53ca3467096833d1b0e7bce4a09_2456302665635455660.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e06d08653816661c0a7a0dda6a116512_1080678624940915542.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/3ded76ec8043992cd97f2570cbdc259d_7479823125492334458.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/ae9cf73ac4974494a9b9b67a4ec49f29_3213429599286108709.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c415daac02984d5a4240ebf08a6214a0_8450800762938231044.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b179173ecdf4b19aa3a23e68ed8ed004_4790983662436211151.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/28945160cff7624534eb1ecb07349435_4725309128333098185.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/f6fe95a8e1153d2fcd0bb5a5e52b61e6_3230597210100269490.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/fb0c4c5d15c7abb199deb0a6c36294be_2533068749501054813.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/847f15b883fa882079ccb14f7e3e33f7_8948374809700521096.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/1b2476c40076dd309714f4a09f4a1d9c_2407410005150309804.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/1b99d9c7805d6adfd30b1dfdaa5c0d93_7547093467020935910.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/05ccacb8afb89fb2fc359762f3bce7c2_966633742120071859.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/f66aa235e758a86e537da46149569791_163981651221530351.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/40fa8ae75c3bc5b4672c981ce8b4a010_3481445453273660685.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/8f7c0e643aaaac3f97155a6329de2421_4520186195937945464.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/b5935e98eaf7eae9ca6ce9ffb540db4a_1510977936002931873.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/9887c16536f084bb5eea40b808a147dd_1913051754333563104.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/21165429404661fcc1acd6f8803e4e99_8059585252433456046.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/caf729f903e8215fd2eefadaa887e135_4965916881562178528.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/5a7b849391c60cf1ba7c7780020d02a9_7203504904268893558.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/5af799e0da2363090dbe20852154b30d_6897036521752361269.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/f540beb8220663e4176848b05d42babd_713218639536208186.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/f098ae4b0d9cb13675f1341884ce5a71_4202375089865897142.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/590e1ed8c4d0b80a1134f7b25c8a0399_4980805968079204365.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/476a9c6f1a81a929e9a4757a61659e9c_4206194906698891832.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/3c1df4f007d0bbfec7a228f3c6e6cd56_6046117771996382775.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/cfb6aca0df50accc15689367bfd63169_314880694218826096.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/fc316be1ba9822ff179f99125541f92f_6299079458058565802.mp3"
]

/**可莉中文语音 */
let voice_list_klee_cn = [
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/070931802fe095614d6b2478873d79d5_1506586020611038144.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/e874fde7a2df8960996ab49d71a0ff01_8712883441075318980.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/cc7d533e43fc24285402c23539606973_292065080366019152.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3b938c41504c3d1ecb2ce32c71e716a3_1579780281202317552.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/58038f2441dd9970131e5c2e54779a46_2496014067294141831.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/6ce0f70c3fe47c1243fa5ca370abd6f4_4834510319927679904.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ef9492976ad889072913a783ecede57b_686818756687861840.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/fbe0e1835e6bb4ab6b8754b9253ed015_3497300224056531649.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/0a0aeee9a7e59892e934f6c6c61baa63_8382389470834281270.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9917a3f395aac69e822ed3aaefb93aa5_5193386752742783507.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/14630f76d4146bf828907bf1c21b0c4e_303258221954164830.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d99e9f93f400ec9b01a1b3d8f237492d_2272472404523581768.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3657ba55b83c04ad3f41d81134ffa58a_5773232172244060624.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/4a950fb7ff1767c8d30b9fd2c299675a_4374894354098055425.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/34f81dcb5366f590671f421023fe0055_6345744994202226252.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/00cb0fdb7a6b7f8ccf605fc2872c1624_4977767456801309000.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/226a23cab519e712c6fe8be02a826b10_4469796741961005271.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9907ee19c0afd6ef25690d06c24ffd2b_2065329402475484497.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3afb3af0b2d7023c1800c3f690b7d0f6_2605360361373480548.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/6d6ca28b9b46a94de83ad207dcc9ddd2_7867911277447062879.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/663edfd0a9afa8684459bcc6915f1040_3154486409885749302.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/91e4878eb574d6fc8eb0a250d83dd3d3_7757379225244489145.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/6145e54c9c19f507614dec81f82388af_4197264470272520168.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/00fca10d78825019ceeaeb3673b3b2d7_8671887899744547178.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/1e8ea58c50697283a7511ef5c3ff3eaa_4269867990192525922.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/40be283773073969aca539475aba3c4f_631647081684879462.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/fd0da50b353d0857fe24eb2417a45030_4122272252641610309.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3cf5cc228618af079c62f76a2a7f53ed_5175408850788794103.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/7f0ea6120be4cb3483a2cc02c279cfe2_7992586876938122084.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8cc0144981ee834ffd355f584d8e71d9_5693662597550564806.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9fe11e195e8b0ff26ab7709be1897242_3452155766859078848.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/cb6bf3c5070f0c1b39e9fc0f19eea2ab_8769146846159189277.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f9b265f61178b71bef1a2ab5b94a68bf_6742321921477277144.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/56c7d328c49d878fa0357b0aa7129e5c_1969922887105689183.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ddaaaee67b4a8bda02973944ad80f793_7383538945795936718.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/642aeb1bf59636b7bd6e6c2b2ddba454_8836065197350260208.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/eb8ba1c8af42c1f72775a62228c2d838_6637181170559146732.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a5580cb7ed1c4c05ee50dfd97d24bfef_2452886019779637446.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/df7b24cb5030bfe9c0b7666bff14f290_8043192095783828020.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/b2e47f807b6c99c5a6c28eb4eaa5d68a_1806043118803603346.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/70d7112ce41aa8a1f03e6e21a1d61ee2_7471259852136363400.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/4509588f663286472c9d66fde3a4c5a4_6773837471544735863.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f39cf8720b9b25a77a559c1a9b7df03a_9156623411882096033.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/80990d8633d3c74fe02f724bf1120c57_3561279677544930446.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a6d2c075200b466ec74d37408592721a_7453147571209780699.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/70e8fe1f7a09b69d796d76e7cbff120b_4465361512106417376.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/b4420446f1ea54d1a4554634fca92e7b_4376444641605091624.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/e788424e6ad025bf84bbf0ff1e08b8f0_798562413049778558.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/59e77c2857c1d92391fcc282bb86c1a7_5948059131208222178.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d36ac87ecd52fcc62205ec536f57e2c1_6195177294285356144.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8fc9311ada6beeadac999af1ec4fde66_8175450175933977814.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/1208b02599b7c4509d2a09bf2704a0d7_484036794698843811.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d5b42b37ac789191e299e86c21e6ec98_5198322891765781409.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9843c466371ffea246b68a6fcd1590c2_5808403279174752279.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/429281fded26a537aa7c33319fa6e388_172369884487879995.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/53b960415e655c68aee8150ee4dd6f5a_5617744071096283711.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/0fc169759464ba98265d3e892b7a45b2_7186646768586962710.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8909409d06cfcd0d148ee40b8e79f157_8514093078758354658.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a75cfcaff168e2af4b1edaff631b8ed4_2615022269602967702.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/2adde4a2f168531358fa7734eff7a280_3638783189055140729.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8686189a1e06a1335ead7737c101ae6b_1387925286782657736.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/635ca2ee51eb9f40bea9970bbea7be17_3407309569219772336.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/9fe0227957deaa31df14d281fd412859_564931973302765541.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/00f73cbe63fceb10b0e0d2d9f12bbcd8_185512756131729570.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d1d180c355b1668924a7120f6a67d20d_1112762341226112911.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/0accfd77800e1c7786ecd6f3be35f501_6068679987658256926.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5877917847befe542ddfbd17b7fa4229_8228501230944800024.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/82ffcc30338df652b1e27d06fa0388e5_1036088437212315874.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/dbfbb10b4b74498954516608c93b119c_2820970912512892128.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d43c16df225ae0716e301ce12ea4ab5b_1924377028594916575.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f0197602e78ac2024bb77faf40f1253d_2120966796001540679.mp3"
]

/**可莉日语语音 */
let voice_list_klee_jp = [
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/c32d88d51241cd35323ebaea64629d61_8312357008820297292.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5ff8f673dd7bd22c0fdf16aadea82708_7922150725969558599.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5071c574c695056a7bdf054d8bd8364c_3109300904133737560.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/c89b2f38cb80b0c267de98151f6cd19b_8839219126382193926.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/c961b9e46bdfbf1a2aa93d27b5cf955c_770569639467782721.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/342ea500f2c320ba021d8c0c38cbd705_3034306159881972571.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a2ad9dbceb6db26b43fae49d95ad483f_9031743279866482184.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f2af3712b360d403baa0f3e0456e37f1_4842776425191132015.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/e3988a6c9e1158b6600b0cd3b4bd346f_462251623290834381.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/427ee0e130d3b6c76dd705309f613a61_3735406025701634850.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/dc13fe1904b89db5f4cfdf89bccf6b57_4430033957210267849.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/47b50ac34d091ad5bc47dfbfdf539fe9_1271913171098077186.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/42b8d5a22925425686182c221161438f_2060805273477770801.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ab505e87e4c8553e7d3fbd6481f38568_8015530443664961928.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/127ffbc33a0df62874c1493f1d6c4c5f_3293510774300663082.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/6e0d5f2fa350bee79676ea9ccdd472b1_8654003192986976300.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/335f44f3a493541eb13f5343d6907b94_5293223783758492415.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/c180ba58c01493f59524b45d65794764_6921449727677662650.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/69f20b39d10f12ec5f66e11b8976dc28_5445296473338904416.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f620310a2f2d3301a1b0fd82e06ce937_8266290288651757502.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3557870aa4a0135e8f8ae6da18beaa66_7950333882417422396.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/e69d7dbb257e9b24ed0daa1bd0734e19_8498258315570532600.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ce63c13543fc16968a6daad5c212821e_8029301817388326757.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5c5be6aacc518e1b6fee94f101f54b10_2407592394393491733.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/69487aafabc0ed14747ecebb616c8ff8_7154271888927019780.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/90d72620adcb2f5981532b9f06a8387d_8972641644831350539.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/612ef1dd04ee24a0f14ee682f75f4c17_3780374894610595239.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5f94c5553eb166f93913ef0cb5ba2898_3751389255707608512.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8ef88018ab219aa842dc66584c5684f0_7915188790916715644.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f16d1ba57ee6f11fe54007588ba61fac_8128982987229420192.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f2899d3663d616b43a1e920f55996904_7175066193898781892.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/2db1dea7ec588bfd3acf58ec080dd335_8225896888881974739.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ddeb60f795da56a460f23d123d176b3e_8158009244000702538.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/66dbb7ce8067f7b61510b67ac8b961df_1154350448939859858.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d8ef2158228161af5f7a43c0ca8f5b7e_1658330905952653719.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/253e875ee45aed386ab6a670615f3e28_7322420122030223165.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/dc0cec10ec1847fa9c4633b0befb7a7f_2308602718748064698.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/fd5134d641972f6655b15b510c0034b0_4867952124917910069.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/1544dfe12dd6e11319af2e43bf8d4717_4572925176157871826.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/90e5f411b628ee54788f579404d8bf3d_1668398800942861705.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/f20d80552431300c237e8100aaddbb44_5777146996041599302.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/2c128f6325d6ba8b143a5abd9c4e6ffe_1222111662389900248.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3f0983829416b42037b59eb7b8700712_5845034122562304504.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/aba3e92f9abe6c62d28deada729a022f_5451877407085821637.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/70b78afa7b006926b29278ae563ba814_742975168566022601.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/04e41a8023c1f413005b41993f727ab1_1607877740139732452.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ea882e53b682c3ad12dd57943befb191_832309901759984352.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a6849d9204b49b08519bc86735432e29_203795779903913065.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ac5841b312b6797d87580e279fdfef51_1521965175631031811.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/22290e2d8998fe8a7089151b99c1f73c_920389675062354895.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/cef6e66d51885100361cde55fbd7906b_7665932270213526511.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/1fe209f94f50efe7ff39233ebc637246_4002625514940883470.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/48b4293d357c3105a8ed444ecd76b91a_5220187133617685047.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/980d84e28b474b9d45ec9278fe2b191b_2967926078731525835.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ba0f8b93fac6d0a1d1d9d857af48a77b_7092291632054223415.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/51dd948031a62ae47595215d1dac013e_7259205295736257854.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d47a57b60f86bd12010bdcfb21986891_721587458383871382.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/7662bb3917530463624375c9906b13aa_4469214081473347052.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/7fa11cee4da33d7d97e120d882ec9c2c_3723031215414350948.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/583b33fb861d384d8aecc880d8b7849d_6473146738418944005.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/779316145661558680c1daf97f2e455c_2285843843955579993.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/0666b15bc1c6c0a8e4d550d000d6a72c_1171327585244014119.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/6c4bffcc87acd880e6e897587d5030c0_8343957829611442167.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f03c3e3757cf0e16c52695900721aed7_8662982263319420642.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/416d6a69117b3a469859a334062f84a4_4240507542425223945.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9eb9aa8dcd030e4f040af17d80a14c9c_4198687886838945530.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a2f9f59c1c3b7a3cb00aca84ac2c2627_8893585962004993445.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/7556dc2ee85bbe7d0c465db078128f47_8313735442353061567.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/320745dec4481a140c2310b4f5e40f74_2985518240647495728.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a33492359439a3e22770070d87fa70e0_6191596892365099587.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/50c84043968698d2eff3c157d252e8b8_8533309043989857030.mp3"
]

/**白露中文语音 */
let voice_list_bailu_cn = [
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/e10b3c41cf038bc38f88c549ae163fb4_5484811507673522862.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/05a701855f53025f19d601dc7ce962b0_3648955366383430810.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/83e777763c5946217c12672eeb840a39_2425656402104018854.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/85001dd1857c1d584a6c77bc40cf71b9_8138502831187870405.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/05ed1b8a5beebcc3df0e2149e0e7879d_6203754370481205870.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/7667a1ba8f8833e31bcf798f82206c6c_2169025848709261579.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/57b2c8289832400f4a8124b2a599b4d1_448902642801007126.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/a6ed10f6032a75a1ed5a9047aeaf5234_5424458413242930741.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/2981131a23822a569a3611998899d514_8358502188106373234.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/078bcadf5b93e5726007c7786b75b40e_3509137312096729281.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/09ad6641e40d724cf549346c92572f27_3657833950407003635.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/685da5251a5b1d94857eeec8e6374579_3745118544901249681.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/deb83e1f0e638d4d4326a07c36a6bd90_6744413265484291949.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/c1aceee2ec46180bc7c27c43a0368260_4236133232222874118.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/4364fd4a06537c6d3a5dfc4013c0592a_2602233026851325169.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/003ceff510f0eff1b1e327eefddb773d_8120732812763932917.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/45ee9bba18c4b1e9a52ffdebdb93bc64_5411801909812051873.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/d2773db9e2e806c8cd18c1322df1f2e0_2057011924910173150.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/7cc31d3f3fa7668c5bb462ff7a048bb6_1695134834803670466.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/0cec2afe5d526e7c5066c9796b260281_7571421041392520150.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/68e664692e7c0ded9afb40b1926e39d1_87960581468534731.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/7fe66540f8787d15d5bc90980d0cd75e_3890730365876232107.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/281b5b5843adae20fe05a0b90a8ca174_5321523595562990015.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/d8702ab4cb8e4eb01716a18d3ab4af3e_1310618342737479899.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/f18b9f262b2d56c69daf82c2bfd96157_1206644056379118989.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/8ce73bb77c8edbe989b60bb1f23e92f2_7175578195957379627.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/73e76f8bd558d51939b8505a6f8f46c8_3776814028163671167.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/837207584f661f78ce6e7f5140637301_7760095864609707552.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/03d5cffb6cca391b373dbe47fde11287_1857629774179517826.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/1a6a963107e61b83d95bb3211ed1a473_8202683174616222637.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/5f618d8647393f7fcf44e538132faada_8095480391610268126.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/df87379d38c2e3ce3ade94727e6e1426_7485763377972896441.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/2c2c95f79afb74b6c721e133345d96d4_5597451206369949943.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/06a8a18de8f8ef7585f9b17a37a234d8_8404510610031078399.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/ac08bae0cf7055a6c76ea4f08e92b7cf_5421791002661457153.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/2df1ac60bcebcbe5612418a875abb184_6124695680650475449.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/2be8130cb759f846b4d03e7b8ce6591e_8305224628666172284.wav"
]

/**缇宝中文语音 */
let voice_list_Tribbie_cn = [
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/1e3a1a02be551f5035ce9c5c1700e5db_6132564444120771118.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/a36ab02b3b7ac70dbbb68d9997e20dbb_3075161167343807957.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/7e23b0505384f585c14d26403e8d4618_5081190738792815955.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/7eadeede9c1bf2b85314ff77ec78befb_4571608880270931195.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/0f8090aa813a156dda2727a8155e82fb_9002856490172492651.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/b1850f38912f80eca4ee44e4fa438a6c_6790872117599038339.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/363f487bd4f95d1c91e0bb421f3a1728_3096856195209116009.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/e8efa72ff894eeecb03897e12d72ed25_1559011616637252566.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/39dee3f598d0b9600ed1930dec19c288_821746775899255088.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/b1acf6576ab33103e4f9acd26b983f22_6149792204257135801.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/2e382cb0ea16c7d30a42ae07c7b4dcb4_7592635929507684728.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/e2b7d0638948fa2bc7afe2951e4ef2b8_6390771589727405436.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/5687e3f71a7106d6fe5def10b00497ef_2197947232427554574.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/b7933c3fd4539f1b335d45864d0fa520_4717552987335605343.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/2aa102322c6f014c2bfbf45350a53d67_7660845552926602397.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/b98b97a364937231397988d720d1ab85_2543452923927475694.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/0e28c93c60af6d77480da93be68d05c3_4704814195311582291.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/d3cfb0067c1b5daa13a78e3cdfd22609_4387931694985449286.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/50cf9f8805ea50f859e9df7d8bf99ff9_4793528303806266944.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/567eac69fb85ce2e866d48bed697faa7_1667578589904249634.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/0e6f1d4d7e635f32b1cf97fa159de0fd_8742940288068537425.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/a8f0d3d00779fa1ad341c7579163337e_8588069127170961266.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/21/197948068/ed6a8927882a7eeac4b7b0f85c013519_5949499166827370302.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/21/197948068/bf403f2d0c2b46ce5f86c0aefd7fdf5f_8412080517624197406.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/be7e5bf0f4cbcda7bb03fd34c09534f5_8149520212864577236.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/76800602770e3998349625d36eddf212_1662231015746978761.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/fb0e9622464b70c3212ddc45ab22329b_4410288340421110937.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/13526449b8ee42700f6dd02425488c5e_3022395483473158317.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/f4f0a05daf01beeeaf8db83cb41dc785_1610923450175865711.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/755a33c96d0d8b85381b700f1cecae8b_1430827915176056448.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/9f41e7af35c11e40ee58531c0d062635_6082287336374711005.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/cac7952d9e3e385011046aa03717ed70_1640895933038068955.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/bc86ee62666fc97138d0339bf9713147_5068767237324810759.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/7bdb483b318b4372487256cf5d981e6c_7463532586678843717.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/1e0c987a92fd6807a5d08135a8d8ed99_7361862765616956846.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/e3e42dabdf43aeb9c028a5437fff7897_2611192716446224545.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/89a543d735541ae69eafa0fa3a3f2054_577453379214524158.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/7bd5b3528bf223681d7346df92e039ff_3176931041805124353.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/896cf0a62cd10176ceef1e99c32d97dc_6474921546524430787.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/d9a155dff4fe696e791ef0b0b13b3bcd_1681075715811604831.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/889ec570149a99c73a0783be637b3c21_2896560917847261639.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/bc63e47acf2c33bf06416b3882b7dede_4693809548889135611.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/a1587016d891cb2cc7307aa724a0f8f8_8648855704806725318.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/de246ffb1535acc817c270c434a3b823_8638426626621550564.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/eff272106e61e40061e6f4f267f255ef_936698611352252734.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/4df3dd86e00427441178fed4b597ec02_6576786000613249443.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/c921b887f40267bac6a9d2b90ceb8364_6076243768051285891.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2025/03/11/197948068/7aef1a91f1b1cb0225b8392c75519935_605341951674668166.wav",
]

/**派蒙和荧中文语音  来自：https://wiki.biligame.com/ys/%E6%97%85%E8%A1%8C%E8%80%85%E8%AF%AD%E9%9F%B3/%E8%8D%A7 注意这个网站会导出很多重复项，自行删除；（2025年9月30日）*/
let voice_list_paimon_cn = [
    "https://patchwiki.biligame.com/images/ys/6/67/8jkmmy6vvggq14j7i2gj7tmgla25x7i.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e6/floply2k5a3mhrvkz1l0fodkkwvv0lj.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e1/0li4gs3c03ogthsc57quba9ikv5jdq5.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f0/snbk6gkgnwcjbmqbix8rsox2i0zelbv.mp3",
    "https://patchwiki.biligame.com/images/ys/3/3c/qh19dch6dsa3hafw8ivodt8l3gf0r9f.mp3",
    "https://patchwiki.biligame.com/images/ys/2/23/n3mi9ha8ltc0t56zwxif2fs0nk1pxg1.mp3",
    "https://patchwiki.biligame.com/images/ys/3/35/95uzkpckm24j1taz4z3rgysvkzow6em.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e4/i9wkxi9enwmrzpenrmzfnmqwhulixee.mp3",
    "https://patchwiki.biligame.com/images/ys/a/aa/f6arbsvfk408h89zvk632uuncy1c446.mp3",
    "https://patchwiki.biligame.com/images/ys/8/83/iirpdvj8caryo1fqisbodo9yq4b1xq5.mp3",
    "https://patchwiki.biligame.com/images/ys/8/8a/t241psiwz5otx7igptuhulj8s4op8f4.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f7/73gzk5ahidq9wyd9mfcw3wap12xdr5q.mp3",
    "https://patchwiki.biligame.com/images/ys/8/83/1eg0pwgv8jx3bk2pjyblpvsbauu677o.mp3",
    "https://patchwiki.biligame.com/images/ys/d/dd/dij7wlbpjpk06ptbkfpco6t4c2fgfa8.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d8/gxkg40seu0t68qwx6bvnvq6yd152598.mp3",
    "https://patchwiki.biligame.com/images/ys/5/5f/3ewg28k6dql7wybb97ol14gk4vgqacq.mp3",
    "https://patchwiki.biligame.com/images/ys/6/6f/97slbx19m2kqsmy1hocxcujdxk4s5y1.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b1/43os8m39bc6kreru032iz29ckm4gsc8.mp3",
    "https://patchwiki.biligame.com/images/ys/2/2e/njj49jckf677r3ylka6tdls7dcbobia.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d6/aut2eebcdd4vi7fc2tgyhgdi6ciba2p.mp3",
    "https://patchwiki.biligame.com/images/ys/5/50/40ohb216tnomnm7oh3ypbmvb3lzjvsv.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9f/fgcn9tnvq6400z1ybwi2igf97yzeq6a.mp3",
    "https://patchwiki.biligame.com/images/ys/d/de/ivnuttqa4m7brjoghmt09ngyhtj639m.mp3",
    "https://patchwiki.biligame.com/images/ys/0/0a/ef6b3fhk3e70txet5yss5u5b3e39j4b.mp3",
    "https://patchwiki.biligame.com/images/ys/1/12/7pt4stxeqy72te7us7vwghc5ok6nuqj.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9f/rxlofrsr2wyuk4kpd2fsbf1xbuu5610.mp3",
    "https://patchwiki.biligame.com/images/ys/3/3f/q9nbw5x994dgj2628ba1xpj7u6xpg0m.mp3",
    "https://patchwiki.biligame.com/images/ys/9/93/pku14eu1j31qpdynx4x7dj3t3fztwwc.mp3",
    "https://patchwiki.biligame.com/images/ys/7/77/3mkauoawlx4mmtv0f4fi4hydb2fsqjc.mp3",
    "https://patchwiki.biligame.com/images/ys/6/68/2nzwn6oxtmgvfz5rl46rplu7s86escn.mp3",
    "https://patchwiki.biligame.com/images/ys/2/25/lx2yugprffrd2vrc0ujecncr91z7bha.mp3",
    "https://patchwiki.biligame.com/images/ys/2/27/f7vly6jxt7mkb094rtjelv4zt2xfqow.mp3",
    "https://patchwiki.biligame.com/images/ys/f/fb/ddbwgy5nh64oniqq9o4j79hcupuzaab.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9f/llaabx2074sx3cp9x10zoveomhr7tqe.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d1/oipr8v11ksx5tls685njihiq9e6oqxv.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4d/sia1pgqvd2s57kx3lkxzj2cocrl4mnj.mp3",
    "https://patchwiki.biligame.com/images/ys/c/cc/75lgy255ks4cmaz0zthclrv10d5s40r.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c8/i66ftazyt09ersvdnn29gj73cirvkid.mp3",
    "https://patchwiki.biligame.com/images/ys/7/73/kk7tbtiz2ev1b54oyj134okcukj5vu5.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4c/hvuz335fuxjc5y401yh21k2vmqfqgxo.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f6/3ynuavs2cjqeen2z50zx7z9ikecxln3.mp3",
    "https://patchwiki.biligame.com/images/ys/3/31/5yhycwpnmlaobyvyapjafqmcjsest0o.mp3",
    "https://patchwiki.biligame.com/images/ys/6/68/cuwrkaqd5kb9gucuv3qdyl54ewndse4.mp3",
    "https://patchwiki.biligame.com/images/ys/6/6b/48j43q2707dxv8mgc9p4y0nfc2vr6nf.mp3",
    "https://patchwiki.biligame.com/images/ys/b/ba/pi54argmo0sww2llq2var63a2gaesg2.mp3",
    "https://patchwiki.biligame.com/images/ys/2/2b/37rjuqogqfpu2t7rcee45kow9zj8510.mp3",
    "https://patchwiki.biligame.com/images/ys/2/25/htbb1ijwpbxoai75zqmt0olirf5scey.mp3",
    "https://patchwiki.biligame.com/images/ys/1/16/bbw17xocku5awz9fbfxi9r4epo1qtxf.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b5/lecfqhjs7qdfbusvyl3by0kusles7j8.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d0/fu06vtgw17dxv7v7lv8gmg8asr40xq5.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b6/smuoqwmjas2w6aykd9pxgn05jwijvsc.mp3",
    "https://patchwiki.biligame.com/images/ys/b/be/me55n815mqzbzkadnb7afwsxlu3oot6.mp3",
    "https://patchwiki.biligame.com/images/ys/d/df/ielhy3083tckcv442eo2ghvs78wzo98.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c3/mylt0ui7rosv3qwh7457esgy07ed2fx.mp3",
    "https://patchwiki.biligame.com/images/ys/2/22/3qkoounbjk4fzj95mrsu9shbnv1mt4g.mp3",
    "https://patchwiki.biligame.com/images/ys/0/02/1t4z6wjev4g5pzh6s3pdnlwx3gydu2u.mp3",
    "https://patchwiki.biligame.com/images/ys/1/17/c7oia8glhl4nscbxulfub4yqr8rnll9.mp3",
    "https://patchwiki.biligame.com/images/ys/6/63/1qqmosl270eg6mtgmrzp037uq4606ke.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d7/n1zhrxlnu9ouubh61gbdpgzf2sz5o0y.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c3/0aev0hu1i7t93scmjf0rytjuu1wxfdj.mp3",
    "https://patchwiki.biligame.com/images/ys/8/86/kw3se47vkfxlsp43l8h6ofxxrqj7xl1.ogg",
    "https://patchwiki.biligame.com/images/ys/f/f2/faq7arjr9r4iqblspq0j1ih2489ww82.ogg",
    "https://patchwiki.biligame.com/images/ys/1/1c/tc16q8bqc2rrkgh3h0dr6vzhthkdgrp.ogg",
    "https://patchwiki.biligame.com/images/ys/2/28/ogki9npxfsl1i57ru23z26r2d8qvpwm.ogg",
    "https://patchwiki.biligame.com/images/ys/7/75/n6n4jnyk86d5dknkcrs4r82qcqremoy.ogg",
    "https://patchwiki.biligame.com/images/ys/a/ac/dbra7rabbk29avggk3ya7jtkj9yfvwf.ogg",
    "https://patchwiki.biligame.com/images/ys/a/af/bfusbtmpug8pqmx1cj5mt5h14apr8qq.ogg",
    "https://patchwiki.biligame.com/images/ys/2/25/2ajy4y7m9q3gi21m06mptckr42tjqg9.ogg",
    "https://patchwiki.biligame.com/images/ys/0/04/m7npcnwixb4l4hgcwbnj4cbfur3464q.ogg",
    "https://patchwiki.biligame.com/images/ys/2/2b/g61pldvpidpv8lgqfffatsvyfwlawh4.ogg",
    "https://patchwiki.biligame.com/images/ys/6/63/hcshb8teu7co3ysba68xdg7xnhq4ukf.ogg",
    "https://patchwiki.biligame.com/images/ys/f/f1/dt2y7b13n1pf36qut5n9gugk4s7u6g5.ogg",
    "https://patchwiki.biligame.com/images/ys/9/9b/h1vkckhfjo8iysr8nj7j1bicpudv4s0.ogg",
    "https://patchwiki.biligame.com/images/ys/1/1b/mi1yqwzayud8ju0klwoet1igxwvbhab.ogg",
    "https://patchwiki.biligame.com/images/ys/9/94/ogi7e7guglpswk06k73q4f1zo3htbnk.ogg",
    "https://patchwiki.biligame.com/images/ys/8/8e/rn7rup6w36jtdg1i2r9hkbflr8e3zkz.ogg",
    "https://patchwiki.biligame.com/images/ys/9/9f/t9oqwo4t1phlpd5bfqche7ks2ouglx4.ogg",
    "https://patchwiki.biligame.com/images/ys/d/d9/r5vde5m7v7yvhjfsms5lmscjkirffej.ogg",
    "https://patchwiki.biligame.com/images/ys/f/fd/mxvu8e03xoxfw2ul24f1x1qmw4svf7c.ogg",
    "https://patchwiki.biligame.com/images/ys/3/32/ie7ojkn4nfk3b7f0k7s8arybuorxqrx.ogg",
    "https://patchwiki.biligame.com/images/ys/d/d1/tvtizcpcuqc9a5fd65bpubhprl74ny2.ogg",
    "https://patchwiki.biligame.com/images/ys/7/71/9avds504p4j771477mqg8675df80ib5.ogg",
    "https://patchwiki.biligame.com/images/ys/7/75/l1n9got27abb9f7478zutxbbvfachn2.ogg",
    "https://patchwiki.biligame.com/images/ys/3/3a/aptipo5a0omfjthu2eraxvsblf6x5v6.ogg",
    "https://patchwiki.biligame.com/images/ys/1/19/3vor2xmpv272z04i9x0patiwr4qzep6.ogg",
    "https://patchwiki.biligame.com/images/ys/4/4f/iuv8nrqwaaa1kd2y2gwx5mogymwu3vh.ogg",
    "https://patchwiki.biligame.com/images/ys/7/7e/bydeshaxac1nlv6kr8edwx5brtnq1yg.ogg",
    "https://patchwiki.biligame.com/images/ys/2/20/e49574a6dtm6d21i0encjtpmartswm9.ogg",
    "https://patchwiki.biligame.com/images/ys/e/ed/0ycea9rmml255td6ys84rw0vxqt0t8u.ogg",
    "https://patchwiki.biligame.com/images/ys/2/25/qp6620azh7tgu2bubs53gvy9342lzg8.ogg",
    "https://patchwiki.biligame.com/images/ys/2/24/i9a6tpj51iusr0z87vzmz5vob96tm2q.ogg",
    "https://patchwiki.biligame.com/images/ys/7/71/9uh4378vkzgxvci48d7i5x90rb5bnpl.ogg",
    "https://patchwiki.biligame.com/images/ys/b/b8/7clglitmz3y8d1fodjjcdyftkzp1gbf.ogg",
    "https://patchwiki.biligame.com/images/ys/4/4a/80bpat6s9u6neb2pisgpaj3mwxt5u13.ogg",
    "https://patchwiki.biligame.com/images/ys/2/21/jbjkcfv2vr5yg6cxktbkhblfjf6t0ub.ogg",
    "https://patchwiki.biligame.com/images/ys/0/04/d2pqcg2bczvdciu681y3k3bfeglj357.mp3",
    "https://patchwiki.biligame.com/images/ys/3/32/e4ea8vx1jmw6mut9xc4ue9vyvygpul6.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f0/qntqnwj0rgt8izyu30jxcduxizuea0w.mp3",
    "https://patchwiki.biligame.com/images/ys/7/79/8rlen9ai4o1nhenhzny04peanu6z33m.mp3",
    "https://patchwiki.biligame.com/images/ys/e/ed/ijflkn2qe2npfwk93lta98lffw0b3j1.mp3",
    "https://patchwiki.biligame.com/images/ys/3/3a/n9t4olu0i3qc8r0b9of2i614j1ge3p2.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7a/jiuyt0o1dan7jjadwb14icpkxpbzijk.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d9/cqqfl5x6njmdc11yqromc1vy46is35j.mp3",
    "https://patchwiki.biligame.com/images/ys/6/62/nutma6okxydr6k4cpa136w3mxwvt1tn.mp3",
    "https://patchwiki.biligame.com/images/ys/6/6c/ilh3dbb3iz2wa4083qf3g1r6nndjfyl.mp3",
    "https://patchwiki.biligame.com/images/ys/5/5b/r7eq8u4q4m9as22hvqgsket5tu0y57t.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b3/on4hlt1nvpm0286qylv9awismkotcux.mp3",
    "https://patchwiki.biligame.com/images/ys/0/03/iyjlvxpkq6e6871adly24zdcot5178r.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7b/awiy1cdqgco95buy4q65wt65egw81tl.mp3",
    "https://patchwiki.biligame.com/images/ys/6/6d/8r493vbscou6vewrsjw8ef1wb1h3lev.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e6/n0biquo7l053zsozawo6jayhegplmb7.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d6/s2wyzzx5xwp39nu2tako9e84x9y56k5.mp3",
    "https://patchwiki.biligame.com/images/ys/9/94/a8la7bd9odn078ty50dpdhw398qzacm.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c5/k9s25ja209qpx0z6wf8dlh78wrdgsvp.mp3",
    "https://patchwiki.biligame.com/images/ys/0/06/tw2d1h2leunx8wstfs3qd8ekuw5whfk.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e8/bhfpxxl4oo7qnqg68ama1eek5ozgd5r.mp3",
    "https://patchwiki.biligame.com/images/ys/5/5b/e69s2kwj24xq4bektjbh7huxsq1tm08.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4e/1wlegxmua1i71s3xqyps647b35z8icb.mp3",
    "https://patchwiki.biligame.com/images/ys/0/00/nm9pciqfzpciw547xe9tjmqb3g2hsjs.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a4/9mzdbwal5ieo5zg503rhlmkgnmp90gj.mp3"
]

/**冰川镜华  来自：https://wiki.biligame.com/pcr/%E9%95%9C%E5%8D%8E 正则表达式匹配：   "https:\S*(ogg|mp3|wav)"         */
let voice_list_kyoka_jp = [
    "https://patchwiki.biligame.com/images/pcr/a/a5/1d3owxfxhuq7svo596rhdq4g69uqgo3.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/0e/fsh3rub78e4yqx8yz64phgg59p01g76.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/41/ne3nf1e1bk675iveyofd4hju4t89hh7.mp3",
    "https://patchwiki.biligame.com/images/pcr/c/cd/6e01873nl6rgtnsb8hzwhdw76kimpgr.mp3",
    "https://patchwiki.biligame.com/images/pcr/3/37/mefu14jda2c2gkifexyrlnrqwqmxryl.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/41/02c6zznozrx1kqj5mwfkw79ttbdbgn9.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/9d/b7ga92tqkibfispwagh2zk40mngmvwq.mp3",
    "https://patchwiki.biligame.com/images/pcr/7/73/i98ad9vfi1hdtsx8tw5zu77ml38lyzc.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/95/jzgbiwissojybwmjdkn156f5nsko9en.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/9a/cfnm1y73f4x5me1cojdusc5mwewlvk7.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ea/2xchuf4ji861rpl9x0ovqw6eciwjb4x.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/82/eby2sd1mtm9geixdvjr38w0f2kd0tlo.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/nj7i8b28lpji9oheffr241cncnopnh2.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/82/scqirq53fu5druhr9ddzjrdsyawjd9k.mp3",
    "https://patchwiki.biligame.com/images/pcr/b/b2/9dh762jufylclehivg557rj0opqooit.mp3",
    "https://patchwiki.biligame.com/images/pcr/d/d2/eb4frsd29ebysh28i50es6sp0f7t0di.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/46/gcrzdsxaue0nd7f08sbabbqz02uq3do.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/82/l8rk6o5ute4vpygnv0g8vk4wcamqur3.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ef/q3zih5za72qkl1mhk3wt0zwe8005jqp.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/94/fh49d31o7w4z1xzejrp2wamq5r5iohm.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ef/0yr19cf0f0jcr7fm89vx71bpdvbfaoz.mp3",
    "https://patchwiki.biligame.com/images/pcr/b/b4/iru2ux0h99nzscarf4u0vabr5mdm702.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/87/3azfeialne63dla3bbl3lcd1k3ok92q.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/e2/ekx1gt2pq7l9qv4rgb6tkz4oqd2yl6f.mp3",
    "https://patchwiki.biligame.com/images/pcr/b/b5/hmcqwtz22681fn0dpo7f3x6y4f1shb6.mp3",
    "https://patchwiki.biligame.com/images/pcr/7/70/pfeoer09okwejmaan3bn9q7lmu4bu5a.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/60/irssurz0nsg8hrb8i6sxpdxs3r2iwm2.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/89/gs9uoaqe3mbahclhzaixu6daekdgbiy.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/e61lumgswa059nc3afbjc8g0g7zwboj.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f1/85ryushk9hbtonsjbf2mbetzqj70u8e.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ea/85ryushk9hbtonsjbf2mbetzqj70u8e.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/fe/rl5cnmj09cq5llhpao543bhnc538c4i.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f5/rzsnv6rk2qg50klpfwmp94o69rsamhn.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/lm32wazfjaefk90vsuece1ob9ecltui.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/09/ov3xdvie8byzp0mg11doyq9zb3zqz62.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/94/a1ram2fciwu8t5wx5cbgmrxwgq2gbpk.mp3",
    "https://patchwiki.biligame.com/images/pcr/a/ac/cals9wdt5lmizyt5x0s69n21ghwzfvz.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/0c/5rbhj990cy17ywcjutsqx0r5i7ibyxg.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/4d/qnr1g6ogj0h0g0muimnudf0mgapmd69.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f1/qkhitco1vpg467rdx76s2zk0on652vj.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f0/6pcbrfzlh4dq8w7gls2ohp2dlr4gqqn.mp3",
    "https://patchwiki.biligame.com/images/pcr/2/2d/byunsf794qgxmo9tazj6jcszgekf9ig.mp3",
    "https://patchwiki.biligame.com/images/pcr/1/1e/6o47hlyndixlwqm8df9tcpp0z9i7evm.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/6e/fx1xvb2elisvht99ko8fgpuwjvxtud1.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/60/5o86g9fm84zktpdhgn3eslvgfkwmx3p.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/eb/q2vgxl3xgvndekyi6lw7yeykkyw4o03.mp3",
    "https://patchwiki.biligame.com/images/pcr/1/18/enmq56ie1tt8canu1f6onevlukcsna4.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/86/d49nib6cyx6j835qhkvy5eh15a09jsn.mp3",
    "https://patchwiki.biligame.com/images/pcr/c/c2/hbtjjvmr65k4nshsruotgy597yr13d4.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/63/k5kwurwbha6wejhztppkcagk9w9wtw2.mp3",
    "https://patchwiki.biligame.com/images/pcr/a/a5/58c51bv849m4reqcook11whkiibyt2e.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/e61lumgswa059nc3afbjc8g0g7zwboj.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f1/85ryushk9hbtonsjbf2mbetzqj70u8e.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/09/ov3xdvie8byzp0mg11doyq9zb3zqz62.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/4d/qnr1g6ogj0h0g0muimnudf0mgapmd69.mp3",
    "https://patchwiki.biligame.com/images/pcr/1/1e/6o47hlyndixlwqm8df9tcpp0z9i7evm.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/eb/q2vgxl3xgvndekyi6lw7yeykkyw4o03.mp3",
    "https://patchwiki.biligame.com/images/pcr/c/c2/hbtjjvmr65k4nshsruotgy597yr13d4.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ea/85ryushk9hbtonsjbf2mbetzqj70u8e.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/fe/rl5cnmj09cq5llhpao543bhnc538c4i.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/94/a1ram2fciwu8t5wx5cbgmrxwgq2gbpk.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f1/qkhitco1vpg467rdx76s2zk0on652vj.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/6e/fx1xvb2elisvht99ko8fgpuwjvxtud1.mp3",
    "https://patchwiki.biligame.com/images/pcr/1/18/enmq56ie1tt8canu1f6onevlukcsna4.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/63/k5kwurwbha6wejhztppkcagk9w9wtw2.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/0c/5rbhj990cy17ywcjutsqx0r5i7ibyxg.mp3",
    "https://patchwiki.biligame.com/images/pcr/2/2d/byunsf794qgxmo9tazj6jcszgekf9ig.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f5/rzsnv6rk2qg50klpfwmp94o69rsamhn.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/lm32wazfjaefk90vsuece1ob9ecltui.mp3",
    "https://patchwiki.biligame.com/images/pcr/a/ac/cals9wdt5lmizyt5x0s69n21ghwzfvz.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f0/6pcbrfzlh4dq8w7gls2ohp2dlr4gqqn.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/60/5o86g9fm84zktpdhgn3eslvgfkwmx3p.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/86/d49nib6cyx6j835qhkvy5eh15a09jsn.mp3",
    "https://patchwiki.biligame.com/images/pcr/a/a5/58c51bv849m4reqcook11whkiibyt2e.mp3"
]

/**春原心奈  来自：https://zh.moegirl.org.cn/zh-hans/%E6%98%A5%E5%8E%9F%E5%BF%83%E8%8F%9C 正则表达式匹配：   "https:\S*(ogg|mp3|wav)"         */
let voice_list_Sunohara_Kokona_jp = [
    "https://img.moegirl.org.cn/common/d/d3/BA_V_Kokona_Title.ogg",
    "https://img.moegirl.org.cn/common/1/10/BA_V_Kokona_Gachaget.ogg",
    "https://img.moegirl.org.cn/common/7/7e/BA_V_Kokona_Cafe_monolog_1.ogg",
    "https://img.moegirl.org.cn/common/e/ec/BA_V_Kokona_Cafe_monolog_2.ogg",
    "https://img.moegirl.org.cn/common/2/2b/BA_V_Kokona_Cafe_monolog_3.ogg",
    "https://img.moegirl.org.cn/common/8/84/BA_V_Kokona_Cafe_monolog_4.ogg",
    "https://img.moegirl.org.cn/common/e/ef/BA_V_Kokona_Cafe_monolog_5.ogg",
    "https://img.moegirl.org.cn/common/b/bd/BA_V_Kokona_LogIn_1.ogg",
    "https://img.moegirl.org.cn/common/e/e1/BA_V_Kokona_LogIn_2.ogg",
    "https://img.moegirl.org.cn/common/f/f6/BA_V_Kokona_Lobby_1.ogg",
    "https://img.moegirl.org.cn/common/b/b7/BA_V_Kokona_Lobby_2.ogg",
    "https://img.moegirl.org.cn/common/e/eb/BA_V_Kokona_Lobby_3.ogg",
    "https://img.moegirl.org.cn/common/1/1a/BA_V_Kokona_Lobby_4.ogg",
    "https://img.moegirl.org.cn/common/b/b6/BA_V_Kokona_Lobby_5.ogg",
    "https://img.moegirl.org.cn/common/e/e7/BA_V_Kokona_Season_Birthday_Player.ogg",
    "https://img.moegirl.org.cn/common/9/98/BA_V_Kokona_Season_Birthday.ogg",
    "https://img.moegirl.org.cn/common/c/c8/BA_V_Kokona_Season_NewYear.ogg",
    "https://img.moegirl.org.cn/common/2/2a/BA_V_Kokona_Season_Xmas.ogg",
    "https://img.moegirl.org.cn/common/9/98/BA_V_Kokona_Season_Halloween.ogg",
    "https://img.moegirl.org.cn/common/e/e9/BA_V_Kokona_ExWeapon_Get.ogg",
    "https://img.moegirl.org.cn/common/5/59/BA_V_Kokona_MemorialLobby_1.ogg",
    "https://img.moegirl.org.cn/common/0/06/BA_V_Kokona_MemorialLobby_2.ogg",
    "https://img.moegirl.org.cn/common/1/18/BA_V_Kokona_MemorialLobby_3.ogg",
    "https://img.moegirl.org.cn/common/2/2a/BA_V_Kokona_MemorialLobby_4.ogg",
    "https://img.moegirl.org.cn/common/b/bd/BA_V_Kokona_MemorialLobby_5.ogg"
]

/**下江小春  来自：https://zh.moegirl.org.cn/%E4%B8%8B%E6%B1%9F%E5%B0%8F%E6%98%A5 正则表达式匹配：   "https:\S*(ogg|mp3|wav)"         */
let voice_list_Shimoe_Koharu_jp = [
    "https://img.moegirl.org.cn/common/d/d4/BA_V_Koharu_Title.ogg",
    "https://img.moegirl.org.cn/common/8/85/BA_V_Koharu_Gachaget.ogg",
    "https://img.moegirl.org.cn/common/1/1e/BA_V_Koharu_Cafe_Monolog_1.ogg",
    "https://img.moegirl.org.cn/common/5/5a/BA_V_Koharu_Cafe_Monolog_2.ogg",
    "https://img.moegirl.org.cn/common/0/08/BA_V_Koharu_Cafe_Monolog_3.ogg",
    "https://img.moegirl.org.cn/common/c/c4/BA_V_Koharu_Cafe_Act_1.ogg",
    "https://img.moegirl.org.cn/common/0/03/BA_V_Koharu_Cafe_Act_2.ogg",
    "https://img.moegirl.org.cn/common/d/d9/BA_V_Koharu_Login_1.ogg",
    "https://img.moegirl.org.cn/common/e/ef/BA_V_Koharu_Login_2.ogg",
    "https://img.moegirl.org.cn/common/7/7d/BA_V_Koharu_Lobby_1.ogg",
    "https://img.moegirl.org.cn/common/c/c5/BA_V_Koharu_Lobby_2.ogg",
    "https://img.moegirl.org.cn/common/2/24/BA_V_Koharu_Lobby_3.ogg",
    "https://img.moegirl.org.cn/common/2/2c/BA_V_Koharu_Lobby_4.ogg",
    "https://img.moegirl.org.cn/common/a/a0/BA_V_Koharu_Lobby_5.ogg",
    "https://img.moegirl.org.cn/common/5/51/BA_V_Koharu_Season_Birthday_Player.ogg",
    "https://img.moegirl.org.cn/common/c/c7/BA_V_Koharu_Season_Birthday.ogg",
    "https://img.moegirl.org.cn/common/f/f6/BA_V_Koharu_Season_Newyear.ogg",
    "https://img.moegirl.org.cn/common/c/c8/BA_V_Koharu_Season_Xmas.ogg",
    "https://img.moegirl.org.cn/common/8/85/BA_V_Koharu_Season_Halloween.ogg",
    "https://img.moegirl.org.cn/common/e/e5/BA_V_Koharu_Exweapon_Get.ogg",
    "https://img.moegirl.org.cn/common/d/df/BA_V_Koharu_Memoriallobby_1.ogg",
    "https://img.moegirl.org.cn/common/c/c7/BA_V_Koharu_Memoriallobby_2.ogg",
    "https://img.moegirl.org.cn/common/8/8f/BA_V_Koharu_Memoriallobby_3.ogg",
    "https://img.moegirl.org.cn/common/7/7f/BA_V_Koharu_Memoriallobby_4.ogg",
    "https://img.moegirl.org.cn/common/a/ac/BA_V_Koharu_Memoriallobby_5.ogg",
    "https://img.moegirl.org.cn/common/b/b6/BA_V_Koharu_Swimsuit_Gachaget.ogg",
    "https://img.moegirl.org.cn/common/e/e9/BA_V_Koharu_Swimsuit_Cafe_monolog_1.ogg",
    "https://img.moegirl.org.cn/common/d/d9/BA_V_Koharu_Swimsuit_Cafe_monolog_2.ogg",
    "https://img.moegirl.org.cn/common/f/fd/BA_V_Koharu_Swimsuit_Cafe_monolog_3.ogg",
    "https://img.moegirl.org.cn/common/0/02/BA_V_Koharu_Swimsuit_Cafe_monolog_4.ogg",
    "https://img.moegirl.org.cn/common/3/3d/BA_V_Koharu_Swimsuit_Cafe_monolog_5.ogg",
    "https://img.moegirl.org.cn/common/1/1f/BA_V_Koharu_Swimsuit_LogIn_1.ogg",
    "https://img.moegirl.org.cn/common/5/59/BA_V_Koharu_Swimsuit_LogIn_2.ogg",
    "https://img.moegirl.org.cn/common/c/c5/BA_V_Koharu_Swimsuit_Lobby_1.ogg",
    "https://img.moegirl.org.cn/common/3/32/BA_V_Koharu_Swimsuit_Lobby_2.ogg",
    "https://img.moegirl.org.cn/common/b/b2/BA_V_Koharu_Swimsuit_Lobby_3.ogg",
    "https://img.moegirl.org.cn/common/9/92/BA_V_Koharu_Swimsuit_Lobby_4.ogg",
    "https://img.moegirl.org.cn/common/5/59/BA_V_Koharu_Swimsuit_Lobby_5.ogg",
    "https://img.moegirl.org.cn/common/5/5f/BA_V_Koharu_Swimsuit_Season_Birthday_Player.ogg",
    "https://img.moegirl.org.cn/common/4/44/BA_V_Koharu_Swimsuit_Season_Birthday.ogg",
    "https://img.moegirl.org.cn/common/3/32/BA_V_Koharu_Swimsuit_Season_NewYear.ogg",
    "https://img.moegirl.org.cn/common/d/d6/BA_V_Koharu_Swimsuit_Season_Xmas.ogg",
    "https://img.moegirl.org.cn/common/8/88/BA_V_Koharu_Swimsuit_Season_Halloween.ogg",
    "https://img.moegirl.org.cn/common/8/82/BA_V_Koharu_Swimsuit_ExWeapon_Get.ogg",
    "https://img.moegirl.org.cn/common/6/69/BA_V_Koharu_Swimsuit_MemorialLobby_1.ogg",
    "https://img.moegirl.org.cn/common/1/13/BA_V_Koharu_Swimsuit_MemorialLobby_2.ogg",
    "https://img.moegirl.org.cn/common/9/9f/BA_V_Koharu_Swimsuit_MemorialLobby_3.ogg",
    "https://img.moegirl.org.cn/common/e/ea/BA_V_Koharu_Swimsuit_MemorialLobby_4.ogg",
    "https://img.moegirl.org.cn/common/2/2d/BA_V_Koharu_Swimsuit_MemorialLobby_5.ogg",
    "https://img.moegirl.org.cn/common/e/ea/BA_V_Koharu_Swimsuit_MemorialLobby_4.ogg",
]

/**被戳次数文本 */
let ciku = [
    "派蒙今天已经被戳了_num_次啦，休息一下好不好",
    "派蒙今天已经被戳了_num_次啦，有完没完！",
    "派蒙今天已经被戳了_num_次啦，要戳坏掉了！",
    "派蒙今天已经被戳了_num_次啦，别戳了!!!",
    "派蒙今天已经被戳了_num_次啦，不准戳了！！！",
    "派蒙今天已经被戳了_num_次啦，再戳就坏了！",
];

/**
 * @description: 随机返回一个url
 * @param {*} type 可选 ecy, scy, ecywebp, bq
 * @return {*}
 */
function getRandomUrl(type) {
    const urls = {
        "ecy": [ // 二次元
            "https://api.btstu.cn/sjbz/api.php?lx=dongman&format=images",
            "https://api.fuchenboke.cn/api/dongman.php",
            // "https://i18.net/api.php?fl=dongman",
            // "https://i18.net/acg.php",
            "https://api.boxmoe.com/random.php", // 返回下载图片的
            // "https://rpic.origz.com/api.php?category=pixiv",
            "https://api.mtyqx.cn/api/random.php",
            "https://api.mtyqx.cn/tapi/random.php",
            "https://api.paugram.com/wallpaper/",
            "http://www.98qy.com/sjbz/api.php",
            "https://img.xjh.me/random_img.php",
            "https://www.dmoe.cc/random.php", // 返回下载图片的
            "https://moe.jitsu.top/api",
            "https://api.horosama.com/random.php",
            "https://api.likepoems.com/img/pc",
            "https://api.likepoems.com/img/pe",
            "https://api.likepoems.com/img/pixiv",
            "https://v2.xxapi.cn/api/randomAcgPic?type=pc&return=302",
            "https://v2.xxapi.cn/api/randomAcgPic?type=wap&return=302",
            "https://api.suyanw.cn/api/comic/api.php", // 返回下载图片的
            "https://cdn.seovx.com/d/?mom=302",
        ],
        "scy": [ // 三次元
            "https://api.btstu.cn/sjbz/api.php",
            // "https://i18.net/cos.php",
            // "https://i18.net/bing.php",
            "https://t.alcy.cc/fj", // 三次元 webp格式
            "https://api.btstu.cn/sjbz/api.php",
            "https://api.lolimi.cn/API/tup/xjj.php",
            "https://api.likepoems.com/img/nature",
            "https://api.likepoems.com/img/bing",
            "https://v2.xxapi.cn/api/meinvpic?return=302",
            "https://v2.xxapi.cn/api/baisi?return=302",
            "https://api.suyanw.cn/api/ksxjj",
            "https://cdn.seovx.com/?mom=302",
        ],
        "ecywebp": [ // 二次元 webp格式
            "https://t.mwm.moe/mp",
            "https://t.alcy.cc/ycy",
            "https://t.alcy.cc/moez",
            "https://t.alcy.cc/ysz", // 原神
            "https://t.alcy.cc/mp",
            "https://t.alcy.cc/moemp",
            "https://t.alcy.cc/ysmp",
            "https://www.loliapi.com/acg",
            // "http://api.mysqil.com/pc.php",
            // "http://api.mysqil.com/pe.php",
            "https://api.rls.ovh/horizontal", // avif格式
            "https://api.rls.ovh/vertical",
        ],
        "scywebp": [ // 三次元 webp格式
            "",
        ],
        "bq_img": [ // 表情
            // "http://api.zhilaohu.icu/xnn",
            // "http://api.zhilaohu.icu/chajun",
            "https://api.likepoems.com/img/mc",
        ],
        "bqwebp": [
            "https://t.alcy.cc/xhl",
            "https://t.alcy.cc/lai",
            "https://api.suyanw.cn/api/mao",
        ],
    };
    const randomIndex = Math.floor(Math.random() * urls[type].length);
    return urls[type][randomIndex];
}