import { Worker } from 'node:worker_threads'

export class AvatarRenderQueue {
  constructor() {
    this.waiting = []
    this.active = false
  }

  render(resource, cue, isCurrent = () => true, options = {}) {
    if (this.active && this.waiting.length >= 3) return Promise.reject(new Error('角色渲染队列已满，跳过附图'))
    return new Promise((resolve, reject) => {
      this.waiting.push({ resource, cue, isCurrent, options, resolve, reject })
      this.drain()
    })
  }

  async drain() {
    if (this.active) return
    const job = this.waiting.shift()
    if (!job) return
    this.active = true
    try {
      if (!job.isCurrent()) throw new Error('角色任务已取消')
      const worker = new Worker(new URL('./worker.js', import.meta.url), { execArgv: [] })
      try {
        const gif = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('角色渲染超时')), 30000)
          const settle = callback => value => { clearTimeout(timeout); callback(value) }
          worker.once('message', settle(message => message.error
            ? reject(new Error(message.error)) : resolve(Buffer.from(message.gif))))
          worker.once('error', settle(reject))
          worker.once('exit', settle(code => reject(new Error('角色渲染线程提前退出：' + code))))
          worker.postMessage({ resource: job.resource, cue: job.cue, options: job.options })
        })
        if (!job.isCurrent()) throw new Error('角色任务已取消')
        job.resolve(gif)
      } finally {
        await worker.terminate()
      }
    } catch (err) {
      job.reject(err)
    } finally {
      this.active = false
      this.drain()
    }
  }
}
