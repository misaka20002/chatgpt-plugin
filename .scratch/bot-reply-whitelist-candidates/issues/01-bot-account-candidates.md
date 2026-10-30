# 01 锅巴候选改取宿主登录账号表，并补一条回归测试

Status: done
Type: task

需求与取舍：`.scratch/bot-reply-whitelist-candidates/spec.md`；机制证据与被否替代方案：`docs/adr/0014-bot-account-candidates-from-uin.md`。

## 任务

- 「Bot 响应白名单账号」的候选以宿主登录账号表为准，不再枚举 `Bot.bots` 的键；`Bot.bots` 只用于取昵称与适配器名拼标签。
- 原版 Yunzai v3（`uin` 是标量）退化成单账号候选；已保存但未登录的条目照旧补「（当前未登录）」。
- 补一条回归用例：污染过的 `bots`（`url` / `_events` / `_eventsCount` / `xiaofei_plugin`）不得出现在候选中，同时钉住标签格式、去重、离线补位与 v3 形态。

## 验收

- 面板只列真正的账号，标签仍是 `账号（昵称｜适配器名）`。
- 旧实现下新用例必失败（变异验证）。
- `npm run test:config` 全绿。
