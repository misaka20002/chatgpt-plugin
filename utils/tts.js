import { Config } from './config.js'
import fetch from 'node-fetch'
import _ from 'lodash'
import { getProxy } from './proxy.js'
let proxy = getProxy()

export const speakers_ZH = ["派蒙_ZH", "纳西妲_ZH", "凯亚_ZH", "温迪_ZH", "娜维娅_ZH", "荒泷一斗_ZH", "阿贝多_ZH", "钟离_ZH", "枫原万叶_ZH", "那维莱特_ZH", "艾尔海森_ZH", "八重神子_ZH", "芙宁娜_ZH", "宵宫_ZH", "迪希雅_ZH", "提纳里_ZH", "林尼_ZH", "莱依拉_ZH", "卡维_ZH", "诺艾尔_ZH", "赛诺_ZH", "托马_ZH", "莫娜_ZH", "神里绫华_ZH", "凝光_ZH", "北斗_ZH", "迪奥娜_ZH", "可莉_ZH", "柯莱_ZH", "丽莎_ZH", "莱欧斯利_ZH", "琳妮特_ZH", "五郎_ZH", "芭芭拉_ZH", "雷电将军_ZH", "珊瑚宫心海_ZH", "魈_ZH", "琴_ZH", "胡桃_ZH", "砂糖_ZH", "鹿野院平藏_ZH", "安柏_ZH", "重云_ZH", "夜兰_ZH", "达达利亚_ZH", "班尼特_ZH", "妮露_ZH", "香菱_ZH", "珐露珊_ZH", "迪卢克_ZH", "刻晴_ZH", "烟绯_ZH", "辛焱_ZH", "早柚_ZH", "夏洛蒂_ZH", "夏沃蕾_ZH", "优菈_ZH", "云堇_ZH", "久岐忍_ZH", "神里绫人_ZH", "甘雨_ZH", "流浪者_ZH", "行秋_ZH", "千织_ZH", "戴因斯雷布_ZH", "闲云_ZH", "白术_ZH", "菲谢尔_ZH", "申鹤_ZH", "九条裟罗_ZH", "雷泽_ZH", "荧_ZH", "空_ZH", "嘉明_ZH", "菲米尼_ZH", "多莉_ZH", "迪娜泽黛_ZH", "凯瑟琳_ZH", "绮良良_ZH", "罗莎莉亚_ZH", "米卡_ZH", "坎蒂丝_ZH", "萍姥姥_ZH", "留云借风真君_ZH", "爱贝尔_ZH", "伊迪娅_ZH", "瑶瑶_ZH", "七七_ZH", "式大将_ZH", "奥兹_ZH", "泽维尔_ZH", "哲平_ZH", "大肉丸_ZH", "托克_ZH", "蒂玛乌斯_ZH", "塞琉斯_ZH", "欧菲妮_ZH", "昆钧_ZH", "言笑_ZH", "仆人_ZH", "迈勒斯_ZH", "希格雯_ZH", "拉赫曼_ZH", "杜拉夫_ZH", "克洛琳德_ZH", "伊利亚斯_ZH", "爱德琳_ZH", "玛乔丽_ZH", "柊千里_ZH", "九条镰治_ZH", "塞塔蕾_ZH", "海芭夏_ZH", "笼钓瓶一心_ZH", "叶德_ZH", "卡莉露_ZH", "查尔斯_ZH", "莎拉_ZH", "玛格丽特_ZH", "博来_ZH", "纳比尔_ZH", "迪尔菲_ZH", "康纳_ZH", "玛塞勒_ZH", "博士_ZH", "宛烟_ZH", "羽生田千鹤_ZH", "海妮耶_ZH", "天叔_ZH", "鹿野奈奈_ZH", "一心传名刀_ZH", "弗洛朗_ZH", "舒伯特_ZH", "莺儿_ZH", "龙二_ZH", "梅里埃_ZH", "芙卡洛斯_ZH", "嘉良_ZH", "珊瑚_ZH", "久利须_ZH", "费迪南德_ZH", "嘉玛_ZH", "艾伯特_ZH", "天目十五_ZH", "女士_ZH", "丹吉尔_ZH", "白老先生_ZH", "吴船长_ZH", "巴达维_ZH", "拉齐_ZH", "长生_ZH", "莫塞伊思_ZH", "杜吉耶_ZH", "斯坦利_ZH", "百闻_ZH", "掇星攫辰天君_ZH", "迈蒙_ZH", "博易_ZH", "花角玉将_ZH", "知易_ZH", "上杉_ZH", "大慈树王_ZH", "田铁嘴_ZH", "常九爷_ZH", "西拉杰_ZH", "沙扎曼_ZH", "深渊使徒_ZH", "安西_ZH", "三月七_ZH", "丹恒_ZH", "瓦尔特_ZH", "希儿_ZH", "希露瓦_ZH", "娜塔莎_ZH", "布洛妮娅_ZH", "佩拉_ZH", "砂金_ZH", "素裳_ZH", "虎克_ZH", "姬子_ZH", "穹_ZH", "星_ZH", "符玄_ZH", "白露_ZH", "克拉拉_ZH", "杰帕德_ZH", "景元_ZH", "藿藿_ZH", "黑天鹅_ZH", "桑博_ZH", "黄泉_ZH", "卡芙卡_ZH", "艾丝妲_ZH", "流萤_ZH", "桂乃芬_ZH", "托帕_ZH", "真理医生_ZH", "彦卿_ZH", "黑塔_ZH", "驭空_ZH", "停云_ZH", "玲可_ZH", "镜流_ZH", "罗刹_ZH", "银狼_ZH", "阮•梅_ZH", "青雀_ZH", "阿兰_ZH", "米沙_ZH", "浮烟_ZH", "帕姆_ZH", "螺丝咕姆_ZH", "加拉赫_ZH", "卢卡_ZH", "史瓦罗_ZH", "明曦_ZH", "寒鸦_ZH", "雪衣_ZH", "银枝_ZH", "晴霓_ZH", "丹枢_ZH", "星期日_ZH", "尾巴_ZH", "花火_ZH", "可可利亚_ZH", "青镞_ZH", "半夏_ZH", "刃_ZH", "霄翰_ZH", "信使_ZH", "卡卡瓦夏_ZH", "钟表小子_ZH", "岩明_ZH", "浣溪_ZH", "知更鸟_ZH", "Lumi", "baki", "乘风破浪", "啊哈", "夏夏", "小王", "蛇头", "乘风破浪_轻声", "啊哈_轻声", "蛇头_轻声"]
export const speakers_JP = ["阿慈谷日富美", "爱丽丝", "爱清枫香", "阿露", "安守实里", "奥空绫音", "白石歌原", "白洲梓", "白子", "才羽绿", "才羽桃井", "苍森美弥", "秤亚津子", "槌永日和", "春日椿", "春原瞬", "春原心奈", "初音未来", "锭前纱织", "飞鸟马时", "风仓萌绘", "歌住樱子", "月雪宫子", "古关忧", "鬼方佳代子", "剑先鹤城", "河和静子", "黑馆晴奈", "黑见芹香", "黑崎小雪", "天见和香", "花冈柚子", "角楯花凛", "狐坂若藻", "火宫千夏", "间宵时雨", "戒野美咲", "静山真白", "近卫南", "鹫见芹奈", "久田泉奈", "空井咲", "空崎日奈", "连河切里诺", "羽川莲见", "猫塚响", "美甘尼禄", "霞泽美游", "一之濑明日奈", "明星日鞠", "浅黄睦月", "浦和花子", "千鸟满", "和乐千世", "鹫见芹娜", "秋泉红叶", "砂狼白子", "扇喜葵", "生盐诺亚", "圣园未花", "天童爱丽丝", "天雨亚子", "铜花瞬", "桐生桔梗", "桐藤渚", "尾刃康娜", "下仓惠", "下江小春", "小钩晴", "小鸟游星野", "小涂真纪", "杏山和纱", "伊草遥香", "伊落玛丽", "银镜伊织", "柚岛夏", "早濑优香", "宇泽玲纱", "枣伊吕波", "中务桐乃", "仲正一花", "朱城瑠美", "冰室濑名", "不破莲华", "朝比奈菲娜", "朝颜花江", "池仓玛丽娜", "赤司纯子", "丹花伊吹", "大野月咏", "鳄渊明里", "丰见小鸟", "各务千寻", "鬼怒川霞", "合欢垣吹雪", "和元泉艾米", "姬木梅露", "勘解由小路紫", "理村爱理", "牛牧朱莉", "若叶日向", "桑上果穗", "食蜂操祈", "十六夜野宫", "室笠朱音(茜)", "狮子堂泉", "守月铃美", "水羽三森", "药子纱绫", "乙花堇", "音濑小玉", "伊原木好美", "勇美枫", "圆堂志美子", "御坂美琴", "羽沼真琴", "佐城巴", "佐天泪子"]
export const speakers = [...speakers_ZH, ...speakers_JP]
export const vits_emotion_map = ['1: Happy (开心)', '2: Sad (伤心)', '3: Excited (兴奋)', '4: Angry (生气)', '5: Bored (无聊)', '6: Nervous (紧张)', '7: Content (满足)', '8: Frustrated (沮丧)', '9: Worried (担心)', '10: Relaxed (轻松)', '11: Enthusiastic (热情)', '12: Joyful (快乐)', '13: Melancholic (忧郁)', '14: Surprised (惊讶)', '15: Grateful (感激)', '16: Optimistic (乐观)', '17: Anxious (焦虑)', '18: Amused (逗乐)', '19: Embarrassed (尴尬)', '20: Hopeful (希望)', '21: Guilty (内疚)', '22: Restless (不安)', '23: Curious (好奇)', '24: Disappointed (失望)', '25: Thrilled (激动)', '26: Contented (满意)', '27: Impatient (不耐烦)', '28: Lonely (孤独)', '29: Disgusted (厌恶)', '30: Jealous (嫉妒)', '31: Proud (骄傲)', '32: Surprised (惊讶)', '33: Delighted (高兴)', '34: Drained (疲惫)', '35: Ecstatic (狂喜)', '36: Fulfilled (满足)', '37: Giddy (眩晕)', '38: Heartbroken (心碎)', '39: Inspired (受启发)', '40: Irritated (恼怒)', '41: Motivated (有动力)', '42: Overwhelmed (不堪重负)', '43: Peaceful (宁静)', '44: Regretful (后悔)', '45: Sentimental (感伤)', '46: Sympathetic (同情)', '47: Tired (疲倦)', '48: Uncomfortable (不舒服)', '49: Worrisome (担忧)', '50: Zealous (热心)', '51: Blissful (幸福)', '52: Depressed (抑郁)', '53: Elated (兴高采烈)', '54: Grumpy (脾气暴躁)', '55: Hopeless (绝望)', '56: Intrigued (好奇)', '57: Playful (调皮)', '58: Reflective (反思)', '59: Satisfied (满意)', '60: Shy (害羞)', '61: Suspicious (怀疑)', '62: Ambitious (雄心勃勃)', '63: Grieving (悲伤)', '64: Frightened (害怕)', '65: Helpless (无助)', '66: Lively (活力)', '67: Envious (羡慕)', '68: Impressed (印象深刻)', '69: Irrational (不理智)', '70: Longing (渴望)', '71: Restless (不安)', '72: Silly (愚蠢)', '73: Stressed (紧张)', '74: Sensitive (敏感)', '75: Thoughtful (思考)', '76: Unsettled (不稳定)', '77: Weak (脆弱)', '78: Wistful (怀念)', '79: Zealot (狂热)', '80: Thankful (感谢)', '81: Resentful (愤怒)', '82: Pessimistic (悲观)', '83: Ashamed (羞愧)', '84: Irritable (易怒)', '85: Jealous (妒忌)', '86: Numb (麻木)', '87: Resigned (顺从)', '88: Relieved (宽慰)', '89: Sorrowful (悲哀)', '90: Enraged (愤怒)', '91: Awestruck (敬畏)', '92: Gracious (亲切)', '93: Discontent (不满)', '94: Confused (困惑)', '95: Excitable (易激动)', '96: Fulfilled (满足)', '97: Jovial (快活)', '98: Lethargic (想睡)', '99: Regretful (后悔)', '100: Sarcastic (讽刺)']
// export const vits_emotion_map = ['1: Happy (开心)', '2: Sad (伤心)', '3: Excited (兴奋)', '4: Angry (生气)', '5: Bored (困)', '6: Worried (担心)']

