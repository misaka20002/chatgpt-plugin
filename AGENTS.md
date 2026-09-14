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
2. **每日提炼**：`apps/memoryManage.js` 的 task（EasyCron `memoryGroupCapture.cronTime`，修改后重启生效）→ `dailyTask.runDaily`：北京时间自然日、断点游标、幂等、needsReextract 重提炼；**失败重试**：runDaily（`drainDueWindows`）对每个窗口**当日最多尝试 3 次**（节奏 0/5/10min：第 1 次立即、失败后固定等 5min 再试，`MAX_ATTEMPTS_PER_RUN=3` 额度耗尽留次日），总上限 `MAX_ATTEMPTS=20` 跨 runDaily 日累计、达即 failed；手动 `#立即提取`（`flushDueWindows`，`waitRetry:false`）**不等退避**、失败即返回并提示退避中窗口数；**错误分类**：网络/429/5xx 可重试，其他 4xx 短路直接 failed；手动重置 failed 任务 `attemptCount` 归零；**分片断点**：token 分片每成功一片即持久化到 task hash 的 `chunksDone`，重试经 `runExtraction` 的 `resumeChunks` 只补跑失败片（成功后清空）
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

## 派蒙meme（`apps/派蒙meme.js`）

`meme` 系列命令是**运行期动态注册**的：规则来自远端 `keyMap`（关键词 → meme key），不是写死的 `rule` 数组。

- 规则来源统一为 `getRules()` = `baseRules()`（列表/随机/帮助/搜索/更新）+ `memeKeyRules()`（按 keyMap 生成，`reg` 已是 `RegExp`）。构造函数与 `init()` 都走这一套，勿再手写第二份拼装逻辑。
- `init(force = false)`：
  - `force = true`：**跳过本地缓存**强制拉远端，手动 `#表情包更新` 与定时任务都用它；
  - `force = false`：仅插件加载时用（优先本地缓存，避免启动被远端拖慢）；
  - 返回 `{ refreshed, keys, fallback }`。强制刷新拿不到可用数据（`keyMap` 或 `infos` 为空）时**回退到更新前的 `keyMap`/`infos`** 并 `fallback: true`——否则 `memes()` 里 `infos[targetCode]` 取空直接报错，同时规则会被清空。
