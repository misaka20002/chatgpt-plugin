# 宿主契约与本机环境事实

[返回仓库指南](../../AGENTS.md)。只在任务涉及「插件与框架怎么交互」或「在这台机器上部署/排障」时阅读；工程与验证规则以主指南为准。

本文只记**固定事实**：会随版本漂移的细节不写，命令以 `package.json` 为准，环境现象需在当前机器核实。

## 一、框架契约（TRSS-Yunzai）

这些是宿主代码里写死的行为，不是约定。踩过一次就够了。

### 事件的只读字段：不能赋值，只能造影子

- `lib/bot.js` 用 `Object.defineProperty(data, "member", { value })` 定义群成员——**不可写、不可配置**。
- `lib/plugins/loader.js` 用 `{ value, writable: false, configurable: false }` 定义 `isMaster`——同样不可写、不可配置。
- 直接 `e.member = x` / `e.isMaster = true` 必抛 `TypeError: Cannot assign to read only property 'member'`。
- 要换身份只能造影子事件：`Object.create(e)` 建一层原型对象，把身份字段定义成**自己的**属性，其余读取穿透回原事件。参见 `utils/commandMap/execute.js` 的 `switchIdentity()`。
- **测试必须用共享夹具** `test/helpers/trssEvent.mjs`：夹具一旦把 `isMaster` 写成普通属性，测试照样「通过」，线上却崩。`test/lint.check.mjs` 规则 8 会拦住手搓身份字段的写法。

### 消息分发的顺序：先 accept，再按规则匹配

`loader.deal(e)` 的顺序是：

1. 黑名单 / 冷却 / `dealEvent(e)`——**`e.msg` 在这里由 `e.message` 的 text 段重建**（框架不看 at 段的 text）。
2. 插件启用状态与事件过滤，得到本次的 `priority` 链。
3. 上下文 hook。
4. `only_reply_at` 检查：不通过就直接返回——代执行必须显式置 `e.only_reply_at = true`。
5. **accept 阶段**：逐个插件调 `accept(e)`。返回 `"return"` 终止整条处理；返回真值则跳出 accept 循环。
6. 规则匹配：按 priority 升序遍历，命中后调 `plugin[rule.fnc](e)`；**返回 `false` 表示「这条我不处理」，框架会继续找下一条匹配规则**；处理完就 `return`。
7. 插件抛出的异常**被框架吞掉**（只写日志），不会抛给调用方。

三条由此推出的结论：

- **accept 阶段会改写 `e.msg`**。这是插件之间的约定（例：某游戏插件把「点赞」当角色别名，看到就把 `#点赞` 改写成 `#角色详情`）。对真人消息合理，对代执行是劫持——代执行给的写法来自能力地图，本身已是规范写法，所以要挡住改写。做法见 `utils/commandMap/execute.js` 的 `guardAccept()`：派发期间临时包一层 `accept`，原 accept 照跑，但改写了 `e.msg` 就还原，并撤销它对这条消息的「抢占」。
- **「派发成功」不等于「办成了」**。插件返回 `false`（换下一条）或抛异常（被吞掉），在派发层面都看不出来。判断成功与否要看**插件有没有回话**。`utils/commandMap/execute.js` 用计数 `e.reply` 来判定，失败原因分 `not-found` / `no-permission` / `no-effect` / `handler-error`。
- **重造一套分发必然与框架分叉**：框架会按插件启用状态与事件类型过滤，还会跳过某些插件注册的空正则规则。自己遍历 `loader.priority` 匹配曾把指令派给了不相干的插件。正确做法是把伪造好的消息**交回框架的 `deal()`**。

### 日志通道

| 等级 | 去向 | 落文件？ |
| --- | --- | --- |
| `logger.info` / `debug` / `trace` | stdout | 否 |
| `logger.mark` / `warn` | `logs/command.<YYYY-MM-DD>.log` | 是 |
| `logger.error` / `fatal` | `logs/error.log` | 是 |

- 所以「工具调用/返回」这类 INFO 级日志**默认不落文件**。插件额外把工具调用写一份脱敏记录到 `data/chatgpt/diag/tool-calls.log`（见 `utils/toolCallLog.js`），排障看它，不必往生产代码里插临时探针。
- `logs/command.<date>.log` 经常被直接发到群里排障，**明文参数不能进那里**（见 ADR-0002）。

