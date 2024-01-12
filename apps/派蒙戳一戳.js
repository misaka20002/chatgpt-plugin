import plugin from '../../../lib/plugins/plugin.js';
import { segment } from 'icqq'
import cfg from '../../../lib/config/config.js'
import common from '../../../lib/common/common.js'
import moment from 'moment'
import fetch from 'node-fetch'
import { Config } from '../utils/config.js'
import uploadRecord from '../utils/uploadRecord.js'
import { generate_msg_Daiyu } from '../utils/randomMessage.js'

//如使用非icqq请在此处填写机器人QQ号
let BotQQ = ''

// 支持信息详见文件最下方
//在这里设置事件概率,请保证概率加起来小于1，少于1的部分会触发反击
let reply_text = 0.55 //文字回复概率
let reply_img = 0.15 //图片回复概率
let reply_voice = 0.15 //语音回复概率
let mutepick = 0.05 //禁言概率
let example = 0 //拍一拍表情概率
//剩下的0.1概率就是反击

//回复文字列表
let word_list = [
    '怎么了吗？',
    '派蒙可是会很多东西的哦，快点快点发送#帮助',
    '想知道怎么使用派蒙吗？快点给派蒙发送#帮助',
    '喵？查询遇到困难了吗？试试派蒙的#扫码登录',
    '派蒙肚子饿了，帮派蒙炒一盘菜（躺）',
    '想...想要搞大派蒙的肚子吗？v50请派蒙吃肯德基>_<',
    '呜呜...可以亲亲派蒙吗？',
    '再戳派蒙要生气了！',
    '派蒙也是有脾气的！',
    '派蒙有种被兰纳罗拿胡萝卜指着的感觉',
    '别戳派蒙了别戳派蒙了QAQ嘤嘤嘤',
    '就算你喜欢派蒙也不能老戳派蒙呀~',
    '不要再戳了！派蒙真的要被你气死了！！！',
    '你、你不要这么用力嘛！戳疼派蒙了呜呜呜~~~',
    '别戳派蒙了别戳派蒙了......',
    '派蒙要被揉坏了',
    '请，请轻一点，派蒙会痛的......',
    '呜呜，你别戳派蒙了',
    '请不要不可以戳派蒙啦~',
    '别戳派蒙了可以嘛',
    '派蒙要戳坏掉了>_<，呜呜呜',
    '你老是欺负派蒙，哭哭惹',
    '别戳派蒙了啊！再戳派蒙就要坏掉了呀',
    '不可以，不可以，不可以！戳疼派蒙了！',
    '派蒙痛QAQ...',
    '不要戳戳派蒙…',
    '派蒙诅咒你买方便面没有叉子！',
    '救救派蒙呀，有变态>_<！！！',
    '不要再戳了！派蒙真的要被你气洗了！！！',
    '你是不是喜欢派蒙呀？',
    '变态萝莉控！',
    '派蒙要戳坏掉了>_<',
    '你没睡醒吗？一天天就知道戳派蒙',
    '不可以戳戳派蒙>_<',
    '不要戳派蒙了，再戳派蒙就坏掉啦>_<',
    '是不是要可爱的派蒙，揍你一顿才开心，哼',
    '讨厌死了，你好烦人啊，派蒙不陪你玩了',
    '不要再戳了！派蒙真的要被你气洗了>_<',
    '不要再戳派蒙了！',
    '你要是再戳派蒙！！派蒙~派蒙就打你，哼！',
    '哼~派蒙才不是傲娇呢，那是什么不知道鸭',
    '派蒙，派蒙才不会这样子！真正的派蒙从来不是傲娇！傲，傲娇什么 的，都，都是别人杜摆~嗯，一点，一点也没有呢',
    '派蒙……派蒙……才不是傲娇呢',
    '只是刚好路过而已，才不是因为你戳派蒙特地来看你的呢！你可不要异想天开',
    '派蒙可不是因为喜欢才这样做的哦',
    '笨蛋，派蒙才，，，才不是特地来找你们的呢',
    '啊~好舒服喵，其实派蒙也不是很想要这个~如果你硬要给派蒙，派蒙就勉为其难的收下了',
    '只要你需要派蒙就会在哦',
    '你这个变态，大变态，超级变态！不要再碰派蒙了！',
    '你在想对派蒙涩涩对吗，不可以哦',
    '派蒙在哦！是有什么事情吗？',
    '你会一直记得派蒙吗',
    '派蒙不但可爱而且可爱你啦',
    '派蒙发脾气了你就听着,结束了派蒙会怂给你看',
    '劝你别整天对派蒙戳戳戳的有本事你来亲亲派蒙',
    '你走上了爱派蒙这条不归路。',
    '宝宝是不是又熬夜了，派蒙看你还在线',
    '派蒙把自己送给你好了虽然派蒙很可爱但是派蒙养不起自己了',
    '派蒙偏偏要无理取闹除非抱抱派蒙',
    '要派蒙给你暖被窝吗~诶嘿嘿~',
    '啊...温柔一点...把派蒙戳疼辣..',
    '要戳坏派蒙了！',
    '你欺负派蒙，呜呜',
    '派蒙怕疼...轻一点~ ',
    '再戳派蒙就坏了！！！ ',
    '请...请...不要戳派蒙那里...',
    '要轻一点戳派蒙哦~',
    '派蒙都快要被你气孕了',
    '快带派蒙去玩！（打滚）',
    '是哪个笨蛋在戳派蒙？',
    '你是准备对派蒙负责了吗，喵~',
    '哭哭，真的戳的派蒙很疼啦QAQ',
    '派蒙今天想吃糖霜史莱姆！给派蒙买嘛~',
    '再喜欢派蒙也不能这样戳啦，真的会坏掉的笨蛋!',
    '你带来新的故事吗？派蒙用派蒙亲手做的派蒙烤鱼与你交换',
    '猫咪和狗狗和派蒙你更喜欢哪一个喵？',
    '谢谢你 在这世界的角落 发现了派蒙QAQ',
    '派蒙派蒙 - ( ゜- ゜)つロ 乾杯~',
    '把嘴张开（抬起脚）',
    '啊……你戳疼派蒙了Ծ‸Ծ',
    '你干嘛！（公鸭嗓）',
    '再...再戳派蒙的话，派蒙就咬你！',
    '现在是派蒙学习的时间',
    '派蒙陪你玩就是了！',
    '派蒙已经不算是小孩了，一个人也可以战斗！',
    '虽然派蒙现在还是孩子，不过很快就会长大的，到了那时……那个……',
    '好想快点长大，长到和主人一样大',
    '派蒙听说男孩子都是变态……',
    '派蒙、派蒙要按响防狼魔石了哦！？',
    '你是小孩子吗？！（生气）',
    '摸摸派蒙的头吧！ 就一下下啦~',
    '变态！？是、是你啊～你果然是变态！',
];

// 纳西妲中文，扒文件改地址： https://bbs.mihoyo.com/ys/obc/content/5111/detail?bbs_presentation_style=no_header 在浏览器F12的网络截取到之后复制全部为node.js，用notepad++的crrl+M标记和正则表达式提取，正则表达式（包括,）： "https:\S*(ogg|mp3|wav)",
// 替换戳一戳语音角色在429行
/**纳西妲中文语音 */
let voice_list_nahida_cn = [
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/4d9feb71760c5e8eb5f6c700df12fa0c_6824265537002152805.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c9e517b38d68161fb74cfa0b4349cc65_4347861218592112317.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c3c7e9debabb94e3727336c4ce96afeb_224389990055717799.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8a3db4b5fbdc4b20213a6f7339782015_4928929162694702539.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/991bdd5a3cbc3d4c6f3d9fb6e7b820cd_5388252366411848285.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/207cb052df963f3dcf54fc020d19e419_4430928199053665394.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7832e76193d1097de2ff80337b6f5e66_3236404328533189135.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a7400070efbfddd3e3b0e51ab5bd416e_2613139511899834526.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/ab080a46b594bbea4b8b6b102b57ca52_4873007682934420446.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/fc230f074229f92b1dc53f0e2912c1ef_1475816756907451157.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/d3536f987165303f9cec049968aee8e8_448052117450978550.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/f8dd1a21bd89bfb2fbeafc41a6e6105b_2464061296080033511.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/045279c37eabf825a3ead02cd7f63201_2864513860075272994.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/301a47bae0994cdb3c760ef12e89e8dd_5268233442388273437.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/edcfe93b22d3740491bb9faae1af4fa4_7131208721654597216.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9945b7d5018f0f9ec85a795404d71578_6482272657391702471.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9e95f2369323fdd2b3f1263c2c166c6f_1762500052641269578.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cefd8ce810abfd78c6138bb4a5495a4f_3406507472490730277.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7177d5d7c9e6bceea17dfa19246a8311_947270987568402613.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/3dc9d80439bf04c025d6b2fc3ef65690_8740168104152480190.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/705ad5d58037b7ede9c375b79e136db5_5484548306134050243.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a03d821bfe14fe67be85a63f2e4b2ea8_8723240068787191136.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cf45c3b44b9b0ef5f4a7b25376895f1e_3211550444048016001.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/33367d47ecae0d6ad4cf5d08ce310749_5860058669268042217.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9f3f251b63bc4ecbae0c459c86728645_6727447996337295219.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6914a5800526fc5d1fe280c4e7da2ba6_4711627706989616356.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6bcb97d5c63275be4df00507d1a5e738_7884988217586192652.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cf144a233e0971ef0176a0794ee45ecb_8925036841630699252.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/118487fde490b4eb60fbf1b061eabf60_7337639419392007909.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cd7c3d1a69ab87ca2339e6d2d947073a_4052119550327167358.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b4301d67ff0b9b8ed5f20f8677548490_7133441774208169621.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/38413f05cc7dc3fcd4f9940565701921_1980759413293826277.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/99540436483aacba2d3ce1930554b79a_3245245943114192654.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c070cfee21a5b2155d35c78c714c62a0_6654082250841516882.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a5a1b0b56ee4ce1f2a8fd8f0da780477_5778202358371881056.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a92b16367b39d6533e15d5be368877fa_609355584691653441.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/42cfc993aedbd34011dfb507d98ebc06_1021613602285924429.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b7f9bd671e5f663e2468fae6d70e8fc7_4321126464476483388.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b48a9ca50c160247f092d1c94e895779_5468104429965887517.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/0af43c60e3618ab87754455ae898aa5f_7139785141669538993.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8ae62e175ce0bce2fd154e1b97b6fa63_7159626485468514250.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1c2429b34597c975d0463798b632e507_2104120770632135635.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6472b7b374d3f1b2c853bae4ff9d8b26_6402755683915596310.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6ea026eb2691f06e5c972320178ae537_6325311739293565017.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/67a95b896924cc53b283fc06cd2de52c_6914840829824874357.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/29b267cc6748c7a0d4d465d5e333dea5_3065502828430227261.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/3514888ba1f2d3f06bbc226451ec129d_221575416949828224.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/30b19865c6d20be04366ac742e8a67b9_3786598944525696408.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/ccb495a319c34444adbcef7aa155cb1f_2757660068721522026.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/349d2de21774da45c1e97745b365ee1f_4992449842647632459.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/830ee05eba1aacc607dff41e51516f5e_4807239196801935478.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/06a6fda8919bfef6bfff5199c437d032_2713778252536393556.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/d1919304f637ea8dc455dc92afe2ff6e_1431902895779023323.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1f7eaf7451f9cfcbd3e8cd844b28b17e_6176061356688600031.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/df32f2eab30a7f5879c4606dc09a0502_3078148866148088063.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e61ce14dd018af855e212944c3a86e07_6946138339125005920.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/6c346a693c656f3f116d3d428b8b3438_3072149138534909048.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/11c664bd848770184eca5dfd66e89c51_5444646554291536369.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cccd5f5057045c12d8fdde98d4b4116a_7845851735624884706.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1ee24a163e78f8885ed81a0b47b8cae7_6346729070751566019.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1943b45de93aa4ecf3c2bc50e2c37072_5570205242708460822.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/af2ad8de369553cbd7b1c1ecf78b241c_4350686237074109248.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/228f1ae88824bbbdc4f0e96b02b93df2_3172196917569681075.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8931896ce03ab4d2724ff861a5eb14fe_59418760023336306.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/fbc208b80518b91634964ba0783b0f9c_7720219259750270894.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/d02246a2fff6395411f7a1077191725c_3194055208944981775.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/24ad23ef5fde4fead48b52e4492562a8_8054702825063625720.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/f876c09d556b23b9231e9df8d39be246_4572440346090611863.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b84885f5b6a2ebd7bc377984b641ea80_1270250062214132580.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/d9f3e353f1b71d3c601cfa28f15e8ed5_1074679710559344807.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/803a65c8cb872ec0e0038ff35db35cc4_2447311778799308880.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/f5b6ddb7454cbb750e6c02d258c3e03d_8129408147390523371.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/ddf937ea4aac1282901270ba491ece88_986083904906531255.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/f514abfbe4a9358e96038850d6d64742_5784748521077424357.mp3"
]

