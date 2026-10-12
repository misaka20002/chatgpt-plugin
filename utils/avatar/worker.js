import { parentPort } from 'node:worker_threads'
import { renderAvatarGif } from './render.js'

parentPort.on('message', async ({ resource, cue, options }) => {
  try {
    const gif = await renderAvatarGif(resource, cue, options)
    parentPort.postMessage({ gif })
  } catch (err) {
    parentPort.postMessage({ error: '角色渲染失败：' + err.message })
  }
})
