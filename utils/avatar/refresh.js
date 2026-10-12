import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { createHash, randomUUID } from 'node:crypto'
import { avatarRoot, checkedAvatarPath, readAvatarFile, AVATAR_FILENAME, MAX_AVATAR_IMAGE_BYTES } from './paths.js'
import { parseAvatarResource } from './resource.js'
import { avatarOptions } from './catalog.js'

const defaults = {
  happy: ['开心', '高兴、庆祝、赞美', 'bounce'],
  confused: ['困惑', '疑问、不确定、思考', 'wobble'],
  angry: ['生气', '不满、抱怨、轻微恼怒', 'shake'],
  shy: ['害羞', '羞涩、腼腆、被夸奖', 'wobble'],
  crying: ['哭泣', '委屈、难过、伤心', 'none']
}
const running = new Map()

function expressionDefaults(stem) {
  const key = Object.keys(defaults).find(k => k === stem.toLowerCase() || defaults[k][0] === stem)
  return key ? defaults[key] : [stem, '', 'none']
}

async function localPicture(root, avatarId, filename) {
  const actual = await checkedAvatarPath(root, avatarId, filename)
  const data = await readAvatarFile(actual, MAX_AVATAR_IMAGE_BYTES)
  const meta = await sharp(data, { limitInputPixels: 2048 * 2048, failOn: 'warning' }).metadata()
  if (!['png', 'jpeg', 'webp'].includes(meta.format) || (meta.pages ?? 1) !== 1) {
    throw new Error(filename + '不是支持的静态 PNG/JPEG/WebP')
  }
  return { ref: 'data:image/' + meta.format + ';base64,' + data.toString('base64') }
}

