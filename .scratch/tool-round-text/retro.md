# retro：工具轮文本会话（0fd823ac）

- 日期：2026-10-15 ｜ 依据：会话记录（1112 行 / 299 次工具调用）+ 仓库现状勘察
- 相关 spec：同目录 [spec.md](spec.md)

## 改进项与落地状态（用户已确认「全按推荐」）

| # | 类别 | 项 | 决定与落地 |
| --- | --- | --- | --- |
| 1 | Automated checks | 仓库无任何检查在跑（`.github/workflows` 只有 stale 与发布） | 新增 `npm run check`（`test/checkSyntax.mjs` 全仓 node --check + test:config / test:providers / test:thinking）+ `.github/workflows/check.yml`（push v2 / PR） |
| 2 | Navigation | spec 未按 issue-tracker 约定落盘 | 归档到本目录 `spec.md`（随仓库提交） |
| 3 | Test infra | mock 与模块导出手工同步易漏（本次漏过 groupReplyCore 一处） | 集中为 `test/fixtures/toolForwardMock.mjs` 工厂；三处测试改用；`docs/agent-guides/testing.md` 补一条检查提示 |
| 4 | Navigation | 依赖环地形未文档化 | `docs/agent-guides/tools.md` 新增「依赖环与延迟调用约定」（两条环 + 延迟调用硬规则） |
| 5 | Environment | 双 lockfile 与文档（pnpm）不一致 | 统一 pnpm：`packageManager: pnpm@10.15.0` + `pnpm-lock.yaml`（`--ignore-workspace` 生成，服务 standalone/CI）+ 移除 `package-lock.json` / `yarn.lock` |
| 6 | Navigation | 送审脚本导航指针 | **不写**（本次未送审，用户决定） |
| 7 | Tool economy | ask-matt 整页重载 7 次 | 机制解释：同会话加载一次即可、压缩后需重载；**无改动** |

## 顺带发现并修复（实施中暴露的真实问题）

- **`@google/generative-ai` 补丁链路的双重损坏（已修复）**：
  1. **补丁文件被误删**：2026-05-15 的提交 `85dfb63`（语音配置主题）静默删除了 `patches/@google__generative-ai@0.1.1.patch`（26 行），致 standalone `pnpm install` ENOENT 失败、`apps/management.js#patchGemini` 指向不存在的文件。**已从 `85dfb63^` 恢复文件**。
  2. **插件级 `pnpm.patchedDependencies` 是失效残留**：`^0.1.1` 现已解析到 **0.1.3**（宿主根 lockfile 实际锁定 0.1.3），补丁 key `0.1.1` 永远无法命中，standalone 安装直接 `ERR_PNPM_UNUSED_PATCH` 失败。**已从插件 package.json 移除该段**（宿主环境本就运行未打补丁的 0.1.3，行为与现状一致）；需要代理补丁的用户仍可通过 `#gemini解决方案`（patchGemini）在宿主层配置。
- **宿主是 pnpm workspace**（`TRSS-Yunzai/pnpm-workspace.yaml: packages: ['plugins/**']`）：workspace 内会忽略插件级 lockfile → 插件自己的 `pnpm-lock.yaml` 只服务 standalone 与 CI（因此必须保留）。
- 宿主根 `pnpm-lock.yaml` 曾被 workspace 安装重写但**内容零变化**（git 干净），已核实无副作用。

## 无发现类别

- No-ops：AGENTS.md（89 行）结构紧凑，未见不影响行为的指令。
- Global AGENTS.md：无全局 steering 文件；仓库 AGENTS.md 尺寸健康。
- Information access：会话未遇关键信息缺口。

## 待观察 / 待办

- **CI 首跑**：确认干净环境下 `pnpm install --frozen-lockfile` 与补丁应用通过（本地已在临时目录做等价验证）。
- 真实群手动验证仍未做（recognize_media 触发 / forwardToolRoundText 开关 / forwardReasoning 表现）。
