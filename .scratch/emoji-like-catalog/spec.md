# spec：贴表情池重建 + 具体表情目录

Status: done（2026-10-26）
- 决策来源：2026-10-26 三轮问答（Q1–Q5），用户答复「Q1 选 B」「物件+动作不超过 12 个 key」「Q2/Q3 按推荐」「Q5 放开 QQ 黄脸」
- 相关文档：`docs/adr/0008-emoji-like-catalog-and-pool-admission.md`、`GLOSSARY.md`（新增「贴表情」「情绪池」「表情目录」）

## 背景

`emojiLike`（`utils/tools/EmojiLikeTool.js`）原来是 16 个英文情绪键 → 一组 QQ face id，模型报情绪、工具在池里随机挑一个。两个问题：

1. **池子本身不可信**：80 条 id（去重 79 个，`110 吓` 跨两池）里混着明显错配——`惊恐(26)` 在 `angry`、`发呆(3)` 在 `surprised`、`撇嘴(1)`/`魔鬼笑(286)` 在 `scared`（而 `发抖(41)`/`吓(110)` 空着）、`猪头(46)`/`变形(312)`/`戳一戳(181)` 在 `speechless`、`牛气冲天(306)`/`大展宏兔(347)` 在 `awkward`。贴出去的情绪和键名对不上。
2. **表达面窄**：模型只有 16 种情绪可说，且物件类（玫瑰、蛋糕、咖啡、烟花）根本没有归属。

参考数据源：[QQ 表情 ID 速查器](https://52-moyna.github.io/maibot_plugin-Response/face-lookup.html)（367 条 = 299 个 face id + 68 个 Unicode emoji）。

## 决策口径

| # | 决策 | 结论 |
| --- | --- | --- |
| Q1 | 参数面 | 新增可选 `face`（中文表情名，enum 12 个）；`emotion` 的 16 个键**一个不加**，只重建池 |
| Q2 | 现池错配 | 按「语义与键名对得上」重建，错配全部移出/归位；`happy` 里的擦边脸 `2 色`、`339 舔屏` 一并剔除 |
| Q3 | 准入范围 | 只收小黄脸 / 超级表情 / QQ 黄脸；排除 Unicode emoji（码点会贴出空白）、皮肤包（汪汪/企鹅/噗噗星人/喜花妮）、节日·生肖·活动·联动（龙年快乐、大展宏兔、中秋、王者召唤） |
| Q4 | 12 个表情名 | 玫瑰 63、蛋糕 53、咖啡 60、茶 171、烟花 333、鞭炮 137、打call 311、666 356、收到 428、抱拳 118、握手 78、敬礼 282 |
| Q5 | QQ 黄脸 | 放开（用户确认速查表的 id 都经过验证）：`无语 462`、`硬撑 460`、`宕机 461`、`呜呜呜 386`、`太好笑 387`、`优雅 459`、`我吗 458`、`羞羞哒 466`、`别说话 402` 等进池 |

补充细节（未单独提问，按推荐口径直接定）：

- `face` 用 enum 而不是自由文本：名字只有 12 个，enum 能彻底堵住编造；schema 是全量进每次请求的，所以目录刻意封顶 12 个。
- 兜底：`face` 不在目录但 `emotion` 合法 → 继续贴（走该情绪随机池），并在工具返回里写一行 `fell back to emotion "…"`，不白耗一轮；两条都不成立才 `Error: …`。
- `required` 从 `['emotion']` 改成 `[]`：两个参数都是可选的，至少给一个由 `func` 自查，避免「点玫瑰也被迫编一个情绪」。
- 同一 id 允许跨池（`110 吓` 同属 `surprised` 与 `scared`），不视为重复。
- `utils/face.js` 的 `faceMap` / `faceMapReverse` 同步补齐（正向 377 条、反向 367 条），**只追加不改名**：`181 骚扰` 不改成速查表的「戳一戳」，改名字会动到 `[表情名]` 输入匹配与既有日志。同名冲突共 10 处（`450–457` 的 `撇嘴/色/微笑/发呆/得意/害羞/闭嘴/睡` 与 `1/2/14/3/4/6/7/8`、`353 拜托` 与 `200 拜托`、`360 亲亲` 与 `109 亲亲`）在反向表保留原有映射。
- 情绪池最终规模：happy 13、proud 8、shy 5、sad 9、conflicted 9、angry 6、surprised 3、confused 5、pleading 3、scared 5、awkward 8、speechless 9、disgusted 9、bored 4、like 5、love 9。

## 已知约束

- **token 翻倍**：`emojiLike` 的 schema 从 107 → 213 tokens（`test/toolContextAudit.md` 已重跑）。enum 是每次请求都付的固定成本，这是 `face` 封顶 12 个的直接原因。
- **id 有效性无法本地验证**：`set_msg_emoji_like` 对无效 id 也返回 ok、客户端贴出来是空白（速查表原文）。本地没有校验手段，只能靠来源表 + 上线后用 `get_emoji_likes` 抽查。
- **枚举与数据是两份字面量**：`parameters.properties.*.enum` 保持字面量，`toolContextAudit` 才能静态求出 token 数（用 `Object.keys(...)` 会被标成 dynamic）。脱节风险由 `test/emojiLikeTool.test.js` 逐个真跑枚举兜住。

## 验证

`node --test test/emojiLikeTool.test.js` → 全部通过。覆盖：face 精确命中、face 优先于 emotion、未知 face 回落、两条都无效报错且不碰接口、原型链键名被拒、emotion/face 枚举逐个可贴、目标消息优先级、适配器不支持时给提示。
