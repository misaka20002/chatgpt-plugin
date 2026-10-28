# 自主回复判断：候选标签协议

状态：已实现（2026-10-28）。决策记录见 `docs/adr/0009-autoreply-candidate-label-protocol.md`；术语见根 `GLOSSARY.md` 的「判断批次 / 候选消息 / 候选标签」。

## 问题

线上出现 `[ChatGPT][自主回复] … 判断失败，不回复：回复判断选择了本批次之外的消息`。触发点是 `utils/groupReply.js` 里 `candidates.get(decision.messageId)` 落空后抛错：模型给了 `confidence > 0`，但编号映射不到本批候选，整轮被放弃（`pending` 在调用模型前已清空，这批消息不会再被判断）。

三类来源：

1. **类型/格式不匹配**：Map 键是字符串 `String(++this.sequence)`，模型返回数字必然 miss；空格、大小写同理；
2. **语义越界**：`history` 里非候选消息（机器人自己的发言、@机器人消息、指令、上一轮旧消息）与候选共用同一编号空间且直接暴露，模型可能挑一条「更值得接」的旧消息；
3. **字段缺失或协议回显**：`messageId` 缺失、为 `null`，或直接把示例里的占位文字抄回来。

## 目标

- 从协议上消除「模型能指认批外消息」的可能，而不是把失败做成静默。
- 编号类型/格式不匹配这一类归零。
- 残留非法不再抛异常：不回复，单行 info 日志带模型原始返回值，便于判断残留属于哪一类。

## 非目标

- 不以减少日志行为为目标（日志由两条降为一条是副产品）。
- 不改动 `SubLLM` 的结构化输出能力，不新增锅巴配置项。
- 不做非法时的兜底回复，也不做纠正重问。

## 协议

输入：

```json
{
  "candidateLabels": ["c1", "c2"],
  "history": [
    { "userId": "123", "name": "群友", "text": "旧消息", "isBot": false },
    { "userId": "456", "name": "群友", "text": "候选一", "isBot": false, "candidate": "c1" }
  ]
}
```

- 候选按 `history` 顺序编号 `c1…cN`，只在一批内有效，跨批次不保持含义。
- 非候选条目不携带任何编号字段：`id`、`sourceId`、`claim` 都不投影给模型。
- 输出：`{"confidence":0.65,"candidate":"c2"}`。

## 判定

`candidate` 经 `trim` + 小写归一化，接受 `c2` / `C2` / `  c2 ` / `2` / `2`（数字），只认 1..N 的序号；映射不到候选即不回复，日志形如：

```
[ChatGPT][自主回复] Bot … 群 … ：不回复，评分 90% ≥ 60%（热情度 40%），候选 未提供有效编号（模型返回 "c9"，本批 c1-2）
```

## 验收

- 数字、空格、大写、纯序号都能命中对应候选。
- `c9`、缺失、非字符串标签：不回复，`errors` 为空，info 行含原始返回值与本批标签区间。
- 非候选 history 条目无 `id` / `candidate`；候选条目带 `candidate`。
- `npm run test:group-reply`、`npm run test:config` 通过。

## 影响面

`utils/groupReply.js`、`utils/groupReplyConfig.js`、`test/groupReply.test.mjs`、`docs/agent-guides/runtime.md`、`GLOSSARY.md`（新增三条术语）、`docs/adr/0009-autoreply-candidate-label-protocol.md`（新增）、本文件。

## 实现记录

- 生产行为按上文落地：`utils/groupReply.js` 在限额预筛后编号，`candidateLabels` + `history[].candidate`，非法标签走「不回复 + 单行 info」；`confidence` 为 0 但标签非法时同样记录原始返回值，保证非法编号计数不被「本来就不回复」掩盖。
- 测试侧修掉三处与生产代码脱节的既有断言（在 HEAD 上可直接复现）：logger stub 缺 `debug` 导致 `run()` 失败时产生 unhandled rejection；两处用 `errors.length` 断言判断失败，而判断失败实际走 `logger.info`。
- 基线对照用 `git show HEAD` 版本跑同一套件，改前为红、改后为绿；具体读数以当次 Node 输出为准，本文件不写死用例数。
- `npm run test:group-reply`、`npm run test:config`、`npm run check` 均已通过。
