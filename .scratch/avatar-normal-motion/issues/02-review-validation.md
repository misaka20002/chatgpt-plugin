# 02 — 角色动图子系统验证和双轴自审
Status: done
Type: task
Blocked by: 01

## 目标
完成 `../spec.md` Q1–Q8 验收，使用仓库的 Standards + Spec 两轴审查差异，维护票据状态。

## 验收
- [x] `npm run test:avatar` 全部通过；改动文件 `node --check` 和 `git diff --check` 通过；按需要验证适当其他测试。
- [x] Standards 轴核查 `AGENTS.md`、`docs/avatar-reply-auto.md`、`docs/agent-guides/testing.md` 与代码风格、测试缝隙，避免过度修改。
- [x] Spec 轴核查动作列表、默认 idle、强动作使用范围、`expressionId` 保留、无示例、资源与渲染不变。
- [x] 功能先在独立 integration branch 开发；用户后续明确授权提交并推送到 `v2`。不部署、不重启。

## Answer

- Standards 自审：改动限于 `utils/avatar/config.js` 的 systemPrompt 及 `test/avatarReply.test.mjs` 的公共调用边界，无新依赖、无重复抽象，原不可信内容约束、输出校验和回退均保留；路径卫生/风格检查均通过。
- Spec 自审：Q1～Q8 全部按确认执行；没有新动作、没有取消 idle 微摆、没有改原七种动作的幅度或特色表情动画，也没有修改 `expressionId` 规则或增添回复示例。
- `npm run test:avatar`：38/38 与 1/1 通过；JS 语法、`git diff --check` 均通过。本轮未调用独立子代理做并行双轴审查，而是逐轴人工对照代码与规格；真实模型偏好尚未线上验证。
