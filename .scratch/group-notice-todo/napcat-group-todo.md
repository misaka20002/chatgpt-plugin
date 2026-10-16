# research：NapCatQQ 的群待办接口实现与权限前提

- 日期：2026-10-17（执行于 10-16 深夜，前台完成）
- 对象：本机 NapCatQQ 源码参考副本（本机路径不入库）—— commit `810052c6`（2026-10-15，`git describe` = `v4.18.38-2-g810052c6`，分支 main，remote `NapNeko/NapCatQQ`）
- 交叉核对：GitHub `NapNeko/NapCatQQ` main（10-16 线上检索，与本地一致）
- 起因：chatgpt-plugin 群待办工具「读取放开」评审需要协议端一手事实

**一句话结论：这份 NapCat 只实现 `set / complete / cancel` 三个写动作，没有 `get_group_todo_list` 读取实现；三个动作在客户端（OneBot 动作层与协议层）均无任何角色 / 权限前置检查；调用未注册动作会得到 `retcode 1404「不支持的API」`。**

## 1. 四个动作逐一核对

| OneBot 动作 | 本地副本 | 证据 |
| --- | --- | --- |
| `get_group_todo_list` | **不存在** | `router.ts` 无映射；全仓库检索 `group_todo` 仅命中三个写动作；无对应 action / transformer 文件 |
| `set_group_todo` | 存在 | `packages/napcat-onebot/action/router.ts:34` → `action/packet/SetGroupTodo.ts`；协议包 `OidbSvcTrpcTcp.0xF90` cmd=1（`packages/napcat-core/packet/transformer/action/SetGroupTodo.ts:12`） |
| `complete_group_todo` | 存在 | `router.ts:35`；`0xF90` cmd=2（`…/CompleteGroupTodo.ts:12`） |
| `cancel_group_todo` | 存在 | `router.ts:36`；`0xF90` cmd=3（`…/CancelGroupTodo.ts:12`） |

检索范围（排除 node_modules）：`**/*Todo*` 全仓库；`group_todo` 全仓库；`packages/napcat-onebot/action/`；`packages/napcat-core/packet/transformer/`。

## 2. 权限前提（逐个动作）

- **三个写动作**：OneBot 动作层 `BaseGroupTodoAction._handle` 只做「`message_id` / `message_seq` → `msgSeq`」解析（`action/packet/BaseGroupTodoAction.ts:21-39`）；协议层 transformer 只组包发送。**均无「Bot 是群主 / 管理员」或「调用者身份」的显式检查** —— 客户端不设前提，是否被拒由 QQ 服务端对 Oidb 的应答决定，源码中不体现。
- **读取动作**：不存在，无权限可谈。

## 3. 未知动作的失败表现

`OB11Response.error('不支持的API ' + action, 1404, echo)` —— 见 `napcat-onebot/network/websocket-server.ts:191-192`、`websocket-client.ts:153-154`、`http-server.ts:239-240,294`。

即：在未实现 `get_group_todo_list` 的 NapCat 上调用它，返回 `status=failed, retcode=1404`，message 为「不支持的API get_group_todo_list」。

宿主侧（`plugins/adapter/OneBotv11.js:31-32`，相对宿主仓库根）对 `retcode !== 0 && !== 1` 的应答是 **throw**（`Bot.makeError`）—— 插件工具最终呈现为 `Error: 群待办操作失败：…`，**不会静默返回空列表**。

## 4. 与宿主适配器的交集

宿主的四个绑定全部只在 `plugins/adapter/OneBotv11.js`（857-887、1011-1014 行）；其余适配器（Milky / ComWeChat / GSUIDCore / OPQBot / Satori / stdin）均无待办绑定。

| 宿主绑定 | 在本地这份 NapCat 上 |
| --- | --- |
| `getTodoList`（`get_group_todo_list`） | **不可用**（1404 不支持） |
| `setTodo` / `completeTodo` / `cancelTodo` | 客户端可用；QQ 服务端是否放行取决于 Bot 侧群权限，源码不体现 |

## 5. 文档

源码内只有动作摘要文案（如 `SetGroupTodo.ts:6-7`「设置群待办」），README / docs / 注释均未见到群待办接口的权限说明（检索词：待办 / todo / group_todo）。

## 6. 对 chatgpt-plugin 的影响

- 新读工具 `getGroupTodoList` 在 NapCat 后端上会以 1404 失败 —— 读取可用性取决于协议端是否实现该扩展接口：SnowLuma 文档收录了 `get_group_todo_list`（标注只读、未注明权限要求）；Lagrange.Core 有对应读取服务 `OidbSvcTrpcTcp.0xf8e_1`（均为线上核查，非本地副本，需实机验证）。
- 按仓库既有契约：不支持时如实报 `Error:`，不做特性探测；本文供 spec「已知边界」引用。
- 插件保留的「Bot 是群管 + 提问者群管 / 主人」写档位属于插件自身政策，与 NapCat 客户端实现无关。

## 未能证实

- QQ 服务端对三个写动作的实际权限要求（客户端源码不体现；需真实群实测）。
- Lagrange / 其它协议端的读取可用性与权限前提（本地无副本；仅线上抽查，需实机验证）。
