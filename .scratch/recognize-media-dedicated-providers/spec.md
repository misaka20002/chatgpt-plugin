# 按需内容识别：固定使用专用模型提供商（已确认方案）

Status: ready-for-human

## 用户明确提出的目标

将锅巴「工具新增-按需内容识别」的说明原文替换为：

> 新增按需内容识别工具，用于AI智能按需识别聊天记录中的图片/视频/群友头像等；需要先配置 对话-图片识别模型提供商 和 视频识别模型提供商

**核心行为**：`recognize_media` 不再优先调用「当前对话模型」，也不在其失败后回退指定识别配置；不论普通聊天设置什么「内容识别来源」，该工具直接使用用户在 `imageProviderId` / `videoProviderId` 指定的具体识别模型提供商。仅改工具选路和相关 Guoba 文案；普通聊天原生多模态与专用预识别流程完全不动。

## 已核实的实现事实（2026-10-25，v2 @ 71f6843）

1. 锅巴 `guoba.support.js` 有「内容识别来源」选择框（`mediaRecognitionSource`，`Orignal`/ `Gemini`）、「图片识别模型提供商」（`imageProviderId`）与「视频识别模型提供商」（`videoProviderId`）；「工具新增-按需内容识别」（`mediaRecognitionGeminiTool`）的现有帮助仍宣称当前模型优先、失败回退 Gemini。媒体大小限制说明也提到「模型内置与 Gemini 两条路径」。
2. `utils/tools/RecognitionResultsByGeminiTool.js`：当 `Config.mediaRecognitionSource === 'Orignal'` 时尝试 `recognitionResultsByCurrentModel`，失败再 `recognitionResultsByGemini`；专用识别底层以 `imageProviderId`（图片与 QQ 头像）或 `videoProviderId`（视频）选模型；结果需要不可信内容标记、限长，失败返回 `Error: ...`。
3. **普通聊天是另一条独立的处理链，本次明确不修改**：
   - `apps/chat.js`：`mediaRecognitionSource = Gemini`（「专用识别」）时，先用识别提供商将图片/视频转换为文字描述并拼入普通聊天 prompt。
   - `model/core.js`：`mediaRecognitionSource = Orignal`（「模型内置」）时，把引用图片直接作为原生多模态输入交给当前对话模型，这是当前模型的基础识图能力，并不是工具内部尝试识图。
   - 因此锅巴「内容识别来源」切换框、配置值、旧命令 `#chatgpt对话中图片识别` 及其语义均应保留，仅在 `recognize_media` 内部取消读取该字段来优先用当前模型。
4. `recognitionResultsByGemini` 虽然保留旧函数名，**图片模型已支持 api / responses / claude / gemini 四种类型**；视频识别只支持 Gemini 条目。新装实例的图片和视频 Provider ID 默认都是空值。
5. 既有来源可信度区分、下载大小/格式校验、SSRF 防护、历史媒体与 QQ 头像解析、`question` 明确传递与工具错误文本等行为不属于此次默认修改范围。
6. 旧来源选择路径已被 `test/recognitionMedia.test.mjs`、`test/mediaUrlGuard.test.mjs` 测试；`docs/agent-guides/tools.md` 与 `docs/agent-guides/configuration.md` 也说明原模式。本方案确认后需同步代码、锅巴提示、测试与指南。

## 已确认的边界（用户纠正）

- **Q1 已定**：仅更改 `recognize_media` 工具的识别模型选择；不碰普通对话直接读取引用图片的原生多模态能力，不碰普通聊天「专用识别」的先识别再拼描述流程。
- **已有锅巴「内容识别来源」选项保留**：它继续管理普通聊天的两条模式；不再被 `recognize_media` 工具用来决定是否先请求当前模型。
- 历史 `Orignal` / `Gemini` 值及 `#chatgpt对话中图片识别` 命令保持原有兼容。

## 第二轮已确认（Q2～Q4；用户：全部按推荐）

