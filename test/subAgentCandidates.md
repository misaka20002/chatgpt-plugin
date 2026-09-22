# 子代理（子 LLM）下沉候选调研

> 目标：在 `agent_RemoteSandboxSwitch` / `agent_VercelSandboxSwitch`（以及 `agent_LocalSandboxSwitch`）之后，还有哪些工具值得改成「主代理只暴露 `{task}`，由子 LLM 生成真实参数」。
>
> 数据来源：`node test/toolContextAudit.mjs`（acorn 静态解析 `utils/tools/*.js` + 解析 `model/core.js` 的 `collectTools` 判定是否接入 + `js-tiktoken` cl100k_base 估算），明细见 `test/toolContextAudit.md` / `.json`。日期 2026-09-16。

## 一、先纠正两件事（本轮更新）

1. **`SendAudioMessageTool` 已删除**（`utils/tools/SendAudioMessageTool.js` + `model/core.js` 的 import 都清了，无残留引用）。
2. **它此前根本没接入**：`model/core.js` 里只有一行 `import`，没有 `new SendAudioMessageTool()`、没有配置开关、锅巴也没有字段。也就是说那 617 tokens 从未真正占用上下文——它是死 import。所以「删掉它省了 617」并不成立；删掉它只是清了死代码，真正的收益是少一份要维护的 schema。

这条暴露出审计口径问题：`utils/tools/` 下**类存在 ≠ 模型看得到**。脚本现在会标注「已接入 / 未接入」：

| 口径 | 数量 | tokens |
| --- | --- | --- |
| 已接入 `collectTools`（模型真正可能看到的） | 48 | **6467**（全部开关打开时才是上限） |
| 未接入（死代码 / 尚未布线，不占上下文） | 9 | 1149 |

未接入的 9 个：`tavily_search_and_extract` 236、`musicTool`(EliMusicTool) 205、`processPicture` 149、`sendRPS` 132、`sf_image_edit` 118、`sendDice` 117、`imageCaption` 95、`searchImage` 61、`currentHotMovies` 36。**这些先决定"要不要接线"，再谈"要不要下沉"**——现在它们既不省也不占。

## 二、现状基线（已接入口径）

| 场景 | 注册的工具描述上下文 |
| --- | --- |
| A 默认配置（私聊 / 群里非管理员） | **1412 tokens** |
| B A + Bot 是管理员（群管五件套） | **1944 tokens** |
| C B + 常用可选开关（记忆 / 定时 / 渲染 / 沙箱 JS / Pixiv / 表情 / 识别） | **4234 tokens** |

已下沉的三个沙箱工具是样板：`remoteSandbox` 96、`localSandbox` 100、`vercelSandbox` 88，schema 只有 `{ task: string }`。

**子代理侧成本**（每次调用支付一次，不进主代理每请求占用）：

| 子代理 prompt | tokens |
| --- | --- |
| `COMMON_RULES`（被拼进下面每个 prompt） | 157 |
| local 完整 systemPrompt | 448 |
| remote 完整 systemPrompt | 419 |
| vercel 完整 systemPrompt | 1058 |

### 关键权衡（「常驻」vs「按需」）

- 工具 schema/description 是**每请求常驻**：只要开关打开，无论这轮用不用得到，都随 `tools` 一起发。
- 子代理 prompt 是**按需加载**：只在真正调用那一次进入子代理上下文，用完即释放；前缀固定，多数 provider 可命中 prompt cache。

所以下沉省下的**不是"总 token"，而是主代理窗口的常驻占用**。设 f = 每请求的调用次数，主窗口每请求净省是固定的（如 `744→106` 省 638），**与 f 无关**；子代理侧每请求支出 ≈ `700f`，但落在**另一个窗口**、且只在需要时发生。
→ 判断标准应该是「主窗口是否紧张 + 能否接受一次往返延迟」，不是「总 token 有没有变少」。

## 三、判定框架（三问 + 两条替代路线）

| 问题 | 是 | 否 |
| --- | --- | --- |
| **Q1 结果是否必须回主模型继续用？**（搜索/抓取/API 原始数据、图像描述、用户画像） | ❌ 不能下沉（除非接受"研究子代理"式语义变化） | ✅ 继续 |
| **Q2 参数是否依赖身份/事件上下文？**（踢人/禁言/改名片/撤回、`userId`、引用消息 id、投递目标） | ❌ 不能下沉：`mergeTrustedToolArgs` 只保证"覆盖方向"，不解决"子代理想踢谁" | ✅ 继续 |
| **Q3 参数是不是可枚举的领域知识？**（渲染语法、NL→cron、检索语法、固定枚举目录） | ✅ **强候选** | ⚪ 看收益 |

替代路线（往往比下沉更便宜）：

