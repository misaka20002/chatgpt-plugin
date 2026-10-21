# 拒绝回答与失败提示的撤回口径

Status: done

## 现状（改动前）

- 拒绝回答有两种落点：
  - `utils/openai/chatgpt-api.js`、`utils/openai/responses-api.js`、`client/ClaudeAPIClient.js` 作为**正常结果**返回，带 `refused: true`，`model/core.js` 在文本为空时补「模型拒绝回答」。
  - `client/CustomGoogleGeminiClient.js` 抛 `noRetry` 错误，走 `apps/chat.js` 的 catch 分支。
- 正常回复路径不带 `recallMsg`，所以前三家的拒绝文案永久留在群里；Gemini 的走错误分支会被撤回（30 秒）。
- 结果是同一个现象两种留存口径。

## 决策

1. **拒绝回答按「没得到回答」处理**，与调用失败同一套撤回机制：群聊延时撤回、私聊不撤。
2. **撤回秒数 60**，错误提示与拒绝提示共用一个常量 `FAILED_REPLY_RECALL_SECONDS`，避免两条路径各留一套数字。
3. **沿用 `is_recallMsg` 开关**，不新增配置项；关掉就两类提示都不撤。
4. **拒绝原因原样发给用户**（含 Gemini 的 `SAFETY` / `RECITATION` 等安全分类标签），不替换成固定文案。
5. **拒绝不触发备用模型**：`utils/providerFallback.js` 里 `refused` 直接返回，保持短路——回退等于换个 provider 再问一次被拒的问题，属于绕过审核。

## 实现

- `apps/chat.js`：新增 `FAILED_REPLY_RECALL_SECONDS` 与 `failedReplyRecallSeconds(config, e)`；`abstractChat` 中按 `chatMessage.refused` 算出 `refusedRecallSeconds`，传给正文发送点（角色回复、分句回复、默认回复、TTS 文字文案）与**TTS 语音消息本身**——语音模式下拒绝文案不以文字送出（`alsoSendText` 默认关、阈值 299），撤回只能挂在那条语音上。错误分支与语音合成失败提示改用同一个 helper。
- `guoba.support.js`：`is_recallMsg` 标签改「撤回失败提示」，说明改成列举覆盖范围 + 点明不撤的路径，并删掉与实现不符的「重启生效」（`Config.commit` 是 `Object.assign`，下次对话即生效）。
- `test/groupReplyChat.test.mjs`：拒绝 → 群聊 60 / 私聊 0 / 开关关闭 0 / 正常回答不受影响；语音模式拒绝（有音频、无音频两条）与调用报错同样 60 秒。

## 未覆盖

- 图片模式（`renderImage`）与角色 GIF 附件不带 `recallMsg`，渲染出的错误图/拒绝图不会撤回。
- `sf_markdownPic` 的 markdown 截图（`chat.js` 的 `markdown_screenshot` 分支）同样不撤。
- 合并转发（`auto_makeForwardMsg`）路径同样不撤；拒绝文案够短，实际打不到这个阈值。
- 进度提示「在哦」「知道哦」仍是固定 30 秒，不属于「没得到回答」，未并入本口径。