- 更新成功后清 `data/memes/render_list.jpg`（`memesList` 的 24h 列表图缓存），下次查看时重渲染。
- `init()` 末尾必须调用 `registerRules()` 把最新规则同步回 loader，否则新增关键词要重启才生效（见"常见坑"）。
- **`/memes/static/infos.json`、`keyMap.json` 是可选加速，不是上游 meme-generator 的接口**：上游 `app.py` 只有 `/memes/keys`、`/memes/<key>/info`、`/memes/render_list` 等，对上游直连这两个 URL 一律 404；只有少数部署额外加了这层聚合（如 qwqcc HF Space 的 `bootstrap.py` 用动态路由生成）。因此 `init()` 必须保留逐项重建兜底（`/memes/keys` + 逐个 `/memes/<key>/info`），否则 `meme_baseUrl` 配到纯上游时功能不可用。
- 取图优先级：回复消息 → 本条消息附图 → @对象头像，按 `needImages = max(min_images, 1)` 的缺口**逐级补齐**。旧的 `if (回复) … else if (e.img) … else if (hasAt)` 只要这条是回复就彻底不看本条图与 @，"回复纯文字 + 自己带图"会退化成发送者头像。取回复图统一走 `getReplyImages(e)`，它用入参 `e` 而不是 `this.e`——`派蒙戳一戳.js` 是 `new memes().memes(e)` 直接调用的，那种场景没有 `this.e`。
- 图片下载必须容错：带 `timeoutSignal(IMAGE_TIMEOUT)`、`try/catch` 单张失败只跳过、检查 `response.ok`、`content-type` 必须是 `image/`、先看 `Content-Length` 再决定读不读进内存。QQ CDN 超时、失效链接、404 的 HTML 都不该让整个命令 reject（旧代码的 fetch 在最终 try 之外）；图全挂时回"图片获取失败…"，不要把残缺请求丢给远端。
- meme CD 用 `redis.set(key, 1, { NX: true, EX: meme_CD })` 一步抢占，靠返回值 `null` 判断没抢到（见"常见坑"）。旧的 `GET`→`SET` 两步不原子，并发消息会一起通过。主人/戳一戳仍走 `SET EX` 刷新 CD，`meme_CD <= 0` 时保留"残留 CD 仍拦一次"的旧行为。
- 参数（`args_type`）约定：语法是 `<关键词><文本>#<参数>`（`memes()` 里 `text1.split('#')`），**不是空格分隔**；`#关键词详情` 不能带 `#`，否则会被当成参数。解析时枚举用 `_.has(valueMap, arg)` 判断——**合法枚举值可能是 `0`**（左右、角度这类 schema 就是 0/1），用 `valueMap[arg] || default` 会把 0 吞掉退回默认值；数字用 `Number()` 解析（`number` 收小数与负数、`integer` 要求整数、空串不能当 0），并执行 schema 的 `minimum`/`maximum`（越界就不传该参数）；帮助文本（`generateSupportArgsText`）同样不能用 truthy 过滤枚举名。
- **`#meme列表` 是本地模板渲染，不再依赖远端 `render_list`**：数据经 `utils/memeCategory.js` 的 `buildMemeListData()` 分组后交给模板渲染。渲染宽度 / JPEG 质量 / 分组方案 / **用哪套模板**都是本文件顶部的 `MEME_LIST_*` 常量——**图片宽度就等于 `#container` 的 CSS 宽度**（见"常见坑"），想要 2K / 4K 改 `MEME_LIST_WIDTH` 即可。图由渲染器按 `data.path` 直接落盘到 `data/memes/render_list.jpg`（省一次 base64 往返）；**渲染前必须先删旧文件**，否则渲染静默失败时 `existsSync` 会把上一轮的旧图误判成本次产物。本地渲染失败（没装 Chromium 等）会退回远端 `renderMemeListRemote`，别删这条兜底。
- 模板是 `resources/memeList/index.html`（糖果 / 暖色玻璃态：每组一个主题色、emoji + 组名 + 组内数量，配色走 CSS 变量 `--accent`）。数据契约 `width`/`groups`/`stats`/`forceSharp`/`pageClass` 全部由 `buildMemeListData()` 产出，模板只管展示；换审美只改 `MEME_LIST_TEMPLATE`。
- **图与日志都不要出现部署信息**：列表图的页脚只放指令帮助，**不放 `meme_baseUrl`、不放生成时间**——这张图会被转发和存档，`数据来源` 等于把部署机 IP 印到群里，生成时间对使用者也没有价值。因此模板数据里没有 `sourceHost` / `generatedAt`（原先用于它们的 `displayHost()` 已删除）。同理，**任何把网络错误 message 写进日志/回复的地方都必须包 `hidePrivacyInfo()`**：node-fetch 失败时 message 就是 `request to http://<ip>:<port>/… failed`，不处理等于直接把 IP 写进日志（`init()` 的总 catch 与 `fetchJsonWithRetry` 两处就是这么漏的）。
- **视图层与分类层粒度不同，别顺手合并**：`buildMemeGroups()` 会在「其他作品」上挂 `subgroups`（44 个二级 IP，这是分类的事实），而 `buildMemeListData()` 只吐扁平的 `groups[].memes`——因为列表图不再显示二级 IP 标签。`subgroups` 的消费方目前只有分类层与 P7，但别删：`resolveOtherIp()` 是 `pickGroupName()` 判断"某条该不该进「其他作品」"的真实依据，二级 IP 只是它的副产品。
- 徽标体系（模板按 `chip-new` / `badge-<kind>` / `swatch-<kind>` 挂样式，改名要同时改模板和样式）：
  - 胶囊右侧所有标记统一走 `badges: [{ text, kind }]`，kind 只有三种：`hot`（热）/ `text`（需文）/ `both`（图文）。输入需求不再单开 `needLabel` 字段——模板因此只有一条 `{{each meme.badges}}` 渲染路径，也不必再 `{{if}}` 判空（判空漏掉过一次，971 个只吃图的表情每个都拖着一个空洞色块）。
  - **徽标配色一律走 CSS 变量**（`--badge-hot-bg/fg`、`--badge-text-*`、`--badge-both-*`），正文胶囊与顶部图例共用同一组值。图例和列表各写一份颜色是最容易出现的图例失真（"图例画一种、列表里是另一种"）。
  - `需文` 偏薰衣草、`图文` 偏薄荷，两支低饱和色相近但能分辨：扫一眼就能分清"要不要打字"和"图片文字都带"。
  - `新` 表情**整颗胶囊翻成实心蓝灰**（`--new-fill: #5E72A4`，白字），**不挂「新」徽标**——整块实心色已经是最强信号，再挂个字是重复表达。数据层因此不产出 `kind: 'new'`，只保留 `isNew` 供模板决定胶囊样式；P8 专门钉住这点，谁把徽标加回来就会转红（模板已无 `.badge-new` 样式）。
  - 蓝胶囊内部的元素必须**一并反相**，否则深色文字、暖色分隔线压在蓝底上会糊：`#` 前缀改半透明白、别名改白 82% + 半透明白分隔线；`hot` / `text` / `both` 三种徽标全部降级成**纯白文字并去掉底色**（浅橙/浅紫/浅薄荷底铺到蓝灰上都会变脏色块）。
  - 底色之所以从最初点名的 `#6b7fb3` 压到 `#5E72A4`：白字在 `#6b7fb3` 上只有 3.95:1，别名那档 19px 小字达不到 4.5:1；压深一成后 4.8:1，观感仍是同一支蓝灰。
