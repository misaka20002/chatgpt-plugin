/**
 * Chromium 连接/启动的旧封装。
 *
 * **当前没有任何模块 import 它**：原先唯一的调用方是 `website` 工具的 puppeteer 通道，
 * 那条路已按 ADR 0005 删除（正文覆盖不比纯 HTTP 好，却要 2–5 秒一页加一个 Chromium）。
 * 保留是因为删除文件属于单独议题，不在这里顺手做。
 *
 * 不要拿它读网页：`ChatGPTPuppeteer.close()` 关的是共享实例（连的是 `127.0.0.1:51777`），
 * 一旦连上，`close()` 会把插件自己的头像/数学渲染一起关掉——这正是当初删掉那个通道的原因。
 */
import lodash from 'lodash'
import { Config } from './config.js'
let puppeteer = {}

class Puppeteer {
  constructor () {
    let args = [
      '--exclude-switches',
      '--no-sandbox',
      '--remote-debugging-port=51777',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-service-autorun',
      '--password-store=basic',
      '--system-developer-mode',
      '--mute-audio',
      '--disable-default-apps',
      '--no-zygote',
      '--disable-accelerated-2d-canvas',
      '--disable-web-security'
      // '--shm-size=1gb'
    ]
    if (Config.proxy) {
      args.push(`--proxy-server=${Config.proxy}`)
    }
    this.browser = false
    this.lock = false
    this.config = {
      headless: Config.headless,
      args
    }

    if (Config.chromePath) {
      this.config.executablePath = Config.chromePath
    }

    this.html = {}
  }

  async initPupp () {
    if (!lodash.isEmpty(puppeteer)) return puppeteer
    puppeteer = (await import('puppeteer')).default
    // const pluginStealth = StealthPlugin()
    // puppeteer.use(pluginStealth)
    return puppeteer
  }

  /**
     * 初始化chromium
     */
  async browserInit () {
    await this.initPupp()
    if (this.browser) return this.browser
    if (this.lock) return false
    this.lock = true

    logger.mark('chatgpt puppeteer 启动中...')
    const browserURL = 'http://127.0.0.1:51777'
    try {
      this.browser = await puppeteer.connect({ browserURL })
    } catch (e) {
      /** 初始化puppeteer */
      this.browser = await puppeteer.launch(this.config).catch((err) => {
        logger.error(err.toString())
        if (String(err).includes('correct Chromium')) {
          logger.error('没有正确安装Chromium，可以尝试执行安装命令：node ./node_modules/puppeteer/install.js')
        }
      })
    }
    this.lock = false

    if (!this.browser) {
      logger.error('chatgpt puppeteer 启动失败')
      return false
    }

    logger.mark('chatgpt puppeteer 启动成功')

    /** 监听Chromium实例是否断开 */
    this.browser.on('disconnected', (e) => {
      logger.info('Chromium实例关闭或崩溃！')
      this.browser = false
    })

    return this.browser
  }
}

export class ChatGPTPuppeteer extends Puppeteer {
  constructor (opts = {}) {
    super()
    const {
      debug = false
    } = opts

    this._debug = !!debug
  }

  async getBrowser () {
    if (this.browser) {
      return this.browser
    } else {
      return await this.browserInit()
    }
  }

  async close () {
    if (this.browser) {
      await this.browser.close()
    }
    this._page = null
    this.browser = null
  }
}

export default new ChatGPTPuppeteer()
