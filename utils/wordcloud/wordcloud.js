import Tokenizer from './tokenizer.js'
import { render } from '../common.js'
import {
  getUserDetailedInfo,
} from '../../utils/paimonFuction.js'

export async function makeWordcloud(e, groupId, duration = 0, userId) {
  let tokenizer = getTokenizer(e)
  let topK = await tokenizer.getKeywordTopK(e, groupId, 100, duration, userId)

  // 计算总热度（所有词频相加，体现活跃度）
  let wordCount = 0
  topK.forEach(item => { wordCount += item[1] })

  let list = JSON.stringify(topK)
  logger.info(`[词云生成] 列表长度: ${topK.length}`)

  // 获取群名
  let groupName = groupId
  if (e.group) {
    try {
      const info = await e.group.getInfo()
      groupName = info.group_name || groupId
    } catch (e) { }
  }

  // 判断统计时长
  let durationText = '近期'
  if (e.msg.includes('本周')) durationText = '本周'
  else if (e.msg.includes('本月')) durationText = '本月'
  else if (e.msg.includes('今日') || e.msg.includes('今天') || e.msg.includes('群友在聊什么')) durationText = '今日'
  else if (duration > 0) durationText = `${Math.round(duration)}小时`

  // 组装超可爱的标题
  let title = `✨ ${groupName} 词云 ✨`
  if (userId) {
    let user = await getUserDetailedInfo(e, userId);
    let targetName = user?.card || userId
    title = `✨ ${targetName} 的词云 ✨`
  }

  // 传入模板进行渲染
  let img = await render(e, 'chatgpt-plugin', 'wordcloud/index', {
    list,
    title,
    durationText,
    wordCount
  }, { retType: 'base64' })

  return img
}

function getTokenizer(e) {
  return Tokenizer.default
}