# 工具上下文占用审计

- 扫描目录：`utils/tools/`（共 60 个 .js）
- 识别到工具类：57 个；其余为解析失败/非工具类：2 个
- **已接入 `collectTools`**：48 个，合计 **6427 tokens**（这才是模型真正看得到的上限）
- **未接入**（类存在但没有任何 `new XxxTool()` / 开关注册）：9 个，合计 1149 tokens —— 属于死代码或尚未布线，不占上下文

| # | 工具 name | 类名 | desc tokens | schema tokens | 合计 | 参数字段 | enum 数 | required | 已接入 | 文件 | 动态构造 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Memory_Tool | MemoryTool | 177 | 527 | **704** | 1 | 12 | 1 | ✓ | utils/tools/MemoryTool.js | - |
| 2 | scheduleGroupTask | ScheduleTaskTool | 63 | 255 | **318** | 4 | 6 | 1 | ✓ | utils/tools/ScheduleTaskTool.js | - |
| 3 | generate_math_markdown | GenerateMathRenderTool | 59 | 249 | **308** | 2 | 0 | 2 | ✓ | utils/tools/GenerateMathRenderTool.js | - |
| 4 | github | GithubAPITool | 22 | 268 | **290** | 6 | 4 | 1 | ✓ | utils/tools/GithubTool.js | parameters |
| 5 | tavily_search_and_extract | TavilySearchAndExtractTool | 59 | 177 | **236** | 7 | 10 | 1 | ✗ | utils/tools/TavilySearchAndExtractTool.js | - |
| 6 | tavily_search | TavilyTool | 41 | 187 | **228** | 8 | 8 | 1 | ✓ | utils/tools/TavilyTool.js | - |
| 7 | atOtherUser | AtOtherUserTool | 144 | 77 | **221** | 2 | 0 | 2 | ✓ | utils/tools/At_otherUser.js | - |
| 8 | generate_graph_calculator | GenerateGraphCalculatorTool | 47 | 171 | **218** | 6 | 0 | 1 | ✓ | utils/tools/GenerateGraphCalculatorTool.js | - |
| 9 | musicTool | EliMusicTool | 29 | 176 | **205** | 6 | 0 | 4 | ✗ | utils/tools/EliMusicTool.js | - |
| 10 | get_pixiv_images | GetPixivApiLoliconTool | 81 | 122 | **203** | 3 | 0 | 1 | ✓ | utils/tools/GetPixivApiLoliconTool.js | - |
| 11 | execute_javascript | SandboxJSTool | 98 | 90 | **188** | 2 | 0 | 1 | ✓ | utils/tools/Sandbox_JS.js | - |
| 12 | baidu_AI_Search_Tool | BaiduAISearchTool | 41 | 137 | **178** | 4 | 4 | 1 | ✓ | utils/tools/BaiduAiSearchTool.js | - |
| 13 | blockUser | BlockUserTool | 46 | 124 | **170** | 4 | 3 | 1 | ✓ | utils/tools/Block_User.js | - |
| 14 | jinyan | JinyanTool | 25 | 136 | **161** | 4 | 0 | 2 | ✓ | utils/tools/JinyanTool.js | - |
| 15 | generateGroupMemberSkill | GroupMemberSkillTool | 58 | 92 | **150** | 3 | 0 | 1 | ✓ | utils/tools/GroupMemberSkillTool.js | parameters |
| 16 | processPicture | ProcessPictureTool | 42 | 107 | **149** | 3 | 2 | 1 | ✗ | utils/tools/ProcessPictureTool.js | - |
| 17 | generate_markmap | GenerateMarkmapTool | 40 | 107 | **147** | 2 | 0 | 2 | ✓ | utils/tools/GenerateMarkmapTool.js | - |
| 18 | recognize_media | RecognitionResultsByGeminiTool | 39 | 100 | **139** | 4 | 0 | 0 | ✓ | utils/tools/RecognitionResultsByGeminiTool.js | - |
| 19 | userProfile | UserProfileTool | 70 | 67 | **137** | 2 | 0 | 1 | ✓ | utils/tools/UserProfileTool.js | - |
| 20 | sendEmoji | EmojiTool | 42 | 94 | **136** | 1 | 20 | 1 | ✓ | utils/tools/EmojiTool.js | - |
| 21 | sendRPS | SendRPSTool | 67 | 65 | **132** | 0 | 0 | 2 | ✗ | utils/tools/SendRPSTool.js | - |
| 22 | kickOut | KickOutTool | 14 | 116 | **130** | 3 | 0 | 1 | ✓ | utils/tools/KickOutTool.js | - |
| 23 | sendNetEaseMusic | SendNetEaseMusicTool | 39 | 89 | **128** | 2 | 0 | 1 | ✓ | utils/tools/SendNetEaseMusicTool.js | - |
| 24 | sendQQMusic | SendQQMusicTool | 37 | 88 | **125** | 2 | 0 | 1 | ✓ | utils/tools/SendQQMusicTool.js | - |
| 25 | sf_image_edit | Sf_image_edit | 55 | 63 | **118** | 1 | 0 | 0 | ✗ | utils/tools/Sf_image_edit.js | - |
| 26 | sendDice | SendDiceTool | 52 | 65 | **117** | 2 | 0 | 2 | ✗ | utils/tools/SendDiceTool.js | - |
| 27 | queryStarRail | QueryStarRailTool | 30 | 85 | **115** | 3 | 0 | 0 | ✓ | utils/tools/QueryStarRailTool.js | - |
| 28 | search | SerpIkechan8370Tool | 46 | 69 | **115** | 3 | 4 | 2 | ✓ | utils/tools/SerpIkechan8370Tool.js | - |
| 29 | emojiLike | EmojiLikeTool | 17 | 90 | **107** | 2 | 16 | 1 | ✓ | utils/tools/EmojiLikeTool.js | - |
| 30 | sendVideo | SendVideoTool | 45 | 61 | **106** | 2 | 0 | 1 | ✓ | utils/tools/SendBilibiliTool.js | - |
| 31 | web_search | Misaka_WebSearchTool | 44 | 61 | **105** | 2 | 0 | 1 | ✓ | utils/tools/Misaka_WebSearchTool.js | - |
| 32 | localSandbox | LocalSandboxTool | 61 | 39 | **100** | 1 | 0 | 1 | ✓ | utils/tools/LocalSandboxTool.js | - |
| 33 | queryGenshin | QueryGenshinTool | 20 | 79 | **99** | 3 | 0 | 1 | ✓ | utils/tools/QueryGenshinTool.js | - |
| 34 | tavily_website_extract | TavilyExtractTool | 50 | 49 | **99** | 2 | 2 | 1 | ✓ | utils/tools/TavilyExtractTool.js | - |
| 35 | remoteSandbox | RemoteSandboxTool | 57 | 39 | **96** | 1 | 0 | 1 | ✓ | utils/tools/RemoteSandboxTool.js | - |
| 36 | imageCaption | ImageCaptionTool | 21 | 74 | **95** | 3 | 0 | 0 | ✗ | utils/tools/ImageCaptionTool.js | - |
| 37 | sendAvatar | SendAvatarTool | 27 | 63 | **90** | 2 | 0 | 2 | ✓ | utils/tools/SendAvatarTool.js | - |
| 38 | setTitle | SetTitleTool | 20 | 69 | **89** | 3 | 0 | 2 | ✓ | utils/tools/SetTitleTool.js | - |
| 39 | web_search_by_gemini | GeminiSearchTool | 53 | 35 | **88** | 1 | 0 | 1 | ✓ | utils/tools/GeminiSearchTool.js | - |
| 40 | vercelSandbox | VercelSandboxTool | 49 | 39 | **88** | 1 | 0 | 1 | ✓ | utils/tools/VercelSandboxTool.js | - |
| 41 | sendPicture | SendPictureTool | 28 | 59 | **87** | 2 | 0 | 2 | ✓ | utils/tools/SendPictureTool.js | parameters |
| 42 | editCard | EditCardTool | 19 | 62 | **81** | 3 | 0 | 2 | ✓ | utils/tools/EditCardTool.js | - |
| 43 | sendGroupPoke | SendGroupPokeTool | 25 | 52 | **77** | 1 | 0 | 1 | ✓ | utils/tools/SendGroupPoke.js | - |
| 44 | sendMessage | SendMessageToSpecificGroupOrUserTool | 32 | 45 | **77** | 2 | 0 | 2 | ✓ | utils/tools/SendMessageToSpecificGroupOrUserTool.js | - |
| 45 | serp | azureSerpTool | 53 | 19 | **72** | 1 | 0 | 1 | ✓ | utils/tools/SerpTool.js | - |
| 46 | handleMsg | HandleMessageMsgTool | 14 | 57 | **71** | 2 | 3 | 1 | ✓ | utils/tools/HandleMessageMsgTool.js | - |
| 47 | searchImage_by_bing | SerpImageTool_by_bing | 31 | 40 | **71** | 2 | 0 | 1 | ✓ | utils/tools/SerpImageTool_by_bing.js | - |
| 48 | searchImage_by_baidu | SerpImageTool_by_baidu | 29 | 40 | **69** | 2 | 0 | 1 | ✓ | utils/tools/SearchImageTool_by_baidu.js | - |
| 49 | sendTTSAudio | TTSAudioTool | 34 | 30 | **64** | 1 | 0 | 1 | ✓ | utils/tools/TTSAudioTool.js | - |
| 50 | searchImage | SerpImageTool | 12 | 49 | **61** | 3 | 0 | 2 | ✗ | utils/tools/SearchImageTool.js | - |
| 51 | searchVideo | BilibiliSearchVideoTool | 26 | 28 | **54** | 1 | 0 | 1 | ✓ | utils/tools/SearchBilibiliTool.js | - |
| 52 | website | WebsiteTool | 20 | 26 | **46** | 1 | 0 | 1 | ✓ | utils/tools/WebsiteTool.js | - |
| 53 | queryUserinfo | QueryUserinfoTool | 11 | 29 | **40** | 1 | 0 | 0 | ✓ | utils/tools/QueryUserinfoTool.js | - |
| 54 | weather | WeatherTool | 9 | 31 | **40** | 1 | 0 | 1 | ✓ | utils/tools/WeatherTool.js | - |
| 55 | currentHotMovies | EliMovieTool | 12 | 24 | **36** | 1 | 0 | 1 | ✗ | utils/tools/EliMovieTool.js | - |
| 56 | draw | APTool | 0 | 1 | **1** | 0 | 0 | 0 | ✓ | utils/tools/APTool.js | - |
| 57 | triggerDefaultMessage | DefaultMessageTriggerTool | 0 | 1 | **1** | 0 | 0 | 0 | ✓ | utils/tools/DefaultMessageTriggerTool.js | - |

