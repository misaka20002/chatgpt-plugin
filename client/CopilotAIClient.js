import WebSocket from 'ws'
import common from '../../../lib/common/common.js'
import _ from 'lodash'
import { pTimeout } from '../utils/common.js'
import { Config } from '../utils/config.js'

export class BingAIClient {
  constructor (accessToken, baseUrl = 'wss://copilot.microsoft.com', debug, _2captchaKey, clientId, scope, refreshToken, oid, reasoning = false) {
    this.accessToken = accessToken
    this.baseUrl = baseUrl
    if (this.baseUrl.endsWith('/')) {
      this.baseUrl = _.trimEnd(baseUrl, '/')
    }
    this.ws = null
    this.conversationId = null
    this.partialMessages = new Map()
    this.debug = debug
    this._2captchaKey = _2captchaKey
    this.clientId = clientId
    this.scope = scope
    this.refreshToken = refreshToken
    this.oid = oid
    this.reasoning = reasoning
  }

  async sendMessage (text, options = {}) {
    // 如果 options 中有 conversationId，使用它；否则生成一个新的 conversationId
    if (options.conversationId) {
      this.conversationId = options.conversationId
    } else {
      this.conversationId = await this._generateConversationId()
    }

    // 建立 WebSocket 连接
    await this.connectWebSocket()

    // 发送消息
    await this.sendInitialMessage(text)

    // 等待并收集服务器的回复
    try {
      const responseText = await pTimeout(await this.collectResponse(), {
        milliseconds: 1000 * 60 * 5
      })
      return responseText
    } catch (err) {
      if (this.partialMessages.get(this.currentMessageId)) {
        return this.partialMessages.get(this.currentMessageId).text
      } else {
        throw err
      }
    }
  }

