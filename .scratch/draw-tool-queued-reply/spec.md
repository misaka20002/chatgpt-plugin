# spec：绘画工具的返回文案区分「已入队」与「已画好」

Status: ready-for-human（实现完成，改动在工作区未提交；待人工提交与实机验证）
- 决策来源：2026-10-28 两轮问答（Q1–Q8）；用户答复「Q1 记错了，不改 ap-plugin」「Q7 选 a」「其他都按推荐」
- 相关文档：`GLOSSARY.md`（新增「入队型绘画插件」「同步型绘画插件」）、`docs/agent-guides/tools.md`（新增「绘画工具（`draw`）的两种返回语义」）

## 背景

`draw` 工具（`utils/tools/APTool.js`）按 `plugin` 参数把请求分发给不同绘画插件，调用后一律返回 `'draw success, picture has been sent.'`。但插件把控制权交回来的时机分两类：

| 类别 | 插件 | 返回时机 | 依据 |
| --- | --- | --- | --- |
| 入队型 | `paimonnai-plugin` | `enqueueBatches(...)` 之后立即 `return true`，图在插件队列里稍后生成 | `apps/Txt2img.js` 的 `enqueueBatches(...)` → `return true` |
| 入队型（同源，未核实） | `nai-plugin-1`、`nai-plugin-4` | 按同源实现推测与上者一致；本机未安装 `nai-plugin`，无法复核 | `APTool.js` 从 `nai-plugin/apps/Txt2img.js`、`Text.js` 动态导入 |
| 同步型 | `ap-plugin` | 先自己 `e.reply('已收到绘图请求，正在绘制中，请稍候......')`，再 `await Draw.get_a_pic(...)` 等到出图、`await e.reply(图片)` 之后才 `return true` | `apps/aiPainting.js` 的 `aiPainting()` |

对入队型插件，模型拿到「已画好」就会对用户宣称完成，而图可能几十秒后才出现。

同一个 `await` 上还有第二个问题：**插件的返回值被丢弃**。这些插件在「这次没画」的路径（额度不足、CD 未过、群未开启绘图、参数错、被封禁）上 `return false`，工具仍无条件报成功。注意不能假定插件一定把原因告诉了用户：`ap-plugin` 的「SD绘图功能未开启」分支把 `e.reply` 写在 `return false` 之后，那条回复是死代码。

## 解决方案

按插件类别给不同的工具返回文案：入队型告诉模型「已受理、图会由插件自己发出，现在还没画完」，同步型维持「已画好」；同时接住严格 `=== false`，把「没画」如实报成 `Error:`。

## 用户故事

1. 作为群成员，我让 Bot 画图后被告知「正在画、画好会发出来」，而不是「画好了」却看不到图。
2. 作为群成员，我不会因为 Bot 以为已画完而让同一张图被重复提交、重复消耗额度。
3. 作为群成员，群未开启绘图 / CD 未过 / 额度不足时，Bot 不会对我说「画好了」。
4. 作为群成员，用 `ap-plugin` 画图时，图确实发出后 Bot 仍会说「画好了」，不会反过来让我等一张已经在群里的图。
5. 作为群成员，Bot 说「正在画」时不会把提示词、词条或参数复述一遍刷屏。
6. 作为维护者，我改 `draw` 的文案时能一眼看出哪些分支不许说「已完成」。
7. 作为维护者，我不必为每个插件的每条失败路径写兜底——只在三个调用点各判断一次。
8. 作为维护者，某个插件版本没写 `return` 语句时，工具不会把正常请求误判成失败。
9. 作为维护者，`ap-plugin` 的成功文案没被顺手改掉（它此刻确实已经画完）。
10. 作为维护者，我能在术语表和工具指南里查到这两类插件的区别，而不必重读三个插件的源码。

## 实现决策

- **模块**：只改 `utils/tools/APTool.js` 的 `func`，三个调用点各一次判断——`nai-plugin-1`/`paimonnai-plugin` 共用的 `nai.txt2img(new_e)`、`nai-plugin-4` 的 `nai.text(new_e)`、`ap-plugin` 的 `ap.aiPainting(new_e)`。
- **文案常量**：在 `func` 内、`finishDraw` 之前新增两个常量（入队文案、拒绝文案），只在一次工具调用内存活；英文，与该文件既有工具返回一致；拒绝文案沿用本仓 `Error: …` 约定。逐字文案见下方「行为契约」。
- **判定口径**：只有**严格等于 `false`** 才算「这次没画」；`true` 与 `undefined` 一律按已受理处理（`nai-plugin` 未安装，无法确认其 `txt2img` / `text` 有无 `return` 语句，用 `!result` 会把正常请求判成失败）。
- **`finishDraw` 的 `success` 参数**：入队型传 `false`（此刻没有任何图片可推画廊）；`ap-plugin` 成功路径仍传 `true`，失败路径直接返回拒绝文案。
- **不变**：`ap-plugin` 的成功文案保持 `'draw success, picture has been sent.'`——它返回时图已在会话里，改成「正在画」是反向误报。
- **画廊**：`finishDraw` 增加注释点明「入队型插件返回时 `capturedImages` 必然为空，因此不进画廊」是既成事实；不改行为。

