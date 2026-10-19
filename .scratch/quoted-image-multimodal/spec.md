# 引用图原生多模态（quoted-image-multimodal）

Status: ready-for-human
日期：2026-10-19

## 背景

QQ 群/私聊里「引用一张图再问」是高频用法。当前实现分两条路：

- `mediaRecognitionSource = Gemini`：识别成一段文字再拼进 prompt（无原生多模态）。
- `mediaRecognitionSource = Orignal`：`model/core.js` 把 `e.img[0]` 转 base64 后按 provider 协议内联，四个分支（api / responses / claude / gemini）都写了，但共用 `getImageBase64()` —— 裸 `fetch`、无大小上限、不走 `Config.proxy`、不认 CQ 转义、不探测 MIME（调用方硬写 `image/jpeg`），失败只 `console.error`。结果：PNG/GIF 被标成 jpeg、大图无边界、失败静默。

同时线上出现 `[url2Base64 错误] 媒体地址解析到内网或本机，已拒绝`。定位结论：严格模式（`allowPrivateNetwork: false`）只被 `recognize_media` 工具使用，模型拿着 QQ 图 URL 调工具时被私网/benchmark 段拦截。本次排查还确认（本机开着 TUN 时所有域名解析到 `198.18.0.x`，落在 `isDisallowedIpv4` 的 benchmark 分支）。

## 已确认的事实

1. `&amp;` 只存在于 NapCat 的 `raw_message`（`cqcode.ts` 的 `CQCodeEscape`，唯一调用点 `api/msg.ts:1134`）；消息段数组里的图片 `url` 来自 `FileApi.getImageUrl`，未转义，`e.img` 由 `loader.js:402` 直接取自该数组。实测同一地址把 `&` 换成 `&amp;` 会返回 `400 invalid rkey`。→ PR #10 的 `unescapeCqCode` 保留（覆盖群上下文里 `chat.raw_message` 抄出来的 URL），但不是 `e.img[0]` 失败的原因。
2. 视频：`recognitionResultsByGemini` / `recognitionResultsByCurrentModel` 都限定 `gemini` 类型；`core.js` 四个分支只读 `e.img`，从不内联视频。→ 视频维持现状（仅 Gemini，走识别函数）。
3. `getImageBase64` 仅 `model/core.js` 4 处调用。

## 需求

### R1 地址判定按来源分层

- 服务端事件 `e` 带来的媒体地址（`e.img` / `e.get_Video[].url`，按 unescape 后字符串相等匹配）视为可信：**只**跳过私网/benchmark 拦截；豁免范围限 IPv4 私网、CGNAT、benchmark（含 mapped 与 WKP NAT64 变形），ULA / site-local / local-use NAT64 不豁免。
- 模型在工具参数里给的地址只有命中上述集合才同等待遇——「同等待遇」仅指私网豁免；本地文件、`base64://` 与媒体类型校验一律保持严格，不能用一个开关同时放大。
- 即便来源可信，回环、链路本地（含云元数据）仍拒绝；IPv4-mapped、IPv4-compatible 与 WKP NAT64 的写法都要按内嵌 IPv4 判定。
- 本次不放配置开关，不新增面板字段。

### R2 引用图下载走统一通道

`getImageBase64` 的职责替换为：

1. 走 `url2Base64`（CQ 还原），不带 `e` 以避免失败时 `reply`；私网/CGNAT 放行但仍固定连接、拦回环与云元数据（`enforceAlwaysBlocked`），因此这条路径不走 `Config.proxy`；下载上限固定 **10 MB**，超过即视为不可用。
2. `sharp` 探测真实格式；探测不到视为失败。
3. **不做尺寸预处理**：不缩放、不裁剪，保持原始分辨率与画面内容。
4. 只有三种情况转 jpeg（质量 85，仍然不缩放）：原始体积 > **2 MB**、动图（gif，取首帧）、格式不在 jpeg/png/webp/gif 之内。
5. 失败或原始体积 > 10 MB：该图丢弃并 `logger.warn` 真实原因；prompt 追加一句「引用的图片获取失败，请勿臆测图片内容」。
6. **一轮只取一次**：取图结果缓存在 `opt.prepared.quoted`（一次 `sendMessage` 的生命周期），主备 provider 切换复用同一份；失败结果同样复用——一轮内重试下载只会放大延迟。

> 10 MB 是硬上限（丢弃），2 MB 是「转码阈值」（仍保留）。两个数不能合并：2–10 MB 的图要能进模型，只是换成 jpeg 更省流量。

### R3 多图

- 送 `e.img` 的全部条目，上限 4 张；超出部分不再送去模型。
- 用 `logger.info` 记录实际张数与上限（不用 warn：这是正常业务边界）。

### R4 四个 provider 的载荷

| provider | 结构 |
| --- | --- |
| `api`（OpenAI Chat） | `[{type:'text'}, {type:'image_url', image_url:{url}}...]` |
| `responses` | `[{role:'user', content:[{type:'input_text'}, {type:'input_image'}...]}]` |
| `claude` | 文本块 + N 个 `{type:'image', source:{type:'base64', media_type, data}}` |
| `gemini` | `parts: [{text}, {inline_data:{mime_type, data}}...]` |

`SubLLM` 的单 `media` 契约保持不变，客户端新增 `opt.medias`（数组）与之并存。

### R5 失败文案不进对话历史

- 引用图失败提示只并入**本轮 system 指令**（`appendMediaFailureHint`），不拼进用户消息：四种客户端都会把 user 消息（含 `originalContent`）写进会话存储，拼进去会让提示跨轮残留。
- 提示不写进 `opt.prepared.system` 缓存：该缓存跨主备 provider 复用，写进去会让备用尝试带着主尝试的失败状态，反之亦然。由 `resolveTurnSystem` 保证「缓存存基础版本、提示按尝试追加」。
- 提供商 API 错误（如 `429 upstream rate limit reached`）只作为当轮错误回复给用户，**不写入**会话历史、不进入下一轮上下文；`test/providerClients.test.mjs` 用「失败轮 upsert 为空」断言这一点。

## 非目标

- 视频内联给非 Gemini provider。
- `apps/tts_voice_help.js`、`apps/派蒙meme.js` 里的直连 `fetch`（PR 已注明为独立议题）。
- 改写 `mediaRecognitionSource = Gemini` 的文字识别路径。
- 任何尺寸/画幅预处理（不缩放、不裁剪、不按长边限额重采样）。

## 验证

- 新增 `test/quotedImageVision.test.mjs`：MIME 探测、2 MB 阈值转码、gif 首帧、超 10 MB 丢弃、4 张截断、事件 URL 可信判定（含 `&amp;`）、四种载荷结构。
- `test/mediaUrlGuard.test.mjs`：可信域名 + CGNAT 放行、可信域名 + 回环（含 IPv4-mapped 与 WKP NAT64 写法）拒绝、非可信 + 私网拒绝。
- `npm run test:media`、`npm run check`、改动文件的 `node --check`。
