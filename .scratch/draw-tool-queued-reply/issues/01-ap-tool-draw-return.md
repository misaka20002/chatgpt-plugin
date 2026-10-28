# 01 — `draw` 工具按插件类别返回「已入队」/「已画好」，并接住插件的 `false`

Status: ready-for-human（实现完成，改动在工作区未提交；待人工提交与实机验证）
Type: task
Blocked by: none

## 目标

按 `../spec.md` 的「行为契约」改造 `utils/tools/APTool.js` 的 `func`：入队型插件（`nai-plugin-1`、`paimonnai-plugin`、`nai-plugin-4`）返回「已受理、图还没画完」，`ap-plugin` 保持「已画好」；三个调用点都接住严格 `=== false`。

## 改动点

- 在 `func` 内、`finishDraw` 之前新增两个常量：`drawQueued`（入队文案）、`drawRejected`（拒绝文案），文案逐字取自 `../spec.md`「行为契约」，英文，与该文件既有返回一致。
- `nai-plugin-1` / `paimonnai-plugin` 分支：接住 `nai.txt2img(new_e)` 的返回值。
- `nai-plugin-4` 分支：接住 `nai.text(new_e)` 的返回值。
- `ap-plugin` 分支：接住 `ap.aiPainting(new_e)` 的返回值；成功文案不变。
- `finishDraw` 的 `success` 参数：入队型传 `false`，`ap-plugin` 成功传 `true`、失败直接返回拒绝文案。
- `finishDraw` 增加一行注释，点明入队型插件返回时 `capturedImages` 必然为空、因此不进 Prompt Gallery。

## 验收

- [x] 只有严格 `=== false` 判为未发起；`true` / `undefined` 都按已受理处理。
- [x] `ap-plugin` 的成功文案与三个入队型分支的原文案之外的代码零改动。
- [x] 不触碰 `siliconflow-plugin` 的五个分支。
- [x] `node --check utils/tools/APTool.js` 通过。
- [x] diff 只含三个调用点、两个常量与其注释、`finishDraw` 的一行注释（实测新增注释共 6 行）。

## Answer

- 三个调用点改为 `const accepted / finished = await <插件调用>` 后再 `finishDraw(...)`：nai 两支按 `=== false ? drawRejected : drawQueued`，ap 支按 `=== false ? drawRejected : 'draw success, picture has been sent.'`；`success` 分别为 `false` / `finished !== false`。
- diff 统计 `+16/−6`，无其它逻辑行改动；`siliconflow-plugin` 五个分支保持原样。
- `node --check` 通过；`npm run check` 退出码 0（各段套件 `# fail 0`）。

## Comments

- **2026-10-28 复核中修正**：初版拒绝文案写的是「插件已把原因回复给用户」。逐条核对时发现 `ap-plugin` 的「SD绘图功能未开启」分支把 `e.reply` 写在 `return false` **之后**（死代码），用户收不到任何提示——这条跨位置的全称断言不成立。改为只断言「没画」，并要求模型不要替插件编原因；`docs/agent-guides/tools.md` 同一处一并改写，并把该死代码作为依据写明。
- **2026-10-28 两轴评审后**：变量 `enqueued` → `accepted`（值为 `false` 时恰恰没入队）；验收项里的「一行注释」修正为实测 6 行；写死的用例数删除。处置明细见 `../spec.md` 的「评审处置」。
