import fetch from 'node-fetch'
import crypto from 'crypto'
import { AbstractTool } from './AbstractTool.js'

/** 发送QQ音乐卡片与语音 */
export class SendQQMusicTool extends AbstractTool {
    name = 'sendQQMusic'

    parameters = {
        properties: {
            keyword: {
                type: 'string',
                description: 'QQ音乐的标题或关键词, 可以是歌曲名或歌曲名+歌手名的组合'
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
            let qq_search_json = {
                "comm": { "uin": "0", "authst": "", "ct": 29 },
                "search": {
                    "method": "DoSearchForQQMusicMobile",
                    "module": "music.search.SearchCgiService",
                    "param": {
                        "grp": 1,
                        "num_per_page": 1, // 只需要匹配到的第一首歌
                        "page_num": 1,
                        "query": keyword,
                        "remoteplace": "miniapp.1109523715",
                        "search_type": 0,
                        "searchid": String(Math.floor(Math.random() * 10000000))
                    }
                }
            }

            let searchUrl = `https://u.y.qq.com/cgi-bin/musicu.fcg`
            let response = await fetch(searchUrl, {
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(qq_search_json)
            })

            let res = await response.json()

            // 校验是否成功返回
            if (res.code !== 0) {
                return `QQ music search failed: API error code ${res.code}`
            }

            let songList = res.search?.data?.body?.song?.list || res.search?.data?.body?.item_song || []
            if (!songList || songList.length === 0) {
                return `QQ music search failed: no result found for keyword "${keyword}"`
            }

            // 提取第一首歌曲的信息
            let song = songList[0]
            let mid = song.mid
            let songId = song.id
            let songName = song.title ? song.title.replace(/\<(\/)?em\>/g, '') : 'Unknown' // 去除高亮标签
            let artistsName = song.singer ? song.singer.map(s => s.name).join('/') : 'Unknown'

            // 生成音乐封面链接
            let album_mid = song.album ? song.album.mid : ''
            let singer_mid = song.singer && song.singer.length > 0 ? song.singer[0].mid : ''
            let picId = (song.vs && song.vs[1]) ? `T062R150x150M000${song.vs[1]}` : (album_mid ? `T002R150x150M000${album_mid}` : (singer_mid ? `T001R150x150M000${singer_mid}` : ''))
            let picUrl = picId ? `http://y.gtimg.cn/music/photo_new/${picId}.jpg` : ''
            let jumpUrl = `https://y.qq.com/n/yqq/song/${mid}.html`

            // 计算QQ音乐直链
            let uin = e?.bot?.uin || e?.self_id || '0'
            let code = crypto.createHash('md5').update(`${mid}q;z(&l~sdf2!nK`).digest('hex').substring(0, 5).toUpperCase()
            let playUrl = `http://c6.y.qq.com/rsc/fcgi-bin/fcg_pyq_play.fcg?songid=&songmid=${mid}&songtype=1&fromtag=50&uin=${uin}&code=${code}`

            // 确定发送的目标对象
            const defaultTarget = e.isGroup ? e.group_id : (e.sender?.user_id || e.user_id)
            const target = isNaN(targetGroupIdOrQQNumber) || !targetGroupIdOrQQNumber
                ? defaultTarget
                : parseInt(targetGroupIdOrQQNumber) === e.bot?.uin ? defaultTarget : parseInt(targetGroupIdOrQQNumber)

            const musicMsg = {
                type: 'music',
                data: {
                    type: 'custom',
                    url: jumpUrl,
                    audio: playUrl,
                    title: songName,
                    image: picUrl,
                    singer: artistsName
                }
            }

            // 构建语音 Record (OneBotv11)
            const recordMsg = {
                type: 'record',
                file: playUrl
            }

            // 发送音乐卡片与语音
            let isTargetCurrent = (target === defaultTarget)

            if (isTargetCurrent) {
                await e.reply(musicMsg)
                await e.reply(recordMsg)
            } else {
                // 若目标跨群或私聊，使用 pickGroup/pickFriend
                let group = await e.bot.pickGroup(target).catch(() => null)
                if (group) {
                    await group.sendMsg(musicMsg)
                    await group.sendMsg(recordMsg)
                } else {
                    let friend = await e.bot.pickFriend(target).catch(() => null)
                    if (friend) {
                        await friend.sendMsg(musicMsg)
                        await friend.sendMsg(recordMsg)
                    }
                }
            }

            return `Successfully found and shared QQ music: [${songName} by ${artistsName}] to ${target}. Music Card and Voice Record sent.`
        } catch (err) {
            return `QQ music search and share failed: ${err.message || err}`
        }
    }

    description = 'Useful when you want to search and send QQ Music (QQ音乐) directly by keyword. If no extra description needed, just reply <EMPTY> at the next turn.'
}