- 顶部 `.hints` 那行是"使用说明 + 图例"混排，顺序有讲究：先讲怎么发（`发送 #关键词`）、再讲图从哪来，然后是三条**图例**（`.swatch` 迷你胶囊：需文 / 图文 / 新，造型与正文胶囊同比例圆角，颜色引用正文同一组变量），最后才是补充说明（别名用 `·` 分隔）。图例一律**画出来**而不是用颜色词描述颜色（写"蓝底"这种话既是废话又会随改配色失效）。
- **别再照搬 Apple / iOS 风格了（试过一版，用户选了糖果风）**：静态长图里能落地的只有 Apple 的*静态*部分——克制的中性色板、靠字号阶 + 字重 + 透明度建立的层级、大字号负字距 / 小字号正字距、8pt 间距网格、细分割线、语义色只留给「新/热」。而响应延迟、弹簧、可中断过渡、1:1 拖拽都依赖"会动"，`backdrop-filter` 依赖"背后有内容"，搬进长图只会变成假装饰。另外 HIG 的字号阶是给 390pt 手机屏定的，搬到 2560px 画布要按 ~1.9x 放大，否则小到看不清。
- `forceSharp` 必须透传到模板：开了强制 `#` 却让图上写着裸关键词，用户照抄会一条都触发不了。`#` 用 `.force-sharp .chip-k::before` 伪元素画，**不要**去改 `keyMap` 里的原始关键词。
- **分类不是"按 tags 分组"**：远端 971 个 meme 只有 283 个带 tags，纯 tag 分组会留下 71% 的「未分类」（实测另一个方案 `scheme='ip'` 就是这样，「其他」占 62.3%）。`utils/memeCategory.js` 用「tags + key 前缀 + 关键词语义」三条互补线索做**单层互斥**归类，命中顺序即优先级：题材（米哈游 / 鸣潮 / 蔚蓝档案 / 其他作品）→ 属性（成人向）→ 功能（节日祝福 / 特效工具 / 工具应用 / 生活日常 / 网络热梗 / 举牌写字 / 动作互动 / 情绪表情 / 动物萌宠）→ 兜底「其他」。当前实测 15 组、971/971 全覆盖、零重复，「其他」15.2%。加分组只需往规则表的 `tags`/`prefixes`/`words` 补词，**别改判定顺序**（顺序一变整批归属都会漂）。`猫猫虫` 与 `咖波` 是同一角色（猫猫虫咖波），远端两个 tag 并存，必须映射到同一个名字，否则同一批 meme 会按 tags 顺序被拆到两组。
- 模块依赖约定：`utils/memeCategory.js` **零 import、纯函数**（不碰 logger/redis/Config），可脱离 Yunzai 运行时独立测试；`apps/派蒙meme.js` 里对 `utils/common.js`（`render`）用**惰性 `await import()`**——那是重依赖链（puppeteer / tts / pdfjs），meme 其它命令都不需要，测试套件也不该因此被迫加载框架。

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
- **探针/测试脚本结尾必须显式 `process.exit(0)`**：脚本会 import 主仓库的 `lib/config/config.js` / `lib/renderer/loader.js`，它们在 import 阶段就建立 chokidar 文件监听，句柄一直引用事件循环 → 业务跑完 node 也不会退出（实测挂满 8 分钟、无任何输出，后台任务状态一直停在 running，容易被误判成卡死）。配套做法：脚本把阶段结果**实时写日志并带结束标记**，用日志区分"跑完没退出"和"真卡住"，不要只看任务状态。
- 派蒙meme 测试套件：`npm run test:meme`（完整，含一条约 48s 的超时用例 K）/ `npm run test:meme:fast`（跳过 K，日常回归）/ `npm run test:meme:mutants`（跑变异矩阵，慢）。实现放在 `test/meme/`——注意 **`test/` 在 .gitignore 里，属本地文件、不入库**（与 `test:memory` 同一约定），新克隆的仓库里没有这些测试，需要自行补齐后再跑：
  - `meme.test.mjs`：断言套件，离线可跑（不依赖真实 Yunzai/Redis/远端）。A–O 组覆盖规则注册 / 更新回退 / 取图 fallback / 图片下载容错 / CD 原子化 / 参数解析；**P 组覆盖 `#meme列表` 的分组分类**（互斥、全覆盖、题材与功能命中、展示字段、排序），**Q 组覆盖列表图渲染链路**（缓存命中直接发图、本地渲染不可用时退回远端并落盘）。做法是桩全局（`logger`/`redis`/`Bot`/`segment`）+ 本地 http 假 meme 服务端 + **真实** `lib/plugins/loader.js` 与插件模块，按 `PluginsLoader.deal()` 的匹配方式断言规则，直接调 `new memes().task.fnc`（等价 `loader.startTask`）验证定时任务真的请求远端，并用并发调用验证 CD 原子性。redis 桩必须实现真实的 `SET` 语义（`NX`/`EX` + 未抢到返回 `null`），否则原子性测不出来。注意**测试环境没有任何渲染后端**，所以本地列表图渲染必然失败、必然走远端兜底——这是 Q 组能确定性断言的前提。
  - `run.mjs`：入口。上述链路要求 cwd 看起来像云崽根目录（`config/default_config/`、`package.json`、`renderers/`），所以它自动搭临时 cwd 再跑、跑完清理，测试产生的 `data/memes/*` 只落在临时目录。支持 `--skip-slow` / `--force-sharp=false` / `--mutant <kind>` / `--all-mutants` / `--keep`。
  - `make-mutant.mjs`：15 个变异（每个对应一类断言）。`--mutant <kind>` 会生成变异 → 跑套件 → **在 finally 里删除副本**；变异副本落在 `apps/__mutant_meme.mjs`（相对 import 才能解析），以 `.mjs` 结尾所以不会被 loader 当成插件加载。预期是"只有目标断言转红"，全绿即说明断言没覆盖该行为。`timeout` 变异（去掉请求超时）的预期是**挂死**，只对慢用例 K 生效，因此 `--all-mutants` 会跳过它，需单独跑。
  - 新增断言后请至少跑一次对应变异；断言"绿了但删掉实现还是绿"等于没测。
