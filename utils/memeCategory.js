/**
 * meme 分组分类模块
 *
 * 为什么不是"按 tags 分组"就完事：远端 971 个 meme 里只有 283 个带 tags（29%），
 * 剩下 688 个若只按 tag 归类会全部落进"未分类"——一份 71% 是垃圾堆的列表没有意义。
 * 但 `key` 前缀的覆盖面好得多（`kurogames_*` 109 个、`mihoyo_*` 62 个），
 * 且大量无 tag 的 meme 是通用动作/情绪梗（砸、摸、震惊、嘲讽），语义本身就构成天然分类。
 *
 * 因此这里用两条互补线索做**单层互斥归类**，命中顺序即优先级：
 *   1. 题材系（米哈游 / 鸣潮 / 蔚蓝档案 / 其他作品）—— tags + key 前缀，先具体后宽泛
 *   2. 属性系（成人向）—— 前缀 + 强特征词，必须早于功能系，否则会被"动作/情绪"吞掉
 *   3. 功能系（节日祝福 / 举牌写字 / 特效工具 / 网络热梗 / 动作互动 / 情绪表情 / 动物萌宠）—— 关键词字面匹配
 *   4. 兜底「其他」—— 保证互斥且全覆盖，不存在"未分类"
 *
 * 本模块是纯函数、零框架依赖（不 import logger/redis/Config），可脱离 Yunzai 运行时独立测试。
 */

/**
 * 一个分组的规则定义。
 * @typedef {object} CategoryRule
 * @property {string} name    分组名（同时是 `#meme列表 <分组名>` 的检索键）
 * @property {string} icon    展示用 emoji
 * @property {string} accent  主题色（列表图渲染用）
 * @property {string[]} [tags]     命中即归属的 tag 列表（精确匹配）
 * @property {string[]} [prefixes] 命中即归属的 key 前缀（小写、带下划线分隔符）
 * @property {string[]} [words]    命中即归属的关键词子串
 */

/** 题材分组：先具体厂商，再独立作品，最后"其他作品"兜底（组内会再按 IP 二级细分） */
const IP_RULES = [
  {
    name: '米哈游',
    icon: '🎮',
    accent: '#5b8def',
    tags: [
      '米哈游', '原神', '崩坏3', '崩坏：星穹铁道', '胡桃', '可莉', '八重神子', '妮露', '刻晴',
      '钟离', '草神', '纳西妲', '神里绫华', '流萤', '布洛妮娅·扎伊切克', '休伯利安号', '舰长',
      '格蕾修', '爱莉', '爱莉希雅',
    ],
    prefixes: ['mihoyo_', 'genshin', 'honkai', 'starrail', 'yuanshen'],
    words: ['米哈游', '原神', '崩坏', '星穹铁道', '崩铁'],
  },
  {
    name: '鸣潮',
    icon: '🌊',
    accent: '#2fb3c9',
    tags: ['鸣潮', '今汐'],
    prefixes: ['kurogames', 'wuthering'],
    words: ['鸣潮'],
  },
  {
    name: '蔚蓝档案',
    icon: '🎒',
    accent: '#7c6cf0',
    tags: [
      '蔚蓝档案', '碧蓝档案', '普拉娜', '阿罗娜', '砂狼白子', '久田泉奈', '伊落玛丽',
      '冰室濑名', '早濑优香', '天童爱丽丝', '邮箱', '忍忍',
    ],
    prefixes: ['bluearchive', 'ba_'],
    words: ['蔚蓝档案', '碧蓝档案'],
  },
]

/**
 * 认不出具体作品时的兜底 IP 名。
 * 映射到它的 tag（如 `喜欢`）不是"作品身份"，扫 tag 时必须跳过（见 resolveOtherIp）。
 */
const GENERIC_IP = '综合'

