import fs from 'node:fs'

/** 源码文件读取上限：超过就不读，防止把打包产物当插件源码吞进内存 */
export const MAX_SOURCE_FILE_BYTES = 200 * 1024

/** 配置文件读取上限：正常插件配置远小于此值 */
export const MAX_CONFIG_FILE_BYTES = 256 * 1024

/**
 * 带体积上限的只读文本读取。
 *
 * 两个扫描模块共用同一份实现：体积上限是资源边界，散成两份迟早会有一处忘记收紧。
 * 只有读，没有写——写入能力只存在于 store.js，且目标路径写死。
 *
 * @param {string} file 绝对路径
 * @param {number} maxBytes
 * @returns {Promise<string>} 读不到或超限时返回空串（调用方按「没有这条线索」处理）
 */
export async function readTextFile (file, maxBytes) {
  try {
    const stat = await fs.promises.stat(file)
    if (!stat.isFile() || stat.size > maxBytes) return ''
    return await fs.promises.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

/** 列出目录下的普通文件，目录不存在时返回空数组 */
export async function listFiles (dir, filter) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && filter(entry.name))
      .map(entry => filePathJoin(dir, entry.name))
  } catch {
    return []
  }
}

function filePathJoin (dir, name) {
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}/${name}`
}
