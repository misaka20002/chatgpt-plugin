# spec：工具调用/返回日志对齐（logger 通道 + 中文标签 + 留痕边界）

- 状态：**已交付**（2026-10-17，分支 v2；commit `7f4cbc4`）
- 决策来源：2026-10-16/17 两轮问答（Q1–Q8）；术语见根目录 `GLOSSARY.md`，边界决策见 `docs/adr/0002-tool-log-channel-and-redaction.md`
- 相关 retro：交付后按需补

## 背景

四个执行器（`model/core.js` 的 Chat Completions 与 Responses 分支、`client/ClaudeAPIClient.js`、`client/CustomGoogleGeminiClient.js`）的工具日志存在多类不一致（改动前实况）：

| | API | Responses | Claude | Gemini |
| --- | --- | --- | --- | --- |
| 调用行 | logger、已脱敏 | ❌ 无 | logger、明文 | console、明文（整坨 fc） |
| 返回行 | logger | logger | logger（不带引号） | console |
| 工具不存在 | warn | warn | 静默 | 静默 |
| 执行异常 | logger.error | logger.error | logger.error | console.error（不落盘） |
| 触顶 warn | ✅ | ✅ | ✅ | ❌ |

## 决策口径（用户拍板）

- **通道**：四处统一 `logger.*`；`client/` 目录其余 `console.*` 一并迁移（`.log/.info → logger.info`、`.warn → logger.warn`、`.error → logger.error`；debug 转储保留原门控）。
- **格式**：`[Chatgpt][<提供方>][工具调用][<工具名>]: <args>`、`[Chatgpt][<提供方>][工具返回][<工具名>]: <结果>`；结果序列化沿用各分支现状（Claude `_stringifyToolResult` 保持字符串不带引号）。
- **留痕边界**：控制台日志**不脱敏**（明文）；合并转发**四处统一脱敏**（Claude/Gemini 补 `redactArgsForLog`，OpenAI 两分支维持）。
- **失败/边界日志**：Claude/Gemini 的「工具不存在」补 `logger.warn('Function <名> not found.')`；Gemini 触顶补 warn；Gemini 异常行改 `logger.error(err)`。
- 调用行记录模型原始参数（不含自动补的 `groupId`；解析失败记 `{}`）。

## 实现要点

- `model/core.js`：API 调用行去脱敏并换格式；Responses 新增调用行；两处返回行换格式。
- `client/ClaudeAPIClient.js`：调用/返回行换格式、去脱敏；not-found 补 warn；转发记录补脱敏；其余 5 处 console → logger。
- `client/CustomGoogleGeminiClient.js`：调用行改 `args` 形状并换 logger；返回行换格式；异常/not-found/触顶补日志；转发记录补脱敏；其余 8 处 console → logger。
- `client/CopilotAIClient.js`、`client/SunoClient.js`：console → logger。
- `utils/openai/` 全目录（范围追加）：`chatgpt-api.js`（9）、`responses-api.js`（5）、`fetch-sse.js`（1）与 `.ts` 孪生 `chatgpt-api.ts`（9）、`fetch-sse.ts`（1）console → logger，同一映射；`_debug` 门控保留，`.ts` 与 `.js` 同步（不参与运行），另新增 `globals.d.ts` 声明宿主全局 `logger` 供其类型检查。
- `utils/toolArgRedaction.js`：模块注释更新（脱敏职责收窄为「合并转发」）。
- `test/toolArgRedaction.test.js`：断言文案由「日志/转发副本」改为「转发副本」；`model/core.js` 调用行补留痕边界注释。

## 文件清单（终态）

- 修改：`model/core.js`、`client/ClaudeAPIClient.js`、`client/CustomGoogleGeminiClient.js`、`client/CopilotAIClient.js`、`client/SunoClient.js`、`utils/openai/chatgpt-api.js`、`utils/openai/responses-api.js`、`utils/openai/fetch-sse.js`、`utils/openai/chatgpt-api.ts`、`utils/openai/fetch-sse.ts`、`utils/toolArgRedaction.js`、`test/toolArgRedaction.test.js`（断言文案）、`docs/agent-guides/testing.md`（「参数日志脱敏」措辞）、`GLOSSARY.md`（存量未跟踪文件；本次在尾部追加 6 条术语）
- 新增：`docs/adr/0002-tool-log-channel-and-redaction.md`、`utils/openai/globals.d.ts`（宿主全局 `logger` 的类型声明）、本文件

## 验证