/** 其余作品的 tag / 前缀 → 二级 IP 名，用于「其他作品」组内细分 */
const OTHER_IP_BY_TAG = {
  柚子社: '柚子社', 绫地宁宁: '柚子社', 魔女的夜宴: '柚子社',
  // 猫猫虫与咖波是同一角色（猫猫虫咖波 / Capoo），远端数据里两个 tag 并存，这里统一成一个名字，
  // 否则同一批 meme 会因为 tags 顺序不同被拆到两个 IP 组里
  猫猫虫: '猫猫虫咖波', 咖波: '猫猫虫咖波',
  猫和老鼠: '猫和老鼠', 汤姆: '猫和老鼠', 杰瑞: '猫和老鼠',
  ATRI: 'ATRI', 亚托莉: 'ATRI', 萝卜子: 'ATRI',
  明日方舟: '明日方舟', 东方Project: '东方Project',
  莉可丽丝: '莉可丽丝', 井之上泷奈: '莉可丽丝',
  孤独摇滚: '孤独摇滚', 波奇酱: '孤独摇滚', 后藤一里: '孤独摇滚', 后藤独: '孤独摇滚',
  别当欧尼酱了: '别当欧尼酱了', 绪山真寻: '别当欧尼酱了',
  间谍过家家: '间谍过家家', '阿尼亚·福杰': '间谍过家家',
  葬送的芙莉莲: '葬送的芙莉莲', 芙莉莲: '葬送的芙莉莲',
  咒术回战: '咒术回战', 两面宿傩: '咒术回战',
  瑞克和莫蒂: '瑞克和莫蒂', '瑞克·桑切斯': '瑞克和莫蒂',
  公主连结: '公主连结', 凯露: '公主连结',
  世界计划: '世界计划', 初音未来: '世界计划',
  学园偶像大师: '学园偶像大师', 藤田琴音: '学园偶像大师',
  'LoveLive!Superstar!!': 'LoveLive!', 唐可可: 'LoveLive!',
  幸运星: '幸运星', 泉此方: '幸运星', 凉宫春日: '凉宫春日', '哈利·波特': '哈利·波特',
  '噶呜·古拉': '噶呜·古拉', 'Gawr Gura': '噶呜·古拉', 哆啦A梦: '哆啦A梦',
  ikun: '小黑子', 坤坤: '小黑子', 真爱粉: '小黑子',
  DeepSeek: 'DeepSeek', 深度求索: 'DeepSeek',
  舞萌: '舞萌', 火柴人: '火柴人', 星之卡比: '星之卡比',
  魔法少女的魔女审判: '魔法少女的魔女审判', 夏目安安: '魔法少女的魔女审判',
  我推的孩子: '我推的孩子', 洛天依: '洛天依', 鲨鲨: '鲨鲨', 猫羽雫: '猫羽雫',
  春原心奈: '春原心奈', 春原心菜: '春原心奈',
  喜欢: GENERIC_IP,
}

const OTHER_IP_BY_PREFIX = [
  ['yuzu_soft', '柚子社'], ['yuzusoft', '柚子社'],
  ['capoo', '猫猫虫咖波'], ['doro', 'Doro'], ['nailoong', '奶龙'],
  ['atri', 'ATRI'], ['mygo', 'MyGO!!!!!'], ['nakano', '五等分的新娘'],
  ['miragetank', 'MirageTank'], ['naruto', '火影忍者'], ['naruro', '火影忍者'],
  ['ace_attorney', '逆转裁判'], ['ikun', '小黑子'],
  ['palworld', '幻兽帕鲁'], ['mixue', '蜜雪冰城'], ['chiikawa', '吉伊卡哇'],
  ['shikanoko', '鹿乃子乃子'], ['azur_lane', '碧蓝航线'],
]

