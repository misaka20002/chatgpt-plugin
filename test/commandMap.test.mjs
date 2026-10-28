import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { normalize, fixTypos, bigrams, dice } from '../utils/commandMap/text.js'
import { buildFingerprint, commandKey, mergeIndex, normalizePatch } from '../utils/commandMap/patch.js'
import { recall, scoreEntry } from '../utils/commandMap/recall.js'

/**
 * 召回与合并（主缝：纯函数）。
 *
 * 语料是手写的，形如线上真实条目（三角洲插件的战绩/密码/绑定），
 * 其中「今天密码是什么」那条是文档里记录过的危险误召回案例，必须钉住。
 */

const ENTRIES = [
  { plugin: '三角洲行动', pluginKey: 'delta', command: '#三角洲战绩', description: '查询烽火地带/全面战场历史战绩', permission: '' },
  { plugin: '三角洲行动', pluginKey: 'delta', command: '#三角洲每日密码', description: '查询当日每日密码', permission: '' },
  { plugin: '三角洲行动', pluginKey: 'delta', command: '#三角洲开启每日密码推送', description: '开启每日密码自动推送', permission: 'master' },
  { plugin: '三角洲行动', pluginKey: 'delta', command: '#三角洲角色绑定', description: '绑定游戏账号', permission: '' },
  { plugin: '签到插件', pluginKey: 'sign', command: '#签到', description: '每日签到领积分', permission: '' }
]

const PATCH = {
  schema: 1,
  plugin: { key: 'delta', fingerprint: 'abc123' },
  commands: {
    '#三角洲战绩': {
      keys: ['战绩', '战报', '我的战绩', '查下战绩', '帮我看看我打得怎么样', '我这周战斗表现如何', '烽火地带战绩'],
      args: { p1: '模式 烽火地带|全面战场，可留空' },
      ex: '#三角洲战绩 烽火地带',
      risk: 'q'
    },
    '#三角洲每日密码': {
      keys: ['每日密码', '今天密码', '今日密码', '密码是什么', '今天的密码是多少'],
      ex: '#三角洲每日密码',
      risk: 'q'
    },
    '#三角洲开启每日密码推送': {
      keys: ['开启推送', '打开每日密码推送', '开一下密码推送', '推送开起来'],
      ex: '#三角洲开启每日密码推送',
      risk: 'w'
    },
    '#三角洲角色绑定': {
      keys: ['绑定账号', '怎么绑定', '角色绑定', '绑一下号'],
      ex: '#三角洲角色绑定',
      risk: 'w'
    }
  }
}

function makeIndex () {
  return mergeIndex({ entries: ENTRIES, patches: [normalizePatch(PATCH)] }).entries
}

describe('文本归一', () => {
  test('全角、大小写、标点、指令前缀都不影响比较', () => {
    assert.equal(normalize('#三角洲战绩　'), normalize('三角洲战绩'))
    assert.equal(normalize('＃战绩'), normalize('#战绩'))
  })

  test('常见手误纠正后与原词一致', () => {
    assert.equal(fixTypos(normalize('占绩')), '战绩')
    assert.equal(bigrams('战绩').size, 1)
    assert.equal(dice(bigrams('战绩'), bigrams('战绩')), 1)
  })
})

describe('补丁合并', () => {
  test('有补丁的条目带上关键词、参数、示例、风险档', () => {
    const index = makeIndex()
    const battle = index.find(entry => entry.command === '#三角洲战绩')
    assert.equal(battle.hasPatch, true)
    assert.ok(battle.keys.includes('战绩'))
    assert.equal(battle.ex, '#三角洲战绩 烽火地带')
    assert.equal(battle.risk, 'q')
  })

  test('没有补丁的条目仍保留，关键词退化为写法 + 描述，风险按权限推断', () => {
    const [merged] = mergeIndex({ entries: [{ plugin: 'A', pluginKey: 'a', command: '#管理', description: '改配置', permission: 'master' }] }).entries
    assert.equal(merged.hasPatch, false)
    assert.deepEqual(merged.keys, ['#管理', '改配置'])
    assert.equal(merged.risk, 'w')
  })

  test('补丁里多出来的写法只计入 stale，不影响其余条目', () => {
    const patched = normalizePatch({ ...PATCH, commands: { ...PATCH.commands, '#三角洲已删除的指令': { keys: ['旧词'], risk: 'q' } } })
    const { entries, staleCount } = mergeIndex({ entries: ENTRIES, patches: [patched] })
    assert.equal(entries.length, ENTRIES.length)
    assert.equal(staleCount, 1)
  })

  test('形状不对的补丁整份拒收', () => {
    assert.equal(normalizePatch({ schema: 2, plugin: { key: 'x' } }), null)
    assert.equal(normalizePatch({ schema: 1 }), null)
    assert.equal(normalizePatch(null), null)
  })

  test('指纹只跟写法集合有关，顺序无关', () => {
    assert.equal(buildFingerprint(['#a', '#b']), buildFingerprint(['#b', '#a']))
    assert.notEqual(buildFingerprint(['#a']), buildFingerprint(['#a', '#b']))
    assert.equal(commandKey('  #三角洲战绩 '), commandKey('#三角洲战绩'))
  })
})

