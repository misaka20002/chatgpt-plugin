# 测试入口与隔离技巧

[返回仓库指南](../../AGENTS.md)。只在任务涉及本主题时阅读；工程与验证规则以主指南为准。

本文代码路径均相对仓库根目录。历史用例编号、数据规模和平台现象用于解释约束，不是每次修改都要执行的检查清单；当前命令以 `package.json` 为准，环境现象需在当前机器核实。

验证分级统一见 [主指南](../../AGENTS.md)；浏览器预览见 [渲染指南](rendering.md)，meme harness 见 [meme 指南](meme.md)。

## 现有测试

- 多模型提供商：`npm run test:providers` 验证 QQ 主备两步提交、数字／权限／取消／并发配置变化、各用途来源选择、回退次数，以及真实协议客户端的拒绝和内置工具边界；`npm run test:config` 包含 `test/providerConfig.test.js` 的备份迁移、引用、重启幂等、显式空表单及磁盘失败。四协议备用连接和历史的请求组装由 `test/groupReplyCore.test.mjs` 覆盖，实际聊天保存与连接修改隔离由 `test/groupReplyChat.test.mjs` 覆盖。Web 不纳入本次验证。

- 群聊自主回复：`npm run test:group-reply`，覆盖观察器、防抖、候选窗口、并发与关闭后停止回复，以及 Core/SubLLM 四家 provider 的无工具请求；配置与锅巴保存/重载由 `test/configGroupReply.test.js` 纳入 `npm run test:config`。

- 记忆系统：`npm run test:memory`
  - `test/memoryV2.test.js`：V2 核心单元/回归测试，覆盖存储、提取、召回、每日提炼、采集与 Memory_Tool 等核心逻辑。
  - `test/memoryApps.test.mjs`：apps 层契约测试，通过 `mock.module()` 隔离 TRSS 插件基类与重依赖，覆盖观察器 `rule` 匹配（必须能匹配多行文本）、管理指令的展示编号与按序号删除的一致性（全序比较器不能被删）。**只 mock 边界，被测的排序/编号/正则匹配必须执行真实生产代码**——把业务逻辑写进 mock 等于自己验证自己。
  - `test/atGraph.test.mjs`：@ 图谱聚合、好感度规则、读取上限、指令权限/参数、并发及发送前授权复查；模板实际布局另用 `node test/render/atGraph.check.mjs [--shot]` 检查。
  - `test/atGraphAvatars.test.mjs`：固定头像来源、缓存、图片解码、响应大小/类型/重定向及正文超时的失败降级；只 mock 网络边界，不请求真实头像。浏览器图谱检查还覆盖完整昵称、emoji、次数角标和头像解码。
  - 历史上出现过的 `chain.test.mjs` / `chain2.test.mjs` / `chain3.test.mjs` / `chain5.test.mjs` **不属于当前测试体系，不要引用、恢复、补建或假定它们存在**（`chain5` 已于 2026-09-20 删除）。测试报告只以当前 `package.json` 的 `test:memory` 实际列出的文件为准，**不要写死用例数**，读数以当次 Node 输出为准。
  - 本测试不依赖真实 Redis、真实模型或完整 TRSS 运行环境。