/** 属性/功能分组：命中顺序即优先级 */
const FORM_RULES = [
  {
    name: '成人向',
    icon: '🔞',
    accent: '#e0567a',
    prefixes: ['fleshlight'],
    words: [
      '撅', '导', '牛子', '舔咪', '舔奶', '抓奶', '抓咪', '3p', 'sm', '发情', '巨物',
      '打胶', '打飞机', '自慰', '渔网袜', '黑丝', '舔鞋', '高跟', '鸡鸡', '割鸡鸡',
      '甩鸡', '看牛子', '摸牛子', '弹牛子', '舌吻', '猛亲', '嘬', '滋水', '滋你',
      '坐撅', '后撅', '躺撅', '猛撅', '速撅', '男同', '女同', '群p', '付费观看', '卖身契',
      'pornhub', '脏话', '情色',
    ],
  },
  {
    name: '节日祝福',
    icon: '🎉',
    accent: '#e8a33d',
    words: [
      '圣诞', '平安夜', '新年', '元旦', '春节', '中秋', '国庆', '七夕', '情人节', '万圣',
      '感恩节', '恭喜发财', '双喜', '来财', '财源滚滚', '财神', '快乐', '祝福', '生日快乐',
      '跨年', '压岁钱',
    ],
  },
  {
    name: '举牌写字',
    icon: '🪧',
    accent: '#43a97a',
    words: [
      '举牌', '相框', '头像', '证书', '奖状', '请假条', '预告信', '口号', '手写', '招牌',
      '对话框', '名牌', '工牌', '名片', '录取通知书', '兑换券', '契约', '申请书', '协议',
      '横幅', '标语', '菜单', '字幕', '说', '想', '问', '告别', '表白墙',
    ],
  },
  {
    name: '特效工具',
    icon: '🛠️',
    accent: '#8a7ee0',
    words: [
      '像素化', '故障', '万花筒', '万花镜', '哈哈镜', '旋转', '循环', '滚屏', '字符画',
      '生成', '取名', '刮刮乐', '合成', '镜像', '对称', '反了', '倒放', '黑白', '灰度',
      '模糊', '聚焦', '扫描', '打印', '字体', '换算', '计算', '血条', '验证码', '加载中',
      '无响应', '请稍候', '白天黑夜', '三维', '球面', '换位', '打分', '评分', '排序',
      '自动', '全自动', '遥控', '震动', '遥控器',
    ],
  },
  {
    name: '工具应用',
    icon: '📱',
    accent: '#4f9c96',
    words: [
      '微信', '支付宝', '收款码', '付款码', 'steam', 'google', 'wifi', '诺基亚',
      '催眠app', '验孕棒', '体温枪', '望远镜', 'douyin', 'youtube', 'osu', 'nokia',
      '网站', '消息', '支付', '二维码', '刷卡', '外卖', '骑手',
    ],
  },
  {
    name: '生活日常',
    icon: '🍜',
    accent: '#c98a3d',
    words: [
      '起床', '下班', '上班', '加班', '该走了', '请假', '跑步机', '跑步', '自行车',
      '炒菜', '炖', '奶茶', '柠檬', '冰红茶', '菠萝', '榴莲', '土豆', '被窝', '冰箱',
      '洗衣机', '洗头', '睡觉', '睡不着', '吃饭', '喝水', '垃圾', '音乐', '游戏',
      '桌角', '垃圾桶', '看电影', '听音乐', '打工人', '健身房', '刷牙', '邋遢',
    ],
  },
  {
    name: '网络热梗',
    icon: '🔥',
    accent: '#d9633f',
    words: [
      '王境泽', '切格瓦拉', '乌鸦哥', '曾小贤', '压力大爷', '食屎啦你', '你好骚啊', '吴京',
      '椰树', '可达鸭', '鬼畜', '科目三', 'v我50', 'v你50', '疯狂星期四', '蜜雪冰城',
      'kfc', '肯德基', '麦当劳', '土味', '抽象', '杀马特', '阿伟', '五五开', '麦克阿瑟',
      '鲁迅', '罗永浩', '马保国', '蔡徐坤', '小黑子', '真爱粉', '家人们谁懂', '我嘞个豆',
      '为所欲为', '装逼', '牛逼', '打工人', '工贼', '键盘侠', '白嫖', '整点薯条',
      '这像画吗', '为什么要有手', '急急国王', '小丑', '狗都不玩', '网络皇帝', 'creeper',
    ],
  },
  {
    name: '动作互动',
    icon: '🤜',
    accent: '#e0863f',
    words: [
      '砸', '啃', '摸', '贴', '蹭', '捏', '搓', '拍', '踩', '捶', '捶你', '踹', '抓', '抱',
      '亲', '舔', '锤', '鞭', '踢', '揍', '扇', '弹', '敲', '挠', '摇', '甩', '扔', '抛',
      '跳', '爬', '滚', '转', '撅', 'rua', '牵手', '吸', '嗦', '咬', '劈', '撞', '撕', '扯',
      '压', '骑', '拖', '追', '打拳', '击剑', '后空翻', '十字', '抱大腿', '抱抱', '亲亲',
      '上香', '祭', '奠', '跪', '磕头', '蠕动', '列队', '叠罗汉', '围', '瞪', '盯', '看',
      '洗', '拖', '推', '拉', '举', '伸', '缩', '翻', '打', '砸桌', '施法', '膜拜', '拜',
      '扔史', '扔屎', '喷射', '喷水', '抬', '挑', '戳', '捅', '怼',
      // 社交与招呼
      '打招呼', '欢迎', '关注', '交个朋友', '比心', '鼓掌', '欢呼', '敬礼', '忠诚',
      '鞠躬', '采访', '握手', '抱抱', '亲亲', '一起', '在一起', '互动', '聊天', '啾',
      // 攻击与暴力
      '一巴掌', '给你一拳', '手枪', '双枪', '砍头', '斩首', '无影腿', '电死你', '创飞',
      '中指', '打穿', '拍死', '敲死', '耳光', '扇你', '电击', '电弧', '踹', '爆头',
      // 位移与状态
      '快跑', '跑', '该走了', '躲', '闪', '让', '进去', '升起', '升天', '飞', '诈尸',
      '上坟', '铁窗', '坐牢', '燃烧', '燃起来', '灰飞烟灭', '捂脸', '咧嘴', '挣扎', '晃脑',
    ],
  },
  {
    name: '情绪表情',
    icon: '😆',
    accent: '#d94f8c',
    words: [
      '震惊', '迷惑', '懵逼', '嘲讽', '群嘲', '记仇', '无语', '悲报', '喜报', '红温',
      '滑稽', '高血压', '血压', '委屈', '哭', '笑', '怒', '害怕', '恐惧', '尴尬', '得意',
      '无奈', '绝望', '崩溃', '摆烂', '恍惚', '上瘾', '安全感', '嫌弃', '厌恶', '恶心',
      '疯狂', '发疯', '兴奋', '期待', '心累', '嫌弃', '沉默', '问号', '叹', '麻了',
      '上头', '痛苦', '折磨', '悲伤', '难过', '气死', '生气', '急', '慌', '焦虑',
      '震惊', '害', '惨', '霉', '笑话', '嘲讽', '鄙视', '嫌弃',
    ],
  },
  {
    name: '动物萌宠',
    icon: '🐾',
    accent: '#b07ae0',
    words: [
      '猫', '狗', '兔', '猪', '鹿', '恐龙', '蟑螂', '毛虫', '鸟', '熊', '猴', '鱼',
      '仓鼠', '老鼠', '鸡', '鸭', '鹅', '牛', '马', '龟', '蛇', '虫', '狮', '虎',
    ],
  },
]