## 典型场景占用（只看已接入的工具）

| 场景 | tokens |
| --- | --- |
| A 默认配置（私聊 / 群里非管理员） | **1412** |
| B A + Bot 是管理员（群管五件套） | **1944** |
| C B + 常用可选开关（记忆/定时/渲染/沙箱JS/图片/表情） | **4194** |

## 未纳入统计

- utils/tools/AbstractTool.js (AbstractTool): 无 name/未继承 AbstractTool
- utils/tools/McpTool.js (McpTool): 无 name/未继承 AbstractTool

## 改造后估算（主代理只暴露 {task} facade）

已接入的可下沉工具当前合计 **2141 tokens** → facade 合计 **625 tokens**，节省 **1516 tokens**（每请求都命中）。

未接入故不计入：musicTool(205→68)、processPicture(149→71)

| 工具 | 现状 | 改造后 | 节省 | 已接入 | 说明 |
| --- | --- | --- | --- | --- | --- |
| Memory_Tool | 704 | 106 | 598 | ✓ | 记忆写入下沉：主代理只交原文片段，子代理产出原子候选 |
| scheduleGroupTask | 318 | 103 | 215 | ✓ | 自然语言时间 → delayMinutes/cron 的换算知识 |
| generate_math_markdown | 308 | 82 | 226 | ✓ | Mermaid/LaTeX 语法规则知识 |
| github | 290 | — | 不建议下沉 | ✓ | 反例：结果要回主模型迭代 |
| tavily_search | 228 | — | 不建议下沉 | ✓ | 反例：结果要回主模型引用 |
| generate_graph_calculator | 218 | 77 | 141 | ✓ | 纯数值/表达式参数，无会话依赖 |
| musicTool | 205 | 68 | 137 | ✗ | 音乐检索参数知识 |
| get_pixiv_images | 203 | 66 | 137 | ✓ | tag/尺寸/数量等检索参数知识 |
| processPicture | 149 | 71 | 78 | ✗ | 图像处理参数知识（枚举 2） |
| generate_markmap | 147 | 70 | 77 | ✓ | Markdown 层级 → markmap 结构 |
| sendEmoji | 136 | 66 | 70 | ✓ | 固定枚举（20 个 reaction id） |
| kickOut | 130 | — | 不建议下沉 | ✓ | 反例：鉴权/动作目标必须来自 e 与用户原话 |
| emojiLike | 107 | 55 | 52 | ✓ | 固定枚举（16 个 reaction id） |
| imageCaption | 95 | — | 不建议下沉 | ✗ | 反例：结果要回主模型 |

## 子代理侧开销（每次调用支付一次，不属于主代理每请求占用）

| 子代理 prompt | chars | tokens |
| --- | --- | --- |
| utils/sandboxSubAgent.js → COMMON_RULES（单独计） | 228 | 157 |
| utils/sandboxSubAgent.js → local（完整 systemPrompt） | 836 | 448 |
| utils/sandboxSubAgent.js → remote（完整 systemPrompt） | 797 | 419 |
| utils/sandboxSubAgent.js → vercel（完整 systemPrompt） | 2041 | 1058 |
