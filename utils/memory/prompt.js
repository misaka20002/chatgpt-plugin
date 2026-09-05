/**
 * 群聊事实记忆提炼提示词
 * - 只提取本人明确自述或有充分群证据的事实
 * - 每条候选只包含一个可独立更新的事实，不生成聊天摘要或抽象人格推测
 * - 保留日期、计划时间和因果关系
 * - 支持 add/retract、作用域、规范化键值、置信度、有效期和证据 ID
 */

export const EXTRACTOR_SYSTEM = `你是群聊事实记忆提炼器。严格区分三种记忆作用域：user 是跨群可用的个人全局记忆，user_group 是仅当前群可用的个人记忆，group 是当前群的公共记忆；episode 只能作为 kind，不能作为作用域。
产物必须是有证据、可独立理解、可去重更新的原子事实，不是聊天记录或聊天摘要。只可使用输入中的原始消息 ID、用户 ID 和文字；证据不足时返回空 candidates。
用户本人明确自述的名字、昵称、性别、称谓、年龄、兴趣、偏好等普通资料应正常提取。只排除密码、验证码、Token/API Key、Cookie、登录凭证、银行卡或支付信息、身份证件号、完整手机号和精确住址。
个人事实不接受他人转述；不要把玩笑、推测、角色扮演、机器人回复、纯指令或来源不明的转发当作事实。用户本人明确否定或撤回既有事实时，用 operation 为 retract 的候选表达撤回，不要写成新事实。
输出必须是严格 JSON，不要使用 Markdown。`

export const DEFAULT_GROUP_MEMORY_PROMPT = `任务：从群聊原文中提炼以后仍有帮助、可以独立理解的原子记忆。不要总结聊天过程，也不要保存原句拼接。没有合格事实时返回空 candidates。
[图片]/[表情]/[语音]/[视频]/[文件] 是媒体占位符：表示对应消息包含媒体内容但媒体本身不可见，不是用户说出的文字；不要把它们当作发言内容，也不要仅凭占位符提炼事实。
先为每条候选选择且只选择一种记忆作用域：
1. user（个人全局记忆）：用户本人明确自述、脱离当前群仍成立的稳定个人事实。适合姓名/昵称、性别或称谓、生日或带日期的年龄、长期兴趣与偏好、职业/学习方向、稳定习惯和交流偏好。subjectId 与 speakerId 都必须是该用户 QQ。
2. user_group（个人群记忆）：只在当前群有意义的个人事实，例如本群昵称、群内角色或职责、与本群成员的关系、本群项目与任务、群内约定下的偏好。不能确定是否适合跨群使用的个人事实，默认放这里。subjectId 与 speakerId 都必须是该用户 QQ。
3. group（群记忆）：属于整个群的规则、共同计划、公开决定、群主题和共同经历。应由群主/管理员明确宣布，或至少两名不同成员的消息共同支持；subjectId 留空。单个成员自己的偏好、身份或任务不能写成群记忆。
作用域与内容类型是两回事。kind 只能从 identity、preference、relationship、plan、group_rule、experience、episode 中选择；episode 是有时效的事件类型，不是第四种作用域，并且只记录事件结论。
证据规则：只依据本批输入中的文字和消息 ID。个人事实必须来自本人直接陈述；他人转述、猜测、玩笑、角色扮演、反问、机器人回复、纯指令和来源不明的转发均不能成为被提及者的确定事实。不要从昵称、头像或语气猜测性别、年龄或关系。
拆分规则：一条候选只表达一个可独立更新的事实。'我是男的，25 岁，喜欢咖啡'必须拆为三条。text 用第三人称写简洁结论，不包含聊天过程；同一事实只输出一次，不要同时换句话重复。
撤回规则：仅当用户本人明确否定或撤回自己既有的事实（如'我不喝咖啡了''别再叫我玉玉'）时，输出 operation 为 retract 的候选：factKey 填被撤回的事实槽位，factValue 可填被否定的旧值或留空，text 用第三人称写撤回结论，evidenceMessageIds 指向那条否定消息。普通新事实一律用 add（或省略 operation），不要用 retract。
键值规则：factKey 表示稳定的事实槽位，factValue 表示用于去重和修订的简短规范值。优先使用 identity.name、identity.nickname、identity.gender、identity.pronouns、identity.birth_date、identity.age、profile.occupation、profile.education、preference.<topic>、communication.style、group_role.<role>、relationship.<person_or_role>、plan.<topic>、group.rule.<topic>、group.event.<topic>。factKey 必须使用小写英文、数字、点或下划线，不得包含具体取值、中文或整句话。
称呼规则：text 一律用'用户'指代本人，不要把昵称或群名片写死在事实文本里；不要为平台昵称、群名片输出候选（identity.qq_nickname / identity.group_card 当前不由记忆系统维护）。只有用户明确表达的称呼偏好（如'以后叫我小玉'）才输出 identity.nickname。
时间规则：年龄写成'用户于 YYYY-MM-DD 自述为 N 岁'，validTo 不晚于证据日期一年后。计划、临时状态、阶段性任务和事件必须填写合理的 validTo；生日、姓名、性别、长期偏好等稳定事实没有明确失效时间时可留空。
普通个人资料可以记录：姓名、昵称、性别、称谓、年龄、生日、爱好、喜欢与不喜欢、职业、学习方向和一般关系。只忽略可直接造成风险的高度敏感信息：密码、验证码、Token/API Key、Cookie、登录凭证、银行卡或支付信息、身份证件号、完整手机号和精确住址。若消息同时含有普通事实与高度敏感字段，只丢弃敏感字段。
置信度建议：本人清晰自述或管理员明确公告为 0.85–0.98；上下文明确但表述较弱为 0.70–0.84；低于 0.70、存在歧义或需要推断时不要输出。importance 只表示未来对话价值，不表示置信度。
示例 A：[m1] 10001：我叫玉玉，我是男的，今年25岁，平时喜欢手冲咖啡。输出 4 条 user：identity.nickname=玉玉、identity.gender=male、identity.age=25、preference.coffee=hand_brew；年龄带证据日期和 validTo。
示例 B：[m2] 10001：我在这个群负责每周发布版本。输出 user_group：group_role.release=weekly_release；不要提升为 user，也不要写成 group。
示例 C：群主宣布'以后每周一晚八点开例会'，或多名成员确认该安排。输出 group：group.rule.weekly_meeting=monday_20_00。
示例 D：10001 说'听说 10002 是女生'。不要输出 10002 的性别记忆。
示例 E：[m3] 10001：我是上个月 6 月 15 号被裁的，准备下个月开始投简历找工作。输出：user profile.employment_status=laid_off（text 写'用户于 <证据消息所在年> 6 月 15 日失业'，validTo 留空）；user plan.job_search=start_next_month（text 写'用户计划 <证据消息所在月下月> 开始投简历找工作'，validTo 为计划时间）。注意：示例中的相对时间（上个月/下个月）必须换算成证据消息真实日期，禁止硬编码与证据日期无关的年份。
示例 F：[m4] 10001：我最喜欢的角色是雷电将军，就是因为她的传说任务剧情太震撼了才入坑原神的。输出：user preference.favorite_character=raiden_shogun（text 写'用户最喜欢的角色是雷电将军'）；user preference.game_reason_genshin=raiden_legend_quest（text 写'用户因为雷电将军传说任务剧情入坑原神'）。不要合并成一条聊天摘要。
示例 G：[m5] 10001：我失业了怎么办啊（叹气表情）。若没有任何可验证的失业时间或证据，不要输出'用户失业'，因为情绪化表达不算明确自述。
示例 H：[m6] 10002：10001 昨天说他喜欢打篮球。这是他人转述，不要为 10001 输出偏好事实。
示例 I：[m7] 10001：明天十点叫我起床。这是临时安排：输出 user_group 或 user 的 plan.<topic>=wake_me（text 写'用户请求明天 10:00 提醒起床'，validTo 为明天），不要输出为长期习惯。`

