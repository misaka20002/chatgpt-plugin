/** 四家 provider 的地址在真实配置加载、保存和锅巴读写后保持一致；文件写入隔离到临时目录。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const moduleUrl = relativePath => new URL(relativePath, import.meta.url).href

function runConfig(t, userConfig, action) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-base-url-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const configDir = path.join(cwd, 'plugins', 'chatgpt-plugin', 'config')
  fs.mkdirSync(configDir, { recursive: true })
  const configFile = path.join(configDir, 'config.json')
  fs.writeFileSync(configFile, JSON.stringify(userConfig))

  const script = `
    import { mock } from 'node:test'
    import assert from 'node:assert/strict'
    globalThis.logger = { info() {}, warn() {}, error: (...args) => console.error(...args) }
    globalThis.redis = { get: async () => null }
    // 仅隔离无关的语音依赖，配置和锅巴读写均执行生产代码。
    mock.module(${JSON.stringify(moduleUrl('../utils/tts.js'))}, {
      namedExports: { speakers: [], vits_emotion_map: [] }
    })
    mock.module(${JSON.stringify(moduleUrl('../utils/tts/microsoft-azure.js'))}, {
      namedExports: { supportConfigurations: [] }
    })
    const { Config } = await import(${JSON.stringify(moduleUrl('../utils/config.js'))})
    const { supportGuoba } = await import(${JSON.stringify(moduleUrl('../guoba.support.js'))})
    const guoba = supportGuoba().configInfo
    const loaded = await guoba.getConfigData()
    const fieldTypes = { openAiBaseUrl: 'api', promptPrefixOverride: 'api', responsesApiBaseUrl: 'responses', claudeApiBaseUrl: 'claude', geminiBaseUrl: 'gemini' }
    const formValues = values => Object.fromEntries(Object.entries(values).map(([field, value]) => {
      const type = fieldTypes[field]
      if (!type) return [field, value]
      const rows = structuredClone(Config.getConfig().modelProviders[type])
      rows[0][field] = value
      return ['modelProviders.' + type, rows]
    }))
    ${action}
    process.stdout.write(JSON.stringify({ loaded, current: { ...Config }, displayed: await guoba.getConfigData() }))
    process.exit(0)
  `
  const stdout = execFileSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', script], {
    cwd, encoding: 'utf8', timeout: 15000
  })
  const flatten = config => Object.assign({}, config, ...Object.values(config.modelProviders || {}).map(rows => rows[0]))
  const result = JSON.parse(stdout)
  return { loaded: flatten(result.loaded), current: flatten(result.current), displayed: flatten(result.displayed), written: flatten(JSON.parse(fs.readFileSync(configFile, 'utf8'))) }
}

const input = {
  openAiBaseUrl: ' https://example.com/proxy/v1/// ',
  responsesApiBaseUrl: 'https://example.com/v1/',
  claudeApiBaseUrl: 'https://example.com',
  geminiBaseUrl: 'http://47.106.94.157:18080/',
  meme_baseUrl: 'https://meme.example.com/',
  promptPrefixOverride: '提示词结尾保留/'
}
const expected = {
  ...input,
  openAiBaseUrl: 'https://example.com/proxy/v1',
  responsesApiBaseUrl: 'https://example.com/v1',
  geminiBaseUrl: 'http://47.106.94.157:18080'
}

test('加载已有地址时锅巴显示规范值，下次保存同步写入且保留路径和其他字段', t => {
  const result = runConfig(t, input, 'assert.equal(Config.save(), true)')
  for (const snapshot of [result.loaded, result.current, result.displayed, result.written]) {
    for (const [key, value] of Object.entries(expected)) assert.equal(snapshot[key], value, key)
  }
})

test('锅巴保存四家 provider 的地址后，面板读取与磁盘存储一致', t => {
  const values = Object.fromEntries(['openAiBaseUrl', 'responsesApiBaseUrl', 'claudeApiBaseUrl', 'geminiBaseUrl']
    .map(key => [key, 'http://47.106.94.157:18080/']))
  const result = runConfig(t, {}, `
    await guoba.setConfigData(formValues(${JSON.stringify(values)}), {
      Result: { ok() {}, error(message) { throw new Error(message) } }
    })
  `)
  for (const snapshot of [result.current, result.displayed, result.written]) {
    for (const key of Object.keys(values)) assert.equal(snapshot[key], 'http://47.106.94.157:18080', key)
  }
})

test('直接给 Config 赋值也会同步规范地址并保存', t => {
  const result = runConfig(t, {}, `
    for (const [key, value] of Object.entries(${JSON.stringify(input)})) {
      if (fieldTypes[key]) Config.defaultProviderId = Config.getConfig().modelProviders[fieldTypes[key]][0].id
      Config[key] = value
    }
  `)
  for (const snapshot of [result.current, result.displayed, result.written]) {
    for (const [key, value] of Object.entries(expected)) assert.equal(snapshot[key], value, key)
  }
})

test('清空地址时保持空值，不转换为默认地址或文本 null', t => {
  const values = { openAiBaseUrl: '', responsesApiBaseUrl: null, claudeApiBaseUrl: '  ', geminiBaseUrl: '' }
  const result = runConfig(t, {}, `
    await guoba.setConfigData(formValues(${JSON.stringify(values)}), {
      Result: { ok() {}, error(message) { throw new Error(message) } }
    })
  `)
  for (const snapshot of [result.current, result.displayed, result.written]) {
    for (const [key, value] of Object.entries({ ...values, responsesApiBaseUrl: '', claudeApiBaseUrl: '' })) assert.equal(snapshot[key], value, key)
  }
})

test('锅巴新增条目后更新全部来源选项，重命名保留 ID，错误主备组合不部分保存', t => {
  runConfig(t, {}, `
    const rows = structuredClone(Config.getConfig().modelProviders.api)
    rows.push({ ...rows[0], id: '', name: '我的账号', model: 'another-model', temperature: 0 })
    const Result = { ok: () => true, error: message => ({ error: message }) }
    assert.equal(await guoba.setConfigData({ 'modelProviders.api': rows }, { Result }), true)
    const added = Config.getConfig().modelProviders.api[1]
    assert.ok(added.id)
    assert.equal(added.temperature, 0)
    const refreshed = supportGuoba().configInfo
    for (const field of ['defaultProviderId', 'fallbackProviderId', 'groupReply.provider', 'sandboxSubAgentProvider', 'translateSource', 'imageProviderId']) {
      const option = refreshed.schemas.find(s => s.field === field).componentProps.options.find(o => o.value === added.id)
      assert.equal(option.label, 'Chat API - 我的账号')
    }
    assert.equal(refreshed.schemas.find(s => s.field === 'modelProviders.api').component, 'GSubForm')
    assert.ok(!refreshed.schemas.some(s => s.field === 'gemini_fallbackModel' || s.field === 'groupReply.model'))
    const renamed = structuredClone(Config.getConfig().modelProviders.api)
    renamed[1].name = '改名后'
    assert.equal(await guoba.setConfigData({ 'modelProviders.api': renamed, fallbackProviderId: added.id }, { Result }), true)
    assert.equal(Config.fallbackProviderId, added.id)
    const before = structuredClone(Config.getConfig())
    const result = await guoba.setConfigData({ defaultProviderId: before.modelProviders.gemini[0].id }, { Result })
    assert.match(result.error, /同一协议/)
    assert.deepEqual(Config.getConfig(), before)
  `)
})

// 备注是锅巴专属展示字段：normalizeProviders 按白名单重建整行，白名单外的键会被静默丢弃，
// 所以既要确认它真的落盘，也要确认它不影响来源下拉标签。
const noteBase = {
  providerConfigVersion: 1,
  modelProviders: { api: [{ id: 'p1', name: '面包的one' }], responses: [], claude: [], gemini: [] },
  defaultProviderId: 'p1'
}

test('锅巴保存的备注写盘并在面板读回，空缺条目补空串', t => {
  const result = runConfig(t, noteBase, `
    const rows = structuredClone(Config.getConfig().modelProviders.api)
    rows[0].note = '  官方 key，别乱切  '
    rows.push({ ...rows[0], id: '', name: '备用账号', note: undefined })
    const Result = { ok: () => true, error: message => ({ error: message }) }
    assert.equal(await guoba.setConfigData({ 'modelProviders.api': rows }, { Result }), true)
    assert.equal(Config.getConfig().modelProviders.api[0].note, '官方 key，别乱切')
    assert.equal(Config.getConfig().modelProviders.api[1].note, '')
    for (const type of ['api', 'responses', 'claude', 'gemini']) {
      const field = guoba.schemas.find(s => s.field === 'modelProviders.' + type)
        .componentProps.schemas.find(s => s.field === 'note')
      // 备注在四个来源面板里统一是多行文本框（锅巴 schema 的选择），与「仅用于区分条目」的用途一致
      assert.equal(field.component, 'InputTextArea')
      assert.equal(field.label, '备注')
    }
    const option = supportGuoba().configInfo.schemas.find(s => s.field === 'defaultProviderId')
      .componentProps.options.find(o => o.value === 'p1')
    assert.equal(option.label, 'Chat API - 面包的one')
  `)
  for (const snapshot of [result.current, result.displayed, result.written]) assert.equal(snapshot.note, '官方 key，别乱切')
})

test('配置文件里已有的备注在重新加载后保留，缺失条目补空串', t => {
  const result = runConfig(t, {
    ...noteBase,
    modelProviders: {
      ...noteBase.modelProviders,
      api: [{ id: 'p1', name: '面包的one', note: '重载后还在' }, { id: 'p2', name: '没有备注' }]
    }
  }, `
    assert.equal(Config.getConfig().modelProviders.api[1].note, '')
    assert.equal(Config.save(), true)
  `)
  for (const snapshot of [result.loaded, result.displayed, result.written]) assert.equal(snapshot.note, '重载后还在')
})

test('锅巴内容识别相关说明准确区分普通聊天与按需工具，原有来源选项可往返保存', t => {
  const result = runConfig(t, { mediaRecognitionSource: 'Orignal' }, `
    const field = key => guoba.schemas.find(schema => schema.field === key)
    const mode = field('mediaRecognitionSource')
    assert.equal(mode.bottomHelpMessage,
      '仅控制普通聊天的媒体处理方式：模型内置使用当前对话模型的原生多模态能力；专用识别先使用配置的识别模型生成文字描述。按需内容识别工具不受此选项影响，始终使用指定的图片或视频识别模型提供商。')
    assert.deepEqual(mode.componentProps.options, [
      { label: '模型内置', value: 'Orignal' },
      { label: '专用识别', value: 'Gemini' }
    ])
    assert.equal(field('mediaRecognitionGeminiTool').bottomHelpMessage,
      '新增按需内容识别工具，用于AI智能按需识别聊天记录中的图片/视频/群友头像等；需要先配置 对话-图片识别模型提供商 和 视频识别模型提供商')
    assert.equal(field('mediaMaxSizeInMB').bottomHelpMessage,
      '媒体文件大小上限，适用于智能模式 recognize_media 按需内容识别、普通聊天「专用识别」的媒体预处理及独立 #识图；图片和群友头像使用图片识别模型提供商，视频使用视频识别模型提供商，请注意 Token 消耗。')
    assert.equal(loaded.mediaRecognitionSource, 'Orignal')
    const Result = { ok() { return true }, error(message) { throw new Error(message) } }
    assert.equal(await guoba.setConfigData({ mediaRecognitionSource: 'Gemini' }, { Result }), true)
    assert.equal((await guoba.getConfigData()).mediaRecognitionSource, 'Gemini')
  `)
  assert.equal(result.current.mediaRecognitionSource, 'Gemini')
  assert.equal(result.displayed.mediaRecognitionSource, 'Gemini')
  assert.equal(result.written.mediaRecognitionSource, 'Gemini')
})
