# AGENTS.md

给 AI Agent 的仓库指南。本文件描述 **chatgpt-plugin**（TRSS-Yunzai AI 对话插件）的架构、工程规则、约定与注意事项。

## 工程原则

你是**工程助手**，不是代码自动补全工具。不要盲目模仿低质量/不一致/不安全/难测试/技术过时的现有代码；现有代码是当前系统的证据，不自动等于期望标准。当现有代码与下述规则冲突时：保留必需行为 → 遵守工程规则 → 简要说明偏差 → 只做安全解决任务所需的最小重构。

- **改动前先理解**：查看目录结构、识别框架/语言/包管理/构建/测试，阅读相关文档与附近源码，理解数据流，搜索是否已有实现，识别相关测试，再动手。不要边改边猜。
- **小而聚焦**：小模块、单一职责、清晰依赖边界、显式数据流、表意命名；简单设计优于聪明设计；纯函数与依赖注入（利于测试）优先。不要为了"代码更短"优化，为正确性/可维护性/可读性/可测试性/简单性优化。
- **错误处理要刻意**：绝不静默吞错、不用空 catch、不返回假成功、不向调用方隐藏关键失败。错误保留上下文、在合适层处理、内部足够详细。
- **测试是硬要求**：每个非平凡功能/修复都要有测试（新行为 + 边界 + 失败路径），不削弱既有测试。测试通过不等于实现正确。
- **安全**：不硬编码 API key/密码/token，不提交密钥，不信任外部输入，不关安全校验硬过测试。
- **依赖最小化**：先问能否用标准库/现有依赖；不装模型凭空建议的包；加依赖前核实存在、适用、维护活跃。
- **命名表意**：`getUserProfile()` / `calculateOrderTotal()`，避免 `getData()` / `handle()` / `temp`。
- **注释讲为什么**：不注释显而易见的代码；注释解释非显然决策、业务规则、外部系统怪癖、非显然权衡。
- **改动范围聚焦**：不顺手格式化无关文件、不改无关命名、不混入无关清理。
- **完成后验证**：审查 diff、跑可用的 formatter/linter/类型检查/测试/构建（本项目见下"开发与验证"），修复失败后重跑。未验证不得宣称完成。
- **最终汇报**：Changes（改了什么）/ Validation（跑了哪些检查、是否通过）/ Risks（已知限制、遗留债务、值得跟进之处）。

## 项目概览

基于 Yunzai v3 / TRSS-Yunzai 的 AI 对话插件：接入 OpenAI / Claude / Gemini / 文心等对话接口，含智能模式（AI 工具调用）、**记忆系统 V2**、图片/语音、定时任务、本地 Web 服务等。

- 纯 **ESM**（`package.json` `"type": "module"`），Node.js，无构建步骤、无 TypeScript。
- 必须挂载在 Yunzai 根目录 `plugins/chatgpt-plugin` 下运行；依赖全局对象 `logger`、`redis`、`Bot`、`segment`，以及 `../../../lib/plugins/plugin.js` 基类。**这些在仓库内不存在，不要试图解析或"修复"这些导入。**
- 依赖（根仓库 node_modules 已有）：`node-fetch`、`lodash`、`yaml`、`keyv`、`node-schedule`、`@fastify/*`、`pdfjs-dist` 等。加新依赖前确认根仓库是否已装。

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `index.js` | 入口。扫描 `apps/*.js` 动态 import，导出 `apps` 给 Yunzai 注册 |
| `apps/` | 命令层。每文件导出一个 `extends plugin` 的类（`rule` 正则 + 处理函数）。`memoryManage.js`（记忆指令+每日提炼 task+群记忆管理）、`chat.js`（对话，priority 1144）、`memoryGroupObserver.js`（记忆观察器，priority **-1011**）等 |
| `model/` | 核心层。`core.js`（对话 + 工具注册/执行）、`SubLLM.js`（多 provider 子模型，支持 `systemPrompt`）、`Onebot11_MessageHistoryManager.js`（历史消息拉取，**零 import，可独立测试**）等 |
| `utils/` | 业务工具。`config.js`（配置单例 Proxy）、`common.js`（重依赖，勿在测试环境 import）、`tools/`（AI 工具，继承 `AbstractTool`：`MemoryTool`、`UserProfileTool` 等）、`memory/`（**V2 记忆系统 8 模块**，见下）、`openai/`、`tts/` 等 |
| `server/` | 本地 HTTP 服务（fastify） |
| `config/` | `config.md` 文档；`config.json` 运行时生成，**勿提交** |
| `guoba.support.js` | 锅巴配置面板 schema（3000+ 行，局部编辑勿整写） |
| `test/` | 记忆系统测试：`memoryV2.test.js`（单元/回归）+ `chain/chain2/chain3.test.mjs`（真实链路套件） |
| `resources/` `prompts/` `docs/` `client/` | 渲染模板 / 提示词 / 文档 / 客户端资源 |

