import { Config } from './config.js'
import fetch from 'node-fetch'
import _ from 'lodash'
import { getProxy } from './proxy.js'
let proxy = getProxy()

import WebSocket from 'ws'
const sleep_pai = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

// 如何获取？在网页F12-Shift+Ctrl+C元素选项卡中找到点击下拉的元素-右键选择中断于属性修改-点击下拉按钮-元素选项卡中ctrl+F搜索角色名
// &amp; 改 &
export const speakers_ZH = ["阿扎尔_ZH", "塞德娜_ZH", "鹿野院平藏_ZH", "黑田_ZH", "米凯_ZH", "博易_ZH", "菲尔戈黛特_ZH", "维多利亚_ZH", "安东尼娜_ZH", "艾琳_ZH", "维多克_ZH", "三月七_ZH", "克列门特_ZH", "贾拉康_ZH", "侍从丙_ZH", "真理医生_ZH", "埃舍尔_ZH", "警长_ZH", "黛比_ZH", "虎克_ZH", "埃洛伊_ZH", "萨赫哈蒂_ZH", "小仓澪_ZH", "安柏_ZH", "小乐_ZH", "萍姥姥_ZH", "斯薇塔_ZH", "黑天鹅_ZH", "菲米尼_ZH", "若心_ZH", "玻瑞亚斯_ZH", "佐西摩斯_ZH", "加福尔_ZH", "asideb_ZH", "九条裟罗_ZH", "弗洛朗_ZH", "希格雯_ZH", "阿幸_ZH", "钟表匠_ZH", "马姆杜_ZH", "筑梦师_ZH", "巴蒂斯特_ZH", "卡莉娜_ZH", "德拉萝诗_ZH", "阿夫辛_ZH", "香菱_ZH", "吴船长_ZH", "帮派老大_ZH", "银枝_ZH", "厨子_ZH", "沙扎曼_ZH", "梦主_ZH", "阿鸠_ZH", "有原则的猎犬家系成员_ZH", "刃_ZH", "阿汉格尔_ZH", "巨大谜钟_ZH", "黑泽京之介_ZH", "公主_ZH", "雪衣_ZH", "绮良良_ZH", "贝努瓦_ZH", "驭空_ZH", "伊迪娅_ZH", "诗筠_ZH", "西尔弗_ZH", "阿守_ZH", "杜拉夫_ZH", "留云借风真君_ZH", "引导员_ZH", "寒鸦_ZH", "提纳里_ZH", "接笏_ZH", "麦希尔_ZH", "派蒙_ZH", "艾文_ZH", "可可利亚_ZH", "艾莉丝_ZH", "银杏_ZH", "尤苏波夫_ZH", "凯亚_ZH", "洛伦佐_ZH", "琴_ZH", "迪娜泽黛_ZH", "莫娜_ZH", "拉赫曼_ZH", "连烟_ZH", "丹恒_ZH", "阿扎木_ZH", "纳比尔_ZH", "新之丞_ZH", "居勒什_ZH", "阿洛瓦_ZH", "歌蒂_ZH", "梅里埃_ZH", "韦尔纳_ZH", "特纳_ZH", "星稀_ZH", "造物翻译官_ZH", "罗莎莉亚_ZH", "塞塔蕾_ZH", "稻城萤美_ZH", "淮安_ZH", "维尔芒_ZH", "青镞_ZH", "李丁_ZH", "卡莉露_ZH", "雅各_ZH", "玛格丽特_ZH", "申鹤_ZH", "娜维娅_ZH", "漱玉_ZH", "玛乔丽_ZH", "丹枢_ZH", "丹羽_ZH", "伊德里西_ZH", "艾尔海森_ZH", "久岐忍_ZH", "妮露_ZH", "发抖的流浪者_ZH", "芙卡洛斯_ZH", "木村_ZH", "捕快_ZH", "小川_ZH", "木南杏奈_ZH", "轰大叔_ZH", "剑阵中的声音_ZH", "今谷香里_ZH", "旅行者_ZH", "韵宁_ZH", "大毫_ZH", "龙二_ZH", "瑞安维尔_ZH", "凝光_ZH", "珊瑚_ZH", "爱贝尔_ZH", "达达利亚_ZH", "温和的声音_ZH", "那维莱特_ZH", "欧菲妮_ZH", "千织_ZH", "博士_ZH", "重佐_ZH", "九条镰治_ZH", "玛吉_ZH", "百闻_ZH", "记忆中的声音_ZH", "卡卡瓦夏_ZH", "艾洛迪_ZH", "舍利夫_ZH", "玛达赫_ZH", "西拉杰_ZH", "老孟_ZH", "劳维克_ZH", "星_ZH", "花火_ZH", "悦_ZH", "岚姐_ZH", "净砚_ZH", "宛烟_ZH", "神里绫华_ZH", "坎蒂丝_ZH", "迪肯_ZH", "娜塔莎_ZH", "八重神子_ZH", "老戴_ZH", "拍卖会工作人员_ZH", "慈祥的女声_ZH", "佩拉_ZH", "浣溪_ZH", "老芬奇_ZH", "拉齐_ZH", "玥辉_ZH", "徐六石_ZH", "镜中人_ZH", "刻晴_ZH", "辛焱_ZH", "埃德_ZH", "德沃沙克_ZH", "玛塞勒_ZH", "今谷三郎_ZH", "奥泰巴_ZH", "薇若妮卡_ZH", "皮特_ZH", "伯恩哈德_ZH", "祖莉亚·德斯特雷_ZH", "薇尔_ZH", "丹吉尔_ZH", "菲谢尔_ZH", "齐米亚_ZH", "重云_ZH", "烟绯_ZH", "加拉赫_ZH", "乔瓦尼_ZH", "尤利安_ZH", "毗伽尔_ZH", "空_ZH", "白老先生_ZH", "法伊兹_ZH", "芷巧_ZH", "卡芙卡_ZH", "行秋_ZH", "杜吉耶_ZH", "埃尔欣根_ZH", "莱欧斯利_ZH", "长生_ZH", "平山_ZH", "翡翠_ZH", "斯科特_ZH", "神里绫人_ZH", "瓦乐瑞娜_ZH", "一平_ZH", "哲平_ZH", "托帕_ZH", "侯章_ZH", "瓦尔特_ZH", "独孤朔_ZH", "伦纳德_ZH", "阿来_ZH", "卢卡_ZH", "里卡尔_ZH", "会场广播_ZH", "宏达_ZH", "早柚_ZH", "克罗索_ZH", "甘雨_ZH", "木木_ZH", "博来_ZH", "石头_ZH", "丹恒•饮月_ZH", "大和田_ZH", "西瓦尼_ZH", "忠诚的侍从_ZH", "七七_ZH", "言笑_ZH", "克拉拉_ZH", "克雷薇_ZH", "纳菲斯_ZH", "德田_ZH", "半夏_ZH", "科尔特_ZH", "海妮耶_ZH", "卡维_ZH", "杰帕德_ZH", "远黛_ZH", "浮游风蕈兽·元素生命_ZH", "白术_ZH", "炒冷饭机器人_ZH", "阿兰_ZH", "自称渊上之物_ZH", "七叶寂照秘密主_ZH", "丽莎_ZH", "亚卡巴_ZH", "辛克尔_ZH", "伽吠毗陀_ZH", "深渊法师_ZH", "巴达维_ZH", "年长的患者_ZH", "上杉_ZH", "隐书_ZH", "立本_ZH", "垃垃撕圾_ZH", "蒂玛乌斯_ZH", "景元_ZH", "迪希雅_ZH", "守护者的意志_ZH", "加藤洋平_ZH", "基娅拉_ZH", "姬子_ZH", "波提欧_ZH", "浮烟_ZH", "朔次郎_ZH", "被俘的信徒_ZH", "莫塞伊思_ZH", "塔里克_ZH", "艾米绮_ZH", "shajinma_ZH", "华劳斯_ZH", "螺丝咕姆_ZH", "乌维_ZH", "嚣张的小孩_ZH", "掇星攫辰天君_ZH", "阿尔卡米_ZH", "阿山婆_ZH", "科林斯_ZH", "光之_ZH", "芭芭拉_ZH", "迪卢克_ZH", "五郎_ZH", "葛瑞丝_ZH", "严苛评委_ZH", "霄翰_ZH", "明曦_ZH", "莱斯格_ZH", "金忽律_ZH", "符玄_ZH", "珠函_ZH", "苍老的声音_ZH", "奇怪的云骑_ZH", "田铁嘴_ZH", "巴哈利_ZH", "砂金_ZH", "罗刹_ZH", "青雀_ZH", "阿旭_ZH", "琳妮特_ZH", "削月筑阳真君_ZH", "宁禄_ZH", "艾薇拉_ZH", "巴穆恩_ZH", "藿藿_ZH", "古山_ZH", "莱昂_ZH", "嘉良_ZH", "阿佩普_ZH", "夏妮_ZH", "斯坦利_ZH", "柊千里_ZH", "闲云_ZH", "长门幸子_ZH", "智树_ZH", "艾伦_ZH", "消沉的患者_ZH", "夏洛蒂_ZH", "独眼小僧_ZH", "醉醺醺的宾客_ZH", "镜流_ZH", "有乐斋_ZH", "拉伊德_ZH", "阮•梅_ZH", "布洛妮娅_ZH", "荧_ZH", "珐露珊_ZH", "娜比雅_ZH", "罗伊斯_ZH", "拍卖师_ZH", "丝柯克_ZH", "莱依拉_ZH", "玲可_ZH", "鲁哈维_ZH", "银狼_ZH", "副警长_ZH", "桑博_ZH", "耕一_ZH", "凯瑟琳_ZH", "长野原龙之介_ZH", "晴霓_ZH", "托帕&账账_ZH", "舒伯特_ZH", "小贩_ZH", "乐平波琳_ZH", "式大将_ZH", "商华_ZH", "江蓠_ZH", "纯也_ZH", "叶德_ZH", "绿芙蓉_ZH", "嘉义_ZH", "托克_ZH", "艾伯特_ZH", "爱德华医生_ZH", "寒腿叔叔_ZH", "迈蒙_ZH", "猎犬家系成员_ZH", "阿蕾奇诺_ZH", "阿娜耶_ZH", "枫原万叶_ZH", "阿巴图伊_ZH", "温迪_ZH", "深渊使徒_ZH", "维格尔_ZH", "怀疑的患者_ZH", "大慈树王_ZH", "一心传名刀_ZH", "天目十五_ZH", "查宝_ZH", "奥列格_ZH", "知易_ZH", "萨齐因_ZH", "谢赫祖拜尔_ZH", "安静的宾客_ZH", "米沙_ZH", "法拉娜_ZH", "希露瓦_ZH", "艾丝妲_ZH", "笼钓瓶一心_ZH", "科拉莉_ZH", "希儿_ZH", "冷漠的男性_ZH", "夜兰_ZH", "伊萨克_ZH", "阿斯法德_ZH", "小野寺_ZH", "埃勒曼_ZH", "巫女_ZH", "卡卡瓦夏的姐姐_ZH", "冥火大公_ZH", "芙宁娜_ZH", "沙寅_ZH", "花角玉将_ZH", "讨嫌的小孩_ZH", "波洛_ZH", "诺艾尔_ZH", "斯嘉莉_ZH", "班尼特_ZH", "昆钧_ZH", "理查_ZH", "恕筠_ZH", "珊瑚宫心海_ZH", "卡萝蕾_ZH", "泽田_ZH", "大肉丸_ZH", "阿圆_ZH", "望雅_ZH", "年幼的孩子_ZH", "雷泽_ZH", "彦卿_ZH", "阿贝多_ZH", "夏沃蕾_ZH", "公输师傅_ZH", "手岛_ZH", "燕翠_ZH", "鹿野奈奈_ZH", "伊丝黛莱_ZH", "胡桃_ZH", "沃特林_ZH", "广大_ZH", "帕维耶_ZH", "加萨尼_ZH", "伊利亚斯_ZH", "桂乃芬_ZH", "焦躁的丹鼎司医士_ZH", "向导_ZH", "捕头_ZH", "常九爷_ZH", "伊庭_ZH", "阿往_ZH", "优菈_ZH", "阿雩_ZH", "埃斯蒙德_ZH", "黄泉_ZH", "费索勒_ZH", "云叔_ZH", "贝雅特丽奇_ZH", "钟离_ZH", "砂糖_ZH", "露子_ZH", "阿伟_ZH", "费迪南德_ZH", "紫月季_ZH", "林尼_ZH", "佩尔西科夫_ZH", "蒂埃里_ZH", "莱提西娅_ZH", "界种科科员_ZH", "刻薄的小孩_ZH", "泽维尔_ZH", "卡波特_ZH", "朋义_ZH", "星期日_ZH", "知更鸟_ZH", "克洛琳德_ZH", "茂才公_ZH", "伊莎朵_ZH", "尾巴_ZH", "邓恩_ZH", "暮夜剧团团长_ZH", "塞琉斯_ZH", "凯西娅_ZH", "吉莲_ZH", "劳伦斯_ZH", "杰洛尼_ZH", "海芭夏_ZH", "艾迪恩_ZH", "福尔茨_ZH", "狐妖_ZH", "露尔薇_ZH", "荒谷_ZH", "岩明_ZH", "停云_ZH", "石头老板_ZH", "费斯曼_ZH", "魔女N_ZH", "梁沐_ZH", "陆行岩本真蕈·元素生命_ZH", "村田_ZH", "铁尔南_ZH", "百识_ZH", "流萤_ZH", "北斗_ZH", "维尔德_ZH", "霍夫曼_ZH", "菲约尔_ZH", "悠策_ZH", "白露_ZH", "松浦_ZH", "信使_ZH", "流浪者_ZH", "贡达法_ZH", "今谷佳祐_ZH", "维卡斯_ZH", "琳琅_ZH", "幻胧_ZH", "法哈德_ZH", "考特里亚_ZH", "云堇_ZH", "嘉玛_ZH", "钟表小子_ZH", "天叔_ZH", "卡西迪_ZH", "艾丽_ZH", "嘉明_ZH", "安西_ZH", "金人会长_ZH", "洛恩_ZH", "女声_ZH", "奇妙的船_ZH", "竺子_ZH", "库斯图_ZH", "维利特_ZH", "高善_ZH", "元太_ZH", "旁白_ZH", "唐娜_ZH", "萨姆_ZH", "阿拉夫_ZH", "穹_ZH", "米卡_ZH", "男声_ZH", "卓也_ZH", "岩夫_ZH", "可莉_ZH", "宵宫_ZH", "娜德瓦_ZH", "戴因斯雷布_ZH", "纳西妲_ZH", "葵_ZH", "奥兹_ZH", "恶龙_ZH", "星际和平播报_ZH", "迪奥娜_ZH", "商人_ZH", "冒失的帕拉德_ZH", "浮游水蕈兽·元素生命_ZH", "爱德琳_ZH", "慧心_ZH", "理水叠山真君_ZH", "绘星_ZH", "塔杰·拉德卡尼_ZH", "帕姆_ZH", "西衍先生_ZH", "女士_ZH", "阿祇_ZH", "卡布斯_ZH", "雷电将军_ZH", "阿晃_ZH", "赛诺_ZH", "芙萝拉_ZH", "赛索斯_ZH", "托马_ZH", "阿尼斯_ZH", "迪尔菲_ZH", "素裳_ZH", "塞萨尔的日记_ZH", "柯莱_ZH", "霄老大_ZH", "卯师傅_ZH", "查尔斯_ZH", "羽生田千鹤_ZH", "久利须_ZH", "纯水精灵_ZH", "古田_ZH", "迈勒斯_ZH", "回声海螺_ZH", "魈_ZH", "帕斯卡_ZH", "瑶瑶_ZH", "多莉_ZH", "荒泷一斗_ZH", "莎拉_ZH", "史瓦罗_ZH", "埃泽_ZH", "莺儿_ZH", "胡尚_ZH", "黑塔_ZH", "拉格沃克•夏尔•米哈伊尔_ZH", "康纳_ZH", "杰克_ZH", "药王秘传魁首_ZH", "札齐_ZH"]
export const speakers_JP = ["托克_JP", "希儿_JP", "阿祇_JP", "吉莲_JP", "花火_JP", "可莉_JP", "年长的患者_JP", "将司_JP", "向导_JP", "克雷薇_JP", "伊庭_JP", "真_JP", "晴霓_JP", "元太_JP", "玻瑞亚斯_JP", "莎塔娜_JP", "葛瑞丝_JP", "林尼_JP", "菲谢尔_JP", "阿尔卡米_JP", "凯西娅_JP", "阿仁_JP", "警觉的流浪者_JP", "波洛_JP", "木木_JP", "若心_JP", "卡卡瓦夏_JP", "卡莉娜_JP", "阿扎尔_JP", "莱斯格_JP", "古田_JP", "海妮耶_JP", "麦希尔_JP", "梦茗_JP", "法赫尔_JP", "药王秘传魁首_JP", "莺儿_JP", "木南杏奈_JP", "纳菲斯_JP", "维多克_JP", "丹吉尔_JP", "荒谷_JP", "言笑_JP", "伦纳德_JP", "库塞拉_JP", "隐书_JP", "科尔特_JP", "阿金_JP", "卓也_JP", "严苛评委_JP", "剑阵中的声音_JP", "黑泽京之介_JP", "劳维克_JP", "珐露珊母亲_JP", "阿夫辛_JP", "帕帕克_JP", "半夏_JP", "望雅_JP", "杜吉耶_JP", "五郎_JP", "狐妖_JP", "洛恩_JP", "百识_JP", "艾伯特_JP", "塔里克_JP", "钱德拉_JP", "阿灼_JP", "西尔弗_JP", "温世玲_JP", "回声海螺_JP", "罗刹_JP", "巫女_JP", "露子_JP", "提纳里_JP", "康纳_JP", "娜塔莎_JP", "丹恒•饮月_JP", "江蓠_JP", "正人_JP", "兴修_JP", "瑶瑶_JP", "银杏_JP", "垃垃撕圾_JP", "可可利亚_JP", "安西_JP", "阿贝多_JP", "阮•梅_JP", "希露瓦_JP", "狼哥_JP", "劳伦斯_JP", "悦_JP", "阿芬迪_JP", "云堇_JP", "罗巧_JP", "埃德_JP", "夜兰_JP", "雷电将军_JP", "哲平_JP", "浮游水蕈兽·元素生命_JP", "毗伽尔_JP", "贡达法_JP", "斯坦利_JP", "楠楠_JP", "塞琉斯_JP", "克罗索_JP", "赛索斯_JP", "安托万_JP", "埃勒曼_JP", "薇尔_JP", "阿娜耶_JP", "珠函_JP", "阿兰_JP", "河童_JP", "阿伟_JP", "大和田_JP", "今谷佳祐_JP", "维格尔_JP", "迪奥娜_JP", "库塞拉的信件_JP", "丝柯克_JP", "朱特_JP", "知更鸟_JP", "布洛克_JP", "九条孝行_JP", "接笏_JP", "炒冷饭机器人_JP", "淮安_JP", "老芬奇_JP", "佐西摩斯_JP", "老戴_JP", "长生_JP", "公司的业务员代表_JP", "萍姥姥_JP", "艾洛迪_JP", "雅各_JP", "德沃沙克_JP", "公输师傅_JP", "尤苏波夫_JP", "诺尔伯特_JP", "那维莱特_JP", "欧菲妮_JP", "芙宁娜_JP", "千织_JP", "特纳_JP", "奇怪的云骑_JP", "费迪南德_JP", "鲁哈维_JP", "帮派老大_JP", "小乐_JP", "冒失的帕拉德_JP", "深渊使徒_JP", "巴哈利_JP", "黛比_JP", "希格雯_JP", "幻胧_JP", "札齐_JP", "刻薄的小孩_JP", "乌维_JP", "卡波特_JP", "法伊兹_JP", "吴船长_JP", "塞萨尔的日记_JP", "松浦_JP", "葵_JP", "保姆_JP", "枫原景春_JP", "尚博迪克_JP", "陆行岩本真蕈·元素生命_JP", "古山_JP", "米凯_JP", "伊萨克_JP", "轰大叔_JP", "孟迪尔_JP", "绘星_JP", "深渊法师_JP", "沙寅_JP", "玛格丽特_JP", "真理医生_JP", "七七_JP", "稻生_JP", "女士_JP", "露尔薇_JP", "阿晃_JP", "华劳斯_JP", "记忆中的声音_JP", "卡布斯_JP", "星际和平播报_JP", "留云借风真君_JP", "闲云_JP", "爱贝尔_JP", "阿守_JP", "科林斯_JP", "阿丰_JP", "李丁_JP", "舒蕾_JP", "琳妮特_JP", "塔杰·拉德卡尼_JP", "甘雨_JP", "阿旭_JP", "塞德娜_JP", "霄翰_JP", "泽维尔_JP", "会场广播_JP", "艾米绮_JP", "有原则的猎犬家系成员_JP", "有乐斋_JP", "埃舍尔_JP", "桂乃芬_JP", "拍卖师_JP", "久利须_JP", "邓恩_JP", "台词评委_JP", "停云_JP", "某人的声音_JP", "景元_JP", "帕斯卡_JP", "远黛_JP", "爱德琳_JP", "白露_JP", "发抖的流浪者_JP", "明曦_JP", "沃特林_JP", "嘉良_JP", "娜维娅_JP", "凯亚_JP", "女声_JP", "查尔斯_JP", "克洛琳德_JP", "守护者的意志_JP", "胡尚_JP", "符玄_JP", "九条镰治_JP", "伊丝黛莱_JP", "肢体评委_JP", "穹_JP", "恕筠_JP", "小仓澪_JP", "温迪_JP", "净砚_JP", "洛伦佐_JP", "怀疑的患者_JP", "贾拉康_JP", "维卡斯_JP", "菲尔戈黛特_JP", "拉齐_JP", "斑目百兵卫_JP", "安武_JP", "消沉的患者_JP", "迈勒斯_JP", "娜比雅_JP", "申鹤_JP", "辛焱_JP", "神智昏乱的云骑_JP", "阿诺德_JP", "莱依拉_JP", "韦尔纳_JP", "镜流_JP", "丽莎_JP", "弗洛朗_JP", "管家奥斯威尔_JP", "斯科特_JP", "绍祖_JP", "捕头_JP", "巴蒂斯特_JP", "珊瑚_JP", "蒂玛乌斯_JP", "白术_JP", "丹羽_JP", "沙坎_JP", "皮特_JP", "木村_JP", "青雀_JP", "布尔米耶_JP", "筑梦师_JP", "维尔德_JP", "嘉明_JP", "丹恒_JP", "往昔的回声_JP", "格莉莎_JP", "杰娜姬_JP", "妮欧莎_JP", "藿藿_JP", "芷巧_JP", "浣溪_JP", "亚卡巴_JP", "老克_JP", "三田_JP", "胡桃_JP", "温和的声音_JP", "鹿野奈奈_JP", "唐娜_JP", "加福尔_JP", "三月七_JP", "福尔茨_JP", "阿利娅_JP", "卡西迪_JP", "荧_JP", "维利特_JP", "韵宁_JP", "法拉娜_JP", "萨姆_JP", "拉格沃克•夏尔•米哈伊尔_JP", "柊慎介_JP", "阿圆_JP", "卯师傅_JP", "阿蕾奇诺_JP", "稻城萤美_JP", "阿汉格尔_JP", "加萨尼_JP", "贝雅特丽奇_JP", "祖莉亚·德斯特雷_JP", "波提欧_JP", "艾莉丝_JP", "徐六石_JP", "卡莉露_JP", "埃尔欣根_JP", "旁白_JP", "史瓦罗_JP", "萨赫哈蒂_JP", "阿往_JP", "阿尼斯_JP", "伯恩哈德_JP", "白老先生_JP", "素裳_JP", "莱昂_JP", "尾巴_JP", "居勒什_JP", "一心传名刀_JP", "高善_JP", "拉赫曼_JP", "玛吉_JP", "卡玛尔_JP", "舍利夫_JP", "忠诚的侍从_JP", "旅行者_JP", "光之_JP", "纯也_JP", "苍老的声音_JP", "宵宫_JP", "马洛尼_JP", "派蒙_JP", "绿芙蓉_JP", "阿维丝_JP", "黑塔_JP", "西拉杰_JP", "岩夫_JP", "乔瓦尼_JP", "纪芳_JP", "达达利亚_JP", "宏达_JP", "手岛_JP", "天目十五_JP", "巴沙尔_JP", "小野寺_JP", "绮良良_JP", "刀疤刘_JP", "莫里斯_JP", "阿幸_JP", "男声_JP", "雪衣_JP", "重云_JP", "讨嫌的小孩_JP", "琳琅_JP", "星期日_JP", "戈尔代_JP", "长野原龙之介_JP", "玲可_JP", "嘉义_JP", "公主_JP", "梅里埃_JP", "北斗_JP", "伊莎朵_JP", "商人_JP", "阿巴图伊_JP", "钟离_JP", "大慈树王_JP", "菲米尼_JP", "艾文_JP", "副警长_JP", "铁尔南_JP", "珊瑚宫心海_JP", "纯水精灵_JP", "贝努瓦_JP", "萨福万_JP", "香菱_JP", "拍卖会工作人员_JP", "芙萝拉_JP", "玥辉_JP", "传次郎_JP", "杜拉夫_JP", "迈蒙_JP", "面具_JP", "加拉赫_JP", "艾尔海森_JP", "帕维耶_JP", "坎蒂丝_JP", "柯莱_JP", "慧心_JP", "智树_JP", "艾伦_JP", "阿拉夫_JP", "慈祥的女声_JP", "卡芙卡_JP", "石头_JP", "杰克_JP", "刃_JP", "伊迪娅_JP", "娜德瓦_JP", "斯万_JP", "卢卡奇_JP", "查宝_JP", "星稀_JP", "钟表匠_JP", "妮露_JP", "巴达维_JP", "观众_JP", "海芭夏_JP", "小川_JP", "魈_JP", "荒泷一斗_JP", "驭空_JP", "迪卢克_JP", "玛达赫_JP", "夏沃蕾_JP", "博士_JP", "暮夜剧团团长_JP", "斯薇塔_JP", "寒腿叔叔_JP", "星_JP", "帕姆_JP", "尤利安_JP", "警长_JP", "舒伯特_JP", "村田_JP", "绮珊_JP", "克拉拉_JP", "龙二_JP", "班尼特_JP", "夏洛蒂_JP", "瓦乐瑞娜_JP", "流萤_JP", "理查_JP", "奥列格_JP", "戴因斯雷布_JP", "枫原万叶_JP", "流浪者_JP", "加藤洋平_JP", "阿佩普_JP", "朱里厄_JP", "侯章_JP", "冥火大公_JP", "西衍先生_JP", "桑博_JP", "罗莎莉亚_JP", "阿鸠_JP", "昆钧_JP", "大肉丸_JP", "叶德_JP", "紫月季_JP", "大隆_JP", "德拉萝诗_JP", "琴_JP", "寒鸦_JP", "猎犬家系成员_JP", "埃泽_JP", "柴田_JP", "米卡_JP", "漱玉_JP", "诗筠_JP", "重佐_JP", "上杉_JP", "朱达尔_JP", "花角玉将_JP", "佩尔西科夫_JP", "叶卡捷琳娜_JP", "朔次郎_JP", "哈伦_JP", "里卡尔_JP", "杰洛尼_JP", "立本_JP", "玛乔丽_JP", "螺丝咕姆_JP", "巨大谜钟_JP", "考特里亚_JP", "安静的宾客_JP", "丹枢_JP", "梦主_JP", "阿来_JP", "拉伊德_JP", "镜中人_JP", "引导员_JP", "维多利亚_JP", "迪希雅_JP", "小组长_JP", "艾丝妲_JP", "笼钓瓶一心_JP", "托帕_JP", "梁沐_JP", "老孟_JP", "常九爷_JP", "独孤朔_JP", "彦卿_JP", "奥兹_JP", "迪尔菲_JP", "asideb_JP", "莱欧斯利_JP", "克列门特_JP", "枫_JP", "式大将_JP", "沙扎曼_JP", "薇娜_JP", "信使_JP", "阿山婆_JP", "歌蒂_JP", "帕梅拉_JP", "金人会长_JP", "茂才公_JP", "莱提西娅_JP", "虎克_JP", "砂金_JP", "安东尼娜_JP", "造物翻译官_JP", "瓦尔特_JP", "优菈_JP", "银狼_JP", "维尔芒_JP", "烟绯_JP", "魔女N_JP", "杰帕德_JP", "老章_JP", "蒂埃里_JP", "青镞_JP", "法哈德_JP", "砂糖_JP", "巴列维_JP", "长门幸子_JP", "石头老板_JP", "科玫_JP", "莫塞伊思_JP", "艾琳_JP", "黑天鹅_JP", "乌宰尔_JP", "菜菜子_JP", "艾丽_JP", "纳比尔_JP", "理水叠山真君_JP", "自称渊上之物_JP", "科拉莉_JP", "阿雩_JP", "托马_JP", "瑞安维尔_JP", "卢卡_JP", "黄泉_JP", "爱德华医生_JP", "珐露珊_JP", "古谷升_JP", "楚仪_JP", "八重神子_JP", "卡萝蕾_JP", "捕快_JP", "年幼的孩子_JP", "迪肯_JP", "掇星攫辰天君_JP", "博来_JP", "玛塞勒_JP", "空_JP", "裁判_JP", "嘉玛_JP", "独眼小僧_JP", "天叔_JP", "辛克尔_JP", "恶龙_JP", "凝光_JP", "神里绫人_JP", "鬼婆婆_JP", "伊德里西_JP", "布洛妮娅_JP", "shajinma_JP", "纳西妲_JP", "卡维_JP", "巴穆恩_JP", "莉莉安_JP", "钟表小子_JP", "嚣张的小孩_JP", "行秋_JP", "昆恩_JP", "米沙_JP", "翡翠_JP", "阿扎木_JP", "金忽律_JP", "黑田_JP", "斯嘉莉_JP", "被俘的信徒_JP", "费斯曼_JP", "奥泰巴_JP", "宁禄_JP", "阿洛瓦_JP", "薇若妮卡_JP", "新之丞_JP", "雷泽_JP", "博易_JP", "菲尔汀_JP", "诺艾尔_JP", "今谷三郎_JP", "信博_JP", "鹿野院平藏_JP", "知贵_JP", "界种科科员_JP", "悠策_JP", "厨子_JP", "大毫_JP", "乐平波琳_JP", "卡卡瓦夏的姐姐_JP", "神里绫华_JP", "凯瑟琳_JP", "马姆杜_JP", "商华_JP", "小贩_JP", "久岐忍_JP", "伊利亚斯_JP", "柊千里_JP", "泽田_JP", "雕像_JP", "巴尔塔萨_JP", "七叶寂照秘密主_JP", "浮游风蕈兽·元素生命_JP", "艾迪恩_JP", "安柏_JP", "芭芭拉_JP", "霄老大_JP", "西瓦尼_JP", "广大_JP", "连烟_JP", "冷漠的男性_JP", "百闻_JP", "焦躁的丹鼎司医士_JP", "九条裟罗_JP", "托帕&账账_JP", "知易_JP", "佩拉_JP", "阿基维利_JP", "莫娜_JP", "萨齐因_JP", "费索勒_JP", "刻晴_JP", "芙卡洛斯_JP", "伽吠毗陀_JP", "天真的少年_JP", "罗伊斯_JP", "今谷香里_JP", "松烟_JP", "北村_JP", "基娅拉_JP", "阿斯法德_JP", "羽生田千鹤_JP", "老高_JP", "库斯图_JP", "德田_JP", "竺子_JP", "早柚_JP", "银枝_JP", "霍夫曼_JP", "多莉_JP", "田铁嘴_JP", "云叔_JP", "乾玮_JP", "埃斯蒙德_JP", "宛烟_JP", "谢赫祖拜尔_JP", "艾薇拉_JP", "纪香_JP", "削月筑阳真君_JP", "舒翁_JP", "奇妙的船_JP", "埃洛伊_JP", "燕翠_JP", "一平_JP", "莎拉_JP", "耕一_JP", "岩明_JP", "齐米亚_JP", "伊洁贝儿_JP", "姬子_JP", "浮烟_JP", "夏妮_JP", "迪娜泽黛_JP", "赛诺_JP", "岚姐_JP", "平山_JP", "塞塔蕾_JP", "朋义_JP"]
export const speakers_EN = ["多莉_EN", "朋义_EN", "柊千里_EN", "西瓦尼_EN", "鹿野奈奈_EN", "萍姥姥_EN", "阿泰菲_EN", "古田_EN", "科林斯_EN", "凝光_EN", "贡达法_EN", "往昔的回声_EN", "悦_EN", "博来_EN", "拍卖师_EN", "言笑_EN", "小野寺_EN", "葛瑞丝_EN", "伊丝黛莱_EN", "沙扎曼_EN", "刻薄的小孩_EN", "维多利亚_EN", "浮游水蕈兽·元素生命_EN", "希露瓦_EN", "卡西迪_EN", "小川_EN", "贾拉康_EN", "男声_EN", "九条镰治_EN", "鲁哈维_EN", "宵宫_EN", "艾尔海森_EN", "伯恩哈德_EN", "菜菜子_EN", "螺丝咕姆_EN", "丹羽_EN", "安托万_EN", "拍卖会工作人员_EN", "薇若妮卡_EN", "博士_EN", "芭芭拉_EN", "魔女N_EN", "浮烟_EN", "莱斯格_EN", "帕梅拉_EN", "李丁_EN", "叶卡捷琳娜_EN", "史瓦罗_EN", "北斗_EN", "久岐忍_EN", "西衍先生_EN", "符玄_EN", "重佐_EN", "若心_EN", "塔杰·拉德卡尼_EN", "莎拉_EN", "伊利亚斯_EN", "阿贝多_EN", "流浪者_EN", "贝雅特丽奇_EN", "凯亚_EN", "辛克尔_EN", "艾米绮_EN", "卡莉露_EN", "蒂埃里_EN", "侯章_EN", "阿守_EN", "乔瓦尼_EN", "知更鸟_EN", "狐妖_EN", "雅各_EN", "漱玉_EN", "掘掘博士_EN", "金忽律_EN", "荒谷_EN", "昌虎_EN", "娜塔莎_EN", "黑天鹅_EN", "海妮耶_EN", "藿藿_EN", "青雀_EN", "砂糖_EN", "舍利夫_EN", "重云_EN", "阿夫辛_EN", "温迪_EN", "神智昏乱的云骑_EN", "可可利亚_EN", "麦希尔_EN", "舒伯特_EN", "斯嘉莉_EN", "维利特_EN", "守护者的意志_EN", "卯师傅_EN", "丹枢_EN", "稻城萤美_EN", "布洛妮娅_EN", "青镞_EN", "商华_EN", "立本_EN", "阿晃_EN", "伦纳德_EN", "严苛评委_EN", "帮派老大_EN", "花火_EN", "接笏_EN", "向导_EN", "奥列格_EN", "库斯图_EN", "库塞拉的信件_EN", "沃特林_EN", "卡波特_EN", "卡卡瓦夏_EN", "米凯_EN", "淮安_EN", "阿诺德_EN", "大和田_EN", "塔里克_EN", "莫娜_EN", "桑博_EN", "阿幸_EN", "黑田_EN", "玛乔丽_EN", "老高_EN", "公输师傅_EN", "克拉拉_EN", "九条裟罗_EN", "谢赫祖拜尔_EN", "梁沐_EN", "雷泽_EN", "霄老大_EN", "霍夫曼_EN", "塞德娜_EN", "塞塔蕾_EN", "乌维_EN", "钱德拉_EN", "行秋_EN", "久利须_EN", "幻胧_EN", "阿雩_EN", "绮良良_EN", "云堇_EN", "奇怪的云骑_EN", "大肉丸_EN", "查尔斯_EN", "博易_EN", "玛文_EN", "阿祇_EN", "纳比尔_EN", "会场广播_EN", "三月七_EN", "维卡斯_EN", "法赫尔_EN", "戴派_EN", "尚博迪克_EN", "吉莲_EN", "薇尔_EN", "阿基维利_EN", "优菈_EN", "商人_EN", "阿往_EN", "法伊兹_EN", "希格雯_EN", "元太_EN", "绮珊_EN", "金人会长_EN", "朱里厄_EN", "瑞安维尔_EN", "派蒙_EN", "沙寅_EN", "杜吉耶_EN", "引导员_EN", "劳伦斯_EN", "暮夜剧团团长_EN", "独孤朔_EN", "迪卢克_EN", "银枝_EN", "刻晴_EN", "智树_EN", "诗筠_EN", "掇星攫辰天君_EN", "宛烟_EN", "费斯曼_EN", "迪肯_EN", "乾玮_EN", "艾洛迪_EN", "忠诚的侍从_EN", "大慈树王_EN", "乌宰尔_EN", "库塞拉_EN", "垃垃撕圾_EN", "驭空_EN", "伽吠毗陀_EN", "岚姐_EN", "白露_EN", "穹_EN", "芙卡洛斯_EN", "真_EN", "波提欧_EN", "畅畅_EN", "荒泷一斗_EN", "嘉义_EN", "隐书_EN", "轰大叔_EN", "烟绯_EN", "科尔特_EN", "温和的声音_EN", "平山_EN", "菲尔戈黛特_EN", "黛比_EN", "安柏_EN", "科拉莉_EN", "晴霓_EN", "舒翁_EN", "埃舍尔_EN", "胡桃_EN", "药王秘传魁首_EN", "寒鸦_EN", "明曦_EN", "刃_EN", "长野原龙之介_EN", "安静的宾客_EN", "公主_EN", "卓也_EN", "巴达维_EN", "罗刹_EN", "帕斯卡_EN", "艾伯特_EN", "琳妮特_EN", "女声_EN", "萨齐因_EN", "雷电将军_EN", "素裳_EN", "德拉萝诗_EN", "深渊使徒_EN", "查宝_EN", "迪希雅_EN", "埃泽_EN", "捕头_EN", "造物翻译官_EN", "露子_EN", "爱德琳_EN", "木村_EN", "流萤_EN", "稻生_EN", "纳菲斯_EN", "迪尔菲_EN", "云叔_EN", "星稀_EN", "露尔薇_EN", "坎蒂丝_EN", "今谷佳祐_EN", "亚卡巴_EN", "甘雨_EN", "卡维_EN", "老章_EN", "嘉良_EN", "龙二_EN", "阿洛瓦_EN", "阿巴图伊_EN", "宁禄_EN", "浣溪_EN", "塞萨尔的日记_EN", "加拉赫_EN", "斯万_EN", "阿灼_EN", "白老先生_EN", "巴穆恩_EN", "独眼小僧_EN", "纯水精灵_EN", "绘星_EN", "老孟_EN", "迈蒙_EN", "阿娜耶_EN", "女士_EN", "米卡_EN", "嘉明_EN", "波洛_EN", "松浦_EN", "海芭夏_EN", "莱依拉_EN", "拉赫曼_EN", "凯西娅_EN", "阿芬迪_EN", "托帕&账账_EN", "昆钧_EN", "尾巴_EN", "翡翠_EN", "天目十五_EN", "猎犬家系成员_EN", "杜拉夫_EN", "莎塔娜_EN", "威严的男子_EN", "伊庭_EN", "菲约尔_EN", "卢卡_EN", "毗伽尔_EN", "琳琅_EN", "讨嫌的小孩_EN", "丹恒_EN", "天叔_EN", "祖莉亚·德斯特雷_EN", "早柚_EN", "七七_EN", "长生_EN", "田铁嘴_EN", "特纳_EN", "玻瑞亚斯_EN", "夏沃蕾_EN", "昆恩_EN", "提纳里_EN", "马洛尼_EN", "瓦尔特_EN", "茂才公_EN", "黑泽京之介_EN", "瑶瑶_EN", "埃洛伊_EN", "娜维娅_EN", "玥辉_EN", "半夏_EN", "考特里亚_EN", "夏妮_EN", "巴哈利_EN", "卡布斯_EN", "奇妙的船_EN", "艾莉丝_EN", "艾薇拉_EN", "回声海螺_EN", "燕翠_EN", "岩明_EN", "迪奥娜_EN", "安武_EN", "望雅_EN", "基娅拉_EN", "枫原万叶_EN", "纳西妲_EN", "裁判_EN", "哈伦_EN", "杰娜姬_EN", "慈祥的女声_EN", "琴_EN", "传次郎_EN", "闲云_EN", "小乐_EN", "嚣张的小孩_EN", "消沉的患者_EN", "洛伦佐_EN", "今谷香里_EN", "斯科特_EN", "梅里埃_EN", "丹吉尔_EN", "雕像_EN", "银杏_EN", "阿兰_EN", "钟离_EN", "星际和平播报_EN", "年长的患者_EN", "花角玉将_EN", "高善_EN", "今谷三郎_EN", "绿芙蓉_EN", "拉伊德_EN", "皮特_EN", "娜比雅_EN", "葵_EN", "冥火大公_EN", "芙宁娜_EN", "维尔德_EN", "九条孝行_EN", "鬼婆婆_EN", "shajinma_EN", "蒂玛乌斯_EN", "木木_EN", "留云借风真君_EN", "陆行岩本真蕈·元素生命_EN", "艾丝妲_EN", "玛塞勒_EN", "赛索斯_EN", "珐露珊_EN", "罗巧_EN", "有原则的猎犬家系成员_EN", "净砚_EN", "克洛琳德_EN", "黄泉_EN", "丹恒•饮月_EN", "空_EN", "阿鸠_EN", "宏达_EN", "克列门特_EN", "夏洛蒂_EN", "康纳_EN", "大辅_EN", "光之_EN", "克雷薇_EN", "徐六石_EN", "伊莎朵_EN", "加萨尼_EN", "安东尼娜_EN", "斯坦利_EN", "年幼的孩子_EN", "阿斯法德_EN", "泽田_EN", "加藤洋平_EN", "德田_EN", "舒蕾_EN", "佐西摩斯_EN", "薇娜_EN", "铁尔南_EN", "伊德里西_EN", "狼哥_EN", "马姆杜_EN", "朔次郎_EN", "景元_EN", "帕姆_EN", "神里绫人_EN", "神里绫华_EN", "迪娜泽黛_EN", "丝柯克_EN", "佩拉_EN", "玛达赫_EN", "法哈德_EN", "费索勒_EN", "理水叠山真君_EN", "加福尔_EN", "卡芙卡_EN", "霄翰_EN", "帕维耶_EN", "星期日_EN", "莱昂_EN", "诺艾尔_EN", "托克_EN", "桂乃芬_EN", "鹿野院平藏_EN", "那维莱特_EN", "瓦乐瑞娜_EN", "艾文_EN", "江蓠_EN", "巴列维_EN", "巴尔塔萨_EN", "托马_EN", "彦卿_EN", "银狼_EN", "沙坎_EN", "岩夫_EN", "维格尔_EN", "被俘的信徒_EN", "韦尔纳_EN", "欧菲妮_EN", "八重神子_EN", "耕一_EN", "班尼特_EN", "莫塞伊思_EN", "艾伦_EN", "恶龙_EN", "杰洛尼_EN", "绍祖_EN", "佩尔西科夫_EN", "阿来_EN", "古山_EN", "迈勒斯_EN", "小仓澪_EN", "一平_EN", "西拉杰_EN", "老芬奇_EN", "竺子_EN", "楚仪_EN", "肢体评委_EN", "劳维克_EN", "羽生田千鹤_EN", "申鹤_EN", "维多克_EN", "理查_EN", "阮•梅_EN", "asideb_EN", "慧心_EN", "钟表匠_EN", "埃德蒙多_EN", "凯瑟琳_EN", "荧_EN", "百闻_EN", "札齐_EN", "拉齐_EN", "莺儿_EN", "赛诺_EN", "五郎_EN", "福尔茨_EN", "巴蒂斯特_EN", "焦躁的丹鼎司医士_EN", "副警长_EN", "戴因斯雷布_EN", "可莉_EN", "石头_EN", "长门幸子_EN", "星_EN", "旁白_EN", "罗伊斯_EN", "削月筑阳真君_EN", "罗莎莉亚_EN", "阿圆_EN", "嘉玛_EN", "艾迪恩_EN", "娜德瓦_EN", "玛吉_EN", "玲可_EN", "苍老的声音_EN", "泽维尔_EN", "叶德_EN", "有乐斋_EN", "记忆中的声音_EN", "三田_EN", "弗洛朗_EN", "斯薇塔_EN", "顺吉_EN", "阿汉格尔_EN", "芙萝拉_EN", "埃勒曼_EN", "魈_EN", "七叶寂照秘密主_EN", "纯也_EN", "手岛_EN", "真理医生_EN", "发抖的流浪者_EN", "大隆_EN", "阿拉夫_EN", "齐米亚_EN", "居勒什_EN", "千织_EN", "德沃沙克_EN", "爱德华医生_EN", "紫月季_EN", "洛恩_EN", "北村_EN", "埃斯蒙德_EN", "杰帕德_EN", "捕快_EN", "托帕_EN", "小贩_EN", "梦主_EN", "贝努瓦_EN", "大毫_EN", "怀疑的患者_EN", "拉格沃克•夏尔•米哈伊尔_EN", "雪衣_EN", "菲米尼_EN", "剑阵中的声音_EN", "镜中人_EN", "黑塔_EN", "柯莱_EN", "辛焱_EN", "胡尚_EN", "里卡尔_EN", "巨大谜钟_EN", "厨子_EN", "乐平波琳_EN", "阿金_EN", "阿蕾奇诺_EN", "芷巧_EN", "钟表小子_EN", "阿扎木_EN", "白术_EN", "阿尔卡米_EN", "夜兰_EN", "知易_EN", "伊迪娅_EN", "塞琉斯_EN", "阿佩普_EN", "炒冷饭机器人_EN", "吴船长_EN", "珊瑚_EN", "旅行者_EN", "克罗索_EN", "停云_EN", "爱贝尔_EN", "界种科科员_EN", "台词评委_EN", "村田_EN", "希儿_EN", "珠函_EN", "阿旭_EN", "自称渊上之物_EN", "奥泰巴_EN", "一心传名刀_EN", "卡萝蕾_EN", "费迪南德_EN", "菲谢尔_EN", "香菱_EN", "林尼_EN", "伊萨克_EN", "法拉娜_EN", "百识_EN", "杰克_EN", "广大_EN", "柴田_EN", "老戴_EN", "米沙_EN", "警长_EN", "妮露_EN", "歌蒂_EN", "埃德_EN", "邓恩_EN", "埃尔欣根_EN", "维尔芒_EN", "安西_EN", "韵宁_EN", "萨姆_EN", "信使_EN", "远黛_EN", "信博_EN", "尤利安_EN", "连烟_EN", "阿尼斯_EN", "巫女_EN", "卡卡瓦夏的姐姐_EN", "常九爷_EN", "冷漠的男性_EN", "笼钓瓶一心_EN", "卡莉娜_EN", "面具_EN", "寒腿叔叔_EN", "冒失的帕拉德_EN", "丽莎_EN", "镜流_EN", "达达利亚_EN", "莱欧斯利_EN", "阿扎尔_EN", "哲平_EN", "筑梦师_EN", "刀疤刘_EN", "木南杏奈_EN", "莱提西娅_EN", "将司_EN", "恕筠_EN", "上杉_EN", "唐娜_EN", "玛格丽特_EN", "深渊法师_EN", "阿山婆_EN", "艾丽_EN", "阿伟_EN", "七尾_EN", "奥兹_EN", "新之丞_EN", "砂金_EN", "萨赫哈蒂_EN", "悠策_EN", "姬子_EN", "科玫_EN", "虎克_EN", "尤苏波夫_EN", "华劳斯_EN", "枫原景春_EN", "艾琳_EN", "式大将_EN", "珊瑚宫心海_EN"]
export const speakers_BA = ["白石歌原", "柚岛夏", "芹奈（圣诞）", "宇泽玲纱", "佐天泪子", "霞泽美游", "飞鸟马时", "下江小春", "连河切里诺", "冰室濑名", "优香（体操服）", "莲见（体操服）", "小鸟游星野", "勇美枫", "花冈柚子", "池仓玛丽娜", "狐坂若藻", "狮子堂泉", "乙花堇", "不破莲华", "扇喜葵", "丹花伊吹", "御坂美琴", "美甘尼禄", "春日椿", "朝比奈菲娜", "河和静子", "丰见小鸟", "桐生桔梗", "古关忧", "药子纱绫", "空崎日奈", "初音未来", "歌原（应援团）", "若叶日向", "大野月咏", "黑崎小雪", "白子（骑行）", "星野（泳装）", "梓（泳装）", "仲正一花", "鹫见芹奈", "锭前纱织", "和元泉艾米", "生盐诺亚", "银镜伊织", "守月铃美", "伊织（泳装）", "秤亚津子", "芹香（正月）", "食蜂操祈", "陸八魔阿露", "忧（泳装）", "朱城瑠美", "时（兔女郎）", "牛牧朱莉", "秋泉红叶", "千世（泳装）", "火宫千夏", "戒野美咲", "近卫南", "音濑小玉", "伊原木好美", "美游（泳装）", "桑上果穗", "咲（泳装）", "圆堂志美子", "小涂真纪", "左然", "枫香（正月）", "黑馆晴奈", "花凛（兔女郎）", "才羽绿", "猫塚响", "歌住樱子", "月雪宫子", "和香（温泉）", "剑先鹤城", "伊草遥香", "爱丽丝（女仆）", "明星日鞠", "陆景和", "浅黄睦月", "日奈（泳装）", "空井咲", "春原心奈", "鬼方佳代子", "赤司纯子", "佳代子（正月）", "小钩晴", "角楯花凛", "圣园未花", "姬木梅露", "静山真白", "鬼怒川霞", "砂狼白子", "羽川莲见", "一之濑明日奈", "理村爱理", "静子（泳装）", "明日奈（兔女郎）", "十六夜野宫", "夏彦", "睦月（正月）", "阿露（正月）", "桐藤渚", "佐城巴", "莫弈", "浦和花子", "阿慈谷日富美", "春原瞬", "枣伊吕波", "千鸟满", "安守实里", "日富美（泳装）", "水羽三森", "爱清枫香", "遥香（正月）", "鳄渊明里", "杏山和纱", "铜花瞬", "风仓萌绘", "黑见芹香", "伊落玛丽", "尼禄（兔女郎）", "合欢垣吹雪", "苍森美弥", "尾刃康娜", "才羽桃井", "早濑优香", "宫子（泳装）", "中务桐乃", "鹤城（泳装）", "柚子（女仆）", "天见和香", "白洲梓", "槌永日和", "各务千寻", "羽沼真琴", "若藻（泳装）", "天雨亚子", "下仓惠", "室笠朱音(茜)", "久田泉奈", "朝颜花江", "真白（泳装）", "泉奈（泳装）", "白子（泳装）", "间宵时雨", "天童爱丽丝", "勘解由小路紫", "响（应援团）", "奥空绫音"]
export const speakers = [...speakers_ZH, ...speakers_JP, ...speakers_EN, ...speakers_BA]
export const vits_emotion_map = ['1: Happy (开心)', '2: Sad (伤心)', '3: Excited (兴奋)', '4: Angry (生气)', '5: Bored (无聊)', '6: Nervous (紧张)', '7: Content (满足)', '8: Frustrated (沮丧)', '9: Worried (担心)', '10: Relaxed (轻松)', '11: Enthusiastic (热情)', '12: Joyful (快乐)', '13: Melancholic (忧郁)', '14: Surprised (惊讶)', '15: Grateful (感激)', '16: Optimistic (乐观)', '17: Anxious (焦虑)', '18: Amused (逗乐)', '19: Embarrassed (尴尬)', '20: Hopeful (希望)', '21: Guilty (内疚)', '22: Restless (不安)', '23: Curious (好奇)', '24: Disappointed (失望)', '25: Thrilled (激动)', '26: Contented (满意)', '27: Impatient (不耐烦)', '28: Lonely (孤独)', '29: Disgusted (厌恶)', '30: Jealous (嫉妒)', '31: Proud (骄傲)', '32: Surprised (惊讶)', '33: Delighted (高兴)', '34: Drained (疲惫)', '35: Ecstatic (狂喜)', '36: Fulfilled (满足)', '37: Giddy (眩晕)', '38: Heartbroken (心碎)', '39: Inspired (受启发)', '40: Irritated (恼怒)', '41: Motivated (有动力)', '42: Overwhelmed (不堪重负)', '43: Peaceful (宁静)', '44: Regretful (后悔)', '45: Sentimental (感伤)', '46: Sympathetic (同情)', '47: Tired (疲倦)', '48: Uncomfortable (不舒服)', '49: Worrisome (担忧)', '50: Zealous (热心)', '51: Blissful (幸福)', '52: Depressed (抑郁)', '53: Elated (兴高采烈)', '54: Grumpy (脾气暴躁)', '55: Hopeless (绝望)', '56: Intrigued (好奇)', '57: Playful (调皮)', '58: Reflective (反思)', '59: Satisfied (满意)', '60: Shy (害羞)', '61: Suspicious (怀疑)', '62: Ambitious (雄心勃勃)', '63: Grieving (悲伤)', '64: Frightened (害怕)', '65: Helpless (无助)', '66: Lively (活力)', '67: Envious (羡慕)', '68: Impressed (印象深刻)', '69: Irrational (不理智)', '70: Longing (渴望)', '71: Restless (不安)', '72: Silly (愚蠢)', '73: Stressed (紧张)', '74: Sensitive (敏感)', '75: Thoughtful (思考)', '76: Unsettled (不稳定)', '77: Weak (脆弱)', '78: Wistful (怀念)', '79: Zealot (狂热)', '80: Thankful (感谢)', '81: Resentful (愤怒)', '82: Pessimistic (悲观)', '83: Ashamed (羞愧)', '84: Irritable (易怒)', '85: Jealous (妒忌)', '86: Numb (麻木)', '87: Resigned (顺从)', '88: Relieved (宽慰)', '89: Sorrowful (悲哀)', '90: Enraged (愤怒)', '91: Awestruck (敬畏)', '92: Gracious (亲切)', '93: Discontent (不满)', '94: Confused (困惑)', '95: Excitable (易激动)', '96: Fulfilled (满足)', '97: Jovial (快活)', '98: Lethargic (想睡)', '99: Regretful (后悔)', '100: Sarcastic (讽刺)']
// export const vits_emotion_map = ['1: Happy (开心)', '2: Sad (伤心)', '3: Excited (兴奋)', '4: Angry (生气)', '5: Bored (困)', '6: Worried (担心)']

