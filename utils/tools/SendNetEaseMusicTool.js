import fetch from 'node-fetch'
import { AbstractTool } from './AbstractTool.js'

/** 发送网易云音乐卡片 */
export class SendNetEaseMusicTool extends AbstractTool {
  name = 'sendNetEaseMusic'

  parameters = {
    properties: {
      keyword: {
        type: 'string',
        description: '网易音乐的标题或关键词, 可以是歌曲名或歌曲名+歌手名的组合'
      },
      targetGroupIdOrQQNumber: {
        type: 'string',
        description: 'Fill in the target user_id or groupId when you need to send music to specific group or user, otherwise leave blank'
      }
    },
    required: ['keyword']
  }

  func = async function (opts, e) {
    let { keyword, targetGroupIdOrQQNumber } = opts

    try {
      // 1. 根据关键词搜索网易云音乐 (limit=1 只需要匹配到的第一首歌)
      let searchUrl = `http://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&offset=0&total=true&limit=1`
      let response = await fetch(searchUrl)
      let json = await response.json()

      // 校验是否搜索到了歌曲
      if (!json.result || json.result.songCount === 0 || !json.result.songs || json.result.songs.length === 0) {
        return `NetEase music search failed: no result found for keyword "${keyword}"`
      }

      // 提取第一首歌曲的信息
      let song = json.result.songs[0]
      let id = song.id
      let songName = song.name
      let artistsName = song.artists.map(a => a.name).join('&')

      // 2. 确定发送的目标对象
      const defaultTarget = e.isGroup ? e.group_id : e.sender.user_id
      const target = isNaN(targetGroupIdOrQQNumber) || !targetGroupIdOrQQNumber
        ? defaultTarget
        : parseInt(targetGroupIdOrQQNumber) === e.bot.uin ? defaultTarget : parseInt(targetGroupIdOrQQNumber)

      // 3. 发送网易云音乐卡片
      let group = await e.bot.pickGroup(target)

      // 检查是否支持 shareMusic 方法
      if (typeof group.shareMusic === 'function') {
        await group.shareMusic('163', id)
      } else {
        // 构建音乐分享消息
        const musicMsg = {
          type: 'music',
          data: {
            type: '163', // 明确指出是网易云音乐
            id: id,
            jumpUrl: `https://music.163.com/#/song?id=${id}`
          }
        }
        await e.reply(musicMsg)
      }

      return `Successfully found and shared NetEase music (网易音乐): [${songName} by ${artistsName}] to ${target}`
    } catch (err) {
      return `NetEase music search and share failed: ${err}`
    }
  }

  description = 'Useful when you want to search and send NetEase Music (网易音乐) directly by keyword. If no extra description needed, just reply <EMPTY> at the next turn.'
}