async function refreshFolder(root, avatarId) {
  const filename = await checkedAvatarPath(root, avatarId, AVATAR_FILENAME, true)
  const directory = path.dirname(filename)
  // 写入资源不能沿着 JSON 文件链接替换另一个角色。
  try {
    if ((await fs.lstat(path.join(avatarRoot(root), avatarId, AVATAR_FILENAME))).isSymbolicLink()) {
      throw new Error('生成目标 JSON 不能是链接')
    }
  } catch (err) { if (err.code !== 'ENOENT') throw err }
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const pictures = entries.filter(e => !e.name.startsWith('.') && (e.isFile() || e.isSymbolicLink())
    && /\.(png|jpe?g|webp)$/i.test(e.name)).map(e => e.name).sort((a, b) => a.localeCompare(b))
  let oldRaw
  let existing = {}
  try {
    oldRaw = await readAvatarFile(filename)
    existing = JSON.parse(oldRaw.toString('utf8'))
  } catch (err) { if (err.code !== 'ENOENT') throw err }
  if (!pictures.length) {
    if (!oldRaw) throw new Error('没有基础图片或资源 JSON')
    const resource = await parseAvatarResource(oldRaw.toString('utf8'))
    return { avatarId, status: '手工 JSON，未重建', expressions: resource.expressions.length }
  }
  const stems = new Map()
  for (const file of pictures) {
    const stem = path.parse(file).name.normalize('NFC')
    const key = stem.toLowerCase()
    if (stems.has(key)) throw new Error('图片名称冲突：' + file + ' 与 ' + stems.get(key).file)
    stems.set(key, { stem, file })
  }
  for (const required of ['normal', 'close', 'open']) {
    if (!stems.has(required)) throw new Error('缺少基础图片：' + required)
  }
  const extras = [...stems.values()].filter(x => !['normal', 'close', 'open'].includes(x.stem.toLowerCase()))
  if (extras.length > 32) throw new Error('特色表情最多 32 种')
  if (oldRaw && (existing.schema !== 2 || existing.imageMode !== 'images')) {
    throw new Error('旧 JSON 不是支持的完整图片模式，请先备份并移走后重建')
  }
  if (existing.customExpressions != null && !Array.isArray(existing.customExpressions)) {
    throw new Error('旧 JSON 的特色表情列表无效')
  }
  const candidate = { ...existing, schema: 2, imageMode: 'images', mouthMode: 'volume' }
  candidate.images = { ...existing.images }
  for (const kind of ['normal', 'close']) {
    const file = stems.get(kind).file
    candidate.images[kind] = { ...existing.images?.[kind], ...await localPicture(root, avatarId, file) }
  }
  const open = await localPicture(root, avatarId, stems.get('open').file)
  candidate.mouthTiers = [{ ...existing.mouthTiers?.[0], threshold: existing.mouthTiers?.[0]?.threshold ?? 5,
    images: [{ ...existing.mouthTiers?.[0]?.images?.[0], ...open }] }]
  const used = new Set()
  candidate.customExpressions = []
  for (const { file, stem } of extras) {
    const [name, description, animation] = expressionDefaults(stem)
    const oldExpressions = Array.isArray(existing.customExpressions) ? existing.customExpressions : []
    let matches = oldExpressions.filter(x => x.sourceFile === file)
    if (!matches.length) {
      matches = oldExpressions.filter(x => String(x.label ?? '').split(/[：:]/)[0].trim() === name)
    }
    if (matches.length > 1) throw new Error('旧表情无法唯一匹配：' + file)
    const old = matches[0]
    if (old && used.has(old)) throw new Error('多个图片对应同一旧表情：' + file)
    if (old) used.add(old)
    candidate.customExpressions.push({
      ...old,
      id: old?.id ?? 'file_' + createHash('sha256').update(file.normalize('NFC')).digest('hex').slice(0, 24),
      label: old?.label ?? name + (description ? '：' + description : ''),
      animation: old?.animation ?? animation,
      buildMode: 'image', sourceFile: file,
      image: { ...old?.image, ...await localPicture(root, avatarId, file) }
    })
  }
  // 先用生产解析器完整验证，失败不得备份或覆盖当前文件。
  const next = Buffer.from(JSON.stringify(candidate, null, 2) + '\n')
  const resource = await parseAvatarResource(next.toString('utf8'))
  if (oldRaw?.equals(next)) return { avatarId, status: '未变化', expressions: resource.expressions.length }
  let current
  try { current = await readAvatarFile(filename) } catch (err) { if (err.code !== 'ENOENT') throw err }
  if (Boolean(current) !== Boolean(oldRaw) || current && !current.equals(oldRaw)) {
    throw new Error('刷新期间 JSON 已被修改，请重新执行刷新')
  }
  let backup
  if (oldRaw) {
    backup = filename + '.' + Date.now() + '-' + randomUUID().slice(0, 8) + '.bak'
    await fs.writeFile(backup, oldRaw, { flag: 'wx' })
  }
  const temporary = filename + '.' + randomUUID() + '.tmp'
  try {
    await fs.writeFile(temporary, next, { flag: 'wx' })
    await fs.rename(temporary, filename)
  } finally {
    try { await fs.unlink(temporary) } catch (err) { if (err.code !== 'ENOENT') throw err }
  }
  return { avatarId, status: oldRaw ? '已更新并备份' : '已生成', expressions: resource.expressions.length, backup }
}

export async function refreshAvatarFolders(root = process.cwd()) {
  const key = avatarRoot(root)
  if (running.has(key)) return running.get(key)
  const task = (async () => {
    let directories
    try { directories = await fs.readdir(key, { withFileTypes: true }) }
    catch (err) { if (err.code === 'ENOENT') throw new Error('请先在 data/chatgpt/avatars 下创建角色文件夹'); throw err }
    const results = []
    for (const dir of directories.filter(x => x.isDirectory() && !x.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      try { results.push(await refreshFolder(root, dir.name)) }
      catch (err) { results.push({ avatarId: dir.name, status: '失败', error: err.message }) }
    }
    avatarOptions(root)
    return results
  })()
  running.set(key, task)
  try { return await task } finally { running.delete(key) }
}
