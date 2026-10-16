# spec：记忆提炼模型供应商（memoryGroupCapture.provider）

Status: implemented（已实现；2026-10-16 在部署机完成验证，待提交 PR）
- 交付状态：代码已完成并在部署机验证通过；PR 目标 misaka20002/chatgpt-plugin（base 分支 v2）
- 需求方：部署者；动机：为高频批量提炼选用性价比更高的模型

## Problem Statement

群记忆提取（每日批量提炼、`#立即提取群记忆`、`#记忆任务运行`）目前**固定跟随全局默认供应商**（`Config.defaultProviderId`，与 AI 对话相同的模型）：

- 提炼是无人值守的高频批量任务（每天处理数百至数千条消息、多次 LLM 调用），与对话场景的成本结构完全不同，但没有任何按用途指定模型的能力
- 想为提炼单独选用更便宜的模型时，只能改全局默认，会连带改变主对话
- 插件其余 7 个功能级供应商引用（图片识别 / 视频 / Gemini 原生搜索 / 翻译 / 群聊判断 / 角色动图 / 子代理）都已支持"指定条目"，唯独记忆提炼没有

## Solution

1. 新增配置项 `memoryGroupCapture.provider`（默认 `'current'` = 跟随全局对话模型），统一覆盖记忆提取的三个入口（每日提炼 / 立即提取 / 记忆任务运行）。
2. 锅巴「记忆设置」区新增下拉字段「提炼模型来源」（参考「主动触发」的 `groupReply.provider` 模式）：选项 = 跟随全局对话模型 + 全部供应商。
3. 运行时安全回退：指定的供应商失效（被删除等）时，回退到全局默认并打 `[MemoryV2]` 日志警告，不阻塞提炼队列。**不做保存时引用校验**（用户明确拍板不加）。
4. 保存后即时生效（`Config` 内存活对象 + 运行时读取），无需重启。

## User Stories

1. As a 部署者, I want 为记忆提炼单独指定一个供应商, so that 高频批量提炼可以用性价比更高的模型而不影响主对话
2. As a 部署者, I want 不配置时与现在完全一致, so that 升级后行为零变化
3. As a 部署者, I want 在锅巴面板里直接选择, so that 不用手改 config.json
4. As a 部署者, I want 选项里有"跟随全局对话模型", so that 想恢复默认时一键切回
5. As a 部署者, I want 保存后即时生效, so that 不用重启云崽
6. As a 部署者, I want 指定的供应商以后被删除时提炼不中断（回退默认 + 日志警告）, so that 无人值守的提炼不会因配置失效卡死
7. As a 维护者, I want 三个入口共用同一配置, so that 语义一致、无分叉逻辑
8. As a 维护者, I want 只换供应商、不动分片/重试/校验/幂等/断点续传, so that 提取流程的既有契约不被触碰

## Implementation Decisions

- **配置字段**：`memoryGroupCapture.provider`，默认 `'current'`。语义与 `groupReply.provider`、`sandboxSubAgentProvider` 同款（`resolveProvider` 原生支持 `'current'` → `defaultProviderId`）。写入 `utils/config.js` 的 `defaultConfig.memoryGroupCapture`。
- **读取端**（`utils/memory/dailyTask.js` 的 `cfg()`）：`use` 从硬编码 `null` 改为读配置（类型守卫：string 且非空，否则 `'current'`；与 `normalizeGroupReplyConfig` 同款）。随既有 `cfg.use` → `runExtraction({ cfg: { use } })` 链路直达 `SubLLM` 的 `provider` 参数——该钩子本就存在（extractor 里 `cfg.use || Config.defaultProviderId`），无需新管道。
- **回退兜底**（`utils/memory/extractor.js`）：构造 `SubLLM` 前先 `resolveProvider` 预检——仅当**供应商解析失败**（「模型提供商未配置或已删除」）且 `use` 既非 `'current'` 也非 `defaultProviderId` 时，打 `[MemoryV2]` 警告并回退用 `defaultProviderId`；`'current'` / 等于默认时无回退空间，保持抛错（原行为）；其余构造期错误照常抛出（预检收窄，不吞错）。回退在每次提炼调用内至多一次。
- **不做保存时引用校验**：不把新字段加进 `utils/providerProfiles.js` 的 `requireRef` 列表（用户明确拍板：不加）。删除被引用供应商时不拦截，靠上述运行时回退兜底。
- **锅巴**（`guoba.support.js`）：记忆设置区新增 Select 字段——`field: 'memoryGroupCapture.provider'`，label「提炼模型来源」，说明文案「用于群记忆的提炼（每日自动与手动触发）；保存后即时生效，无需重启」（不含具体模型名），`options: [{ label: '跟随全局对话模型', value: 'current' }, ...providerOptions]`（`providerOptions` 为既有动态生成）。三处核对：schema（新增）；`getConfigData()` 经 `Object.assign({}, Config)` 自动携带（无需改动）；`setConfigData()` 经 `lodash.set` 点路径通用写入（无需改动）。
- **生效时机**：保存后即时生效——`cfg()` 在每次提炼运行时读取 `Config.memoryGroupCapture`，锅巴保存走 `Config.commit` 内存更新；与 `cronTime`（注册期读取、重启生效）不同，锅巴文案据此区分。
- **不动的部分**：`runExtraction` 的分片 / 重试 / 服务端校验 / 断点（`chunksDone`）/ 幂等逻辑；`runDaily` / `runImmediate` 的调度与重试策略；在线 `Memory_Tool` / `userProfile` 的模型选择（由主对话驱动，不属于本功能）。

