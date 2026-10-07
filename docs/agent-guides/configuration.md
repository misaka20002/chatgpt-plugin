# 配置系统

[返回仓库指南](../../AGENTS.md)。只在任务涉及本主题时阅读；工程与验证规则以主指南为准。

本文代码路径均相对仓库根目录。历史用例编号、数据规模和平台现象用于解释约束，不是每次修改都要执行的检查清单；当前命令以 `package.json` 为准，环境现象需在当前机器核实。

## 配置系统

- `utils/config.js` 单例（Proxy；`getConfig()` 返回原始对象供测试直接改；`Config.save()` 写 `config/config.json`）。
- 加载时 `lodash.mergeWith(defaultConfig, 用户配置, useWholeArray)` + `removeExtraKeys` 会把 defaultConfig 中已不存在的键从**运行期配置**里移除（如已删除的 `enableUserProfileTool`）。注意这一步**不写盘**：磁盘上的 `config.json` 仍保留旧键，要等下次 `Config.save()` / 锅巴保存时经 `saveDiff` 才一并消失。功能不受影响，不必为此在启动时多做一次写入。
- **数组整体采用用户的值，不要改回 `lodash.merge`**：`merge` 把数组当对象按下标合并，用户保存的数组比默认值短时会补回默认数组的尾部——多选工具列表里取消勾选的默认项重启后又出现（或与已选项重复）、清空的列表变回默认值、删掉的预置音色又回来（2026-09 修复，此前一直存在）；补出来的数组还会在下一次任意 `Config.save()` 时被写回磁盘，所以旧版本用户的 `config.json` 里可能已经留下重复项或"复活"的默认项，修复只能保证之后不再产生。`saveDiff` 保存数组时本来就是整只写入，整体采用不会丢信息。`useWholeArray` 必须返回 `cloneDeep` 副本：用户没保存过的键会直接拿到 `defaultConfig` 的数组，`ScheduleTaskTool` 是原地 `push` 后再 `saveDiff`，共用同一个数组时比较结果相等、新任务不会写盘。两点都由 `npm run test:config` 钉住（子进程 + 临时 cwd 走真实加载与保存）。
- 配置迁移示例：`memoryMinImportance` 由 1-10 语义迁移到 0-1（`>1` 时 `/10` 归一化）。
- 四家 provider 的地址 `openAiBaseUrl` / `responsesApiBaseUrl` / `claudeApiBaseUrl` / `geminiBaseUrl` 在配置加载和保存时统一去掉首尾空白、末尾的全部 `/`，保留 `/v1` 等路径。锅巴通过 `getConfig()` 批量修改后调用 `Config.save()`，与直接给 `Config` 赋值共用该规则，面板读取与保存后的磁盘值一致。已有配置加载时只规范内存，下次保存再写盘。
- **四家 provider 的"单次回复上限"默认值统一为 65536**，分别是 `apiMaxToken` / `responsesApiMaxToken` / `claudeApiMaxToken` / `geminiMaxOutputTokens`（都在 `defaultConfig`，锅巴均有字段）。**注意 gemini 这个键 2026-09 之前是死键**：`defaultConfig` 里写着 2000，但全仓没有一处读它，客户端自己硬编码回落到 4096——所以"改了 `defaultConfig`"不等于生效，改这类键后必须 grep 确认存在真实调用点（现在由 `CustomGoogleGeminiClient` 的 `opt.maxOutputTokens || Config.geminiMaxOutputTokens || 65536` 接住，主对话/子代理/翻译/搜索都走它）。两处客户端兜底同步为 65536：`ClaudeAPIClient` 的 `opt.max_tokens || 65536`、`BaseClient.maxToken`（后者目前没人读，`GoogleGeminiClient` 里那条 `// todo configuration` 也是死路径）。**改动只对未保存过该键的用户生效**：`lodash.mergeWith(defaultConfig, 用户配置, …)` 会让磁盘上已有的旧值继续覆盖默认值。
- **传 `maxTokens` 时注意 provider 分支差异**：`SubLLM` 的 api / responses / claude 三个分支一直会把它转成各自协议的字段，gemini 分支曾漏掉（2026-09 修复），漏掉时客户端会回落到自己的默认值——表现为"调用方明明设了上限却被截断"。**并且默认不要在工具/子代理里自设 `maxTokens`**：统一跟随 provider 的「回复内容最大Token数」（HTML 卡片 8000、群成员蒸馏 3072/6144、记忆提炼 `outputTokenLimit: 4096` 三处曾各自设限，都会先于 provider 上限截断长输出，已全部删除；记忆提炼的该配置项与锅巴字段也一并移除）。
- **新增/修改需要在锅巴面板暴露的配置项，必须同步 `guoba.support.js` 三处**：schema（`field`）、`getConfigData()`、`setConfigData()`，否则面板丢字段。**纯内部项、或只作为 `config.json` 高级/兼容入口（不出现在面板）的键不受这条约束**，别看到某个键没在锅巴里就"补全"它。
- **`Config.githubAPI` 按常量对待**：默认值 `https://api.github.com`，部署者不会修改、锅巴也不暴露它。不要围绕"它可能是别的反代地址"做多形态兼容（尾斜杠归一化、同 host 判据、专门的测试等）；`resolveBaseUrl()` 现有的归一化已经够用。
- GSubForm 子字段（`groupId`/`switchOn`）不属于 Config 顶层，校验时需排除。

## 数字与表单读取

- **`Number(x) ?? 默认值` 在 x 缺失时得到 NaN 而不是默认值**：`Number(undefined)` 返回 NaN，`??` 只回退 null/undefined——`Number(Config.xxx) ?? 0.7` 在配置缺失时阈值/上限会变 NaN 导致校验失效。**读取数字配置用 `||` 回退**（`Number(...) || 0.7`）。但 `||` 会把合法的 `0` 也当缺失，**只适用于"0 不是合法取值"的字段**；0 有业务意义的配置（如 `meme_CD <= 0` 表示关闭 CD）必须显式判空 + 范围校验，例如 `const n = Number(Config.x); const v = Number.isFinite(n) ? n : 默认值`，别套 `||`。
- 锅巴 GSubForm 保存的是数组（如 `memoryGroupCapture.groups`），读取用 `Array.isArray` 防护。

`inputTokenLimit` / `eventRetentionDays` / `maxMemoriesPerUser` 的 0 不是合法值，可使用 `Number(...) || 默认值`；`minConfidence` 已移除，见 [记忆指南](memory.md)。
