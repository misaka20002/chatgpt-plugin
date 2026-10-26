import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  commandFromReg,
  buildCapabilityEntries,
  renderCapabilityForm,
  matchCapabilities
} from '../utils/capability/form.js'
import {
  redactText,
  looksLikeSecret,
  isSensitiveFieldName,
  collectDescriptiveStrings
} from '../utils/capability/redact.js'

/**
 * 能力表单的纯函数测试（主缝）。
 *
 * 只断言「输入什么产出什么」，不碰文件系统、不调模型、不看内部调用顺序。
 * 快照是写死的假数据，不从真实框架取——拿实现当输入，测出来的只是实现自己的镜像。
 */

describe('commandFromReg：把触发正则还原成用户实际要打的写法', () => {
  const cases = [
    ['^#签到$', '#签到'],
    ['^#(结束|新开|摧毁|毁灭|完结)对话$', '#结束对话'],
    ['^#at图谱(?:\\s*[\\s\\S]*)?$', '#at图谱'],
    ['^#(图片)?chat(?!1|glm|gpt)[\\s\\S]*', '#chat'],
    ['^#chatgpt(导出)聊天记录$', '#chatgpt导出聊天记录'],
    // 转义还原后留下的尾部标点要去掉：实测线上出现 `#运行日志.`、`#Bot验证..`
    ['^#运行日志\\.$', '#运行日志'],
    ['^#Bot验证\\.\\.$', '#Bot验证'],
    ['^[^#][sS]*', '']
  ]

  for (const [reg, expected] of cases) {
    test(`\`${reg}\` → \`${expected}\``, () => {
      assert.equal(commandFromReg(reg), expected)
    })
  }

  test('空串与非字符串一律返回空串', () => {
    assert.equal(commandFromReg(''), '')
    assert.equal(commandFromReg('   '), '')
    assert.equal(commandFromReg(undefined), '')
    assert.equal(commandFromReg(null), '')
  })
})

describe('双过滤：凭证进不了表单', () => {
  test('凭证类字段名被识别', () => {
    for (const name of ['apiKey', 'access_token', 'cookie', 'password', 'webhook', 'apiBaseUrl', 'appSalt']) {
      assert.equal(isSensitiveFieldName(name), true, name)
    }
    assert.equal(isSensitiveFieldName('keywords'), false)
  })

  test('长随机串被识别为凭证', () => {
    assert.equal(looksLikeSecret('sk-proj-Ab3dE9fGh2IjK4lMn6Op8Qr0St2Uv4Wx'), true)
    assert.equal(looksLikeSecret('a'.repeat(40)), true)
    // 中文描述一定不算凭证
    assert.equal(looksLikeSecret('每日签到，打卡领积分的地方'), false)
    assert.equal(looksLikeSecret('短串'), false)
  })

  test('配置里只留下描述性文本，凭证整条丢弃', () => {
    const picked = collectDescriptiveStrings({
      apiKey: 'sk-proj-Ab3dE9fGh2IjK4lMn6Op8Qr0St2Uv4Wx',
      webhook: 'https://example.com/hook/abcdefghijklmnop',
      keywords: ['签到', '打卡'],
      limit: 5,
      groupId: 123456789
    })
    const values = picked.map(item => item.value)
    assert.deepEqual(values, ['签到', '打卡'])
    assert.ok(picked.every(item => item.field === 'keywords'))
  })
})

describe('占位脱敏：路径与号段', () => {
  test('Windows 绝对路径被替换', () => {
    assert.equal(redactText('C:\\Users\\someone\\WorkBuddy\\x'), '[PATH]')
  })

  test('QQ 号替换为 10001', () => {
    assert.equal(redactText('联系我 123456789'), '联系我 10001')
  })

  test('群号替换为 123456', () => {
    assert.equal(redactText('群号 123456789'), '群号 123456')
    // 不会被第二遍再替换一次
    assert.equal(redactText('群号 123456789'), '群号 123456')
  })
})

