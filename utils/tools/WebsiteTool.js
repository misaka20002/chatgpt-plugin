import { AbstractTool } from './AbstractTool.js'
import { formatWebContent, resolveStart } from './webContent.js'
import { fetchLocalPage } from './localFetch.js'

export class WebsiteTool extends AbstractTool {
  name = 'website'

  parameters = {
    properties: {
      url: {
        type: 'string',
        description: '要读取的网页地址，必须是 http 或 https 链接'
      },
      start: {
        type: 'number',
        description: '可选，字符偏移。上一次返回里出现 truncated 标记时，把标记里的 start 填进来读后续内容'
      }
    },
    required: ['url']
  }

  func = async function (opts) {
    const { url, start } = opts
    const { start: offset, error } = resolveStart(start)
    if (error) {
      return `Error: ${error}`
    }
    try {
      const page = await fetchLocalPage(url)
      return formatWebContent({
        provider: '本地抓取',
        url: page.url,
        title: page.title,
        text: page.text,
        start: offset
      })
    } catch (err) {
      return `Error: 读取失败：${err?.message || err}`
    }
  }.bind(this)

  description = '直接用本机网络读取一个网页的正文，返回 Markdown。它不启动浏览器，也不绕过反爬或登录：需要 JavaScript 渲染的页面、需要登录的页面、知乎/Reddit 这类会拒绝直接访问的站点通常读不到，失败时会说明原因。需要更高质量时改用 Exa 或 Parallel 网页读取工具。'
}
