# research：AstrBot 展开合并转发时的上限与嵌套层数

- 日期：2026-10-26
- 问题：参考仓库 AstrBot（`E:/myrepo/参考/AstrBot`，非本仓）展开 QQ 合并转发时，有没有节点数/字符数上限？嵌套转发最多展开几层？
- 相关：[spec.md](spec.md)（待写）

## 一手来源

| 来源 | 用途 |
| --- | --- |
| `astrbot/core/utils/quoted_message/settings.py` | 三个解析上限的默认值与覆盖解析 |
| `astrbot/core/utils/quoted_message/chain_parser.py` | 节点渲染、内嵌 `content` 递归、占位符判定 |
| `astrbot/core/utils/quoted_message/extractor.py` | 触发条件、`get_msg` → `get_forward_msg` 编排、forward id 的 BFS |
| `astrbot/core/utils/quoted_message/onebot_client.py` | action 调用与参数兼容、失败处理 |
| `astrbot/core/astr_main_agent.py` | 引用文本的最终包装（`<Quoted Message>`）与有限配置读取 |
| `astrbot/core/config/default.py` | 默认配置与配置面板文案 |

结论只依据上述源码；AstrBot 文档未描述这几个上限的语义，不作为依据。

## 结论速览

| 维度 | AstrBot 现状 | 证据 |
| --- | --- | --- |
| 转发节点**条数**上限 | **没有**。`get_forward_msg` 返回多少节点就渲染多少 | `chain_parser.py:363-402`（无长度/条数判断） |
| 展开文本**字符数**上限 | **没有**。无截断、无 token 预算裁剪 | `chain_parser.py`、`extractor.py` 全文无长度判断 |
| 引用组件链递归深度 | `max_component_chain_depth`，默认 **4** | `settings.py:7`、`default.py:166` |
| 内嵌 `content` 的节点递归深度 | `max_forward_node_depth`，默认 **6**（`depth` 从 0 起，`depth > 6` 才停 → 允许 0..6 共 **7 层**） | `settings.py:8`、`chain_parser.py:355` |
| 按 forward id 的嵌套拉取 | 广度优先队列，**没有层级上限**；只受 `max_forward_fetch`（默认 **32** 次 `get_forward_msg`）约束 | `extractor.py:35-60` |
| 拉取失败重试 | 每个 action 按参数变体最多试 4 次（`message_id` / `id` × 字符串 / 数字），**没有超时** | `onebot_client.py:102-118` |
| 同一消息重复拉取 | **无缓存**：文本一次、图片一次，`get_msg` 与 `get_forward_msg` 各走一遍 BFS | `extractor.py:127,140,190` |
| 触发条件 | 只有**引用**才展开，且要求引用文本是纯占位符（`[Forward Message]` / `[转发消息]` / `[合并转发]`） | `chain_parser.py:25-28,61-67`、`extractor.py:156-170` |
| 直接发送（非引用）的转发 | **不展开**，只留 `Forward(id=…)` 组件；无文本时甚至不会发起 LLM 请求 | `aiocqhttp_platform_adapter.py:405-419`、`astr_main_agent.py:1833-1837` |
| 给 LLM 的最终形态 | `<Quoted Message>\n(昵称): 节点文本\n</Quoted Message>`，追加为一条 user 内容块 | `astr_main_agent.py:929-941,984-986` |

## 证据

### E1 · 三个上限的默认值与语义

```python
# settings.py:7-9
_DEFAULT_MAX_COMPONENT_CHAIN_DEPTH = 4
_DEFAULT_MAX_FORWARD_NODE_DEPTH = 6
_DEFAULT_MAX_FORWARD_FETCH = 32
```

配置面板对三者的描述（`default.py:4294-4314`）：

- `max_component_chain_depth`：解析 Reply 组件链时允许的最大递归深度。
- `max_forward_node_depth`：解析合并转发节点时允许的最大递归深度。
- `max_forward_fetch`：递归拉取 `get_forward_msg` 的最大次数。

### E2 · 内嵌 `content` 的递归：深度 6 是「节点内再套节点」

```python
# chain_parser.py:349-356
def _extract_text_forward_ids_and_images_from_forward_nodes(nodes, *, depth=0, settings=SETTINGS):
    if not isinstance(nodes, list) or depth > settings.max_forward_node_depth:
        return None, [], []
    indent = "  " * depth
```

