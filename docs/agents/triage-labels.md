# Triage Labels

本仓的“标签”不是 GitHub label，而是 `.scratch/` 文件里的 `Status:` 行——本地 markdown 追踪器没有 `gh label create` 可贴。triage 相关 skill 说的角色，对应到这张表的取值。

## 状态取值

| skill 里的角色 | 本仓取值 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 待维护者评估 |
| `needs-info` | `needs-info` | 等报告者补充信息；回复后回到 `needs-triage` |
| `ready-for-agent` | `ready-for-agent` | 规格完整，可交给离线 agent 实施 |
| `ready-for-human` | `ready-for-human` | 需人工实施（判断、外部权限、手工验证） |
| `wontfix` | `wontfix` | 不会实施；enhancement 需在 `.out-of-scope/` 留档 |
| ——（仓库本地） | `done` | 已交付并已合入 |

`done` 不在 canonical 五角色内：它是“已关闭”，不是 triage 状态。triage 见到 `done` 应视为已关闭，不再纳入三个待注意力桶。

## 书写与扫描规则

- 位置：`spec.md` 标题之后单独一行 `Status: <取值>（可选依据）`。
- 取值必须来自上表；括号里写依据（commit、日期、阻塞原因），不要写拉长状态的形容词。
- 一份 spec 里若“已交付”与“已放弃”并存，spec 本身记 `done`，另起一行写 `<子项>：<取值> —— 原因`。不要加第二个 `Status:`。
- `- 状态：**已交付**` 这类自然语言写法已废弃：机器扫不到，历史文件按需迁移。
- ticket 文件（`.scratch/<feature>/issues/NN-*.md`）用同一张表。