/** 兜底分组 */
const FALLBACK_NAME = '其他'

/** 各分组的主题色，供渲染层取用 */
const ACCENT_BY_NAME = Object.fromEntries(
  [...IP_RULES, ...FORM_RULES].map(rule => [rule.name, rule.accent])
)
ACCENT_BY_NAME['其他作品'] = '#6b7fb3'
ACCENT_BY_NAME[FALLBACK_NAME] = '#8b8b8b'
ACCENT_BY_NAME['只需图片'] = '#3f9fd9'
ACCENT_BY_NAME['只需文字'] = '#c9a03d'
ACCENT_BY_NAME['图文都要'] = '#a35fd9'
/** 各分组的 icon，供渲染层取用 */
const ICON_BY_NAME = Object.fromEntries(
  [...IP_RULES, ...FORM_RULES].map(rule => [rule.name, rule.icon])
)
ICON_BY_NAME['其他作品'] = '🎬'
ICON_BY_NAME[FALLBACK_NAME] = '📦'
ICON_BY_NAME['只需图片'] = '🖼️'
ICON_BY_NAME['只需文字'] = '✍️'
ICON_BY_NAME['图文都要'] = '🖼️✍️'

/**
 * 判断一个 meme 是否命中某条规则。
 * 三个信号是"或"关系：tags 精确匹配 / key 前缀匹配 / 关键词子串匹配。
 * @param {{key: string, keywords?: string[], tags?: string[]}} meme
 * @param {CategoryRule} rule
 * @returns {boolean}
 */
