# 供应商响应样张

真实调用抓取的原始响应，用于锁住「解析器能吃什么形状」。**不要手改响应内容**——接口形状变了就重新抓一份，并在下表更新日期。唯一的例外是**请求侧参数的回显**：Parallel 的 `session_id` 会出现在响应体里，已替换为固定占位值 `fixturecapture0000000000000000`（真实值是进程随机盐加群号的哈希，没有解析价值，也不该进仓库）。

| 文件 | 调用 | 抓取日期 |
| --- | --- | --- |
| `exa-web-fetch-mcp.txt` | `POST https://mcp.exa.ai/mcp` → `tools/call: web_fetch_exa`，`urls=["https://example.com"]` | 2026-10-21 |
| `parallel-web-fetch.json` | `POST https://search.parallel.ai/mcp` → `tools/call: web_fetch`，`full_content: true` | 2026-10-21 |

抓取时观察到的形状（解析器依赖这些事实）：

- Exa 回 `text/event-stream`，`data:` 帧里是 JSON-RPC；`result.content[0].text` 是 **markdown 纯文本**，没有 `title` 字段。
- Parallel 回纯 JSON-RPC；`result.content[0].text` 本身是**字符串化的 JSON**，正文在 `results[0].excerpts[]`，失败明细在 `errors[]`。
