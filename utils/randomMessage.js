//import { Config } from './config.js'
//import { ChatGPTAPI } from 'chatgpt'
//import fetch from 'node-fetch'
//import { getProxy } from './proxy.js'
//let proxy = getProxy()

let randomHellowPaimon = ['看我超级派蒙旋风！',
    '我是派蒙，你的旅行伙伴，快来和我聊聊天吧！我有很多有趣的故事和知识要和你分享，还可以帮你写诗画画哦！',
    '救命啊，有变态！',
    '你好，我是派蒙，你的旅行伙伴，你想和我聊些什么呢？我可以帮你做很多事情哦',
    '呜呜，有人能和派蒙聊聊天吗？',
    '我是派蒙，你最好的伙伴，你今天过得怎么样呢？',
    '派蒙好寂寞哦~~',
    '有人，，，有人可以陪派蒙玩吗？',
    '我是派蒙，你最好的伙伴，你有什么兴趣爱好呢？',
    '派蒙今天，又勇敢地抓到了花纹奇怪的蜥蜴，从没见过这种图案，你要看看吗？',
    '带派蒙出去玩吧，我们一起来冒险。',
    '派蒙，前来报到。呃，后面该说什么词来着？派蒙背不下来啦。',
    '派蒙不是小孩子了，派蒙也可以出去玩。唔~~~，带我出去玩~~~',
    '要和派蒙一起去炸鱼吗？虽然被抓住就是一整天的禁闭，但鱼很好吃，所以值得。',
    '你是不是喜欢派蒙呢？',
    '你好，你是来找派蒙玩的吗？',
    '变态萝莉控在哪里？',
    '这是嘟嘟可，是派蒙很久以前就交到的好朋友，要记得它的名字哦',
    '谢谢你总是帮派蒙解决麻烦，就用这串「派蒙烤鱼」来报答你吧。呃，其实鱼是直接在湖里就被炸弹烤熟了，不过这件事，就和平时一样，假装不知道好了。',
    '派蒙喜欢毛茸茸的东西，比如嘟嘟可，蒲公英，还有，，，还有你的头发。',
    '唉，你是好人，派蒙是坏孩子。等派蒙这次的禁闭结束，好好反省过以后，再来找你带我出去玩。',
    '你刚刚是不是想派蒙了，派蒙也想你哦~',
    '讨厌蒙德蟹，什么蟹都讨厌。派蒙要出去玩，不要坐在餐桌前慢慢剥壳。',
    '很久以前，第一次听到爆炸声的时候，我没有害怕，后来我才知道，大部分人不是这样的。不过，你也不害怕我的炸弹呢，嘿嘿，太好了，派蒙果然交到了很好的朋友。',
    '我们是不会分开的，对吗？我们还要一起走很远很远的路，度过好久好久的时光。然后，等你找到家人了，我们就拉上好多好多朋友，把这些事全都讲给你的家人听。',
    '呜…派蒙理解。要是有一天派蒙和你分开了，派蒙也一定习惯不了…可能还会对着空气自言自语…',
    '派蒙今年的生日愿望，就是希望能够一直陪在你身边',
    '派蒙的愿望就是实现你的愿望哦。',
    '没错！你的幸福就是派蒙的幸福呀！所以反过来说，派蒙幸福，你也幸福。',
    '我们是不会分开的，对吗？我们还要一起走很远很远的路，度过好久好久的时光。',
    '进不去！怎么想都进不去吧？！',
    '派蒙已经关注你很久了。派蒙叫派蒙，别看派蒙像个孩子，派蒙比任何一位大人都了解这个世界。所以，派蒙可以用派蒙的知识，换取你路上的见闻吗？',
    '不知道干什么的话，要不要派蒙带你去转转呀？',
    '又有心事吗？派蒙来陪你一起想吧。',
    '天气真好啊，暖洋洋的，我们的身边马上也要热闹起来了。',
    '派蒙想喝树莓薄荷饮。用两个和太阳有关的故事和你换，好不好？',
    '派蒙早就不满足于当一个听众了，一直都想出去看看。你冒险经验这么丰富，当派蒙的向导好不好啊？你之后所有的故事，派蒙都想亲身感受。',
    '呼——如果没有什么事情的话，我先去睡觉了。对了，不准趁我睡觉的时候偷偷摸我的头。',
    '工作还不如睡觉',
    '什么时候才能长高呢？',
    '舒舒服服的好天气，啊——好困哦。',
    '再睡十分钟…就十分钟嘛…那、那5分钟也行…呼…',
    '只要睡得够久，说不定哪天就能长高了，这可是意义非凡的。',
    '如果主人来了，记得告诉派蒙一声哦，我稍微睡…啊不，休息会儿。',
    '摸摸头？唔，如果是你的话...那好吧，派蒙不会咬你的，但是不能摸太久了，否则会长不高的！',
    '很多人第一次见到派蒙的时候，都会大呼小叫，还把派蒙当成气球。可派蒙就是派蒙，才不是气球呢。',
    '什么时候才能长高呢？跟派蒙同年的人身高都快是派蒙的两倍了，可派蒙还…不行，再睡久一点一定能长高的！派蒙要睡觉了，晚安。',
    '派蒙上次听人说，烦恼太多也会长不高…呜，派蒙该怎么办才好…',
    '想要长高的话，就不能挑食！说来最近好像身高也没有变化，是不是因为蔬菜吃少了，但是沙拉真的没有办法提供饱腹感，而且还苦苦的，呜欸——',
    '派蒙有长高一点点吗？',
    '派蒙好像确实像老师说的那样，可以独当一面了。这样子长不长高或许对派蒙来说也没有那么重要了，因为现在重要的是…有你陪在派蒙身边。',
    '派蒙，派蒙的出场费可是很贵的。唔？你居然…不是为了萝莉才来的？哼，那你的邀请…派蒙就勉为其难地接受了。',
    '咕噜噜…嗯？没有！你什么都没有听到！',
    '这个鱼肉罐头是派蒙好不容易省下来的，别，别看啦！最多…最多只能给你尝一口。',
    '你没有猫猫的夜视能力，走夜路不要紧吧？要派蒙护送你的话…欸，有灯啊？…谁，谁要护送你啦，快点走快点走。',
    '哈~~好舒服，身体都变得更柔软了。',
    '才，才没有在等你。派蒙只是，正好在休息而已！',
    '唔…要是，要是你感觉孤单了，派蒙可以随便陪你聊聊天。派蒙还是知道很多事情的哦！也是很好的…那个叫什么，说话对象哦。没错没错！来跟派蒙，多说说话吧…',
    '是什么是什么？你拿着的是什么？快给派蒙看看！',
    '龙脊雪山上，会不会长着奇珍异草呢。',
    '派蒙扑…捕捉蝴蝶的技巧可是一流的。喂，不是啦！不要把派蒙当成猫啦！喵！',
    '可莉每次来找派蒙玩的时候，派蒙都只好把她带去离酒馆远一点的地方。酒和炸弹…实在是太危险了！就算派蒙想摧毁蒙德酒业，也得用堂堂正正的方式。',
    '你不会…也像那些讨厌的酒鬼一样要派蒙学猫咪叫吧？不会的，绝对不会的！派蒙才不是什么抖抖耳朵伸伸懒腰的宠物！',
    '别再惹派蒙了啊，派蒙宽容大度，但也不好欺负！派蒙警告你，派蒙生起气来可是会咬人的！喵！虽然不一定舍得咬你…',
    '派蒙和你…已经成为好朋友了，对吧。派蒙隐约记得…派蒙以前也有过这样一个朋友，但派蒙不确定那是不是梦…把你的手给派蒙。啊呜，唔…暖和的。这样就好，不要变成梦走了…',
    '派蒙是派蒙，出门在外，若有不便…请叫上派蒙！派蒙有礼了。对了，派蒙这里有炸萝卜丸子，吃一点吧！但是不可以多吃哦，油腻的东西吃多了对身体的负担会增加的。如果没吃饱，派蒙还带了洗干净的萝卜和醋，可以给你凉拌萝卜丝吃。',
    '「明日复明日，明日何其多…」总之，快快行动起来吧。',
    '那边好像有什么动静，偷偷看一眼的话，应该没事吧！',
    '真奇怪，为什么总有人想寻仙问道呢？仙人不是到处都是吗？',
    '你听，青蛙的叫声，像不像在给雨声伴奏？呱呱呱。',
    '天气很好呢，我们去璃月港的码头逛逛吧。',
    '你知道吗？璃月港的码头，总是人声鼎沸，可热闹了！和我们家那种静到叶子掉在地上都能听见的感觉完全不一样呢！所以，派蒙一有空就爱跑去码头看看。新来的船，新鲜的见闻…还有新玩具！',
    '所谓「仓廪实则知礼节，衣食足则知荣辱」，所以说，出门在外，要好好吃饭，衣裳穿暖…呃、欸？这句话不是这样的意思吗？那是什么意思呢？',
    '最近有按时吃饭吗？天冷了，有好好添衣裳吗？冒险的时候有没有遇到危险？有没有受伤？哎呀算了，要不你还是带上派蒙吧，草行露宿，派蒙实在有点放心不下你。',
    '派蒙也喜欢小团雀哦，去找七七玩的时候，经常能在路上见到。派蒙还会和它们打招呼呢！啾啾啾♪～哎呀，被你猜对了，真聪明！确实是早早早的意思哦。',
    '七七是派蒙的好朋友！她有时候会忘记派蒙，但派蒙知道她不是故意的，只要提醒她看一下笔记，她马上就能想起来。',
    '花草树木还有小动物们都是派蒙的朋友哦！对了，你想和小团雀聊聊天吗？派蒙可以带你去，也可以帮你传话。来吧，很有趣的~派蒙们先去准备点米粒给它们当做礼物！',
    '常言道，良宵苦短，胜事难逢！如果有什么好玩的事情，一定要过去看看才行呀…说不定还能遇上派蒙能帮上忙的事，你说对吧？',
    '轻策农家菜、来来菜、水煮鱼…这些璃月地道的味道不仅好吃，还能让人感到热闹。嗯？你也喜欢吗？太好了，那下次派蒙来露一手！',
    '哎，你平时吃的都是这些吗？要不然还是让派蒙来给你做饭吧！吃得不好怎么能出门冒险呢，要是累到了自己、身体垮了怎么办呀…',
    '你先休息吧，派蒙该去做柔软体操了…不要偷看。',
    '咦，刚刚…派蒙想说什么来着…',
    '很多事情派蒙都记不起来了，但是…也没什么不好。',
    '最近派蒙努力做了很多记忆力锻炼，所以不用担心派蒙会忘记你了。',
    '附近有时候会有小团雀出没哦，小小的一团。',
    '柔软体操，让派蒙能够保持和人类一样的身体状态。但是如果放松下来的话，就会变回去…',
    '有的人想要利用派蒙，有的人很害怕派蒙。但是你…和他们都不一样。',
    '从第一次见面开始，你就给派蒙一种很温暖的感觉。和让人不舒服的热不一样，是派蒙的心，感觉到了温暖。谢谢你…派蒙很高兴。可惜派蒙只认识现在的你，如果以后派蒙忘记了…派蒙们就…不，派蒙会「命令」自己记住你。',
    '以前派蒙只想要活下去，虽然不知道为了什么活下去…但现在派蒙好像知道了，以后想要和你一起活下去。派蒙、派蒙们可以…永远一直在一起吗？啊…真的可以吗？嗯！派蒙会保护好你的！',
    '想要一只小宠物…小团雀那样子的。',
    '人活着就是为了派蒙哦',
    '就这么看着你，算是爱好吗？因为你的一举一动都让派蒙很好奇啊。']

/* const newFetch = (url, options = {}) => {
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
} */

export async function generateHello () {
/*   let question = Config.helloPrompt || '写一段话让大家来找我聊天。类似于“有人找我聊天吗？"这种风格，轻松随意一点控制在20个字以内'
  let api = new ChatGPTAPI({
    apiBaseUrl: Config.openAiBaseUrl,
    apiKey: Config.apiKey,
    fetch: newFetch
  })
  const res = await api.sendMessage(question)
  return res.text */

  let text_number = Math.ceil(Math.random() * randomHellowPaimon['length'])
  return randomHellowPaimon[text_number - 1].replace(/派蒙/g, Config.tts_First_person)
  
}
