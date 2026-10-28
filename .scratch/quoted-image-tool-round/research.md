# 引用图 + 工具轮：一手依据调研

调研对象：Gemini 官方文档 / 官方仓库；AstrBot 参考实现（`E:\myrepo\参考\AstrBot`，`pyproject.toml` 版本 4.29.3，HEAD 为 `v4.29.3-8-g832fc6d98`）。

## 一、Gemini 官方协议：图片必须留在最初那个 user 轮

| 问题 | 结论 | 依据 |
| --- | --- | --- |
| 每次请求都要自带完整历史？ | 是。`generateContent` 无状态，`contents` 是该次请求唯一的上下文来源 | 「Because the Gemini API is stateless…」<br>`GenerateContentRequest.contents`：「Required. The content of the current conversation with the model… contains the conversation history and the latest request.」<br>https://ai.google.dev/api/generate-content |
| 官方多模态 + function calling 示例里，工具轮还带首轮图吗？ | 带。示例把首轮 user 消息原封不动留在 `contents`，只追加 model 的 functionCall 轮与 functionResponse 轮 | Vertex AI「Multimodal function calling」及官方 notebook：`contents=[UserContent(parts=[Part.from_uri(image), Part(text)]), model_response_content, Content(role='tool', parts=[Part.from_function_response(...)])]`<br>https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling<br>https://github.com/GoogleCloudPlatform/generative-ai/blob/main/gemini/function-calling/multimodal_function_calling.ipynb |
| 一个 `Content` 能否同时有 `inline_data` 和 `functionResponse`？ | 协议未禁止（单 `Part` 只能取 `Part.data` 的一个字段，`parts[]` 是数组、可混类型）；**未找到**「functionResponse 轮只能有 functionResponse」的官方明文 | `Content.parts[]`：「Ordered `Parts`… Parts may have different MIME types.」；`Part`：「A `Part` can only contain one of the accepted types in `Part.data`.」<br>https://ai.google.dev/api/generate-content |
| 官方提到过「工具调用后图片丢失」吗？ | 未找到明文。官方排障页与 `INVALID_ARGUMENT` 原因列表均无此条目 | https://ai.google.dev/gemini-api/docs/generate-content/api-errors<br>https://ai.google.dev/gemini-api/docs/troubleshooting |
| 官方 SDK 的 chat 怎么做？ | 客户端保存历史，每次 `send_message` 把「历史 + 新消息」整体作为 `contents` 发出；图片作为历史 Part 天然每轮重发 | `google/genai/chats.py`：`contents_to_model = self._curated_history + [user_input]`；文档：「For multi-turn conversations, the full conversation history is sent to the model with each follow-up turn.」<br>https://ai.google.dev/gemini-api/docs/generate-content/text-generation |
| `thoughtSignature` 与图片有关吗？ | 无关。签名只出现在 model 响应 Part；用户图片是输入 Part。但首轮 user 内容需逐字保持，它是「当前 turn 起点」的判定锚点 | https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures |

**结论**：`user(text + inline_data) → model(functionCall) → user(functionResponse)` 是官方示例的形态。我们缺的不是「给 functionResponse 轮补图」，而是「第二次请求里原来那个 user 轮的图没了」。

## 二、AstrBot：不剥离 base64，历史自足

| 问题 | 结论 | 依据 |
| --- | --- | --- |
| 历史里图片存什么？ | **data URI（完整 base64）**，且是刻意的 | `astrbot/core/provider/entities.py:218-247` 注释「Extra image paths must also reach providers and persisted history as portable data URIs」 |
| 有没有「落库剥离 base64」？ | **没有**，全仓无 strip/prune 图片再落库的函数 | `tests/test_process_stage_images.py:554-576` 断言 `text_chat(contexts=...)` 与 `update_conversation(history=...)` 的 data URI 字节相同 |
| 工具轮怎么拿到首轮图？ | 进程内 `run_context.messages` 全量重拼，工具结果只 append；provider 侧对每个 `image_url` 再 resolve 成 bytes | `astrbot/core/agent/runners/tool_loop_agent_runner.py:510-511`、`:1102-1105`；`astrbot/core/provider/sources/gemini_source.py:388-437`（`resolve_media_ref_to_base64_data(..., strict=True)`） |
| 「图片只放 user 消息、工具回调轮只回 functionResponse」这句准吗？ | **只对一半**。AstrBot 的 functionResponse 轮确实只有 functionResponse（`gemini_source.py:512-521`），但首轮 user 的图始终在历史里、每轮重发；它没有「第二次请求丢图」的问题 | 同上 |
| `tool_image_cache.py` 解决什么？ | 工具**返回**的图片先落盘、再以新增 user 消息塞回上下文，与「历史图丢失」无关 | `astrbot/core/agent/tool_image_cache.py:1-32`、`tool_loop_agent_runner.py:1107-1137` |
| OpenAI / Anthropic 一致吗？ | 结果一致（历史图每轮都在），细节不同：Gemini/OpenAI 每次重新 resolve，Anthropic **只认 data URI**，非 data URI 直接丢图并告警 | `openai_source.py:997`、`:274-310`；`anthropic_source.py:271-300` |

## 三、对本仓的结论

1. 本仓的注释「AstrBot 同样只在用户消息里放图片，工具回调轮只回 function_response」把 AstrBot 的一半做法当成了全部：它不适用的前提是「历史不剥离 base64」。本仓为了 Redis 体积剥离了 base64，于是同一句话就变成了 bug。
2. 「库里保留占位符 + 请求内回填」与 AstrBot 的差别只在存储形态：**两者发出去的第二个请求形状应当一样**（首轮 user 仍带图）。AstrBot 的额外能力（下一轮对话仍能看见历史图）不是本次目标，属另一项取舍（存储成本 vs 跨轮可见性）。
3. 回填时机不是问题：本仓的 `opt.prepared.quoted` 已在本轮内缓存 base64，不依赖事件临时文件（AstrBot 担心的清理问题在本仓不存在）。
4. 不要照抄 AstrBot 的 `strict=True`：回填失败时应降级为占位符继续，而不是中断整轮请求。
