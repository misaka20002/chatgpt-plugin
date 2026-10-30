# 03 编排迁移：从工具类到独立运行入口

Status: done

Blocked by: 01, 02

## 目标

把 `generateGroupMemberSkill` 的编排逻辑搬出 `utils/tools/`，去掉工具参数校验，返回结构化结果而不是给模型看的字符串。

## 范围

- 新模块导出 `runGroupMemberDistill(e, { targetId, requestedCount })`，返回 `{ skillMarkdown, artifact, summary }`。
- 取样本改为：授权 + 记忆总开关 → 本群原文分页扫满保留期（上限 60000 行）→ 按发送者/空文本/指令过滤 → 候选超过 6000 时 `sampleRecordsByCount` → 不足 30 条才回退历史扫描。
- 脱敏、切块、合成、质量自检与重跑、落盘断点、增量更新、失败报告原样保留。
- 日志前缀改 `[Nuwa]`；失败信息带产物相对目录。
- 发送环节移除，改由命令层投递。

## 验收

- 编排模块不再引用 `AbstractTool`，也不再接收 opts。
- 分块数 = ceil(证据 token / 50000)，6000 条 30 字样本为 3 块。
- 失败路径仍写 `references/generation-report.json` 并带相对目录。

## Comments

- 单块预算 50k 不动：单次调用的上下文安全线，且与上游单 agent 量级同阶。
