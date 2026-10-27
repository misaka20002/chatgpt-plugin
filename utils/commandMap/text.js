/**
 * 文本归一与相似度：召回层唯一需要的基础设施。
 *
 * 全部是纯函数、零依赖、无 IO——召回每来一条消息就要跑一次，任何一次网络或磁盘动作都会让它变成瓶颈。
 */

/** 标点与空白：连同全角空格、指令前缀一起剥掉，避免「#战绩」和「战绩」算成两条不同的话 */
const NOISE_RE = /[\s\u3000，。！？、,.!?：:；;…·~～@#"“”‘’（）()【】[\]{}<>《》\-—_/\\|]/g

/** 高频手误/输入法误差。只收「改完一定还是同一个意思」的，宁可少收也不要把别的词改坏 */
const TYPOS = [
  ['占绩', '战绩'],
  ['战迹', '战绩'],
  ['签道', '签到'],
  ['记绿', '记录']
]

/**
 * 口语填充词。查询侧先剥掉它们再切二元——`今天天气怎么样` 与关键词 `帮我看看我打得怎么样`
 * 会共享「怎么 / 么样」这种通用尾巴，不剥就会把完全无关的指令捞进候选。
 * 只作用于查询，不作用于关键词：关键词是人工写的语料，剥了反而损失信息。
 */
const FILLERS = [
  '帮我看看', '帮我看看', '帮我', '帮忙', '麻烦', '请问', '我想', '我要',
  '一下', '怎么样', '怎么', '如何', '是什么', '什么', '多少', '能不能', '可以',
  '谢谢', '呢', '吗', '啊', '吧', '的'
]

/**
 * 去掉口语填充词。
 * @param {string} text 已归一化的查询
 * @returns {string}
 */
export function stripFillers (text) {
  let result = text
  for (const filler of FILLERS) {
    if (result.includes(filler)) result = result.split(filler).join('')
  }
  return result
}

/**
 * 归一化：NFKC（全角→半角）+ 小写 + 去噪。
 * @param {unknown} text
 * @returns {string}
 */
export function normalize (text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(NOISE_RE, '')
}

/**
 * 手误纠正。在归一化之后做，避免全角字符打断匹配。
 * @param {string} text
 * @returns {string}
 */
export function fixTypos (text) {
  let result = text
  for (const [wrong, right] of TYPOS) {
    if (result.includes(wrong)) result = result.split(wrong).join(right)
  }
  return result
}

/**
 * 中文二元切分。单字查询退化为单字集合，否则二元集合为空、任何相似度都算 0。
 * @param {string} text
 * @returns {Set<string>}
 */
export function bigrams (text) {
  const chars = [...normalize(text)]
  if (!chars.length) return new Set()
  if (chars.length === 1) return new Set(chars)
  const grams = new Set()
  for (let index = 0; index < chars.length - 1; index++) {
    grams.add(chars[index] + chars[index + 1])
  }
  return grams
}

/**
 * Dice 系数：2|A∩B| / (|A|+|B|)。
 * @param {Set<string>} left
 * @param {Set<string>} right
 * @returns {number}
 */
export function dice (left, right) {
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const gram of left) {
    if (right.has(gram)) shared += 1
  }
  return (2 * shared) / (left.size + right.size)
}
