# 工具上下文占用审计

- 扫描目录：`utils/tools/`（共 74 个 .js）
- 识别到工具类：63 个；其余为解析失败/非工具类：2 个
- **已接入 `collectTools`**：53 个，合计 **8238 tokens**（这才是模型真正看得到的上限）
- **未接入**（类存在但没有任何 `new XxxTool()` / 开关注册）：10 个，合计 1328 tokens —— 属于死代码或尚未布线，不占上下文

| # | 工具 name | 类名 | desc tokens | schema tokens | 合计 | 参数字段 | enum 数 | required | 已接入 | 文件 | 动态构造 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Memory_Tool | MemoryTool | 231 | 726 | **957** | 1 | 12 | 1 | ✓ | utils/tools/MemoryTool.js | - |
| 2 | generate_html | GenerateHtmlTool | 331 | 210 | **541** | 3 | 0 | 1 | ✓ | utils/tools/GenerateHtmlTool.js | - |
| 3 | generate_math_markdown | GenerateMathRenderTool | 59 | 335 | **394** | 2 | 0 | 2 | ✓ | utils/tools/GenerateMathRenderTool.js | - |
| 4 | scheduleGroupTask | ScheduleTaskTool | 63 | 255 | **318** | 4 | 6 | 1 | ✓ | utils/tools/ScheduleTaskTool.js | - |
| 5 | github | GithubAPITool | 22 | 268 | **290** | 6 | 4 | 1 | ✓ | utils/tools/GithubTool.js | parameters |
| 6 | tavily_search_and_extract | TavilySearchAndExtractTool | 59 | 177 | **236** | 7 | 10 | 1 | ✗ | utils/tools/TavilySearchAndExtractTool.js | - |
| 7 | tavily_search | TavilyTool | 41 | 187 | **228** | 8 | 8 | 1 | ✓ | utils/tools/TavilyTool.js | - |
| 8 | atOtherUser | AtOtherUserTool | 144 | 77 | **221** | 2 | 0 | 2 | ✓ | utils/tools/At_otherUser.js | - |
| 9 | generate_graph_calculator | GenerateGraphCalculatorTool | 47 | 171 | **218** | 6 | 0 | 1 | ✓ | utils/tools/GenerateGraphCalculatorTool.js | - |
| 10 | emojiLike | EmojiLikeTool | 25 | 188 | **213** | 3 | 28 | 0 | ✓ | utils/tools/EmojiLikeTool.js | - |
| 11 | musicTool | EliMusicTool | 29 | 176 | **205** | 6 | 0 | 4 | ✗ | utils/tools/EliMusicTool.js | - |
| 12 | get_pixiv_images | GetPixivApiLoliconTool | 81 | 122 | **203** | 3 | 0 | 1 | ✓ | utils/tools/GetPixivApiLoliconTool.js | - |
| 13 | web_search | Misaka_WebSearchTool | 137 | 61 | **198** | 2 | 0 | 1 | ✓ | utils/tools/Misaka_WebSearchTool.js | parameters |
| 14 | tavily_website_extract | TavilyExtractTool | 92 | 104 | **196** | 3 | 2 | 1 | ✓ | utils/tools/TavilyExtractTool.js | - |
| 15 | userProfile | UserProfileTool | 144 | 49 | **193** | 1 | 0 | 1 | ✓ | utils/tools/UserProfileTool.js | - |
| 16 | website | WebsiteTool | 110 | 83 | **193** | 2 | 0 | 1 | ✓ | utils/tools/WebsiteTool.js | - |
| 17 | execute_javascript | SandboxJSTool | 98 | 90 | **188** | 2 | 0 | 1 | ✓ | utils/tools/Sandbox_JS.js | - |
| 18 | groupTodo | GroupTodoTool | 49 | 130 | **179** | 2 | 4 | 1 | ✗ | utils/tools/GroupTodoTool.js | - |
| 19 | baidu_AI_Search_Tool | BaiduAISearchTool | 41 | 137 | **178** | 4 | 4 | 1 | ✓ | utils/tools/BaiduAiSearchTool.js | - |
| 20 | parallel_webfetch | ParallelWebFetchTool | 101 | 76 | **177** | 2 | 0 | 1 | ✓ | utils/tools/ParallelWebFetchTool.js | - |
| 21 | exa_webfetch | ExaWebFetchTool | 100 | 76 | **176** | 2 | 0 | 1 | ✓ | utils/tools/ExaWebFetchTool.js | - |
| 22 | blockUser | BlockUserTool | 46 | 124 | **170** | 4 | 3 | 1 | ✓ | utils/tools/Block_User.js | - |
| 23 | jinyan | JinyanTool | 25 | 136 | **161** | 4 | 0 | 2 | ✓ | utils/tools/JinyanTool.js | - |
| 24 | processPicture | ProcessPictureTool | 42 | 107 | **149** | 3 | 2 | 1 | ✗ | utils/tools/ProcessPictureTool.js | - |
| 25 | generate_markmap | GenerateMarkmapTool | 40 | 107 | **147** | 2 | 0 | 2 | ✓ | utils/tools/GenerateMarkmapTool.js | - |
| 26 | recognize_media | RecognitionResultsByGeminiTool | 39 | 100 | **139** | 4 | 0 | 0 | ✓ | utils/tools/RecognitionResultsByGeminiTool.js | - |
| 27 | sendEmoji | EmojiTool | 42 | 94 | **136** | 1 | 20 | 1 | ✓ | utils/tools/EmojiTool.js | - |
| 28 | sendRPS | SendRPSTool | 67 | 65 | **132** | 0 | 0 | 2 | ✗ | utils/tools/SendRPSTool.js | - |
| 29 | kickOut | KickOutTool | 14 | 116 | **130** | 3 | 0 | 1 | ✓ | utils/tools/KickOutTool.js | - |
| 30 | sendNetEaseMusic | SendNetEaseMusicTool | 39 | 89 | **128** | 2 | 0 | 1 | ✓ | utils/tools/SendNetEaseMusicTool.js | - |
| 31 | sendQQMusic | SendQQMusicTool | 37 | 88 | **125** | 2 | 0 | 1 | ✓ | utils/tools/SendQQMusicTool.js | - |
| 32 | sf_image_edit | Sf_image_edit | 55 | 63 | **118** | 1 | 0 | 0 | ✗ | utils/tools/Sf_image_edit.js | - |
| 33 | sendDice | SendDiceTool | 52 | 65 | **117** | 2 | 0 | 2 | ✗ | utils/tools/SendDiceTool.js | - |
| 34 | queryStarRail | QueryStarRailTool | 30 | 85 | **115** | 3 | 0 | 0 | ✓ | utils/tools/QueryStarRailTool.js | - |
| 35 | search | SerpIkechan8370Tool | 46 | 69 | **115** | 3 | 4 | 2 | ✓ | utils/tools/SerpIkechan8370Tool.js | - |
| 36 | sendVideo | SendVideoTool | 45 | 61 | **106** | 2 | 0 | 1 | ✓ | utils/tools/SendBilibiliTool.js | - |
| 37 | localSandbox | LocalSandboxTool | 61 | 39 | **100** | 1 | 0 | 1 | ✓ | utils/tools/LocalSandboxTool.js | - |
| 38 | queryGenshin | QueryGenshinTool | 20 | 79 | **99** | 3 | 0 | 1 | ✓ | utils/tools/QueryGenshinTool.js | - |
| 39 | opencode_websearch | OpenCodeWebSearchTool | 62 | 34 | **96** | 1 | 0 | 1 | ✓ | utils/tools/OpenCodeWebSearchTool.js | description |
| 40 | remoteSandbox | RemoteSandboxTool | 57 | 39 | **96** | 1 | 0 | 1 | ✓ | utils/tools/RemoteSandboxTool.js | - |
| 41 | imageCaption | ImageCaptionTool | 21 | 74 | **95** | 3 | 0 | 0 | ✗ | utils/tools/ImageCaptionTool.js | - |
| 42 | sendAvatar | SendAvatarTool | 27 | 63 | **90** | 2 | 0 | 2 | ✓ | utils/tools/SendAvatarTool.js | - |
| 43 | setTitle | SetTitleTool | 20 | 69 | **89** | 3 | 0 | 2 | ✓ | utils/tools/SetTitleTool.js | - |
| 44 | web_search_by_gemini | GeminiSearchTool | 53 | 35 | **88** | 1 | 0 | 1 | ✓ | utils/tools/GeminiSearchTool.js | - |
| 45 | vercelSandbox | VercelSandboxTool | 49 | 39 | **88** | 1 | 0 | 1 | ✓ | utils/tools/VercelSandboxTool.js | - |
| 46 | sendPicture | SendPictureTool | 28 | 59 | **87** | 2 | 0 | 2 | ✓ | utils/tools/SendPictureTool.js | parameters |
| 47 | editCard | EditCardTool | 19 | 62 | **81** | 3 | 0 | 2 | ✓ | utils/tools/EditCardTool.js | - |
| 48 | view_forward_msg | ViewForwardMsgTool | 48 | 33 | **81** | 1 | 0 | 1 | ✓ | utils/tools/ViewForwardMsgTool.js | - |
| 49 | sendGroupPoke | SendGroupPokeTool | 25 | 52 | **77** | 1 | 0 | 1 | ✓ | utils/tools/SendGroupPoke.js | - |
| 50 | sendMessage | SendMessageToSpecificGroupOrUserTool | 32 | 45 | **77** | 2 | 0 | 2 | ✓ | utils/tools/SendMessageToSpecificGroupOrUserTool.js | - |
| 51 | serp | azureSerpTool | 53 | 19 | **72** | 1 | 0 | 1 | ✓ | utils/tools/SerpTool.js | - |
| 52 | handleMsg | HandleMessageMsgTool | 14 | 57 | **71** | 2 | 3 | 1 | ✓ | utils/tools/HandleMessageMsgTool.js | - |
| 53 | searchImage_by_bing | SerpImageTool_by_bing | 31 | 40 | **71** | 2 | 0 | 1 | ✓ | utils/tools/SerpImageTool_by_bing.js | - |
| 54 | searchImage_by_baidu | SerpImageTool_by_baidu | 29 | 40 | **69** | 2 | 0 | 1 | ✓ | utils/tools/SearchImageTool_by_baidu.js | - |
| 55 | sendTTSAudio | TTSAudioTool | 34 | 30 | **64** | 1 | 0 | 1 | ✓ | utils/tools/TTSAudioTool.js | - |
| 56 | searchImage | SerpImageTool | 12 | 49 | **61** | 3 | 0 | 2 | ✗ | utils/tools/SearchImageTool.js | - |
| 57 | searchVideo | BilibiliSearchVideoTool | 26 | 28 | **54** | 1 | 0 | 1 | ✓ | utils/tools/SearchBilibiliTool.js | - |
| 58 | getGroupNotice | GetGroupNoticeTool | 44 | 8 | **52** | 0 | 0 | 0 | ✓ | utils/tools/GetGroupNoticeTool.js | - |
| 59 | queryUserinfo | QueryUserinfoTool | 11 | 29 | **40** | 1 | 0 | 0 | ✓ | utils/tools/QueryUserinfoTool.js | - |
| 60 | weather | WeatherTool | 9 | 31 | **40** | 1 | 0 | 1 | ✓ | utils/tools/WeatherTool.js | - |
| 61 | currentHotMovies | EliMovieTool | 12 | 24 | **36** | 1 | 0 | 1 | ✗ | utils/tools/EliMovieTool.js | - |
| 62 | draw | APTool | 0 | 1 | **1** | 0 | 0 | 0 | ✓ | utils/tools/APTool.js | - |
| 63 | triggerDefaultMessage | DefaultMessageTriggerTool | 0 | 1 | **1** | 0 | 0 | 0 | ✓ | utils/tools/DefaultMessageTriggerTool.js | - |