const sleep_zz = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

const newFetch = (url, options = {}) => {
    const defaultOptions = Config.proxy
        ? {
            agent: proxy(Config.proxy)
        }
        : {}

    const mergedOptions = {
        ...defaultOptions,
        ...options
    }

    return fetch(url, mergedOptions)
}

function randomNum(minNum, maxNum) {
    switch (arguments.length) {
        case 1:
            return parseInt(Math.random() * minNum + 1, 10)
        case 2:
            return parseInt(Math.random() * (maxNum - minNum + 1) + minNum, 10)
        default:
            return 0
    }
}

export async function generateVitsAudio(text, speaker = '随机', language = '中日混合（中文用[ZH][ZH]包裹起来，日文用[JA][JA]包裹起来）', noiseScale = parseFloat(Config.noiseScale), noiseScaleW = parseFloat(Config.noiseScaleW), lengthScale = parseFloat(Config.lengthScale), vits_emotion = Config.vits_emotion, sdp_ratio = parseFloat(Config.sdp_ratio), tts_language = Config.tts_language, style_text = Config.style_text, style_text_weights = parseFloat(Config.style_text_weights), tts_slice_is_slice_generation = Config.tts_slice_is_slice_generation, tts_slice_is_Split_by_sentence = Config.tts_slice_is_Split_by_sentence, tts_slice_pause_between_paragraphs_seconds = parseFloat(Config.tts_slice_pause_between_paragraphs_seconds), tts_slice_pause_between_sentences_seconds = parseFloat(Config.tts_slice_pause_between_sentences_seconds)) {
    if (lengthScale === 2.99) // genshinvoice.top/api已关闭,这一段已成为历史
    {
        /*        let character_voice_language = speaker.substring(speaker.length - 2);
                let textfix = text.replace(/\#|(\[派蒙\])/g, '').replace(/派蒒/g, '派蒙').replace(/(\^([0-9])\^(.*|\n$))/g, '').replace(/\n(:|：).*|\n$/g, '').replace(/(\ud83c[\udf00-\udfff])|(\ud83d[\udc00-\ude4f\ude80-\udeff])|[\u2600-\u2B55]/g, '');
                //replace: 1.删除[派蒙] ; 2.替换派蒒 ; 3.删除bing ^1^开头的注释 ; 4.删除bing ":"开头的注释 ; 5.删除所有emoji
                let audioLink = `https://genshinvoice.top/api?speaker=${speaker}&text=${textfix}&format=wav&language=${character_voice_language}&length=1&sdp=0.4&noise=0.6&noisew=0.8`
        */
        return audioLink
    }
    else {
        if (!speaker || speaker === '随机') {
            logger.info('[chatgpt-tts]随机角色！这次哪个角色这么幸运会被选到呢……')
            speaker = speakers[randomNum(0, speakers.length)]
        }

        // text = wrapTextByLanguage(text) //这函数用于<zh> or <jp>包裹句子，但v2.genshinvoice.top 现在支持"auto"了!!


        /*处理tts语音文本：*/
        let tts_First_person_zh_colon_reg = new RegExp(Config.tts_First_person + '：', 'g');  //7. 替换第一人称+'：'，例如可莉：

        text = text.replace(/\#|(\[..\])|(\[.\])/g, '').replace(/派蒒/g, '派蒙').replace(/\(?\^([0-9])\^\)?/g, '').replace(/\n(:|：).*|\n$/g, '').replace(/(\ud83c[\udf00-\udfff])|(\ud83d[\udc00-\ude4f\ude80-\udeff])|[\u2600-\u2B55]/g, '').replace(tts_First_person_zh_colon_reg, '').replace(/（..）/g, '').replace(/~/g, '，').replace(/，，，|，，|。。。/g, '。').replace(/，。|。。|。，/g, '。').replace(/\[好感度.*\d+\]/, '').replace(/\[好感度.*\d+\]/, '')
        //replace: 1.删除[？？]和[？] ; 2.替换派蒒 ; 3.删除bing (^1^)的注释 ; 4.删除bing ":"开头的注释 ; 5.删除所有emoji  6. 替换第一人称+'：'，例如可莉：; 9. 替换（小声）; 10.~ 替换为 ，11.替换↓chat.js处理过的换行文本 12.处理多余的，。 13.适配删除中括号好感度
        //注意：chat.js传递过来转语音前已经做了'\n'转'，'的处理：ttsResponse = ttsResponse.replace(/[-:_；*;\n]/g, '，')  

        // #gpt翻日 硬编码替换部分角色名
        if (Config.autoJapanese)
            text = text.replace(/可莉|コリー|リディア/g, 'クレー').replace(/派蒙|モンゴル|派モン/g, 'パイモン').replace(/纳西妲|ナシの実|ナヒダ/g, 'ナヒーダ').replace(/早柚/g, 'さゆ').replace(/瑶瑶/g, 'ヨォーヨ').replace(/七七/g, 'なな').replace(/迪奥娜|ディオナ/g, 'ディオナ').replace(/绮良良|綺良良/g, 'きらら').replace(/希格雯/g, 'シグウィン').replace(/白露/g, 'ビャクロ').replace(/虎克|フック本/g, 'フック').replace(/心奈|こころ|しんな|心菜|ココロナ/g, 'ココナ').replace(/小春/g, 'コハル').replace(/星野/g, 'ホシノ').replace(/日富美/g, 'ヒフミ').replace(/梓/g, 'アズサ').replace(/日奈/g, 'ヒナ').replace(/纯子|純子/g, 'ジュンコ').replace(/睦月/g, 'ムツキ').replace(/优香|優香/g, 'ユウカ').replace(/爱丽丝/g, 'アリス').replace(/真纪|真紀/g, 'マキ').replace(/切里诺|チェリーノ/g, 'チェリノ').replace(/和香/g, 'ノドカ').replace(/小瞬/g, 'シュン').replace(/纱绫|紗綾/g, 'サヤ').replace(/美游|美遊/g, 'ミユ').replace(/桃井/g, 'モモイ').replace(/妃咲/g, 'キサキ').replace(/胡桃/g, 'クルミ').replace(/阿罗娜|アローナ/g, 'アロナ').replace(/普拉娜/g, 'プラナ')

        // tts情感自动设置
        if (Config.vits_auto_emotion) {
            vits_emotion = get_tts_Emotion(text)
            logger.mark(`[chatgpt-tts]tts使用情感：${vits_emotion}`)
        }

        // 校正api地址
        let space = Config.ttsSpace
        //校正为 https://bv2.firefly.matce.cn
        if (space.endsWith('/run/predict')) {
            let trimmedSpace = space.substring(0, space.length - 12)
            logger.warn(`[chatgpt-tts]vits api 当前为${space}，已校正为${trimmedSpace}`)
            space = trimmedSpace
        }
        if (space.endsWith('/')) {
            let trimmedSpace = _.trimEnd(space, '/')
            logger.warn(`[chatgpt-tts]vits api 当前为${space}，已校正为${trimmedSpace}`)
            space = trimmedSpace
        }

        let url = `${space}/run/predict`
        /* 真的需要反代的话这一行需要修改
          if (Config.huggingFaceReverseProxy) {
            url = `${Config.huggingFaceReverseProxy}/api/generate?space=${_.trimStart(space, 'https://')}`
          }
        */

        // 如果 speaker 在数组 speakers_JP 中
        if (speakers_JP.includes(speaker)) {
            // 自动切换网址
            if (space == "https://bv2.firefly.matce.cn") space = "https://ba.firefly.matce.cn"
            if (url == "https://bv2.firefly.matce.cn/run/predict") url = "https://ba.firefly.matce.cn/run/predict"
            tts_language = "JP"

            // 使用网址的自动转日语，若#tts语音转日语关闭 （推荐关闭，除非网址api翻译出错）则自动使用网址api的转日语功能，若#tts语音转日语开启 则使用本插件内置的#gpt翻日 功能
            if (!Config.autoJapanese) {
                if (Config.debug)
                    logger.info(`[chatgpt-tts]正在使用网页api转日语，基于文本：'${text}'`)
                let body_translation = {
                    data: [
                        text
                    ],
                    event_data: null,
                    fn_index: 1,
                    session_hash: ""
                }
                if (Config.debug) {
                    logger.info(body_translation)
                }
                let json, response
                for (let post_times = 1; post_times <= 5; post_times++) {
                    try {
                        logger.info(`[chatgpt-tts]正在第${post_times}次使用接口转日语${url}`)
                        response = await newFetch(url, {
                            method: 'POST',
                            body: JSON.stringify(body_translation),
                            headers: {
                                'content-type': 'application/json'
                            }
                        })
                        let responseBody = await response.text()
                        json = JSON.parse(responseBody)
                        if (Config.debug) {
                            logger.info(json)
                        }
                        if (response.status > 299) {
                            logger.info(json)
                            throw new Error(JSON.stringify(json))
                        }
                        let [message] = json?.data

                        if (!message) throw new Error(responseBody)
                        else logger.mark(`[chatgpt-tts]成功获取网页api转日语文本：${message}`)

                        // 硬编码替换部分角色名
                        message = message.replace(/可莉|コリー/g, 'クレー').replace(/派蒙|モンゴル/g, 'パイモン').replace(/纳西妲|ナシの実/g, 'ナヒーダ').replace(/早柚/g, 'さゆ').replace(/瑶瑶/g, 'ヨォーヨ').replace(/七七/g, 'なな').replace(/迪奥娜|ディオナ/g, 'ディオナ').replace(/绮良良|綺良良/g, 'きらら').replace(/希格雯/g, 'シグウィン').replace(/白露/g, 'ビャクロ').replace(/虎克|フック本/g, 'フック').replace(/心奈/g, 'ココナ').replace(/小春/g, 'コハル').replace(/星野/g, 'ホシノ').replace(/日富美/g, 'ヒフミ').replace(/梓/g, 'アズサ').replace(/日奈/g, 'ヒナ').replace(/纯子|純子/g, 'ジュンコ').replace(/睦月/g, 'ムツキ').replace(/优香|優香/g, 'ユウカ').replace(/爱丽丝/g, 'アリス').replace(/真纪|真紀/g, 'マキ').replace(/切里诺|チェリーノ/g, 'チェリノ').replace(/和香/g, 'ノドカ').replace(/小瞬/g, 'シュン').replace(/纱绫|紗綾/g, 'サヤ').replace(/美游|美遊/g, 'ミユ').replace(/桃井/g, 'モモイ').replace(/妃咲/g, 'キサキ').replace(/胡桃/g, 'クルミ').replace(/阿罗娜|アローナ/g, 'アロナ').replace(/普拉娜/g, 'プラナ')
                        text = message
                        break
                    } catch (err) {
                        logger.error(`[chatgpt-tts]转日语For循环中发生错误，请检查是否配置了正确的api。当前为第${post_times}次。当前语音api status为`, response.status, '错误：', err)
                        if (post_times == 5) throw new Error('网址api转日语错误，responseBody:', json)
                        // 等待5000ms
                        await sleep_zz(5000)
                    }
                }
            }
        }
        // 如果 speaker 在数组 speakers_ZH 中
        if (speakers_ZH.includes(speaker)) {
            // 则使用中文
            if (space == "https://ba.firefly.matce.cn") space = "https://bv2.firefly.matce.cn"
            if (url == "https://ba.firefly.matce.cn/run/predict") url = "https://bv2.firefly.matce.cn/run/predict"
            tts_language = "ZH"
        }

        logger.info(`[chatgpt-tts]正在使用${speaker}，基于文本：'${text}'生成语音`)

        // exampleAudio暂时无法使用
        let exampleAudio = null

        let body
        // API更新了，目前只支持切片生成----------------
        tts_slice_is_slice_generation = true
        if (!tts_slice_is_slice_generation) {
            // 最大300字，截取处理后的前299个字符
            text = text.substr(0, 299);
            body = {
                data: [
                    text, speaker, sdp_ratio, noiseScale, noiseScaleW, lengthScale,
                    tts_language, exampleAudio, vits_emotion, "Text prompt", style_text, style_text_weights
                ],
                event_data: null,
                fn_index: 0,
                session_hash: ""
            }
            /* 普通生成body参考：
            {
                "data": [
                    "派蒙知道哦",
                    "派蒙_ZH",
                    0.2,
                    0.6,
                    0.8,
                    1,
                    "ZH",  //tts_language
                    null,  //exampleAudio
                    "Happy",
                    "Text prompt",  //切片生成没有这一行
                    "",
                    0.7
                ],
                    "event_data": null,
                        "fn_index": 0,  //切片生成这个不同
            } */
        } else {
            // text可超过300字
            body = {
                data: [
                    text, speaker, sdp_ratio, noiseScale, noiseScaleW, lengthScale,
                    tts_language, tts_slice_is_Split_by_sentence, tts_slice_pause_between_paragraphs_seconds, tts_slice_pause_between_sentences_seconds,
                    exampleAudio, vits_emotion, style_text, style_text_weights
                ],
                event_data: null,
                fn_index: 0,
                session_hash: ""
            }
            /* 切片生成body参考：
            {
                "data": [
                    "派蒙知道哦",
                    "派蒙_ZH",
                    0.2,
                    0.6,
                    0.8,
                    1,
                    "ZH",  //tts_language
                    false,  //按句切分
                    0.6,  //段间停顿
                    0.2,  //句间停顿
                    null,  //exampleAudio
                    "Happy",
                    "",
                    0.7
                ],
                    "event_data": null,
                        "fn_index": 0
            } */
        }


        // tts_post
        if (Config.debug) {
            logger.info(body)
        }
        let json, response
        for (let post_times = 1; post_times <= 5; post_times++) {
            try {
                logger.info(`[chatgpt-tts]正在第${post_times}次使用接口${url}`)
                response = await newFetch(url, {
                    method: 'POST',
                    body: JSON.stringify(body),
                    headers: {
                        'content-type': 'application/json'
                    }
                })
                let responseBody = await response.text()
                json = JSON.parse(responseBody)
                if (Config.debug) {
                    logger.info(json)
                }
                if (response.status > 299) {
                    logger.info(json)
                    throw new Error(JSON.stringify(json))
                }
                let [message, audioInfo] = json?.data
                logger.info(`[chatgpt-tts]api生成信息：`, message)

                /*这api怎么天天换参数呢*/
                let audioLink
                for (let read_audioInfo in audioInfo) {
                    if (/.*(\/|\\).*(\/|\\).*\.(wav|mp3)$/.test(audioInfo[read_audioInfo])) {
                        audioLink = `${space}/file=${audioInfo[read_audioInfo]}`
                        break
                    }
                }
                if (!audioLink) throw new Error('[chatgpt-tts]未匹配到音频链接', json)
                else logger.mark(`[chatgpt-tts]成功获取音频地址${audioLink}`)

                /*let audioLink = `${space}/file=${audioInfo.path}`*/

                /* 真的需要反代的话这一行需要修改
                    if (Config.huggingFaceReverseProxy) {
                      if (Config.debug) {
                        logger.info('使用huggingface加速反代下载生成音频' + Config.huggingFaceReverseProxy)
                      }
                      let spaceHost = _.trimStart(space, 'https://')
                      audioLink = `${Config.huggingFaceReverseProxy}/file=${audioInfo.name}?space=${spaceHost}`
                    }
                */
                return audioLink
            } catch (err) {
                logger.error(`[chatgpt-tts]生成语音api发生错误，请检查是否配置了正确的api。当前为第${post_times}次。当前语音api status为`, response.status, '错误：', err)
                // 等待5000ms
                await sleep_zz(5000)
            }
        }
        logger.error(body)
        throw new Error('[chatgpt-tts]responseBody:', json)
    }
}

export function convertSpeaker(speaker) {
    switch (speaker) {
        case '派蒙':
        case '小派蒙': return '派蒙_ZH'
        case '纳西妲': return '纳西妲_ZH'
        case '可莉': return '可莉_ZH'
        case '早柚': return '早柚_ZH'
        case '迪奥娜': return '迪奥娜_ZH'
        case '瑶瑶': return '瑶瑶_ZH'
        case '七七': return '七七_ZH'
        case '希格雯': return '希格雯_ZH'
        case '神里绫华': return '神里绫华_ZH'
        case '胡桃': return '胡桃_ZH'
        case '雷电将军': return '雷电将军_ZH'
        case '芙宁娜': return '芙宁娜_ZH'
        case '绮良良': return '绮良良_ZH'
        case '刻晴': return '刻晴_ZH'
        case '珊瑚宫心海': return '珊瑚宫心海_ZH'
        case '迪卢克': return '迪卢克_ZH'
        case '心奈': return '春原心奈'
        case '小春': return '下江小春'
    }

    return speaker
}

/**输入文本，匹配tts情感中的100种（经过测试删减为6种）情感(例如派蒙生气地说道)，返回开头大写的情感单词，无匹配则使用[0]Happy，支持中英文。 */
function get_tts_Emotion(chat_str) {
    /**提取vits_emotion_map中的括号内的感情词，放在数组emotion_language_map中； */
    let emotion_language_map
    if (Config.tts_language == 'EN') {
        chat_str = chat_str.toLowerCase()
        const regex_emotion_map = /\b\w+\b\s*\(/g;
        emotion_language_map = vits_emotion_map.map(item => {
            const match = item.match(regex_emotion_map);
            return match ? match[0].replace(/\(|\)|\s/g, '').toLowerCase() : '';
        });
    } else {
        const regex_emotion_map = /\((.*?)\)/g;
        emotion_language_map = vits_emotion_map.map(item => {
            const match = item.match(regex_emotion_map);
            return match ? match[0].replace(/\(|\)/g, '') : '';
        });
    }

    /**根据emotion_language_map遍历对话字符串，返回对应的emotion_language_map编号 */
    let target_num = 0
    for (let i = 0; i < emotion_language_map.length; i++) {
        let emotion_targe = emotion_language_map[i]

        const index_emotion = chat_str.indexOf(emotion_targe);
        if (index_emotion !== -1) {
            target_num = i;
            break;
        }
    }

    /**根据vits_emotion_map[target_num]返回tts情感值（开头为大写的英文单词） */
    let auto_vits_emotion = vits_emotion_map[target_num].replace(/(\s+)|([(].*[)])/g, "").replace(/:|([0-9]*)/g, '')
    return auto_vits_emotion
}
