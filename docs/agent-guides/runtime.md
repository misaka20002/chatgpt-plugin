# Yunzai 运行时与 Redis

[返回仓库指南](../../AGENTS.md)。只在任务涉及本主题时阅读；工程与验证规则以主指南为准。

本文代码路径均相对仓库根目录。历史用例编号、数据规模和平台现象用于解释约束，不是每次修改都要执行的检查清单；当前命令以 `package.json` 为准，环境现象需在当前机器核实。

## Redis 约定

- 业务态前缀 `CHATGPT:`：`CHATGPT:CONVERSATIONS:*`（会话）、`CHATGPT:USE`（当前模型）、`CHATGPT:MESSAGE*` 等。
- 记忆 V2 前缀 `CHATGPT:MEMORY:V2:`：`item:{id}`（记忆本体）、`idx:*/slot:*/grp:*`（索引）、`evd:{id}`（证据集）、`raw:*/rawIdx:*`（原文）、`task:{gid}:{day}`（提炼任务）、`policy:{gid}`（游标）。
- 旧记忆 Hash `CHATGPT:MEMORY:USER:*`：**只读用于清理**，首次 V2 写入即删，不要读取/展示其内容。
- **node-redis 4.7 API 注意**：`zAdd(key, { score, value })`（对象形式）；`hSet(key, obj)`；`scanIterator({ MATCH })`；`del(...keys)` 支持多键。
- **客户端 API 不等于服务端版本保证**：`zRange(..., { BY: 'SCORE', REV: true })` 发送的 `ZRANGE BYSCORE REV` 需要 Redis 6.2，6.0 会报整数范围错误。图谱的倒序时间查询用 `sendCommand(['ZREVRANGEBYSCORE', ...])` 保持 6.0 兼容，且仍带 `LIMIT`；node-redis v4 没有该旧命令的快捷方法。

## loader、定时任务与原子锁

- **TRSS loader 按 priority 升序调度**（数字小先执行），且任一插件 fnc 返回非 `false` 即 `return` 终结整条消息处理。观察器必须 priority 最小（-1011）先于 `chat.js`(1144) 采集，否则被终结漏采。原版 Yunzai 是降序，迁移时注意。
- **TRSS loader 匹配命令读的是「注册实例」的 `rule`**：`deal()` 里是 `for (const v of i.plugin.rule)`，而每条消息都 `Object.assign(new i.class(e), { e })` 新建副本——所以在插件方法里改 `this.rule` **完全无效**（改的是副本；加载期改的是 init 实例）。运行期新增/刷新命令必须回写注册条目：`import loader from '../../../lib/plugins/loader.js'`，在 `loader.priority` 里按 `i.class === 本类 || i.key.endsWith('本文件名')` 定位后 `entry.plugin.rule = rules`。`reg` 必须是 `RegExp`（`deal()` 不做字符串转换，只有 `loadPlugin()` 转一次）。热更新（chokidar 带 `?时间戳` 重新 import）会换掉类身份，定位别只靠 `i.class`；参考 `apps/派蒙meme.js` 的 `registerRules()`。
- **云崽的 redis 是 node-redis v4 的驼峰 API**（`hGet` / `hIncrBy` / `hGetAll` / `mGet`，写法是 `set(k, v, { EX: n })`）。需要原子锁就用 `set(k, v, { NX: true, EX: n })`：守卫选项名是大写 `NX: true`，**没抢到时返回 `null`**（`@redis/client` 的 `transformReply()` 声明就是 `… | null`），据此判断是否放行；不要写 `GET`→`SET` 两步（并发会一起通过），也不要用 `INCR` + `EXPIRE` 两步。
- **`loadPlugin()` 的顺序是 `new p()` → `await init.init()` → `new p()` 再 push 进 `priority`**：init() 执行期间本插件还没注册，此处的动态注册会「找不到条目」——不用补救，随后构造的注册实例会按当时的模块级状态生成 `rule`（这也是 `keyMap` 作为模块级变量在加载期可用的原因）。
- **TRSS loader 的定时任务 `task.fnc` 必须传函数引用**（如 `this.runDaily.bind(this)`），不能传方法名字符串：`loader.collectTask` 只校验 `i.cron && i.fnc` 后原样入队，`startTask` 直接 `await i.fnc()`，字符串会被当作函数调用报 `TypeError: i.fnc is not a function`。注册方式参考 `apps/ScheduleTaskPlugin.js` 等：把 `task` 放在构造函数体内（`super()` 之后赋值 `this.task`，此时才能 `bind(this)`），而不是塞进 `super({...})` 配置。注意消息路由的 `rule[].fnc` 仍是字符串（loader 用 `plugin[v.fnc](e)` 按名解析），二者约定不同，勿混淆。

## 群聊自主回复