const SNAPSHOT = {
  degraded: false,
  plugins: [
    {
      key: 'sign-plugin',
      name: '签到插件',
      dsc: '每日签到领积分',
      rules: [
        { reg: '^#签到$', fnc: 'sign', permission: '' },
        { reg: '^#打卡$', fnc: 'punch', permission: '' },
        { reg: '^#我的积分$', fnc: 'points', permission: '' }
      ]
    },
    {
      key: 'notice-plugin',
      name: '公告插件',
      dsc: '群公告相关',
      rules: [
        { reg: '^#发公告[\\s\\S]*$', fnc: 'publish', permission: 'admin' },
        { reg: '^#看公告$', fnc: 'read', permission: '' }
      ]
    }
  ]
}

describe('表单与目录渲染', () => {
  test('条目带上归属插件与还原后的写法', () => {
    const entries = buildCapabilityEntries(SNAPSHOT)
    assert.equal(entries.length, 5)
    assert.equal(entries[0].plugin, '签到插件')
    assert.equal(entries[0].command, '#签到')
    assert.equal(entries[3].permission, 'admin')
  })

  test('没有翻译时退回插件级描述并标「描述粗略」', () => {
    const { form } = renderCapabilityForm(buildCapabilityEntries(SNAPSHOT), { generatedAt: '2026-10-27T00:00:00.000Z' })
    assert.match(form, /每日签到领积分（描述粗略）/)
  })

  test('空壳正则不产生指令条目', () => {
    const snapshot = {
      degraded: false,
      plugins: [
        {
          key: 'junk-plugin',
          name: '垃圾插件',
          dsc: '空壳',
          rules: [
            { reg: '(?:)', permission: '' },
            { reg: '()', permission: '' },
            { reg: '^#有效$', permission: '' }
          ]
        }
      ]
    }
    const entries = buildCapabilityEntries(snapshot)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].command, '#有效')
  })

  test('降级快照在表单上看得到「可能不完整」', () => {
    const { form } = renderCapabilityForm(buildCapabilityEntries(SNAPSHOT), {
      generatedAt: '2026-10-27T00:00:00.000Z',
      degraded: true
    })
    assert.match(form, /可能不完整/)
  })

  test('目录超上限时按插件分组截断，并留下未展开声明', () => {
    const entries = buildCapabilityEntries(SNAPSHOT)
    const { directory, unlistedPlugins, listedCount } = renderCapabilityForm(entries, { limit: 3 })

    assert.equal(listedCount, 3)
    assert.deepEqual(unlistedPlugins, ['公告插件'])
    assert.match(directory, /【签到插件】/)
    assert.doesNotMatch(directory, /【公告插件】/)
    assert.match(directory, /还有 1 个插件未展开/)
    // 表单本身是完整记录，截断只作用于目录
    assert.match(directory, /#签到/)
  })

  test('上限小于最小分组时按条兜底，仍填满预算', () => {
    const { directory, listedCount } = renderCapabilityForm(buildCapabilityEntries(SNAPSHOT), { limit: 2 })
    assert.equal(listedCount, 2)
    assert.equal(directory.split('\n').filter(line => line.startsWith('- 【')).length, 2)
  })

  test('目录每行都带插件名，AI 才能指出归属', () => {
    const { directory } = renderCapabilityForm(buildCapabilityEntries(SNAPSHOT), { limit: 10 })
    const lines = directory.split('\n').filter(Boolean)
    assert.equal(lines.length, 5)
    for (const line of lines) assert.match(line, /^- 【.+?】/)
  })
})

describe('关键词检索', () => {
  const entries = buildCapabilityEntries(SNAPSHOT).map((entry, index) => ({
    ...entry,
    description: ['每日签到', '打卡记录', '查询积分', '发布群公告', '查看群公告'][index]
  }))

  test('写法全等排第一', () => {
    const { matches } = matchCapabilities(entries, '#签到')
    assert.equal(matches[0].command, '#签到')
  })

  test('# 与空格不影响命中', () => {
    const { matches } = matchCapabilities(entries, ' 签到 ')
    assert.equal(matches[0].command, '#签到')
  })

  test('描述关键词能命中', () => {
    const { matches } = matchCapabilities(entries, '群公告')
    assert.equal(matches.length, 2)
  })

  test('查不到返回空，不硬凑', () => {
    assert.deepEqual(matchCapabilities(entries, '原神抽卡').matches, [])
  })

  test('多候选最多 5 条', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      plugin: '签到插件',
      command: `#签到${index}`,
      description: '签到'
    }))
    const { matches, total } = matchCapabilities(many, '签到')
    assert.equal(matches.length, 5)
    assert.equal(total, 12)
  })
})