## 核心数据流

### 对话
`apps/chat.js` `chatgpt()` → `abstractChat(e, prompt)` → `model/core.js` `Core.sendMessage()` → 按 `use` 分发（OpenAI `ChatGPTAPI` / Claude / Gemini / 其他走 `SubLLM`）。

### 智能模式工具
`opt.enableSmart` 时调用 `collectTools(e)` 收集工具（条件注册，如 `{ condition: Config.enableMemory, ToolClass: MemoryTool }`）→ 工具 schema 注入 → 模型调用工具 → 执行 `func(opts, e)` → 结果回填。**工具注册统一由配置开关控制，勿新增无条件注册。**

### 记忆系统 V2（`utils/memory/`）
1. **采集**：`apps/memoryGroupObserver.js`（priority **-1011**，TRSS 升序调度下最先执行）→ `capture.observe(e)`：仅授权群、非指令、非 Bot；纯文本入库，富媒体段以占位符标记（`[图片]`/`[表情]`/`[语音]`/`[视频]`/`[文件]`，内容本身不入库）→ `store.saveRawMessage`（原文 TTL=30 天）
2. **每日提炼**：`apps/memoryManage.js` 的 task（EasyCron `memoryGroupCapture.cronTime`，修改后重启生效）→ `dailyTask.runDaily`：北京时间自然日、断点游标、幂等、失败退避重试、needsReextract 重提炼
3. **提取+校验**：`extractor.runExtraction` → 模型（`systemPrompt: EXTRACTOR_SYSTEM`）→ `parseCandidates` → 服务端校验（证据归属/作用域/置信度/敏感/长度）→ `store.applyCandidates`
4. **存储**：`store.js` —— 作用域 `user`/`user_group`/`group`；add/reinforce(+0.04)/update(单值替换)/retract；证据集合；索引（idx/slot/grp）
5. **召回**：`recall.buildMemoryPrompt(e, prompt)` 注入对话（相关性 bigram 匹配 + 常驻画像 + @目标切换主体；输出标注"不可信数据"）
6. **画像**：`profile.extractUserProfile`（UserProfileTool 调用，仅授权群 + 本人/主人限制）

## 配置系统

- `utils/config.js` 单例（Proxy；`getConfig()` 返回原始对象供测试直接改；`Config.save()` 写 `config/config.json`）。
- 加载时 `lodash.merge(defaultConfig, 用户配置)` + `removeExtraKeys` 清理 defaultConfig 中已不存在的键（如已删除的 `enableUserProfileTool` 会自动清除）。
- 配置迁移示例：`memoryMinImportance` 由 1-10 语义迁移到 0-1（`>1` 时 `/10` 归一化）。
- **新增/修改配置项必须同步 `guoba.support.js` 三处**：schema（`field`）、`getConfigData()`、`setConfigData()`，否则锅巴面板丢字段。
- GSubForm 子字段（`groupId`/`switchOn`）不属于 Config 顶层，校验时需排除。

## Redis 约定