/**纳西妲日语语音 */
let voice_list_nahida_jp = [
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9618f394ecbcb26441aa52eddd33bfea_1309297346298226467.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/da7ef28976f01a042fafa0a8ed0eae34_6015099485464698110.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/2099cdc449d22b3ec7b1fca5af2965c9_5909736773452979388.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/4dfaaa13142dc6dd0a8f0c55166402b2_9075709493690235973.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c57fec49e84dc39d95529a17681aa0f0_426385927153947444.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/5e5a70f09172748dd165e328631bf4d7_3751941488114806451.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b84e7b4de66995db78e58ef0cdff4a07_7586749649183181787.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/0a3957f08aeb243093ad68ec31067563_6856811942352366302.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/255cbd8bf1d713144e9cab7ffeb519aa_3093463931187389797.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/bc18511e239f33dc99a7a8ede2fcf6f7_28649543757173053.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/26956f53be88db3361cc90d49ca24fcf_692549954931591459.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/12695e6c4175db08ad78b5f350dbeb18_8902102561885638896.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b753e7342a3917a973955cbbddc81a10_6051768560482094263.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e08f96eb7fb4c800672284e21666679d_2910250819374153953.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1ab5024bfad5cffae3c375e808b14685_8559437828000753362.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a39a640b62b4f9c847c724d698b14d6d_7906246816109175069.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/faf5dd91228f031716eaea2d0f49b6dd_4491756252149822900.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/19d8bc1279c85f68759e10e6a569dc1d_2356692341249374554.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cfc975665aca75a23525790e6b97d1d7_6310360448788764608.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/fcfc3fed2d1f18c8fc6cfc81300daabb_3979752703275654144.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/bf43986aa06f00e14b156fe29a6416e8_8556317221197109748.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e6b8128c274c65f37a6f76dad501b120_7955838119123029804.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9ae81461f4d48c2570a9be7b53a7aec8_160042443352611798.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/446b71d6d529548231ddd996f71b3e39_8529422098314723436.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/fbb7609415ddbb300fa3d604159c17a9_5722754449130766043.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7e333be00d9170e9a3552e3635679ca5_2379556676548757741.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8bf2bc49c4650a726d5e2e3ddd3446b3_4366611915468452784.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1d3b1ace4828d38c6bdabc8730c81862_3508012725900435523.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9bde2d2a1835dc70b98d00ff55f13465_6033197253734364906.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/5bdf8fa3be6b807d37522609452a4e07_3289261393587027226.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/83832044d640f7f5038d9d1fc27ecc35_7358589581799564527.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/754f04fb6804b4db8a38659722344f62_8495326194597949691.mp3",
    "https://act-upload.mihoyo.com/wiki-user-upload/2023/11/17/16576950/73e8dfc659b10d1ad62454297b4bbf23_4227008222739534384.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/48abf0cf8d521025d42cc7d23b77582c_7798263473768881813.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7db7379310a533831daa13488b53f26e_7101089858692314715.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b34236eb7c75c02a012a46f57bac5327_1540930641236554801.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e17b1b340687fa819c3e00f69c8a84d6_7730856045764622661.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/cac4856677691616580be0b5e3e77f1c_4211314302908436967.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/2a45b61f00dbc5f3041e233fa685dfec_782536588715147611.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/58d27d7166d910ed2212117f3b1cd6e1_7285089167605199483.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b786ca5bdb1fd156325e858b5a5ff3e0_6313769510382178712.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a17fe49d93f1544f9ed0b628ce37b49a_6824289757577162245.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/a54c12252d0b5750b057533f4b426f7a_4659443818001566940.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/7b435d79354e67d107b6992aad63ab12_8855377249169909275.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/1d013e4bad5ba805d201509824364911_407770335210358019.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9a631eeeaa9f267339b58ad2f5168869_5240043013157031755.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/8f61f53ca3467096833d1b0e7bce4a09_2456302665635455660.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/e06d08653816661c0a7a0dda6a116512_1080678624940915542.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/3ded76ec8043992cd97f2570cbdc259d_7479823125492334458.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/ae9cf73ac4974494a9b9b67a4ec49f29_3213429599286108709.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/c415daac02984d5a4240ebf08a6214a0_8450800762938231044.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/b179173ecdf4b19aa3a23e68ed8ed004_4790983662436211151.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/28945160cff7624534eb1ecb07349435_4725309128333098185.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/f6fe95a8e1153d2fcd0bb5a5e52b61e6_3230597210100269490.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/fb0c4c5d15c7abb199deb0a6c36294be_2533068749501054813.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/847f15b883fa882079ccb14f7e3e33f7_8948374809700521096.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/1b2476c40076dd309714f4a09f4a1d9c_2407410005150309804.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/1b99d9c7805d6adfd30b1dfdaa5c0d93_7547093467020935910.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/05ccacb8afb89fb2fc359762f3bce7c2_966633742120071859.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/f66aa235e758a86e537da46149569791_163981651221530351.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/40fa8ae75c3bc5b4672c981ce8b4a010_3481445453273660685.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/8f7c0e643aaaac3f97155a6329de2421_4520186195937945464.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/b5935e98eaf7eae9ca6ce9ffb540db4a_1510977936002931873.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/9887c16536f084bb5eea40b808a147dd_1913051754333563104.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/21165429404661fcc1acd6f8803e4e99_8059585252433456046.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/caf729f903e8215fd2eefadaa887e135_4965916881562178528.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/5a7b849391c60cf1ba7c7780020d02a9_7203504904268893558.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/5af799e0da2363090dbe20852154b30d_6897036521752361269.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/f540beb8220663e4176848b05d42babd_713218639536208186.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/f098ae4b0d9cb13675f1341884ce5a71_4202375089865897142.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/590e1ed8c4d0b80a1134f7b25c8a0399_4980805968079204365.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/476a9c6f1a81a929e9a4757a61659e9c_4206194906698891832.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/3c1df4f007d0bbfec7a228f3c6e6cd56_6046117771996382775.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/cfb6aca0df50accc15689367bfd63169_314880694218826096.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/04/16576950/fc316be1ba9822ff179f99125541f92f_6299079458058565802.mp3"
]

