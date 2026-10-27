import { bigrams, dice, fixTypos, normalize, stripFillers } from './text.js'

/**
 * 召回：把用户的一句话缩到 3~5 条候选。
 *
 * 只负责「别漏」，不负责「选对」——选哪条交给模型。实测里排第一只有 79%，前三有 93%，
 * 差距全在平局上，字符串算法区分不了语义，所以这一层越简单越好：纯函数、零 IO、每句话都跑。
 */

/** 整词命中加分：查询里完整出现了某个关键词，说明这条大概率就是它 */
const WHOLE_KEY_BONUS = 0.15

/** 描述与写法的权重：它们是次要线索，压一档避免盖过关键词 */
const DESCRIPTION_WEIGHT = 0.85
const COMMAND_WEIGHT = 0.8

const DEFAULT_LIMIT = 5

/**
 * 入选门槛。0.15 太低：`今天天气` 与关键词 `今天密码` 共享「今天」，dice 就有 0.33。
 * 所以门槛之外再加一条「至少共享两个二元组」——一个字的巧合太多，两个才算沾边。
 */
const DEFAULT_MIN_SCORE = 0.25
const MIN_SHARED_GRAMS = 2

/**
 * 字符级兜底。「点个赞」与「点赞」共享 0 个二字组，但字符重合 2/3——
 * 中文里这类「差一个量词/语气」的说法极多，只靠二字组会整类漏掉。
 * 门槛压得比二字组高，避免又回到「靠一个字的巧合」。
 */
const CHAR_WEIGHT = 0.75
const CHAR_MIN_JACCARD = 0.45
const CHAR_MIN_SHARED = 2

/** 索引条目的二元组缓存：索引是稳定的，每来一条消息重算一遍纯属浪费 */
const gramCache = new WeakMap()

function gramsOfEntry (entry) {
  const cached = gramCache.get(entry)
  if (cached) return cached
  const result = {
    keys: (entry.keys || []).map(key => bigrams(key)),
    keyChars: (entry.keys || []).map(key => charSet(key)),
    description: entry.description ? bigrams(entry.description) : null,
    command: entry.command ? bigrams(entry.command) : null
  }
  gramCache.set(entry, result)
  return result
}

/**
 * 查询里是否完整出现了某个关键词。整词命中是一条独立的入选理由：
 * 长关键词（8 个字以上）的 dice 天然偏低，只看分数会把它们误杀。
 * @param {string} query 已归一化（可含填充词）
 * @param {object} entry
 * @returns {boolean}
 */
function hasWholeKeyHit (query, entry) {
  return (entry.keys || []).some(key => {
    const normalized = normalize(key)
    return normalized.length >= 2 && query.includes(normalized)
  })
}

/**
 * 单条指令的打分明细。`shared` 是命中的最大二元组个数，用于过滤「一个字的巧合」。
 * @param {string} query 已剥填充词的查询
 * @param {object} entry
 * @param {Set<string>} queryGrams
 * @returns {{ score: number, shared: number }}
 */
function scoreDetail (query, entry, queryGrams) {
  const grams = queryGrams || bigrams(query)
  const entryGrams = gramsOfEntry(entry)
  const queryChars = charSet(query)

  let best = 0
  let bestShared = 0
  let charBest = 0
  let charShared = 0
  const consider = (target, weight) => {
    if (!target) return
    const score = dice(grams, target) * weight
    if (score > best) best = score
    const shared = countShared(grams, target)
    if (shared > bestShared) bestShared = shared
  }

  for (const key of entryGrams.keys) consider(key, 1)
  consider(entryGrams.description, DESCRIPTION_WEIGHT)
  consider(entryGrams.command, COMMAND_WEIGHT)

  for (const chars of entryGrams.keyChars) {
    const shared = countShared(queryChars, chars)
    if (!shared) continue
    const jaccard = shared / (queryChars.size + chars.size - shared)
    if (jaccard > charBest) {
      charBest = jaccard
      charShared = shared
    }
  }

  if (hasWholeKeyHit(query, entry)) best += WHOLE_KEY_BONUS

  return {
    score: Math.max(Math.min(best, 1), charBest * CHAR_WEIGHT),
    shared: bestShared,
    charScore: charBest,
    charShared
  }
}

/**
 * 单条指令的得分（只要分数时用）。
 * @param {string} query
 * @param {object} entry
 * @param {Set<string>} [queryGrams]
 * @returns {number}
 */
export function scoreEntry (query, entry, queryGrams) {
  return scoreDetail(query, entry, queryGrams).score
}

/**
 * 召回入口。
 * @param {string} rawQuery 用户原话
 * @param {Array<object>} entries 合并后的索引条目
 * @param {{ limit?: number, minScore?: number }} [options]
 * @returns {{ matches: Array<object>, total: number }}
 */
export function recall (rawQuery, entries, { limit = DEFAULT_LIMIT, minScore = DEFAULT_MIN_SCORE } = {}) {
  const normalized = fixTypos(normalize(rawQuery))
  if (!normalized) return { matches: [], total: 0 }

  // 整词命中用未剥填充词的原文判断（关键词本身可能带「的」这类字），打分用剥过的
  const query = stripFillers(normalized) || normalized
  const queryGrams = bigrams(query)
  const scored = []

  for (const entry of Array.isArray(entries) ? entries : []) {
    const { score, shared, charScore, charShared } = scoreDetail(query, entry, queryGrams)
    const wholeHit = hasWholeKeyHit(normalized, entry)
    // 短查询（≤4 字）允许只共享一个二元组，但要求它占查询自身的一半以上：
    // 否则「今天天气」会靠共享「今天」蹭到「今天密码」上。
    const covered = queryGrams.size ? shared / queryGrams.size : 0
    const enough = query.length <= 4 ? shared >= 1 && covered >= 0.5 : shared >= MIN_SHARED_GRAMS
    const charEnough = charShared >= CHAR_MIN_SHARED && charScore >= CHAR_MIN_JACCARD
    if (wholeHit || (enough && score >= minScore) || charEnough) {
      scored.push({ ...entry, score })
    }
  }

  scored.sort((left, right) => right.score - left.score || commandWeight(left) - commandWeight(right))

  // 同一条写法可能被多个注册单位登记过，按写法去重：否则候选里出现两条一模一样的指令
  const seen = new Set()
  const unique = []
  for (const entry of scored) {
    const key = normalize(entry.command) || `${entry.plugin}\u0000${entry.description}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(entry)
    if (unique.length >= limit) break
  }

  return { matches: unique }
}

/** 字符集合：兜底用，只在小查询上生效 */
function charSet (text) {
  return new Set([...normalize(text)])
}

/**
 * 同分时的破平权重：**写法越短越通用**。
 *
 * 同义词是按关键词批量挂载的，「点赞」会同时挂在 `#点赞`、`#三角洲改枪方案点赞`、
 * `#开启fan点赞` 上，三者得分一模一样（1.000）。不打破平局就等于按索引顺序抽签——
 * 线上实测抽到了「改枪方案点赞」，用户要的根本不是它。
 * 用户说「点赞」时想要的是最通用的那条，短写法正是它。
 *
 * @param {object} entry
 * @returns {number}
 */
function commandWeight (entry) {
  const command = normalize(entry?.command || '').replace(/^#/, '')
  return command.length
}

function countShared (left, right) {
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const gram of left) {
    if (right.has(gram)) shared += 1
  }
  return shared
}
