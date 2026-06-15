import axios from 'axios'
import { Config } from '../config.js'

/**
 * AnythingLLM API 客户端
 * 用于与 AnythingLLM 知识库服务通信
 */
export class AnythingLLMClient {
  constructor(config = null) {
    const cfg = config || Config

    this.baseUrl = cfg.anythingllm_baseUrl || 'http://localhost:3001'
    this.apiKey = cfg.anythingllm_apiKey || ''
    this.timeout = cfg.anythingllm_timeout || 30000
    this.maxRetries = cfg.anythingllm_maxRetries || 3

    // 创建 axios 实例
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    // 添加请求拦截器
    this.client.interceptors.request.use(
      config => {
        logger.debug(`[AnythingLLM] 请求: ${config.method.toUpperCase()} ${config.url}`)
        return config
      },
      error => {
        logger.error('[AnythingLLM] 请求拦截器错误:', error)
        return Promise.reject(error)
      }
    )

    // 添加响应拦截器
    this.client.interceptors.response.use(
      response => {
        logger.debug(`[AnythingLLM] 响应成功: ${response.config.url}`)
        return response
      },
      error => {
        logger.error('[AnythingLLM] 响应错误:', error.message)
        return Promise.reject(this._handleError(error))
      }
    )
  }

  /**
   * 检查连接状态
   * @returns {Promise<boolean>}
   */
  async checkHealth() {
    try {
      const response = await this.client.get('/api/health')
      return response.data.status === 'ok'
    } catch (error) {
      logger.warn(`[AnythingLLM] 健康检查失败: ${error.message}`)
      return false
    }
  }

  /**
   * RAG 查询 - 在工作区中检索并获取答案
   * @param {string} workspaceSlug - 工作区 slug
   * @param {string} message - 查询消息
   * @param {string} mode - 查询模式: 'chat' 或 'query'
   * @param {string} userId - 用户 ID（可选）
   * @returns {Promise<Object>} 查询结果
   */
  async chat(workspaceSlug, message, mode = 'query', userId = 'yunzai-bot') {
    try {
      const response = await this._retryRequest(async () => {
        return await this.client.post(
          `/api/v1/workspace/${workspaceSlug}/chat`,
          {
            message,
            mode,
            userId
          }
        )
      })

      return response.data
    } catch (error) {
      throw new Error(`查询失败: ${error.message}`)
    }
  }

  /**
   * 获取工作区列表
   * @returns {Promise<Array>}
   */
  async listWorkspaces() {
    try {
      const response = await this._retryRequest(async () => {
        return await this.client.get('/api/v1/workspaces')
      })

      return response.data.workspaces || []
    } catch (error) {
      throw new Error(`获取工作区列表失败: ${error.message}`)
    }
  }

  /**
   * 获取工作区信息
   * @param {string} workspaceSlug - 工作区 slug
   * @returns {Promise<Object>}
   */
  async getWorkspace(workspaceSlug) {
    try {
      const response = await this._retryRequest(async () => {
        return await this.client.get(`/api/v1/workspace/${workspaceSlug}`)
      })

      return response.data.workspace
    } catch (error) {
      throw new Error(`获取工作区信息失败: ${error.message}`)
    }
  }

  /**
   * 获取工作区中的文档列表
   * @param {string} workspaceSlug - 工作区 slug
   * @returns {Promise<Array>}
   */
  async getWorkspaceDocuments(workspaceSlug) {
    try {
      const response = await this._retryRequest(async () => {
        return await this.client.get(`/api/v1/workspace/${workspaceSlug}/documents`)
      })

      return response.data.documents || []
    } catch (error) {
      throw new Error(`获取文档列表失败: ${error.message}`)
    }
  }

  /**
   * 上传文档到工作区
   * @param {Buffer|Stream} file - 文件内容
   * @param {string} filename - 文件名
   * @param {string} workspaceSlug - 工作区 slug
   * @returns {Promise<Object>}
   */
  async uploadDocument(file, filename, workspaceSlug) {
    try {
      const FormData = (await import('form-data')).default
      const formData = new FormData()

      formData.append('file', file, filename)
      formData.append('workspace', workspaceSlug)

      const response = await this._retryRequest(async () => {
        return await this.client.post(
          '/api/v1/document/upload',
          formData,
          {
            headers: {
              ...formData.getHeaders(),
              'Authorization': `Bearer ${this.apiKey}`
            }
          }
        )
      })

      return response.data
    } catch (error) {
      throw new Error(`上传文档失败: ${error.message}`)
    }
  }

  /**
   * 从工作区删除文档
   * @param {string} workspaceSlug - 工作区 slug
   * @param {string} docName - 文档名称
   * @returns {Promise<Object>}
   */
  async deleteDocument(workspaceSlug, docName) {
    try {
      const response = await this._retryRequest(async () => {
        return await this.client.delete(
          `/api/v1/workspace/${workspaceSlug}/document/${encodeURIComponent(docName)}`
        )
      })

      return response.data
    } catch (error) {
      throw new Error(`删除文档失败: ${error.message}`)
    }
  }

  /**
   * 更新工作区的文档嵌入
   * @param {string} workspaceSlug - 工作区 slug
   * @returns {Promise<Object>}
   */
  async updateEmbeddings(workspaceSlug) {
    try {
      const response = await this._retryRequest(async () => {
        return await this.client.post(`/api/v1/workspace/${workspaceSlug}/update-embeddings`)
      })

      return response.data
    } catch (error) {
      throw new Error(`更新嵌入失败: ${error.message}`)
    }
  }

  /**
   * 重试请求
   * @private
   */
  async _retryRequest(requestFn, retries = this.maxRetries) {
    for (let i = 0; i <= retries; i++) {
      try {
        return await requestFn()
      } catch (error) {
        if (i === retries) {
          throw error
        }

        // 如果是认证错误或 4xx 错误，不重试
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          throw error
        }

        const delay = Math.min(1000 * Math.pow(2, i), 10000) // 指数退避，最大 10 秒
        logger.warn(`[AnythingLLM] 请求失败，${delay}ms 后重试 (${i + 1}/${retries})`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  /**
   * 处理错误
   * @private
   */
  _handleError(error) {
    if (error.response) {
      // 服务器返回错误响应
      const status = error.response.status
      const message = error.response.data?.message || error.response.statusText

      switch (status) {
        case 401:
          return new Error('API Key 无效或未授权，请检查配置')
        case 403:
          return new Error('没有权限访问该资源')
        case 404:
          return new Error('请求的资源不存在（工作区或文档未找到）')
        case 429:
          return new Error('请求过于频繁，请稍后再试')
        case 500:
        case 502:
        case 503:
          return new Error(`AnythingLLM 服务错误: ${message}`)
        default:
          return new Error(`请求失败 (${status}): ${message}`)
      }
    } else if (error.request) {
      // 请求已发送但没有收到响应
      if (error.code === 'ECONNREFUSED') {
        return new Error('无法连接到 AnythingLLM 服务，请检查服务地址和端口')
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return new Error('请求超时，请检查网络连接或增加超时时间')
      } else {
        return new Error(`网络错误: ${error.message}`)
      }
    } else {
      // 其他错误
      return new Error(`未知错误: ${error.message}`)
    }
  }
}

/**
 * 创建全局单例客户端
 */
let globalClient = null

export function getAnythingLLMClient(config = null) {
  if (!globalClient || config) {
    globalClient = new AnythingLLMClient(config)
  }
  return globalClient
}
