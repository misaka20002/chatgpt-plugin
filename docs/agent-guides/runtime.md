# Yunzai 运行时与 Redis

[返回仓库指南](../../AGENTS.md)。只在任务涉及本主题时阅读；工程与验证规则以主指南为准。

本文代码路径均相对仓库根目录。历史用例编号、数据规模和平台现象用于解释约束，不是每次修改都要执行的检查清单；当前命令以 `package.json` 为准，环境现象需在当前机器核实。

## Redis 约定

- 业务态前缀 `CHATGPT:`：`CHATGPT:CONVERSATIONS:*`（会话）、`CHATGPT:USE`（当前模型）、`CHATGPT:MESSAGE*` 等。
- 记忆 V2 前缀 `CHATGPT:MEMORY:V2:`：`item:{id}`（记忆本体）、`idx:*/slot:*/grp:*`（索引）、`evd:{id}`（证据集）、`raw:*/rawIdx:*`（原文）、`task:{gid}:{day}`（提炼任务）、`policy:{gid}`（游标）。
- 旧记忆 Hash `CHATGPT:MEMORY:USER:*`：**只读用于清理**，首次 V2 写入即删，不要读取/展示其内容。
- **node-redis 4.7 API 注意**：`zAdd(key, { score, value })`（对象形式）；`hSet(key, obj)`；`scanIterator({ MATCH })`；`del(...keys)` 支持多键。

## loader、定时任务与原子锁

- **TRSS loader 按 priority 升序调度**（数字小先执行），且任一插件 fnc 返回非 `false` 即 `return` 终结整条消息处理。观察器必须 priority 最小（-1011）先于 `chat.js`(1144) 采集，否则被终结漏采。原版 Yunzai 是降序，迁移时注意。
- **TRSS loader 匹配命令读的是「注册实例」的 `rule`**：`deal()` 里是 `for (const v of i.plugin.rule)`，而每条消息都 `Object.assign(new i.class(e), { e })` 新建副本——所以在插件方法里改 `this.rule` **完全无效**（改的是副本；加载期改的是 init 实例）。运行期新增/刷新命令必须回写注册条目：`import loader from '../../../lib/plugins/loader.js'`，在 `loader.priority` 里按 `i.class === 本类 || i.key.endsWith('本文件名')` 定位后 `entry.plugin.rule = rules`。`reg` 必须是 `RegExp`（`deal()` 不做字符串转换，只有 `loadPlugin()` 转一次）。热更新（chokidar 带 `?时间戳` 重新 import）会换掉类身份，定位别只靠 `i.class`；参考 `apps/派蒙meme.js` 的 `registerRules()`。
- **云崽的 redis 是 node-redis v4 的驼峰 API**（`hGet` / `hIncrBy` / `hGetAll` / `mGet`，写法是 `set(k, v, { EX: n })`）。需要原子锁就用 `set(k, v, { NX: true, EX: n })`：守卫选项名是大写 `NX: true`，**没抢到时返回 `null`**（`@redis/client` 的 `transformReply()` 声明就是 `… | null`），据此判断是否放行；不要写 `GET`→`SET` 两步（并发会一起通过），也不要用 `INCR` + `EXPIRE` 两步。
- **`loadPlugin()` 的顺序是 `new p()` → `await init.init()` → `new p()` 再 push 进 `priority`**：init() 执行期间本插件还没注册，此处的动态注册会「找不到条目」——不用补救，随后构造的注册实例会按当时的模块级状态生成 `rule`（这也是 `keyMap` 作为模块级变量在加载期可用的原因）。
- **TRSS loader 的定时任务 `task.fnc` 必须传函数引用**（如 `this.runDaily.bind(this)`），不能传方法名字符串：`loader.collectTask` 只校验 `i.cron && i.fnc` 后原样入队，`startTask` 直接 `await i.fnc()`，字符串会被当作函数调用报 `TypeError: i.fnc is not a function`。注册方式参考 `apps/ScheduleTaskPlugin.js` 等：把 `task` 放在构造函数体内（`super()` 之后赋值 `this.task`，此时才能 `bind(this)`），而不是塞进 `super({...})` 配置。注意消息路由的 `rule[].fnc` 仍是字符串（loader 用 `plugin[v.fnc](e)` 按名解析），二者约定不同，勿混淆。

## 废弃接口

- **`utils/SydneyAIClient.js`（Bing / Sydney 接口）已废弃，以后都不要碰**：该接口已不可用，这个类在全仓库**没有任何实例化入口**（`apps/management.js:16` 里那行 `import SydneyAIClient from '../utils/SydneyAIClient.js'` 是未使用的，实际走 `client/CopilotAIClient.js` 的 `BingAIClient`）。它内部的 `Config.sydneyFirstMessageTimeout`（配置项已注释掉，值为 `undefined`）、`timeout` / `firstMessageTimeout` 等常量都属于历史遗留，**不要给它补超时、加功能、做重构，也不要因为审查它而改动**；那行未使用的 import 是有意留的，别顺手删。真要清理或删除这个类属于单独议题，先问用户。
