# 01 - recognize_media 固定走专用提供商
Status: ready-for-human
Type: task
Blocked by: none

## 目的
依据 ../spec.md Q1-Q3、Q5-Q6，按需内容识别只使用图片/视频指定提供商，移除“当前对话模型先识别、失败回退”的分支。

## 测试缝隙
`RecognitionResultsByGeminiTool.func(opts, e)`，在 `test/recognitionMedia.test.mjs` 中模拟模型调用与指定配置核查行为；`test/mediaUrlGuard.test.mjs` 验证真实下载约束。

## 验收
- 图片/头像只用 imageProviderId，视频只用 videoProviderId；互不要求另一类型已配置。
- 空值、'current'、不存在的 ID 和视频配置非 Gemini 明确报 `Error:`，不请求其他模型；提供商响应失败/空也不回退。
- 保持 `mediaRecognitionGeminiTool` 注册开关，媒体输入/URL trust/SSRF/下载大小/结果安全标记/提示词语义不变。
- 不修改普通聊天引用图/预识别链路及共用的 `recognitionResultsByGemini`。

## Answer

- 已修改 `utils/tools/RecognitionResultsByGeminiTool.js`：只依所选图片/视频具体 ID 识别，不读普通聊天来源、不调用 `recognitionResultsByCurrentModel`，也没有回退分支。拒绝缺配置、`current`、失效条目及非 Gemini 视频提供商；错误保持 `Error: ...`。
- 通过 `test/recognitionMedia.test.mjs` 验证两种聊天来源、缺配置、头像、两种媒体独立、四种图片协议、混合参数视频优先、空输出和无回退行为。保留原 URL/SSRF 下载约束与工具开关。
