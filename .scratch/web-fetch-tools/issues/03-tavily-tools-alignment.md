# 03: Tavily 两个工具对齐

**What to build:** `tavily_website_extract` 能读完整篇文章——上限从 2000 提到 20000 字符、支持 `start` 续读、`failed_results` 按失败返回、输出带 `Provider: Tavily` 与不可信声明；`tavily_search` 的结果带同样口径的不可信声明与 20000 总长封顶，参数与文案保持现状。

**Blocked by:** 01（复用其内容格式化模块）

**Status:** ready-for-agent

- [ ] 提取工具单次回填上限为 20000 字符；超过时追加截断标记并给出可续读的 `start`
- [ ] `start` 生效：对同一 URL 传不同偏移能拿到对应片段
- [ ] `failed_results` 非空且 `results` 为空时按失败返回，错误信息包含失败 URL 与原因（沿用该文件既有的 `throw` 风格，不做风格迁移）
- [ ] 提取结果以 `Provider: Tavily`、`URL`、`Title` 开头，并带不可信声明；不再输出原来的中文分段文案
- [ ] `extract_depth` 参数保留，`basic`/`advanced` 的取值校验行为不变
- [ ] 不新增 `format`、`include_images`、`query`、`chunks_per_source` 参数
- [ ] 搜索工具输出带不可信声明；总长超 20000 字符时截断并加标记；`q` 参数名、请求字段与原有摘要文案不变
- [ ] 新增测试覆盖：提取的 2000 → 20000 行为变更、`start` 续读、`failed_results` 失败、Provider 与不可信声明、搜索的封顶与声明
- [ ] 工具指南更新 Tavily 两个工具的说明（上限、续读、不可信声明）
