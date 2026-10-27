import { readCapabilityState } from '../capability/store.js'
import { mergeIndex } from './patch.js'
import { readAllPatches } from './mapStore.js'

/**
 * 合并索引的入口：能力表（骨架）+ 地图补丁（关键词、参数、示例、风险档）。
 *
 * 不做缓存。合并 1157 条实测在 10ms 量级，而它只在工具调用时执行一次；
 * 加缓存就要处理「能力表被重新生成」「补丁刚下载完」两种失效，得不偿失。
 *
 * @returns {{ entries: Array<object>, stats: { patchPlugins: number, staleCount: number, total: number } }}
 */
export function loadCommandIndex () {
  const state = readCapabilityState()
  const baseEntries = state?.meta?.entries
  if (!Array.isArray(baseEntries) || !baseEntries.length) {
    return { entries: [], stats: { patchPlugins: 0, staleCount: 0, total: 0 } }
  }

  const patches = readAllPatches()
  const merged = mergeIndex({ entries: baseEntries, patches })
  return {
    entries: merged.entries,
    stats: {
      patchPlugins: merged.patchPlugins,
      staleCount: merged.staleCount,
      total: merged.entries.length
    }
  }
}
