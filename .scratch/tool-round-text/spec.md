# spec：工具轮文本改以合并转发单独外发并归一化思考

- 状态：**已交付**（commit `a69f3fe`，2026-10-15，分支 v2）
- 完整计划与 AstrBot 架构调研：平台目录 `.workbuddy/plans/toasty-beacon-curie-l7pMWBS-.md`（Part I 为调研背景，本文件为其执行记录精编）
- 相关 retro：同目录 [retro.md](retro.md)

## 背景

模型在工具调用轮同轮返回「非思考 text part + functionCall」时，部分 provider 客户端会把这句文本（常是内心独白，如 `wait, I should call recognize_media … Let's call recognize_media!`）**裸发进群**。已核实的四处「解析即发送」（改动前）：

| # | 位置 | 原行为 |
| --- | --- | --- |
| 1 | `client/CustomGoogleGeminiClient.js:457-489` | 4 个出口裸发（sf 截图 / `replyPureTextCallback` / >1000 字合并转发 / 默认裸发） |
| 2 | `model/core.js:769-771`（OpenAI Chat 循环） | `this.reply(msg.text)` |
| 3 | `model/core.js:579`（Responses 循环） | `this.reply(msg.text)` |
| 4 | `client/ClaudeAPIClient.js` | 工具轮文本被直接丢弃 |

## 决策口径（用户拍板）

- **投递口径**：对齐 AstrBot 默认行为——工具轮文本「收到后立即、单独」外发，每轮一条；**机制 = `makeForwardMsg`（OneBot 合并转发）**。
- **思考归一化**：剥 `<think>`/`<thinking>` 标签 + 识别独白特征，**重归类为 thinking（非删除）**；独白可见性沿用既有 `forwardReasoning` 开关（默认开启）。
- **`convertFacesAndCQCode`**：**保留现状（不调用）**——转发节点只接受纯文本，「转换后再序列化回文本」近似恒等、收益为负（理由写在 helper 注释里）。
- **开关**：`forwardToolRoundText`，默认开启（锅巴可关）。
- 追加要求：修复 `utils/postprocessors/BasicProcessor.js` 的 Windows 纯路径 `import()` 问题。

## 实现要点

- 新增 `utils/thinking.js`（零依赖纯函数）：`extractThinkTags`（支持多块 / 未闭合 / `<thinking>`）、`isToolMonologue`（双闸门：仅工具轮启用；英文独白句式 + 词边界点名真实工具名；中文只认显式工具动词）、`normalizeModelText`。
- 新增 `utils/toolForward.js#sendToolRoundTextForwardMsg(e, entries)`：屏蔽词过滤 → `[第N轮 · Provider]` 前缀 → `replyForwardBatches`（复用 6000 字符 / 50 节点分片）→ 失败降级为提示、不裸发。
- 四处接线：Gemini / Claude / OpenAI Chat / Responses 在各自 `onToolStart()` 之后「归一化 → 立即单独外发」，跨轮累积 thinking。
- 配置：`forwardToolRoundText: true`（`utils/config.js` + `guoba.support.js`）。

## 文件清单（终态）

- 新增：`utils/thinking.js`、`test/thinking.test.mjs`、`test/toolRoundTextForward.test.mjs`、`test/postprocessors.test.mjs`
- 修改：`client/CustomGoogleGeminiClient.js`、`client/ClaudeAPIClient.js`、`model/core.js`、`utils/toolForward.js`、`utils/config.js`、`guoba.support.js`、`utils/postprocessors/BasicProcessor.js`、`utils/postprocessors/ReasonerProcessor.js`、`package.json`、`test/providerClients.test.mjs`、`test/providerContext.test.mjs`、`test/groupReplyCore.test.mjs`

## 验证

- providers 38/38、thinking+postprocessors 8/8、toolRoundTextForward 5/5、config 20/20、tools 99/99、group-reply 64/64；改动文件 `node --check` 全通过。
- 未验证：真实群手动场景（`recognize_media` 触发 / 开关切换 / `forwardReasoning` 表现）；后处理器加载修复后，本机将**首次真正启用** `<think>` 剥离与「思考过程」转发（行为变化，注意观察）。

## Comments

- 2026-10-14 计划批准。原「解析与投递解耦」A 方案（返回契约 + chat.js 统一投递）被「立即单独外发」口径取代——对齐 AstrBot 默认行为。
- 2026-10-14 `convertFacesAndCQCode` 曾按「转换 + 序列化」实现，后按用户决定**完整回退为保留现状**。
- 2026-10-14 追加修复 `BasicProcessor.js`（Windows 路径），补 `test/postprocessors.test.mjs` 回归（修复前该测试在本机必红）。
- 2026-10-15 两轴 code-review：4 项发现当轮修复（英文日志、Claude 两轮用例、测试入脚本、工具名词边界）；9 条判断性保留项经确认**全部保留**。
- 2026-10-15 独白可见性：**保持现状**——默认随「思考过程」合并转发可见，关闭 `forwardReasoning` 则仅日志。
- 2026-10-15 retro（见 retro.md）：落地 check/CI、pnpm 统一、mock 共享桩、依赖环文档；恢复被误删的 SDK 补丁。