const sleep_zz = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

const newFetch = (url, options = {}) => {
    const defaultOptions = Config.proxy
        ? {
            agent: proxy(Config.proxy)
        }
        : {}

    const mergedOptions = {
        ...defaultOptions,
        ...options
    }

    return fetch(url, mergedOptions)
}

function randomNum(minNum, maxNum) {
    switch (arguments.length) {
        case 1:
            return parseInt(Math.random() * minNum + 1, 10)
        case 2:
            return parseInt(Math.random() * (maxNum - minNum + 1) + minNum, 10)
        default:
            return 0
    }
}

export async function generateVitsAudio(text, speaker = '随机', language = '中日混合（中文用[ZH][ZH]包裹起来，日文用[JA][JA]包裹起来）', noiseScale = parseFloat(Config.noiseScale), noiseScaleW = parseFloat(Config.noiseScaleW), lengthScale = parseFloat(Config.lengthScale)) {
    // if (lengthScale === 2.99) // genshinvoice.top/api已关闭,这一段已成为历史
    // {
    //     /*        let character_voice_language = speaker.substring(speaker.length - 2);
    //             let textfix = text.replace(/\#|(\[派蒙\])/g, '').replace(/派蒒/g, '派蒙').replace(/(\^([0-9])\^(.*|\n$))/g, '').replace(/\n(:|：).*|\n$/g, '').replace(/(\ud83c[\udf00-\udfff])|(\ud83d[\udc00-\ude4f\ude80-\udeff])|[\u2600-\u2B55]/g, '');
    //             //replace: 1.删除[派蒙] ; 2.替换派蒒 ; 3.删除bing ^1^开头的注释 ; 4.删除bing ":"开头的注释 ; 5.删除所有emoji
    //             let audioLink = `https://genshinvoice.top/api?speaker=${speaker}&text=${textfix}&format=wav&language=${character_voice_language}&length=1&sdp=0.4&noise=0.6&noisew=0.8`
    //     */
    //     return audioLink
    // }
    if (!speaker || speaker === '随机') {
        logger.info('[chatgpt-tts]随机角色！这次哪个角色这么幸运会被选到呢……')
        speaker = speakers[randomNum(0, speakers.length)]
    }

    // text = wrapTextByLanguage(text) //这函数用于<zh> or <jp>包裹句子，但v2.genshinvoice.top 现在支持"auto"了!!


    /*处理tts语音文本：*/
    let tts_First_person_zh_colon_reg = new RegExp(Config.tts_First_person + '：', 'g');  //7. 替换第一人称+'：'，例如可莉：

    text = text.replace(/\#|(\[..\])|(\[.\])/g, '').replace(/派蒒/g, '派蒙').replace(/\(?\^([0-9])\^\)?/g, '').replace(/\n(:|：).*|\n$/g, '').replace(/(\ud83c[\udf00-\udfff])|(\ud83d[\udc00-\ude4f\ude80-\udeff])|[\u2600-\u2B55]/g, '').replace(tts_First_person_zh_colon_reg, '').replace(/（..）/g, '').replace(/~/g, '，').replace(/，，，|，，|。。。/g, '。').replace(/，。|。。|。，/g, '。').replace(/(\[|【)好感度.*\d+(\]|】)/g, '')
    //replace: 1.删除[？？]和[？] ; 2.替换派蒒 ; 3.删除bing (^1^)的注释 ; 4.删除bing ":"开头的注释 ; 5.删除所有emoji  6. 替换第一人称+'：'，例如可莉：; 9. 替换（小声）; 10.~ 替换为 ，11.替换↓chat.js处理过的换行文本 12.处理多余的，。 13.适配删除中括号好感度
    //注意：chat.js传递过来转语音前已经做了'\n'转'，'的处理：ttsResponse = ttsResponse.replace(/[-:_；*;\n]/g, '，')  

    // #gpt翻日 硬编码替换部分角色名
    if (Config.autoJapanese)
        text = text.replace(/可莉|コリー|リディア|コクリ|ケリー|コーリー|コーリ|クリ/g, 'クレー').replace(/派蒙|モンゴル|派モン/g, 'パイモン').replace(/纳西妲|ナシの実|ナヒダ/g, 'ナヒーダ').replace(/早柚/g, 'さゆ').replace(/瑶瑶/g, 'ヨォーヨ').replace(/七七/g, 'なな').replace(/迪奥娜|ディオナ/g, 'ディオナ').replace(/绮良良|綺良良/g, 'きらら').replace(/希格雯/g, 'シグウィン').replace(/白露/g, 'ビャクロ').replace(/虎克|フック本/g, 'フック').replace(/心奈|こころ|しんな|心菜|ココロナ/g, 'ココナ').replace(/小春/g, 'コハル').replace(/星野/g, 'ホシノ').replace(/日富美/g, 'ヒフミ').replace(/梓/g, 'アズサ').replace(/日奈/g, 'ヒナ').replace(/纯子|純子/g, 'ジュンコ').replace(/睦月/g, 'ムツキ').replace(/优香|優香/g, 'ユウカ').replace(/爱丽丝/g, 'アリス').replace(/真纪|真紀/g, 'マキ').replace(/切里诺|チェリーノ/g, 'チェリノ').replace(/和香/g, 'ノドカ').replace(/小瞬/g, 'シュン').replace(/纱绫|紗綾/g, 'サヤ').replace(/美游|美遊/g, 'ミユ').replace(/桃井/g, 'モモイ').replace(/妃咲/g, 'キサキ').replace(/胡桃/g, 'クルミ').replace(/阿罗娜|アローナ/g, 'アロナ').replace(/普拉娜/g, 'プラナ')

    // tts情感自动设置
    let vits_emotion = Config.vits_emotion
    if (Config.vits_auto_emotion) {
        vits_emotion = get_tts_Emotion(text)
        logger.mark(`[chatgpt-tts]tts使用情感：${vits_emotion}`)
    }

    // 校正api地址
    let space = Config.ttsSpace
    //校正为 https://bv2.firefly.matce.cn
    if (space.endsWith('/run/predict')) {
        let trimmedSpace = space.substring(0, space.length - 12)
        logger.warn(`[chatgpt-tts]vits api 当前为${space}，已校正为${trimmedSpace}`)
        space = trimmedSpace
    }
    if (space.endsWith('/')) {
        let trimmedSpace = _.trimEnd(space, '/')
        logger.warn(`[chatgpt-tts]vits api 当前为${space}，已校正为${trimmedSpace}`)
        space = trimmedSpace
    }

    // wss连接Fish-Vits站点
    if (space == 'https://fs.firefly.matce.cn') {
        text = text.substr(0, 299);
        logger.info(`[chatgpt-tts]使用Fish-Vits生成语音，角色：${speaker}，文本：\n${text}`)
        let voiceUrl
        let err_msg = ''
        for (let i = 0; i < 3; i++) {
            try {
                voiceUrl = await connectToWss({ speaker: speaker, text: text, config_referenceAudioPath: Config.exampleAudio, wsTimeout: 60 * (i + 1) });
            } catch (error) {
                if (Config.debug)
                    logger.error(`[chatgpt-tts]共${i + 1}次尝试连接到Fish-Vits语音合成失败：${error.message}`)
                if (i == 2)
                    err_msg = `[chatgpt-tts]共${i + 1}次尝试连接到Fish-Vits语音合成失败`
            }
            if (voiceUrl) break;
        }
        if (!voiceUrl) throw { message: err_msg }
        return voiceUrl
    }

    // post连接Bert-Vits站点
    let sdp_ratio = parseFloat(Config.sdp_ratio), tts_language = Config.tts_language, style_text = Config.style_text, style_text_weights = parseFloat(Config.style_text_weights), tts_slice_is_slice_generation = Config.tts_slice_is_slice_generation, tts_slice_is_Split_by_sentence = Config.tts_slice_is_Split_by_sentence, tts_slice_pause_between_paragraphs_seconds = parseFloat(Config.tts_slice_pause_between_paragraphs_seconds), tts_slice_pause_between_sentences_seconds = parseFloat(Config.tts_slice_pause_between_sentences_seconds)

    let url = `${space}/run/predict`
    /* 真的需要反代的话这一行需要修改
      if (Config.huggingFaceReverseProxy) {
        url = `${Config.huggingFaceReverseProxy}/api/generate?space=${_.trimStart(space, 'https://')}`
      }
    */

    // 如果 speaker 在数组 speakers_JP 中
    if (speakers_JP.includes(speaker) || speakers_BA.includes(speaker)) {
        // 自动切换网址
        if (space == "https://bv2.firefly.matce.cn") space = "https://ba.firefly.matce.cn"
        if (url == "https://bv2.firefly.matce.cn/run/predict") url = "https://ba.firefly.matce.cn/run/predict"
        tts_language = "JP"

        // 使用网址的自动转日语，若#tts语音转日语关闭 （推荐关闭，除非网址api翻译出错）则自动使用网址api的转日语功能，若#tts语音转日语开启 则使用本插件内置的#gpt翻日 功能
        if (!Config.autoJapanese) {
            if (Config.debug)
                logger.info(`[chatgpt-tts]正在使用网页api转日语，基于文本：'${text}'`)
            let body_translation = {
                data: [
                    text
                ],
                event_data: null,
                fn_index: 1,
                session_hash: ""
            }
            if (Config.debug) {
                logger.info(body_translation)
            }
            let json, response
            for (let post_times = 1; post_times <= 5; post_times++) {
                try {
                    logger.info(`[chatgpt-tts]正在第${post_times}次使用接口转日语${url}`)
                    response = await newFetch(url, {
                        method: 'POST',
                        body: JSON.stringify(body_translation),
                        headers: {
                            'content-type': 'application/json'
                        }
                    })
                    let responseBody = await response.text()
                    json = JSON.parse(responseBody)
                    if (Config.debug) {
                        logger.info(json)
                    }
                    if (response.status > 299) {
                        logger.info(json)
                        throw new Error(JSON.stringify(json))
                    }
                    let [message] = json?.data

                    if (!message) throw new Error('[chatgpt-tts]api转日语错误', responseBody)
                    else logger.mark(`[chatgpt-tts]成功获取网页api转日语文本：${message}`)

                    // 硬编码替换部分角色名
                    message = message.replace(/可莉|コリー/g, 'クレー').replace(/派蒙|モンゴル/g, 'パイモン').replace(/纳西妲|ナシの実/g, 'ナヒーダ').replace(/早柚/g, 'さゆ').replace(/瑶瑶/g, 'ヨォーヨ').replace(/七七/g, 'なな').replace(/迪奥娜|ディオナ/g, 'ディオナ').replace(/绮良良|綺良良/g, 'きらら').replace(/希格雯/g, 'シグウィン').replace(/白露/g, 'ビャクロ').replace(/虎克|フック本/g, 'フック').replace(/心奈/g, 'ココナ').replace(/小春/g, 'コハル').replace(/星野/g, 'ホシノ').replace(/日富美/g, 'ヒフミ').replace(/梓/g, 'アズサ').replace(/日奈/g, 'ヒナ').replace(/纯子|純子/g, 'ジュンコ').replace(/睦月/g, 'ムツキ').replace(/优香|優香/g, 'ユウカ').replace(/爱丽丝/g, 'アリス').replace(/真纪|真紀/g, 'マキ').replace(/切里诺|チェリーノ/g, 'チェリノ').replace(/和香/g, 'ノドカ').replace(/小瞬/g, 'シュン').replace(/纱绫|紗綾/g, 'サヤ').replace(/美游|美遊/g, 'ミユ').replace(/桃井/g, 'モモイ').replace(/妃咲/g, 'キサキ').replace(/胡桃/g, 'クルミ').replace(/阿罗娜|アローナ/g, 'アロナ').replace(/普拉娜/g, 'プラナ')
                    text = message
                    break
                } catch (err) {
                    logger.error(`[chatgpt-tts]转日语For循环中发生错误，请检查是否配置了正确的api。当前为第${post_times}次。当前语音api status为`, response.status, '错误：', err)
                    if (post_times == 5) throw new Error('[chatgpt-tts]网址api转日语错误，建议使用#tts转日语开启\nresponseBody:', json)
                    // 等待5000ms
                    await sleep_zz(5000)
                }
            }
        }
    }
    // 如果 speaker 在数组 speakers_ZH 中
    if (speakers_ZH.includes(speaker)) {
        // 则使用中文
        if (space == "https://ba.firefly.matce.cn") space = "https://bv2.firefly.matce.cn"
        if (url == "https://ba.firefly.matce.cn/run/predict") url = "https://bv2.firefly.matce.cn/run/predict"
        tts_language = "ZH"
    }

    logger.info(`[chatgpt-tts]正在使用${speaker}，基于文本：'${text}'生成语音`)

    // exampleAudio暂时无法使用
    let exampleAudio = null

    let body
    // API更新了，目前只支持切片生成
    tts_slice_is_slice_generation = true
    if (!tts_slice_is_slice_generation) {
        // 最大300字，截取处理后的前299个字符
        text = text.substr(0, 299);
        body = {
            data: [
                text, speaker, sdp_ratio, noiseScale, noiseScaleW, lengthScale,
                tts_language, exampleAudio, vits_emotion, "Text prompt", style_text, style_text_weights
            ],
            event_data: null,
            fn_index: 0,
            session_hash: ""
        }
        /* 普通生成body参考：
        {
            "data": [
                "派蒙知道哦",
                "派蒙_ZH",
                0.2,
                0.6,
                0.8,
                1,
                "ZH",  //tts_language
                null,  //exampleAudio
                "Happy",
                "Text prompt",  //切片生成没有这一行
                "",
                0.7
            ],
                "event_data": null,
                    "fn_index": 0,  //切片生成这个不同
        } */
    } else {
        // 2024年4月12日 切片生成 最大也被限定在300字，截取处理后的前299个字符
        text = text.substr(0, 299);
        body = {
            data: [
                text, speaker, sdp_ratio, noiseScale, noiseScaleW, lengthScale,
                tts_language, tts_slice_is_Split_by_sentence, tts_slice_pause_between_paragraphs_seconds, tts_slice_pause_between_sentences_seconds,
                exampleAudio, vits_emotion, style_text, style_text_weights
            ],
            event_data: null,
            fn_index: 0,
            session_hash: ""
        }
        /* 切片生成body参考：
        {
            "data": [
                "派蒙知道哦",
                "派蒙_ZH",
                0.2,
                0.6,
                0.8,
                1,
                "ZH",  //tts_language
                false,  //按句切分
                0.6,  //段间停顿
                0.2,  //句间停顿
                null,  //exampleAudio
                "Happy",
                "",
                0.7
            ],
                "event_data": null,
                    "fn_index": 0
        } */
    }


    // tts_post
    if (Config.debug) {
        logger.info(body)
    }
    let json, response
    for (let post_times = 1; post_times <= 5; post_times++) {
        try {
            logger.info(`[chatgpt-tts]正在第${post_times}次使用接口${url}`)
            response = await newFetch(url, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: {
                    'content-type': 'application/json'
                }
            })
            let responseBody = await response.text()
            json = JSON.parse(responseBody)
            if (Config.debug) {
                logger.info(json)
            }
            if (response.status > 299) {
                logger.info(json)
                throw new Error(JSON.stringify(json))
            }
            let [message, audioInfo] = json?.data
            logger.info(`[chatgpt-tts]api生成信息：`, message)

            /*这api怎么天天换参数呢*/
            let audioLink
            for (let read_audioInfo in audioInfo) {
                if (/.*(\/|\\).*(\/|\\).*\.(wav|mp3)$/.test(audioInfo[read_audioInfo])) {
                    audioLink = `${space}/file=${audioInfo[read_audioInfo]}`
                    break
                }
            }
            if (!audioLink) throw new Error('[chatgpt-tts]未匹配到音频链接', json)
            else logger.mark(`[chatgpt-tts]成功获取音频地址${audioLink}`)

            /*let audioLink = `${space}/file=${audioInfo.path}`*/

            /* 真的需要反代的话这一行需要修改
                if (Config.huggingFaceReverseProxy) {
                  if (Config.debug) {
                    logger.info('使用huggingface加速反代下载生成音频' + Config.huggingFaceReverseProxy)
                  }
                  let spaceHost = _.trimStart(space, 'https://')
                  audioLink = `${Config.huggingFaceReverseProxy}/file=${audioInfo.name}?space=${spaceHost}`
                }
            */
            return audioLink
        } catch (err) {
            logger.error(`[chatgpt-tts]生成语音api发生错误，请检查是否配置了正确的api。当前为第${post_times}次。当前语音api status为`, response.status, '错误：', err)
            // 等待5000ms
            await sleep_zz(5000)
        }
    }
    logger.error(body)
    throw new Error('[chatgpt-tts]responseBody:', json)

}

