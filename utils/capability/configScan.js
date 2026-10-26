import path from 'node:path'

import { collectDescriptiveStrings } from './redact.js'
import { listFiles, readTextFile, MAX_CONFIG_FILE_BYTES } from './fileRead.js'

/**
 * 读第三方插件的配置文件，只取「描述性文本」。
 *
 * 这里是最容易出事的一处：别人插件的配置里躺着 API Key、webhook、口令。
 * 所以只读 JSON（结构可解析，不会把注释里的密钥带出来），每个插件只读前几个文件、
 * 每个文件设体积上限，解析后立刻交给双过滤——凭证类字段在进入表单之前就被丢弃。
 *
 * 全程只读：本模块不 import 任何写 API。
 */

const MAX_FILES_PER_PLUGIN = 3
const PER_PLUGIN_LIMIT = 30

/**
 * @param {{ plugins: Array<{ key: string, dir: string }> }} snapshot
 * @returns {Promise<Record<string, { field: string, value: string }[]>>}
 */
export async function collectConfigHints (snapshot) {
  const hints = {}
  const plugins = Array.isArray(snapshot?.plugins) ? snapshot.plugins : []

  for (const plugin of plugins) {
    if (!plugin?.dir || !plugin?.key) continue
    const picked = await scanPluginConfig(plugin.dir)
    if (picked.length) hints[plugin.key] = picked
  }

  return hints
}

async function scanPluginConfig (dir) {
  const files = await listConfigFiles(dir)
  const picked = []

  for (const file of files) {
    if (picked.length >= PER_PLUGIN_LIMIT) break
    const text = await readTextFile(file, MAX_CONFIG_FILE_BYTES)
    if (!text) continue

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      // 不是合法 JSON 就整份跳过：解析不了，就无法保证里面没有凭证
      continue
    }

    picked.push(...collectDescriptiveStrings(parsed, { limit: PER_PLUGIN_LIMIT - picked.length }))
  }

  return picked
}

async function listConfigFiles (dir) {
  const direct = await listFiles(dir, name => name.toLowerCase() === 'config.json')
  const nested = await listFiles(path.join(dir, 'config'), name => name.toLowerCase().endsWith('.json'))
  return [...direct, ...nested].slice(0, MAX_FILES_PER_PLUGIN)
}
