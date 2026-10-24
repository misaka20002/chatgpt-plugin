# 03 - 配置兼容与用户文档
Status: ready-for-human

本地配置和文档调整完成；待维护者审阅、合入。
Type: task
Blocked by: 02

## 需求
所有群聊、私聊、预览使用新字幕；锅巴下拉选项的最低档为512×512；已保存旧512×640配置安全映射为512×512；768×768 / 3秒 / 10FPS 保持。更新用户文档与配置回归测试。

## 公开接口及测试
`normalizeAvatarReplyConfig`、锅巴 GSubForm、`test/avatarReplyConfig.test.mjs` 和现有测试；先失败测试再实现。

## 验收
尺寸/默认值/旧配置迁移正确，旧气泡文档删除，无新增开关，未修改与本功能无关配置。

## Answer
- 复审确认：原有 512×640 低档配置仍按 512×512 迁移，768×768/3 秒/10 FPS 不受影响。

`utils/avatar/config.js` 默认和可选低档改为 `512x512`，输入中的旧 `512x640` 正规化为 `512x512`；锅巴下拉沿用 `AVATAR_SIZES` 自适应，且通过 `test/avatarReplyConfig.test.mjs` 的保存/重载校验。`docs/avatar-reply-auto.md` 更新字幕效果、画质档和适用范围。未新增开关。
