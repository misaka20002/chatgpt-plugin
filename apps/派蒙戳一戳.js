import plugin from '../../../lib/plugins/plugin.js';
import { segment } from 'icqq'
import cfg from '../../../lib/config/config.js'
import common from '../../../lib/common/common.js'
import moment from 'moment'
import { Config } from '../utils/config.js'
import uploadRecord from '../utils/uploadRecord.js'

let reply_text = 0.0 //文字触发概率,小数点后5位都可以
let reply_img = 0.15 //随机图片触发概率
let reply_voice = 0.7 //语音触发概率
let mutepick = 0.05 //禁言触发概率
// 剩下的0.1概率是机器人戳回去

//自定义文案
let word_list = ['怎么了吗？',
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
    '你要是在戳我！！派蒙~派蒙就打你，哼！',
    '哼~派蒙才不是傲娇呢，那是什么不知道鸭',
    '派蒙，派蒙才不会这样子！真正的派蒙从来不是傲娇！傲，傲娇什么 的，都，都是别人杜摆~嗯，一点，一点也没有呢',
    '派蒙……派蒙……才不是傲娇呢',
    '只是刚好路过而已，才不是因为你戳派蒙特地来看你的呢！你可不要异想天开',
    '派蒙可不是因为喜欢才这样做的哦',
    '笨蛋，派蒙才，，，才不是特地来找你们的呢',
    '啊~好舒服喵，其实派蒙也不是很想要这个~如果你硬要给派蒙，派蒙就勉为其难的收下了',
    '只要你需要派蒙就会在哦',
    '你这个变态，大变态，超级变态！不要在碰派蒙了！',
    '你在想对派蒙涩涩对吗，不可以哦',
    '派蒙在哦！是有什么事情吗？',
    '你会一直记得派蒙吗',
    '派蒙不但可爱而且可爱你啦',
    '派蒙发脾气了你就听着,结束了派蒙会怂给你看',
    '劝你别整天对派蒙戳戳戳的有本事你来亲亲派蒙',
    '你走上了爱派蒙这条不归路。',
    '宝宝是不是又熬夜了，派蒙看你还在线',
    '派蒙把自己送给你好了虽然派蒙很可爱但是派蒙养不起自己了',
    '派蒙偏偏要无理取闹除非抱抱我',
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
    '猫咪和狗狗和派蒙你更喜欢哪一个喵？'];

// 纳西妲中文，扒文件改地址： https://bbs.mihoyo.com/ys/obc/content/5111/detail?bbs_presentation_style=no_header 在浏览器F12的网络截取到之后复制全部，用notepad++的crrl+M标记和正则表达式提取，正则表达式： "https:.*mp3",
// 替换戳一戳语音角色在429行
/**纳西妲中文语音 */
let voice_list_nahida_cn = ["https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/4d9feb71760c5e8eb5f6c700df12fa0c_6824265537002152805.mp3",
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
    "https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/f514abfbe4a9358e96038850d6d64742_5784748521077424357.mp3"]