/**可莉中文语音 */
let voice_list_klee_cn = [
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/070931802fe095614d6b2478873d79d5_1506586020611038144.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/e874fde7a2df8960996ab49d71a0ff01_8712883441075318980.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/cc7d533e43fc24285402c23539606973_292065080366019152.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3b938c41504c3d1ecb2ce32c71e716a3_1579780281202317552.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/58038f2441dd9970131e5c2e54779a46_2496014067294141831.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/6ce0f70c3fe47c1243fa5ca370abd6f4_4834510319927679904.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ef9492976ad889072913a783ecede57b_686818756687861840.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/fbe0e1835e6bb4ab6b8754b9253ed015_3497300224056531649.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/0a0aeee9a7e59892e934f6c6c61baa63_8382389470834281270.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9917a3f395aac69e822ed3aaefb93aa5_5193386752742783507.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/14630f76d4146bf828907bf1c21b0c4e_303258221954164830.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d99e9f93f400ec9b01a1b3d8f237492d_2272472404523581768.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3657ba55b83c04ad3f41d81134ffa58a_5773232172244060624.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/4a950fb7ff1767c8d30b9fd2c299675a_4374894354098055425.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/34f81dcb5366f590671f421023fe0055_6345744994202226252.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/00cb0fdb7a6b7f8ccf605fc2872c1624_4977767456801309000.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/226a23cab519e712c6fe8be02a826b10_4469796741961005271.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9907ee19c0afd6ef25690d06c24ffd2b_2065329402475484497.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3afb3af0b2d7023c1800c3f690b7d0f6_2605360361373480548.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/6d6ca28b9b46a94de83ad207dcc9ddd2_7867911277447062879.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/663edfd0a9afa8684459bcc6915f1040_3154486409885749302.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/91e4878eb574d6fc8eb0a250d83dd3d3_7757379225244489145.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/6145e54c9c19f507614dec81f82388af_4197264470272520168.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/00fca10d78825019ceeaeb3673b3b2d7_8671887899744547178.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/1e8ea58c50697283a7511ef5c3ff3eaa_4269867990192525922.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/40be283773073969aca539475aba3c4f_631647081684879462.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/fd0da50b353d0857fe24eb2417a45030_4122272252641610309.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3cf5cc228618af079c62f76a2a7f53ed_5175408850788794103.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/7f0ea6120be4cb3483a2cc02c279cfe2_7992586876938122084.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8cc0144981ee834ffd355f584d8e71d9_5693662597550564806.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9fe11e195e8b0ff26ab7709be1897242_3452155766859078848.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/cb6bf3c5070f0c1b39e9fc0f19eea2ab_8769146846159189277.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f9b265f61178b71bef1a2ab5b94a68bf_6742321921477277144.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/56c7d328c49d878fa0357b0aa7129e5c_1969922887105689183.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ddaaaee67b4a8bda02973944ad80f793_7383538945795936718.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/642aeb1bf59636b7bd6e6c2b2ddba454_8836065197350260208.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/eb8ba1c8af42c1f72775a62228c2d838_6637181170559146732.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a5580cb7ed1c4c05ee50dfd97d24bfef_2452886019779637446.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/df7b24cb5030bfe9c0b7666bff14f290_8043192095783828020.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/b2e47f807b6c99c5a6c28eb4eaa5d68a_1806043118803603346.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/70d7112ce41aa8a1f03e6e21a1d61ee2_7471259852136363400.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/4509588f663286472c9d66fde3a4c5a4_6773837471544735863.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f39cf8720b9b25a77a559c1a9b7df03a_9156623411882096033.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/80990d8633d3c74fe02f724bf1120c57_3561279677544930446.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a6d2c075200b466ec74d37408592721a_7453147571209780699.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/70e8fe1f7a09b69d796d76e7cbff120b_4465361512106417376.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/b4420446f1ea54d1a4554634fca92e7b_4376444641605091624.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/e788424e6ad025bf84bbf0ff1e08b8f0_798562413049778558.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/59e77c2857c1d92391fcc282bb86c1a7_5948059131208222178.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d36ac87ecd52fcc62205ec536f57e2c1_6195177294285356144.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8fc9311ada6beeadac999af1ec4fde66_8175450175933977814.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/1208b02599b7c4509d2a09bf2704a0d7_484036794698843811.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d5b42b37ac789191e299e86c21e6ec98_5198322891765781409.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9843c466371ffea246b68a6fcd1590c2_5808403279174752279.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/429281fded26a537aa7c33319fa6e388_172369884487879995.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/53b960415e655c68aee8150ee4dd6f5a_5617744071096283711.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/0fc169759464ba98265d3e892b7a45b2_7186646768586962710.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8909409d06cfcd0d148ee40b8e79f157_8514093078758354658.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a75cfcaff168e2af4b1edaff631b8ed4_2615022269602967702.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/2adde4a2f168531358fa7734eff7a280_3638783189055140729.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8686189a1e06a1335ead7737c101ae6b_1387925286782657736.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/635ca2ee51eb9f40bea9970bbea7be17_3407309569219772336.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/9fe0227957deaa31df14d281fd412859_564931973302765541.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/00f73cbe63fceb10b0e0d2d9f12bbcd8_185512756131729570.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d1d180c355b1668924a7120f6a67d20d_1112762341226112911.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/0accfd77800e1c7786ecd6f3be35f501_6068679987658256926.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5877917847befe542ddfbd17b7fa4229_8228501230944800024.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/82ffcc30338df652b1e27d06fa0388e5_1036088437212315874.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/dbfbb10b4b74498954516608c93b119c_2820970912512892128.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d43c16df225ae0716e301ce12ea4ab5b_1924377028594916575.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f0197602e78ac2024bb77faf40f1253d_2120966796001540679.mp3"
]

/**可莉日语语音 */
let voice_list_klee_jp = [
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/c32d88d51241cd35323ebaea64629d61_8312357008820297292.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5ff8f673dd7bd22c0fdf16aadea82708_7922150725969558599.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5071c574c695056a7bdf054d8bd8364c_3109300904133737560.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/c89b2f38cb80b0c267de98151f6cd19b_8839219126382193926.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/c961b9e46bdfbf1a2aa93d27b5cf955c_770569639467782721.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/342ea500f2c320ba021d8c0c38cbd705_3034306159881972571.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a2ad9dbceb6db26b43fae49d95ad483f_9031743279866482184.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f2af3712b360d403baa0f3e0456e37f1_4842776425191132015.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/e3988a6c9e1158b6600b0cd3b4bd346f_462251623290834381.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/427ee0e130d3b6c76dd705309f613a61_3735406025701634850.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/dc13fe1904b89db5f4cfdf89bccf6b57_4430033957210267849.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/47b50ac34d091ad5bc47dfbfdf539fe9_1271913171098077186.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/42b8d5a22925425686182c221161438f_2060805273477770801.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ab505e87e4c8553e7d3fbd6481f38568_8015530443664961928.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/127ffbc33a0df62874c1493f1d6c4c5f_3293510774300663082.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/6e0d5f2fa350bee79676ea9ccdd472b1_8654003192986976300.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/335f44f3a493541eb13f5343d6907b94_5293223783758492415.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/c180ba58c01493f59524b45d65794764_6921449727677662650.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/69f20b39d10f12ec5f66e11b8976dc28_5445296473338904416.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f620310a2f2d3301a1b0fd82e06ce937_8266290288651757502.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3557870aa4a0135e8f8ae6da18beaa66_7950333882417422396.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/e69d7dbb257e9b24ed0daa1bd0734e19_8498258315570532600.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ce63c13543fc16968a6daad5c212821e_8029301817388326757.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5c5be6aacc518e1b6fee94f101f54b10_2407592394393491733.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/69487aafabc0ed14747ecebb616c8ff8_7154271888927019780.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/90d72620adcb2f5981532b9f06a8387d_8972641644831350539.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/612ef1dd04ee24a0f14ee682f75f4c17_3780374894610595239.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/5f94c5553eb166f93913ef0cb5ba2898_3751389255707608512.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/8ef88018ab219aa842dc66584c5684f0_7915188790916715644.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f16d1ba57ee6f11fe54007588ba61fac_8128982987229420192.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f2899d3663d616b43a1e920f55996904_7175066193898781892.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/2db1dea7ec588bfd3acf58ec080dd335_8225896888881974739.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ddeb60f795da56a460f23d123d176b3e_8158009244000702538.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/66dbb7ce8067f7b61510b67ac8b961df_1154350448939859858.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d8ef2158228161af5f7a43c0ca8f5b7e_1658330905952653719.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/253e875ee45aed386ab6a670615f3e28_7322420122030223165.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/dc0cec10ec1847fa9c4633b0befb7a7f_2308602718748064698.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/fd5134d641972f6655b15b510c0034b0_4867952124917910069.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/1544dfe12dd6e11319af2e43bf8d4717_4572925176157871826.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/90e5f411b628ee54788f579404d8bf3d_1668398800942861705.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/f20d80552431300c237e8100aaddbb44_5777146996041599302.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/2c128f6325d6ba8b143a5abd9c4e6ffe_1222111662389900248.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/3f0983829416b42037b59eb7b8700712_5845034122562304504.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/aba3e92f9abe6c62d28deada729a022f_5451877407085821637.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/70b78afa7b006926b29278ae563ba814_742975168566022601.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/04e41a8023c1f413005b41993f727ab1_1607877740139732452.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ea882e53b682c3ad12dd57943befb191_832309901759984352.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a6849d9204b49b08519bc86735432e29_203795779903913065.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ac5841b312b6797d87580e279fdfef51_1521965175631031811.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/22290e2d8998fe8a7089151b99c1f73c_920389675062354895.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/cef6e66d51885100361cde55fbd7906b_7665932270213526511.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/1fe209f94f50efe7ff39233ebc637246_4002625514940883470.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/48b4293d357c3105a8ed444ecd76b91a_5220187133617685047.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/980d84e28b474b9d45ec9278fe2b191b_2967926078731525835.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/ba0f8b93fac6d0a1d1d9d857af48a77b_7092291632054223415.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/51dd948031a62ae47595215d1dac013e_7259205295736257854.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/d47a57b60f86bd12010bdcfb21986891_721587458383871382.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/7662bb3917530463624375c9906b13aa_4469214081473347052.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/7fa11cee4da33d7d97e120d882ec9c2c_3723031215414350948.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/583b33fb861d384d8aecc880d8b7849d_6473146738418944005.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/779316145661558680c1daf97f2e455c_2285843843955579993.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/0666b15bc1c6c0a8e4d550d000d6a72c_1171327585244014119.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/10/31/16576950/6c4bffcc87acd880e6e897587d5030c0_8343957829611442167.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/f03c3e3757cf0e16c52695900721aed7_8662982263319420642.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/416d6a69117b3a469859a334062f84a4_4240507542425223945.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/9eb9aa8dcd030e4f040af17d80a14c9c_4198687886838945530.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a2f9f59c1c3b7a3cb00aca84ac2c2627_8893585962004993445.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/7556dc2ee85bbe7d0c465db078128f47_8313735442353061567.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/320745dec4481a140c2310b4f5e40f74_2985518240647495728.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/a33492359439a3e22770070d87fa70e0_6191596892365099587.mp3",
    "https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/50c84043968698d2eff3c157d252e8b8_8533309043989857030.mp3"
]

