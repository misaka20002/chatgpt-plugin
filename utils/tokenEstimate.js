/**
 * 全仓唯一的近似 token 估算。
 *
 * 中文（含扩展 A）按 1.2 字/token、其余按 4 字/token 向上取整。这是给「一次请求能装多少」
 * 定预算用的估算，不是分词，也不用于计费——所以刻意不引入 tokenizer 依赖。
 *
 * 记忆提炼、夜间压缩与群友 Skill 分块共用这一份：任何一处单独改口径，另一处对
 * 「50000 token」的理解就会跟着漂。要调整只改这里。
 */
export function estimateTokens(text) {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk / 1.2 + other / 4)
}