- **Q2 独立配置**：识别图片/群友头像时只检查 `imageProviderId`，识别视频时只检查 `videoProviderId`；不要求两个都配置完才能使用另一种已配置的媒体识别。原样保留用户要求的「工具新增-按需内容识别」帮助文案（其中同时介绍了两个配置项，不表示执行必须同时配置）。
- **Q3 失败不换源**：所选的专用识别提供商缺失、无效、请求失败或返回空内容时，沿用工具边界 `Error: ...`，不尝试当前对话模型，也不尝试 Gemini 或别的专用提供商自动回退。视频仍限 Gemini，图片保留原有四协议支持。
- **Q4 同步修正文案**：逐字替换用户指定的工具帮助文本；同步清除「媒体识别大小限制」帮助中的「模型内置与 Gemini 两条路径」误导措辞，保持大小上限及该配置影响的现有路径不变。

## 第三轮已确认（Q5～Q7；用户：全部按推荐）

- **Q5 保留工具注册开关**：只按原有 `mediaRecognitionGeminiTool` 开关注入 `recognize_media`，不因某个或两个提供商缺失而隐藏工具。执行时按媒体类型检查对应提供商，未配置则返回明确的 `Error: ...`。关闭开关仍不注册工具。
- **Q6 工具不接受 `current` 特殊 ID**：只在 **`recognize_media` 工具执行路径**拒绝 `imageProviderId === 'current'` 或 `videoProviderId === 'current'`（按本次实际媒体类型判断），提示必须选择具体提供商；不改变普通聊天预识别对旧配置的现有处理。若具体 ID 恰好等于聊天所用提供商，则正常使用，因为这属于明确指定而不是自动跟随。
- **Q7 Guoba 说明同步更新**：「内容识别来源」仍只控制普通聊天；将下拉项的显示名称从「模型内置优先」改为「模型内置」，值 `Orignal`、`Gemini` 保留，已有设置和 `#chatgpt对话中图片识别` 命令不变。新说明：`仅控制普通聊天的媒体处理方式：模型内置使用当前对话模型的原生多模态能力；专用识别先使用配置的识别模型生成文字描述。按需内容识别工具不受此选项影响，始终使用指定的图片或视频识别模型提供商。`

## 已实施修改

1. **按需识别工具**：`utils/tools/RecognitionResultsByGeminiTool.js` 删除 `mediaRecognitionSource` 分支及 `recognitionResultsByCurrentModel` 调用，直接调用现有 `recognitionResultsByGemini` 专用提供商识别函数（保留其兼容函数名，不重写底层媒体下载）。识别图片和 QQ 头像使用 `imageProviderId`，视频使用 `videoProviderId`；只校验本次媒体类型所需提供商是否配置了真实具体 ID，拒绝空值、`current` 与无效条目。视频继续仅允许 Gemini，图片支持四协议；未配置、错误、空结果均按现有工具风格 `Error: …` 返回，不自动换源。`recognitionResultsByGemini` 作为普通聊天等调用者共用的底层函数，其原有接口和语义不擅自改变。
2. **Guoba 帮助文案**：
   - 「工具新增-按需内容识别」必须**严格使用用户给定的原句**：`新增按需内容识别工具，用于AI智能按需识别聊天记录中的图片/视频/群友头像等；需要先配置 对话-图片识别模型提供商 和 视频识别模型提供商`。
   - 「媒体识别大小限制」根据 Code Review S1 更新为：`媒体文件大小上限，适用于智能模式 recognize_media 按需内容识别、普通聊天「专用识别」的媒体预处理及独立 #识图；图片和群友头像使用图片识别模型提供商，视频使用视频识别模型提供商，请注意 Token 消耗。`，明确还适用于普通聊天专用预识别和独立 `#识图`，不修改限制数值及原有适用范围。
   - 「内容识别来源」按 Q7 更新显示标签和帮助文案；保留字段、选项值、已有保存/读取行为。