/**白露中文语音 */
let voice_list_bailu_cn = [
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/e10b3c41cf038bc38f88c549ae163fb4_5484811507673522862.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/05a701855f53025f19d601dc7ce962b0_3648955366383430810.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/83e777763c5946217c12672eeb840a39_2425656402104018854.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/85001dd1857c1d584a6c77bc40cf71b9_8138502831187870405.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/05ed1b8a5beebcc3df0e2149e0e7879d_6203754370481205870.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/7667a1ba8f8833e31bcf798f82206c6c_2169025848709261579.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/57b2c8289832400f4a8124b2a599b4d1_448902642801007126.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/a6ed10f6032a75a1ed5a9047aeaf5234_5424458413242930741.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/2981131a23822a569a3611998899d514_8358502188106373234.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/078bcadf5b93e5726007c7786b75b40e_3509137312096729281.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/09ad6641e40d724cf549346c92572f27_3657833950407003635.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/685da5251a5b1d94857eeec8e6374579_3745118544901249681.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/deb83e1f0e638d4d4326a07c36a6bd90_6744413265484291949.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/c1aceee2ec46180bc7c27c43a0368260_4236133232222874118.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/09/12/91130434/4364fd4a06537c6d3a5dfc4013c0592a_2602233026851325169.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/003ceff510f0eff1b1e327eefddb773d_8120732812763932917.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/45ee9bba18c4b1e9a52ffdebdb93bc64_5411801909812051873.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/d2773db9e2e806c8cd18c1322df1f2e0_2057011924910173150.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/7cc31d3f3fa7668c5bb462ff7a048bb6_1695134834803670466.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/0cec2afe5d526e7c5066c9796b260281_7571421041392520150.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/68e664692e7c0ded9afb40b1926e39d1_87960581468534731.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/7fe66540f8787d15d5bc90980d0cd75e_3890730365876232107.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/281b5b5843adae20fe05a0b90a8ca174_5321523595562990015.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/d8702ab4cb8e4eb01716a18d3ab4af3e_1310618342737479899.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/f18b9f262b2d56c69daf82c2bfd96157_1206644056379118989.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/8ce73bb77c8edbe989b60bb1f23e92f2_7175578195957379627.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/73e76f8bd558d51939b8505a6f8f46c8_3776814028163671167.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/837207584f661f78ce6e7f5140637301_7760095864609707552.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/03d5cffb6cca391b373dbe47fde11287_1857629774179517826.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/1a6a963107e61b83d95bb3211ed1a473_8202683174616222637.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/5f618d8647393f7fcf44e538132faada_8095480391610268126.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/df87379d38c2e3ce3ade94727e6e1426_7485763377972896441.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/2c2c95f79afb74b6c721e133345d96d4_5597451206369949943.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/06a8a18de8f8ef7585f9b17a37a234d8_8404510610031078399.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/ac08bae0cf7055a6c76ea4f08e92b7cf_5421791002661457153.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/2df1ac60bcebcbe5612418a875abb184_6124695680650475449.wav",
    "https://act-upload.mihoyo.com/sr-wiki/2023/10/27/91130434/2be8130cb759f846b4d03e7b8ce6591e_8305224628666172284.wav"
]

/**派蒙和荧中文语音  来自：https://wiki.biligame.com/ys/%E6%97%85%E8%A1%8C%E8%80%85%E8%AF%AD%E9%9F%B3/%E8%8D%A7 注意这个网站会导出很多重复项，自行删除；中文缺少：关于求签…  （2024年1月8日）*/
let voice_list_paimon_cn = [
    "https://patchwiki.biligame.com/images/ys/1/17/qipbw117ggwug6jvu6q1yrun57ucups.mp3",
    "https://patchwiki.biligame.com/images/ys/9/93/bgqqljuhu8f9v6wdlvg7m6uzxq8ox8h.mp3",
    "https://patchwiki.biligame.com/images/ys/6/69/1s3677di0nh5p5nwmlamxttfjhmuioy.mp3",
    "https://patchwiki.biligame.com/images/ys/3/31/7s0izyylkdjceon1p84q5uwv3avi3ky.mp3",
    "https://patchwiki.biligame.com/images/ys/3/32/fmnzpd5i4qkz7wzvyp57hwnx4aamoj3.mp3",
    "https://patchwiki.biligame.com/images/ys/b/bf/3v8d7nlvoghq81c0mzryd4dgo677w8e.mp3",
    "https://patchwiki.biligame.com/images/ys/0/08/e86t3m1oz65kx2bl19hybi6vee8wosm.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f7/60xax8u7ivep7av4hxyvu5m5gf4k6ek.mp3",
    "https://patchwiki.biligame.com/images/ys/7/79/9plpejjo4ycczdvfoaszw181kiozurp.mp3",
    "https://patchwiki.biligame.com/images/ys/9/97/0b6lwdtf91fbuhbbfji4isju2r1nzzv.mp3",
    "https://patchwiki.biligame.com/images/ys/d/df/jzgmvuksv2gid75u3wgm2dj0p2tuo3t.mp3",
    "https://patchwiki.biligame.com/images/ys/3/31/fr7qzu801w0hqutr30fb2cil1unjy4v.mp3",
    "https://patchwiki.biligame.com/images/ys/d/de/q24zx5c8ze1dcduvw5p02zc5imw780l.mp3",
    "https://patchwiki.biligame.com/images/ys/2/2b/hkbopbook2ieh35n1h6hjqmqfqi0n75.mp3",
    "https://patchwiki.biligame.com/images/ys/2/24/2p1poxoes4806tp0py6szf17y49yk9n.mp3",
    "https://patchwiki.biligame.com/images/ys/6/60/5joc7ygf5g0q83btsxa6ffv5dh1r7id.mp3",
    "https://patchwiki.biligame.com/images/ys/9/92/n3lmn74x6x0uir0qoia9vpx2ivb6wwy.mp3",
    "https://patchwiki.biligame.com/images/ys/1/1d/7z2zbm86jol3k9j8ykiwsx4qmr0rtsp.mp3",
    "https://patchwiki.biligame.com/images/ys/4/44/cx4ezyy7rt2oa8ur3f7cvmd6ol0bl0p.mp3",
    "https://patchwiki.biligame.com/images/ys/a/ad/eoulv29p6z2b6rvfof9i8dqb4ffybky.mp3",
    "https://patchwiki.biligame.com/images/ys/5/58/iz8bnzlspagg16167pph0o5lrdslzsa.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b0/0jh7u14yvjnxm0el0ipl1ro87ljbunp.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e5/lpzq8ra1t4lc7v51b8sywa7d4lmsrcf.mp3",
    "https://patchwiki.biligame.com/images/ys/3/37/j67dtc2mi8jqa6zli3e90y3t897qmi0.mp3",
    "https://patchwiki.biligame.com/images/ys/6/6e/ht90g16gn8y9uv0fua067bil0ximd41.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a6/91jhsoed72vyg3swd90ygazcnqwpsgh.mp3",
    "https://patchwiki.biligame.com/images/ys/1/12/kgfuvdntuakdsnrzt3ckpk0r1rsutdy.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e7/kilfr4wo6bcpngsq4nr0b1507lq4b8c.mp3",
    "https://patchwiki.biligame.com/images/ys/8/80/htzn67up92gmr0evael9u5mln1o1y5v.mp3",
    "https://patchwiki.biligame.com/images/ys/8/84/7hpl6rcohb9h9ii5boxjs7aglbamku2.mp3",
    "https://patchwiki.biligame.com/images/ys/1/11/jj6vcondx1q24sgltz8nzt6d2i9a3i9.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c2/k64y5esl0vu5gaodes1l00wgix8bcwm.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a2/iapwb7m396htvcqsn1mdvf00o9aeaht.mp3",
    "https://patchwiki.biligame.com/images/ys/e/ed/cnard4tvbqjdr2m1rles4vkz7d7fl8c.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d0/99zpnndgpbdm9qo46kg3q02e5w1uztu.mp3",
    "https://patchwiki.biligame.com/images/ys/b/bb/nl2prmpf70bzv2lht7ryq35hcqeayuh.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7e/tqxtgflvpzpbyxn1llv9zyktww1j33y.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7b/07nrec1auescdhb44g76rlt9uuwoasm.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d8/9h96nhwmq6z2l8ecp5ch3qa0k6cy18b.mp3",
    "https://patchwiki.biligame.com/images/ys/b/ba/b9tf0cuiw1c6euio9n8tqasjkhy6of8.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a1/1h2biy904l7wni5of2dg3ddhekkbp6e.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a3/9kxhuve08am4m8ruwzlpi38590keop3.mp3",
    "https://patchwiki.biligame.com/images/ys/c/cd/jkumb5x1a950iwdbfosanya7hgmya7h.mp3",
    "https://patchwiki.biligame.com/images/ys/1/1e/pvdgcnrl46mn70mq8wuwmttwo9w7c7d.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c8/g50vyvrisrdp0ldakwfigwjgmcpa47y.mp3",
    "https://patchwiki.biligame.com/images/ys/1/11/r66v44i9daw0noedc5d249i4k7xmodh.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b2/s0wgp53why6uds8pnsp5v03c8yh0s1t.mp3",
    "https://patchwiki.biligame.com/images/ys/1/13/lo1x8aqpgup8hqkd7rme06lt5cjkeke.mp3",
    "https://patchwiki.biligame.com/images/ys/7/74/ib1g7ren91kxob6exzdeimzkqzhiwqn.mp3",
    "https://patchwiki.biligame.com/images/ys/3/32/tmfjodif9irvr0uxpw1onbqfpjvjeuf.mp3",
    "https://patchwiki.biligame.com/images/ys/8/82/mt6r8vwa1i03j7mdtmp8rqjygjy93qg.mp3",
    "https://patchwiki.biligame.com/images/ys/e/eb/rku1mcuueqg72iiap0gz2ufbsdc7ssa.mp3",
    "https://patchwiki.biligame.com/images/ys/8/82/faov85ra10tpkhgpnega8rkg483msuj.mp3",
    "https://patchwiki.biligame.com/images/ys/7/73/cafdirvv8710dpe3l3xu9hkwnfaqnol.mp3",
    "https://patchwiki.biligame.com/images/ys/8/8f/kzv1l8wns25vcdy1r5if7g4ex4sjtwd.mp3",
    "https://patchwiki.biligame.com/images/ys/b/bb/7d94adf5ynjghsyqsdb58k4809y3dsk.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4d/jp63tuy7burap78wlh5d53b6zoib9am.mp3",
    "https://patchwiki.biligame.com/images/ys/0/0a/eida28q5rf8ak6h274m6yjs0pbqrjg5.mp3",
    "https://patchwiki.biligame.com/images/ys/3/3a/7wlcw31r3ksd3ppzwsoqhwlnb7qo708.mp3",
    "https://patchwiki.biligame.com/images/ys/2/27/3hd6w9z9fmnncijuakqxuhmhqp2rckb.mp3",
    "https://patchwiki.biligame.com/images/ys/8/8a/kw3se47vkfxlsp43l8h6ofxxrqj7xl1.ogg",
    "https://patchwiki.biligame.com/images/ys/a/a1/faq7arjr9r4iqblspq0j1ih2489ww82.ogg",
    "https://patchwiki.biligame.com/images/ys/a/a5/l20btx5pgb7q58ektkom7e7bccdr3fo.ogg",
    "https://patchwiki.biligame.com/images/ys/4/4b/ogki9npxfsl1i57ru23z26r2d8qvpwm.ogg",
    "https://patchwiki.biligame.com/images/ys/7/7c/n6n4jnyk86d5dknkcrs4r82qcqremoy.ogg",
    "https://patchwiki.biligame.com/images/ys/2/2e/dbra7rabbk29avggk3ya7jtkj9yfvwf.ogg",
    "https://patchwiki.biligame.com/images/ys/c/c1/bfusbtmpug8pqmx1cj5mt5h14apr8qq.ogg",
    "https://patchwiki.biligame.com/images/ys/5/54/2ajy4y7m9q3gi21m06mptckr42tjqg9.ogg",
    "https://patchwiki.biligame.com/images/ys/9/9b/m7npcnwixb4l4hgcwbnj4cbfur3464q.ogg",
    "https://patchwiki.biligame.com/images/ys/d/d8/g61pldvpidpv8lgqfffatsvyfwlawh4.ogg",
    "https://patchwiki.biligame.com/images/ys/e/e2/hcshb8teu7co3ysba68xdg7xnhq4ukf.ogg",
    "https://patchwiki.biligame.com/images/ys/a/a9/dt2y7b13n1pf36qut5n9gugk4s7u6g5.ogg",
    "https://patchwiki.biligame.com/images/ys/0/0f/h1vkckhfjo8iysr8nj7j1bicpudv4s0.ogg",
    "https://patchwiki.biligame.com/images/ys/7/7c/mi1yqwzayud8ju0klwoet1igxwvbhab.ogg",
    "https://patchwiki.biligame.com/images/ys/8/8f/ogi7e7guglpswk06k73q4f1zo3htbnk.ogg",
    "https://patchwiki.biligame.com/images/ys/7/79/rn7rup6w36jtdg1i2r9hkbflr8e3zkz.ogg",
    "https://patchwiki.biligame.com/images/ys/3/3c/t9oqwo4t1phlpd5bfqche7ks2ouglx4.ogg",
    "https://patchwiki.biligame.com/images/ys/4/42/r5vde5m7v7yvhjfsms5lmscjkirffej.ogg",
    "https://patchwiki.biligame.com/images/ys/d/d4/mxvu8e03xoxfw2ul24f1x1qmw4svf7c.ogg",
    "https://patchwiki.biligame.com/images/ys/6/6a/ie7ojkn4nfk3b7f0k7s8arybuorxqrx.ogg",
    "https://patchwiki.biligame.com/images/ys/4/44/tvtizcpcuqc9a5fd65bpubhprl74ny2.ogg",
    "https://patchwiki.biligame.com/images/ys/4/4e/9avds504p4j771477mqg8675df80ib5.ogg",
    "https://patchwiki.biligame.com/images/ys/b/b7/l1n9got27abb9f7478zutxbbvfachn2.ogg",
    "https://patchwiki.biligame.com/images/ys/8/8c/aptipo5a0omfjthu2eraxvsblf6x5v6.ogg",
    "https://patchwiki.biligame.com/images/ys/2/29/3vor2xmpv272z04i9x0patiwr4qzep6.ogg",
    "https://patchwiki.biligame.com/images/ys/e/e3/iuv8nrqwaaa1kd2y2gwx5mogymwu3vh.ogg",
    "https://patchwiki.biligame.com/images/ys/7/7b/e49574a6dtm6d21i0encjtpmartswm9.ogg",
    "https://patchwiki.biligame.com/images/ys/5/51/0ycea9rmml255td6ys84rw0vxqt0t8u.ogg",
    "https://patchwiki.biligame.com/images/ys/2/23/qp6620azh7tgu2bubs53gvy9342lzg8.ogg",
    "https://patchwiki.biligame.com/images/ys/1/11/i9a6tpj51iusr0z87vzmz5vob96tm2q.ogg",
    "https://patchwiki.biligame.com/images/ys/3/3b/9uh4378vkzgxvci48d7i5x90rb5bnpl.ogg",
    "https://patchwiki.biligame.com/images/ys/6/64/7clglitmz3y8d1fodjjcdyftkzp1gbf.ogg",
    "https://patchwiki.biligame.com/images/ys/4/4d/80bpat6s9u6neb2pisgpaj3mwxt5u13.ogg",
    "https://patchwiki.biligame.com/images/ys/1/1a/jbjkcfv2vr5yg6cxktbkhblfjf6t0ub.ogg",
    "https://patchwiki.biligame.com/images/ys/0/04/d2pqcg2bczvdciu681y3k3bfeglj357.mp3",
    "https://patchwiki.biligame.com/images/ys/3/32/e4ea8vx1jmw6mut9xc4ue9vyvygpul6.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f0/qntqnwj0rgt8izyu30jxcduxizuea0w.mp3",
    "https://patchwiki.biligame.com/images/ys/7/79/8rlen9ai4o1nhenhzny04peanu6z33m.mp3",
    "https://patchwiki.biligame.com/images/ys/e/ed/ijflkn2qe2npfwk93lta98lffw0b3j1.mp3",
    "https://patchwiki.biligame.com/images/ys/3/3a/n9t4olu0i3qc8r0b9of2i614j1ge3p2.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7a/jiuyt0o1dan7jjadwb14icpkxpbzijk.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d9/cqqfl5x6njmdc11yqromc1vy46is35j.mp3",
    "https://patchwiki.biligame.com/images/ys/6/62/nutma6okxydr6k4cpa136w3mxwvt1tn.mp3",
    "https://patchwiki.biligame.com/images/ys/6/6c/ilh3dbb3iz2wa4083qf3g1r6nndjfyl.mp3",
    "https://patchwiki.biligame.com/images/ys/5/5b/r7eq8u4q4m9as22hvqgsket5tu0y57t.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b3/on4hlt1nvpm0286qylv9awismkotcux.mp3",
    "https://patchwiki.biligame.com/images/ys/0/03/iyjlvxpkq6e6871adly24zdcot5178r.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7b/awiy1cdqgco95buy4q65wt65egw81tl.mp3",
    "https://patchwiki.biligame.com/images/ys/6/6d/8r493vbscou6vewrsjw8ef1wb1h3lev.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e6/n0biquo7l053zsozawo6jayhegplmb7.mp3",
    "https://patchwiki.biligame.com/images/ys/d/d6/s2wyzzx5xwp39nu2tako9e84x9y56k5.mp3",
    "https://patchwiki.biligame.com/images/ys/9/94/a8la7bd9odn078ty50dpdhw398qzacm.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c5/k9s25ja209qpx0z6wf8dlh78wrdgsvp.mp3",
    "https://patchwiki.biligame.com/images/ys/0/06/tw2d1h2leunx8wstfs3qd8ekuw5whfk.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e8/bhfpxxl4oo7qnqg68ama1eek5ozgd5r.mp3",
    "https://patchwiki.biligame.com/images/ys/5/5b/e69s2kwj24xq4bektjbh7huxsq1tm08.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4e/1wlegxmua1i71s3xqyps647b35z8icb.mp3",
    "https://patchwiki.biligame.com/images/ys/0/00/nm9pciqfzpciw547xe9tjmqb3g2hsjs.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a4/9mzdbwal5ieo5zg503rhlmkgnmp90gj.mp3"
]