- **瘦身 schema**：长参数描述压缩；固定 enum 改成 `string` + 服务端关键词匹配/归一化。
- **合并 facade**：同族重复工具合成一个入口 + 内部路由，语义不变。

## 四、建议下沉（只算已接入的工具）

| 工具 | 现状 | facade 后 | 省/请求 | 子代理做什么 |
| --- | --- | --- | --- | --- |
| `Memory_Tool` | 744 | 106 | 638 | ⚠️ 见第五节，**不推荐下沉**，列出仅为对齐数字 |
| `scheduleGroupTask` | 318 | 103 | **215** | "明天下午三点提醒我" → delayMinutes / cron；list/cancel 的返回值原样回主模型 |
| `generate_math_markdown` | 308 | 82 | **226** | 内容 + 图表类型 → 合法 Mermaid/LaTeX；工具内已有自动纠错，规则只能留一份 |
| `generate_graph_calculator` | 218 | 77 | **141** | 自然语言 → expressions + x/y 范围，纯数值、风险最低 |
| `get_pixiv_images` | 203 | 66 | **137** | 主题/风格 → tag、尺寸、数量，服务端保留 R18/数量兜底 |
| `generate_markmap` | 147 | 70 | 77 | Markdown 层级 → markmap 结构 |
| `sendEmoji` | 136 | 66 | 70 | 20 个 reaction id 的固定枚举 |
| `emojiLike` | 107 | 55 | 52 | 16 个 sentiment 枚举 |
| `execute_javascript` | 188 | ~90 | ~98 | 未建模；与 `localSandbox` 职责重叠，建议并进沙箱子代理而不是再开一个 |

**已接入且可下沉的 8 个工具合计 2181 → 625，单请求省 1556 tokens。**
按 100+ tokens 门槛取舍：`generate_markmap`(77)、`sendEmoji`(70)、`emojiLike`(52) 属于"顺手做"；更好的做法是**一个"渲染类子代理"覆盖 math / markmap / graph**，共享一份 prompt，摊薄固定开销。

## 五、`Memory_Tool` 专项：参数并没有"被省略"，只是换了常驻方式

你的疑问是对的：**子代理一样要产出 `factKey` / `kind` / `confidence` / `importance` / `validTo`，那份契约知识一个字段都没少**。区别在**生命周期**：

| | 知识放在哪 | 什么时候占上下文 |
| --- | --- | --- |
| 现状（HEAD 原版） | 主代理的 `parameters`（552 tokens schema + 192 description = **744**） | **每个请求**都发，哪怕这轮只是在闲聊 |
| 下沉后 | 子代理的 systemPrompt（复用抽取契约，约 600–700 tokens） | **只在真正写记忆的那一次调用**，落在子代理窗口、用完释放 |

实测口径变化（`node test/toolContextAudit.mjs`）：

| 版本 | description | schema | 合计 / 每请求 |
| --- | --- | --- | --- |
| HEAD 原版 | 192 | 552 | **744** |
| 冗长版（7 条字段级边界说明 + 8 个 key 示例） | 365 | 941 | 1306（+562） |
| 精简版（短描述 + 3 个 key 示例，已落地） | 132 | 497 | **629**（−115） |

注：曾估"瘦身到 250 左右"过于乐观——`kind`/`confidence`/`validTo` 的字段级边界是模型必须读到的，只有把 `factKey`/`kind` 改为服务端从 `text` 推导、schema 里删掉这些字段说明才能真正逼近 250。当前精简版是"保住边界"前提下的实际下限。

所以省的是**主代理窗口的常驻占用（744 → 106，每请求省 638）**，不是总 token。这笔账本身成立——**但 `Memory_Tool` 不该用这笔账来决策，因为它的参数不是"参数知识"，而是"会话事实的抽取与规范化"**：

1. **它依赖会话上下文**：谁说的、在哪个群、哪条消息是证据、哪些是事实哪些是聊天摘要/人格推测。子代理看不到会话，主代理必须把原文片段喂过去，于是"要不要记"和"记成什么"被拆到两个模型里——而"记成什么"恰恰是最吃上下文的一环。
2. **`confidence` / `importance` / `validTo` 依赖时间与关系判断**（"我上个月失业了"是状态还是计划？要不要给 `validTo`？）。拿不到时间的子代理会系统性偏。
3. **失败代价是功能性的，不是省钱的代价**：服务端 `validateEvidence` 是 fail-closed 的，子代理产物错一次就是"记忆没记住"，用户可见。下沉会推高失败率，必须靠真实链路验证。

**推荐的替代路线（比下沉更划算）**：