- 图谱 Redis 协议兼容专项：`node --test test/atGraph.redis.test.mjs`，需要本机 `redis-server` 与 Unix socket；测试自行启动独立临时实例，禁用持久化，不连接云崽 Redis。用于确认服务端命令兼容、倒序时间边界、过期原文和读取条数上限；不加入日常无 Redis 依赖的 `test:memory`。
- 工具相关：`npm run test:tools`（GithubTool 行为 + `test/opencodeWebSearchTool.test.js`：OpenCode 联网搜索的两家响应形态、凭证位置、失败识别（含 Exa 以 200 普通结果返回的限流提示）与失败换另一家，fetch 桩按实测形状构造 + 工具鉴权上下文合并与参数脱敏（`test/toolArgRedaction.test.js`） + `test/htmlTool.check.mjs`：`generate_html` 的源码提取、可执行标签与 `<meta>`/`<link>` 清洗与落盘文件名的纯函数 + `test/render/htmlRender.template.check.mjs`：htmlRender 模板脚本的宽容/上限逻辑，无浏览器 + `test/htmlToolSend.test.mjs`：`generate_html` 的 `send_html_file` 分支——默认只发图、开启时补发与渲染同源的清洗后 `.html`、适配器无 `segment.file` 时如实回填"未发送"、只有布尔 `true` 才开启；渲染与子模型用 `mock.module` 隔离，落盘写真实文件）。
- 媒体识别相关：`npm run test:media`（SubLLM 多模态载荷、按需内容识别的来源选择与失败语义、不可信媒体地址与下载字节边界；用 `mock.module` + `--experimental-test-module-mocks`）。其中内容探测依赖**宿主的 `file-type`**（宿主 `package.json` 已声明）：宿主未完整安装时本机会出现 3 例环境性失败（`mediaUrlGuard` 的内容探测与旧版导出兼容用例），与插件改动无关。
- 配置系统：`npm run test:config`（`test/configArrayMerge.test.js`：加载配置时数组整体采用用户的值、嵌套对象仍按键深合并、未保存过的默认数组原地修改后能写盘；`test/configBaseUrl.test.js`：四家 provider 地址的加载、直接赋值、锅巴保存与显示一致，保留路径和空值；每次加载起一个子进程并把 cwd 指到临时目录，走真实的加载与保存代码，锅巴测试仅 mock 无关语音依赖与 Redis）。
- meme 日常回归：优先 `npm run test:meme:fast`；完整慢测试 `npm run test:meme`；`npm run test:meme:mutants` **仅专项使用，不作为普通修改的完成条件**。
- `test/` 随仓库入库，属**本地辅助验证**；CI（`.github/workflows/check.yml`）只跑 `npm run check`（语法预检 + `test:config` / `test:providers` / `test:thinking`），不得把"本地全绿"等同于全面回归保障；不要求为了本地测试体系完整而扩大当前任务；测试缺失时按当前改动选择可执行的最小验证，不需要先重建整套测试环境。

## 测试技巧

- mock redis：内存 `Map` 实现（见 `test/memoryV2.test.js` 顶部），支持 `scanIterator` 生成器。
- **注入 llm 避免框架依赖**：`extractor.runExtraction` 的 `llm` 参数；SubLLM 是惰性 import（`await import('../../model/SubLLM.js')`），纯逻辑测试不会拉起框架。画像查询固定只读 V2，不再调用或注入模型。
- 测试环境不要 import `utils/common.js`（重依赖链会触发框架配置加载）。
- **mock ESM 模块依赖**：要替换模块级 import（如 `SubLLM` 的四个 provider client、工具的 `paimonFuction`）时用 `node:test` 的 `mock.module()`，注册必须在动态 `import` 目标模块之前，运行加 `--experimental-test-module-mocks`（示例见 `test/subllmMedia.test.mjs`、`test/recognitionMedia.test.mjs`）。
- **模块新增命名导出后，同步所有测试桩**：`mock.module()` 的 `namedExports` 缺了新增导出时注册不会报错，只有真跑到该路径才以 `TypeError` 炸出（本次就漏过一处）。`utils/toolForward.js` 的桩已集中为 `test/fixtures/toolForwardMock.mjs` 工厂——给该模块新增导出只需改工厂一处；其他模块新增导出后请 `grep -rn "mock.module" test/` 核对使用点。
- 断言脚本（非 node:test 结构）作为"文件级"测试加入对应 npm script 即可。

## 复跑 CI（模拟宿主）

改 `.github/workflows/check.yml` 或排查"本机能过、CI 挂"时，可在系统临时目录按 CI 布局复跑，推送前得到与 CI 同序的结论。步骤以 workflow 为唯一来源，这里只写增量知识：

