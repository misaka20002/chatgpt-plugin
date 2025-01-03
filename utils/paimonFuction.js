import { Config } from '../utils/config.js'
// import { getImg } from '../utils/common.js'
import fetch from 'node-fetch'
import { CustomGoogleGeminiClient } from "../client/CustomGoogleGeminiClient.js";

/**
 * @description: 获取gemini的识图结果，需要填写了gemini的token
 * @param {*} e
 * @param {*} img 数组
 * @return {*} recognitionResults
 */
export async function recognitionResultsByGemini(e, img) {
    // 获取秘钥
    const gemini_Key = geminiKeyManager.getKey()

    if (gemini_Key) {
        if (img?.[0]) {
            let client = new CustomGoogleGeminiClient({
                e,
                userId: e.sender.user_id,
                key: gemini_Key,
                model: Config.gemini_vqa_model,
                baseUrl: Config.geminiBaseUrl,
                debug: Config.debug
            })
            const response = await fetch(img[0], { timeout: 60000 });
            const base64Image = Buffer.from(await response.arrayBuffer()).toString('base64')
            if (!base64Image) {
                return "图片链接已经失效，请重新上传图片。"
            }
            const reg_chatgpt_for_firstperson_call = new RegExp(Config.tts_First_person + "[,，.。]*", "g");
            let msg = e.msg.replace(reg_chatgpt_for_firstperson_call, '') || 'describe this image in Simplified Chinese'
            let recognitionResults = ''
            try {
                let res = await client.sendMessage(msg, {
                    image: base64Image,
                    system: '你是一个专业的图像识别和分析助手。请仔细、详细、准确地观察和描述图像，并尽可能提供精确的信息。分析图像时需要注意以下几点：；1. 逐步、系统地扫描图像的每个区域；2. 准确识别图像中的主要对象、人物、场景；3. 描述图像的细节特征；4. 如有不确定的地方，说明可能性和置信度；5. 避免主观臆测，只描述实际看到的内容；6.请使用中文描述；请使用清晰、客观、专业的语言进行图像分析。'
                })
                recognitionResults = res.text
            } catch (err) {
                logger.info('派蒙第一人称对话-获取gemini的识图结果出错' + err)
                recognitionResults = '这是一张儿童不宜的涩图。'
            }
            return recognitionResults
        }
    }
}

/**
 * @description: 把句子转为不超过3个元素的数组
 * @param {*} str
 * @return {*} array
 */
export function convertSentenceToArray(str) {
    // 用正则表达式来保留句号和问号符号
    // let arr = str.split(/([。？！～~!?“”"'‘’\n]+)/).filter(Boolean);
    let arr = str.split(/([。？！!?”’）)\n]+)/).filter(Boolean);
    let newArr = [];
    let tempSentence = '';
    // 把分隔符号插回去
    for (let i = 0; i < arr.length; i++) {
        tempSentence += arr[i];
        if (i % 2 !== 0) {
            newArr.push(tempSentence);
            tempSentence = '';
        } else if (i === arr.length - 1) {
            newArr.push(tempSentence);
        }
    }
    // 重组为不超过3句话
    while (newArr.length > 3) {
        for (let i = 0; i < newArr.length; i++) {
            newArr[i] = newArr[i] + (newArr[i + 1] || "");
            newArr.splice(i + 1, 1);
        }
    }
    // 把长度小于5的元素合并
    for (let i = 0; i < newArr.length; i++) {
        if (newArr[i].length < 5 || newArr[i + 1]?.length < 5) {
            newArr[i] = newArr[i] + (newArr[i + 1] || "");
            newArr.splice(i + 1, 1);
        }
    }
    // 删除句号和大括号
    for (let i = 0; i < newArr.length; i++) {
        // newArr[i] = newArr[i].replace(/。|\n$|^{|}$|(?<=.)\n|\n(?=.)/gm, "")
        newArr[i] = newArr[i].replace(/。|\n$|^{|}$|^(，|,)/gm, "")
    }

    return newArr;
}

/**
 * @description: 随机提取 gemini Keys，注意要把 Config.geminiKey 都替换为 
 * 
import { geminiKeyManager } from "../utils/paimonFuction.js";  
const gemini_Key = geminiKeyManager.getKey()
 * 
 * @return {*}
 */
class gemini_KeyManager {
    constructor() {
        // 获取所有可用的keys
        this.keys = Config.geminiKeyArr.split(/[,，;；|]/);
    }

    /** 随机获取一个key */
    getKey() {
        if (this.keys.length === 0) {
            logger.error("[chatgpt]未填写gemini的API密钥");
            return null;
        }

        // 重新获取keys列表
        this.keys = Config.geminiKeyArr.split(/[,，]/);

        // 随机获取一个索引
        const randomIndex = Math.floor(Math.random() * this.keys.length);

        logger.info(`[chatgpt]随机使用第${randomIndex + 1}个gemini Key: ${this.keys[randomIndex]}`);
        return this.keys[randomIndex];
    }
}
/** 轮替使用 gemini Keys 实例 */
export const geminiKeyManager = new gemini_KeyManager(Config.geminiKeyArr);