import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { render } from '../utils/common.js'
let version = Config.version
// 聊天内帮助图与 Web 帮助页共用这一份数据：server/index.js 直接导入它，
// 不再读 resources/help.json（那份已删除）。改动条目时两处会同时生效。
export let helpData = [
  {
    group: '聊天',
    list: [
      {
        icon: 'chat',
        title: Config.toggleMode === 'at' ? '@我+聊天内容' : '#chat+聊天内容',
        desc: '与机器人聊天'
      },
      {
        icon: 'chat-private',
        title: '私聊与我对话',
        desc: '与机器人聊天'
      },
      // {
      //   icon: 'destroy',
      //   title: '#chatgpt删除对话+对话id或@用户',
      //   desc: '删除指定对话，并清空与用户的关联信息。@用户时支持多个用户'
      // },
      {
        icon: 'destroy',
        title: '#(结束|新开|摧毁|毁灭|完结)对话',
        desc: '结束自己当前对话，下次开启对话机器人将遗忘掉本次对话内容。'
      },
      {
        icon: 'destroy',
        title: '#(结束|新开|摧毁|毁灭|完结)全部[模式]?对话',
        desc: '结束正在与本机器人进行对话的全部用户的对话。'
      },
      {
        icon: 'destroy-other',
        title: '#(结束|新开|摧毁|毁灭|完结)对话 @某人',
        desc: '结束该用户当前对话，下次开启对话机器人将遗忘掉本次对话内容。'
      },
      {
        icon: 'confirm',
        title: '#chatgpt(导出)聊天记录',
        desc: '图片形式导出当前提供商的聊天记录'
      },
      {
        icon: 'list',
        title: '#我的记忆',
        desc: '#群记忆 #记忆帮助 #群记忆状态'
      },
      {
        icon: 'list',
        title: '#at图谱[At群友]',
        desc: '不填查看自己，@成员查看对方；附前 5 位好感度排行'
      },
      {
        icon: 'list',
        title: '#gpt删除前n条对话',
        desc: '对话聊天记录的微调'
      },
    ]
  },
  {
    group: '管理',
    list: [
      {
        icon: 'picture',
        title: '#chatgpt图片模式',
        desc: '机器人以图片形式回答'
      },
      {
        icon: 'text',
        title: '#chatgpt文本模式',
        desc: '机器人以文本形式回答，默认选项'
      },
      {
        icon: 'sound',
        title: '#chatgpt语音模式',
        desc: '机器人以语音形式回答'
      },
      {
        icon: 'chat',
        title: '#tts语音帮助',
        desc: '提供更改tts发音设定的功能'
      },
      {
        icon: 'game',
        title: '#chatgpt设置语音角色',
        desc: '设置语音模式下回复的角色音色。优先级高于默认语音角色'
      },
      {
        icon: 'blue',
        title: '#chatgpt(本群)?(群xxx)?闭嘴(x秒/分钟/小时)',
        desc: '让机器人在本群/某群闭嘴。不指定群时认为全局闭嘴。'
      },
      {
        icon: 'eye',
        title: '#chatgpt(本群)?(群xxx)?(张嘴|开口|说话|上班)',
        desc: '让机器人在本群/某群重新可以说话。不指定群时认为全局开口。'
      },
      {
        icon: 'list',
        title: '#chatgpt查看闭嘴',
        desc: '查看当前闭嘴情况。'
      },
      {
        icon: 'confirm',
        title: '#chatgpt开启/关闭问题确认',
        desc: '开启或关闭机器人收到消息后的确认回复消息。'
      },
      {
        icon: 'list',
        title: '#(关闭|打开)群聊上下文',
        desc: '开启后将会发送近期群聊中的对话给机器人提供参考'
      },
      {
        icon: 'switch',
        title: '#chatgpt(允许|禁止|打开|关闭|同意)私聊',
        desc: '开启后将关闭本插件的私聊通道。(主人不影响)'
      },
      {
        icon: 'token',
        title: '#chatgpt(设置|添加)群聊[白黑]名单',
        desc: '白名单配置后只有白名单内的群可使用本插件，配置黑名单则会在对应群聊禁用本插件'
      }
    ]
  },
  {
    group: '设置',
    list: [
      {
        icon: 'chat',
        title: '#chatgpt切换模型',
        desc: '主人通过数字列表依次选择主模型和同协议备用模型；两步完成后生效。所有用户跟随全局选择。'
      },
      {
        icon: 'smiley-wink',
        title: '#chatgpt设置模型 / #chatgpt获取可用模型',
        desc: '主人修改当前提供商模型；新增、删除条目请使用锅巴。'
      },
      {
        icon: 'switch',
        title: '#chatgpt设置Key / #chatgpt设置地址',
        desc: '主人修改当前提供商参数；更多条目请使用锅巴。'
      },
      {
        icon: 'token',
        title: '#chatgpt(开启|关闭)智能模式',
        desc: 'API模式下打开或关闭智能模式。'
      }
    ]
  },
  {
    group: '设定',
    list: [
      // {
      //   icon: 'smiley-wink',
      //   title: '#chatgpt设定列表',
      //   desc: '【暂不可用】查看所有设定列表，以转发消息形式'
      // },
      // {
      //   icon: 'eat',
      //   title: '#chatgpt查看设定【设定名】',
      //   desc: '查看指定名字的设定内容。其中API默认和Sydney默认为锅巴面板配置的设定'
      // },
      {
        icon: 'coin',
        title: '#chatgpt添加设定',
        desc: '添加一个设定，分别输入设定名称和设定内容。如果名字已存在，则会覆盖（相当于修改）'
      },
      {
        icon: 'switch',
        title: '#chatgpt使用设定',
        desc: '不带设定名时用数字列表选择本地已保存的设定；应用前可先把当前设定备份成新的本地设定。'
      },
      {
        icon: 'destroy',
        title: '#chatgpt删除设定',
        desc: '不带设定名时用数字列表选择本地已保存的设定；删除前可先把原内容另存为新名字。'
      },
      // {
      //   icon: 'confirm',
      //   title: '#chatgpt(上传|分享|共享)设定',
      //   desc: '【暂不可用】上传设定到云端（云端设定站已下线）'
      // },
      // {
      //   icon: 'confirm',
      //   title: '#chatgpt(删除|取消|撤销)共享设定+设定名',
      //   desc: '从远端删除，只能删除自己上传的设定，根据机器人主人qq号判断。'
      // },
      // {
      //   icon: 'confirm',
      //   title: '#chatgpt(在线)浏览设定(+关键词)(页码X)',
      //   desc: '搜索公开的设定。默认返回前十条，使用页码X可以翻页，使用关键词可以检索。页码从1开始。'
      // },
      // {
      //   icon: 'smiley-wink',
      //   title: '#chatgpt预览设定详情(+设定名)',
      //   desc: '根据设定名称预览云端设定的详情信息。'
      // },
      // {
      //   icon: 'confirm',
      //   title: '#chatgpt导入设定',
      //   desc: '【暂不可用】从云端导入其他人分享的设定（云端设定站已下线）'
      // },
      // {
      //   icon: 'help',
      //   title: '#chatgpt设定帮助',
      //   desc: '设定帮助'
      // }
    ]
  },
  {
    group: '其他',
    list: [
      {
        icon: 'smiley-wink',
        title: '#gpt发语音[内容]',
        desc: '用于测试全局语音'
      },
      {
        icon: 'help',
        title: '#chatgpt模式帮助',
        desc: '查看多种聊天模式的区别及当前使用的模式'
      },
      {
        icon: 'help',
        title: '#chatgpt全局回复帮助',
        desc: '获取配置全局回复模式和全局语音角色的命令帮助'
      },
      {
        icon: 'help',
        title: '#chatgpt帮助',
        desc: '获取本帮助'
      }
    ]
  }
]

export class help extends plugin {
  constructor(e) {
    super({
      name: 'ChatGPT-Plugin 帮助',
      dsc: 'ChatGPT-Plugin 帮助面板',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: '^#(chatgpt|ChatGPT)(命令|帮助|菜单|help|说明|功能|指令|使用说明)$',
          fnc: 'help'
        }
      ]
    })
  }

  async help(e) {
    await render(e, 'chatgpt-plugin', 'help/index', { helpData, version })
  }
}
