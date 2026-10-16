# research：NapCatQQ 的群公告读取实现与「读不了」归因

- 日期：2026-10-17
- 对象：本机 NapCatQQ 源码参考副本（本机路径不入库）—— commit `810052c6`（2026-10-15，`git describe` = `v4.18.38-2-g810052c6`，分支 main，remote `NapNeko/NapCatQQ`）
- 交叉核对：GitHub `NapNeko/NapCatQQ` main（线上检索，与本地一致，见 §5）
- 起因：chatgpt-plugin 群公告读工具「刚做完、实机测试读不了」，需要协议端一手事实

**一句话结论：NapCat 自 2024-08 起就实现了读群公告（动作名 `_get_group_notice`），与宿主 `OneBotv11.js` 绑定完全一致，且客户端对读动作没有任何角色 / 权限前置检查——所以「读不了」不是「协议端没实现」，只能在「服务端取数失败」「运行版本过旧（尤其 < v4.18.30 读不到『发给新成员』类公告）」「插件侧配置闸未开」三类里找；返回解析链路源码可证无缺。**

## 1. 完整调用链

宿主插件 → 适配器 → 协议端动作 → 核心 webapi，四段如下（相对路径）：

| 段 | 位置 | 事实 |
| --- | --- | --- |
| 插件工具 | `utils/tools/GetGroupNoticeTool.js:43` | `extractGroupList(await group.getNotice())`，无入参、只读当前群 |
| 宿主绑定 | `plugins/adapter/OneBotv11.js:683-688`（`getNotice` 别名在 `:1040`） | `sendApi("_get_group_notice", { group_id })`，**只传 `group_id`** |
| 动作路由 | `packages/napcat-onebot/action/router.ts:117` | `GoCQHTTP_GetGroupNotice: '_get_group_notice'` |
| 动作注册 | `packages/napcat-onebot/action/index.ts:45`（import）、`:276`（实例化） | 实例进 `_map`（`:373-377`，同时注册 `_async` / `_rate_limited` 变体） |
| 动作实现 | `packages/napcat-onebot/action/group/GetGroupNotice.ts:42-62` | `_handle` 调 `this.core.apis.WebApi.getGroupNotice(group)` |
| 核心实现 | `packages/napcat-core/apis/webapi.ts:242-265` | 走 **QQ 网页接口**（非 Oidb） |

**底层是什么**：`getGroupNotice` 不是 Oidb/trpc 包，而是一次 HTTP GET +
Cookie 鉴权（`webapi.ts:242-265`）：

- `webapi.ts:243`：`getCookies('qun.qq.com')` 取 Cookie；
- `webapi.ts:245-260`：`RequestUtil.HttpGetJson` 请求
  `https://web.qun.qq.com/cgi-bin/announce/get_t_list?...`；
- 组包参数（`webapi.ts:246-256`）：`bkn`（由 Cookie 算）、`qid=群号`、`ft=23`、`ni=1`、`n=1`、`i=1`、`log_read=1`、`platform=1`、`s=-1`，再拼 `&n=20`；
- `webapi.ts:261`：**`return ret?.ec === 0 ? ret : undefined`**；
- `webapi.ts:262-264`：异常一律 `catch → return undefined`。

即：**任何一步取数失败（未登录、Cookie/bkn 失效、服务端 `ec !== 0`、网络异常）都收敛成 `undefined`**，不区分原因。

## 2. 版本时间线

用 `git log --follow` 与 `git log -S` / `git blame`（对象为本机副本）得到：

| 事实 | commit | 日期 | 首次进入的 release tag |
| --- | --- | --- | --- |
| 动作名 `_get_group_notice` 在仓库最早出现 | `0835fa24` | 2024-04-28 | 早于模块化 |
| `action/group/GetGroupNotice.ts` 文件建立（原路径 `src/onebot/action/group/GetGroupNotice.ts`） | `086a6ad2` | 2024-08-09 | **v4.14.9** |
| 核心 `WebApi.getGroupNotice` 建立 | `bae6b2a7` | 2024-08-09 | v4.14.9 |
| `_handle` 现版主体（`core.apis.WebApi.getGroupNotice` + 抛错） | `2185a884` | 2025-11-03 | — |
| ReturnSchema 成型 | `e3801461` | 2026-01-27 | — |
| **新增 `inst`（「发给新成员」类公告）透传 + `send_to_new_member` / `pinned`** | `13a8a2b8` | 2026-10-05 | **v4.18.30** |

