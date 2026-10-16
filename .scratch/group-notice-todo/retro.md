# retro：群公告与群待办工具会话（c27e8c6e）

- 日期：2026-10-15（两轮 retro）｜ 依据：会话记录（第一轮 1244 行 / 331 次工具调用；第二轮 1692 行 / 449 次）+ 仓库现状勘察
- 相关：[spec.md](spec.md) ｜ [research.md](research.md)（后台派生失败的一手调查）

## 改进项与落地状态

| # | 类别 | 项 | 决定与落地 |
| --- | --- | --- | --- |
| 1 | Navigation | **spec 的落盘时机没有触发条件（复发）**。本特性 8 轮迭代出的需求只活在对话里，会话压缩后被迫解析 1244 行转录反推（18 次 Bash、14 KB 参数，schema 猜错空跑三次）；spec 直到实现完 + 三轮评审后才补写。上个 retro 已把"spec 未落盘"列为改进项并补档过一次，**下个特性立刻重犯**——一次性补档没改变行为，因为 `AGENTS.md` 只说了 spec 存在哪、没说什么时候写 | **已落地**：`AGENTS.md` 的 `### Issue tracker` 补触发条件——多轮迭代出来的需求**在动手实现前**先落盘成 spec |
| 2 | Coding standards | **注释/文档的跨位置全称断言失实（三次）**：Gemini 分支措辞被写成"四个分支都…"、测试注释宣称"天然免疫"误伤、锅巴说明文案前后半句矛盾。模式一致：只核对自己刚改的那一处就下全称结论。属判断类（无守卫可替代），归**评审侧** | **已落地**：`AGENTS.md` 工程规则新增一条——写「N 处都…」「所有…」前逐个打开被断言的位置核对，并附这三次失实的出处 |
| 3 | 文档结构 | `docs/agent-guides/tools.md` 单条 bullet 塞了四条规则（1027 字符），而该文件只有 37 行却有 12 KB。第 2 项里那个 false claim 正是**藏在这条 bullet 中间**才活到评审 | **已落地**：拆成三条（鉴权 / 执行查找表 / 工具自查），每条一个 leading word；导语里写死的"五条约定"改为不写数量 |
| 4 | Tool economy + Information access | 后台派生两个评审子 agent 均返回 `killed`，`TaskOutput` 又拒绝等待，多花 2 次 Agent + 3 次 TaskOutput | **先调查后落地**：按用户要求查一手来源，结论见 [research.md](research.md)。要点——`run_in_background` 会把子 agent 派生为"自动团队"成员，`TaskOutput` **设计上**不对团队成员等待（我用错了工具）；`killed` 是终态且会**跳过完成通知**，所以等待必然落空。**已落地**：**权威副本在本仓 `AGENTS.md` 工程规则**（随仓库走、跨机器可用，指向本目录 `research.md`）；机器本地的 `~/.workbuddy/skills/code-review/`（`SKILL.md` 第 4 步硬约束 + `SUBAGENT-DISPATCH.md` 证据）为本地加强，`SOUL.md` 的临时副本已移除 |

## 上个 retro 的落地项（本次核对）

全部在位：`npm run check`（语法预检 + config/providers/thinking 三套件）、`.github/workflows/check.yml`、pnpm 统一（`packageManager: pnpm@10.15.0`，`package-lock.json` 与 `yarn.lock` 已移除，只留 `pnpm-lock.yaml`）。

## 无发现类别

- **Automated checks**：护栏已存在（`npm run check` + CI job）。按 retro 的判定定义——「无 pre-commit **且**无 CI job」才算发现——此处**不构成发现**。本地 `core.hooksPath` 未设、无 husky/githooks，但它拦的是人工提交而非 agent，收益有限，**不落地**。
- **未使用导出的检查：已调查并否决**。全仓 700 个导出里 26 个疑似无人引用，但其中 `apps/*` 是插件加载器**按目录扫描注册**的（`AGENTS.md` 明载"每文件只注册第一个导出"）。这种检查会**出生即红**，随后被无视，不如不做。
- **Global AGENTS.md**：89 行 / 9.7 KB，尺寸健康，无需把指令搬去别处。
- **No-ops**：未逐句判定；`AGENTS.md` 结构紧凑（与上个 retro 结论一致）。

## 验证

- 本轮环境改动是两份文档（`AGENTS.md`、`docs/agent-guides/tools.md`），`test/` 下无任何测试读取它们（已核对）。
- 拆分效果实测：目标 bullet 1027 → 596 / 150 / 514 字符；该文件剩余三条超长行（619 / 1551 / 846）**按约定不动**，本次只拆审批指定的那一条。

## 第二轮（同日 20:00，会话 1692 行 / 449 次工具调用）

