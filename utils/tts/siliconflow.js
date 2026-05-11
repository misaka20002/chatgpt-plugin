import fetch from 'node-fetch'

/**
 * SiliconFlow TTS API 接口封装
 */
export default {
    /**
     * 获取用户动态音色列表
     */
    async listVoices(apiKey) {
        const url = "https://api.siliconflow.cn/v1/audio/voice/list";
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                "Authorization": `Bearer ${apiKey}`
            }
        });
        return await response.json();
    },

    /**
     * 上传/创建用户动态音色 (使用Base64格式)
     * @param {string} apiKey 
     * @param {string} model 模型名称，如 FunAudioLLM/CosyVoice2-0.5B
     * @param {string} customName 自定义名称
     * @param {string} audioBase64 带有 data:audio/xxx;base64, 前缀的字符串
     * @param {string} text 参考音频对应的文字内容
     */
    async uploadVoice(apiKey, model, customName, audioBase64, text) {
        const url = "https://api.siliconflow.cn/v1/uploads/audio/voice";
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model,
                customName: customName,
                audio: audioBase64,
                text: text
            })
        });
        return await response.json();
    },

    /**
     * 删除用户动态音色
     * @param {string} apiKey 
     * @param {string} uri 音色ID (uri)
     */
    async deleteVoice(apiKey, uri) {
        const url = "https://api.siliconflow.cn/v1/audio/voice/deletions";
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ uri: uri })
        });
        // 删除接口可能返回的是 text 而不是 json
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            return { status: response.status, message: text };
        }
    }
}