- 写动作同源：`SendGroupNotice` 与 `DelGroupNotice` 同样在 `086a6ad2`（2024-08-09）建立，与读动作同年同批，**读动作不比写动作晚**。
- `13a8a2b8` commit message（`git show -s`）：*「get_t_list 会把『发给新成员』类公告单独放在 inst 数组里，之前只遍历 feeds，这类公告（群规通常发在这里）完全拿不到」*，并标注 `Closes #2082`。

### 未注册动作的失败表现（同题材先例写法）

- WebSocket 正向/反向服务端：`napcat-onebot/network/websocket-server.ts:190-192`
  → `OB11Response.error('不支持的API ' + action, 1404, echo)`。
- HTTP-WebSocket 路径：`napcat-onebot/network/http-server.ts:237-240`（同样 `1404` + `不支持的API`）。
- HTTP-API 转发路径：`http-server.ts:267,294` → `retcode 200` + `'不支持的Api ' + actionName`（**注意小写 `Api`、retcode 200**）。
- WebUI 调试通道：`napcat-webui-backend/src/api/Debug.ts:180-181`。

即：在**未实现该动作**的 NapCat 上调用 `_get_group_notice`，得到 `status=failed, retcode=1404, message="不支持的API _get_group_notice"`；宿主 `OneBotv11.js:31-32` 对 `retcode !== 0 && !== 1` 直接 `throw`（取 `data.msg || data.wording`，NapCat 两者同值，见 `OneBotAction.ts:20-30`），**不会静默返回空**。

## 3. 接口契约

**入参**（`GetGroupNotice.ts:7-9`）：`PayloadSchema = Type.Object({ group_id: Type.String })` —— **只有 `group_id`**；无分页、无过滤、无 `s` 翻页参数（服务端固定取第一页 `&n=20`，`webapi.ts:256`；#2082 也点了「现状只取第一页」）。

**返回**（`GetGroupNotice.ts:13-26` ReturnSchema，逐条转换见 `:64-88`）：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `notice_id` | `feed.fid`（`:70`） | 字符串 |
| `sender_id` | `feed.u`（`:71`） | 发送者 QQ |
| `publish_time` | `feed.pubt`（`:72`） | 发布秒级时间戳 |
| `message.text` | `feed.msg.text`（`:74`） | 正文 |
| `message.image` / `images` | `feed.msg.pics` 映射为 `{id,height,width}`（`:65-67`），二者同值 | **图片只有 id/尺寸，没有 url** |
| `settings` | `feed.settings`（`:78`） | 原样透传 |
| `read_num` | `feed.read_num`（`:79`） | 可选 |
| `send_to_new_member` | 遍历来源标记（`:51,80`） | v4.18.30 起才有 |
| `pinned` | 仅 `inst.settings.inst_no_pinned === 0`（`:82-86`） | 仅「发给新成员」条目可读到 |

核心侧原始结构见 `packages/napcat-core/types/webapi.ts:58-86`（`WebApiGroupNoticeFeed`）与 `:88-105`（`WebApiGroupNoticeRet`）；`feeds` 在 `:95`，`inst?`（「发给新成员」类，注释在 `:96`）为可选。

**错误处理**（`GetGroupNotice.ts:44-47`）：`ret` 为 `undefined`（含取数为空 / `ec !== 0`）时 `throw new Error('获取公告失败')`；异常经 `OneBotAction.ts:104-116` 的 `websocketHandle` 转为 **retcode 1200** + `message='获取公告失败'`（HTTP 路径 `handle` 见 `:90-102`，retcode 200）。Schema 不符则 retcode 1400/400（`OneBotAction.ts:92-94,105-108`）。

**注意「空 vs 报错」的分界**：单页无公告（`feeds` 为空数组）会返回 `[]` → 插件显示「当前群没有群公告。」（不是错误）；只有取数整体失败才 `throw`。

## 4. 客户端权限前提

**读动作 `_get_group_notice`：源码中没有任何「Bot 是群主 / 管理员」或「调用者身份」的显式检查。** 由 `OneBotAction.handle/websocketHandle`（`OneBotAction.ts:90-116`）→ `GetGroupNotice._handle`（`:42-62`），除 Schema 校验外不做角色判断。**客户端不设前提，是否被拒由 QQ 服务端对 `get_t_list` 的应答决定，源码不体现。**

（对照：写动作 `SendGroupNotice` / `DelGroupNotice` 同样无显式角色检查，只组包 / 传参。）

## 5. 交叉核对（线上）

