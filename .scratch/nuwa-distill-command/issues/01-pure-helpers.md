# 01 纯逻辑助手：目标解析、确认词、按条数等距抽样

Status: done

## 目标

三个可单测的纯函数，命令层与取样层都用它们，不引入任何 Config / Redis / 子模型依赖。

## 范围

- `parseDistillTarget({ at, atAll, replyUserId, text, selfId })`：优先级 @ > 引用 > 纯数字；拒绝 @全体、多个 @、@ 与数字冲突、数字不合法、@ 到 Bot 自己、无目标，返回 `{ ok: false, reason }`。
- `isConfirmWord(text)`：`/^(是|y|yes|确定|确认)$/i`。
- `sampleRecordsByCount(records, count)`：不足原样返回；超过等距取，首尾必留。
- 常量调整：`defaultMessages` / `maxMessages` 6000、`maxInputTokens` 150000、新增 `maxLocalScannedMessages` 60000。

## 验收

- `npm run test:nuwa` 覆盖上面三组行为，包含每个拒绝原因。
- 模块内不出现 `Config` / `MemoryStore` / `SubLLM` 的 import。

## Comments

- 与 `#at图谱` 的入参口径保持一致：结构化段由 `extractStructured` 产出，纯函数只吃普通对象。
