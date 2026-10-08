import fs from 'fs'
import path from 'node:path'
import { PROVIDER_FIELDS, emptyProviders, findProvider, normalizeProviders, migrateProviders } from './providerProfiles.js'
import lodash from 'lodash'
import { normalizeGroupReplyConfig } from './groupReplyConfig.js'
// Reverse proxy of https://api.openai.com
export const defaultOpenAIReverseProxy = 'https://api.openai.com/v1'
export const pureSydneyInstruction = 'You\'re an AI assistant named [name]. Answer using the same language as the user.'
const defaultConfig = {
  blockWords: ['屏蔽词1', '屏蔽词b'],
  promptBlockWords: ['屏蔽词1', '屏蔽词b'],
  imgOcr: false,
  defaultUsePicture: false,
  defaultUseTTS: false,
  defaultTTSRole: '派蒙_ZH',
  alsoSendText: false,
  autoUsePicture: false,
  autoUsePictureThreshold: 1200,
  ttsAutoFallbackThreshold: 299,
  conversationPreserveTime: 0,
  toggleMode: 'at',
  groupMerge: false,
  quoteReply: true,
  showQRCode: false,
  apiKey: '',
  openAiBaseUrl: defaultOpenAIReverseProxy,
  OpenAiPlatformRefreshToken: '',
  openAiForceUseReverse: false,
  apiStream: false,
  model: '',
  temperature: 0.8,
  responsesApiKey: '',
  responsesApiBaseUrl: 'https://api.deepseek.com/v1',
  responsesModel: '',
  responsesSystemPrompt: 'Your answer shouldn\'t be too verbose. Prefer to answer in Chinese.',
  responsesReasoningEffort: '',
  responsesTemperature: 0.8,
  responsesApiMaxToken: 65536,
  responsesMaxModelTokens: 128000,
  responsesStore: false,
  enableHostedBuiltinTools: true,
  responsesFileSearchVectorStoreIds: [],
  responsesFileSearchMaxNumResults: 10,
  /**
   * @type {'Precise' | 'Balanced' | 'Creative'}
   */
  toneStyle: 'Creative',
  // sydney: pureSydneyInstruction,
  // sydneyReverseProxy: 'https://666102.201666.xyz',
  // sydneyForceUseReverse: false,
  // sydneyWebsocketUseProxy: true,
  // sydneyBrainWash: true,
  // sydneyBrainWashStrength: 15,
  // sydneyBrainWashName: 'Sydney',
  // sydneyMood: false,
  // sydneyGPTs: 'Copilot',
  // sydneyImageRecognition: false,
  // sydneyMoodTip: 'Your response should be divided into two parts, namely, the text and your mood. The mood available to you can only include: blandness, happy, shy, frustrated, disgusted, and frightened.All content should be replied in this format {"text": "", "mood": ""}.All content except mood should be placed in text, It is important to ensure that the content you reply to can be parsed by json.',
  // chatExampleUser1: '',
  // chatExampleUser2: '',
  // chatExampleUser3: '',
  // chatExampleBot1: '',
  // chatExampleBot2: '',
  // chatExampleBot3: '',
  enableSuggestedResponses: false,
  // sydneyEnableSearch: false,
  // api: defaultChatGPTAPI,
  // apiBaseUrl: 'https://chat3.avocado.wiki/backend-api',
  // apiForceUseReverse: false,
  // plus: false,
  // useGPT4: false,
  promptPrefixOverride: 'Your answer shouldn\'t be too verbose. Prefer to answer in Chinese.',
  headless: false,
  chromePath: '',
  proxy: '',
  debug: true,
  // sydneyFirstMessageTimeout: 40000,
  sunoApiTimeout: 60,
  ttsSpace: '',
  // https://114514.201666.xyz
  huggingFaceReverseProxy: '',
  tts_First_person: '派蒙',
  chat_for_First_person: true,
  isReplacePromptForSenderMsg: false,
  // paimon_globalLimitBreak: "",
  paimon_globalInnerOs: "",
  drawByJsonToPlugin: false,
  drawToolsArr: [],
  sf_markdownPic: false,
  disable_sendMessage_tool: true,
  change_handleMsg_tool: true,
  nai3PluginToPaintPrefix: "artist:ciloranko, [artist:tianliang duohe fangdongye], [artist:sho_(sho_lwlw)], [artist:baku-p], [artist:tsubasa_tsubasa],",
  sfPluginToPaintPrefix: "",
  // geminiModelsByFetch: [], // 可用模型通过指令即时查询，不再缓存目录。
  draw_PluginCharactersList: '',
  doNotCheckPaintPluginSuccess: true,
  paimon_chuoyichuo_open: true,
  // paimon_chuoyichuo_ByMsgGroups: [],
  // paimon_chuoyichuo_Probability_ByMsgGroups: 5,
  paimon_chou_cd: 14,
  paimon_chou_reply_text: 0.455,
  paimon_chou_reply_img: 0.12,
  paimon_chou_reply_voice: 0.12,
  paimon_chou_mutepick: 0.03,
  paimon_chou_paimonChuoMeme: 0.05,
  paimon_chou_randowLocalPic: 0.12,
  paimon_chou_dailyEnglish: 0.005,
  paimon_chou_Fighting_Back: "",
  paimon_chou_custom_text: "",
  paimon_chou_IsSendLocalpic: true,
  paimon_chou_IsUseLoliconApi: false,
  paimon_chou_text_generateAndSendAudio: false,
  vits_emotion: 'Happy',
  vits_auto_emotion: false,
  style_text: '',
  style_text_weights: 0.7,
  vits_emotion_locker: true,
  sdp_ratio: 0.2,
  noiseScale: 0.6,
  noiseScaleW: 0.8,
  lengthScale: 1.0,
  tts_language: 'zh',
  tts_slice_is_slice_generation: true,
  tts_slice_is_Split_by_sentence: false,
  tts_slice_pause_between_paragraphs_seconds: 0.2,
  tts_slice_pause_between_sentences_seconds: 0.2,
  hailuoApiKey: "",
  // exampleAudio: "",
  // Fish_Iterative_Prompt_Length: 90,
  // Fish_Maximum_tokens_per_batch: 0,
  // Fish_Top_P: 0.7,
  // Fish_Repetition_Penalty: 1.5,
  // Fish_Temperature: 0.7,
  // api_fish_audio_model: "efc1ce3726a64bbc947d53a1465204aa",
  // api_fish_audio_account_ID: "",
  // api_fish_token_quota: 49,
  // api_fish_control_defaultUseTTS: false,
  siliconflow_Voice_ApiKey: "",
  siliconflow_VoiceApi: [{ siliconflow_Voice_Model: "FunAudioLLM/CosyVoice2-0.5B", siliconflow_Voice_ReferenceId: "FunAudioLLM/CosyVoice2-0.5B:alex", remark: "alex(系统预置音色)" }, { siliconflow_Voice_Model: "FunAudioLLM/CosyVoice2-0.5B", siliconflow_Voice_ReferenceId: "FunAudioLLM/CosyVoice2-0.5B:anna", remark: "anna(系统预置音色)" }],
  siliconflow_Voice_Current_Index: 1,
  fish_base_url: "",
  fishApiKey: "",
  fish_reference_id: "efc1ce3726a64bbc947d53a1465204aa",
  meme_turnOff: false,
  meme_baseUrl: "https://qwqcc-meme.hf.space",
  meme_reply: true,
  meme_forceSharp: true,
  meme_masterProtectDo: true,
  meme_maxFileSize: 10,
  meme_CD: 19,
  isConvertSentenceToArrayReply: false,
  geminiModel: 'gemini-flash-latest',
  gemini_vqa_model: "gemini-flash-lite-latest",
  geminiSearchModel: "gemini-flash-lite-latest",
  gemini_vqa_needMaster: true,
  initiativeChatGroups: [],
  helloPrompt: '写一段话让大家来找我聊天。类似于“有人找我聊天吗？"这种风格，轻松随意一点控制在20个字以内',
  helloInterval: 3,
  helloProbability: 50,
  chatglmBaseUrl: 'http://localhost:8080',
  allowOtherMode: true,
  // sydneyContext: '',
  emojiBaseURL: 'https://www.gstatic.com/android/keyboard/emojikitchen',
  emojiBaseSwitch: true,
  enableGroupContext: false,
  groupContextTip: '你看看我们群里的聊天记录吧，回答问题的时候要主动参考我们的聊天记录进行回答或提问。但要看清楚哦，不要把我和其他人弄混啦，也不要把自己看晕啦。',
  groupContextLength: 20,
  enableRobotAt: false,
  maxNumUserMessagesInConversation: 20,
  // sydneyApologyIgnored: true,
  // enforceMaster: false,
  bingAPDraw: false,
  bingSuno: 'bing',
  bingSunoApi: '',
  serverPort: 3321,
  serverHost: '',
  viewHost: '',
  chatViewWidth: 1280,
  chatViewBotName: '',
  live2d: false,
  live2dModel: '/live2d/Murasame/Murasame.model3.json',
  live2dOption_scale: 0.1,
  live2dOption_positionX: 0,
  live2dOption_positionY: 0,
  live2dOption_rotation: 0,
  live2dOption_alpha: 1,
  groupAdminPage: false,
  enablePrivateChat: false,
  whitelist: [],
  blacklist: [],
  ttsRegex: '/匹配规则/匹配模式',
  slackUserToken: '',
  slackBotUserToken: '',
  // slackChannelId: '',
  slackSigningSecret: '',
  slackClaudeUserId: '',
  slackClaudeEnableGlobalPreset: true,
  slackClaudeGlobalPreset: '',
  slackClaudeSpecifiedChannel: '',
  // slackCozeUserId: '',
  // slackCozeEnableGlobalPreset: true,
  // slackCozeGlobalPreset: '',
  // slackCozeSpecifiedChannel: '',
  cloudTranscode: 'https://silk.201666.xyz',
  cloudRender: false,
  cloudDPR: 1,
  ttsMode: 'vits-uma-genshin-honkai', // or azure
  azureTTSKey: '',
  azureTTSRegion: '',
  azureTTSSpeaker: 'zh-CN-XiaochenNeural',
  azureTTSEmotion: false,
  enhanceAzureTTSEmotion: false,
  autoJapanese: false,
  enableGenerateContents: false,
  enableGenerateSuno: false,
  amapKey: '',
  azSerpKey: '',
  tavilyKey: '',
  exaApiKey: '', // 可选，OpenCode联网搜索的 Exa Key；不填走免费额度
  parallelApiKey: '', // 可选，OpenCode联网搜索的 Parallel Key；不填走免费额度
  serpSourceArr: ["SerpImageTool_Baidu", "Bilibili_SearchVideoTool", "Send163_MusicTool", "Weather_Tool", "geminiSearchTool", "SendQQ_MusicTool", "GithubAPI"],
  toolDefaultArr: ["SendPicture", "SendVideo", "QueryUserinfo", "BlockUser"],
  toolGameQueryArr: ["QueryStarRail", "QueryGenshin"],
  toolGroupAdminArr: ["EditCard", "Jinyan", "KickOut", "SetTitle", "HandleMsg"],
  extraUrl: '',
  smartMode: false,
  forwardToolCallResult: false,
  llm_maxToolRounds: 3,
  trssBotUin: '',
  geminiKey: '',
  // geminiKeyArr: '',
  geminiPrompt: 'You are Gemini. Your answer shouldn\'t be too verbose. Prefer to answer in Chinese.',
  // origin: https://generativelanguage.googleapis.com
  geminiBaseUrl: 'https://gemini-proxy1.588686.xyz/',
  geminiTemperature: 0.9,
  geminiMaxOutputTokens: 65536,
  sunoSessToken: '',
  sunoClientToken: '',
  enableChatSuno: false,
  SunoModel: 'local',

  claudeApiKey: '',
  claudeApiBaseUrl: 'http://claude-api.xiaodaimao.com',
  claudeApiMaxToken: 65536,
  claudeApiTemperature: 0.8,
  claudeApiModel: '', // claude-3-opus-20240229 claude-3-sonnet-20240229
  claudeSystemPrompt: '', // claude api 设定
  translateSource: 'openai',
  baiduTranslateKey: '',
  enableMd: false, // 第三方md，非QQBot。需要适配器实现segment.markdown和segment.button方可使用，否则不建议开启，会造成各种错误
  enableToolbox: false, // 默认关闭工具箱节省占用和加速启动
  groupReply: normalizeGroupReplyConfig(),
  // 思考过程转发
  forwardReasoning: true,
  geminiEnableGoogleSearch: false,
  geminiEnableCodeExecution: false,
  apiMaxToken: 65536,
  maxModelTokens: 128000,
  enableToolPrivateSend: false, // 是否允许智能模式下私聊骚扰其他群友。主人不受影响。
  enableForceToolKeywords: true,
  geminiForceToolKeywords: [],
  githubAPI: 'https://api.github.com',
  githubAPIKey: '',
  version: 'v2.8.4',

  // turnOnBilitv: false,
  // bilitv_max_duration_min: 10

  is_recallMsg: true,
  removeCQCodeFocus: true,
  switch_atOtherUserTool: false,
  isProcessCQAtCode: true,
  getCurrentTime: true,
  poke_userIDs: true,
  agent_MarkmapToolSwitch: false,
  agent_SandboxSwitch: false,
  // 三种系统沙箱共用的执行规划子模型；current 表示跟随当前对话模型
  sandboxSubAgentProvider: 'current',
  agent_LocalSandboxSwitch: false,
  // localSandboxMasterOnly: true,
  // localSandboxSendCallForward: true,
  // localSandboxNetworkEnabled: false,
  // localSandboxRetentionMinutes: 30,
  // localSandboxChromePath: '',
  agent_RemoteSandboxSwitch: false,
  remoteSandboxMasterOnly: true,
  remoteSandboxSendCallForward: true,
  remoteSandboxApiUrl: '',
  remoteSandboxToken: '',
  agent_VercelSandboxSwitch: false,
  vercelSandboxMasterOnly: true,
  vercelSandboxSendCallForward: true,
  sandboxApiUrl: '',
  sandboxToken: '',
  // Prompt Gallery 画图记录
  enablePromptGallery: false, // 是否启用画图记录（含 tag 标注，推送到 GitHub 仓库）
  promptGalleryRepo: '', // GitHub 仓库地址，如 'user/repo'（建议使用私有仓库）
  promptGalleryBranch: 'main', // 推送到的分支
  promptGalleryToken: '', // GitHub Personal Access Token
  promptGalleryFilePath: 'gallery.json', // JSON 文件在仓库中的路径
  promptGalleryPassword: '', // 画廊访问密码，设置后 gallery.json 将被 AES-256 加密，查看页面需输入密码
  auto_makeForwardMsg: 2000,
  getPixivTool: false,
  getPixiv18Tool: false,
  switch_EmojiTool: false,
  switch_ChatCooldown: true,
  gemini_temperature: 0.9,
  mediaMaxSizeInMB: 5,
  enableEmojiLikeTool: true,
  disable_SendAvatarTool: true,
  generateMathRender_ToolSwitch: false,
  generateHtml_ToolSwitch: false,
  generateGraphCalculator_ToolSwitch: false,
  enableGroupMemberSkillTool: false,
  enableDefaultMessageTriggerTool: false,
  mediaRecognitionSource: "Orignal",
  mediaRecognitionGeminiTool: true,
  ScheduleTask_Tool: true,
  ScheduleTask_MaxPerUser: 1,
  ScheduleTask_CronMaxPerUser: 0,
  ScheduleTask_CronMinInterval: 60,
  ScheduleTask_CronTasks: [],
  rateLimiting: 0,
  chatgptBlockCount: 50,
  reasoningEffort: "",
  geminiThinkingLevel: "",
  TTSAudio_Tool: false,
  enableManualSendTTSAudio: false,
  replyConfirmType: 111,
  baiduAppBuilderKey: "",

  // 智能模式 V2 记忆系统配置（群聊采集须由 Bot 主人在锅巴或当前群显式授权）
  enableMemory: false, // 是否启用记忆系统（唯一总开关，同时开放 Memory_Tool 与 userProfile）
  enableAtGraph: true, // 是否开放 #at图谱 指令；仍需启用记忆系统并授权当前群
  maxMemoriesPerUser: 100, // 每用户每作用域（跨群 user / 每群 user_group）的 V2 记忆上限
  memoryMinImportance: 0.4, // 注入对话的最低重要性阈值（0-1）
  memoryContextLimit: 8, // 每次对话注入的最大记忆条数
  allowMemberDeleteOwnMemory: true, // 允许成员删除自己的记忆（默认开启）
  memoryGroupCapture: {
    groups: [], // 授权采集的群列表 [{groupId, switchOn}]，锅巴 GSubForm 管理或 #群记忆开启
    cronTime: '0 0 4 * * ? *', // 每日提炼 EasyCron，修改后重启生效
    rawRetentionDays: 30, // 群原文保留天数
    eventRetentionDays: 90, // 未指定期限的临时事件默认保留天数
    inputTokenLimit: 30000, // 提取模型输入 Token 上限
    // 输出上限不再单独配置：提炼用的子模型直接跟随 provider 的「回复内容最大Token数」
    // 最低置信度也不再是配置项：固定为 extractor.js 的 MEMORY_MIN_CONFIDENCE（0.7）
  },

  // MCP 协议配置
  enableMcp: false, // 是否启用通用的 MCP 协议
  mcpServers: `{
  "mcpServers": {
    "nocturne_memory": {
      "enabled": false,
      "command": "python",
      "args": ["/root/nocturne_memory/backend/mcp_server.py"],
      "env": {
        "NAMESPACE": "default"
      }
    }
  }
}`, // 通用 MCP 服务器的配置列表，JSON 格式

  // AnythingLLM 知识库配置
  anythingllm_enable: false, // 是否启用 AnythingLLM 知识库功能
  anythingllm_baseUrl: 'http://localhost:3001', // AnythingLLM 服务地址
  anythingllm_apiKey: '', // AnythingLLM API 密钥（在 AnythingLLM 设置中获取）
  anythingllm_defaultWorkspace: 'general-knowledge', // 默认工作区 slug
  anythingllm_timeout: 30000, // 请求超时时间（毫秒）
  anythingllm_maxRetries: 3, // 最大重试次数
  anythingllm_mode: 'query', // 查询模式: chat(带上下文对话) 或 query(仅检索)
  anythingllm_includeSources: true, // 是否在回复中包含引用来源
  anythingllm_cacheEnable: true, // 是否启用查询结果缓存
  anythingllm_cacheTTL: 300000, // 缓存有效期（毫秒，默认 5 分钟）

}
export const providerDefaults = Object.fromEntries(Object.entries(PROVIDER_FIELDS).map(([type, fields]) => [type,
  Object.fromEntries(fields.map(field => [field, lodash.cloneDeep(defaultConfig[field])]))
]))
const legacyDefaults = lodash.cloneDeep(defaultConfig)
for (const field of Object.values(PROVIDER_FIELDS).flat()) delete defaultConfig[field]
for (const field of ['gemini_fallbackModel', 'gemini_vqa_model', 'geminiSearchModel', 'geminiTemperature']) delete defaultConfig[field]
Object.assign(defaultConfig, {
  providerConfigVersion: 1, modelProviders: emptyProviders(), defaultProviderId: '', fallbackProviderId: '',
  imageProviderId: '', videoProviderId: '', geminiSearchProviderId: '', translateSource: ''
})