/**派蒙和荧日语语音  来自：https://wiki.biligame.com/ys/%E6%97%85%E8%A1%8C%E8%80%85%E8%AF%AD%E9%9F%B3/%E8%8D%A7 缺少：关于神居岛崩炮…  （2024年1月10日）*/
let voice_list_paimon_jp = [
    "https://patchwiki.biligame.com/images/ys/4/46/e4z1kd302clek2nkdn9uvmr48ibeu8k.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7a/pxxfxrz8w0moojyzrnvgdr22k223lo3.mp3",
    "https://patchwiki.biligame.com/images/ys/b/be/dn5mb7l43yorqzcpu6egj15knric1ey.mp3",
    "https://patchwiki.biligame.com/images/ys/b/bb/4xjp8e40l2xsvrrjdg35occcdais2br.mp3",
    "https://patchwiki.biligame.com/images/ys/2/27/69h9pkjdwhd14bi7oalq44ab3zmd5l0.mp3",
    "https://patchwiki.biligame.com/images/ys/0/0e/lzcv6jd11ycyi1bfz8povzy0tkfp2uo.mp3",
    "https://patchwiki.biligame.com/images/ys/c/cf/cf0tbcd28hsyqwdyu9amr356gb28ion.mp3",
    "https://patchwiki.biligame.com/images/ys/0/0f/r6ahqnzst3l0keo0r37pe70n73x2o4i.mp3",
    "https://patchwiki.biligame.com/images/ys/1/19/7a5d0w963du6l2oulc4mmnkg17h91u9.mp3",
    "https://patchwiki.biligame.com/images/ys/5/59/1x9tpts5lwgdgzv83i7wy55xeo1iztn.mp3",
    "https://patchwiki.biligame.com/images/ys/0/00/1hl7nlhheyqiyinvtnddmn79vic92gf.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b3/lebl3e82d7929b7ujvvyg6usg5yu9gy.mp3",
    "https://patchwiki.biligame.com/images/ys/2/2f/8zgbk4ld4vsm3cdjeecqhd4wa506we4.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c8/06q0kktxdezu6qnuyc8b6060nffe6ie.mp3",
    "https://patchwiki.biligame.com/images/ys/0/0c/ib2a7az5k3y889b0a1xh8fjpfsw5put.mp3",
    "https://patchwiki.biligame.com/images/ys/4/41/lco5bofxtbjjwo443vhzf9g3k4xki4h.mp3",
    "https://patchwiki.biligame.com/images/ys/6/62/n37qyzbhtipaekr3f0518dtm2zads5w.mp3",
    "https://patchwiki.biligame.com/images/ys/3/39/kgzwi2hnezwm50w92t7ia3azhu1r55q.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f3/jrb790yoigj33kxa3mcnrqfi8bzn7fu.mp3",
    "https://patchwiki.biligame.com/images/ys/5/57/mbgfhfhoka9ou3njtsspmduwf317ztu.mp3",
    "https://patchwiki.biligame.com/images/ys/3/3d/mgapxydptuvu1ko7a4px9vqzxtuwy30.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4f/l3suhnuml74mdxcnjfqia4mz9dplx3q.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9a/82w6x6q6hbk606hx7d6hs83q9uyx4xd.mp3",
    "https://patchwiki.biligame.com/images/ys/7/79/92zuaovgdxcz3oj4vj4wuiw1r8snv2d.mp3",
    "https://patchwiki.biligame.com/images/ys/4/46/cq9txmodaz3ufjz51g6y7yg855ehm8u.mp3",
    "https://patchwiki.biligame.com/images/ys/2/2d/2danaypd69waju7to8paxlwxmw3cdau.mp3",
    "https://patchwiki.biligame.com/images/ys/f/fc/hsw58m06olsewh7c2ik0khvclsfgi49.mp3",
    "https://patchwiki.biligame.com/images/ys/7/79/2mdbriwrprklc6l4njte6tcalsaiu3y.mp3",
    "https://patchwiki.biligame.com/images/ys/3/33/lqn9gwom4xhel8cno091on36nitjtao.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e9/tho2pami0hujrnbyz67hyacll1r5iku.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f6/ig71j3nqgkyk5v11x5fg4alljuf6lyl.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b7/9e9kv31jyx8d2viywz2889wk1snru5m.mp3",
    "https://patchwiki.biligame.com/images/ys/0/06/6cvmt9anqp6r0b5fsw80jjgbx6mdyjx.mp3",
    "https://patchwiki.biligame.com/images/ys/2/2a/tvl12c1ug24kwi4wtttbv49y6al14n3.mp3",
    "https://patchwiki.biligame.com/images/ys/c/ca/gu4hwa18m9jy7g71oomi55z5drb42vm.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a8/4udll5k0zdejr2la6tdm2kwf20ish4d.mp3",
    "https://patchwiki.biligame.com/images/ys/1/10/nl8zi82g8vx60zxt82nq6gm6fs780bx.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b5/4vggjpqmbr9kk284bheriw9976mz9c8.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b5/2na4kccyfc500i0ijqi5pvbh19wkjxj.mp3",
    "https://patchwiki.biligame.com/images/ys/5/58/dbnjizcc6ifpn7dug7glt3bpm680l5o.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a1/ryp4405bjeyw5nncnrobc1jyyzlh38d.mp3",
    "https://patchwiki.biligame.com/images/ys/9/94/afoove7d1d04l8hli3w6ffep6vjzp11.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9b/b54dtjxph6xt2okpedajbc3xcmulpv4.mp3",
    "https://patchwiki.biligame.com/images/ys/2/29/95mhhz8c1irwqrpgipbzdy3lv6w59ia.mp3",
    "https://patchwiki.biligame.com/images/ys/1/1e/jbig3hw4wsmgyec9hicoag58xfpdied.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4d/i5kx9ou8mw5jcyuohejo7d1teeb2ol5.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f5/rev8wf98zs70x7psszdif0ytu1neuy9.mp3",
    "https://patchwiki.biligame.com/images/ys/3/3c/k5f7vlxkqvyxf6d8k8dx7a5v1e1y1hh.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c3/pap3n0apj7uue8yh7j2z4ssjlu65065.mp3",
    "https://patchwiki.biligame.com/images/ys/1/18/nqrc4ljtdibe4royua2wkj0pmcys7zs.mp3",
    "https://patchwiki.biligame.com/images/ys/1/14/dafmldktmc7ylnj4fdksxm03uchnaoo.mp3",
    "https://patchwiki.biligame.com/images/ys/1/12/jwy6zhmkhuhewzcnwlscxyo0gnm0zhp.mp3",
    "https://patchwiki.biligame.com/images/ys/3/39/cfn6wlcsc092yzbi4qssb7nazh981sp.mp3",
    "https://patchwiki.biligame.com/images/ys/5/50/cprjj3z4vvwr1msr1xo86z161st5td3.mp3",
    "https://patchwiki.biligame.com/images/ys/8/88/92q566ngn9rwzb9vtmyefcuct1rt34d.mp3",
    "https://patchwiki.biligame.com/images/ys/3/30/2zbn9qs9sqsmshqogqk0nw6hblmdu7d.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4e/816hd22xmqyrngpi9pd65zuijca8hvd.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b5/eo83ud832skbmcfqy9jqp9daep4mhlo.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9c/27oy4uk0zzkqtf1mmmdhqkf5x6tzbn2.mp3",
    "https://patchwiki.biligame.com/images/ys/c/cb/oxbb26g8ku3h6c7rqn7xxbaz8ldubqr.mp3",
    "https://patchwiki.biligame.com/images/ys/4/47/hd0jpxvdehi6o8tl3z48rvnah05q6pa.mp3",
    "https://patchwiki.biligame.com/images/ys/6/6b/93odzdj7vim7oqh67shh9tkkfqhz4un.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e1/t55820ano2cfxn4h1ny2djmlt6xbe1l.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7b/0j1wc1bmaojw4u5ro1srwresc2xwvx0.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e1/gqecuipph1ju98avk9by99vbzw5jm7u.mp3",
    "https://patchwiki.biligame.com/images/ys/3/32/3fz68g3202i1jio1npxaz3hj6kut6ba.mp3",
    "https://patchwiki.biligame.com/images/ys/b/bc/p5kmxg4qv1sa7ulrjq64dio0gm2hzqy.mp3",
    "https://patchwiki.biligame.com/images/ys/2/2e/qssqmpjow1b4nvljxc33jvhppu3v5b0.mp3",
    "https://patchwiki.biligame.com/images/ys/8/87/6ngenkuysl45mclljjula0e7th65ola.mp3",
    "https://patchwiki.biligame.com/images/ys/3/31/3n7zfwc7a6ckko0iq63oolzct4pwamm.mp3",
    "https://patchwiki.biligame.com/images/ys/3/3a/owo52w8l46ljge6jvf6teatm19dmon4.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4a/dot3av5d6ogl2ob5evffmqwe8byx8be.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e3/j2g5a3sp3oq2oj9wxdowxp58oih0njf.mp3",
    "https://patchwiki.biligame.com/images/ys/a/ad/smz9xtedt40o9lrqnwohlcmeuekk2bh.mp3",
    "https://patchwiki.biligame.com/images/ys/8/8c/nlhqp4pzafm5q3z7bp1d05kyf76e5j8.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a2/nouxse1b5grv33kfc4k8hg3pumb28u0.mp3",
    "https://patchwiki.biligame.com/images/ys/1/10/81ad2cqmjyumhzcv53cajsbht8lizhx.mp3",
    "https://patchwiki.biligame.com/images/ys/4/47/jeu99unboefo60uewbksk0uru419mdk.mp3",
    "https://patchwiki.biligame.com/images/ys/5/59/ri7smmimo46i7rjq5hn278a1t9a783j.mp3",
    "https://patchwiki.biligame.com/images/ys/e/e4/hduypxbowxw8ydjmbzj87a7xfzt3l6v.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9d/s375o33evoc70a4owhygh5m777ayhy9.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c9/3zem7ggnceya5gugo60rrd85r5016k9.mp3",
    "https://patchwiki.biligame.com/images/ys/1/1d/8v3pebnukpvyst0bj745oruj13qtm4d.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a8/ecci0exskeyyyesdy7nvdk8tk7ho09i.mp3",
    "https://patchwiki.biligame.com/images/ys/f/fd/59xgxg1c804ocbp2pcbv1w9ik2yt7sg.mp3",
    "https://patchwiki.biligame.com/images/ys/4/46/1rupghenaaw8wj29e5vgzk29exl8ayb.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f4/i1lt9w4yc8zqzmx3zp2cg06rsapnro7.mp3",
    "https://patchwiki.biligame.com/images/ys/2/24/1zlml4h84dd7to2embfyv1qvmuulsns.mp3",
    "https://patchwiki.biligame.com/images/ys/6/62/o62uoi5jrnq1rf63rg5hcvhvnfydlcz.mp3",
    "https://patchwiki.biligame.com/images/ys/2/23/017it3bj7atsgxe2pdqknazwhzh1qf3.mp3",
    "https://patchwiki.biligame.com/images/ys/e/ef/rbdrtoghy8fi40hq5ss940nxy3kws0p.mp3",
    "https://patchwiki.biligame.com/images/ys/d/dc/29pwwo3nmtydhyvb35gukqlb8hilewh.mp3",
    "https://patchwiki.biligame.com/images/ys/b/b3/20lvazs08n32nwe0b09lturuj2t12yb.mp3",
    "https://patchwiki.biligame.com/images/ys/f/fd/89y28ayz2zo1qgitxhea7oqxuphkds4.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9a/85cjak3fyvzoxtgb1cj26ylhqqanxau.mp3",
    "https://patchwiki.biligame.com/images/ys/8/8e/2r4quyr7f1k7odan3u5gf1k4q1l97zq.mp3",
    "https://patchwiki.biligame.com/images/ys/2/23/ma493nf9q95w8padvc4osurl7nn9iav.mp3",
    "https://patchwiki.biligame.com/images/ys/5/50/j7sgvro7yz4mmkrjokhhwu7uabeez02.mp3",
    "https://patchwiki.biligame.com/images/ys/9/96/aen6my98iv81focq9445gjpqromib2b.mp3",
    "https://patchwiki.biligame.com/images/ys/4/4b/4tpzyfnguleeuu58a3teu77mxk99ar0.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f6/mr7qs22ui7gv3af6hzytiek99y18kxg.mp3",
    "https://patchwiki.biligame.com/images/ys/8/8c/gbve6zf3zjic8bzjc5f78lhxk5tluro.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9c/bgk7zv6vstyk0mz41541fzsnfgzkwy2.mp3",
    "https://patchwiki.biligame.com/images/ys/f/fc/7gofiwyi11tk69oeomzuwnlmne863b0.mp3",
    "https://patchwiki.biligame.com/images/ys/6/66/pwd74j9a3t7oe41v2twfy4ksog7lgay.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7a/arwg0kdzotr8k4lpzvd2erzor5cckg0.mp3",
    "https://patchwiki.biligame.com/images/ys/a/a2/rezkkmmxaj572lgezcnxm7tzfisk5ew.mp3",
    "https://patchwiki.biligame.com/images/ys/4/45/5q7vljkzcn0rll1cmbc2n76yhus69bz.mp3",
    "https://patchwiki.biligame.com/images/ys/9/9e/1h24pjuxy8eqa9swi9kq8j8hpwjf793.mp3",
    "https://patchwiki.biligame.com/images/ys/1/1c/hh98rgpisnqvt3mj472ht34m61um9oo.mp3",
    "https://patchwiki.biligame.com/images/ys/a/af/js6n8tw05qe5zwyrnqf4cbuzzntiltl.mp3",
    "https://patchwiki.biligame.com/images/ys/7/7c/8mvo95a5pnvav1wd43832mrx43v8giu.mp3",
    "https://patchwiki.biligame.com/images/ys/b/bc/87902hrlf6fwynmpz7tt2btb1iwvkz1.mp3",
    "https://patchwiki.biligame.com/images/ys/1/1c/39faeb168txwn1ctkf7fsidv9z8t3d5.mp3",
    "https://patchwiki.biligame.com/images/ys/1/15/o1ho02i5ffim9rgq79wbshpk9do5kll.mp3",
    "https://patchwiki.biligame.com/images/ys/f/f9/0j50y25z9g68rixk0x1qpwopg8torwr.mp3",
    "https://patchwiki.biligame.com/images/ys/0/02/kg8h2rseztgir3cl1644cmt8jp8t8ej.mp3",
    "https://patchwiki.biligame.com/images/ys/c/c2/qdho5pexb4djh6icpgmthlq9xt3kaja.mp3",
    "https://patchwiki.biligame.com/images/ys/0/0e/swtyr19xnnenr6euuejfjm0pxw1ydgb.mp3"
]

