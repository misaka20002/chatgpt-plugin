# retro：PR #8 CI 修复会话

- 日期：2026-10-16 19:08–20:35 ｜ 依据：本会话日志（19,839 行，≈254 次工具执行：Bash 116 / Read 45 / Glob 12 / Grep 11 / Skill 10 / WebFetch 8 / Agent 5）+ 仓库现状核对
- 相关：[research.md](research.md)（调研 + 落地记录）｜ 产物：PR #8 修复（最新 `dd6ffdc`，CI 全绿，MERGEABLE / CLEAN）

## 改进项（按严重度；1–4、6 已落地，5 可选未动）

| # | 类别 | 项 | 决定与落地 |
| --- | --- | --- | --- |
| 1 | Automated checks（验证回路） | **「复跑 CI」配方只活在会话里**。本会话两次用它：推送前全流程验证（install→空壳→补包→check 全绿）；三个变体实验定最小集合（puppeteer 空壳非必需、common/md5 必需），并据此修掉 CI 注释两处失实。配方（模拟宿主布局 + 变体实验法）随临时命令删除而消失，下次改 `check.yml` 的人需要重新发明。 | **已落地**：`docs/agent-guides/testing.md` 新增「复跑 CI（模拟宿主）」一节（布局 / 增量知识 / 变体实验法 / 推送后 ~10s 再查）；`AGENTS.md` 任务表测试行加入触发词「CI workflow 改动与复跑」。 |
| 2 | Information access | **gh 已装但环境不可见**：`%LOCALAPPDATA%\Programs\gh\bin\gh.exe`（已登录 misaka20002）不在新 shell 的 PATH；研究子代理据此**失实**报告"本机无 gh"并放弃取 PR diff；本会话所有调用均需全路径。 | **已落地**：`AGENTS.md` 运行环境节新增「查远端 PR/CI」一行（全路径以 `%LOCALAPPDATA%\` 形式书写 + 免认证 API 备注）。 |
| 3 | 本机怪癖 | **两个 git 行为各浪费一次往返**：`git rev-parse --short` 多参数报 `Needed a single revision`（本会话踩 2 次；单参数正常）；`git grep --branches/--remotes` 报 unknown option（应逐 ref 循环）。 | **已落地**：并入 `AGENTS.md` 工程规则新增的「本机 git 与长输出」条（与第 4 项合并为一条）。 |
| 4 | Tool economy | **两次超限输出（219KB / 375KB）被存档且读不回**（`Read`/`Grep` 对该存档路径权限拒绝）：一次 `git grep` 扫进 `server/static/**` 的 `.map` 打包产物；一次 CRLF 噪声 diff。各靠换姿势重跑挽回。 | **已落地**：同上「本机 git 与长输出」条（`server/static` 排除、`--ignore-cr-at-eol`、长输出先落日志）。 |
| 5 | Tool economy（低·可选） | 两轮评审 prompt 各全文粘贴 12 条坏味道基线（技能约定 sub-agent 无其他途径；实际子代理可读文件）。 | 用户级技能（超本仓范围）：抽 `code-review/smell-baseline.md`，prompt 改指路径。可选。 |
| 6 | 文档卫生 | **`.scratch` 等文档含带用户名的绝对路径**（开源仓库不宜公开本机路径）：已入库 3 行（group-notice-todo ×3）+ 本特性新写 19 行。 | **已落地**：22 行清洗（替换为 `%LOCALAPPDATA%`、`~`、`<仓库根>`、`<Yunzai 根目录>`、`<系统临时目录>`）；新增 `test/pathLeak.check.mjs`（白名单：占位符、`runner`、`turing`）并挂进 `npm run check`，本地与 CI 同跑。 |

## 上个 retro 的落地项（本次核对）

- 「spec 动手前落盘」触发条件：在位；本会话直接受益（需求/决策全程落盘 `.scratch/ci-check-workflow/`）。
- 「全称断言逐处核对」：在位，且**当场生效两次**——复审用它与独立实验抓出 CI 注释两处失实（"四个模块"、"pnpm 收敛"），随后修正重推。
- 「评审子 agent 一律前台」：在位；本会话共 5 次前台并行派生（评审 2 轮 × 2 轴 + 调研 1 次），全部正常返回、0 killed。
- 工具偏好（专用工具优先）：在位；Bash 116 次的主体是 git/gh/pnpm/curl 工作流（无专用工具可用），非文件读写代劳。

## 无发现类别

- **Coding standards（评审侧规则）**：本次失实恰属既有规则覆盖范围；「机制性断言」（"否则会被清掉"类）是否并入措辞——维持现状（判断类由评审轴兜底）。
- **护栏**：`check.yml` + `npm run check` 本会话刚修复转绿；不构成"无 guardrail"发现。
- **Global AGENTS.md**：94 行，尺寸健康，无搬迁需求。
- **No-ops**：未逐句判定（结构紧凑，与上轮结论一致）。

## 验证

- 守卫自测：首跑即在 314 个文件中抓到唯一残余（本文件第 11 行的 gh 路径）；清洗后复扫通过（真命中 0；白名单 2 处——`htmlPreview.edge.mjs` 的 `<用户名>` 占位、`SydneyAIClient.js` 的虚构样例 `turing`）。
- `npm run check` 全链（语法预检 + 路径卫生 + config/providers/thinking）通过；`node --check test/pathLeak.check.mjs` 通过。
- `testing.md` 新节与 `check.yml` 不重复：只写增量知识（布局 / 时机 / 实验法），步骤以 workflow 为唯一来源。

## 待观察 / 待办

- PR #8 合并待用户执行；给作者的可选说明评论未发。
- 保留判断项：puppeteer 空壳去留、`loader.js` 空壳缺 default、`HOST_LIB/HOST_ROOT` 命名、首行 `---` 移除。
- 本批环境改动**未提交**（按惯例留人工审查）；建议先提交这批、再合并 PR #8（两边都动 AGENTS.md，先提交可避免工作区纠缠）。