function matchRule(meme, rule) {
  const tags = meme.tags || []
  if (rule.tags?.length && tags.some(t => rule.tags.includes(t))) return true

  if (rule.prefixes?.length) {
    const key = (meme.key || '').toLowerCase()
    if (rule.prefixes.some(p => key.startsWith(p))) return true
  }

  if (rule.words?.length) {
    const words = meme.keywords || []
    if (words.some(w => rule.words.some(frag => w.includes(frag)))) return true
  }

  return false
}

/**
 * 「其他作品」组内的二级 IP 名。
 * 先看 tag，再看 key 前缀；都认不出来时归到「综合」。
 *
 * 关键：`OTHER_IP_BY_TAG` 里有若干 tag 映射到「综合」（如 `喜欢`），表示"认不出具体作品"。
 * 远端 `tags` 是 `set[str]` 序列化来的、**顺序不保证**，所以扫到「综合」必须**继续往后扫**
 * 而不是直接返回——否则 `['喜欢','猫和老鼠']` 会得到「综合」、`['猫和老鼠','喜欢']` 得到
 * 「猫和老鼠」，同一张 meme 仅因 tag 顺序不同就换了一级分类（前者会掉进功能分组）。
 * @param {{key: string, tags?: string[]}} meme
 * @returns {string}
 */
export function resolveOtherIp(meme) {
  for (const t of meme.tags || []) {
    const name = OTHER_IP_BY_TAG[t]
    if (name && name !== GENERIC_IP) return name
  }
  const key = (meme.key || '').toLowerCase()
  for (const [prefix, name] of OTHER_IP_BY_PREFIX) {
    if (key.startsWith(prefix)) return name
  }
  return GENERIC_IP
}

/**
 * 把 infos 归类成互斥分组。
 *
 * @param {Record<string, object>} infos 远端 infos（key -> info）
 * @param {object} [options]
 * @param {'hybrid'|'ip'|'params'} [options.scheme='hybrid']
 *        hybrid: 题材 + 属性 + 功能（推荐，全覆盖）
 *        ip:     只按题材/IP 分组，其余全部归入「其他」
 *        params: 只按参数需求分组（只需图片 / 只需文字 / 图文都要）
 * @param {Record<string, number>} [options.usageCounts={}] memeKey -> 使用次数（用于 hot 标记）
 * @param {number} [options.newThresholdDays=30] 多少天内创建算 new
 * @param {number} [options.now=Date.now()] 当前时间，便于测试注入
 * @returns {{ groups: Array<object>, stats: object }}
 */