- **main 分支现状**：线上 `packages/napcat-onebot/action/group/GetGroupNotice.ts` 与本地副本**逐字一致**（同 ReturnSchema、同 `feeds` + `inst` 双遍历、同 `toNotice`），读取实现短期未变。
- **已知问题 / 修复记录**（有）：
  - Issue **#2082**（2026-10-04 开）*[BUG] _get_group_notice 取不到「发给新成员」公告的根因：get_t_list 的 inst 数组未被透传* —— 明确「同一群里不勾选该选项的公告正常返回」，并承接 #1503（#1505 只补了 `feeds` 的 `settings`，未触及 `inst`），指出「全仓库搜 `ret.inst` 截至 **v4.18.29** 零命中」「建议支持 `s` 翻页」。该问题由本地 `13a8a2b8` 修复，进入 **v4.18.30**。
  - 链接：https://github.com/NapNeko/NapCatQQ/issues/2082
- **其它核对**：OLIVOS 插件文档将「获取群公告」对 NapCat 标为支持（`group_id` 入参、`notice_id` 为字符串、`extra.notice_id_type='string'`）；NapCat Apifox 文档收录 `POST /_get_group_notice`；某第三方博客提到「`_get_group_notice` 曾存在获取失败的问题，现已修复」并称新增 `_del_group_notice`（均为线上旁证）。

## 6. 对 chatgpt-plugin 的影响

**动作名一致性：一致。** 宿主绑定的 `_get_group_notice`（`plugins/adapter/OneBotv11.js:685`）与 NapCat 路由（`router.ts:117`）+ 注册（`action/index.ts:276`）完全对齐，**不存在「调错动作名」的问题**。

**「实测读不了」候选原因（按优先级，逐条标注源码可否证实）：**

1. **服务端取数失败（最可能）** —— `webapi.ts:261` 对 `ec !== 0` 或任何异常返回 `undefined` → 动作抛 `'获取公告失败'`（`GetGroupNotice.ts:45-47`）→ 宿主抛 `wording`（`OneBotv11.js:31-32`）→ 插件 `groupToolFailure` 返回 `Error: 获取群公告失败：获取公告失败`（`GetGroupNoticeTool.js:46-48`、`groupAdminToolContext.js:117-120`）。
   *源码能证实「该失败路径存在」；不能证实这就是本次实测原因*（未登录 / Cookie-bkn 失效 / 服务端判权都会汇到同一条路径）。
2. **运行版本 < v4.18.30** —— 若当前群公告恰好都是「发给新成员」类，旧版只遍历 `feeds`（#2082 复现：`ret.inst` 在 v4.18.29 前零命中），`feeds` 为空 → 返回 `[]` → 插件显示「**当前群没有群公告。**」（**不是报错，最易被误读为「读不了」**）。
   *源码能证实旧行为（git 历史 `13a8a2b8` 前无 `inst`）；用户实际版本不能证实，需实机核对 `get_version_info`。*
3. **运行版本早于 2024-08-09 / 2024-04-28** —— 动作未注册 → `1404 不支持的API _get_group_notice` → 宿主抛错。
   *源码能证实 1404 机制（`websocket-server.ts:190-192` / `http-server.ts:237-240`）；但读动作存在已逾两年，此路径可能性最低。*
4. **返回解析** —— **源码可证伪，不是原因**：宿主 `sendApi` 成功时对 `data` 包一层「data 优先」Proxy（`OneBotv11.js:33-37`），插件 `extractGroupList` 对 `数组 / {data:[]} / {data:{data:[]}}` 三态都取到（`groupAdminToolContext.js:50-55`），测试桩 `makeApiProxy` 即复刻该形态（`test/groupAdminTools.test.js:37-40`）；且「接口失败」明确走 `Error:` 分支（同文件 `:190-196`）。仅当协议端返回非数组才失效。
5. **插件侧配置闸未开** —— 工具仅在 `Config.toolGroupAdminArr.includes('GroupNotice') && e?.isGroup` 时才广告给模型（`model/core.js:1132`），未开则模型根本看不到该工具，表现为「读不了」。
   *源码能证实闸存在；本次是否命中不能证实。*

**建议排障顺序**：先实机读 `get_version_info`（排除候选 2/3），再看 NapCat 日志里 `_get_group_notice` 的实际应答（`获取公告失败` → 候选 1；`不支持的API` → 候选 3；`[]` → 候选 2），最后核对插件开关（候选 5）。

## 未能证实

- 本次实机运行的具体 NapCat 版本与真实报错文本（本机副本只是参考；插件仓库内不含运行端版本信息）。
- QQ 服务端对 `get_t_list` 的实际放行条件（是否要求 Bot 在群内 / 是否限频），客户端源码不体现。
- `webapi.ts:261` 中 `ec !== 0` 的具体触发场景（Cookie 失效、风控、非群成员等无法从源码区分）。
- 其它协议端（Lagrange / LLOneBot / go-cqhttp）读群公告的可用性与字段差异（本机无副本；线上文档仅标「支持」，未逐字段核对）。
