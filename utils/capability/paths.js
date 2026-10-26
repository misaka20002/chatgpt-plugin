import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 能力自省的路径与常量。
 *
 * 只有这里知道「允许读哪里」。其余模块一律从这里取常量，不接受外部传入的路径——
 * 这是「能力隔离」的落点：接口上没有路径参数，就没有"指定读哪里"的表达渠道。
 */

export const CAPABILITY_FORMAT_VERSION = 1

/** 表单有效期：7 天（审核是一次性成本，节奏由它控制） */
export const CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 注入提示词的指令条数上限（可下调，但不得超过硬上限——防止把提示词撑爆） */
export const CAPABILITY_DIRECTORY_LIMIT = 300

/** 硬上限：配置面板最多也只能调到这里 */
export const CAPABILITY_DIRECTORY_MAX = 600

/** 详情查询最多返回的候选数 */
export const CAPABILITY_MAX_CANDIDATES = 5

/** 只读白名单的根：插件自身目录 */
const capabilityDir = path.dirname(fileURLToPath(import.meta.url))
export const SELF_PLUGIN_ROOT = path.resolve(capabilityDir, '..', '..')

/** 只读白名单的根：框架的插件目录，第三方插件都在这一层 */
export const PLUGINS_ROOT = path.resolve(SELF_PLUGIN_ROOT, '..')

/** 框架加载器（插件总表的来源）。相对本文件跳四层到框架根 */
export const FRAMEWORK_LOADER_SPEC = '../../../../lib/plugins/loader.js'

/** 框架配置（只为取主人号，用于告警） */
export const FRAMEWORK_CONFIG_SPEC = '../../../../lib/config/config.js'

/** 产物目录：放在框架的 data/ 下，天生不在插件仓库的版本控制里 */
export function capabilityDataDir () {
  return path.join(process.cwd(), 'data', 'chatgpt', 'capability')
}

export function capabilityFormPath () {
  return path.join(capabilityDataDir(), 'feature-form.md')
}

export function capabilityMetaPath () {
  return path.join(capabilityDataDir(), 'feature-form.meta.json')
}
