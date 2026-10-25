# 02 - Guoba 内容识别说明与模式显示
Status: ready-for-human
Type: task
Blocked by: none

## 目的
依据 ../spec.md Q4、Q7，精确替换「工具新增-按需内容识别」底部说明，同时修正「媒体识别大小限制」与「内容识别来源」说明；将展示标签「模型内置优先」改为「模型内置」。

## 测试缝隙
`supportGuoba().configInfo.schemas` 对外 schema，核查用户指定中文原句、选项标签与值；保留 `getConfigData` 和 `setConfigData` 的原配置读写行为。

## 验收
- 用户原句逐字一致，两个相关提示准确、不暗示 recognize_media 模型优先/回退；
- `mediaRecognitionSource` 枚举仍为 Orignal/Gemini，旧值兼容，不新增字段、不迁移配置；
- `apps/chat.js`、`model/core.js` 不修改。

## Answer

- `guoba.support.js` 按用户原句修改工具帮助，更新普通聊天「内容识别来源」的标签/说明和媒体大小限制说明，没有新增字段或迁移。
- `test/configBaseUrl.test.js` 新增真实 Guoba schema 与保存、读回、写盘的回归，核对文案完全一致以及 `Orignal`、`Gemini` 的原始值保持不变。
- Code Review S1：媒体大小限制说明已补充普通聊天「专用识别」预处理及独立 `#识图` 的共用作用范围；先修改表单回归断言观察失败，再修正文案使断言通过。