export function convertSpeaker(speaker) {
    switch (speaker) {
        case '派蒙':
        case '小派蒙': return '派蒙_ZH'
        case '纳西妲': return '纳西妲_ZH'
        case '可莉': return '可莉_ZH'
        case '早柚': return '早柚_ZH'
        case '迪奥娜': return '迪奥娜_ZH'
        case '瑶瑶': return '瑶瑶_ZH'
        case '七七': return '七七_ZH'
        case '希格雯': return '希格雯_ZH'
        case '神里绫华': return '神里绫华_ZH'
        case '胡桃': return '胡桃_ZH'
        case '雷电将军': return '雷电将军_ZH'
        case '芙宁娜': return '芙宁娜_ZH'
        case '绮良良': return '绮良良_ZH'
        case '刻晴': return '刻晴_ZH'
        case '珊瑚宫心海': return '珊瑚宫心海_ZH'
        case '迪卢克': return '迪卢克_ZH'
        case '心奈': return '春原心奈'
        case '小春': return '下江小春'
        case '星野': return '小鸟游星野'
    }
    // "天见和香", "黑崎小雪", "黑见芹香", "槌永日和", "爱丽丝", "鹫见芹奈", "连河切里诺", "浅黄睦月", "天童爱丽丝", "下江小春", "小鸟游星野", 

    return speaker
}