3. **测试与指南**：`test/recognitionMedia.test.mjs` 用指定提供商路径、配置缺失、特殊 `current` 值、错误回传及媒体独立选择替换旧当前模型优先/回退用例；`test/mediaUrlGuard.test.mjs` 识别工具在两种普通聊天来源配置下都用相同专用路径；增强 `test/providerSources.test.mjs`，通过真实 `recognize_media` 工具与真实 `recognitionResultsByGemini` 贯通到 `SubLLM` 边界，验证四协议图片及 Gemini 视频使用选定 ID，并补 Guoba schema 断言。同步 `docs/agent-guides/tools.md`（特别是按需媒体识别章节）中的旧模型回退说明；不修改普通聊天引用图章节的既定行为。

## 验收与非目标

- 即使 `mediaRecognitionSource = Orignal`，对话模型主动调用 `recognize_media` 也**不会先调用当前对话模型**；即使 `mediaRecognitionSource = Gemini`，工具仍然只调用对应的专用提供商。`mediaRecognitionGeminiTool` 开关独立控制工具是否注册。
- 仅配置图片识别模型时图片/QQ 头像可识别，视频返回明确缺配置错误；反之亦然。没有任何自动回退或尝试其他提供商。特殊 `current` ID 仅在工具路径明确拒绝。
- 普通聊天模型内置引用图片与普通聊天「专用识别」预处理完全照旧；保留旧 `Orignal` / `Gemini` 配置、命令及其兼容行为。
- 混合参数时视频优先、`question` 显式空串、媒体大小和类型校验、可信媒体地址分级、SSRF 防护、错误 `Error: ...` 契约、结果的外部不可信标记及长度限制均不改变。
- 不新增 Guoba 字段，不更改默认配置、不进行数据迁移、不重命名工具、不修改普通聊天 `apps/chat.js` / `model/core.js` 或独立的 `#识图` 指令。

## 访谈状态

用户已确认 Q1～Q7，并请求 `/implement spec`；本轮 Code Review 后又明确授权修复 Standards S1/S2、保留 Spec F1 原样，并提交推送功能分支。不得未经授权合并 `v2`、部署或重启；功能分支保持待人工合并状态。

## 实施结论

- 工作分支：`feat/recognize-media-dedicated-providers`，基线 `v2@71f6843`，未修改普通聊天链路。
- `recognize_media` 固定选图片或视频独立提供商：无当前模型优先，也无自动回退；空/无效/`current` ID 与失败结果均返回 `Error: ...`，保留工具注册开关与原媒体安全校验。
- Guoba 中按用户原句替换工具说明，并更新「内容识别来源」显示标签、帮助和「媒体识别大小限制」帮助；不改变配置字段、默认值、原有普通聊天模式或旧命令。
- 新增并更新媒体路由、图片四协议、视频 MIME、SSRF、配置表单回写回归测试；`npm run test:media` **87/87 通过**、`npm run test:config` **35/35 通过**，`npm run check` **退出码 0**（临时 md5/file-type 测试依赖，不属于项目提交）。
- 后续 `/code-review` 提出 Standards S1（Guoba 文件大小限制文案范围）和 S2（工具到实际提供商贯通测试）：已按推荐补正文案和真实工具→识别函数→`SubLLM` 的调用链测试。Spec F1（历史异常配置手改成 `current`）经用户明确决定**不新增防护**：实际仅通过 Guoba 选择具体条目，沿用现有配置加载校验；原工具已有的 `current` 拒绝分支不变。对应实施票据见 `issues/`。
- 最终回归：`npm run test:providers` **42/42 通过**，`npm run test:media` **87/87 通过**，`npm run test:config` **35/35 通过**，`npm run check` **退出码 0**。另外试运行非核心 `npm run test:tools` 时，已运行 234 项全部通过，但 ARM 机器的宿主 `lib/renderer/loader.js` 导入 `yaml` 失败，套件总体退出码 1；该宿主依赖缺失不属于本次功能，不扩大修改范围，也不宣称该套件通过。
