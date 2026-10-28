# 引用图只在请求内回放：工具轮不靠存储恢复原始图片

状态：已采纳（2026-10-28）。

`mediaRecognitionSource = Orignal` 时引用图以 base64 内联给四个 provider。为控制会话历史体积，落库时图片被换成「媒体占位」（Gemini `[多媒体附件: mime]`、OpenAI `[图片]`）。但 Gemini 的 `generateContent` 与 OpenAI 的 Chat Completions 都是无状态协议：每次请求必须自带完整 `contents` / `messages`。Gemini 的工具轮是一次新的 `sendMessage` 递归、OpenAI 的工具轮沿父链重走历史，两者都从存储重建上下文，于是工具返回之后模型再也看不到那张图——表现为「刚发过图，调完工具就失忆」。Claude（工具循环在单次调用内、历史常驻内存）与 Responses（无状态分支把本轮 input 常驻内存整体重发，`store=true` 时上下文在服务端）不受影响。

现改为：调用方把「本轮原始内容」（Gemini `turnParts`、OpenAI `turnContent`，均带消息 id，形状随协议）显式交给客户端，客户端在**拼请求体时**按 id 回填到最初那一轮，`functionResponse` 轮仍然不带图。历史对象一律不原地修改——工具轮的历史是 `createAttemptHistory` 的内存 Map，取到的是共享引用，原地改会把 base64 写回存储。

## 考虑过的替代方案

- 把 base64 留在会话历史里（AstrBot 的做法）：否——4 张图 × 多轮会让每条会话历史带上兆级 base64，Redis 体积与读写成本不可接受；AstrBot 能这么做是因为它把历史整份存在自己的会话库里并接受这个体积。
- 把 Gemini 的递归改成 Claude 式的内存循环：否——要同时动存储剥离、全局提示注入、历史归一化与 `thoughtSignature` 四条链，改动面远大于收益，还会改变工具轮的落库时序。
- 在媒体占位里写入可还原的附件 id（把占位符变成引用）：否——本次目标只是「同一次请求内工具轮能看见图」；跨轮可见性需要另一套存储设计，混进来会让占位符承担两种语义。
- 把图片挪到 `functionResponse` 那一轮：否——官方多模态 function calling 示例把图留在首轮 user 消息，回调轮只有 functionResponse；首轮 user 内容同时是签名校验的 turn 起点判定锚点，没有理由改形状。

## 已知约束

- 回填只对**当次请求**有效：目标轮被 `chatgptBlockCount` 截断到不在请求里时静默降级为占位符——不报错，也不补发图片。
- 不改存储形态，所以下一轮对话仍然看不到历史图片（要重新引用）。这是刻意保留的取舍，不是遗漏。
- 每轮工具调用都会重发图片，token 成本随轮次线性增长——与 Claude、Responses 的现状一致，是 stateless 协议的固有代价。
- 回填依赖「本轮原始内容」沿递归/循环透传（`turnParts` / `turnContent`）：Gemini 的递归 clone 必须保留它；OpenAI 侧的用户消息 id 必须在进入工具循环之前取（第二轮起响应的 parent 已是 tool 消息）。
- OpenAI 的响应消息带一份 `conversation` 请求副本（`apps/chat.js` 的建议回复会读它），里面仍有 base64——这是既有行为，本次不清理。所以「库里没有 base64」只对会话链上的用户/工具消息成立，别把它写成全称结论。
- OpenAI 侧回放时必须逐段复制 content：`syncInnerOs` 会原地改首个 text part，共享数组会把全局提示写回调用方持有的原始内容。
- Gemini 侧只覆盖首段文本、其余 parts 用本轮原始内容：首段文本以历史为准，否则会盖掉 `syncInnerOs` 刚写入的全局提示。

相关执行记录：`.scratch/quoted-image-tool-round/spec.md`；一手依据见同目录 `research.md`。
