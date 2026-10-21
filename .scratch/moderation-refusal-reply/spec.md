# spec：审核拒绝回复改造成中性词库

Status: done（2026-10-21，本地分支 `fix/moderation-refusal-reply`，待推送）

## 背景

模型在**返回阶段**被内容安全策略拦下时，QQ 群里的表现是两种都不体面的形态：

1. **Gemini 抛错路径**：`client/CustomGoogleGeminiClient.js` 在 `promptFeedback.blockReason` 或 `finishReason` 命中
   `['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'OTHER']` 时抛
   `Object.assign(new Error('模型拒绝回答：…'), { noRetry: true })`。这个异常一路冒到 `apps/chat.js` 的
   `catch (err)`，先 `logger.error(err)` 打整段堆栈，再把 `出现错误：模型拒绝回答：PROHIBITED_CONTENT`
   发到群里；开了图片模式还会渲染一张报错代码块图片。
2. **api / responses / claude 返回路径**：三个客户端不抛错，返回 `{ refused: true, text }`
   （`utils/openai/chatgpt-api.js:386,480`、`utils/openai/responses-api.js:195`、`client/ClaudeAPIClient.js:307`），
   由 `utils/providerFallback.js:30` 停止重试、`model/core.js:265` 兜底填 `模型拒绝回答`。
   这条路径不但会把 `模型拒绝回答` 原样发到群里，还会把被拒答的这一轮写进
   `previousConversation.messages` 并落 Redis（`apps/chat.js:1077-1091`），污染下一轮上下文。

用户诉求：这两种情况都改成**通用、中性、温和**的内置随机词库回复，并复用插件既有的
`tts_First_person`（AI 的第一人称，默认「派蒙」，用户机器上配成「憨憨」）替换逻辑。

## 决策口径

| # | 决策 | 结论 |
| --- | --- | --- |
| Q1 | 词库放哪 | 新建零依赖纯模块 `utils/refusal.js`（对齐 `utils/thinking.js` 的先例）。**不**往 `utils/paimonFuction.js` / `utils/config.js` 加具名导出——这两个模块被多处 `mock.module` 打桩，新增导出会让未同步的测试桩在加载期直接 `SyntaxError` |
| Q2 | Gemini 客户端是否改成返回文案 | **不改**。`SubLLM`、`recognitionResultsByGemini`（识图）、`utils/tools/GeminiSearchTool.js` 与 `test/providerClients.test.mjs:45` 都依赖它抛错识别失败；改成返回聊天文案会把拒答当成识图/搜索结果拼进 prompt。只给抛出的 Error 补 `refused` / `refusalReason` 结构化字段 |
| Q3 | 识别口径 | 两条通道并存：Gemini 抛出的 Error 带 `refused: true`，`isModerationRefusalError` 优先认这个结构化字段、兜底正则 `/^模型拒绝回答(?:[:：]|$)/`；api / responses / claude 不抛错，由 `apps/chat.js` 直接读 `chatMessage.refused`，不经过 `isModerationRefusalError` |
| Q4 | 词库语气 | 零报错字符：不含 `出现错误`、`模型拒绝回答`、`Error`、`PROHIBITED_CONTENT` / `SAFETY` 等英文拦截码，也不带 `QAQ` / `呜呜` 这类夸张口癖。8 条模板，均以「派蒙」占位 |
| Q5 | 称呼替换 | 与 `utils/randomMessage.js:251` 同款 `.replace(/派蒙/g, name)`；`tts_First_person` 为空串 / 空白 / `null` / `undefined` 时回退「派蒙」，绝不产出 `undefined` |
| Q6 | 拒绝轮次是否入历史 | **不入**。`refused` 返回路径在写 `previousConversation` 之前拦截并 `return false`；Gemini 抛错路径本来就在写历史之前抛，天然不入库 |
| Q7 | 图片模式 | 审核拒绝一律回温和文本，**不**走 `this.renderImage` 渲染报错代码块图片 |
| Q8 | 普通报错 | 超时 / 502 / 额度不足 / `Conversation not found` 等 100% 保持原有 `logger.error` + `出现错误：…`（或报错图）行为，一字不改 |
| Q9 | 日志 | 拒绝只打 `logger.warn`，前缀 `[ChatGPT]`（`test/lint.check.mjs` 禁单 token camelCase），不打印堆栈 |

## 行为契约

- `utils/refusal.js` 导出 `REFUSAL_REPLIES`（冻结数组）、`isModerationRefusalError(err)`、
  `pickRefusalReply(firstPersonOrConfig, random)`；零依赖，可直接在纯 Node 下单测。
- `isModerationRefusalError` 对以下输入返回 `true`：`{ refused: true }` 任意对象、
  `Error('模型拒绝回答：PROHIBITED_CONTENT')`、`Error('模型拒绝回答')`、字符串 `'模型拒绝回答：SAFETY'`；
  对 `Error('API 返回的 candidates 为空')`、`Error('502 Bad Gateway')`、`null`、`undefined` 返回 `false`。
- `pickRefusalReply` 的 `random` 参数用于测试注入；越界或非整数索引回退第 0 条。
- `apps/chat.js` 的两处出口都经 `replyModerationRefusal(e, config, message)` 统一发送（单一出口：
  `logger.warn('[ChatGPT] ' + message)` + 词库文案 + `checkAndExecuteContent` 补发），
  `recallMsg` 沿用文件内既有写法。
- 下游契约不变：`CustomGoogleGeminiClient.prototype.sendMessage` 在拦截时仍抛
  `Error('模型拒绝回答：…')` 且带 `{ noRetry: true }`，`test/providerClients.test.mjs` 的四协议不重试断言继续成立。

## 偏差记录

- **catch 分支用前置守卫而非 if/else**：上游提示词给的写法是把原 `catch` 体整体塞进 `else` 并重新缩进，
  那会让「普通报错一字未改」变成十几行纯缩进变更，`git diff` 上无法自证未改。实际采用
  `if (isModerationRefusalError(err)) { …; return }`，其后原有代码保持原缩进与原文，diff 中该区块只有新增行。
- **统一出口 `replyModerationRefusal`**：两处出口原本各写 6 行相同逻辑且日志格式已漂移（一处带原因、一处不带），
  抽成一个类方法后两处行为一致。这是评审后追加的重构，不影响对外行为。
- **日志截断 200 字**：上游需求未要求，但中转站可能返回带正文的长拒答文本，避免刷日志；与同文件
  `errorMessage.substring(0, 200)` 的既有约定一致。
- **保留的设计**：`pickRefusalReply` 的字符串入参、`refusalReason` 字段、词库第 3/5/7 条的「安全检查/安全限制」措辞
  均直接来自上游需求文档（`refusal_strategy_plan` 的词库表格），不属于本次自行发挥。

## 验证口径

1. `node test/checkSyntax.mjs`、`node test/pathLeak.check.mjs`、`node test/lint.check.mjs` 全绿。
2. `npm run test:providers`（含新增 `test/refusal.test.mjs`）与 `npm run test:group-reply`
   （含 `test/groupReplyChat.test.mjs` 新增的抛错 / 返回双路径端到端断言）。
3. `npm run check`（CI 同款门禁）退出码 0。
4. 未覆盖：真机 QQ 群里实际触发审核拦截的观感，需上线后观察一轮。
