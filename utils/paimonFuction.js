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
    if (Config.geminiKey) {
        if (img?.[0]) {
            let client = new CustomGoogleGeminiClient({
                e,
                userId: e.sender.user_id,
                key: Config.geminiKey,
                model: Config.gemini_vqa_model,
                baseUrl: Config.geminiBaseUrl,
                debug: Config.debug
            })
            const response = await fetch(img[0], { timeout: 60000 });
            const base64Image = Buffer.from(await response.arrayBuffer())
            let msg = 'describe this image in Simplified Chinese'
            let recognitionResults = ''
            try {
                let res = await client.sendMessage(msg, {
                    image: base64Image.toString('base64')
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
    let arr = str.split(/([。？！～~!?\n]+)/).filter(Boolean);
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
        newArr[i] = newArr[i].replace(/。|\n$|^{|}$/gm, "")
    }

    return newArr;
}
