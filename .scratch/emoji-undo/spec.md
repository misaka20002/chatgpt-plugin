# spec：偷图撤销（`#gpt撤销偷图`）+ 偷图提示文本

- 状态：**已交付**（2026-10-17，未提交）
- 决策来源：2026-10-17 一轮问答（Q1–Q6），用户答复「全部按照推荐」
- 相关文档：`GLOSSARY.md`（新增「偷图回执」）

## 背景

`#gpt偷图`（`apps/tts_voice_help.js` 的 `save_EmojiImg`）让模型从 20 个情绪分类里挑一个，把引用/同发的图片存进 `data/chatgpt/sendEmojiTool/<emotion>/`，供 `EmojiTool`（`sendEmoji`）随机取用。两个缺口：

1. 模型选的文件夹不合心意时无法回滚，只能手动去删文件。
2. 指令之后不能补充说明，模型只能看图片本身判断。

## 决策口径

| # | 决策 | 结论 |
| --- | --- | --- |
| Q1 | 重复偷同一张图后撤销 | `reNameAndSavePic` 额外报告「本次是否新写入」；记录带 `isNew`。撤销只删 `isNew=true` 的文件；`isNew=false` 只清记录并告知「之前就在库里，没删」 |
| Q2 | 提示与图片冲突 | 提示优先：提示里点名的情绪压过模型观感；提示只有角色名/描述时按图片判断；提示与图片无关时忽略 |
| Q3 | 撤销权限 | 仅主人（与偷图同 `permission: 'master'`），不记发起人 `user_id` |
| Q4 | 引用消息多张图 | 维持只存 `e.img[0]`，一条回执对应一个文件 |
| Q5 | 撤销后原回执 | 不撤回、不编辑；重复撤销提示「没找到这条偷图记录（可能已过期或已撤销）」 |
| Q6 | 提示行显示条件 | 成功回执常显提示行（见「偏差」） |

补充细节（原定「下一轮再定」，按推荐口径直接定）：

- 撤销键：`CHATGPT:EMOJI_UNDO:<会话>_<msgId>`（段名全大写，与 `CHATGPT:MEMORY:V2:` 等既有键一致），会话取 `e.group_id || 8888`（宿主私聊伪群号）。键已登记在 `docs/agent-guides/runtime.md` 的「Redis 约定」。
- 键值：`{"path":"<绝对路径>","emotion":"<分类>","isNew":true|false}`。TTL 14 天（`EX`，node-redis v4 驼峰写法）。
- 撤销别名：只做 `#gpt撤销偷图` / `#gpt撤销偷表情包`，不加 `取消`。
- 提示文本上限 100 字（`.trim().slice(0, 100)`），超长截断不报错。
- 中文标签表（`saveEmojiEmotionZh`）**只用于拼识图提示词**，让模型知道 `confused` 对应「困惑/疑惑」；代码不做中文→英文的解析或映射，分类判定与校验一律用英文枚举。分类集合直接复用 `EmojiTool.emotions`（`sendEmoji` 工具的唯一来源），不再另抄一份。
- 回执缺消息 id 时：照常回执、照常存图，`logger.warn` 记一条，撤销不可用（键写不出来）。
- 删除目标校验：记录路径必须落在 `data/chatgpt/sendEmojiTool` 之内（`path.relative` 判越界），越界或指向根目录本身时只记 error 并拒绝删除。

## 偏差记录

**Q6 的推荐（只在记录写成功时显示提示行）单条消息内不可实现**：消息 id 是 `e.reply()` 的返回值，发出去之后才存在，无法决定这条消息里写不写提示行。实测取舍：提示行对每条成功回执常显（也正是需求原文的形态）；记录写入失败的极少情况靠 warn 日志暴露，用户引用后得到「没找到这条偷图记录」。

## 行为契约

| 场景 | 行为 |
| --- | --- |
| `#gpt偷图`（引用图片） | 与现状一致；识图 `prompt` 由原先的 `e.msg`（`#gpt偷图`）改为固定中性文本，模型不再被命令字干扰 |
| `#gpt偷图 派蒙 困惑` | 提示 `派蒙 困惑` 作为识图 `prompt`；系统提示词要求「点名情绪即采用」，分类稳定落到 `confused` |
| 图片已存在同分类文件夹 | 回执照常，记录 `isNew=false`；撤销只清记录 |
| `#gpt撤销偷图`（引用回执） | 删除文件 + 清记录 + 回执 `已撤销：已从 [cute] 文件夹移除该图片~` |
| `#gpt撤销偷图`（引用已被删的回执） | 清记录 + `记录已清理：这张图已经不在 [cute] 文件夹里了~` |
| `#gpt撤销偷图`（记录不存在/过期） | `没找到这条偷图记录（可能已过期或已撤销）`，不动文件 |
| `#gpt撤销偷图`（没引用） | `请引用「偷图成功」那条回复后再发送该指令` |
| 删除失败（权限/占用） | 保留记录、回执 `撤销失败：<err>`，可重试 |
| 记录 JSON 损坏 | 保留记录、记 error、告知记录损坏 |

## 非目标

- 一次偷多张图（`e.img` 取全部）。
- 撤销时撤回原回执消息。
- 非主人撤销、按发起人校验。
- 清理空情绪文件夹（`EmojiTool` 启动时会预建 20 个，删空目录没有收益）。

## 验证计划

