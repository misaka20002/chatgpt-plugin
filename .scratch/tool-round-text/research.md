# research：变更集遗留问题核查（工具轮转发 / check+CI / pnpm 统一 / SDK 移除）

- 日期：2026-10-15 ｜ 范围：提交 `a69f3fe`、`b092384` + 17 项待提交改动
- 方法：一手来源核查（官方仓库 README / 规范原文、宿主源码）+ 本机实证；每条结论附来源
- 结论速览：**未发现功能性缺陷**；发现并修复 2 处问题（Q1 action 主版本落后、Q2 注释措辞不精确）；Q3/Q4 无新问题

## Q1. CI 工作流（`.github/workflows/check.yml`）

**结论**：【已核实】工作流结构与官方文档一致；发现 action 主版本落后（v4 系 → 现行 v7/v6/v7），**已升级**。

**证据**：
- `pnpm/action-setup` README（github.com/pnpm/action-setup，当前主版本 **v6**，支持 pnpm ≤ v12）：`version` 输入原文 *"Optional when there is a packageManager or devEngines.packageManager field in the package.json. otherwise, this field is required."*；用法原文 *"Omit version input to use the version in the packageManager field…"* → 我们「不传 version、由 `packageManager` 决定」正是官方推荐形态。冲突报错 "Multiple versions of pnpm specified" 在 README 未明示，由三份独立实践记录证实（次级来源；修复后形态 = 官方推荐形态，双层保险）。
- `actions/setup-node` README：`cache` 输入注明 *"Package manager should be pre-installed"* → pnpm/action-setup 必须先于 setup-node（本工作流满足）；依赖文件默认在**仓库根**查找（pnpm 见 advanced-usage 示例）——我们的 `pnpm-lock.yaml` 在仓库根 ✓。当前主版本 v7（v5 起 runtime=node24；v6 起 npm 自动缓存默认开启、非 npm 需显式 `cache`——我们显式指定 ✓）。
- `actions/checkout`：当前主版本 **v7**（页面未将 v4 标注弃用，但 v4 停留 node20 运行时，落后 3 个主版本）。
- `--experimental-test-module-mocks`：**本机 Node v22.22.2 与 v24.18.0 的 `node --help` 均列出该 flag**（实证）；nodejs.org 文档页截断未取到稳定性的精确原文【未能核实原文，但不影响结论】。
- `pnpm install --frozen-lockfile`（lockfileVersion 9）：本机临时目录 clean install 实证通过（约 1m41s）【本机实证】。

**影响（已动作）**：`check.yml` 升级为 `actions/checkout@v7` / `pnpm/action-setup@v6` / `actions/setup-node@v7`；已核对 v5/v6/v7 的变更点均不触及本工作流用法（显式 `cache: pnpm`、非 `pull_request_target`、GitHub 托管 runner）。

## Q2. 「合并转发节点只支持纯文本」的措辞

**结论**：【已核实】该说法在**规范层面不精确**——OneBot 11 允许 `node.content` 传消息段数组；实现决策仍然正确，**注释已按精确措辞修改**。

**证据**：
- OneBot 11 规范 `message/segment.md`「合并转发自定义节点」：`content` 字段说明原文 *"消息内容，支持发送消息时的 `message` 数据类型"*，且规范例 2 直接给出**消息段数组**的 `content` 示例。
- 宿主 `lib/common/common.js:48-56` `makeForwardMsg`：每条内容包成 `{ message }` 后交给 `e.group.makeForwardMsg / e.friend.makeForwardMsg / Bot.makeForwardMsg`；`lib/bot.js:662` 的 `makeForwardMsg` 为 `return { type: "node", data: msg }`——节点内容原样透传。
- 本仓库管线：`utils/toolForward.js` 的 `buildForwardBatches → splitForwardMessages` 会对每条消息做 **`String()`** 分片——这才是「不能塞 segment 数组」的真实原因（会被字符串化成 `[object Object]`）。

**影响（已动作）**：`utils/toolForward.js` 注释改为「本转发管线按纯文本节点构造（`String()` 分片），故不做 `convertFacesAndCQCode`；规范虽允许 `node.content` 传消息段数组，字符串形态跨适配器兼容性最稳」。

## Q3. 遗漏的「解析即发送」点

**结论**：【已核实】**无第 5 处遗漏**。

**证据**（全仓扫描，排除 node_modules）：
- `client/` 目录：改造后 **0 个** `\.reply(` / `replyPureTextCallback` 命中。
- `model/core.js` 共 8 处：`:222/:225`（fallback 的 reply 包装器，标记 `irreversible` 用）、`:254`（settings 默认值）、`:437/:439`（`replyPureTextCallback` 定义——既有扩展点，按此前决策保留）、`:624/:933/:960`（"字数超限"错误提示）——均非「解析中的中间文本」。
- `model/conversation.js`（4 处，指令回复）、`utils/paimonFuction.js`（3 处，文件超限错误）——均属正常回复/错误路径。

**影响**：无需动作。

## Q4. `@google/generative-ai` 移除复核

**结论**：【已核实】无残留引用。

**证据**：插件 `.js/.mjs/.json`（排除 node_modules 与 `pnpm-lock.yaml`）grep 仅剩 `client/GoogleGeminiClient.js` 的一句说明注释（预期保留）；上游 v3（`raw.githubusercontent.com/ikechan8370/chatgpt-plugin/v3/package.json`）亦不含该依赖、`pnpm: {}` 无补丁配置。

**影响**：无需动作。

## 未核实清单（如实记录）

- "Multiple versions of pnpm specified" 的官方原文：action README 未写，仅有次级来源（已按该行为修复，且修复形态 = README 推荐形态）。
- nodejs.org 上 `--experimental-test-module-mocks` 的稳定性原文：文档页截断；以本机 node 22/24 实证替代。