- 布局：临时目录下建 `<sim>/chatgpt-plugin/chatgpt-plugin`（用 `git archive <分支> | tar -x -C` 展开代码）、`<sim>/lib`（宿主 lib 空壳落点）、`<sim>/node_modules`（宿主依赖落点）——对应 workflow 里 `$GITHUB_WORKSPACE/../../` 的含义。
- 顺序：插件目录内 `pnpm install --frozen-lockfile` → 照 workflow 的「补宿主 lib 空壳」造文件 → 照「补宿主提供的依赖」补包（`npm --no-save --prefix <sim> …`，不碰 manifest 与锁文件）→ `pnpm run check`。
- 判"某个空壳/依赖是否必需"：删一个候选（空壳文件或 `node_modules/<包名>`）后重跑 `pnpm run check`，失败即必需、通过即非必需。已实测：`common.js` 空壳必需、`puppeteer.js` 空壳非必需、`md5` 必需。
- 收尾：推送后用 `gh pr checks <编号> -R <仓库> --watch` 等结果；刚推送的几秒内可能报 "no checks reported"，稍等约 10 秒再查。实验目录用完即删。

## 远端 PR：CI 排查与合并前验证

审查/合并来件 PR（fork 分支不在 origin 上）时，与上节复刻 CI 不同：这里复用本机真实的宿主与 `node_modules`，验证对象是 PR 的**合并预览**而不是 head。

- 取代码：`git fetch origin refs/pull/<N>/head:refs/remotes/pull/<N>`，同理取 `refs/pull/<N>/merge`（合并预览）。**验证用 merge**——分支可能落后 base：head 上的失败不一定是 PR 的问题，用 base 的测试脚本组成也会误报（对没有 `pathLeak` 的旧树跑 `pathLeak` 必假红）。
- 不动部署树的验证配方：`git worktree add --detach <临时根>/plugins/chatgpt-plugin`（目录深度与真实布局一致——`../../../lib` 的解析依赖它）→ 建三个 junction 指向真实环境：`<临时根>/lib`、`<临时根>/node_modules`、`<临时根>/plugins/chatgpt-plugin/node_modules` → 跑**目标树自己的** `package.json` 脚本。收尾顺序：**先摘 junction，再 `git worktree remove`**（防递归删除沿链接进真实目录）。
- fork 贡献者的运行需维护者批准：批准前 `gh pr checks` 报 "no checks reported"，但运行已存在——用 `gh run list --branch <head>` 或 `actions/runs?head_sha=<sha>` 查，`gh api -X POST repos/<owner>/<repo>/actions/runs/<id>/approve` 批准。
- CI 一直红先怀疑快照旧：PR 早于 base 上的 workflow 修复时，运行会一直用修复前的快照（实测：重跑复用原快照；关+重开生成的新运行也未采用 base 的修复）。出路是让 head 分支带上新 workflow（作者同步 base；`update-branch` 需凭据具备 `workflow` scope，缺则 403），或合并后以 v2 的 push 运行作权威验证。
- 闭环自证：`git rev-parse <合并提交>^{tree}` 与本地验证过的 `pull/<N>/merge` 树一致，即"本地验证的就是落地的"。

## 临时探针与真实链路

- 临时调试脚本纪律：调试用脚本统一放**系统临时目录**（`$TMP`/`/tmp`）或即建即删，**不要留在仓库内**；用 `rm` 删除后必须确认生效（heredoc/管道组合命令可能因展开错误中断导致 rm 未执行，留下语法错误的残留文件）。
- **探针/测试脚本结尾必须显式 `process.exit(0)`**：脚本会 import 主仓库的 `lib/config/config.js` / `lib/renderer/loader.js`，它们在 import 阶段就建立 chokidar 文件监听，句柄一直引用事件循环 → 业务跑完 node 也不会退出（实测挂满 8 分钟、无任何输出，后台任务状态一直停在 running，容易被误判成卡死）。配套做法：脚本把阶段结果**实时写日志并带结束标记**，用日志区分"跑完没退出"和"真卡住"，不要只看任务状态。

- 真实验证需重启 Yunzai 并在群内发指令；部分链路（真实模型提取、`awaitContext` 二次确认）无法在仓库内独立验证。**只有当仓库内测试无法覆盖、且本次确实修改了相关运行链路时**才要求真实验证。本插件已有两年以上实际运行历史，这是稳定性证据之一——本次未修改且长期稳定运行的路径，不要仅凭理论推演要求重新构造端到端验证。
