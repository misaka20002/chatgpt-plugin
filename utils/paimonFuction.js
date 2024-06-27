import { Config } from '../utils/config.js'
import { getImg } from '../utils/common.js'
import fetch from 'node-fetch'
import { CustomGoogleGeminiClient } from "../client/CustomGoogleGeminiClient.js";

/**
 * @description: 获取gemini的识图结果，需要填写了gemini的token
 * @param {*} e
 * @return {*} recognitionResults
 */
export async function recognitionResultsByGemini(e) {
    if (Config.geminiKey) {
        // let img = await getImg(e)
        let img = await parseSourceImg(e) // 这个版本不获取at的头像
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
                recognitionResults = '这是一张儿童不宜的涩图。'
            }
            return recognitionResults
        }
    }
}

/**
 * @description: 处理消息中的图片：当消息引用了图片，则将对应图片放入e.img ，优先级==> e.source.img > e.img
 * @param {*} e
 * @param {*} useOrigin 是否使用原图，默认为false
 * @return {*}处理过后的e
 */
async function parseSourceImg(e, useOrigin = false) {
    if (e.source) {
        let reply;
        if (e.isGroup) {
            reply = (await e.group.getChatHistory(e.source.seq, 1)).pop()?.message;
        } else {
            reply = (await e.friend.getChatHistory(e.source.time, 1)).pop()?.message;
        }
        if (reply) {
            let i = []
            for (const val of reply) {
                if (val.type === 'image') {
                    i.push(val.url)
                }
                //   if (val.type == "file") {
                //     e.reply("不支持消息中的文件，请将该文件以图片发送...", true);
                //     return;
                //   }
            }
            e.img = i
        }
        // 如果不是主人，参考图片和以图画图使用小图而不是原图大图
        // if (!e.isMaster && !useOrigin && e.img) {
        // 所有人都用小图
        if (!useOrigin && e.img) {
            for (let i = 0; i < e.img.length; i++) {
                e.img[i] = e.img[i].replace(/is_origin=\d$/, 'is_origin=0')// 匹配qq聊天中的原图
                // TODO 匹配wechat、tg聊天中的原图
            }
        }
    }
    return e.img;
}