/**冰川镜华  来自：https://wiki.biligame.com/pcr/%E9%95%9C%E5%8D%8E 正则表达式匹配：   "https:\S*(ogg|mp3|wav)"         */
let voice_list_kyoka_jp = [
    "https://patchwiki.biligame.com/images/pcr/a/a5/1d3owxfxhuq7svo596rhdq4g69uqgo3.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/0e/fsh3rub78e4yqx8yz64phgg59p01g76.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/41/ne3nf1e1bk675iveyofd4hju4t89hh7.mp3",
    "https://patchwiki.biligame.com/images/pcr/c/cd/6e01873nl6rgtnsb8hzwhdw76kimpgr.mp3",
    "https://patchwiki.biligame.com/images/pcr/3/37/mefu14jda2c2gkifexyrlnrqwqmxryl.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/41/02c6zznozrx1kqj5mwfkw79ttbdbgn9.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/9d/b7ga92tqkibfispwagh2zk40mngmvwq.mp3",
    "https://patchwiki.biligame.com/images/pcr/7/73/i98ad9vfi1hdtsx8tw5zu77ml38lyzc.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/95/jzgbiwissojybwmjdkn156f5nsko9en.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/9a/cfnm1y73f4x5me1cojdusc5mwewlvk7.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ea/2xchuf4ji861rpl9x0ovqw6eciwjb4x.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/82/eby2sd1mtm9geixdvjr38w0f2kd0tlo.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/nj7i8b28lpji9oheffr241cncnopnh2.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/82/scqirq53fu5druhr9ddzjrdsyawjd9k.mp3",
    "https://patchwiki.biligame.com/images/pcr/b/b2/9dh762jufylclehivg557rj0opqooit.mp3",
    "https://patchwiki.biligame.com/images/pcr/d/d2/eb4frsd29ebysh28i50es6sp0f7t0di.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/46/gcrzdsxaue0nd7f08sbabbqz02uq3do.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/82/l8rk6o5ute4vpygnv0g8vk4wcamqur3.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ef/q3zih5za72qkl1mhk3wt0zwe8005jqp.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/94/fh49d31o7w4z1xzejrp2wamq5r5iohm.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ef/0yr19cf0f0jcr7fm89vx71bpdvbfaoz.mp3",
    "https://patchwiki.biligame.com/images/pcr/b/b4/iru2ux0h99nzscarf4u0vabr5mdm702.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/87/3azfeialne63dla3bbl3lcd1k3ok92q.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/e2/ekx1gt2pq7l9qv4rgb6tkz4oqd2yl6f.mp3",
    "https://patchwiki.biligame.com/images/pcr/b/b5/hmcqwtz22681fn0dpo7f3x6y4f1shb6.mp3",
    "https://patchwiki.biligame.com/images/pcr/7/70/pfeoer09okwejmaan3bn9q7lmu4bu5a.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/60/irssurz0nsg8hrb8i6sxpdxs3r2iwm2.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/89/gs9uoaqe3mbahclhzaixu6daekdgbiy.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/e61lumgswa059nc3afbjc8g0g7zwboj.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f1/85ryushk9hbtonsjbf2mbetzqj70u8e.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ea/85ryushk9hbtonsjbf2mbetzqj70u8e.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/fe/rl5cnmj09cq5llhpao543bhnc538c4i.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f5/rzsnv6rk2qg50klpfwmp94o69rsamhn.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/lm32wazfjaefk90vsuece1ob9ecltui.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/09/ov3xdvie8byzp0mg11doyq9zb3zqz62.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/94/a1ram2fciwu8t5wx5cbgmrxwgq2gbpk.mp3",
    "https://patchwiki.biligame.com/images/pcr/a/ac/cals9wdt5lmizyt5x0s69n21ghwzfvz.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/0c/5rbhj990cy17ywcjutsqx0r5i7ibyxg.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/4d/qnr1g6ogj0h0g0muimnudf0mgapmd69.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f1/qkhitco1vpg467rdx76s2zk0on652vj.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f0/6pcbrfzlh4dq8w7gls2ohp2dlr4gqqn.mp3",
    "https://patchwiki.biligame.com/images/pcr/2/2d/byunsf794qgxmo9tazj6jcszgekf9ig.mp3",
    "https://patchwiki.biligame.com/images/pcr/1/1e/6o47hlyndixlwqm8df9tcpp0z9i7evm.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/6e/fx1xvb2elisvht99ko8fgpuwjvxtud1.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/60/5o86g9fm84zktpdhgn3eslvgfkwmx3p.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/eb/q2vgxl3xgvndekyi6lw7yeykkyw4o03.mp3",
    "https://patchwiki.biligame.com/images/pcr/1/18/enmq56ie1tt8canu1f6onevlukcsna4.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/86/d49nib6cyx6j835qhkvy5eh15a09jsn.mp3",
    "https://patchwiki.biligame.com/images/pcr/c/c2/hbtjjvmr65k4nshsruotgy597yr13d4.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/63/k5kwurwbha6wejhztppkcagk9w9wtw2.mp3",
    "https://patchwiki.biligame.com/images/pcr/a/a5/58c51bv849m4reqcook11whkiibyt2e.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/e61lumgswa059nc3afbjc8g0g7zwboj.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f1/85ryushk9hbtonsjbf2mbetzqj70u8e.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/09/ov3xdvie8byzp0mg11doyq9zb3zqz62.mp3",
    "https://patchwiki.biligame.com/images/pcr/4/4d/qnr1g6ogj0h0g0muimnudf0mgapmd69.mp3",
    "https://patchwiki.biligame.com/images/pcr/1/1e/6o47hlyndixlwqm8df9tcpp0z9i7evm.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/eb/q2vgxl3xgvndekyi6lw7yeykkyw4o03.mp3",
    "https://patchwiki.biligame.com/images/pcr/c/c2/hbtjjvmr65k4nshsruotgy597yr13d4.mp3",
    "https://patchwiki.biligame.com/images/pcr/e/ea/85ryushk9hbtonsjbf2mbetzqj70u8e.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/fe/rl5cnmj09cq5llhpao543bhnc538c4i.mp3",
    "https://patchwiki.biligame.com/images/pcr/9/94/a1ram2fciwu8t5wx5cbgmrxwgq2gbpk.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f1/qkhitco1vpg467rdx76s2zk0on652vj.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/6e/fx1xvb2elisvht99ko8fgpuwjvxtud1.mp3",
    "https://patchwiki.biligame.com/images/pcr/1/18/enmq56ie1tt8canu1f6onevlukcsna4.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/63/k5kwurwbha6wejhztppkcagk9w9wtw2.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/0c/5rbhj990cy17ywcjutsqx0r5i7ibyxg.mp3",
    "https://patchwiki.biligame.com/images/pcr/2/2d/byunsf794qgxmo9tazj6jcszgekf9ig.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f5/rzsnv6rk2qg50klpfwmp94o69rsamhn.mp3",
    "https://patchwiki.biligame.com/images/pcr/0/05/lm32wazfjaefk90vsuece1ob9ecltui.mp3",
    "https://patchwiki.biligame.com/images/pcr/a/ac/cals9wdt5lmizyt5x0s69n21ghwzfvz.mp3",
    "https://patchwiki.biligame.com/images/pcr/f/f0/6pcbrfzlh4dq8w7gls2ohp2dlr4gqqn.mp3",
    "https://patchwiki.biligame.com/images/pcr/6/60/5o86g9fm84zktpdhgn3eslvgfkwmx3p.mp3",
    "https://patchwiki.biligame.com/images/pcr/8/86/d49nib6cyx6j835qhkvy5eh15a09jsn.mp3",
    "https://patchwiki.biligame.com/images/pcr/a/a5/58c51bv849m4reqcook11whkiibyt2e.mp3"
]

