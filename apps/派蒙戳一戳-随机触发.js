// import plugin from '../../../lib/plugins/plugin.js';
// import cfg from '../../../lib/config/config.js'
// import { Config } from '../utils/config.js'
// import { PaimonChuo } from './派蒙戳一戳.js'

// // 如使用非icqq请在此处填写机器人QQ号
// let BotQQ = Bot.uin?.[0] || Bot.uin

// export class PaimonChuoRandom extends plugin {
//     constructor() {
//         super(
//             {
//                 name: '派蒙戳一戳-#戳',
//                 dsc: '派蒙戳一戳-#戳',
//                 priority: 999,
//                 rule: [
//                     {
//                         reg: '#?戳一?戳?',
//                         fnc: 'chuoyichuo_ByMeg',
//                     },
//                 ]
//             }
//         )
//         // init()  // 写在这里的函数每次戳一戳都会触发
//     }

//     async chuoyichuo_ByMeg(e) {
//         if (!e.isGroup) return false
//         // 检索该群号是否开启
//         if (!(Config.paimon_chuoyichuo_ByMsgGroups.find(item => item == e.group_id || item == Number(e.group_id))))
//             return
//         if ((Math.random() * 100) < Config.paimon_chuoyichuo_Probability_ByMsgGroups) {
//             e.operator_id = e.user_id
//             e.target_id = cfg.qq || BotQQ
//             e.fromChuoyichuo_ByMeg = true;
//             const PaimonChuoByMsg = new PaimonChuo();
//             PaimonChuoByMsg.chuoyichuo(e);
//             return true
//         }
//         else
//             return false
//     }
// }