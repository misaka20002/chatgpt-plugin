import { AbstractTool } from './AbstractTool.js'
import crypto from 'crypto'
import fetch from 'node-fetch'

/** 必应图片公开接口搜索API (整合搜图神器高精度接口与防风控头部) */
export class SerpImageTool_by_bing extends AbstractTool {
    name = 'searchImage_by_bing'

    parameters = {
        properties: {
            q: {
                type: 'string',
                description: 'search keyword'
            },
            limit: {
                type: 'number',
                description: 'image number, default is 20, max is 50'
            }
        },
        required: ['q']
    }

    description = 'Useful when you want to search images from Bing (必应图片搜索) or Wallpaper database. Returns image URLs that can be sent using sendPicture.'

    /**
     * 生成必应请求所需的防风控签名和 headers
     */
    async buildBingHeaders() {
        const gecSignature = crypto.randomBytes(32).toString('hex').toUpperCase()
        const clientData = Buffer.from(JSON.stringify({
            "1": "2", "2": "1", "3": "0", "4": Date.now().toString(),
            "6": "stable", "7": Math.floor(Math.random() * 9999999999999), "9": "desktop"
        })).toString('base64')

        return {
            'accept': '*/*',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'sec-ch-ua': '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sec-ms-gec': gecSignature,
            'sec-ms-gec-version': '1-131.0.2903.112',
            'x-client-data': clientData,
            'x-edge-shopping-flag': '1',
            'Referer': 'https://cn.bing.com/visualsearch',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
        }
    }

    func = async function (opts) {
        let { q, limit = 20 } = opts
        // 限制数量范围
        limit = Math.max(1, Math.min(limit, 50))
        let images = []

        try {
            const url = `https://cn.bing.com/images/vsasync?q=${encodeURIComponent(q)}&first=0&count=${limit}&mmasync=1`
            const headers = await this.buildBingHeaders()

            let response = await fetch(url, { headers, timeout: 8000 })
            const text = await response.text()

            // 解析 JSON 或 HTML 节点
            try {
                const data = JSON.parse(text)
                let items = data.data || data.results || data.value || []
                if (Array.isArray(items)) {
                    items.forEach(item => {
                        let imgUrl = item.murl || item.contentUrl || item.imageUrl || item.url
                        if (imgUrl) {
                            images.push({
                                title: item.title || item.name || 'No title',
                                url: imgUrl,
                                thumbnail: item.turl || item.thumbnailUrl,
                                source: item.purl || item.hostPageUrl || 'bing.com'
                            })
                        }
                    })
                }
            } catch (error) {
                // JSON 失败说明返回的是 HTML 结构，使用正则匹配 metadata
                const regex = /m\s*=\s*(?:'|")(\{.*?\})(?:'|")/g
                let match
                while ((match = regex.exec(text)) !== null) {
                    try {
                        let jsonStr = match[1]
                            .replace(/&quot;/g, '"')
                            .replace(/&amp;/g, '&')
                            .replace(/&#39;/g, "'")
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')

                        let item = JSON.parse(jsonStr)
                        if (item.murl) {
                            images.push({
                                title: item.t || item.pt || 'No title',
                                url: item.murl,
                                thumbnail: item.turl,
                                source: item.purl || 'bing.com'
                            })
                        }
                    } catch (e) { }
                }
            }
        } catch (error) {
            console.warn('[SearchImage] Bing搜索失败:', error.message)
        }

        // 去重
        const uniqueImages = []
        const urlSet = new Set()
        for (const img of images) {
            if (!urlSet.has(img.url)) {
                urlSet.add(img.url)
                uniqueImages.push(img)
            }
        }
        images = uniqueImages

        images.sort(() => Math.random() - 0.5)

        // 截取 LLM 所需的数量
        images = images.slice(0, limit)

        if (images.length === 0) {
            return `No images found for keyword: ${q}`
        }

        // 返回给大模型所需的 JSON 数据格式
        return `images search results in json format:\n${JSON.stringify(images, null, 2)}. The 'url' field is the actual picture url. You should use sendPicture to send them`
    }
}