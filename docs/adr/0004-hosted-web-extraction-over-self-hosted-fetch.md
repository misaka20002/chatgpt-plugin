# 网页读取走供应商托管提取，不自建抓取

状态：已采纳（2026-10-21）。执行记录见 `.scratch/web-fetch-tools/spec.md`。

插件需要「给一个 URL，读回正文」的能力。原有两条路：`WebsiteTool`（puppeteer 渲染）与 `TavilyExtractTool`（需 Key、正文硬截 2000 字符）。本轮实测了第三条路——移植 opencode 的 `webfetch`（纯 HTTP + 本地 HTML→Markdown）——结果是**三条路里最弱的一条**：15 个目标中 10 个可用；知乎、Reddit、Medium 直接 403，微博返回 200 但转换出 0 字符；GitHub 仓库页 44249 字符里正文从第 13879 字符才开始；晋江（gb18030）整页乱码。同一批语料上，Parallel 的托管提取（免 Key）读到 Reddit 46882 字符、微博 12009、36氪 4597，还能读 PDF。

因此决定：**不做本地抓取**，把网页读取实现为对供应商提取 API 的薄封装，做成两个独立工具 `exa_webfetch` 与 `parallel_webfetch`，各自用对应 Key、互不回退；两个 Key 都不填时仍可走免 Key 额度（Exa 免 Key 在数据中心 IP 上实测 429，Parallel 可用）。Exa 侧按「有没有 Key」分两条通道：配了 Key 走 REST `/contents`（响应形状有官方文档保证），没配 Key 走 MCP `web_fetch_exa`（免额度，但成功态形状本机无法验证）。

## 考虑过的替代方案

- **移植 opencode 的 `html-markdown.ts` + `htmlparser2`**：否——反爬全挂是方案固有上限，且要额外承担 GBK 解码、正文提取、私网校验三件事，收益只在不依赖第三方。
- **只做一个工具、两家自动回退（照搬 `opencode_websearch` 的选路）**：否——抓取是「一次一份内容」，两家结果质量差异明显，隐式回退会让模型无法判断拿到的是谁提取的；用户也明确要求两个 Key 分开配置。
- **继续只靠 Tavily 提取**：否——单点依赖，且现有实现 2000 字符上限对长文无意义。
- **Exa 只走 MCP 一条通道**：否——MCP 成功态的真实响应形状在本机无法验证（免额度一直 429），把主力路径押在未验证的解析上不划算；配 Key 的用户走有文档保证的 REST 更稳。
- **Exa 只走 REST**：否——没 Key 时 REST 直接 402，等于把免额度通道关掉。

## 已知约束

- URL 交给第三方，站点看到的是供应商出口；`Config.proxy` 对这两条路径无效（请求由插件直接发往供应商，不走站点抓取）。
- Exa 免 Key 档按 IP 限流，数据中心 IP（Bot 常见部署环境）实测必 429；Parallel 免 Key 档按 `session_id` 限流，`session_id` 是「进程盐 + 群号/QQ 号」的哈希，不能直接发群号。
- 「状态成功但内容是验证页」（知乎）无法通用识别，工具原样返回并标不可信；是否识别交给模型判断，不做启发式拦截。
- 输出统一 20,000 字符上限 + `start` 续读；供应商侧截断（Exa `maxCharacters`）与本地截断要一起考虑：Exa 请求 `start + 20000`，Parallel 拉全文后本地切片。
