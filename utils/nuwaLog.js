import path from 'node:path'

/**
 * 女娲蒸馏共用的日志前缀与路径格式。
 *
 * 单独成文件而不是挂在执行段模块上：`#at图谱` 与 `#女娲蒸馏` 同处一个指令文件，
 * 若为了三个字符串函数就去 import 执行段，会把 SubLLM 与各 provider 客户端一并拉进启动路径。
 * 这里只有 node:path 一个依赖，谁 import 都不增负担。
 */

export function logInfo(message) {
  globalThis.logger?.info?.(`[Nuwa] ${message}`)
}

export function logWarn(message) {
  globalThis.logger?.warn?.(`[Nuwa] ${message}`)
}

export function logError(message) {
  globalThis.logger?.error?.(`[Nuwa] ${message}`)
}

/** 产物路径一律以相对形式出现在回复里：绝对路径会带着本机用户名。 */
export function toRelativePath(absolute) {
  return path.relative(process.cwd(), absolute).split(path.sep).join('/')
}