- `npm run check`：语法预检 290 文件、路径卫生 321 文件通过；test:config 31/31、test:providers 38/38（含 `providerClients.test.mjs` 对四个客户端与两个 API 层的真实导入）、test:thinking 8/8 + toolRoundTextForward 5/5。`CHECK_EXIT=0`。
- `npm run test:tools`：126/126（含 `toolArgRedaction.test.js`）+ htmlToolSend 4/4。`TOOLS_EXIT=0`。
- 静态核对：`client/` 下已无生效的 `console.*`（仅剩 `CopilotAIClient.js:207` 一条注释）；`model/`、`client/`、`utils/` 的 .js 中不再有旧措辞 `execution function` / `execution result`。
- 未验证：真实运行时的终端观感与 `bot.log_level` 过滤表现；合并转发开启时 Claude/Gemini 的脱敏效果（需真实环境触发工具调用）。
- 两轴 code-review（Standards / Spec，前台并行）已执行，发现项处置见 Comments；修复仅涉及注释/引用与文档，对 `model/core.js`、`utils/toolArgRedaction.js` 复跑 `node --check` 通过（逻辑未变，未重跑全套件）。
- 范围追加（`utils/openai` 两文件）后复跑 `npm run check` + `npm run test:tools`：语法预检 290 / 路径卫生 322 文件，31 + 38 + 8 + 5 + 126 + 4 全通过、0 失败（`CHECK=0 TOOLS=0`）。
- 范围二追（`fetch-sse.js` 与两个 `.ts`）后复跑 `npm run check` + `npm run test:tools`：语法预检 290 / 路径卫生 322 文件，31 + 38 + 8 + 5 + 126 + 4 全通过、0 失败（`CHECK=0 TOOLS=0`）；`utils/openai` 目录 `console.*` 清零。`.ts` 不在语法预检（仅 .js/.mjs）与运行链内，用 `node --check` 单独检查通过。
- `.ts` 类型检查：仓库 `utils/openai/tsconfig.json` 直接 `tsc -p` 会因隐式 `@types/uuid` 缺失（TS2688，既有问题）中断；改用临时配置（`types: []`）做文件级检查——缺 `globals.d.ts` 时复现 10 处 `TS2304: Cannot find name 'logger'`，加入后 0 错误（`tsc` exit 0）。重做落地前另复跑 `npm run check`（语法 290 / 路径卫生 323，31+38+8+5 全过，`CHECK=0`）。

## Comments

- 2026-10-16 现状盘点与 Q1–Q6 拍板；Q3 口径翻转：由「给 Claude/Gemini 日志补脱敏」改为「日志全明文（含移除 OpenAI 日志脱敏）」。
- 2026-10-17 Q7/Q8：`client/` 目录全量迁移；转发四处统一脱敏。
- 2026-10-17 交付与验证全绿（见上）。注意：`GLOSSARY.md` 此前已存在（本次为追加）；`utils/tools/*`、`utils/tts.js` 等其余 `client/` 之外的 console.* 按 Q7=B 保持现状（`utils/openai` 两个 HTTP 层文件已于同日追加迁移，见下条）。
- 2026-10-17 两轴 code-review（Standards / Spec，前台并行）。**修复**：ADR 与并行会话撞号改 `0002`；ADR 小标题中文化（对齐既有 ADR 的「考虑过的替代方案 / 已知约束」）；回避词「外发」清理（`core.js` 注释与 ADR 正文）；本文件清单补 `test/toolArgRedaction.test.js` 并修正 `GLOSSARY.md` 的交付形态描述。**保留**（判断项）：Copilot/Suno 的迁移行保留英文历史文案（通道 1:1 迁移，不夹带翻译）；多实参 `logger.info(…, obj)` 保留（log4js 对非字符串参数 `util.inspect` 后拼接，与 `console` 行为等价）；8 处格式串重复与 `redactArgsForLog` 命名保留（不新增抽象、不做风格迁移）；Gemini 触顶 warn 不加 `[Chatgpt][Gemini]` 前缀（对齐三个兄弟分支的既有措辞）。
- 2026-10-17 范围追加（用户指令）：`utils/openai/chatgpt-api.js`（9 处）与 `utils/openai/responses-api.js`（5 处）的 console.* 一并迁移至 logger.*（同一映射，`_debug` 门控保留，文案 1:1）。
- 2026-10-17 范围二追（用户指令）：`utils/openai/fetch-sse.js`（1 处）与 `.ts` 孪生源码 `chatgpt-api.ts`（9 处）、`fetch-sse.ts`（1 处）一并处理，`utils/openai` 目录 console.* 清零；`.ts` 不参与运行、不在语法预检范围，用 `node --check` 单独验证通过。
- 2026-10-17 git 落地（重做）：交付提交 `7f4cbc4`（13 个代码/文档修改 + 新增 `utils/openai/globals.d.ts`、`docs/adr/0002-tool-log-channel-and-redaction.md`，共 15 个文件，分支 v2）；`GLOSSARY.md` 与 `docs/adr/0001-group-todo-read-open-split.md` 属并行会话，未随本提交。
- 2026-10-17 首次落地尝试（`6656084`/`454d841`）因 `.ts` 引用宿主全局 `logger` 未声明（IDE 报「找不到名称 logger」）被用户撤销重做；补 `globals.d.ts` 后重新落地。
