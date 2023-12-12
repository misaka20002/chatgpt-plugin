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
			          fnc: 'set_vits_emotion',
			          permission: 'master'
			        },
			        {
			          reg: '^#tts语言设置(帮助)?',
			          fnc: 'set_tts_language',
			          permission: 'master'
			        },
			        {
			          reg: '^#tts(语音)?(开启|关闭)转日语$',
			          fnc: 'set_autoJapanese',
			          permission: 'master'
			        },
			        {
			          reg: '^#tts(查看)?(当|目)前(语音)?设置$',
			          fnc: 'show_tts_voice_help_config',
			          permission: 'master'
			        },
			]
		})
	}


	async voicechangehelp(e) {
		let msg1 = `小呆毛tts语音替换帮助：\n` +
			`每个独立对话可单独设置:\n` +
			`#chatgpt设置语音角色派蒙_ZH\n` +
			`#chatgpt设置语音角色可莉_ZH\n` +
			`#tts情感等级1|#tts情感帮助\n` +
			`#tts语音(开启|关闭)转日语\n` +
			`#tts语言设置auto|#tts语言设置帮助\n` +
			`#tts查看当前语音设置` +
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


async set_vits_emotion (e) {
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

async set_tts_language (e) {
	let input_tts_language = e.msg.replace(/^#tts语言设置(帮助)?/, '')
	if (!input_tts_language) {
      		return e.reply(`可选ZH, JP, EN, mix(api暂不支持), auto(支持中日英自动,但api目前罗马数字会用英文`, false)
    	}
	input_tts_language = input_tts_language.toLowerCase()
	if (/^zh$|^jp$|^en$|^mix$|^auto$/.test(input_tts_language)) {
		if (/^zh$|^jp$|^en$/.test(input_tts_language)) input_tts_language = input_tts_language.toUpperCase()
		Config.tts_language = input_tts_language
		return e.reply(`tts语言已设置为${parseInt(input_tts_language)}！`)
	} else {
		return e.reply('可选ZH, JP, EN, mix(api暂不支持), auto\n例如#tts语言设置auto', false)
	}
}

async set_autoJapanese (e) {
	const type = e.msg.replace(/^#tts(语音)?(开启|关闭)转日语$/g, '$2')
	if (type === '开启' || type === '关闭') {
		Config.autoJapanese = type === '开启' ? true : false
		return e.reply(`tts语音已${type}转日语！`)
	} else {
		return e.reply('喵？')
	}
}

/** 发送当前设置 */
async show_tts_voice_help_config (e) {


	let show_tts_voice_help_config_msg1 = 'tts语音当前设置：'
	let show_tts_voice_help_config_msg2 = `  默认角色：${Config.defaultTTSRole}\n  发音语言：${config.tts_language}\n  vits_emotion：${config.vits_emotion}\n  noiseScale：${config.noiseScale}\n  noiseScaleW：${config.noiseScaleW}\n  lengthScale：${config.lengthScale}\n  sdp_ratio：${config.sdp_ratio}`
	
	let show_tts_voice_help_config_msg2_msgx = await makeForwardMsg(e, [show_tts_voice_help_config_msg1, show_tts_voice_help_config_msg2], '小呆毛tts语音当前设置');
	return e.reply(show_tts_voice_help_config_msg2_msgx);
}





}
