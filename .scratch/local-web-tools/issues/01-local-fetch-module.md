# 01: 本地取页模块与 HTML→Markdown 转换器

**What to build:** 一个「给 URL，拿回解码后的正文」的内部能力，两个本地工具后面都靠它。它负责协议校验、私网拦截、重定向跟随、字节上限、编码判定与 HTML→Markdown 转换。这一票不改变任何用户可见行为，是后续两票的前置改造。

**Blocked by:** None (can start immediately)

**Status:** done（2026-10-21）

- [x] 新增运行时依赖 `htmlparser2`，锁文件同步更新
- [x] 移植 opencode 的 HTML→Markdown 转换器（含纯文本提取分支），能正确处理标题、段落、列表、代码块、表格、链接；标题从**转换前**的原始 HTML 取
- [x] 编码按 `content-type` 的 charset → 前 4 KiB 的 `<meta charset>` → utf-8 三级回退，`gbk` / `gb18030` / `big5` 走 Node 的 `TextDecoder`
- [x] 只接受 http/https；带内嵌用户名密码的 URL 直接拒
- [x] 私网 / loopback / 链路本地 / `0.0.0.0` 目标在发请求前被拒；每一跳重定向都重新校验，最多 5 跳
- [x] 非文本 `content-type`（PDF、图片、二进制）在读取正文前就失败，提示不支持
- [x] 响应体上限 5 MiB、超时 30 秒，超限与超时都归一成带原因的失败
- [x] 手工验证一次：拿一个真实页面（含表格或代码块的）跑通，打印 Markdown 开头若干行确认形状正常