- **A. 复用已有 extractor（推荐）**：`utils/memory/extractor.js` 已经是"分片 + SubLLM 抽取 + `validateEvidence` 校验"的成熟管线，抽取契约 prompt 已经写好。把**在线写入的候选构造也走它**（主代理只传原文片段 + 最小 scope 提示），等于复用现成契约：不新增第二份要维护的 prompt，边际成本≈0，收益与下沉相当；同时让"在线写入"与"每日提炼"共用一套规则，避免两套规则漂移。
- **B. 纯瘦身（无论走不走 A 都建议先做）**：`factKey` 现在用 60+ 字示例串描述命名规范、`confidence` 用分档文字描述——压成短描述 + 服务端归一化推导（`kind` 可由 `text` 归一化，`factKey` 可服务端生成并回读校验）。这条路可行性有现成支撑：`MemoryTool.func` 的服务端**本来就在重新校验 factKey/factValue 规范、作用域、证据归属、置信度与重复候选**，把"生成"也放到服务端或从 `text` 推导，比让模型填 7 个字段更省也更稳。预计 **744 → 250 左右** 的估法过于乐观；实测精简版（短描述 + 3 个 key 示例）只到 **629**，想逼近 250 必须把 `kind`/`factKey` 的生成也搬到服务端、从 schema 里删掉这些字段说明。
- **C. 下沉**：只有前两条都不接受、且主代理窗口确实吃紧时才做；验收标准是「写入成功率不下降 + factKey 归一致性不下降」，用现有 `test/memoryV2.test.js` + `chain*.test.mjs` 做前后对比。

## 六、不建议下沉（反例）

- **鉴权/管理动作**：`kickOut` 130、`jinyan` 161、`editCard` 81、`setTitle` 89、`handleMsg` 71、`blockUser` 170、`sendMessage` 77、`atOtherUser` 221（2 个参数却写了 144 tokens 描述，瘦身即可）——对象、原因、时长必须来自 `e` 与用户原话。
- **结果必须回主模型**：`github` 290、全部搜索/抓取类、`recognize_media` 139、`userProfile` 137、`groupMemberSkill` 150（内部已用 `SubLLM` 做 map/synthesis，不要再套一层）。
- **极小 schema（< 100 tokens）**：`weather` 40、`queryUserinfo` 40、`website` 46、`sendTTSAudio` 64、`searchVideo` 54、`sendAvatar` 90、`queryGenshin` 99 —— 子代理一次 400+ tokens 还搭延迟，净亏。

## 七、结构性问题（比单工具更值钱）

| 问题 | 现状 | 建议 |
| --- | --- | --- |
| 搜索/抓取类重复实现 | 已接入的 `tavily_search` 228 + `tavily_website_extract` 99 + `web_search`(misaka) 105 + `web_search_by_gemini` 88 + `serp` 72 + `website` 46 = **638** | 合并成 `web_search` + `web_fetch` 两个入口 + 内部按配置路由后端；省 ≈ 400–500，语义不变 |
| MCP 工具无上限注入 | `enableMcp` 时每个 server 的**全部**工具（描述 + inputSchema 原样）都进上下文，无白名单 | ① 每 server 工具白名单；② 或收成 `mcp_call{server, task}` facade + 子代理选工具 |
| 同族工具各带一份 prompt | 渲染类 3 个（math / markmap / graph） | 一个"渲染子代理"覆盖三者，共享 prompt |

## 八、落地建议（工程化）

1. **抽公共抽象**：`utils/sandboxSubAgent.js` → `utils/subAgentTool.js`：provider 解析（`sandboxSubAgentProvider` 泛化）+ JSON 提取 + **按 kind 注册校验器**。
2. **不把子代理输出当 args**：逐字段白名单拷贝 + 范围钳制，禁止 `Object.assign(args, subAgentOutput)`。
3. **信任边界不放松**：身份类字段走 `mergeTrustedToolArgs`；投递目标默认取 `e`。
4. **失败显式**：沿用 `return 'Error: …'`（避免 `识别出错：…` 这类会被模型当结果的写法）。
5. **命名与开关**：`agent_<Xxx>Switch` + `<xxx>MasterOnly` + `<xxx>SubAgentProvider`，锅巴面板加 `Divider`。
6. **可回滚**：记录每次子代理调用的耗时、prompt tokens、校验失败率。

## 九、验证方式

```bash
node test/toolContextAudit.mjs          # 复现现状、接入状态与 facade 估算
node test/toolContextAudit.mjs --json out.json
```

按场景 C（4234）估算：若把上表全部候选都下沉（含 `Memory_Tool`）主代理侧约 **2680 tokens**；若记忆走推荐的 A/B 路线（瘦身至 ~250，不下沉）则约 **2820 tokens**。真实链路至少覆盖一次失败路径：子代理返回非法 JSON / 缺必填字段时，工具必须返回 `Error: …` 而不是假成功。
