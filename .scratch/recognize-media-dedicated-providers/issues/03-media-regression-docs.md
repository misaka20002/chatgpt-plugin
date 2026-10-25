# 03 - 媒体识别回归与维护指南
Status: ready-for-human
Type: task
Blocked by: 01, 02

## 目的
完整覆盖 ../spec.md 验收条款；更新 docs/agent-guides/tools.md 的旧来源解释，保持普通聊天原生多模态文档内容和既有安全约束。

## 测试缝隙
`test/recognitionMedia.test.mjs`、`test/mediaUrlGuard.test.mjs`、`test/providerSources.test.mjs` 与 Guoba schema 测试。
重点验证两种普通聊天 `mediaRecognitionSource` 值都不影响工具选路。

## 验收
`npm run test:media`、`npm run test:providers` 和相关配置检查通过，依情况 `npm run check`；不依赖真实外网。

## Answer

- `docs/agent-guides/tools.md` 更新按需识别工具语义并保留原生多模态章节。`test/mediaUrlGuard.test.mjs` 的真实视频 MIME 检测在两种普通聊天来源模式均通过；工具文本不再暗示当前模型回退。
- 已执行 `npm run test:media` **87/87 全通过**（临时安装 `file-type` 补跑三项此前跳过的内容探测）。`npm run test:config` **35/35 通过**。`npm run check` **退出码 0**，含 `test:providers` 等完整核心门禁；仅测试期间使用临时 `md5` 和 `file-type`。
- Code Review S2：`test/providerSources.test.mjs` 新增真实工具→识别函数→`SubLLM` 链路验证，网络仅提供受控模拟响应，确保图片四协议及视频独立 Gemini 条目被实际选中，普通聊天两种来源设置均不影响工具。`npm run test:providers` 在补充后 **42/42 通过**，不改动真实识别函数实现。
