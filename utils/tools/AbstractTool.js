export class AbstractTool {
  name = ''

  parameters = {}

  description = ''

  func = async function () {}

  function () {
    if (!this.parameters.type) {
      this.parameters.type = 'object'
    }
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters
    }
  }
}

/**
 * 合并「模型参数」与「服务端可信上下文」，供各工具执行器调用。
 *
 * `args` 来自模型的 tool_calls.arguments，属于**不可信输入**。写成
 * `Object.assign({ isAdmin, sender }, args)` 会让模型用 `isAdmin: true` 或伪造的 `sender`
 * 覆盖鉴权上下文——`KickOutTool`/`JinyanTool`/`EditCardTool`/`SetTitleTool` 正是依据这两个
 * 字段放行的，等于凭空拿到群管权限（授权绕过）。
 *
 * 所以可信值必须放在最后合并，保证覆盖方向永远是「服务端 → 模型参数」。
 * 新增需要注入的鉴权字段时，请走这里，不要在各个执行器里手写 Object.assign。
 *
 * @param {object} args 模型提供的参数（不可信）
 * @param {object} trusted 由事件上下文（`e`）计算出的可信值（isAdmin / sender / mode ...）
 * @returns {object}
 */
export function mergeTrustedToolArgs(args, trusted) {
  return Object.assign({}, args, trusted)
}
