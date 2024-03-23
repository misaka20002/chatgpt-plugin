import { Config } from '../utils/config.js'
import {
    getImg
} from '../utils/common.js'
import fetch from 'node-fetch'
import { CustomGoogleGeminiClient } from "../client/CustomGoogleGeminiClient.js";

/**
 * @description: 获取gemini的识图结果，需要填写了gemini的token
 * @param {*} e
 * @return {*} recognitionResults
 */
export async function recognitionResultsByGemini(e) {
    if (Config.geminiKey) {
        let img = await getImg(e)
        if (img?.[0]) {
            let client = new CustomGoogleGeminiClient({
                e,
                userId: e.sender.user_id,
                key: Config.geminiKey,
                model: 'gemini-pro-vision',
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
                if(!res?.text) recognitionResults = '附带了一张儿童不宜的涩图。'
            }
            return recognitionResults
        }
    }
}