import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

export class AbstractPostProcessor {
  name = ''

  /**
   * 类型
   * @type {'pre' | 'post'}
   */
  type = 'post'

  /**
   * 通过 collectProcessors() 自动加载 postprocessors 目录下的所有后处理器（目前只有 ReasonerProcessor）
   * @param {{
   *   text: string,
   *   thinking_text?: string
   * }} input
   * @returns {Promise<{
   *   text: string,
   *   thinking_text?: string
   * }>}
   */
  async processInner (input) {}
}
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * collect: 通过 collectProcessors() 自动加载 postprocessors 目录下的所有后处理器（目前只有 ReasonerProcessor）
 * @param {'pre' | 'post' | undefined} type
 * @return {Promise<AbstractPostProcessor[]>}
 */
export async function collectProcessors (type) {
  const processors = []
  const directoryPath = __dirname // 当前目录

  // 读取目录中的所有文件
  const files = fs.readdirSync(directoryPath)

  // 遍历所有文件，筛选出.js文件
  for (const file of files) {
    if (file.endsWith('.js') && file !== 'BasicProcessor.js') { // 排除自己
      const fullPath = path.join(directoryPath, file)
      try {
        // 动态导入模块
        // 注意必须转成 file:// URL：Windows 下纯路径（E:\…）会被 ESM loader 当成协议，
        // 抛 ERR_UNSUPPORTED_ESM_URL_SCHEME，导致所有后处理器静默加载失败
        const module = await import(pathToFileURL(fullPath).href)

        // 遍历模块的所有导出成员
        for (const key of Object.keys(module)) {
          const ExportedClass = module[key]

          // 确保它是一个类，并且继承了 AbstractPostProcessor
          if (typeof ExportedClass === 'function' &&
            Object.getPrototypeOf(ExportedClass) !== null) {
            const parent = Object.getPrototypeOf(ExportedClass)
            if (parent.name === 'AbstractPostProcessor') {
              let instance = new ExportedClass()
              if (!type || instance.type === type) {
                processors.push(instance)
              }
            }
          }
        }
      } catch (err) {
        // 单个文件失败只跳过它、不中断整体收集，但必须留痕，避免加载失败被静默吞掉
        console.error(`[ChatGPT] 加载后处理器 ${file} 失败：`, err)
      }
    }
  }

  return processors
}
