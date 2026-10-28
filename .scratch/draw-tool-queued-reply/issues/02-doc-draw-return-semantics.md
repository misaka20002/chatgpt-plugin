# 02 — 术语表与工具指南记录绘画插件的两种返回语义

Status: ready-for-human（实现完成，改动在工作区未提交；待人工提交）
Type: task
Blocked by: 01

## 目标

把「入队型 / 同步型绘画插件」的区分写进项目自有词汇与工具指南，避免下次改 `draw` 文案时重读三个插件源码。

## 改动点

- `GLOSSARY.md` 追加两个词条：`入队型绘画插件`、`同步型绘画插件`，照现有 `**术语**:` / 正文 / `_Avoid_:` 格式；只写语义，不写文件路径与行号。
- `docs/agent-guides/tools.md` 在「贴表情」小节之前新增「绘画工具（`draw`）的两种返回语义」一节，约三五段：两类插件的返回时机、文案必须跟着分支走（两个方向都是误报）、`false` 的严格判定、Prompt Gallery 对入队型不生效是既成事实、`nai-plugin` 本机未安装未核实。
- 不在 `AGENTS.md` 的导航表新增行——`utils/tools/` 已由「工具与媒体」一行覆盖。

## 验收

- [x] 术语表词条不含实现细节（无路径、无行号）。
- [x] 工具指南不逐行复述源码，只写结论与判断依据。
- [x] `node test/pathLeak.check.mjs` 通过（文档里不得出现本机用户名的绝对路径）。

## Answer

- `GLOSSARY.md` 末尾新增两条术语，各两行正文 + `_Avoid_:`；`_Avoid_` 分别否掉「异步绘画插件」（所有插件都是异步调用，分不出区别）与「阻塞型插件」（说的是调用方被占住）。
- `docs/agent-guides/tools.md` 在「贴表情」之前新增「绘画工具（`draw`）」三段：返回时机差异与两个方向的误报、`=== false` 的严格判定与 `undefined` 为什么必须放行、Prompt Gallery 对入队型不生效是既成事实。
- `AGENTS.md` 未改（导航表已有「工具与媒体」覆盖 `utils/tools/`）。
- `npm run check` 内的路径卫生检查（452 个文件）与风格检查均通过，新增段落不含本机路径。

## Comments

- **2026-10-28 两轴评审后**：`GLOSSARY.md` 的入队型词条补上「`paimonnai-plugin` 已核实、`nai-plugin` 两支按同源实现归入、未在本机核实」，与 `tools.md` 的口径对齐；`tools.md` 的「只在严格等于 `false` 时回 `Error: …`」补限定「只在这三处判断」，并点名 siliconflow 五个分支仍是丢弃返回值的旧口径。
