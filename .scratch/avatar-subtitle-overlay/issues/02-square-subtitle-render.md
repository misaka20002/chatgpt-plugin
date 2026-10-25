# 02 - 正方形画布与前景电影字幕
Status: ready-for-human

本地渲染完成；待维护者审阅、合入。
Type: task
Blocked by: 01

## 需求
参照 ../spec.md 的 Q1～Q4、Q9、Q11、Q13～Q15、Q17：全部 GIF 正方形、512×640 变 512×512；角色适度放大（且不裁头）、不留独立字幕区；白色单行字+黑描边+轻微阴影直接覆盖角色下方；两段按帧顺序硬切、各至少0.7秒，剩余帧按字数分配。

## 公开接口及测试
`renderAvatarGif`、`avatarRenderOptions`；`test/avatarReply.test.mjs`、`test/avatarFolders.test.mjs`；先失败测试再实现。

## 验收
帧像素/尺寸/持续时间经真正 GIF 解码确认；单行文本 width 实测自适应，SVG 注入被转义，旧气泡完全移除；眨眼和特色表情时间线保持。

## Answer
- 复审修复：共用字素分割逻辑，测试验证无底条的多个画面位置，白色不透明底图下白字黑描边确实可辨认。

实现于 `utils/avatar/render.js` 与 `utils/avatar/config.js`：正方形画布、略放大角色、前景白字黑描边阴影、实测字号并在极端宽字符场景下安全截短、帧级硬切和最少 0.7 秒；既有特色表情过渡不变。真实 GIF 编码、解码与视觉截图验证通过；详见 04。
