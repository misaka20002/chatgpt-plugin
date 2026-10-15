# research：后台派生评审子 agent 返回 `killed` —— 是调用方式的问题吗？

- 日期：2026-10-15
- 问题提出：「`run_in_background: true` 派生两个评审子 agent，两个都返回 `Status: killed`，是否需要改成别的调用方式？」
- 相关：[spec.md](spec.md) ｜ [retro.md](retro.md)

## 一手来源

| 来源 | 说明 |
| --- | --- |
| `C:/Users/misak/AppData/Local/Programs/WorkBuddy/resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs` | WorkBuddy 打包后的运行时实现（9,483,171 字节，mtime 2026-10-12 20:09，`sha256` 前 12 位 `1b1a01bc5f7b`）。下述引文均出自此文件，可按哈希复核。 |
| 本会话转录 `c27e8c6e-60ce-4bc8-8890-f7756a44683d.jsonl` | 本次调用的实际返回（派生结果、`TaskOutput` 输出）。 |
| `C:/Users/misak/.workbuddy/audit-log/2026-10-15.jsonl` | 已查：**不含**这两个 task id，故未能从日志还原终止触发点。 |

官方文档（`workbuddy.cn/docs/workbuddy/Overview` 及其子页）只覆盖界面与任务管理，**不含** Agent 工具的后台派生语义，因此不作为依据。

## 结论

**部分是我的调用方式问题，且是主要问题；另有一条是产品行为，值得记为坑。**

一句话：`run_in_background: true` 会把子 agent 变成「自动团队」的成员，而**团队成员的结果在当轮没有受支持的取回通道**——我随后用 `TaskOutput` 去等，属于工具选错；而这批任务被置为 `killed`（终态）后，完成通知会被**主动跳过**，所以即使我一开始就耐心等待，也永远等不到通知。

## 证据

### E1 · 后台派生 = 自动创建的团队 + 成员身份

```js
async autoCreateTeam(t, i) {
  let n = `_auto_${t}`
  return this.createTeam(n, i, "Auto-created team for background tasks", void 0, { isAutoTeam: true })
}
```

团队描述字符串就是 `Auto-created team for background tasks`。这与本次观察完全吻合：派生返回 `team_name: _auto_c27e8c6e-…`，成员名 `general-purpose-1` / `general-purpose-2`。

成员的会话元数据随之被标记：

```js
this.session.meta.isTeamMember = !0
this.session.meta.teamContext = { teamName: t, memberName: i, teamMembers: [] }
```

### E2 · `TaskOutput` 对团队成员**设计上拒绝等待**（← 这是我的误用）

```js
async executeAgentTask(t, i, n, s, c) {
  if ((t.isTeamMember || t.teamContext) && "completed" !== t.status && "failed" !== t.status)
    return this.renderAgentTaskSnapshot(t, i, [
      `Task ID: ${i}`,
      `Status: ${t.status}`,
      "",
      `This is a team member task (status: ${t.status}). TaskOutput does not wait for teammates. Inbox notifies when they finish. This snapshot is not completion.`
    ]);
  ...
}
```

判定条件是 `isTeamMember || teamContext`。后台派生的任务必然命中，所以 `TaskOutput` 只会回一张快照，并**明确写出**正确通道是 inbox。我连续调了 3 次 `TaskOutput` 试图阻塞等待，方向从一开始就错了。

注意这个分支**只排除 `completed` 与 `failed`**——也就是说即便任务已经 `killed`，它走的仍是这条"拒绝等待"分支，返回的 `Status:` 只是把当时的终态念出来。

### E3 · `killed` 是终态

```js
let p = new Set(["completed", "failed", "cancelled", "killed"])
function isTerminalStatus(t) { return "string" == typeof t && p.has(t) }
```

终态意味着 `TaskOutput` 再怎么调也不会等到别的东西，重试没有意义。

### E4 · `killed` / `cancelled` 的成员**跳过通知**（这是最坑的一条）

```js
scheduleTeamMemberNotification(t) {
  ...
  if ("killed" === t.status || "cancelled" === t.status)
    return void this.logger.debug(`Task ${t.id} status is ${t.status}, skipping notification`)
  ...
}
```

调度通知时，`killed` 与 `cancelled` **直接 return**，只留一条 debug 日志。所以「`TaskOutput` 说不等、inbox 会通知」这句提示在任务被杀的情况下是**不成立的**——通知不会来。转录里也确实从头到尾没有任何来自 `general-purpose-1` / `general-purpose-2` 的消息，与这条实现一致。

副产品：团队消息文案对 `killed` 的措辞是 `was stopped`：

```js
case "killed": i = `${n} was stopped`; break
```

### E5 · `kill()` 的语义

```js
async kill() {
  "completed" !== this.status && "failed" !== this.status && this.updateStatus("killed")
  this.abortController.abort()
  let t = this.subAgentSession?.abortController
  t && setTimeout(() => t.abort(), 0)
}
```

置终态后 abort 主控制器与子会话控制器——是真终止，不是状态标记。

### E6 · 自动团队的清理是**结果**，不是原因

```js
checkAutoTeamCompletion() {
  if (!this.autoTeamCleanupTimer && !(this.autoTeamCleanupDepth > 0)) try {
    let t = ContainerUtil.get(Q.TeamManager)
    if (!t.isInTeam() || !t.isAutoTeam()) return
    ...
    if (0 === p.size || p.getActive().length > 0) return
    let h = 1e4
    this.logger.info(`... All auto-team members finished, scheduling cleanup in ${h}ms`)
```

只在「有成员、且没有任何活跃成员」时才排 10 秒后销毁。所以它不会去杀正在跑的任务，可以排除。

### E7 · 存在子 agent 墙钟超时，但本次现象不符

```js
class SubagentWallClockTimeoutError extends Error {
  constructor(t, i) { super(`Sub-agent timed out after ${t}ms`, { cause: i }); this.name = p; this.timeoutMs = t }
}
```

超时会带 `Sub-agent timed out after <n>ms` 文案。本次是派生后几乎立刻读到终态，且错误文案不是超时，故排除此项。

## 未能证实

- **杀死这两个任务的确切触发点**。已定位的 kill 入口有：任务管理器的 `cancel()`、团队成员的 `killPhysicalTurn()`、以及用户中断路径（`Task was interrupted by user`）。但这两个 task id 在 `audit-log` 里查不到，运行时日志（含 `[cbc-kw=AGENT_TASK]` 前缀）本机未定位到，故不下结论。
- 是否为「同一会话并发派生两个后台成员」的固有问题，或与本次压缩后的会话状态有关，均未证实。

## 对环境的建议

1. **需要当轮结果的任务一律前台派生。** 后台派生的结果只能经 inbox 在**下一轮**到达；当轮没有受支持的阻塞取回通道（E2）。
2. **同一轮里需要两个 agent 的产出时，不要用后台**——`code-review` 的两个轴正属此类，其 SKILL.md 也已写明 `in the foreground`，照做即可。
3. **不要把 `killed` 当作"还没跑完"**。它是终态（E3）；且被杀的任务**不会**发通知（E4），静默失败。看到 `killed` 的正确处置是重新派生，而不是重试等待。
4. **权威副本落在本仓**：规则写进 `AGENTS.md` 工程规则（随仓库走、跨机器可用），详情就是本文件。机器本地的 `~/.workbuddy/skills/code-review/{SKILL,SUBAGENT-DISPATCH}.md` 只是本地加强，不随仓库走；`SOUL.md` 里那份临时副本已按用户决定移除，避免同一规则多处漂移。
