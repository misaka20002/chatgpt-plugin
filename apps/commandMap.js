import plugin from '../../../lib/plugins/plugin.js'
import { Config } from '../utils/config.js'
import { getMasterQQ } from '../utils/common.js'
import { syncEnabled, delegateEnabled } from '../utils/capability/switches.js'
import {
  listInstalledPlugins,
  loadEntries,
  readMapState,
  shouldNotifyFailures,
  statusReport,
  syncMaps,
  updateReport,
  UPDATE_COMMAND
} from '../utils/capability/map.js'

const LOG_PREFIX = '[ChatGPT][map]'

/** 每天 4:30 一次：地图是人手维护的，一天里变两次的概率极低，挑个没人聊天的时间 */
const DAILY_CRON = '0 30 4 * * *'

/** 启动后等一会儿再拉：让框架先把插件与 Bot 连接准备好，也别和开机时的其他请求抢带宽 */
const STARTUP_DELAY_MS = 10_000

/** 进程内只排一次启动同步——插件的构造函数每条消息都会跑一遍 */
let startupScheduled = false

/** 最近一次同步的错误。提醒主人时带上一句，省得他再去翻日志 */
let lastError = ''

/**
 * 唯一的同步路径——启动、每日、手动更新三条入口都走这里，不各自实现一遍。
 *
 * `syncMaps` 本身不抛错，所以这里也不需要兜底：网络整体不可用时它只累加失败计数。
 *
 * @returns {Promise<object>} `syncMaps` 的结果，调用方据此拼回执
 */
export async function syncCommandMaps() {
  const plugins = listInstalledPlugins().map(key => ({ key }))
  const result = await syncMaps({ indexUrl: Config.commandMapIndexUrl, plugins })
  lastError = result.errors?.[0] || ''
  if (shouldNotifyFailures(result.failures)) await notifyMaster(result)
  return result
}

/** 连续失败到 3 的倍数才私聊主人；发不出去只记日志，别让提醒本身变成故障 */
async function notifyMaster(result) {
  let master = ''
  try {
    master = (await getMasterQQ())[0]
  } catch (err) {
    logger.warn(`${LOG_PREFIX} 取主人账号失败，跳过提醒：${err?.message || err}`)
    return
  }
  if (!master) return

  const text = [
    `指令地图已经连续 ${result.failures} 次没更新成功${lastError ? `（最近一次：${lastError}）` : ''}。`,
    '这期间机器人回答插件指令时可能不是最新的，其余功能不受影响。',
    `可以发 ${UPDATE_COMMAND} 手动重试。`
  ].join('\n')

  try {
    await Bot.pickFriend(Number(master)).sendMsg(text)
  } catch (err) {
    logger.warn(`${LOG_PREFIX} 私聊主人失败：${err?.message || err}`)
  }
}

function scheduleStartupSync() {
  if (startupScheduled) return
  startupScheduled = true

  const timer = setTimeout(() => {
    if (!syncEnabled(Config)) return
    syncCommandMaps().catch(err => logger.error(`${LOG_PREFIX} 启动同步出错：${err?.message || err}`))
  }, STARTUP_DELAY_MS)
  timer.unref?.()
}

/**
 * 指令地图的入口：启动与每日各同步一次，外加两条主人指令。
 *
 * 这里不做任何网络请求——构造函数每条消息都会跑一遍，真去拉地图会把事件循环拖垮。
 * 启动同步由模块级开关保证全进程只排一次；每日同步交给框架的任务调度，不自己 setInterval，
 * 否则热重载会叠出第二个定时器。
 */
export class CommandMapPlugin extends plugin {
  constructor(e) {
    super({
      name: 'ChatGPT-指令地图',
      dsc: '把外部维护的指令地图同步到本地，供 AI 查询指令与查看状态',
      event: 'message',
      priority: 500,
      rule: [
        {
          reg: `^${UPDATE_COMMAND}$`,
          fnc: 'updateMaps',
          permission: 'master'
        },
        {
          reg: '^#指令地图状态$',
          fnc: 'mapStatus',
          permission: 'master'
        }
      ]
    })

    this.task = [
      {
        cron: DAILY_CRON,
        name: 'ChatGPT_CommandMap_Sync',
        fnc: this.runDaily.bind(this),
        log: false
      }
    ]

    scheduleStartupSync()
  }

  async runDaily() {
    if (!syncEnabled(Config)) return
    await syncCommandMaps()
  }

  /** #指令地图更新：手动跑一次，回执照实说 */
  async updateMaps() {
    if (!syncEnabled(Config)) {
      await this.reply('指令地图同步是关着的（锅巴里「指令地图」分组可以打开），这次没有拉取。')
      return
    }
    const result = await syncCommandMaps()
    await this.reply(updateReport(result).join('\n'))
  }

  /** #指令地图状态：只看不碰 */
  async mapStatus() {
    const { stats } = loadEntries()
    await this.reply(statusReport(readMapState(), stats, { sync: syncEnabled(Config), delegate: delegateEnabled(Config) }).join('\n'))
  }
}
