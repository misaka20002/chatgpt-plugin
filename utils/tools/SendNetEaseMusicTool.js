import fetch from 'node-fetch'
import { AbstractTool } from './AbstractTool.js'

/** 发送网易云音乐卡片+语音 */
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
      // 根据关键词搜索网易云音乐 (limit=1 只需要匹配到的第一首歌)
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

      // 确定发送的目标对象
      const defaultTarget = e.isGroup ? e.group_id : e.sender.user_id
      const target = isNaN(targetGroupIdOrQQNumber) || !targetGroupIdOrQQNumber
        ? defaultTarget
        : parseInt(targetGroupIdOrQQNumber) === e.bot.uin ? defaultTarget : parseInt(targetGroupIdOrQQNumber)

      // 发送网易云音乐卡片
      const musicMsg = {
        type: 'music',
        data: {
          type: '163', // 明确指出是网易云音乐
          id: id,
          jumpUrl: `https://music.163.com/#/song?id=${id}`
        }
      }
      await e.reply(musicMsg)

      // 请求高清接口获取直链
      let audioUrl = `http://music.163.com/song/media/outer/url?id=${id}.mp3`
      try {
        let options = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12; MI Build/SKQ1.211230.001)',
            'Cookie': 'versioncode=8008070; os=android; channel=xiaomi; appver=8.8.70;'
          },
          body: `ids=${JSON.stringify([id])}&level=exhigh&encodeType=mp3`
        }
        let urlResponse = await fetch('https://interface3.music.163.com/api/song/enhance/player/url/v1', options)
        let resJson = await urlResponse.json()
        if (resJson.code === 200 && resJson.data && resJson.data[0] && resJson.data[0].url) {
          audioUrl = resJson.data[0].url
        }
      } catch (err) {
        console.error('获取网易高清接口失败:', err)
      }
      // 发送 OneBotv11 语音
      await e.reply(segment.record(audioUrl))

      return `Successfully found and and shared QQ music: [${songName} by ${artistsName}] to ${target}. Music Card and Voice Record sent.`
    } catch (err) {
      return `NetEase music search and share failed: ${err}`
    }
  }

  description = 'Useful when you want to search and send NetEase Music (网易音乐) directly by keyword. If no extra description needed, just reply <EMPTY> at the next turn.'
}