- 业务态前缀 `CHATGPT:`：`CHATGPT:CONVERSATIONS:*`（会话）、`CHATGPT:USE`（当前模型）、`CHATGPT:MESSAGE*` 等。
- 记忆 V2 前缀 `CHATGPT:MEMORY:V2:`：`item:{id}`（记忆本体）、`idx:*/slot:*/grp:*`（索引）、`evd:{id}`（证据集）、`raw:*/rawIdx:*`（原文）、`task:{gid}:{day}`（提炼任务）、`policy:{gid}`（游标）。
- 旧记忆 Hash `CHATGPT:MEMORY:USER:*`：**只读用于清理**，首次 V2 写入即删，不要读取/展示其内容。
- **node-redis 4.7 API 注意**：`zAdd(key, { score, value })`（对象形式）；`hSet(key, obj)`；`scanIterator({ MATCH })`；`del(...keys)` 支持多键。

## 代码约定

- 日志中文，前缀如 `[Memory]` / `[MemoryV2]` / `[ChatGPT]`；注释与用户可见文案中文。
- 无 lint/format/类型检查配置；跟随所在文件风格（多为 2 空格缩进），**不要顺手全文件格式化**。
- 缩进/分号风格文件间不一致——跟随所在文件。
- 全局 `logger`/`redis` 直接可用；测试环境需提供 `globalThis.logger` stub 与 mock redis。

## 开发与验证

- 记忆系统测试：`npm run test:memory`（memoryV2 单元/回归 + chain/chain2/chain3/chain5 链路套件）。测试不依赖真实 Redis/模型/框架。
- 测试技巧：
  - mock redis：内存 `Map` 实现（见 `test/memoryV2.test.js` 顶部），支持 `scanIterator` 生成器。
  - **注入 llm 避免框架依赖**：`extractor.runExtraction` 的 `llm` 参数、`profile.extractUserProfile` 的 `options.llm`；SubLLM 是惰性 import（`await import('../../model/SubLLM.js')`），纯逻辑测试不会拉起框架。
  - 测试环境不要 import `utils/common.js`（重依赖链会触发框架配置加载）。
  - 断言脚本（非 node:test 结构）作为"文件级"测试加入 `test:memory` 命令即可。
- 语法检查：**`node --check` 只检查单个文件，`test:memory` 只覆盖被引用的测试**——正式测试绿灯可能掩盖未被引用的残留文件。提交前做**全量**语法检查（含隐藏文件）：
  ```sh
  # 全部 .js/.mjs（排除 node_modules，含 .dbg*/.verify* 等点开头隐藏文件）
  FAIL=0; while IFS= read -r f; do node --check "$f" 2>/dev/null || { echo "FAIL: $f"; FAIL=1; }; done \
    < <(find . -path ./node_modules -prune -o -type f \( -name "*.js" -o -name "*.mjs" \) -print); [ $FAIL -eq 0 ] && echo "ALL OK"
  ```
- 临时调试脚本纪律：调试用脚本统一放**系统临时目录**（`$TMP`/`/tmp`）或即建即删，**不要留在仓库内**；用 `rm` 删除后必须确认生效（heredoc/管道组合命令可能因展开错误中断导致 rm 未执行，留下语法错误的残留文件）。
- 真实验证需重启 Yunzai 并在群内发指令；部分链路（真实模型提取、`awaitContext` 二次确认）无法在仓库内独立验证。

## Git 约定

- **不要主动 `git add` / `commit` / `push`。** 改完代码把改动留在工作区，汇报改了什么、验证结果如何；只有用户在当前请求里明确要求"提交/推送"才执行。
- 若用户要求提交，message 格式：`feat: 中文描述` / `fix: 中文描述`。

## 常见坑（务必注意）

