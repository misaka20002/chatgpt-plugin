/**
 * V2 记忆系统的删除权限策略（只管**实时主动删除入口**）
 *
 * 两个入口共用同一份判定，避免"关掉了指令却漏了工具"这类两处漂移：
 * - `apps/memoryManage.js` 的 `#清空我的记忆`
 * - `utils/tools/MemoryTool.js` 的 **personal** retract
 *   （retract 会把槽位下的 active 记忆整体归档，`factValue` 留空即整槽，对用户而言与删除等同）
 *
 * 范围边界（已确认的产品语义，不要扩大）：
 * - 只管 `user` / `user_group`：`group` 公共记忆仍走原有群管理权限，与"删自己的记忆"无关；
 * - **dailyTask（离线每日提炼）不经过此策略，也不读 `allowMemberDeleteOwnMemory`**：
 *   系统按后续聊天重新判断事实是否成立，与"成员调用实时删除能力"不是同一个权限概念。
 *
 * 规则：
 * - Bot 主人（`e.isMaster`）永远可以删除记忆；
 * - 其余用户只有在配置 `allowMemberDeleteOwnMemory` 为真（锅巴「允许成员删除自己的记忆」，
 *   默认开启）时，才能删除自己的记忆。
 *
 * 判定依据只取服务端事件上下文 `e`，绝不接受模型参数或 candidate 里的同名字段
 * （同 `store.js` 的「ctx 可信字段约定」）。
 */

import { Config } from '../config.js'

/**
 * 是否可以删除"自己"的记忆（仅**实时主动删除入口**判定：`#清空我的记忆` 与 personal retract；
 * 离线提炼不调用本函数）
 * @param {Object} e 云崽消息事件（只用 e.isMaster）
 * @returns {boolean}
 */
export function canDeleteOwnMemory(e) {
  if (e?.isMaster) return true
  // 显式 false 才算关闭：配置缺失（undefined/null）按默认「开启」处理，
  // 避免把读不到配置解释成最严策略后让成员彻底无法自助删除
  return Config.allowMemberDeleteOwnMemory !== false
}