const _path = process.cwd()
let config = {}
let hadConfigFile = false
if (fs.existsSync(`${_path}/plugins/chatgpt-plugin/config/config.json`)) {
  const fullPath = fs.realpathSync(`${_path}/plugins/chatgpt-plugin/config/config.json`)
  const data = fs.readFileSync(fullPath)
  if (data) {
    try {
      config = JSON.parse(data)
      hadConfigFile = true
    } catch (e) {
      logger.error('chatgpt插件读取配置文件出错，请检查config/config.json格式，将忽略用户配置转为使用默认配置', e)
      logger.warn('chatgpt插件即将使用默认配置')
    }
  }
}
/**
 * 数组整体采用用户的值，不按下标合并。
 * lodash.merge 会把数组当成对象按下标合并：用户保存的数组比默认值短时，默认数组末尾的元素会被补回来——
 * 多选工具列表里取消勾选的默认项重启后又出现（或与已选项重复）、清空的列表变回默认值、删掉的预置音色又回来。
 * saveDiff 保存数组时一向整只写入，所以用户配置里的数组总是完整的，整体采用不会丢信息。
 * 必须返回副本：用户没保存过的键会直接拿到 defaultConfig 的数组，而 ScheduleTaskTool 等处是原地 push 后
 * 再 saveDiff——共用同一个数组时默认值被一起改掉，比较结果相等，新增内容就不会写盘。
 */