## Testing Decisions

- **静态**：改动文件 `node --check`；`npm run check`。
- **行为测试**（最终落于 `test/memoryProvider.test.js`，挂进 `test:memory` 套件，4 用例）：① 锅巴 schema / 默认值 / 保存后重载；② `dailyTask.cfg()` 读取端（未配置→`'current'`、配置→取值、空值→`'current'`）；③ 指定失效供应商 → 预检回退默认 + 告警；④ 无回退空间（`'current'` 解析失败）与构造期错误 → 原样抛出、不回退不吞错。均以子进程 + 临时 cwd + `mock.module` 替换 SubLLM 运行。
- **服务器真实验证**（用户已授权本次代为重启）：部署 → 重启 → 锅巴配置目标供应商 → 触发提炼 → 观察完成情况与 provider 生效；另测无效 id 的回退路径与"未配置 = 行为不变"。

## Out of Scope

- 保存时引用校验（`requireRef`）——用户明确不加。
- 提炼的其他参数（温度 / 超时 / 输出上限）不新增配置。
- 在线对话记忆（`Memory_Tool`）的模型选择。
- 更细粒度（如按群 / 按窗口）的供应商配置。

## Further Notes

- 本改动是仓库"功能级供应商引用"模式的第 8 个延伸，设计对齐既有约定（`'current'` 语义、动态选项、运行时读取）。
- 上游 PR 计划：base 分支 v2；改动在部署机以本地 commit 形式落地验证，材料由本地准备，用户账号提交；合并后部署机 `git pull` 回归官方版。

## Comments

- 2026-10-16 两轮 grilling 对齐：覆盖范围（三入口统一）；默认值（未配置跟随全局对话模型）；失效回退（回退默认 + 日志警告）；引用校验（不加）；字段与文案（参考 `groupReply.provider`，说明不含模型名）；交付（服务器验证 → 提 PR，用户 PAT）。
- 2026-10-16 实现并在部署机验证：4 处改动 + 新增 `test/memoryProvider.test.js`（3 用例全过）。静态：语法预检 289 文件通过、`test:config` 31/31；回归基线对比：memory 套件改动前 80/81 与改动后 83/84 失败项一致（唯一失败 `atGraph.test.mjs` 为 Node v24 `mock.module` 兼容问题，改动前同样失败）。线上真实验证：指定「默认-群聊判断」供应商后单窗口提炼 `completed`，new-api 请求记录（token=cs，p=3996/c=972）与调用日志逐字吻合。
- 2026-10-16 双轴代码审核（Standards/Spec）后修订：回退收窄为「预检解析失败才回退、其余构造错误原样抛出」；补 `dailyTask.cfg()` 读取端用例（合计 4 用例）；锅巴文案覆盖手动触发；移除内部主机名。审核未发现硬性标准违规（`requireRef` 未收录为已声明偏差）。