1. `node --check apps/tts_voice_help.js`。
2. 新增 `test/emojiUndo.test.mjs`（`--experimental-test-module-mocks`）：只 mock 宿主边界（插件基类、`utils/common.js`、`utils/tts.js`、`utils/paimonFuction.js`、`utils/config.js`、`node-fetch`），执行真实的 `save_EmojiImg` / `undo_EmojiImg` / `reNameAndSavePic`。覆盖：提示进 `prompt`、系统提示词含提示规则、回执四行文案、键格式与 TTL、`isNew` 去重、撤销删文件、`isNew=false` 不删、记录缺失、未引用、越界路径。
3. `npm run check`（语法预检 + 路径卫生 + 快套件）。

## 验证结果

- `node --check apps/tts_voice_help.js`：通过。
- `npm run test:emoji`：**13/13** 通过（规则归属、提示进 prompt、回执文案、14 天 TTL、去重与 `isNew`、删文件、只清记录、找不到记录、未引用、越界拒绝、私聊 8888、`reply_id` 兜底、`data.message_id` 兜底、缺消息 id 只 warn）。
- `node test/checkSyntax.mjs`：291 文件通过；`node test/pathLeak.check.mjs`：326 文件通过。
- **`npm run check` 退出码 0**（修复基线红之后跑通整条链）：test:config 33/33、test:providers 38/38、test:thinking 8/8 + toolRoundTextForward 5/5、test:emoji 13/13。
- 基线红的原因与修复：提交 `33b6e37` 把 `note` 字段的组件改成 `InputTextArea`，`test/configBaseUrl.test.js:149` 仍断言 `'Input'`；CI 同一步骤同样失败（run `39029938846`，`not ok 8`），与本次功能改动无关。本 spec 顺手把断言对齐到 `InputTextArea`，使门禁恢复绿色——否则 `check` 的 `&&` 链会挡掉其后的所有套件（含新增的 test:emoji）。
- 真实链路：`msgRet.seq || msgRet.data?.message_id` 的写入口径由主人手工调试验证（TRSS-Yunzai 与 Miao-Yunzai 通用；Miao 已不再使用，不为其差异做兼容），见 `docs/agent-guides/runtime.md`「消息 id 与引用」。

## 评审处置（2026-10-17 两轴评审后）

**已改**

- 文档同步：`AGENTS.md` 入口清单、`docs/agent-guides/testing.md`（CI 套件列表 + 新增 test:emoji 说明条目）、`docs/agent-guides/runtime.md` Redis 约定登记 `CHATGPT:EMOJI_UNDO:`。
- 键名改为全大写段 `CHATGPT:EMOJI_UNDO:`（与既有键风格一致）。
- 分类清单复用 `EmojiTool.emotions`，删除本地副本；提示词拼装对缺失中文标签做了兜底。
- 偷图指令正则提为模块常量 `stealEmojiCommandReg`，规则注册、JSDoc、提示提取共用一处。
- 越界校验补 `!relative`：记录指向表情库根目录本身时也拒绝，避免 unlink 目录后陷入「撤销失败但记录还在」的死循环。
- 测试不再用 sha256 复刻文件命名，改为断言记录中的路径落在对应分类目录且真实存在；新增 `data.message_id` 兜底用例。

**按用户口径保留（不改）**

- **假成功回执**：`redis.set` 失败时用户已收到「可引用该回复后: #gpt撤销偷图」。Q6 已定提示行常显——消息 id 只有发出去后才存在，单条消息内无法预先判断；失败在用户真正执行撤销时以「没找到这条偷图记录」告知。
- **消息 id 口径不做双写**：写入口径 `msgRet.seq || msgRet.data?.message_id` 由主人手工调试确认（TRSS 与 Miao 通用，本项目只管 TRSS）。宿主 `e.source.seq` 装的是 reply 段的 message id，读取侧按 `e.source.seq / e.reply_id` 探测即可命中；不额外多写一个键。

## retro 处置（2026-10-18）

- 修掉基线红：`test/configBaseUrl.test.js` 的 `note` 组件断言对齐 `InputTextArea`，`npm run check` 恢复退出码 0；此前该红会挡掉链上所有后续套件。
- `docs/agent-guides/runtime.md` 新增「消息 id 与引用」：`e.source.seq` 的真实来源、`msgRet.seq || msgRet.data?.message_id` 的通用口径、键里带会话标识。
- 文档不再复述 `package.json` 的套件枚举（`AGENTS.md`、`testing.md` 改为指针），避免每加一个 `test:*` 就要手改两处。
- `AGENTS.md`：`ref:path` 形式的 `MSYS_NO_PATHCONV=1` 从 `git show` 扩到 `show` / `cat-file` / `ls-tree` / `diff`（本次 `cat-file -e` 曾给出假的「不存在」）；路径表补 `apps/tts_voice_help.js` 一行。

## 风险

- 引用消息 id 的字段随适配器而异：写入取 `msgRet.seq || msgRet.data?.message_id || msgRet.message_id`，读取依次探测 `e.source.seq` / `e.reply_id` / `e.source.message_id`。写入口径由主人在 TRSS 上手工验证，群聊与私聊（伪群号 8888）均按此实现；三路探测都未命中时表现为「撤销找不到记录」，重发一次偷图即可恢复。
- **`isNew` 去重的实际覆盖面比 Q1 假设的窄**：文件名是图片 URL 的 sha256，而 QQ 图片地址带时效参数，同一张表情隔一段时间再偷通常得到不同 URL → `isNew=true`、库里多一份。此时撤销删掉的是本次新写入的那份，旧副本仍在（`sendEmoji` 只是少一张候选，不报错）。彻底去重需要按文件内容哈希，属独立议题，本次不做。
- 回执消息 id 拿不到（少数适配器）时仅 warn，撤销对该条不可用；用户侧表现为「没找到这条偷图记录」。