- 真实验证需重启 Yunzai 并在群内发指令；部分链路（真实模型提取、`awaitContext` 二次确认）无法在仓库内独立验证。
- **本地预渲染模板改动的做法**（改 `resources/**/index.html` 时不必启动 Yunzai 就能看出图、量尺寸）：用一次性脚本（放系统临时目录或即用即删）——
  1. `import template from 'art-template'`，把模板 `template.render(html, data)` 出来；
  2. **落到 `<repo>/temp/html/<pluginKey>/<htmlPath>/<saveId>.html`**（例如 `temp/html/chatgpt-plugin/memeList/index/index.html`）——必须对齐 `Renderer.dealTpl()` 的目录层级，否则模板里的 `{{pluResPath}}`（= 5 层 `../` + `plugins/<key>/resources/`）会解析错、字体/图片全 404；
  3. `page.goto('file://' + 该绝对路径, { waitUntil: 'networkidle0' })` 后对 `#container` 调 `elementHandle.screenshot({ path, type: 'jpeg', quality })`，与渲染器最终行为一致（宽度 = 元素宽度，不是 Viewport）；
  4. 顺便断言渲染出的 HTML 里不再残留 `{{`（模板变量没被替换时最容易漏）。
  本机 `puppeteer` 未下载 Chromium（`~/.cache/puppeteer` 为空），但 `msedge.exe` 在 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，用 `puppeteer.launch({ executablePath: 该路径 })` 可直接借用；量产物尺寸/体积用仓库已装的 `sharp`（`metadata()` / `extract().resize()` 裁剪局部看清细节）。