## 典型场景占用（只看已接入的工具）

| 场景 | tokens |
| --- | --- |
| A 默认配置（私聊 / 群里非管理员） | **1412** |
| B A + Bot 是管理员（群管五件套） | **1944** |
| C B + 常用可选开关（记忆/定时/渲染/沙箱JS/图片/表情） | **4639** |

## 未纳入统计

- utils/tools/AbstractTool.js (AbstractTool): 无 name/未继承 AbstractTool
- utils/tools/McpTool.js (McpTool): 无 name/未继承 AbstractTool

## 改造后估算（主代理只暴露 {task} facade）

已接入的可下沉工具当前合计 **2586 tokens** → facade 合计 **625 tokens**，节省 **1961 tokens**（每请求都命中）。

未接入故不计入：musicTool(205→68)、processPicture(149→71)

| 工具 | 现状 | 改造后 | 节省 | 已接入 | 说明 |
| --- | --- | --- | --- | --- | --- |
| Memory_Tool | 957 | 106 | 851 | ✓ | 记忆写入下沉：主代理只交原文片段，子代理产出原子候选 |
| generate_math_markdown | 394 | 82 | 312 | ✓ | Mermaid/LaTeX 语法规则知识 |
| scheduleGroupTask | 318 | 103 | 215 | ✓ | 自然语言时间 → delayMinutes/cron 的换算知识 |
| github | 290 | — | 不建议下沉 | ✓ | 反例：结果要回主模型迭代 |
| tavily_search | 228 | — | 不建议下沉 | ✓ | 反例：结果要回主模型引用 |
| generate_graph_calculator | 218 | 77 | 141 | ✓ | 纯数值/表达式参数，无会话依赖 |
| emojiLike | 213 | 55 | 158 | ✓ | 固定枚举（16 个情绪 + 12 个表情名） |
| musicTool | 205 | 68 | 137 | ✗ | 音乐检索参数知识 |
| get_pixiv_images | 203 | 66 | 137 | ✓ | tag/尺寸/数量等检索参数知识 |
| processPicture | 149 | 71 | 78 | ✗ | 图像处理参数知识（枚举 2） |
| generate_markmap | 147 | 70 | 77 | ✓ | Markdown 层级 → markmap 结构 |
| sendEmoji | 136 | 66 | 70 | ✓ | 固定枚举（20 个 reaction id） |
| kickOut | 130 | — | 不建议下沉 | ✓ | 反例：鉴权/动作目标必须来自 e 与用户原话 |
| imageCaption | 95 | — | 不建议下沉 | ✗ | 反例：结果要回主模型 |

## 子代理侧开销（每次调用支付一次，不属于主代理每请求占用）

| 子代理 prompt | chars | tokens |
| --- | --- | --- |
| utils/sandboxSubAgent.js → COMMON_RULES（单独计） | 228 | 157 |
| utils/sandboxSubAgent.js → local（完整 systemPrompt） | 836 | 448 |
| utils/sandboxSubAgent.js → remote（完整 systemPrompt） | 797 | 419 |
| utils/sandboxSubAgent.js → vercel（完整 systemPrompt） | 2041 | 1058 |