第一轮之后会话又跑了约两小时（本段新增 118 次工具调用），新暴露两项。

| # | 类别 | 项 | 决定与落地 |
| --- | --- | --- | --- |
| 5 | Tool economy | **78% 的 Bash 调用本可用专用工具**：全会话 Bash 218 次 vs `Grep` 工具 11 次。其中 106 次用 `sed -n` / `awk` / `cat` / `head` / `tail` 读文件、48 次 shell `grep -r` 搜索、15 次 `ls` / `find`。**不是理论问题**：同一个目标（`.workbuddy` 全盘搜索）shell 递归 `grep` **三次全被 SIGTERM**，`Grep` 工具**三次全一次命中**（转录 1327 / 1510 / 1693 失败 vs 856 / 1514 / 1545 成功）。根因是这条规则早已存在、却躺在不被注入的 `~/.workbuddy/…/MEMORY.md` 里 | **已落地**：`AGENTS.md` 工程规则新增一条（本仓生效；跨仓需各自再放） |
| 6 | Coding standards | **锅巴说明文案与注册语义之间没有同步触发点**：`bottomHelpMessage` 描述的是 `collectTools` 的注入条件与工具鉴权，三者分处两地、各自演化。`configuration.md` 当时只要求同步**字段**（schema / `getConfigData` / `setConfigData`），不管**文案是否与运行时语义一致**——本次评审抓到的硬违规正是它（把「Bot 是群管即注入」与「还要求提问者是主人或群管」笼统写成一档，对 `EditCard`/`Jinyan`/`SetTitle` 是错的） | **已落地**：`docs/agent-guides/configuration.md` 补一条触发点 |

### 本轮的三条流程验证（不是发现，是证据）

- 第一轮新建的「跨位置全称断言逐处核对」规则**当场生效**：上线后第一次评审就抓到 `guoba.support.js:1431` 违反它，评审直接引用了 `AGENTS.md:40`。
- 第一轮新建的「评审子 agent 一律前台」规则生效：本轮两轴前台并行派生，全部正常返回，**无 `killed`**。
- **grilling 拦下一次会破坏三个在用功能的改动**：请求方基于「三兄弟限了普通成员」的误读提出收窄；grill 逐行核实后确认 `EditCard` / `Jinyan` / `SetTitle` 设计上就是自助用（无权限时 `qq != sender` 即拒），`GroupTodo` 本就受限，`GroupNotice` 反倒更宽。最终**零代码改动**，只修了失实的文案。

### 本轮附带的事实更正

- `toolGroupAdminArr` 的 `bottomHelpMessage` **最终由用户手定为短版**：`智能模式中的群管理工具；已优化算法不会误伤其他群友；推荐全部开启`。此前会话中写的长版**作废**。短版不再含「且提问者是主人或群管」那处失实断言，故评审的硬违规**已解除**；两档的细分说明改由**选项标签**承担（`群公告（只读、全员可用）` / `群待办（查看、设置、完成、取消）`）。
- 因此 `spec.md` 里「说明文案要区分总闸 / 群管类工具 / 只读群公告三件事」这一句与终态不符，已在 `spec.md` 的 Further Notes 中记录实际决定。

## 待观察 / 待办

- **真实群手动验证仍未做**：群公告读取、四类待办动作在真机 QQ 的实际表现需重启 Yunzai 后在群里发指令确认。
- **本轮不提交**：用户决定人工审查。
- 工作区共 **9 改 + 5 未跟踪**（`AGENTS.md`、`docs/agent-guides/configuration.md`、`docs/agent-guides/tools.md`、`guoba.support.js`、`model/core.js`、`package.json`、`test/configArrayMerge.test.js`、`test/toolContext.test.js`、`utils/config.js`；未跟踪为 4 个新文件 + `.scratch/group-notice-todo/`）。
- 第二轮落地的工具偏好规则**只覆盖 chatgpt-plugin**。本机同一父目录下另有多个仓，要跨仓生效需各自再放一条。

## 第三轮（2026-10-16 深夜 → 10-17 凌晨：读取放开评审 → 暂停 + 后台派生复发·根因落定）

- 依据：本会话（`a8c96ee0`，统计时 418 条记录 / 132 次工具调用；grill 两轮 → NapCat 调研 → 暂停注册）
- 相关：[spec.md](spec.md)（2026-10-16/17 三条 Comments）、[ADR-0001](../../docs/adr/0001-group-todo-read-open-split.md)、[napcat-group-todo.md](napcat-group-todo.md)、仓库根 `GLOSSARY.md`