describe('召回', () => {
  test('整句口语能召回到对应指令', () => {
    const { matches } = recall('帮我看看我这周打得怎么样', makeIndex())
    assert.equal(matches[0].command, '#三角洲战绩')
  })

  test('危险案例：问密码不得落到开启推送', () => {
    const { matches } = recall('今天密码是什么', makeIndex())
    assert.equal(matches[0].command, '#三角洲每日密码')
    assert.notEqual(matches[0].command, '#三角洲开启每日密码推送')
  })

  test('绑定类说法能命中绑定指令', () => {
    const { matches } = recall('怎么绑定账号', makeIndex())
    assert.ok(matches.slice(0, 3).some(entry => entry.command === '#三角洲角色绑定'))
  })

  test('手误也能召回', () => {
    const { matches } = recall('看下我的占绩', makeIndex())
    assert.equal(matches[0].command, '#三角洲战绩')
  })

  test('毫无关系的输入不硬凑候选', () => {
    const { matches } = recall('今天天气怎么样', makeIndex())
    assert.equal(matches.length, 0)
  })

  test('空查询直接返回空', () => {
    assert.deepEqual(recall('   ', makeIndex()).matches, [])
  })

  test('候选数量受 limit 控制', () => {
    const { matches } = recall('战绩', makeIndex(), { limit: 2 })
    assert.ok(matches.length <= 2)
  })

  test('得分落进 [0,1]', () => {
    const index = makeIndex()
    const score = scoreEntry(normalize('战绩'), index[0])
    assert.ok(score > 0 && score <= 1)
  })
})

describe('性能', () => {
  test('1157 条规模下单次召回不拖慢对话（30ms 以内）', () => {
    const base = makeIndex()
    const index = []
    for (let i = 0; i < 1157; i++) {
      const source = base[i % base.length]
      index.push({ ...source, command: `${source.command}${i}`, keys: [...source.keys, `变体${i}`] })
    }
    recall('帮我看看这周战绩', index) // 预热

    const startedAt = process.hrtime.bigint()
    for (let round = 0; round < 20; round++) recall('帮我看看这周战绩', index)
    const perCall = Number(process.hrtime.bigint() - startedAt) / 1e6 / 20

    // 阈值按「用户可感知」定，不按开发机速度定：同一份实现本机实测 1.9ms，
    // 容器/CI 里 9~10ms（机器弱约 5 倍）。写 5ms 会让门禁在慢机器上必红，
    // 结果只会逼人把这条测试删掉。30ms 仍能抓住「退化成 O(n²)」这类真问题。
    assert.ok(perCall < 30, `单次召回 ${perCall.toFixed(2)}ms 超过 30ms`)
  })
})


describe('字符级兜底：说法与指令名不重叠时', () => {
  const EXTRA = mergeIndex({
    entries: [
      { plugin: '椰奶', pluginKey: 'yenai', command: '#点赞', description: '为发送者或指定目标的QQ个人资料卡点赞', permission: '' },
      { plugin: '三角洲', pluginKey: 'delta', command: '#三角洲每日密码', description: '查询当日每日密码', permission: '' }
    ],
    patches: [
      normalizePatch({
        schema: 1,
        plugin: { key: 'yenai' },
        commands: { '#点赞': { keys: ['点赞'], risk: 'q' } }
      })
    ]
  }).entries

  test('「点个赞」能召回到 #点赞（共享 0 个二字组）', () => {
    const { matches } = recall('帮我点个赞', EXTRA)
    assert.equal(matches[0].command, '#点赞')
  })

  test('「点个赞啊」这类带语气词的说法也能召回', () => {
    const { matches } = recall('点个赞啊', EXTRA)
    assert.ok(matches.some(entry => entry.command === '#点赞'))
  })

  test('字符兜底不会把无关短句拉进来', () => {
    const { matches } = recall('今天天气', EXTRA)
    assert.equal(matches.length, 0, `误召回：${matches.map(m => m.command).join(',')}`)
  })
})

describe('同分破平：写法越短越通用', () => {
  // 线上事故：同义词按关键词批量挂载，「点赞」同时挂在三条指令上，得分全是 1.000，
  // 不破平就等于按索引顺序抽签，抽到了「改枪方案点赞」。
  const TIED = mergeIndex({
    entries: [
      { plugin: '三角洲改枪方案V2', pluginKey: 'delta', command: '#三角洲改枪方案点赞', description: '对指定的三角洲改枪方案进行点赞或点踩', permission: '' },
      { plugin: '椰奶点赞', pluginKey: 'yenai', command: '#点赞', description: '为发送者或指定目标的QQ个人资料卡点赞', permission: '' },
      { plugin: 'FanSky小功能Index', pluginKey: 'fan', command: '#开启fan点赞', description: '开启或关闭自动点赞功能开关', permission: '' }
    ],
    patches: [
      normalizePatch({
        schema: 1,
        plugin: { key: 'yenai' },
        commands: { '#点赞': { keys: ['点赞', '赞我', '点个赞', '给我点个赞', '名片赞'], risk: 'q' } }
      }),
      normalizePatch({
        schema: 1,
        plugin: { key: 'delta' },
        commands: { '#三角洲改枪方案点赞': { keys: ['点赞', '赞我', '点个赞', '给我点个赞', '名片赞'], risk: 'q' } }
      }),
      normalizePatch({
        schema: 1,
        plugin: { key: 'fan' },
        commands: { '#开启fan点赞': { keys: ['点赞', '赞我', '点个赞', '给我点个赞', '名片赞'], risk: 'q' } }
      })
    ]
  }).entries

  test('同分时最通用的短写法排第一', () => {
    const { matches } = recall('给我点个赞', TIED)
    assert.equal(matches[0].command, '#点赞')
  })

  test('用户真要那条长写法时，长写法仍然能被召回', () => {
    const { matches } = recall('三角洲改枪方案点赞', TIED)
    assert.ok(matches.some(entry => entry.command === '#三角洲改枪方案点赞'))
  })
})