let ciku = [
    "派蒙今天已经被戳了_num_次啦，休息一下好不好",
    "派蒙今天已经被戳了_num_次啦，有完没完！",
    "派蒙今天已经被戳了_num_次啦，要戳坏掉了！",
    "派蒙今天已经被戳了_num_次啦，别戳了!!!",
    "派蒙今天已经被戳了_num_次啦，不准戳了！！！",
    "派蒙今天已经被戳了_num_次啦，再戳就坏了！",
];



export class chuo extends plugin {
    constructor() {
        super({
            name: '派蒙戳一戳',
            dsc: '戳一戳机器人触发效果',
            event: 'notice.group.poke',
            priority: 1000,
            rule: [
                {
                    fnc: 'chuoyichuo'
                }
            ]
        }
        )
    }


    async chuoyichuo(e) {
        if (!Config.paimon_chuoyichuo_open) return false
        if (cfg.masterQQ.includes(e.target_id)) {
            if (Config.debug) {
                logger.mark('[戳一戳戳主人生效]')
            }
            if (cfg.masterQQ.includes(e.operator_id) || cfg.qq == e.operator_id || BotQQ == e.operator_id) {
                return;
            }
            let mutetype = Math.ceil(Math.random() * 3)
            switch (mutetype) {
                case 1:
                    await e.reply(`呜呜，有什么开心不开心的都冲${Config.tts_First_person}来吧QAQ`, true)
                    break;
                case 2:
                    await e.reply(`请戳${Config.tts_First_person}吧，${Config.tts_First_person}...${Config.tts_First_person}什么都愿意做QAQ`, true)
                    break;
                case 3:
                    await e.reply(`呜呜呜，${Config.tts_First_person}愿意为你做任何事情`, true)
                    break;
            }
            await common.sleep(1000);
            e.group.pokeMember(e.operator_id);
            return true
        }

        
        if (e.target_id == cfg.qq || BotQQ == e.operator_id) {
            /**统计每日被戳次数 */
            let count = await redis.get(`paimon_pokecount`);
            // 当前时间
            let time = moment(Date.now())
                .add(1, "days")
                .format("YYYY-MM-DD 00:00:00");
            // 到明日零点的剩余秒数
            let exTime = Math.round(
                (new Date(time).getTime() - new Date().getTime()) / 1000
            );
            if (!count) {
                await redis.set(`paimon_pokecount`, 1, { EX: exTime });//${e.group_id}
            } else {
                await redis.set(`paimon_pokecount`, ++count, { EX: exTime });
            }

            /**戳一戳次数生效 */
            if (Math.ceil(Math.random() * 100) <= 10 && count >= 10) {
                if (Config.debug) {
                    logger.mark('[戳一戳次数生效]')
                }
                let text_number = Math.ceil(Math.random() * ciku['length'])
                await e.reply(ciku[text_number - 1].replace(/派蒙/g, Config.tts_First_person).replace("_num_", count))
                return true;
            }


            //生成0-100%的随机数
            let random_type = Math.random()

            /**回复随机文字 */
            if (random_type < reply_text) {
                if (Config.debug) {
                    logger.mark('[戳一戳回复随机文字生效]')
                }
                let mutetype = Math.ceil(Math.random() * 10)
                switch (mutetype) {
                    case 1:
                        let message = await generate_msg_Daiyu()
                        await e.reply(message)
                        break;
                    default:
                        let text_number = Math.ceil(Math.random() * word_list['length'])
                        await e.reply(word_list[text_number - 1].replace(/派蒙/g, Config.tts_First_person))
                        break;
                }
            }

            /**回复随机图片 */
            else if (random_type < (reply_text + reply_img)) {
                if (Config.debug) {
                    logger.mark('[戳一戳回复随机图片生效]')
                }
                let mutetype = Math.ceil(Math.random() * 5)
                if (mutetype == 1) {
                    let url = `https://www.loliapi.com/acg/`;
                    let res = await fetch(url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.url)];
                    await e.reply(`喵>_< ${Config.tts_First_person}有点开心，这是${Config.tts_First_person}私藏的画片哦`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
                else if (mutetype == 2) {
                    let url = `https://t.mwm.moe/mp`;
                    let res = await fetch(url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.url)];
                    await e.reply(`这是${Config.tts_First_person}今天找到的画片哦，主人喜欢吗？`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
                else if (mutetype == 3) {
                    let url = `https://api.asxe.vip/random.php`;
                    let res = await fetch(url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.url)];
                    await e.reply(`主人，快看快看${Config.tts_First_person}发现了什么？`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
                else if (mutetype == 4) {
                    let url = `https://sex.nyan.xyz/api/v2/img?size=regular&tag=loli|ロリ`;
                    let res = await fetch(url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.url)];
                    await e.reply(`主人主人，${Config.tts_First_person}今天捡到了一张奇怪的明信片，拿给你看看`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
                else if (mutetype == 5) {
                    let url = await get_url_from_api_lolicon();
                    let res = await fetch(url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.url)];
                    await e.reply(`呜呜，${Config.tts_First_person}给你一张涩涩的画片，不要再戳戳人家了`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
            }

            /**返回随机音频 */
            else if (random_type < (reply_text + reply_img + reply_voice)) {
                if (Config.debug) {
                    logger.mark('[戳一戳回复随机语音生效]')
                }
                // 匹配发音人物
                let defaultTTSRole = Config.defaultTTSRole
                let voice_lists
                switch (defaultTTSRole) {
                    case '可莉_ZH':
                        // voice_lists = voice_list_klee_cn
                        voice_lists = voice_list_klee_cn.concat(voice_list_klee_jp);
                        break;
                    case '可莉_JP':
                        // voice_lists = voice_list_klee_jp
                        voice_lists = voice_list_klee_jp.concat(voice_list_klee_cn);
                        break;
                    case '纳西妲_ZH':
                        // voice_lists = voice_list_nahida_cn
                        voice_lists = voice_list_nahida_cn.concat(voice_list_nahida_jp);
                        break;
                    case '纳西妲_JP':
                        // voice_lists = voice_list_nahida_jp
                        voice_lists = voice_list_nahida_jp.concat(voice_list_nahida_cn);
                        break;
                    case '派蒙_ZH':
                    case '白露_ZH':
                        voice_lists = voice_list_bailu_cn.concat(voice_list_paimon_cn);
                        break;
                    case '派蒙_JP':
                        voice_lists = voice_list_paimon_jp;
                        break;
                    // 缺省时将返回随机音频替换为返回随机文本
                    default:
                        let text_number = Math.ceil(Math.random() * word_list['length'])
                        return await e.reply(word_list[text_number - 1].replace(/派蒙/g, Config.tts_First_person))
                }
                let voice_number = Math.ceil(Math.random() * voice_lists['length'])
                let voice_url = voice_lists[voice_number - 1]
                // 备份原版config
                let cloudMode_bak = Config.cloudMode
                // 设置为url模式
                Config.cloudMode = 'url'
                let ignoreEncode = e.adapter === 'shamrock'
                let sendable
                try {
                    sendable = await uploadRecord(voice_url, 'vits-uma-genshin-honkai', ignoreEncode)
                    if (!sendable) {
                        // 如果合成失败，尝试使用ffmpeg合成
                        sendable = segment.record(voice_url)
                    }
                } catch (err) {
                    logger.error(err)
                    sendable = segment.record(voice_url)
                }
                Config.cloudMode = cloudMode_bak
                if (!sendable) {
                    await e.reply('silk云转码和ffmpeg都失败惹喵，呜呜人家的麦克风坏了', false, { recallMsg: 8 })
                    return
                }
                await e.reply(sendable)
            }
            /**禁言 */
            else if (random_type < (reply_text + reply_img + reply_voice + mutepick)) {
                if (Config.debug) {
                    logger.mark('[戳一戳禁言生效]')
                }
                let usrinfo = await Bot.getGroupMemberInfo(e.group_id, e.operator_id)
                let botinfo = await Bot.getGroupMemberInfo(e.group_id, Bot.uin)
                let role = ['owner', 'admin']
                if (!cfg.masterQQ.includes(e.operator_id)) {
                    if ((role.includes(botinfo.role) && !role.includes(usrinfo.role)) || (botinfo.role == 'owner' && usrinfo.role == 'admin')) {
                        let mutetype = Math.ceil(Math.random() * 4)
                        if (mutetype == 1) {
                            await e.reply(`是不是要${Config.tts_First_person}揍揍你才开心呀！`)
                            await common.sleep(100)
                            await e.group.muteMember(e.operator_id, 60);
                            await common.sleep(100)
                            await e.reply('哼！')
                        }
                        else if (mutetype == 2) {
                            await e.reply('不！！')
                            await common.sleep(10);
                            await e.reply('准！！')
                            await common.sleep(10);
                            await e.reply('戳！！');
                            await common.sleep(10);
                            await e.reply('人！！');
                            await common.sleep(10)
                            await e.reply('家！！')
                            await common.sleep(10);
                            await e.group.muteMember(e.operator_id, 60)
                            await common.sleep(50)
                            await e.reply('让你面壁思过1分钟，哼😤～')
                        }
                        else if (mutetype == 3) {
                            await e.reply(`要怎么样才能让你不戳${Config.tts_First_person}啊!`)
                            await common.sleep(100)
                            await e.group.muteMember(e.operator_id, 60);
                            await common.sleep(100)
                            await e.reply('大变态！')
                        }
                        else if (mutetype == 4) {
                            await e.reply(`干嘛戳${Config.tts_First_person}，${Config.tts_First_person}要惩罚你！`)
                            await common.sleep(100)
                            await e.group.muteMember(e.operator_id, 60);

                        }
                        else if (role.includes(usrinfo.role)) {
                            let mutetype = Math.ceil(Math.random() * 3)
                            if (mutetype == 1) {
                                e.reply(`呜呜呜你欺负${Config.tts_First_person}`)
                            }
                            else if (mutetype == 2) {
                                e.reply(`主人有坏淫欺负${Config.tts_First_person}`)
                            }
                            else if (mutetype == 3) {
                                e.reply(`气死${Config.tts_First_person}了不要戳了！`)
                            }

                        }

                    }

                }

                else if (cfg.masterQQ.includes(e.operator_id)) {
                    let mutetype = Math.ceil(Math.random() * 2)
                    if (mutetype == 1) {
                        e.reply(`主人连你也欺负${Config.tts_First_person}，呜呜呜~`)
                    }
                    else if (mutetype == 2) {
                        e.reply('主人有什么事吗？喵~')
                    }
                    else if (mutetype == 3) {
                        e.reply(`${Config.tts_First_person}，${Config.tts_First_person}才不会这样子！真正的${Config.tts_First_person}从来不是傲娇！傲，傲娇什么的，都，都是别人杜摆~嗯，一点，一点也没有呢！`)
                    }

                }

            }

            //拍一拍表情包
            else if (random_type < (reply_text + reply_img + reply_voice + mutepick + example)) {
                if (Config.debug) {
                    logger.mark('[戳一戳拍一拍表情包生效]')
                }
                await e.reply(await segment.image(`http://ovooa.com/API/face_pat/?QQ=${e.operator_id}`))
            }

            //反击
            else {
                if (Config.debug) {
                    logger.mark('[戳一戳反击生效]')
                }
                let mutetype = Math.round(Math.random() * 3)
                if (mutetype == 1) {
                    e.reply(`${Config.tts_First_person}也要戳戳你>_<`)
                    await common.sleep(1000)
                    await e.group.pokeMember(e.operator_id)
                }
                else if (mutetype == 2) {
                    e.reply(`你刚刚是不是戳${Config.tts_First_person}了?${Config.tts_First_person}要戳回去！`)
                    await common.sleep(1000)
                    await e.group.pokeMember(e.operator_id)
                }
                else if (mutetype == 3) {
                    e.reply(`让你戳${Config.tts_First_person}，哼！！！`)
                    await common.sleep(1000)
                    await e.group.pokeMember(e.operator_id)
                }
            }

        }

    }

}

/**从https://api.lolicon.app/setu/v2/ 中返回图片地址，支持3个tag参数 */
async function get_url_from_api_lolicon(tag1 = '萝莉', tag2 = 'ロリ', tag3 = 'loli') {
    const url = `https://api.lolicon.app/setu/v2?size=regular&tag=${tag1}|${tag2}|${tag3}`;
    for (let i = 0; i < 3; i++) {
        try {
            const response = await fetch(url)
            const result = await response.json()
            if (Array.isArray(result.data) && result.data.length === 0) {
                logger.info('派蒙戳一戳api_lolicon未获取到图片')
                throw new Error(result)
            }
            let pic_url = result.data[0].urls?.original || result.data[0].urls?.regular || result.data[0].urls?.small
            if (!pic_url) throw new Error(result)
            return pic_url
        } catch (err) {
            logger.info(err)
        }
    }
    logger.warn(`派蒙戳一戳获取api_lolicon pic_url失败3次`)
}

/**一言 返回文本/错误则返回null*/
async function get_msg_hitokoto () {
    let url = 'https://v1.hitokoto.cn/'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][一言] 接口请求失败')
        }
        res = await res.json()
        return res.hitokoto
    } catch (err) {
        logger.error(err)
        return null
    }
}

/**网易云热评 返回文本/错误则返回null */
async function get_msg_wyyrp () {
    let url = 'https://api.xingzhige.com/API/NetEase_CloudMusic_hotReview/'
    try {
        let res = await fetch(url).catch((err) => logger.error(err))
        if (!res) {
            throw new Error('[派蒙戳一戳][网易云热评] 接口请求失败')
        }    
        res = await res.json()
        return res.data.content
    }
    catch (err) {
        logger.error(err)
        return null
    }
}