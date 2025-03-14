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
                key: Config.getGeminiKey(),
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
                    system: '我将拿出一张照片，你需要描述照片中的内容，主要包括：全局分析：描述图像主体内容、风格类型（插画/摄影/3D等）、核心氛围；细节识别：列出画面中所有可辨识的视觉元素，包括：角色的名称和所属作品（仅限90%以上确定性的角色），物体：品牌/型号/文化符号需标注来源，文字：翻译并定位文字出现位置。回复的时候仅需要用一段话描述照片的内容，不要诸如“全局分析”或者“希望这个分析对您有所帮助”这些句子。'
                })
                recognitionResults = res.text
            } catch (err) {
                logger.info('派蒙第一人称对话-获取gemini的识图结果出错' + err)
                recognitionResults = '请告知用户图片识别出错，请重新上传图片。'
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
 * @description: 获取Gemini可用的模型列表
 * @param {string} apiKey - Google AI API密钥，默认从配置中获取
 * @return {Promise<Array>} 返回可用模型的数组
 */
export async function getGeminiModelsByFetch(apiKey = Config.getGeminiKey()) {
    // 构建请求URL（考虑自定义baseUrl的情况）
    const baseUrl = Config.geminiBaseUrl || 'https://generativelanguage.googleapis.com';
    const endpoint = baseUrl.endsWith('/') ?
        `${baseUrl.slice(0, -1)}/v1beta/models` :
        `${baseUrl}/v1beta/models`;

    // 将API密钥作为URL参数
    const url = `${endpoint}?key=${apiKey}`;

    // 发送请求
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Node/1.0.0',
            'Accept': '*/*'
        },
        timeout: 60000 // 60秒超时
    });

    if (!response.ok) {
        throw new Error(`获取Gemini模型API请求失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (Config.debug) {
        logger.info('获取Gemini模型列表响应:', JSON.stringify(data));
    }

    // Extract model names from the models array and return them
    return (data.models || []).map(model => model.name?.replace(/models\//g, '').trim()).filter(Boolean);
}

/**
 * @description: 从标签中提取角色名称
 * @param {string} tags - 需要处理的标签字符串
 * @return {object} 包含角色名和处理后的标签
 */
export function extractCharacterName(tags) {
    // 为角色添加作品名
    const charactersList = Config.get_draw_PluginCharactersList();
    let charactersName = "";
    let processedTags = tags;

    // 从配置的角色列表中查找匹配
    for (const key of Object.keys(charactersList)) {
        const reg_characters = new RegExp(key, "im");
        charactersName = processedTags.match(reg_characters) ?
            charactersList[key] + ", " + charactersName : charactersName;
    }

    // 如果没有匹配到角色的话就把 tags 的第一段作为角色名
    if (!charactersName) {
        const firstPart = processedTags.split(',')?.[0]?.trim();
        if (firstPart) {
            charactersName = firstPart;
            // 把 charactersName 按 from 切割，把 from 后面的部分作为作品名
            const [char_name, ...extraInfo] = charactersName.split(/from/i);
            charactersName = char_name + (extraInfo.length ? "(" + extraInfo.map(m => m.trim()).join("") + ")" : "")
            // 从原始标签中移除第一部分
            processedTags = processedTags.replace(firstPart, "").replace(/^,\s*/, "");
        } else {
            charactersName = "";
        }
    }

    return {
        charactersName,
        processedTags
    };
}