  async connectWebSocket () {
    return new Promise((resolve, reject) => {
      let wsUrl = this.baseUrl
      if (wsUrl.startsWith('http')) {
        wsUrl = wsUrl.replace('https://', 'wss://')
          .replace('http://', 'ws://')
      }
      let url = `${wsUrl}/c/api/chat?api-version=2`
      if (this.accessToken) {
        url += '&accessToken=' + this.accessToken
      }
      logger.info('ws url: ' + url)
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        console.log('WebSocket connection established.')
        resolve()
      })

      if (this.debug) {
        this.ws.on('message', (message) => {
          logger.info('received message', String(message))
        })
      }
      this.ws.on('close', async (code, reason) => {
        console.log('WebSocket connection closed. Code:', code, 'Reason:', reason)

        if (code === 401) {
          logger.error('token expired. try to refresh with refresh token')
          await this.doRefreshToken()
        }
      })

      this.ws.on('error', (err) => {
        reject(err)
      })
    })
  }

  async sendInitialMessage (text) {
    return new Promise((resolve, reject) => {
      const initMgs = { event: 'setOptions', supportedCards: ['image'], ads: null }
      this.ws.send(JSON.stringify(initMgs))
      if (this.debug) {
        logger.info('send msg: ', JSON.stringify(initMgs))
      }
      const messagePayload = {
        event: 'send',
        conversationId: this.conversationId,
        content: [{ type: 'text', text }],
        mode: this.reasoning ? 'reasoning' : 'chat',
        context: { edge: 'NonContextual' }
      }

      // 直接发送消息
      this.ws.send(JSON.stringify(messagePayload))
      if (this.debug) {
        logger.info('send msg: ', JSON.stringify(messagePayload))
      }
      let _this = this
      // 设置超时机制，防止长时间未收到消息
      const timeout = setTimeout(() => {
        reject(new Error('No response from server within timeout period.'))
      }, 5000) // 设置 5 秒的超时时间
      // 一旦收到消息，处理逻辑
      this.ws.once('message', (data) => {
        clearTimeout(timeout) // 清除超时定时器
        const message = JSON.parse(data)
        logger.info(data)
        if (message.event === 'challenge') {
          logger.warn('遇到turnstile验证码，尝试使用2captcha解决')
          // 如果收到 challenge，处理挑战
          this.handleChallenge(message)
            .then(() => {
              setTimeout(() => {
                _this.ws.send(JSON.stringify(messagePayload))
                resolve()
              }, 500)
            })
            .catch(reject)
        } else {
          // 否则直接进入对话
          resolve()
        }
      })
    })
  }

  async handleChallenge (challenge) {
    // 获取 challenge 的 token（你需要根据实际情况实现此方法）
    if (!this._2captchaKey) {
      throw new Error('No 2captchaKey')
    }
    const token = await this.getTurnstile(challenge.conversationId)

    const challengeResponse = {
      event: 'challengeResponse',
      token,
      method: 'cloudflare'
    }

    this.ws.send(JSON.stringify(challengeResponse))
  }

  async collectResponse () {
    return new Promise((resolve, reject) => {
      const checkMessageComplete = (messageId) => {
        // 如果消息已经完成，返回完整的消息内容
        if (this.partialMessages.has(messageId) && this.partialMessages.get(messageId).done) {
          const completeMessage = this.partialMessages.get(messageId).text
          resolve(completeMessage)
        }
      }

      this.ws.on('message', (data) => {
        const message = JSON.parse(data)

        switch (message.event) {
          case 'received':
            break

          case 'startMessage':
            this.currentMessageId = message.messageId
            break

          case 'appendText':
            if (!this.partialMessages.has(message.messageId)) {
              this.partialMessages.set(message.messageId, { text: '', done: false })
            }

            this.partialMessages.get(message.messageId).text += message.text

            // 如果是最后一部分，标记为完成
            // if (message.partId === '0') {
            //   this.partialMessages.get(message.messageId).done = true
            // }

            checkMessageComplete(message.messageId)
            break

          case 'partCompleted':
            this.partialMessages.get(message.messageId).done = true
            break

          case 'done':
            checkMessageComplete(message.messageId)
            break

          default:
            // console.warn('Unexpected event:', message.event)
            break
        }
      })
    })
  }

  async getTurnstile (conversationId) {
    // 这里需要根据实际情况实现获取 challenge token 的方法
    const myHeaders = new Headers()
    myHeaders.append('Content-Type', 'application/json')

    const raw = JSON.stringify({
      clientKey: this._2captchaKey,
      task: {
        type: 'TurnstileTaskProxyless',
        websiteURL: 'https://copilot.microsoft.com/chats/' + conversationId,
        websiteKey: '0x4AAAAAAAg146IpY3lPNWte'
      }
    })

    const requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: raw,
      redirect: 'follow'
    }

    const response = await fetch('https://api.2captcha.com/createTask', requestOptions)
    const createTaskRsp = await response.json()
    const taskId = createTaskRsp.taskId

    const raw2 = JSON.stringify({
      taskId,
      clientKey: this._2captchaKey
    })

    async function getTaskResult () {
      const requestOptions2 = {
        method: 'POST',
        headers: myHeaders,
        body: raw2,
        redirect: 'follow'
      }

      const response2 = await fetch('https://api.2captcha.com/getTaskResult', requestOptions2)
      const taskResponse = await response2.json()
      logger.info(JSON.stringify(taskResponse))
      const token = taskResponse?.solution?.token
      return token
    }

    let retry = 90
    let token = await getTaskResult()
    while (retry > 0 && !token) {
      await common.sleep(1000)
      token = await getTaskResult()
      retry--
    }
    if (!token) {
      throw new Error('No response from server within timeout period.')
    }
    return token
  }

  async _generateConversationId (times = 3) {
    if (times < 0) {
      throw new Error('max retry exceed, maybe refresh token error')
    }
    const url = `${this.baseUrl}/c/api/conversations`
    const createConversationRsp = await fetch(url, {
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
        origin: 'https://copilot.microsoft.com',
        referer: 'https://copilot.microsoft.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0'
      },
      method: 'POST'
    })
    if (createConversationRsp.status === 401) {
      await this.doRefreshToken()
      return await this._generateConversationId(times - 1)
    }
    const conversation = await createConversationRsp.json()
    return conversation.id
  }

  async _getCurrentConversationId () {
    const url = `${this.baseUrl}/c/api/start`
    const createConversationRsp = await fetch(url, {
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
        origin: 'https://copilot.microsoft.com',
        referer: 'https://copilot.microsoft.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0'
      },
      method: 'POST',
      body: JSON.stringify({
        timeZone: 'Asia/Shanghai',
        teenSupportEnabled: true
      })
    })
    const conversation = await createConversationRsp.json()
    return conversation.currentConversationId
  }

  /**
   * refresh token
   * @param clientId
   * @param scope
   * @param refreshToken
   * @param oid
   * @returns {Promise<{
   *   token_type: string,
   *   scope: string,
   *   expires_in: number,
   *   ext_expires_in: number,
   *   access_token: string,
   *   refresh_token: string
   * }>}
   */
  async doRefreshToken (clientId = this.clientId, scope = this.scope, refreshToken = this.refreshToken, oid = this.oid) {
    const myHeaders = new Headers()
    myHeaders.append('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0')
    myHeaders.append('priority', 'u=1, i')
    myHeaders.append('referer', 'https://copilot.microsoft.com/')
    myHeaders.append('origin', 'https://copilot.microsoft.com')
    myHeaders.append('Content-Type', 'application/x-www-form-urlencoded')

    const urlencoded = new URLSearchParams()
    urlencoded.append('client_id', clientId)
    urlencoded.append('redirect_uri', 'https://copilot.microsoft.com')
    urlencoded.append('scope', scope)
    urlencoded.append('grant_type', 'refresh_token')
    urlencoded.append('client_info', '1')
    urlencoded.append('x-client-SKU', 'msal.js.browser')
    urlencoded.append('x-client-VER', '3.26.1')
    urlencoded.append('x-ms-lib-capability', 'retry-after, h429')
    urlencoded.append('x-client-current-telemetry', '5|61,0,,,|,')
    urlencoded.append('x-client-last-telemetry', '5|3|||0,0')
    urlencoded.append('client-request-id', crypto.randomUUID())
    urlencoded.append('refresh_token', refreshToken)
    urlencoded.append('X-AnchorMailbox', 'Oid:' + oid)

    const requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: urlencoded,
      redirect: 'follow'
    }

    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', requestOptions)
    const tokenJson = await tokenResponse.json()
    if (this.debug) {
      logger.info(JSON.stringify(tokenJson))
    }
    this.accessToken = tokenJson.access_token
    Config.bingAiToken = this.accessToken
    if (tokenJson.refresh_token) {
      this.refreshToken = tokenJson.refresh_token
      Config.bingAiRefreshToken = this.refreshToken
    }

    return tokenJson
  }
}