function useWholeArray(objValue, srcValue) {
  if (Array.isArray(srcValue)) return lodash.cloneDeep(srcValue)
}

const configPath = `${_path}/plugins/chatgpt-plugin/config/config.json`
let migrated = false
if (hadConfigFile && config.providerConfigVersion !== 1) {
  const raw = config
  const legacy = raw.modelProviders ? lodash.cloneDeep(raw) : lodash.mergeWith({}, legacyDefaults, raw, useWholeArray)
  // Redis 只在一次迁移时读取，失败则停止加载，避免错误地换成其他账号。
  const oldUse = raw.modelProviders ? 'api' : await globalThis.redis?.get?.('CHATGPT:USE') || 'api'
  migrated = migrateProviders(legacy, providerDefaults, oldUse)
  config = legacy
}
config = lodash.mergeWith({}, defaultConfig, config, useWholeArray)
config.groupReply = normalizeGroupReplyConfig(config.groupReply)
normalizeProviders(config, providerDefaults)
config.version = defaultConfig.version

// V2 记忆迁移：旧版 memoryMinImportance 为 1-10 语义，V2 中 importance 为 0-1，归一化防止注入被全部过滤
if (typeof config.memoryMinImportance === 'number' && config.memoryMinImportance > 1) {
  config.memoryMinImportance = Math.min(1, Math.max(0, config.memoryMinImportance / 10))
}

