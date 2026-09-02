/**
 * 记忆敏感信息过滤
 * 服务端第二道闸门：模型输出的 sensitivity 字段不可信，
 * 正文与 factValue 必须再次经过本模块复检。
 */

const KEYWORD_PATTERNS = [
  /密码|口令|登录凭证/i,
  /验证码|校验码|动态码|短信码|一次一密|\botp\b/i,
  /token|api[_-]?key|apikey|密钥|cookie|authorization|access[_-]?key|secret/i,
  /银行卡|信用卡|借记卡|支付(?:密码|账号|账户)|pay[_-]?(?:password|account)|(?:bank|credit)[_-]?card|\bcvv\b/i,
  /身份证(?:件)?号|护照号|id[_-]?card|passport[_-]?(?:number|no)/i,
]

const PHONE_PATTERN = /(?:86[-\s]?)?1[3-9]\d{9}/

const ID_CARD_PATTERN = /\b\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/

const ADDRESS_PATTERNS = [
  /(?:住址|家庭地址|收货地址|邮寄地址|现居|居住地址)/i,
  /[^\s，。,.、]{2,}(?:路|街|道|巷|弄|村|小区|苑|园|大厦|广场)[^\s，。,.、]{0,}(?:号|号楼|栋|幢|单元|室)/,
]

/**
 * 对数字串做 Luhn 校验，识别银行卡/支付卡号
 * @param {string} digits
 * @returns {boolean}
 */
export function isPaymentCard(digits) {
  const clean = digits.replace(/\D/g, '')
  if (clean.length < 13 || clean.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = clean.length - 1; i >= 0; i--) {
    let d = clean.charCodeAt(i) - 48
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

/**
 * 检查文本是否包含高度敏感信息
 * @param {string} text
 * @returns {{hit: boolean, reason: string}}
 */
export function containsSensitiveData(text) {
  if (!text || typeof text !== 'string') return { hit: false, reason: '' }

  // 1. 关键词
  for (const pattern of KEYWORD_PATTERNS) {
    if (pattern.test(text)) {
      return { hit: true, reason: `命中敏感关键词: ${pattern}` }
    }
  }

  // 2. 手机号（提取数字串判断，避免被普通数字误伤）
  const digits = text.replace(/\D/g, '')
  if (PHONE_PATTERN.test(text)) {
    return { hit: true, reason: '命中完整手机号' }
  }
  if (digits.length >= 11 && /^1[3-9]/.test(digits) && /1[3-9]\d{9}/.test(digits)) {
    return { hit: true, reason: '命中完整手机号(数字串)' }
  }

  // 3. 身份证号
  if (ID_CARD_PATTERN.test(text)) {
    return { hit: true, reason: '命中身份证件号' }
  }

  // 4. 支付卡（Luhn）
  const numRuns = text.match(/\d{13,19}/g)
  if (numRuns) {
    for (const run of numRuns) {
      if (isPaymentCard(run)) {
        return { hit: true, reason: '命中支付卡号(Luhn)' }
      }
    }
  }

  // 5. 精确住址
  for (const pattern of ADDRESS_PATTERNS) {
    if (pattern.test(text)) {
      return { hit: true, reason: `命中精确住址: ${pattern}` }
    }
  }

  return { hit: false, reason: '' }
}

/**
 * 记忆写入前的最终校验：命中敏感信息则抛出（或返回原因）
 * @param {string} text
 * @param {string} [factValue]
 * @returns {{ok: boolean, reason: string}}
 */
export function validateMemoryWrite(text, factValue = '') {
  const checks = [text, factValue].filter(v => v && typeof v === 'string')
  for (const chunk of checks) {
    const result = containsSensitiveData(chunk)
    if (result.hit) return { ok: false, reason: result.reason }
  }
  return { ok: true, reason: '' }
}

/** 导出便于测试 */
export const _internal = { KEYWORD_PATTERNS, PHONE_PATTERN, ID_CARD_PATTERN, ADDRESS_PATTERNS }
