# 01 撤掉开关与它的接线

Status: ready-for-agent
Type: task

## 目标

面板不再有这个开关，自主回复不再传工具策略，行为回到 `af3bd8f` 之前。

## 范围

- 锅巴 schema：删除 `groupReply.disableTools` 字段。
- 群聊配置归一化：删除该键与其注释。
- 群聊取数模块：删除 `groupReplyToolsDisabled()` 及其 JSDoc。
- 聊天入口：import 去掉该函数；自主回复的 options 恢复为 `{ groupAutoReply: true, settings: {...} }`，删掉解释 `disableTools` 的两行注释。
- 测试：删「工具禁用可由 `groupReply.disableTools` 单独放开」整条用例；删自主回复 options 断言里 `disableTools === true` 那一行；删面板 schema 的四处断言。
- 文档：运行时指南里「专用关停」那段改成描述现状。

**不要动** `model/core.js`：`opt.disableTools` 与其四条 provider 分支保留，`groupReplyCore` 里覆盖它的用例也保留。

## 验收

- 全仓 grep `disableTools`：只剩 `model/core.js` 与 `test/groupReplyCore.test.mjs`（协议层参数与它的用例）。
- 面板里该分栏只剩「开启群聊自主回复」「自主回复群」等原有字段。
- `node --check` 过改动文件；`npm run check` 全绿。

## 备注

顺带对齐：`af3bd8f^` 版本的 `apps/chat.js` 是这段代码的原样，可直接照抄那段三行 options。
