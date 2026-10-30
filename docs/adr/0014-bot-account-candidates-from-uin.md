# 锅巴的 Bot 账号候选取自宿主登录账号表，不取 Bot.bots 的键

状态：已采纳（2026-10-30）。起因与决策过程见 `.scratch/bot-reply-whitelist-candidates/spec.md`。

`Object.keys(Bot.bots)` 看起来就是「所有已注册账号」，实际混着非账号的键：TRSS 的 `Bot` 是 `new Proxy(this.bots, { get })`（`lib/bot.js`），只拦了读，没有 `set` 陷阱，于是任何 `Bot.xxx = …` 都写进 `bots`。面板因此把 `url`、`_events`、`_eventsCount`、`xiaofei_plugin` 当账号列出来——分别来自宿主 `Bot.run()` → `serverLoad()` 的 `this.url`、`Bot.on()` 的 `++this._eventsCount`、`Bot.off()` 移除最后一个监听时重设的 `_events`，以及 `xiaofei-plugin` 的 `Bot.xiaofei_plugin = {}`。

改以 `Bot.uin` 为准：它是宿主唯一表示「已登录账号」的表（`lib/events/connect.js` 与 OneBotv11 / Milky / Satori / ComWeChat 适配器都在账号连上来时往里追加，标准输入适配器走 connect 事件同一条路）。`eventBotId()` 回落时读的是事件上那个 Bot 实例的 `uin`——与这张表同值但不同源，面板要给的正是闸门能够对上的那组标识；`Bot.bots` 降级为取昵称与适配器名的标签来源。

## 考虑过的替代方案

- **按鸭子类型过滤 `Bot.bots`**（`typeof bot.pickFriend === 'function'` 或 `bot.adapter` 存在）：把「bot 长什么样」变成必须自己维护的判据，适配器换个字段就漏号；原版 Yunzai v3 下 `Bot.bots` 根本不存在，仍然要另写一条分支。
- **维护脏键黑名单**（`url`／`_events*`／已知插件名）：脏键由第三方插件随时新增，黑名单追不上。
- **在保存侧过滤「不像账号」的值**：账号标识形态不可穷举（微信是 `wx_xxx@im.wechat`），误杀一个真账号＝白名单非空时该号彻底静默，比多列一行脏值严重。

## 后果

- 原版 Yunzai v3 下面板候选退化成 `Bot.uin` 那一个值，标签只有账号本身（没有 `bots` 可取昵称）；此前这里是空列表，属于改善但不完整。
- 白名单里可能已存在的历史脏值不会被自动清理，仍以「（当前未登录）」显示；候选列表干净后不会再新增。
- 以后锅巴里任何「选账号」的字段都按这条来（见配置指南）：宿主对象上的键不等于账号。
