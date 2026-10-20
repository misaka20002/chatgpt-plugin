# 02: 搜索工具改纯 Node（Bing → DuckDuckGo → 百度）

**What to build:** 锅巴里的「呆毛纯本地搜索工具」不再需要 Python。选中它之后，模型搜一个词就能拿到带真实链接、摘要和少量正文的结果；某个引擎被限流或改了结构时自动换下一个，全挂时说明每个引擎的原因。

**Blocked by:** 01（本地取页模块与转换器）

**Status:** done（2026-10-21）

- [x] 删除 `utils/web_search.py` 及其调用路径；在没有 Python、或 Python 里没装任何第三方包的机器上，工具都能正常返回结果
- [x] 引擎顺序固定为 Bing → DuckDuckGo(HTML) → 百度，任一有结果即返回；全失败时错误文本逐条列出引擎名与原因（如 `Bing: HTTP 403；DuckDuckGo: 请求超时；百度: 解析不到结果`）
- [x] 结果链接是真实地址：百度取结果节点的 `mu` 属性、DuckDuckGo 解码 `uddg` 参数，输出里不出现 `baidu.com/link?url=` 这类跳转链
- [x] 并发抓前 3 条正文（每条截 2000 字符，整体 8 秒预算），单条失败只退回摘要，不影响其余结果与整次调用
- [x] 输出与 `tavily_search` 同构：来源行（含命中的引擎）+ 不可信声明 + 每条 `## [标题](url)` + 摘要 + 正文摘录，总长沿用同一套封顶
- [x] 工具描述写明这是本地兜底：可能被站点限流或反爬，读不到正文时改用其它来源
- [x] 最小测试并接进 `test:tools`：百度 `mu` 与 DuckDuckGo `uddg` 解析、Bing 失败降级到 DuckDuckGo