/**纳西妲日语语音 */
let voice_list_nahida_jp = ["https://uploadstatic.mihoyo.com/ys-obc/2022/11/02/16576950/9618f394ecbcb26441aa52eddd33bfea_1309297346298226467.mp3",
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
let voice_list_klee_cn = ["https://uploadstatic.mihoyo.com/ys-obc/2022/05/12/8797197/070931802fe095614d6b2478873d79d5_1506586020611038144.mp3",
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


let ciku_ = ["_name_今天已经被戳了_num_次啦，休息一下下好不好",
    "_name_今天已经被戳了_num_次啦,呜呜，有完没完啦！",
    "_name_今天已经被戳了_num_次啦,别戳派蒙了！！！",
    "_name_今天已经被戳了_num_次啦,不准戳派蒙了！",
    "_name_今天已经被戳了_num_次啦,再戳派蒙就坏掉啦！"
]

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
        logger.info('[派蒙戳一戳生效]')
        if (e.target_id == cfg.qq) {
            let count = await redis.get(`Mz:pokecount:${e.group_id}`)
            let time = moment(Date.now())
                .add(1, "days")
                .format("YYYY-MM-DD 00:00:00")
            let exTime = Math.round(
                (new Date(time).getTime() - new Date().getTime()) / 1000
            )
            if (!count) {
                await redis.set(`Mz:pokecount:$(e.group_id)`, 1 * 1, { EX: exTime })
            } else {
                await redis.set(`Mz:pokecount:$(e.group_id)`, ++count, {
                    EX: exTime,
                })
            }
            /**count”大于或等于10时30%的概率触发 */
            if (Math.ceil(Math.random() * 100) <= 30 && count >= 10) {
                let conf = cfg.getGroup(e.group_id)
                e.reply([
                    `${ciku_[Math.round(Math.random() * (ciku_length - 1))]}`
                        .replace("_name_", conf.botAlias[0])
                        .replace("_num_", count),
                ]);
                return true
            }


            /**返回随机文本 */
            let random_type = Math.random()
            if (random_type < reply_text) {
                let text_number = Math.ceil(Math.random() * word_list['length'])
                await e.reply(word_list[text_number - 1].replace(/派蒙/g, Config.tts_First_person))
            }
            /**返回随机图片 */
            else if (random_type < (reply_text + reply_img)) {
                let mutetype = Math.ceil(Math.random() * 5)
                if (mutetype == 1) {
                    let voice_url = `https://www.loliapi.com/acg/`;
                    let res = await fetch(voice_url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.voice_url)];
                    await e.reply(`喵>_< ${Config.tts_First_person}有点开心，这是${Config.tts_First_person}私藏的画片哦`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
                else if (mutetype == 2) {
                    let voice_url = `https://sex.nyan.xyz/api/v2/img?tag=loli`;
                    let res = await fetch(voice_url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.voice_url)];
                    await e.reply(`这是${Config.tts_First_person}今天找到的画片哦，主人喜欢吗？`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
                else if (mutetype == 3) {
                    let voice_url = `https://api.asxe.vip/random.php`;
                    let res = await fetch(voice_url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.voice_url)];
                    await e.reply(`主人，快看快看${Config.tts_First_person}发现了什么？`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
                else if (mutetype == 4) {
                    let voice_url = `https://t.mwm.moe/mp`;
                    let res = await fetch(voice_url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.voice_url)];
                    await e.reply(`主人主人，${Config.tts_First_person}今天捡到了一张奇怪的明信片，拿给你看看`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
                else if (mutetype == 5) {
                    let voice_url = `https://sex.nyan.xyz/api/v2/img?tag=loli`;
                    let res = await fetch(voice_url).catch((err) => logger.error(err));
                    let msg = [segment.image(res.voice_url)];
                    await e.reply(`呜呜，${Config.tts_First_person}给你一张涩涩的画片，不要再戳戳人家了`)
                    await common.sleep(100)
                    await e.reply(msg);
                }
            }
            /**返回随机音频 */
            else if (random_type < (reply_text + reply_img + reply_voice)) {
                // 匹配发音人物
                let defaultTTSRole = Config.defaultTTSRole
                let voice_lists
                switch (defaultTTSRole) {
                    case '可莉_ZH':
                        voice_lists = voice_list_klee_cn
                        break;
                    case '纳西妲_ZH':
                        voice_lists = voice_list_nahida_cn
                        break;
                    case '纳西妲_JP':
                        voice_lists = voice_list_nahida_jp
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
                Config.cloudMode = "voice_url"
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
                    await e.reply('silk云转码和ffmpeg都失败惹喵，人家的麦克风坏了', false, { recallMsg: 8 })
                    return
                }
                await e.reply(sendable)
            }
            /**禁言 */
            else if (random_type < (reply_text + reply_img + reply_voice + mutepick)) {
                let usrinfo = await Bot.getGroupMemberInfo(e.group_id, e.operator_id)
                let botinfo = await Bot.getGroupMemberInfo(e.group_id, Bot.uin)
                let role = ['owner', 'admin']
                if (!cfg.masterQQ.includes(e.operator_id)) {
                    if ((role.includes(botinfo.role) && !role.includes(usrinfo.role)) || (botinfo.role == 'owner' && usrinfo.role == 'admin')) {
                        let mutetype = Math.ceil(Math.random() * 4)
                        if (mutetype == 1) {
                            await e.reply(`是不是要${Config.tts_First_person}揍揍你才开心呀！`)
                            await common.sleep(100)
                            await e.group.muteMember(e.operator_id, 120);
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
                            await e.reply('派！！');
                            await common.sleep(10)
                            await e.reply('蒙！！')
                            await common.sleep(10);
                            await e.group.muteMember(e.operator_id, 120)
                            await common.sleep(50)
                            await e.reply('让你面壁思过2分钟，哼😤～')
                        }
                        else if (mutetype == 3) {
                            await e.reply(`要怎么样才能让你不戳${Config.tts_First_person}啊!`)
                            await common.sleep(100)
                            await e.group.muteMember(e.operator_id, 120);
                            await common.sleep(100)
                            await e.reply('大变态！')
                        }
                        else if (mutetype == 4) {
                            await e.reply(`干嘛戳${Config.tts_First_person}，${Config.tts_First_person}要惩罚你！`)
                            await common.sleep(100)
                            await e.group.muteMember(e.operator_id, 120);

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
            /**反戳回去 */
            else {
                let poke = Math.ceil(Math.random() * 2)
                if (poke == 1) {
                    await e.reply(`你刚刚是不是戳${Config.tts_First_person}了?${Config.tts_First_person}要戳回去！`)
                    await common.sleep(100)
                    await e.group.pokeMember(e.operator_id)
                }
                else if (poke == 2) {
                    await e.group.pokeMember(e.operator_id)
                    await common.sleep(100)
                    await e.reply(`让你戳${Config.tts_First_person}，哼！！！`)
                }

            }

        }

    }

}
