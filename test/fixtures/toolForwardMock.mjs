/**
 * utils/toolForward.js 的统一测试桩。
 * 各测试文件通过 mock.module() 注册同一份 namedExports；
 * 该模块新增导出时只需在这里同步一处，避免散落的 mock 遗忘导致运行时 TypeError。
 */
export function createToolForwardMock() {
  /** 记录经 sendToolRoundTextForwardMsg 外发的工具轮文本（供断言） */
  const forwardCalls = []
  return {
    forwardCalls,
    namedExports: {
      sendToolCallForwardMsg() {},
      sendToolRoundTextForwardMsg(e, entries) {
        forwardCalls.push(entries)
      }
    }
  }
}