## 行为契约

| 场景 | 工具返回给模型 | 模型应对用户 |
| --- | --- | --- |
| `paimonnai-plugin` / `nai-plugin-1` 受理 | `Draw request accepted and queued; the picture is NOT ready yet. It will be sent to the chat automatically by the drawing plugin when finished. Tell the user it is being drawn and will arrive shortly — do not claim it is done, and do not call this tool again for the same request.` | 告知正在绘制、稍后会自动发出 |
| `nai-plugin-4` 受理 | 同上 | 同上 |
| `ap-plugin` 画完并发出 | `draw success, picture has been sent.`（原文案） | 可以说已完成 |
| `ap-plugin` 出图被 nsfw 拦下 | 仍是 `draw success, picture has been sent.`（既成事实，见「风险」） | 模型会多说一句完成，而图未展示 |
| 本次改动的三个分支或 `ap-plugin` 返回 `false` | `Error: the drawing plugin did not accept this request, so no picture is being drawn. Do not claim a picture was drawn and do not retry automatically. The plugin may already have told the user why — do not invent a reason.` | 不得宣称画好、不自动重试、不替插件编原因 |
| 插件导入失败 / 未安装 | 各分支原有文案（不变） | 不变 |
| 抛异常 | `generation failed due to unknown error: …`（不变） | 不变 |

## 测试决策

- 本次改动是返回值文案 + 每个调用点一次布尔判断，没有新的行为分支或数据流。
- **不新增测试**：断言「返回值等于某个字符串」属于源码守卫，不构成行为测试；要真跑 `func` 得把三个插件模块、`Config`、`wrapReplyForGallery` 全 mock 掉，被测逻辑只剩三元表达式本身。
- 验证依靠：`node --check utils/tools/APTool.js`、`npm run check`（全仓语法预检 + 路径卫生 + 快套件）、diff 逐行复核。
- 已有同类先例：本仓工具返回文案改动（如 `EmojiTool` 的「图片会单独发送」）同样不配测试。

## 非目标

- 把 `ap-plugin` 的文案改成「正在画」。
- 让 `APTool` 真正等待入队插件出图后才知道结果——插件的 `enqueueBatches` 只返回 `true`，没有回传 promise 或回调，要做得改插件契约。
- 修 Prompt Gallery 对入队型插件不生效（`capturedImages` 为空导致永不推送）。
- `siliconflow-plugin` 五个分支（`sf_draw` / `mj_draw` / `call_Jimeng_Api` / `dd_custom_command` / `gg_select_and_chat`）的假成功，本次不动。
- 入队位置的透出（`user_inQueue` 是插件内部状态，不属于调用方可见契约）。

## 验证计划

1. `node --check utils/tools/APTool.js`
2. `npm run check`
3. 逐行复核 diff：三个调用点、两个常量与其注释、`finishDraw` 的一行注释，无其它改动

## 验证结果

- `node --check utils/tools/APTool.js`：通过。
- `npm run check`：**退出码 0**。语法预检 358 个文件、路径卫生 452 个文件、风格检查（JSDoc 换行、日志前缀、`console.log` 边界、测试挂载、脚本路径、套件接线、工具链产物、时长断言须实测）全通过；后续各段套件输出全部 `# fail 0`（用例数以当次 Node 输出为准）。
- diff 复核：`utils/tools/APTool.js` +16/−6，只含两个常量与其注释、`finishDraw` 的一行注释、三个调用点；`GLOSSARY.md` +8；`docs/agent-guides/tools.md` +8；新增 `.scratch/draw-tool-queued-reply/`（本 spec 与两份 ticket）。
- 未做真实链路验证：本机没有 `nai-plugin`，`ap-plugin` 与 `paimonnai-plugin` 需要真实群聊与绘图额度，属实现完成后由用户实机观察的范围。

## 实施方式偏离

