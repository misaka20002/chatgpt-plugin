# 01 — 辅助模型动作选择提示词与回归测试
Status: done
Type: task
Blocked by: none

## 目标
按照 `../spec.md` Q1–Q8 的最终结论，仅调整 `utils/avatar/config.js:createAvatarCue` 给辅助 LLM 的 `action` 选择提示，精确区分现有七种动作。普通提问、轻微疑惑、俏皮反问与日常玩笑优先 `idle`，避免错误选择摇晃；`idle` 本身仍有轻微左右摆动。

## 测试缝隙（访谈时已确认）
`createAvatarCue(text, expressions, providerId, generate)` 是对外可调用的纯业务接口，通过注入的 `generate({ systemPrompt, input, providerId })` 检查给模型的真实系统指令并返回合法 cue。测试只检查语义与契约，不模拟模型推理过程；不能保证真实 Gemini 每次都选择 idle。

## 验收
- [x] TDD：在 `test/avatarReply.test.mjs` 先添加一条会因旧 prompt 缺少动作说明而失败的行为测试，然后最小修改 prompt 使其通过。
- [x] 只列现有 `idle,bounce,shake,wobble,nod,headshake,recoil`；每个动作说明语义/适用语气，`idle` 默认、正常轻摆不等于静止；只有明显强烈或明确动作才选择对应反应。
- [x] 不新增示例台词、不新加示例 JSON；原有输出 JSON 结构提示保留。
- [x] `expressionId` 选择提示原句原样保留，不因是否为普通表情强制映射/改写动作。
- [x] 不改动 `render.js`、`resource.js`、Guoba、模型调用次数、字幕格式/字数/失败回退或运动参数。

## Answer

- TDD Red：新增的 `createAvatarCue` 注入 `generate` 公共缝隙测试因旧 prompt 不含「默认优先 idle」而失败（退出码 1），证据为旧 systemPrompt 中仅枚举动作。
- TDD Green：仅补充 systemPrompt 的七种动作释义、温和语气优先 idle、避免基于标点滥用强烈摇晃；该测试通过（1/1）。模型原样返回有效的 wobble/特色 ID，没有渲染代码或模型请求策略变化。
- 测试维持 prompt 不新增特定示例，字幕输出 JSON 结构及 `expressionId` 字段引导按原文保留。
