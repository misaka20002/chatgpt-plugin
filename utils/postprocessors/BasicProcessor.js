import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export class AbstractPostProcessor {
  name = ''

  /**
   * 类型
   * @type {'pre' | 'post'}
   */
  type = 'post'

  /**
   *
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
 * collect
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
        const module = await import(fullPath)

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
        // console.error(`Error processing file ${file}:`, err)
      }
    }
  }

  return processors
}
