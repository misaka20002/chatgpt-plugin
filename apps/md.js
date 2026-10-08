import { resolveProvider, providerModel } from '../utils/providers.js'
import { providerLabel } from '../utils/providerProfiles.js'
import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'

export class ChatGPTMarkdownHandler extends plugin {
  constructor () {
    super({
      name: 'chatgptmd处理器',
      priority: -100,
      namespace: 'chatgpt-plugin',
      handler: [{
        key: 'chatgpt.markdown.convert',
        fn: 'mdHandler'
      }]
    })
  }

  async mdHandler (e, options, reject) {
    const { content, prompt, use } = options
    if (Config.enableMd) {
      let mode = transUse(use)
      return `> ${prompt}\n\n---\n${content}\n\n---\n*当前模式：${mode}*`
    } else {
      return content
    }
  }
}

function transUse (use) {
  const row = resolveProvider()
  return `${providerLabel(row)} / ${providerModel(row)}`
}