### 多账号与适配器：谁是谁

TRSS 一个进程可以挂多个账号，下面几个字段容易混：

| 字段 | 是什么 |
| --- | --- |
| `Bot.bots[self_id]` | 账号实例。`.adapter` 指向适配器实例（含 `id` / `name` / `path`），`.info.nickname` 是登录昵称 |
| `Bot.uin` | TRSS 下是**数组**（所有已登录的 `self_id`），带自定义 `toString` / `toJSON`；非 TRSS 是单值 |
| `Bot.adapter` | **适配器实例**数组（`OneBotv11` / `Milky` / `Satori` / `stdin` / `ComWeChat`），不是账号；各适配器用 `Bot.adapter.push(new …)` 注册 |
| 事件上的 `adapter_id` / `adapter_name` | 宿主 `prepareEvent` 从 `data.bot.adapter` 抄到事件上；插件侧目前没有使用 |

- `utils/bot.js` 的 `getBots()` 把 `Bot.adapter` 的元素当 uin 去 `Bot[uin]`，取到的是 `undefined`——既有缺陷，枚举账号别复用它。
- 账号级判断一律用事件自带的 `e.self_id`；`Config.trssBotUin` 只影响 `getUin(e)` 的返回值，不是准入开关。

## 二、本机部署事实（家里云 HomeCLOUD）

以下针对本机成立，换机器要重新核实。

| 事项 | 结论 |
| --- | --- |
| 主机 | `HomeCLOUD`，Debian 13。SSH 入口 `ssh homecloud`（192.168.1.12，root，免密）。`192.168.10.187` 不通——小米路由切模式时服务器网段会跳 |
| 编排 | `trss-allbot.service` = `docker compose up` + `Restart=always`。**重启只能用 `systemctl restart trss-allbot`**；`docker restart TRSS_AllBot` 会让容器被销毁重建 |
| 容器 | 容器名 `TRSS_AllBot`；compose 在 `/root/trss-allbot/docker-compose.yml`，`tty: true` + `stdin_open: true` |
| 路径映射 | 宿主 `/mnt/hdd/TRSS_AllBot` ↔ 容器内 `/root/TRSS_AllBot`。插件目录：宿主 `/mnt/hdd/TRSS_AllBot/TRSS-Yunzai/plugins/<插件>` |
| 应用日志 | 宿主 `/mnt/hdd/TRSS_AllBot/TRSS-Yunzai/logs/command.<YYYY-MM-DD>.log` 与 `error.log` |
| 控制台 | **抓不到**。启动走 dialog 全屏 TUI，应用 stdout 落在 dialog 开的 pty 上；`docker logs TRSS_AllBot` 实测只有 314 字节（启动脚本那几行）。不要用 `docker logs` 找应用输出 |
| 插件依赖 | TRSS-Yunzai 根目录已带 `sharp ^0.33.5`，插件目录里的 `import("sharp")` 会向上解析到它，不必单独装 |
| 远端传文件 | 中文与引号经 ssh 容易被吃掉，**用 base64 传**：`base64 -w0 本地文件` → 远端 `echo <b64> | base64 -d > 目标` |

## 三、本机开发机（Windows / Git Bash）

以下只在开发机上跑 git 时成立，家里云容器里不适用。

- `git rev-parse --short` 只接受单参数（多参数报 `Needed a single revision`）。
- `git grep` 没有 `--branches` / `--remotes`，要逐 ref 循环查。
- `ref:path` 形式的参数（`git show` / `cat-file` / `ls-tree` / `diff`）先加 `MSYS_NO_PATHCONV=1`：不设时 Git Bash 的路径转换会改写参数——`show` 报 ambiguous argument，`cat-file -e` 这类探测还会给出假的「不存在」。结论是否定或异常时，先怀疑它。
- 对比新生成文件用 `--ignore-cr-at-eol`；全仓搜索排除 `server/static`（打包产物）。

## 四、这套事实怎么用

- 改「插件与框架交互」的代码前，先读第一节；第一节的每条都能在宿主 `lib/` 里指到出处。
- 在这台机器上部署或排障前，先读第二节；第二节的每条都实测过。
- 在开发机上跑 git 前读第三节；容器里不适用。
- 详细的诊断命令与故障对策表在 WorkBuddy 侧的 skill `homecloud-yunzai-diag`。