- **TRSS loader 按 priority 升序调度**（数字小先执行），且任一插件 fnc 返回非 `false` 即 `return` 终结整条消息处理。观察器必须 priority 最小（-1011）先于 `chat.js`(1144) 采集，否则被终结漏采。原版 Yunzai 是降序，迁移时注意。
- **`Date.parse(0)` = 2000-01-01**（JS 把 `'0'` 解析为 2000 年）——validTo 等日期字段校验必须用 truthy 判断，数字 0 会通过 `!== ''`。
- **validTo 二次校验数字秒**：`applyCandidates` 合并后把规范化 validTo（数字秒）传给 `applyFact` 二次校验，`Date.parse(数字)`=NaN——校验需接受数字（按秒）。
- **记忆游标**：`lastDailyEnd` 只推进"实际有原文处理"的日子；无消息**不推进**（保持空），否则 `#群记忆开启` 补录的历史被永久跳过；循环退出时 `cursor` 已是 bound 下一天，勿直接保存。
- **needsReextract 悬空**：游标范围外的 dirty 任务（如"立即提取后又有新消息"的今天）需 `requeueDirtyTasks` 全量扫描消化。
- **`isManualMemory` 只含 `manual`**：`Memory_Tool`（对话中模型自动写入）与 `profile-scan`（画像扫描）都是模型派生的，必须可被 retract 撤回、可被单值替换；关闭来源群时按派生记忆处理（`isDerivedMemory` 覆盖 group-window\* / profile-scan / Memory_Tool）。把工具写入当"手工确认"会锁死职业/昵称/偏好等事实。
- **秒/毫秒统一**：记忆 `validTo` 秒、`updatedAt` 毫秒、原文时间索引秒——比较时显式转换。
- **`enableUserProfileTool` 已删除**，由 `enableMemory` 统一注册 `MemoryTool` + `userProfile`；勿再引用旧开关。
- **大文件**（`guoba.support.js`、`apps/memoryManage.js`、`apps/chat.js`、`model/core.js` 等）用 `grep -n` 定位后局部编辑，不要整文件重写。
- `e.group_id` 在部分平台是**字符串**，群号比较注意类型兼容；`e.message` 的 at 段可能为 `{ type:'at', qq }` 或原始 `{ type:'at', data:{ qq } }`，且 `getMentionedUserId` 必须排除 Bot 自身（`self_id`/`bot.uin`）——@机器人只是触发对话。
- **@他人召回主体有权限边界**：主人 @他人可完整召回（含跨群 user）；普通成员 @他人只召回对方本群事实（`listRecallCandidates` 的 `excludeUser`），不泄露跨群 user 记忆（与 userProfile"普通成员只能分析自己"一致）。
- **needsReextract 竞态**：任务 `running` 期间到达的新消息不在当前模型输入中，`saveRawMessage` 对 completed/running 都标脏；`processWindow` **运行时清脏、完成时保留脏标记**，由下一轮 `requeueDirtyTasks` 重提炼——不要在完成时清脏，否则运行期间消息永久漏提炼。
- **旧 Hash 清理只限个人作用域**：`_purgeLegacyOnce(ownerId)` 对 `group` 作用域会误删 `CHATGPT:MEMORY:USER:<群号>`（群号可能与 QQ 碰撞），必须在 `scope !== 'group'` 时执行。
- **CQ 码处理**：`stripCQCode` 清除 `[CQ:...]` 并压缩残留空白；历史消息可能是段数组 / message 字符串 / raw_message 三种形态。
- **`Number(x) ?? 默认值` 在 x 缺失时得到 NaN 而不是默认值**：`Number(undefined)` 返回 NaN，`??` 只回退 null/undefined——`Number(Config.xxx) ?? 0.7` 在配置缺失时阈值/上限会变 NaN 导致校验失效。**读取数字配置用 `||` 回退**（`Number(...) || 0.7`）。
- **MemoryTool 是模型自动写入**（非手工确认）：写入的事实必须可被后续 retract/单值替换；它同时应用配置的 `minConfidence`（服务端不信任模型自报置信度）。
- **画像扫描消息带 `time`**（秒），`buildExtractionPrompt` 渲染 `[YYYY-MM-DD HH:mm]`（北京时间 +8h）——否则模型无法换算"上个月/明天"等相对时间。
- 记忆指令 `#群记忆开启` / `#群记忆关闭` 需二次确认（`awaitContext`），确认文案说明将删除/保留的数据范围。
- 历史补录消息可能为段数组 / `message` 字符串 / `raw_message` 三种形态，提取文本需全部兼容。
- 锅巴 GSubForm 保存的是数组（如 `memoryGroupCapture.groups`），读取用 `Array.isArray` 防护。
- **数字配置回退统一用 `||`**：除 `minConfidence` 外，`inputTokenLimit` / `outputTokenLimit` / `eventRetentionDays` / `maxMemoriesPerUser` 等读取处同理（`Number(...) || 默认`）。
