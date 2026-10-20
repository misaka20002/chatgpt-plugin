# 02: Parallel 网页读取工具 + 会话标识共用

**What to build:** 锅巴「搜索/网络来源」多一个「Parallel 网页读取（免 Key 可用）」选项。开启后模型拿到 `parallel_webfetch`：给一个 URL，读回正文（PDF 也可读），输出契约与 Exa 工具一致。免 Key 走免费档，配了 Parallel Key 走付费档；发给 Parallel 的会话标识与联网搜索共用同一份哈希实现。

**Blocked by:** 01（复用其内容格式化模块）

**Status:** done（2026-10-21）

- [x] 锅巴出现新选项，勾选后模型可见 `parallel_webfetch` 的 schema（`url` 必填、`start` 可选），未勾选时不出现
- [x] 请求发往 Parallel MCP，调用 `web_fetch`，参数含 `full_content: true` 与 `session_id`
- [x] 配了 Parallel Key 时带 `Authorization: Bearer`，未配时不带，且免 Key 仍能读到内容
- [x] 返回文本把 `results[0].excerpts` 拼成正文，带 `Provider: Parallel`、`URL`、`Title` 与不可信声明
- [x] `results` 为空且 `errors` 非空时返回 `Error: …`，包含 `error_type` 与 HTTP 状态码；429 时提示可配置 Parallel API Key
- [x] 20000 字符截断与 `start` 续读行为与 Exa 工具一致（共用实现，不复制逻辑）
- [x] `session_id` 为 32 位十六进制、同一群稳定、不同群不同、不含真实群号；该哈希只有一份实现，联网搜索与网页读取共用
- [x] 单次请求超时 90 秒，超时按失败返回
- [x] 新增测试覆盖：`excerpts` 拼接、per-URL `errors`、空 `results`、429、Bearer 有无、`session_id` 稳定性与不含群号
- [x] 工具指南的「网页读取」小节补 Parallel 的差异（PDF 可读、按会话限流）
