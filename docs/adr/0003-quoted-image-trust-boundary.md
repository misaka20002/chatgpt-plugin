# 引用图来源可信度分层：事件地址放行私网，模型地址仍严格校验

状态：已采纳（2026-10-19）。

`recognize_media` 工具收到的地址来自模型 tool arguments，长期按不可信输入处理：`url2Base64` 关闭本地文件与内网访问，逐跳校验并固定连接目标。但 QQ 图 CDN 会调度到 CGNAT（`100.64/10`）与代理 fake-ip 的 `198.18/15`（原先被当 benchmark 段拒绝）——这些地址对「本次消息里真实存在的图片」是正常的，严格拦截会把引用图全部挡在门外，报「媒体地址解析到内网或本机，已拒绝」。现改为**按来源分层**：地址与本次事件里的媒体地址（`e.img` / `e.get_Video[].url`，按 CQ 还原后字符串相等）一致、或由工具自己拼的头像地址，按可信来源处理（`allowPrivateNetwork: true`）；其余地址仍走严格校验，PR #10 的可信域名白名单与「回环/链路本地永远拒绝」保留为纵深防御。原生多模态路径（`e.img` 直接下载）本来就来自事件，不走严格校验。

## 考虑过的替代方案

- 只扩可信域名后缀（QQ 图片 CDN 白名单）：否——挡不住自建图床与 NapCat 返回的内网地址，而模型自造地址仍需要严格校验，白名单解决不了「同一条 URL 在不同来源下风险不同」。
- 加配置开关直接关掉严格校验：否——等于把 SSRF 防护交给用户配置，误配即失去边界；`mediaRecognitionSource = 专用识别` 已能作为退路。
- 让 `getImageBase64` 继续裸 `fetch`：否——没有大小上限、不走 `Config.proxy`、不识别真实 MIME，PNG/GIF 被标成 jpeg 送给 Claude/Gemini 会 400。

## 已知约束

- “可信”只覆盖私网/CGNAT/benchmark 段；回环、链路本地（含云元数据 `169.254.169.254`）、未指定与组播仍然一律拒绝，即便域名可信。IPv4-mapped、IPv4-compatible 与 WKP NAT64（`64:ff9b::/96`）的写法都要拆出内嵌 IPv4 再判，否则 `64:ff9b::a9fe:a9fe` 会被当公网放行。
- 可信来源的豁免只覆盖 IPv4 私网 / CGNAT / benchmark（含 mapped 与 WKP NAT64 变形）；ULA（`fc00::/7`）、site-local（`fec0::/10`）、local-use NAT64（`64:ff9b:1::/48`）不在豁免内——它们不是 CDN 调度会给出的地址。字面量 IP 与域名解析两条路径同口径。
- 可信来源是独立开关（`trustedMediaSource`），**不**复用 `untrustedSource`：后者同时管本地文件与媒体类型校验，合并使用会把 `file://`、`base64://` 和 `video/*` 校验一起放开。
- 可信判定有两层，别混为一谈：① 事件地址精确匹配（`trustedMediaSource`，字符串相等，模型改一个参数就失效）；② 可信域名后缀白名单（`isTrustedMediaHost`，PR #10 引入的 QQ 图系域名兜底，模型自造的 `*.qq.com` 地址也能命中）。第二层比第一层宽，只作为「不会解析到回环/元数据」的纵深防御，不改变本地文件与媒体类型校验。
- 连接固定会覆盖 `Config.proxy`：严格模式（`allowPrivateNetwork: false`）与 `enforceAlwaysBlocked` 都固定连接目标，因此都走直连；只有旧的 `allowPrivateNetwork: true` 且未开 `enforceAlwaysBlocked` 的路径才用 `newFetch` 走代理。引用图（原生多模态）走的是前者，所以它不走代理——这是用「能拦回环/云元数据」换掉「可走代理」，需要代理的部署要显式接受。

相关执行记录：`.scratch/quoted-image-multimodal/spec.md`。
