# 04: 文档、术语、ADR 与锅巴文案

**What to build:** 把这次改动反映到维护者会读的地方：术语表能区分两种网页读取实现、工具指南不再推荐用本地工具做 JS 渲染、锅巴不再要求安装 Python，并且有一份 ADR 解释为什么在 ADR 0004 说「不做自建抓取」之后仍然升级了这个本地工具。

**Blocked by:** 02、03（文档要描述最终行为）

**Status:** done（2026-10-21）

- [x] `GLOSSARY.md` 把「网页读取」拆成**托管提取**与**本地抓取**两条，各自给出边界；「续读」补一句本地抓取是重新下载整页再切片
- [x] `docs/agent-guides/tools.md` 更新两个本地工具：兜底定位、无 JS 渲染、被限流/反爬时的表现；删除「需要 JS 渲染的页面仍用 `local_WebsiteTool`」
- [x] 新增 ADR 0005：记录 22 个目标的 HTTP 与 puppeteer 对比数据、为什么 0004 的结论不覆盖这个既有工具、为什么在「纯 HTTP / 自动回退 / 保留 puppeteer」里选纯 HTTP
- [x] 锅巴 `serpSourceArr` 的帮助文案删掉 python3 与 pip 安装说明；两个选项标签保留「呆毛纯本地搜索工具」「呆毛纯本地网页读取工具」（工作区已有一处未提交的标签改动，属于本次改动，随本票一起提交）
- [x] 全仓搜一遍 `web_search.py` / `beautifulsoup4` / `googlesearch` 的残留引用，确认没有过时说明
