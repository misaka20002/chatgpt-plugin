/**
 * 智能模式 V2 记忆系统门面
 * 统一导出存储、提取、召回、采集、每日任务与画像模块
 */

import { MemoryStore } from './store.js'
import { groupCapture } from './capture.js'
import { dailyConsolidation } from './dailyTask.js'
import * as extractor from './extractor.js'
import * as recall from './recall.js'
import * as sensitive from './sensitive.js'
import * as profile from './profile.js'

export {
  MemoryStore,
  groupCapture,
  dailyConsolidation,
  extractor,
  recall,
  sensitive,
  profile,
}

/** 默认单例存储（惰性创建，避免模块加载时强依赖全局 redis） */
let _store = null
export function getStore() {
  if (!_store) _store = new MemoryStore()
  return _store
}