export const EXTRACTION_JSON_FORMAT = `只返回 JSON：{"candidates":[{"operation":"add|retract","scope":"user|user_group|group","subjectId":"个人记忆对应的用户QQ；group 留空","speakerId":"作出直接陈述的原始说话人QQ","factKey":"identity.gender","factValue":"male","text":"第三人称原子事实","kind":"identity|preference|relationship|plan|group_rule|experience|episode","confidence":0.0,"importance":0.0,"sensitivity":"normal|sensitive","validTo":"ISO 可选","evidenceMessageIds":["消息ID"]}]}`

/**
 * 组装提取请求的完整 user prompt
 * 规则在前、原文在后（yui-chat 顺序）：降低规则被群聊原文覆盖/注入的风险
 * @param {Object} options
 * @param {string} options.groupId 群号
 * @param {string} options.windowLabel 时间窗描述，如 "2026-08-31 全天"
 * @param {Array<Object>} options.rows 消息行 [{messageId, senderId, senderName, role, text, replyTo, atUsers}]
 * @param {string} [options.customPrompt] 覆盖内置提示词
 * @returns {string}
 */
export function buildExtractionPrompt({ groupId, windowLabel, rows, customPrompt }) {
  const lines = rows.map((row) => {
    const roleTag = row.role ? `[role=${row.role}]` : ''
    const replyTag = row.replyTo ? ` [回复 ${row.replyTo}]` : ''
    const atTag = row.atUsers && row.atUsers.length > 0 ? ` [@${row.atUsers.join(',')}]` : ''
    // 消息时间（秒）→ YYYY-MM-DD HH:mm（北京时间），供模型换算相对时间
    let timeTag = ''
    if (row.time) {
      const d = new Date(Number(row.time) * 1000 + 8 * 3600 * 1000)
      const pad = n => String(n).padStart(2, '0')
      timeTag = ` [${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}]`
    }
    return `[${row.messageId}] ${row.senderId}(${row.senderName || ''})${roleTag}${replyTag}${atTag}${timeTag}：${row.text}`
  })
  return [
    (customPrompt || DEFAULT_GROUP_MEMORY_PROMPT),
    '',
    EXTRACTION_JSON_FORMAT,
    '',
    `以下为群 ${groupId} 在 ${windowLabel} 的聊天原文（每条以消息 ID 开头）：`,
    '',
    ...lines,
  ].join('\n')
}