/**输入文本，匹配tts情感中的100种情感(例如派蒙生气地说道)，返回开头大写的情感单词，无匹配则使用[0]Happy，支持中英文。 */
function get_tts_Emotion(chat_str) {
    /**提取vits_emotion_map中的括号内的感情词，放在数组emotion_language_map中； */
    let emotion_language_map
    if (Config.tts_language == 'EN') {
        chat_str = chat_str.toLowerCase()
        const regex_emotion_map = /\b\w+\b\s*\(/g;
        emotion_language_map = vits_emotion_map.map(item => {
            const match = item.match(regex_emotion_map);
            return match ? match[0].replace(/\(|\)|\s/g, '').toLowerCase() : '';
        });
    } else {
        const regex_emotion_map = /\((.*?)\)/g;
        emotion_language_map = vits_emotion_map.map(item => {
            const match = item.match(regex_emotion_map);
            return match ? match[0].replace(/\(|\)/g, '') : '';
        });
    }

    /**根据emotion_language_map遍历对话字符串，返回对应的emotion_language_map编号 */
    let target_num = 0
    for (let i = 0; i < emotion_language_map.length; i++) {
        let emotion_targe = emotion_language_map[i]

        const index_emotion = chat_str.indexOf(emotion_targe);
        if (index_emotion !== -1) {
            target_num = i;
            break;
        }
    }

    /**根据vits_emotion_map[target_num]返回tts情感值（开头为大写的英文单词） */
    let auto_vits_emotion = vits_emotion_map[target_num].replace(/(\s+)|([(].*[)])/g, "").replace(/:|([0-9]*)/g, '')
    return auto_vits_emotion
}

/**wss连接 */
async function connectToWss(result = {}) {
    let lock = true
    let fn_index = 1
    let wss = 'wss://fs.firefly.matce.cn/queue/join'
    let session_hash = ""
    let socket_trunk = {}
    let get_error

    if (result.config_referenceAudioPath) {
        fn_index = 3
        // 第一次连接--------------------------------------
        const socket_3_1 = new WebSocket(wss);
        socket_trunk.socket_3_1 = socket_3_1

        socket_3_1.addEventListener('open', function (event) {
            if (Config.debug)
                console.log('[chatgpt-tts]1st Connected to wss server');
        });
        socket_3_1.addEventListener('error', function (event) {
            if (Config.debug)
                console.error('[chatgpt-tts]1st Error occurred:', event);
            // 处理连接错误
            lock = false
            get_error = { message: "[chatgpt-tts]第一次连接到wss失败" }
        });

        socket_3_1.addEventListener('message', function (event) {
            if (Config.debug)
                console.log('[chatgpt-tts]1st Message from server:', event.data);
            // 当从服务器接收到消息时，可以在此处处理它
            const data = JSON.parse(event.data);

            let send_hash = { "fn_index": fn_index, "session_hash": session_hash }
            let send_data = { "data": [result.config_referenceAudioPath], "event_data": null, "fn_index": fn_index, "session_hash": session_hash }

            if (data.msg == "send_hash") {
                socket_3_1.send(JSON.stringify(send_hash));
                if (Config.debug)
                    console.log('[chatgpt-tts]Send Message to server:', send_hash);
            }
            else if (data.msg == "send_data") {
                socket_3_1.send(JSON.stringify(send_data));
                if (Config.debug)
                    console.log('[chatgpt-tts]Send Message to server:', send_data);
            }
            else if (data.msg == "process_completed") {
                // 获取结果
                if (Config.debug)
                    console.log(data.output)
                result = { ...result, referenceAudioPath: data.output.data[0].name, sft_name: data.output.data[1], referenceAudioOrig_name: "audio.wav" }
            }
        });

        socket_3_1.addEventListener('close', function (event) {
            if (Config.debug)
                console.log('[chatgpt-tts]1st Connection to wss server closed');

            // 第二次连接--------------------------------------
            fn_index = 4
            const socket_3_2 = new WebSocket(wss);
            socket_trunk.socket_3_2 = socket_3_2

            socket_3_2.addEventListener('open', function (event) {
                if (Config.debug)
                    console.log('[chatgpt-tts]3rd Connected to wss server');
            });
            socket_3_2.addEventListener('error', function (event) {
                if (Config.debug)
                    console.error('[chatgpt-tts]3rd Error occurred:', event);
                // 处理连接错误
                lock = false
                get_error = { message: "[chatgpt-tts]第2次-有参考音频-连接到wss失败" }
            });

            socket_3_2.addEventListener('message', function (event) {
                if (Config.debug)
                    console.log('[chatgpt-tts]3rd Message from server:', event.data);
                // 当从服务器接收到消息时，可以在此处处理它
                const data = JSON.parse(event.data);

                let send_hash = { "fn_index": fn_index, "session_hash": session_hash }
                let send_data = { "data": [result.text, true, { "name": result.referenceAudioPath, "data": `https://fs.firefly.matce.cn/file=${result.referenceAudioPath}`, "is_file": true, "orig_name": result.referenceAudioOrig_name }, result.sft_name, parseFloat(Config.Fish_Maximum_tokens_per_batch), parseFloat(Config.Fish_Iterative_Prompt_Length), parseFloat(Config.Fish_Top_P), parseFloat(Config.Fish_Repetition_Penalty), parseFloat(Config.Fish_Temperature), result.speaker], "event_data": null, "fn_index": fn_index, "session_hash": session_hash }

                if (data.msg == "send_hash") {
                    socket_3_2.send(JSON.stringify(send_hash));
                    if (Config.debug)
                        console.log('[chatgpt-tts]Send Message to server:', send_hash);
                }
                else if (data.msg == "send_data") {
                    socket_3_2.send(JSON.stringify(send_data));
                    if (Config.debug)
                        console.log('[chatgpt-tts]Send Message to server:', send_data);
                }
                else if (data.msg == "process_completed") {
                    // 获取结果
                    if (Config.debug)
                        console.log(data.output)
                    result = { ...result, voiceUrl: `https://fs.firefly.matce.cn/file=${data.output.data[0].name}` }
                    lock = false
                }
            });

            socket_3_2.addEventListener('close', function (event) {
                if (Config.debug)
                    console.log('[chatgpt-tts]3rd Connection to wss server closed');
                lock = false
            });
        });
    }
    else {
        // 第一次连接--------------------------------------
        const socket_1 = new WebSocket(wss);
        socket_trunk.socket_1 = socket_1

        socket_1.addEventListener('open', function (event) {
            if (Config.debug)
                console.log('[chatgpt-tts]1st Connected to wss server');
        });
        socket_1.addEventListener('error', function (event) {
            if (Config.debug)
                console.error('[chatgpt-tts]1st Error occurred:', event);
            // 处理连接错误
            lock = false
            get_error = { message: "[chatgpt-tts]第一次连接到wss失败" }
        });

        socket_1.addEventListener('message', function (event) {
            if (Config.debug)
                console.log('[chatgpt-tts]1st Message from server:', event.data);
            // 当从服务器接收到消息时，可以在此处处理它
            const data = JSON.parse(event.data);

            let send_hash = { "fn_index": fn_index, "session_hash": session_hash }
            let send_data = { "data": [result.speaker], "event_data": null, "fn_index": fn_index, "session_hash": session_hash }

            if (data.msg == "send_hash") {
                socket_1.send(JSON.stringify(send_hash));
                if (Config.debug)
                    console.log('[chatgpt-tts]Send Message to server:', send_hash);
            }
            else if (data.msg == "send_data") {
                socket_1.send(JSON.stringify(send_data));
                if (Config.debug)
                    console.log('[chatgpt-tts]Send Message to server:', send_data);
            }
            else if (data.msg == "process_completed") {
                // 获取结果
                if (Config.debug)
                    console.log(data.output)
                result = { ...result, sft_path: data.output.data[0], sft_name: data.output.data[1] }
            }
        });

        socket_1.addEventListener('close', function (event) {
            if (Config.debug)
                console.log('[chatgpt-tts]1st Connection to wss server closed');

            // 第二次连接--------------------------------------
            fn_index = 2
            const socket_2 = new WebSocket(wss);
            socket_trunk.socket_2 = socket_2

            socket_2.addEventListener('open', function (event) {
                if (Config.debug)
                    console.log('[chatgpt-tts]2nd Connected to wss server');
            });
            socket_2.addEventListener('error', function (event) {
                if (Config.debug)
                    console.error('[chatgpt-tts]2nd Error occurred:', event);
                // 处理连接错误
                lock = false
                get_error = { message: "[chatgpt-tts]第二次连接到wss失败" }
            });

            socket_2.addEventListener('message', function (event) {
                if (Config.debug)
                    console.log('[chatgpt-tts]2nd Message from server:', event.data);
                // 当从服务器接收到消息时，可以在此处处理它
                const data = JSON.parse(event.data);

                let send_hash = { "fn_index": fn_index, "session_hash": session_hash }
                let send_data = { "data": [result.sft_path], "event_data": null, "fn_index": fn_index, "session_hash": session_hash }

                if (data.msg == "send_hash") {
                    socket_2.send(JSON.stringify(send_hash));
                    if (Config.debug)
                        console.log('[chatgpt-tts]Send Message to server:', send_hash);
                }
                else if (data.msg == "send_data") {
                    socket_2.send(JSON.stringify(send_data));
                    if (Config.debug)
                        console.log('[chatgpt-tts]Send Message to server:', send_data);
                }
                else if (data.msg == "process_completed") {
                    // 获取结果
                    if (Config.debug)
                        console.log(data.output)
                    result = { ...result, referenceAudioPath: data.output.data[0].name, referenceAudioOrig_name: data.output.data[0].orig_name }
                }
            });

            socket_2.addEventListener('close', function (event) {
                if (Config.debug)
                    console.log('[chatgpt-tts]2nd Connection to wss server closed');
                // 第三次连接--------------------------------------
                fn_index = 4
                const socket_3 = new WebSocket(wss);
                socket_trunk.socket_3 = socket_3

                socket_3.addEventListener('open', function (event) {
                    if (Config.debug)
                        console.log('[chatgpt-tts]3rd Connected to wss server');
                });
                socket_3.addEventListener('error', function (event) {
                    if (Config.debug)
                        console.error('[chatgpt-tts]3rd Error occurred:', event);
                    // 处理连接错误
                    lock = false
                    get_error = { message: "[chatgpt-tts]第三次连接到wss失败" }
                });

                socket_3.addEventListener('message', function (event) {
                    if (Config.debug)
                        console.log('[chatgpt-tts]3rd Message from server:', event.data);
                    // 当从服务器接收到消息时，可以在此处处理它
                    const data = JSON.parse(event.data);

                    let send_hash = { "fn_index": fn_index, "session_hash": session_hash }
                    let send_data = { "data": [result.text, true, { "name": result.referenceAudioPath, "data": `https://fs.firefly.matce.cn/file=${result.referenceAudioPath}`, "is_file": true, "orig_name": result.referenceAudioOrig_name }, result.sft_name, parseFloat(Config.Fish_Maximum_tokens_per_batch), parseFloat(Config.Fish_Iterative_Prompt_Length), parseFloat(Config.Fish_Top_P), parseFloat(Config.Fish_Repetition_Penalty), parseFloat(Config.Fish_Temperature), result.speaker], "event_data": null, "fn_index": fn_index, "session_hash": session_hash }

                    if (data.msg == "send_hash") {
                        socket_3.send(JSON.stringify(send_hash));
                        if (Config.debug)
                            console.log('[chatgpt-tts]Send Message to server:', send_hash);
                    }
                    else if (data.msg == "send_data") {
                        socket_3.send(JSON.stringify(send_data));
                        if (Config.debug)
                            console.log('[chatgpt-tts]Send Message to server:', send_data);
                    }
                    else if (data.msg == "process_completed") {
                        // 获取结果
                        if (Config.debug)
                            console.log(data.output)
                        if (!data.output?.data || !data.output.data[0]?.name)
                            get_error = { message: "[chatgpt-tts]Fish-TTS语音合成api返回Error，合成失败" }
                        else
                            result = { ...result, voiceUrl: `https://fs.firefly.matce.cn/file=${data.output.data[0].name}` }
                        lock = false
                    }
                });

                socket_3.addEventListener('close', function (event) {
                    if (Config.debug)
                        console.log('[chatgpt-tts]3rd Connection to wss server closed');
                    lock = false
                });
            });
        });
    }
    for (let i = 0; i < result.wsTimeout; i++) { // 等待时间
        if (lock == false) break;
        await sleep_pai(1000)
    }
    // 关闭连接
    // socket.close();
    // 获取对象的socket_trunk中的全部对象，执行关闭连接操作
    for (let i = 0; i < Object.keys(socket_trunk).length; i++) {
        socket_trunk[Object.keys(socket_trunk)[i]].close();
    }
    if (!result.voiceUrl)
        if (get_error)
            throw get_error
        else
            throw { message: "[chatgpt-tts]Fish-TTS语音合成等待超时" };

    return result.voiceUrl
}

/**推荐
 * 可莉也很爱你
 * sft_new/Genshin_ZH/可莉/44c561ccd517f0c0.wav_part69
 */