import fs from 'node:fs/promises'
import path from 'node:path'
import { validateAvatarId } from './config.js'

export const AVATAR_FILENAME = 'peraravatar-plus-config.json'
export const MAX_AVATAR_BYTES = 32 * 1024 * 1024
export const MAX_AVATAR_IMAGE_BYTES = 6 * 1024 * 1024

export function avatarRoot(root) { return path.resolve(root, 'data/chatgpt/avatars') }

export function insideAvatarRoot(root, target) {
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('角色路径超出资源目录')
  }
}

export async function checkedAvatarPath(root, avatarId, filename = AVATAR_FILENAME, allowMissing = false) {
  validateAvatarId(avatarId)
  validateAvatarId(filename)
  const base = await fs.realpath(avatarRoot(root))
  const directory = await fs.realpath(path.join(base, avatarId))
  insideAvatarRoot(base, directory)
  if (!(await fs.stat(directory)).isDirectory()) throw new Error('角色路径必须是目录')
  const target = path.join(directory, filename)
  try {
    const actual = await fs.realpath(target)
    insideAvatarRoot(base, actual)
    return actual
  } catch (err) {
    if (allowMissing && err.code === 'ENOENT') return target
    throw err
  }
}

export async function readAvatarFile(filename, maxBytes = MAX_AVATAR_BYTES) {
  const handle = await fs.open(filename, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('资源文件大小超过限制或不是普通文件')
    const chunks = []
    let total = 0
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      total += chunk.length
      if (total > maxBytes) throw new Error('资源文件读取大小超过限制')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } finally {
    await handle.close()
  }
}
