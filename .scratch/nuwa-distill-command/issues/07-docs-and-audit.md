# 07 文档与工具审计

Status: done

Blocked by: 03, 04, 05

## 目标

文档与代码同形，别让人照着旧文档去找工具。

## 范围

- `docs/agent-guides/tools.md`：「群友 Nuwa Skill」一节改为「女娲蒸馏指令（`#女娲蒸馏`）」，取证方法与预算口径更新（6000 条 / 等距 / 分页铺满保留期 / 150k 3 块），产物与隐私结论保留。
- `docs/agent-guides/memory.md`：指令清单加 `#女娲蒸馏`（主人专用 + 二次确认）。
- `apps/help.js`：日常指令表加一条（与 `#群记忆` 同组，后者也是主人专用）。
- `AGENTS.md`：导航表补 `apps/atGraph.js`（两个指令同文件）与 `utils/groupMemberSkill*.js`。
- `README.md`：变更记录加一行。
- `test/toolContextAudit.{json,md}`：重新生成。

## 验收

- 文档里不再出现「工具 `generateGroupMemberSkill` 是当前入口」这类表述。
- 审计文件里没有该工具条目。

## Comments

- 审计文件是 2026-09-16 的快照，重生成**不会**只「少一条」：`MemoryTool` 等十余个工具的 description/schema 在这六周里已经变过，`grandTotalTokens` 6427 → 8238。这部分漂移与本功能无关，随重生成一并带进 diff；不手工改生成物，否则数字互相不一致。