export function buildMemeGroups(infos, options = {}) {
  const {
    scheme = 'hybrid',
    usageCounts = {},
    newThresholdDays = 30,
    now = Date.now(),
  } = options

  const newThresholdMs = newThresholdDays * 24 * 60 * 60 * 1000
  const buckets = new Map()

  const push = (name, meme) => {
    if (!buckets.has(name)) buckets.set(name, [])
    buckets.get(name).push(meme)
  }

  let totalKeywords = 0
  let newCount = 0

  for (const [key, info] of Object.entries(infos)) {
    // 没有可用关键词的条目不进列表：归一化后 keywords 可能为空（见 apps/派蒙meme.js 的
    // normalizeKeywords），而列表的存在意义就是展示触发词，没有触发词的条目只会变成噪音
    if (!info || !Array.isArray(info.keywords) || info.keywords.length === 0) continue

    const keywords = info.keywords
    totalKeywords += keywords.length

    const createdTime = new Date(info.date_created || 0).getTime()
    // 时间必须落在 (0, now] 才算"新"：只判 `now - createdTime < 阈值` 的话，
    // 上游给了未来时间（差值为负，当然小于阈值）也会被标成 new
    const isNew =
      Number.isFinite(createdTime) && createdTime > 0 && createdTime <= now && now - createdTime < newThresholdMs
    if (isNew) newCount++

    const meme = {
      key,
      /** 首个关键词即首选触发词，列表里展示它 */
      primary: keywords[0] || key,
      /** 其余关键词作为别名 */
      aliases: keywords.slice(1),
      keywords,
      tags: info.tags || [],
      /** 参数需求。params 分组方案、以及列表图上的「图」/「文」徽标都读它 */
      paramsType: info.params_type || {},
      isNew,
      usage: usageCounts[key] || 0,
    }

    push(pickGroupName(meme, scheme), meme)
  }

  const groups = [...buckets.entries()].map(([name, memes]) => {
    memes.sort((a, b) => {
      if (a.usage !== b.usage) return b.usage - a.usage
      return a.primary.localeCompare(b.primary, 'zh-Hans-CN')
    })
    const group = {
      name,
      icon: ICON_BY_NAME[name] || '📦',
      accent: ACCENT_BY_NAME[name] || '#8b8b8b',
      count: memes.length,
      memes,
    }
    // 「其他作品」内按二级 IP 细分，方便找具体作品
    if (scheme === 'hybrid' && name === '其他作品') {
      group.subgroups = buildSubgroups(memes)
    }
    return group
  })

  groups.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))

  return {
    groups,
    stats: {
      totalMemes: groups.reduce((n, g) => n + g.count, 0),
      totalKeywords,
      newMemes: newCount,
      groupCount: groups.length,
      newThresholdDays,
    },
  }
}

/**
 * 决定一个 meme 该进哪个分组。
 * @param {object} meme
 * @param {'hybrid'|'ip'|'params'} scheme
 * @returns {string}
 */
function pickGroupName(meme, scheme) {
  if (scheme === 'params') {
    // 这一档回答的是"后端最少要求什么"，所以用 min_*（不是 max_*）。
    // 都不强制时归到「只需图片」：那是"一张图就能出"的最常见情形，可配的文字属于附加项
    const p = meme.paramsType || {}
    const needImg = (p.min_images ?? 0) > 0
    const needText = (p.min_texts ?? 0) > 0
    if (needImg && needText) return '图文都要'
    if (needText) return '只需文字'
    return '只需图片'
  }

  for (const rule of IP_RULES) {
    if (matchRule(meme, rule)) return rule.name
  }
  // 有其它可识别的作品 tag/前缀，说明是"某个作品"的梗，集中放一组
  if (resolveOtherIp(meme) !== GENERIC_IP) return '其他作品'

  if (scheme === 'ip') return FALLBACK_NAME

  for (const rule of FORM_RULES) {
    if (matchRule(meme, rule)) return rule.name
  }
  return FALLBACK_NAME
}

/**
 * 「其他作品」组内的二级分组。
 * @param {Array<object>} memes
 * @returns {Array<{name: string, count: number, memes: Array<object>}>}
 */
