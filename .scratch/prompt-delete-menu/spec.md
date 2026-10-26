# `#chatgpt删除设定`：菜单选序号删除本地设定

## 事实基础

- `apps/prompts.js:61` 已有规则 `^#(chatgpt|ChatGPT)(删除|移除)设定` → `removePrompt`（:242）。
  现状把指令尾部直接当名字，不 trim、不校验、不确认；名字对不上时 `deleteOnePrompt` 的
  `fs.unlinkSync` 抛 ENOENT，被 `lib/plugins/loader.js:326` 写进控制台，会话里没有任何回复。
- 磁盘上只有 `<名字>.txt` 与可选的 `<名字>_example.json`；`deleteOnePrompt` 两者都删。
- `API默认` / `Sydney默认` 是 `listPrompts`/`detailPrompt` 拼出来的虚拟项，没有文件，不可删。
- 设定正文保存在 `Config` 的 provider 行，删文件不影响生效中的正文。redis 里那条名字记录
  `CHATGPT:PROMPT_USE_<协议>` 的唯一读者是已下线的 `uploadPrompt`，其写入已于本次同批移除（见文末），
  所以删除设定时既不用读它、也不用清它。

## 决定

**Q1 触发**：裸指令弹菜单；带名字（含 `移除` 别名）跳过菜单，但同样进确认；名字先 `trim`。

**Q2 确认**：与 `askBackupName` 同构的三岔口，正文预览 120 字。

```
即将删除设定「beta」，它当前的正文是：
<正文前 120 字>
回复 0 取消；回复 确定 或 删除 直接删除；
回复其它内容则先把该设定另存为新名字，再删除原件。
请在 60 秒内回复。
```

- 这条消息用 `e.reply(text, true, { recallMsg: 119 })`；菜单消息不加（`loader.js:475` 允许 0-120 秒）。
- 备份名规则沿用 `askBackupName`：去 `.txt` 后缀、非空、≤40 字、不含 `/ \ : * ? " < > |`、
  不以 `.` 开头、不与已有设定重名；任一不满足则整单取消。
- 备份先 `saveOnePrompt`，成功后才 `deleteOnePrompt`；备份失败不删原件。

**Q3 生效状态**：纯文件删除。不碰 `Config`，不碰 redis。菜单与确认里对当前生效的那条标
`（当前使用）`，并说明“删除后已生效的设定不会改变，只是列表里不再有它”。

**Q4 列表**：只列本地 `.txt`（`readPrompts()` 已按名字排序）；`（当前使用）` 由
`activePromptNames(row[PROMPT_FIELDS[row.type]], prompts)` 判定；超过 30 条追加
“也可直接发送 #chatgpt删除设定<设定名>”；末尾 `0. 取消`，同时接受 `取消` / `退出`。

**Q5 实现**：
- 重写 `removePrompt`，复用 `chooseFromMenu` 与 `utils/menu.js` 的 `requestBackupOrConfirm`。
- 把“确认 + 可选备份”的三岔口抽到 `utils/menu.js`（`askBackupName` 改为调用它），
  两处只有动作词、确认词与预览长度不同，取消词、超时、同发送者校验不再各写一份。
- 删除前用 `getPromptByName` 复检；仍 ENOENT 时回复“没有这个设定，可能刚被删除”，不抛栈。

## 边界

- 无默认模型（`resolveProvider()` 会抛“模型提供商未配置”）时**仍可删除**，只是没有 `（当前使用）` 标记；
  这条不能因为取不到当前设定就拦住删除。
- 文件在菜单→确认之间被删：复检失败，整单取消，不留备份、不谎报成功。
- 删除失败（权限、占用）：回报真实错误，不说“已删除”。
- 他人代答、超时、非主人：取消（`awaitOwnerReply` 既有行为）。
- 不删 `prompts/` 之外的东西；云端共享设定已下线，不在此列；`#chatgpt删除共享设定` 的规则不受影响。

## 验证

- `test/promptMenu.test.mjs` 增 13 例：序号删除、`0` 取消不删、带名字（含 `移除` 别名）跳过菜单但仍确认、
  `确定` 与 `删除` 都执行、其它内容先备份再删、非法/重名备份名取消且原件仍在、
  文件已消失时给出提示且不抛、`（当前使用）` 标记、删正在使用的设定时提示正文不变、
  超 30 条提示、非主人代答不删、无默认模型仍可删、确认消息带 `recallMsg: 119`。
- `npm run check`（语法预检 + 路径卫生 + 风格 + 快套件）。
- 文档：`apps/help.js`（`#chatgpt使用设定【设定名】` 那条下面）、`docs/agent-guides/testing.md`、
  `GLOSSARY.md` 新增「删除设定」。`resources/help.json` 已删除，Web 帮助页改由 `helpData` 提供，不再需要同步。

## 同批附带改动（2026-10-27 追加）

- 移除 `usePrompt` 对 `CHATGPT:PROMPT_USE_<协议>` 的写入：唯一读者 `uploadPrompt` 属已下线功能，
  该键再无消费方；`uploadPrompt` 里的读取保留，并注释说明它恒为 undefined，不能用来判断当前设定。
- `#chatgpt上传设定`、`#chatgpt设定列表`、`#chatgpt导入设定` 曾在 `apps/help.js` 与 `resources/help.json`
  标注「【暂不可用】」；后者已随帮助数据源迁移删除，`apps/help.js` 里这三条随后由主人自行注释掉，不再显示。
  代码入口的注释保留（上传/导入依赖已下线的云端设定站；设定列表只读本地文件，失败点待真实环境复现）。