/** 递归清理从本地读取但 defaultConfig 中已经不存在的多余键 */
function removeExtraKeys(target, base) {
  for (const key in target) {
    // 如果 defaultConfig 中没有这个键，则直接从内存中删除
    if (!Object.prototype.hasOwnProperty.call(base, key)) {
      delete target[key];
    } else if (lodash.isPlainObject(target[key]) && lodash.isPlainObject(base[key])) {
      // 如果都是普通对象，则递归往下清理嵌套的多余键
      removeExtraKeys(target[key], base[key]);
    }
  }
}
removeExtraKeys(config, defaultConfig);

// ===================
// 重启后强制设置的选项，不会立刻写入硬盘的 config.json
config.doNotCheckPaintPluginSuccess = true
config.agent_LocalSandboxSwitch = false
// ===================

function saveDiff(target) {
  /** 递归判断Diff */
  function deepDiff(obj, base) {
    function changes(object, base) {
      return lodash.transform(object, function (result, value, key) {
        if (!Object.prototype.hasOwnProperty.call(base, key)) {
          return;
        }
        if (!lodash.isEqual(value, base[key])) {
          result[key] = (lodash.isPlainObject(value) && lodash.isPlainObject(base[key]))
            ? changes(value, base[key])
            : value;
        }
      });
    }
    return changes(obj, base);
  }

  try {
    const candidate = lodash.cloneDeep(target)
    candidate.groupReply = normalizeGroupReplyConfig(candidate.groupReply)
    normalizeProviders(candidate, providerDefaults)
    const nestedChange = deepDiff(candidate, defaultConfig)
    // 版本与空表单必须显式持久化，不能被差量保存省略后再次触发旧配置迁移。
    // TODO: 2个月后(2027年1月8日)移除 commit 5bb9f8a61d68982f97ac8d52afbca2979c9fbe11 及之前初代的配置文件迁移源码
    nestedChange.providerConfigVersion = 1
    nestedChange.modelProviders = candidate.modelProviders
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const temporary = `${configPath}.${process.pid}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(nestedChange, null, 2), { mode: 0o600 })
      fs.renameSync(temporary, configPath)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
    Object.assign(target, candidate)
    return true
  } catch (err) {
    logger.error(err)
    return false
  }
}

if (migrated) {
  const backup = `${configPath}.providers-backup-${Date.now()}`
  fs.copyFileSync(configPath, backup, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(backup, 0o600)
  if (!saveDiff(config)) throw new Error('[ChatGPT] 模型提供商迁移保存失败，原配置备份已保留')
  logger.info('[ChatGPT] 模型提供商配置迁移完成，原配置已备份')
}

/**
 * @description: 随机英文逗号分割的字符串的一个元素
 * @param {*} str 英文逗号分割的字符串
 * @param {*} funcName
 * @return {*}
 */
function randomKeyStr(str, funcName) {
  if (str?.length === 0) return '';
  const keyArr = str?.trim().split(/[,，]/)
  const randomIndex = Math.floor(Math.random() * keyArr.length)
  logger.info(`[chatgpt][${funcName}]随机使用第${randomIndex + 1}个 Key: ${keyArr[randomIndex].replace(/(.{7}).*(.{10})/, '$1****$2')}`)
  return keyArr[randomIndex];
}

/** Config对象 */
export const Config = new Proxy(config, {
  get(target, property) {
    if (property === 'commit') {
      return candidate => {
        const next = lodash.cloneDeep(candidate)
        normalizeProviders(next, providerDefaults)
        if (!saveDiff(next)) throw new Error('配置保存失败')
        Object.assign(target, next)
        return true
      }
    }
    if (property === 'save') { // 对于 config 中对象/对象数组 的修改 Proxy 对象不会执行 set() 所以要手动保存
      return function () {
        return saveDiff(target);
      }
    }
    else if (property === 'getConfig') {
      return function () {
        return config;
      }
    }
    else if (property === 'getGeminiKey')
      return randomKeyStr(findProvider(target, target.defaultProviderId)?.geminiKey || '', property);
    else if (property === 'getTavilyKey')
      return randomKeyStr(target.tavilyKey, property);
    else if (property === 'getBaiduAppBuilderKey')
      return randomKeyStr(target.baiduAppBuilderKey, property);
    else if (property === 'getFishApiKey')
      return randomKeyStr(target.fishApiKey, property);
    else if (property === 'get_draw_PluginCharactersList') {
      return function () {
        const defaultJson = { "nahida": "nahida (genshin impact), toddler", "klee": "klee (genshin impact), toddler", "paimon": "paimon (genshin impact), toddler", "bailu": "bailu (honkai: star rail), toddler", "clara": "clara (honkai: star rail), toddler", "last(_|\\s)order|misaka": "last order(Toaru Majutsu no Index), toddler", "sayu": "sayu (genshin impact), toddler", "diona": "diona (genshin impact), toddler", "yaoyao": "yaoyao (genshin impact), toddler", "qiqi": "qiqi (genshin impact), toddler", "furina": "furina (genshin impact), toddler", "Mahiro": "Oyama Mahiro(Onichanhaoshimai), toddler", "arona": "arona (blue archive), toddler", "sora": "sora (blue archive), toddler", "kokona": "kokona (blue archive), toddler", "hoshino": "hoshino (blue archive), toddler", "Koharu": "Shimoe Koharu (Blue archive), toddler", "Gura": "Gawr Gura (Hololive), toddler", "suzuran": "suzuran (arknights), toddler", "Anya": "Anya Forger(SPY×FAMILY), light pink hair, toddler", "AzusaNya": "nakano Azusa(K-ON), toddler", "Azusa": "azusa (blue archive), toddler", "laffey": "laffey (azur lane), toddler", "nachoneko": "nachoneko (indie virtual youtuber), toddler", "ibuki": "tanga ibuki (blue archive), blond hair, toddler", "shun": "shun (small) (blue archive), toddler", "hu(_|\\s)tao": "hu tao (genshin impact), toddler", "Platelet": "girl Platelet (Hataraku Saibou), toddler", "chino": "kafuu chino (gochuumon wa usagi desu ka?), toddler", "shuvi": "shuvi (no game no life), purple hair, long hair, hair_ornament, toddler", "plana": "plana (blue archive), toddler", "kinako": "kinako (40hara), cat girl, cat ear, toddler", "kanna(_|\\s)kamui": "kanna kamui (maidragon), toddler" }
        let userJson = {};
        if (target.draw_PluginCharactersList && target.draw_PluginCharactersList.trim()) {
          try {
            userJson = JSON.parse(target.draw_PluginCharactersList);
          } catch (e) {
            logger.error(`[chatgpt]解析“绘画添加作品名”失败，请重新配置: ${e.message}`);
          }
        }
        return { ...defaultJson, ...userJson };
      }
    }
    else if (property === 'paimon_chou_Fighting_Back') {
      return (1 - target.paimon_chou_reply_text - target.paimon_chou_reply_img - target.paimon_chou_reply_voice - target.paimon_chou_mutepick - target.paimon_chou_paimonChuoMeme - target.paimon_chou_randowLocalPic - target.paimon_chou_dailyEnglish).toFixed(3)
    }

    const type = Object.keys(PROVIDER_FIELDS).find(type => PROVIDER_FIELDS[type].includes(property))
    if (type) {
      const row = findProvider(target, target.defaultProviderId)
      return row?.type === type ? row[property] : undefined
    }
    return target[property]
  },
  set(target, property, value) {
    const candidate = lodash.cloneDeep(target)
    const type = Object.keys(PROVIDER_FIELDS).find(type => PROVIDER_FIELDS[type].includes(property))
    if (type) {
      const row = candidate.modelProviders[type].find(row => row.id === candidate.defaultProviderId)
      if (!row) throw new Error('请先切换到对应协议的模型提供商')
      row[property] = value
    } else candidate[property] = value
    normalizeProviders(candidate, providerDefaults)
    if (!saveDiff(candidate)) throw new Error('配置保存失败')
    Object.assign(target, candidate)
    return true
  }
})