function buildSubgroups(memes) {
  const byIp = new Map()
  for (const meme of memes) {
    const ip = resolveOtherIp(meme)
    if (!byIp.has(ip)) byIp.set(ip, [])
    byIp.get(ip).push(meme)
  }
  return [...byIp.entries()]
    .map(([name, list]) => ({ name, count: list.length, memes: list }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

/** 别名最多在列表图上展示几个，超出的折叠成 +N */
const MAX_VISIBLE_ALIASES = 3

/** 默认的 hot 阈值：期限内使用次数达到这个值就打「热」标 */
export const DEFAULT_HOT_THRESHOLD = 30

/**
 * 把分组结果整理成列表图模板直接可用的视图数据。
 *
 * 之所以在 JS 侧算好 `aliasText`/`badges` 而不是丢给 art-template：
 * 模板里的表达式越少越好调试，而且这些规则（折叠几个别名、什么算 hot）是业务规则，
 * 放在这里能被单元测试覆盖。
 *
 * @param {Record<string, object>} infos 远端 infos
 * @param {object} [options] 透传给 buildMemeGroups，另加：
 * @param {number} [options.hotThreshold=DEFAULT_HOT_THRESHOLD]
 * @param {number} [options.maxAliases=MAX_VISIBLE_ALIASES]
 * @returns {{ groups: Array<object>, stats: object, hotThreshold: number }}
 */
export function buildMemeListData(infos, options = {}) {
  const {
    hotThreshold = DEFAULT_HOT_THRESHOLD,
    maxAliases = MAX_VISIBLE_ALIASES,
    ...groupOptions
  } = options

  const { groups, stats } = buildMemeGroups(infos, groupOptions)

  const decorate = meme => {
    const visible = meme.aliases.slice(0, maxAliases)
    const rest = meme.aliases.length - visible.length

    // 胶囊右侧的标记统一由 badges 表达，模板只需一条渲染路径，不必为"输入需求"单开一个分支。
    // 「新」不做成徽标：整颗胶囊翻成实心蓝底已经是最强的信号，再挂个「新」字是重复表达，
    // 它的含义改在列表图顶部用一行图例说明（见 memeList/index.html 的 .swatch-new）
    const badges = []
    if (meme.usage >= hotThreshold) badges.push({ text: '热', kind: 'hot' })

    // 只标"用户得主动做点什么"的两种情况，各一个字：
    // - 「图」：min_images >= 2。一张发送者头像补不上缺口，必须自己发图或 @ 人（`#撅` = do 就是这种）
    // - 「文」：min_texts > 0。不填会拿昵称补，所以文案不能写"必须"之类的字
    // 刻意不用 min_images > 0：971 个里 762 个 min_images 就是 1，一张头像就够，全挂等于满屏徽标。
    // 实测 min_images >= 2 有 55 个、min_texts > 0 有 177 个，两者不重叠，合计 232 个带标记。
    const { min_images: minImages = 0, min_texts: minTexts = 0 } = meme.paramsType || {}
    if (minImages >= 2) badges.push({ text: '图', kind: 'img' })
    if (minTexts > 0) badges.push({ text: '文', kind: 'text' })

    return {
      key: meme.key,
      primary: meme.primary,
      aliasText: visible.join(' · ') + (rest > 0 ? ` +${rest}` : ''),
      hasAliases: visible.length > 0,
      badges,
      totalKeywords: meme.keywords.length,
      /** 模板靠它把整颗胶囊切成实心高亮样式，不只是加一个徽标 */
      isNew: meme.isNew,
    }
  }

  return {
    stats,
    hotThreshold,
    groups: groups.map(group => ({
      name: group.name,
      icon: group.icon,
      accent: group.accent,
      count: group.count,
      // 只给模板它真的会渲染的东西：列表图不再展示「其他作品」的二级 IP 标签，
      // 所以这里把 memes 拍平，不把 buildMemeGroups 的 subgroups 透传下去
      memes: group.memes.map(decorate),
    })),
  }
}

export const SUPPORTED_SCHEMES = ['hybrid', 'ip', 'params']
export const FALLBACK_GROUP_NAME = FALLBACK_NAME