- `apps/groupReply.js` 以 -1010 优先级观察并放行消息，`utils/groupReply.js` 按 Bot + 群隔离短期窗口和定时器。配置入口为锅巴“主动触发”分栏的 `groupReply`，Bot 主人也可在当前群使用 `#群聊自主回复开启` / `#群聊自主回复关闭`；开启会同步打开总开关，关闭只影响当前群并立即清理待回复缓存。群表格仅借用记忆采集的 GSubForm 写法，与记忆 V2 完全独立；旧 bym 插件、命令和面板入口已移除。
- 每条普通群消息更新窗口，按授权群表格中的 `debounceSeconds` 固定间隔合并判断一次，新消息不重置固定节拍，但到点后必须同时满足群内安静至少 10 秒，否则延后至最后一条消息满 10 秒再判断，不累积补跑；自身回显与指令也计入群内活动。没有新消息则跳过模型调用（各群独立，留空默认 60 秒，0 仅取消检查间隔，仍等待安静 10 秒，无配置上限；旧全局等待时间不再使用）；窗口默认 50 条，允许 20–500 条，每条文本上限 2000 字符，媒体仅提供类型。同群判断与回复串行，超过间隔时跳过错过的时点并沿原节拍继续；只从本批次候选中选择真实事件，一批最多回复一次。记录仅从启用后采集，不足时使用实际条数；无待判断消息的内存窗口闲置 30 分钟后清理，关闭群开关的缓存最多一分钟内释放。
- 每群 `enthusiasm` 为 1%～100%，默认 40%，不传给模型；模型返回 0～1 的 `confidence`（适合回复程度），代码要求其大于 0 且不低于 `1 - enthusiasm / 100`，不是随机概率；回复判断系统提示词仅使用代码内置内容，不提供锅巴或配置文件入口；旧 `decisionPrompt` / `systemPrompt` 忽略，并在正常保存配置时清除。
- 判断通过无 tools 的 `SubLLM` 执行；正式回复复用 `chatgpt_for_firstperson_call(e, { automatic: true })`，独立于第一人称开关，保留普通模式选择、黑白名单、Bot 拉黑与闭嘴；自主回复与直接 @、命令和名称呼叫共用发送者的用户限额（跨群共享，主人豁免，0 关闭）；判断前只读预筛超限用户，保留历史但排除候选，全部超限则不调用判断模型；正式回复仍计数并复查，防止判断期间额度被其他请求用完，超限后不转自主回复；正式回复按现有智能模式和 provider 配置使用工具，不额外禁用工具。
- 自主回复的引用仍绑定判断模型选中的原事件；正式回答按次启用群上下文，并从群内最新消息读取 `groupContextLength` 条记录（通过 Core 的 `settings.groupContextFromLatest` 传递），不以被引用的旧消息为截止点。普通直接呼叫仍遵循全局群上下文开关并从触发消息读取；判断窗口的 `groupReply.historyCount` 与正式回答记录条数独立。
- @机器人消息保留在短期历史中并更新群活动时间，但不加入自主回复候选；判断提示词只要求从候选中选择消息并结合完整历史理解上下文，允许自然衔接话题，不向模型解释限流或入口接管机制。
- 直接呼叫在进入普通对话时取消待判断窗口、作废正在运行的判断；同一消息的原事件、快照与窗口内重复事件共享回复归属。自主回复首次发送前同步占用归属，晚到的直接入口必须检查 `markHandled` 返回值并跳过；自主回复尚未发送时仍由直接呼叫优先接管。判断和每次实际发送前重新检查群开关与闭嘴状态；判断或生成期间出现普通群友消息不取消本轮判断、回复或后续分段，新消息在下轮安静后重新判断。每次模型判断结束用 `logger.info` 以 `[ChatGPT][自主回复]` 前缀记录 Bot、群号及准备回复、不回复、取消或失败；有效评分以百分比和比较符号显示评分、门槛与热情度，并记录候选编号。“准备回复”表示判断通过，不代表已经发送。判断失败、非法 JSON 或越界消息编号只记日志，不触发回复。
- 本地验证：`npm run test:group-reply`；配置及锅巴持久化验证：`npm run test:config`。真实 QQ 发送与锅巴页面交互仍需运行环境验证。

## 废弃接口

- **`utils/SydneyAIClient.js`（Bing / Sydney 接口）已废弃，以后都不要碰**：该接口已不可用，这个类在全仓库**没有任何实例化入口**（`apps/management.js:16` 里那行 `import SydneyAIClient from '../utils/SydneyAIClient.js'` 是未使用的，实际走 `client/CopilotAIClient.js` 的 `BingAIClient`）。它内部的 `Config.sydneyFirstMessageTimeout`（配置项已注释掉，值为 `undefined`）、`timeout` / `firstMessageTimeout` 等常量都属于历史遗留，**不要给它补超时、加功能、做重构，也不要因为审查它而改动**；那行未使用的 import 是有意留的，别顺手删。真要清理或删除这个类属于单独议题，先问用户。