未按 `implement-spec` 的集成分支 / 独立工作树 / 后台实现 agent 流程执行：本仓禁止主动 `git add` / `commit` / `push`（改动留在工作区），且本仓实测后台子 agent 会被运行时终止并丢失结果；本次改动是三个调用点加两段文档，分支与合并的收益为零。实现与验证均在工作区直接完成。

## 风险

- **`nai-plugin` 未本机核实**：文案基于用户描述的现象。若它的 `txt2img` / `text` 其实是等出图后才返回，会变成「图已在群里、模型却说正在画」的反向误报；发现后把该分支的 `drawQueued` 换回原文案即可，改动是一行。
- **「插件是否已把原因告诉用户」不可假定**：`ap-plugin` 的「SD绘图功能未开启」分支把 `e.reply` 写在 `return false` 之后（死代码），用户收不到任何提示。拒绝文案因此只断言「没画」，并要求模型不要替插件编原因；`paimonnai-plugin` 的 `applyNai5FreeQuota` / `prepareNaiPointsCost` 失败分支确实回复了，但其 `Txt2img.txt2img` 另有 13 处提前退出，逐条核实成本高于收益。
- **`undefined` 被判为已受理带来的反向误报**：`paimonnai-plugin` 的 `Txt2img.txt2img` 在权限不足时是 `return`（`undefined`）而不是 `return false`，按 `=== false` 口径会被当成已受理，模型会说「正在画」——此时插件已自行回复过权限提示。若改成 `!== true` 判失败，代价是 `nai-plugin` 那种未知返回值契约的版本会被误判成失败，本次选择前者。
- **`true` 不等于「已入队」**：`Txt2img.txt2img` 调用 `enqueue_Batches.enqueueBatches(...)` 时**没有 `await`**，而该函数是 `async`；它内部的额度不足分支 `return await e.reply(...)` 在真正入队前就退出，可此时 `txt2img` 已经 `return true`。所以工具对模型说的 "accepted and queued" 比实际更乐观：模型先说「正在画」，用户紧接着收到插件的「次数不足」。要修得让 `txt2img` 等到入队结果，属于插件契约变更，本次只记录。
- **`ap-plugin` 的「返回即已发出」只在成功分支成立**：nsfw 分支在 `return true` 前只回了「图片不合规，不予展示」（`aiPainting.js:267`），此时工具仍报 `draw success, picture has been sent.`。本次不改判据（插件只返回布尔，分不出「被拦」与「已发」），已在「行为契约」单列一行。
- 拒绝文案是 `Error: …`，模型可能据此在回复里带出「失败」措辞，而插件可能已经把更具体的原因发给用户了；文案里已要求不得宣称画好、不自动重试，未强求模型沉默。

## 评审处置（2026-10-28 两轴评审后）

**已改**

- 「行为契约」的「任一插件返回 `false`」是全称断言，与「非目标」里保留的 siliconflow 五个分支矛盾，改为「本次改动的三个分支或 `ap-plugin`」。
- 「文案常量」原写「模块内常量」，实际声明在 `func` 内、只在一次工具调用内存活（每次重建）；措辞改为 `func` 内。
- 验证自述「一行注释」与实际新增的 6 行注释不符，验证计划与验证结果一并改成「两个常量与其注释、`finishDraw` 的一行注释」。
- 删掉写死的「合计 479 项通过」，改为「以当次 Node 输出为准」（testing.md 要求不写死用例数）。
- `GLOSSARY.md` 的入队型词条补上「`paimonnai-plugin` 已核实、`nai-plugin` 两支按同源实现归入、未在本机核实」，与 `tools.md` 的口径对齐。
- `tools.md` 的「只在严格等于 `false` 时回 `Error: …`」补限定「只在这三处判断」，并点名 siliconflow 五个分支仍是丢弃返回值的旧口径。
- 变量名 `enqueued` → `accepted`：值为 `false` 时恰恰没入队，旧名字与语义相反。
- `Status` 从 `done` 改为 `ready-for-human`：本仓 `done` 的定义是「已交付并已合入」，而改动还在工作区。
- 本轮补两条风险（`true` 不等于已入队、`ap-plugin` nsfw 分支返回即真）与「行为契约」中 nsfw 一行。

**只记录不改**

- `Txt2img.txt2img` 未 `await` `enqueueBatches`、`ap-plugin` 的 nsfw 分支只回文本却 `return true`：两处都在插件侧，改法要动别的插件，已写进「风险」。
- 三处 `x === false ? … : …` 同形：本仓规则是「不过度抽象」，三行重复不值得引入 helper。
