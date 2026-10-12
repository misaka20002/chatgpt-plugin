import fs from 'node:fs'
import path from 'node:path'
import { avatarRoot, insideAvatarRoot, AVATAR_FILENAME } from './paths.js'
import { validateAvatarId } from './config.js'

// 锅巴缓存 supportGuoba 的返回值，保留同一个数组并原地更新选项。
const optionsByRoot = new Map()

export function avatarOptions(root = process.cwd()) {
  const key = avatarRoot(root)
  if (!optionsByRoot.has(key)) optionsByRoot.set(key, [])
  const options = optionsByRoot.get(key)
  const rows = []
  try {
    const base = fs.realpathSync(key)
    for (const entry of fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      try {
        validateAvatarId(entry.name)
        const filename = path.join(base, entry.name, AVATAR_FILENAME)
        if (!fs.existsSync(filename)) continue
        insideAvatarRoot(base, fs.realpathSync(filename))
        if (fs.statSync(filename).isFile()) rows.push({ label: entry.name, value: entry.name })
      } catch (err) {
        globalThis.logger?.warn('[ChatGPT] 角色目录未加入下拉：' + entry.name + '，' + err.message)
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  options.splice(0, options.length, ...rows)
  return options
}
