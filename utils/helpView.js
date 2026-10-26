/*
 * Web 帮助页的视图适配：把 apps/help.js 的 helpData 转成 server 端 `/help` 接口的条目形状。
 *
 * 两边的词汇不一样：helpData 是「分组 → 指令」，Web 帮助页要的是「一条指令一个条目」，
 * 而且左侧卡片的标题写死在打包产物里、改不了。所以这里保留两张表：一张对齐分组名，
 * 一张把聊天内帮助图用的 PNG 图标名换成 FontAwesome 类名。
 */

/** Web 帮助页写死的卡片标题 → helpData 的分组名；一个卡片可以对应多个分组。 */
const HELP_GROUP_ALIASES = {
  AI聊天: ['聊天'],
  插件管理: ['管理'],
  设定: ['设定'],
  系统设置: ['设置', '其他']
}

/** 聊天内帮助图的 PNG 图标名 → FontAwesome 类名。 */
const HELP_ICON_CLASS = {
  blue: 'fas fa-circle',
  chat: 'fas fa-comments',
  'chat-private': 'fas fa-user',
  coin: 'fas fa-coins',
  confirm: 'fas fa-check',
  destroy: 'fas fa-trash',
  'destroy-other': 'fas fa-eraser',
  eat: 'fas fa-utensils',
  eye: 'fas fa-eye',
  game: 'fas fa-gamepad',
  help: 'fas fa-question-circle',
  list: 'fas fa-list',
  picture: 'fas fa-image',
  'smiley-wink': 'fas fa-smile-wink',
  sound: 'fas fa-volume-up',
  switch: 'fas fa-toggle-on',
  text: 'fas fa-font',
  token: 'fas fa-key'
}

/**
 * 把 helpData 的分组条目转成 Web 帮助页要的形状。
 *
 * `use` 是打包前端里写死的卡片标题（如「设定」）。认不出的名字按分组原名直接查，
 * 所以将来前端若改成直接传分组名也能用；两者都查不到时返回空数组。
 * @param {{group: string, list: {icon: string, title: string, desc: string}[]}[]} helpData 帮助数据
 * @param {string} use Web 帮助页请求的分组名
 * @returns {{icon: string, title: string, text: string, list: string[], tip: string}[]} 指令条目
 */
export function helpEntries (helpData, use) {
  const groups = HELP_GROUP_ALIASES[use] || [use]
  return helpData
    .filter(group => groups.includes(group.group))
    .flatMap(group => group.list.map(item => ({
      icon: HELP_ICON_CLASS[item.icon] || 'fas fa-circle',
      title: item.title,
      text: item.desc,
      list: [],
      tip: ''
    })))
}
