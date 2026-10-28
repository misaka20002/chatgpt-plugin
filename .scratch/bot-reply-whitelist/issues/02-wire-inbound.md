# 02 接入入站四处

Type: task
Blocked by: 01
Status: done

把判定接到四个入站点：直接对话、第一人称呼叫（与自主回复共用）、其他模式的共同出口、自主回复的候选准入。

不放在抽象对话层：定时任务也走那里，放进去会连定时任务一起掐掉（见 ADR 0011）。

## Answer

- `apps/chat.js` 的 `chatgpt()`：插在 at / #chat 决议之后、`groupId` 之前，避免 at 全量正则导致逐条消息打日志。
- `apps/chat.js` 的 `chatgpt_for_firstperson_call()`：按 `automatic` 区分「自主回复 / 第一人称呼叫」。
- `apps/chat.js` 的 `otherMode()`：`#chat1` / `#chatglm` / `#claude` / `#gemini` 的兼容入口。**这几个方法目前没有 rule 接线**（已不挂规则，也没有按钮派发），闸门留在这里只为它们哪天恢复时不必再补，不是当前生效的覆盖面。
- `utils/groupReply.js` 的 `authorized()`：静默判定，名单外账号不进候选、不跑判断模型。

验证：`npm run check` 全绿；`utils/groupReply.js` 相关套件（`test:group-reply`）随 check 通过。