- **`test:meme` 一行断言都不输出就直接退出码 1 时，先查 `es-toolkit` 能否解析**：根仓库的 `lodash` 是 pnpm 的 `link:lib/modules/lodash`，而该 shim 第一行就 `import 'es-toolkit/compat'`。若顶层链接缺失（包只躺在 `node_modules/.pnpm/` 里），`lib/config/config.js` 会在 **import 阶段**抛 `ERR_MODULE_NOT_FOUND: Cannot find package 'es-toolkit'`，表现为套件连 `# 被测文件: …` 都没打印出来——这与代码改动无关，别去改测试。补链接（pnpm 本该建的那个顶层软链）：
  ```sh
  node -e "require('fs').symlinkSync('<repo>/node_modules/.pnpm/es-toolkit@<ver>/node_modules/es-toolkit','<repo>/node_modules/es-toolkit','junction')"
  ```
  验证：`node -e "import('<repo>/lib/modules/lodash/index.js').then(()=>console.log('OK'))"`。

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
- **分片断点 `chunksDone` 的失效条件**：`runExtraction` 的断点续跑假设"同窗口 rows 不变 → 分区确定"，因此**原文变化的路径必须清断点**——`ensureTask` 的 needsReextract 分支重置 pending 时清 `chunksDone` 并把 `attemptCount` 归零；空窗/成功后也清空。`processWindow` 失败重试时不清断点（恰好用于续跑）。`chunksDone` 存于 task hash（字符串化 JSON，`store.setTask` 只写指定字段、其余保留），崩溃恢复（running>10min → pending）后断点依然有效。
- **TRSS loader 匹配命令读的是「注册实例」的 `rule`**：`deal()` 里是 `for (const v of i.plugin.rule)`，而每条消息都 `Object.assign(new i.class(e), { e })` 新建副本——所以在插件方法里改 `this.rule` **完全无效**（改的是副本；加载期改的是 init 实例）。运行期新增/刷新命令必须回写注册条目：`import loader from '../../../lib/plugins/loader.js'`，在 `loader.priority` 里按 `i.class === 本类 || i.key.endsWith('本文件名')` 定位后 `entry.plugin.rule = rules`。`reg` 必须是 `RegExp`（`deal()` 不做字符串转换，只有 `loadPlugin()` 转一次）。热更新（chokidar 带 `?时间戳` 重新 import）会换掉类身份，定位别只靠 `i.class`；参考 `apps/派蒙meme.js` 的 `registerRules()`。
- **云崽的 redis 是 node-redis v4 的驼峰 API**（`hGet` / `hIncrBy` / `hGetAll` / `mGet`，写法是 `set(k, v, { EX: n })`）。需要原子锁就用 `set(k, v, { NX: true, EX: n })`：守卫选项名是大写 `NX: true`，**没抢到时返回 `null`**（`@redis/client` 的 `transformReply()` 声明就是 `… | null`），据此判断是否放行；不要写 `GET`→`SET` 两步（并发会一起通过），也不要用 `INCR` + `EXPIRE` 两步。
- **`loadPlugin()` 的顺序是 `new p()` → `await init.init()` → `new p()` 再 push 进 `priority`**：init() 执行期间本插件还没注册，此处的动态注册会「找不到条目」——不用补救，随后构造的注册实例会按当时的模块级状态生成 `rule`（这也是 `keyMap` 作为模块级变量在加载期可用的原因）。
- **puppeteer 出图的宽度由「元素」决定，不是 `Viewport`**：`renderers/puppeteer/lib/puppeteer.js` 非分页路径执行的是 `#container`.screenshot()，`data.Viewport` 只在**分页**（`multiPage`）时才被用作分片高度——普通渲染传 `Viewport` 是死参数（`GenerateMathRenderTool` 传的 2560×1600×4 其实没生效）。要出 2K/4K 就**把元素 CSS 宽度调大**。另外 `data.path` 会被透传给 `element.screenshot({ path })`，可直接让渲染器把图写到指定文件、跳过 base64 往返（本项目 `#meme列表` 就用这招落 `data/memes/render_list.jpg`）；代价是**渲染前要先删旧文件**，否则失败时无法用 `existsSync` 判断成功。
- **art-template 的 `{{each}}` 不能用 `block` 当循环变量名**：`block` 是它编译产物内部的标识符（子模板机制占用了该名字），用作 item 变量会直接 `CompileError: Unexpected token ','`，报错信息里只给一行 `generated: block(,function(){]`，很难从报错反推。`$` 开头的名字同理避开。
- **定时任务里"重读本地缓存"等于空转**：`init()` 开头会清空内存再读 `data/memes/*.json`，而缓存在进程存活期间一直存在 → 「数组为空才拉远端」的守卫永不成立，日更实际什么都没拉（旧代码 `this.init.bind(this)` 就是这个 bug）。任何"定时刷新远端资源"的路径都必须显式跳过本地缓存读（本项目用 `init(true)`）。
- **TRSS loader 的定时任务 `task.fnc` 必须传函数引用**（如 `this.runDaily.bind(this)`），不能传方法名字符串：`loader.collectTask` 只校验 `i.cron && i.fnc` 后原样入队，`startTask` 直接 `await i.fnc()`，字符串会被当作函数调用报 `TypeError: i.fnc is not a function`。注册方式参考 `apps/ScheduleTaskPlugin.js` 等：把 `task` 放在构造函数体内（`super()` 之后赋值 `this.task`，此时才能 `bind(this)`），而不是塞进 `super({...})` 配置。注意消息路由的 `rule[].fnc` 仍是字符串（loader 用 `plugin[v.fnc](e)` 按名解析），二者约定不同，勿混淆。
