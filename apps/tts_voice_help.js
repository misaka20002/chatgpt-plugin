import plugin from '../../../lib/plugins/plugin.js';
import common from '../../../lib/common/common.js';
import { Config } from '../utils/config.js'
import { speakers } from '../utils/tts.js'

export class voicechangehelp extends plugin {
	constructor() {
		super({
			name: 'tts语音替换帮助',
			dsc: 'tts语音替换帮助',
			event: 'message',
			priority: 999,
			rule: [{
				reg: `^#tts(语音)?(替换)?帮助$`,
				permission: 'master',
				fnc: `voicechangehelp`
				},
			        {
			          reg: '^#tts情感(等级)?(帮助)?',
			          fnc: 'change_vits_emotion',
			          permission: 'master'
			        }
			]
		})
	}


	async voicechangehelp(e) {
		let msg1 = `小呆毛tts语音替换帮助：\n` +
			`#chatgpt设置语音角色派蒙_ZH\n` +
			`#chatgpt设置语音角色可莉_ZH\n` +
			`#tts情感等级1`
		let msg2 = `设置：\n在ChatGPT-Plugin的锅巴插件里：\nvits-uma-genshin-honkai语音转换API地址：\n` +
			`https://v2.genshinvoice.top\n` +
			`云转码API发送数据模式：[文件]\n` +
			`感谢genshinvoice.top提供的api支持！`
		let speakertip1 = "可选列表：\n"
		let speakertip2 = ""
		let speakertip3 = ""
		for (let i = 0; i < speakers.length; i++) {
			if (i <= (speakers.length / 3)) {
				speakertip1 += speakers[i]
				if (i % 2 == 0) {
					speakertip1 += "　　"
				}
				else {
					speakertip1 += "\n"
				}
			}
			if (i <= ((speakers.length * 2) / 3) && i > (speakers.length / 3)) {
				speakertip2 += speakers[i]
				if (i % 2 == 0) {
					speakertip2 += "　　"
				}
				else {
					speakertip2 += "\n"
				}
			}
			if (i > ((speakers.length * 2) / 3)) {
				speakertip3 += speakers[i]
				if (i % 2 == 0) {
					speakertip3 += "　　"
				}
				else {
					speakertip3 += "\n"
				}
			}

		}
		let msgx = await common.makeForwardMsg(e, [msg1, msg2, speakertip1, speakertip2, speakertip3], `tts语音替换帮助`);
		e.reply(msgx);
		return true;
	}


async change_vits_emotion (e) {
	let input_vits_emotion = e.msg.replace(/^#tts情感(等级)?(帮助)?/, '')
	if (!input_vits_emotion) {
      		return e.reply(`输入整数0-9，情感等级由平静到激动。如：\n#tts情感等级1`, false)
    	}
	if (/^[0-9]$/.test(input_vits_emotion)) {
		Config.vits_emotion = input_vits_emotion
		return e.reply(`tts情感等级已修改为${parseInt(input_vits_emotion)}！`)
	} else {
		return e.reply('请输入整数0-9喵！', false)
	}
}
}