| # | 类别 | 项 | 决定与落地 |
| --- | --- | --- | --- |
| 7 | Tool economy / Information access（复发，根因已证实） | **后台派生第三次被终止**，这次从运行时日志钉死了链条：spawn 落进已取消的自动团队，`00:03:53.166` 注册 → `.168` `running -> killed`（2 毫秒）→ `spawned after team cancel and was paused` → 10 秒后 `force killed (keepWakeable=false)` + 移出团队。对照同日 19:18 前台派生的两个评审 agent（`isTeamMember=false`）正常完成——**前台可靠、后台（自动团队成员）不可靠**。规则没拦住的原因：`AGENTS.md` 那条字面只写「评审子 agent」，调研不在其列 | **已落地**：`AGENTS.md` 规则扩宽为「一切需要结果的子 agent 一律前台派生」，补「出生即可能被停止」与「真正的后台=任务粒度」；`research.md` 复现记录更新为日志证据版 |
| 8 | Information access | **运行时日志位置终于找到**：`~/.workbuddy/logs/<日期>/<工作区名>__<hash>.log`（含 `[cbc-kw=AGENT_TASK]` / `[AgentTaskManager]` / `[TeamMember-*]` / `[Interruption]`），会话转录在 `~/.workbuddy/projects/<项目>/<sessionId>.jsonl`；上轮「本机未定位到」作废 | **已落地**：写入 `research.md`「取证入口（增量）」 |
| 9 | Navigation | **协议端本地参考副本没有指针**：本地 NapCatQQ 源码参考副本是本次调研的一手来源，此前只靠用户口头告知；下次查 NapCat 实现应先看本地副本（版本 `v4.18.38-2-g810052c6`），而不是绕 GitHub | **不写（用户拍板）**：不放 `AGENTS.md` 指针；本机绝对路径不入库（`napcat-group-todo.md` 改为不带路径的表述，保留 commit / 版本 / remote 作可复现标识）。同轮补充通用规则：含本机用户名的绝对路径不写进任何产出，已写入 `AGENTS.md` |
| 10 | Automated checks（低优先·留观察） | `test/groupReplyCore.test.mjs` / `test/providerContext.test.mjs` 用正则从 `core.js` 源码扫 import 列表以注册 mock——**被注释掉的 import 行同样会被扫到**（本轮实测无害，属隐性行为）。可选加固：扫描前剥离 `//` 注释 | **不落地**（风险极低，改动测试扫描逻辑收益不成比例） |
| 11 | Automated checks | **路径卫生护栏已存在但未指路**：`test/pathLeak.check.mjs`（随 `npm run check` / CI 运行）就是拦「用户名绝对路径泄露」的护栏，本轮由用户提醒才做全仓审计、跑通该检查（322 个文件、0 命中；`misak` 命中均为公开 GitHub 账号 / 公开链接，未动） | **已落地**：`AGENTS.md` 补「含本机用户名的绝对路径不写进任何产出（文档、注释、命令、回复）」规则并指向护栏；`napcat-group-todo.md` 与 retro #9 的本机路径同步改为不带路径的表述 |

### 本轮的流程验证（证据）

- 「跨位置全称断言逐处核对」继续生效：两份新文档（[ADR-0001](../../docs/adr/0001-group-todo-read-open-split.md)、`GLOSSARY.md`）与 spec 修订的措辞均逐处核对了代码事实。
- 调研改为**当轮前台直接跑完**（`run_in_background` 三次全灭后的可靠通道），报告成功落盘——规则扩宽后的第一次执行。
- `grill-with-docs` 首用：`GLOSSARY.md` + `ADR-0001` 随决策落盘；三次口径变化（读取放开 → 读写拆分 → 整体暂停）全部可追溯，「恢复清单」机制留在 spec Comments。
- 协议端事实先落盘再拍板：NapCat 读取不可用的结论在拍板前完成，用户据此一刀暂停，避免把不可用功能发出去。
- Tool economy：本轮 Bash 占 30/132 ≈ 23%（上轮 78%），其中 git / gh / rg / npm / node 属不可替代项——专用工具规则持续生效。
- Automated checks：护栏在位（`npm run check` + CI），本类别无发现；唯一相关观察见 #10（不落地）。

### 本轮产出（工作区，未提交）

- 新增：`GLOSSARY.md`、`docs/adr/0001-group-todo-read-open-split.md`、`.scratch/group-notice-todo/napcat-group-todo.md`（另有本文件、`research.md`、`spec.md` 的本轮修订）。
- 暂停：`guoba.support.js` / `model/core.js` 的群待办注册入口已注释（四处，带原因与恢复路径）；验证全绿（`node --check` ×2、`test:tools`、`test:group-reply` 64/64、`test:providers` 38/38、`test:config` 31/31）。
