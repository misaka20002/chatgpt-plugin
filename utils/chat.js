import { Config } from './config.js'
import { newFetch } from './proxy.js'

// export async function getChatHistoryGroup (e, num) {
//   // if (e.adapter === 'shamrock') {
//   //  return await e.group.getChatHistory(0, num, false)
//   // } else {
//   let latestChats = await e.group.getChatHistory(e.seq || e.message_id, 1)
//   if (latestChats.length > 0) {
//     let latestChat = latestChats[0]
//     if (latestChat) {
//       let seq = latestChat.seq || latestChat.message_id
//       let chats = [e]
// 	  while(chats.length < num){
// 		  let chatHistory = await e.group.getChatHistory(seq, 20)
// 		  if(seq === (chatHistory[0].seq || chatHistory[0].message_id)) break
// 		  seq = chatHistory[0].seq || chatHistory[0].message_id
// 		  chats.unshift(...chatHistory.filter(chat => chat.sender?.user_id).slice(0, -1))
// 	  }
//       chats = chats.slice(chats.length - num)
//       try {
//         let mm = await e.bot.gml
//         for (const chat of chats) {
//             let sender = mm.get(chat.sender.user_id)
//             if (sender) {
//               chat.sender = sender
//             }
//           }
//       } catch (err) {
//         logger.warn(err)
//       }
//       return chats
//     }
//   }
//   // }
//   return []
// }

async function pickMemberAsync (e, userId) {
  let key = `CHATGPT:GroupMemberInfo:${e.group_id}:${userId}`
  let cache = await redis.get(key)
  if (cache) {
    return JSON.parse(cache)
  }
  return new Promise((resolve, reject) => {
    e.group.pickMember(userId, true, (sender) => {
      redis.set(key, JSON.stringify(sender), { EX: 86400 })
      resolve(sender)
    })
  })
}

export async function generateSuggestedResponse (conversations) {
  let prompt = 'Attention! you do not need to answer any question according to the provided conversation! \nYou are a suggested questions generator, you should generate three suggested questions according to the provided conversation for the user in the next turn, the three questions should not be too long, and must be superated with newline. The suggested questions should be suitable in the context of the provided conversation, and should not be too long. \nNow give your 3 suggested questions, use the same language with the user.'
  const { SubLLM } = await import('../model/SubLLM.js')
  const llm = new SubLLM({ provider: Config.defaultProviderId, systemPrompt: prompt })
  return (await llm.chat(JSON.stringify(conversations))).text
}
