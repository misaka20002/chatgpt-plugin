import { Config } from './config.js'
import { makeForwardMsg } from './common.js'

const MAX_FORWARD_CHARS = 6000
const MAX_FORWARD_NODES = 50
const FORWARD_TITLE_RESERVE = 32
const MAX_FORWARD_RESULT_LENGTH = 4500

function splitTextByLength(text, maxLength) {
  if (text.length <= maxLength) {
    return [text]
  }

  const chunks = []
  let current = ''
  for (const line of text.split('\n')) {
    const pendingLine = current ? `\n${line}` : line
    if ((current + pendingLine).length <= maxLength) {
      current += pendingLine
      continue
    }

    if (current) {
      chunks.push(current)
      current = ''
    }

    if (line.length <= maxLength) {
      current = line
      continue
    }

    for (let i = 0; i < line.length; i += maxLength) {
      chunks.push(line.slice(i, i + maxLength))
    }
  }

  if (current) {
    chunks.push(current)
  }
  return chunks
}

function truncateToolResultForForward(text) {
  if (text.length <= MAX_FORWARD_RESULT_LENGTH) {
    return text
  }

  return `${text.slice(0, MAX_FORWARD_RESULT_LENGTH)}\n\n...工具返回内容过长已截断，完整内容请查看控制台info日志`
}

function splitForwardMessages(messages, title) {
  const titleLength = title ? title.length : 0
  const maxContentChars = Math.max(1, MAX_FORWARD_CHARS - titleLength - FORWARD_TITLE_RESERVE)
  return messages.flatMap(message => splitTextByLength(String(message), maxContentChars))
}

function buildForwardBatches(messages, title) {
  const splitMessages = splitForwardMessages(messages, title)
  const titleLength = title ? title.length : 0
  const titleNodeCount = title ? 1 : 0
  const maxBatchChars = MAX_FORWARD_CHARS - FORWARD_TITLE_RESERVE
  const batches = []
  let batch = []
  let batchChars = titleLength
  let batchNodes = titleNodeCount

  for (const message of splitMessages) {
    const messageLength = message.length
    if (
      batch.length > 0 &&
      (batchChars + messageLength > maxBatchChars ||
        batchNodes + 1 > MAX_FORWARD_NODES)
    ) {
      batches.push(batch)
      batch = []
      batchChars = titleLength
      batchNodes = titleNodeCount
    }

    batch.push(message)
    batchChars += messageLength
    batchNodes++
  }

  if (batch.length > 0) {
    batches.push(batch)
  }

  return batches
}

async function replyForwardBatches(e, messages, title) {
  const batches = buildForwardBatches(messages, title)
  for (let i = 0; i < batches.length; i++) {
    const batchTitle = batches.length > 1 ? `${title} ${i + 1}/${batches.length}` : title
    await e.reply(await makeForwardMsg(e, batches[i], batchTitle))
  }
}

function stringifyToolPayload(payload) {
  if (payload === undefined) {
    return 'undefined'
  }
  if (payload === null) {
    return 'null'
  }
  if (typeof payload === 'string') {
    return payload
  }
  if (payload instanceof Error) {
    return `${payload.name}: ${payload.message}${payload.stack ? `\n${payload.stack}` : ''}`
  }

  try {
    const seen = new WeakSet()
    return JSON.stringify(payload, (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString()
      }
      if (value && typeof value === 'object') {
        if (seen.has(value)) {
          return '[Circular]'
        }
        seen.add(value)
      }
      return value
    }, 2)
  } catch (err) {
    return String(payload)
  }
}

export function formatToolForwardRecord(record) {
  const callPayload = {
    name: record.name,
    arguments: record.args ?? {}
  }

  return [
    record.platform ? `接口：${record.platform}` : '',
    record.round ? `轮次：${record.round}` : '',
    `工具：${record.name || 'unknown'}`,
    '',
    '工具调用：',
    stringifyToolPayload(callPayload),
    '',
    '工具返回：',
    truncateToolResultForForward(stringifyToolPayload(record.result))
  ].filter(line => line !== '').join('\n')
}

function formatToolForwardSummary(record) {
  if (typeof record === 'string') {
    return '工具调用与返回内容已记录到控制台。'
  }

  return [
    record.platform ? `接口：${record.platform}` : '',
    record.round ? `轮次：${record.round}` : '',
    `工具：${record.name || 'unknown'}`,
    '',
    '工具调用与返回内容较长或可能触发风控，完整内容请查看控制台日志。'
  ].filter(line => line !== '').join('\n')
}

export async function sendToolCallForwardMsg(e, records = [], title = '工具调用与返回') {
  if (!Config.forwardToolCallResult || !e || !Array.isArray(records) || records.length === 0) {
    return
  }

  const messages = records
    .filter(Boolean)
    .map(record => typeof record === 'string' ? record : formatToolForwardRecord(record))
    .filter(Boolean)

  if (messages.length === 0) {
    return
  }

  try {
    await replyForwardBatches(e, messages, title)
  } catch (err) {
    logger.warn(`[Chatgpt][ToolForward] 发送工具调用合并转发失败: ${err.message}`)
    try {
      const summaryMessages = records
        .filter(Boolean)
        .map(formatToolForwardSummary)
        .filter(Boolean)
      await replyForwardBatches(e, summaryMessages, `${title}摘要`)
    } catch (summaryErr) {
      logger.warn(`[Chatgpt][ToolForward] 发送工具调用摘要合并转发失败: ${summaryErr.message}`)
      try {
        await e.reply(`[${title}] 合并转发发送失败，工具调用与返回已记录到控制台。`, true)
      } catch (fallbackErr) {
        logger.warn(`[Chatgpt][ToolForward] 发送工具调用兜底提示失败: ${fallbackErr.message}`)
      }
    }
  }
}
