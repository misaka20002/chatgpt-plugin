# 01 - 字幕提示词与文本分段
Status: ready-for-human

本地字幕清洗与模型输出校验完成；待维护者审阅、合入。
Type: task
Blocked by: none

## 需求
参照 ../spec.md 的 Q4～Q8、Q12、Q15～Q16：辅助模型产出最多两段字幕数组，每段最多12个字素、总计24；首尾标点清理、本地兜底分段、段落空值安全处理；保留原文字回复、动作与表情 ID 验证；不额外调用模型。

## 公开接口及测试
`createAvatarCue` / `fallbackAvatarCue` / `shortCaption`；`test/avatarReply.test.mjs`；先补失败行为测试，再实现。

## 验收
模型字幕数组、旧单字符串兼容、超限自动切段、标点修剪、异常模型输出回退、emoji 字素正确。

## Answer
- 复审修复：独立零宽控制符不再占字幕字符额度、组合 Emoji 保留；模型超长/过段/异常结构触发原回复兜底，不把异常字幕截断直接显示。

实现于 `utils/avatar/config.js`，通过已有 `createAvatarCue` 和 `fallbackAvatarCue` 对外接口；新增 `subtitleCaptions` 供渲染端复用。`test/avatarReply.test.mjs` 先红后绿，覆盖模型自然分段/首尾标点与失败回退。