```python
# chain_parser.py:315-327：段里带 content 时递归，depth=1 起
elif seg_type in ("forward", "forward_msg", "nodes"):
    fid = seg_data.get("id") or seg_data.get("message_id")
    if isinstance(fid, (str, int)) and str(fid):
        forward_ids.append(str(fid))
    else:
        nested_nodes = seg_data.get("content")
        ... depth=1 ...
```

顶层 `depth=0`，每一层 `content` 递归 `+1`，`depth > 6` 直接返回空。**这条路径最多 7 层（0..6）**，超出部分静默丢弃。

### E3 · 按 id 的嵌套拉取：BFS，层级被压平

```python
# extractor.py:35-54
fetch_count = 0
while pending and fetch_count < max_fetch:
    current_id = pending.pop(0)
    ...
    parsed = payload_parser.parse_get_forward_payload(forward_payload)
    for nested_id in parsed["forward_ids"]:
        if nested_id not in seen:
            pending.append(nested_id)
```

每次 `parse_get_forward_payload` 都从 `depth=0` 重新开始（`chain_parser.py:446-451`），所以**按 id 套娃的层级信息会丢失**，所有层级的文本平铺拼接；真正的约束是「最多拉 32 次」，不是「最多几层」。

### E4 · 只有引用且引用文本是纯占位符才展开

```python
# chain_parser.py:25-28
_FORWARD_PLACEHOLDER_PATTERN = re.compile(
    r"^(?:[\(\[]?[^\]:\)]*[\)\]]?\s*:\s*)?\[(?:forward message|转发消息|合并转发)\]$",
    flags=re.IGNORECASE,
)
```

```python
# extractor.py:164-178
if embedded_content.embedded_text and not is_forward_placeholder_only_text(...):
    return embedded_content.embedded_text      # 有真实文本就不远程拉
```

混合内容（引用消息里既有文字又有转发）**不会**展开。

### E5 · 多媒体：只有图片留下地址

```python
# chain_parser.py:284-298
elif seg_type == "image":
    text_parts.append("[Image]")
    candidate = seg_data.get("url") or seg_data.get("file")
    ...
elif seg_type == "video":
    text_parts.append("[Video]")          # URL 丢弃
elif seg_type == "file":
    text_parts.append(f"[File:{file_name}]")   # 仅当文件名像图片时才收 URL
```

语音（`record`）没有任何分支：不留占位符、不留地址。图片最终作为独立 `image_url` 内容块下载并转 base64（`astr_main_agent.py:1695-1700`、`image_input.py:73-105`），**不是** markdown 给 URL。

### E6 · 没有「LLM 主动读取合并转发」的工具

`astrbot/core/tools/` 全部内置工具中无 `get_forward_msg` 调用；全仓生产代码里 `get_forward_msg` 只有 `extractor.py:43` 一处。唯一读消息的工具是 `get_group_message_history`，读的是持久化历史库，不碰 OneBot API（`tools/message_tools.py:367-560`）。

## 对本插件的含义

1. **不能照抄「无上限」**：本仓要求「第三方内容标为不可信数据并限制输出长度」；而且引用转发的展开文本会拼进 `prompt`，`apps/chat.js` 会把整条 prompt 写进会话历史，没有上限等于永久占上下文。
2. **「嵌套展开层数」在 AstrBot 里是两个不同的数**：内嵌 `content` 的递归深度（6，实际 7 层）与按 id 的 BFS 拉取次数（32）不是一回事；后者没有层级概念且会丢失缩进。我们若要「只展开 N 层」，需要自己显式按层计数，不能套用这两个数。
3. **参数兼容值得借鉴**：`get_forward_msg` 依次尝试 `message_id` / `id` 的字符串与数字四种写法（`onebot_client.py:111-118`）。本仓适配器只发 `{ message_id }`（`plugins/adapter/OneBotv11.js:279-289`），不同协议端对字段名的容忍度尚未验证。
4. **失败语义**：AstrBot 在全部尝试失败时返回 `None`，文本为空时回落到引用自身的占位文本（`extractor.py:172-187`）；没有「告诉模型读取失败」这一步。
