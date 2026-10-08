import { PROVIDER_FIELDS, PROVIDER_LABELS, listProviders, providerLabel } from './providerProfiles.js'

export function providerSchemas(schemas, config, defaults) {
  const options = listProviders(config).map(row => ({ label: providerLabel(row), value: row.id }))
  const fields = new Set(Object.values(PROVIDER_FIELDS).flat())
  const removed = new Set(['gemini_fallbackModel', 'gemini_vqa_model', 'geminiSearchModel', 'groupReply.model'])
  const originals = new Map(schemas.filter(s => s.field).map(s => [s.field, s]))
  if (!originals.has('apiStream')) originals.set('apiStream', { field: 'apiStream', label: '流式请求', component: 'Switch' })
  const select = (field, label, values = options, help = '') => ({ field, label, component: 'Select', componentProps: { options: values }, bottomHelpMessage: help })
  const result = []
  let inserted = false
  for (const schema of schemas) {
    if (fields.has(schema.field) || removed.has(schema.field)) continue
    if (/^以下为.*方式的配置$/.test(schema.label || '')) {
      if (!inserted) {
        for (const [type, keys] of Object.entries(PROVIDER_FIELDS)) {
          result.push({
            field: `modelProviders.${type}`, label: `${PROVIDER_LABELS[type]} 提供商`, component: 'GSubForm',
            bottomHelpMessage: '新增或改名后先保存并刷新页面，再从来源下拉框选择。同类名称不能重复。',
            componentProps: { multiple: true, schemas: [
              { field: 'id', label: '内部标识', component: 'Input', show: false },
              { field: 'name', label: '名称', component: 'Input', required: true },
              ...keys.filter(key => originals.has(key)).map(key => {
                const item = structuredClone(originals.get(key))
                item.defaultValue = defaults[type][key]
                if (key === 'geminiModel') {
                  item.component = 'Input'
                  delete item.componentProps
                  item.bottomHelpMessage = '填写此条目使用的模型名称；可发送 #chatgpt获取可用模型，按数字选择提供商后获取名称。各用途均使用这个主模型。'
                }
                if (key === 'responsesStore') item.bottomHelpMessage = '默认关闭，使用插件本地历史续聊；开启后使用官网会话 ID，同账号内续聊。'
                return item
              })
            ] }
          })
        }
        inserted = true
      }
      continue
    }
    if (schema.field === 'api_default_USE') {
      result.push(select('defaultProviderId', schema.label, options, '所有用户正式聊天使用此配置；修改主模型后请同时检查备用配置。'))
      result.push(select('fallbackProviderId', '失败回退模型提供商', [{ label: '不启用', value: '' }, ...options], '仅可选同协议的其他条目。回退沿用本轮提示词和历史，使用备用配置的账号、模型及生成参数；下一轮仍优先主模型。'))
      continue
    }
    if (schema.field === 'mediaRecognitionSource') {
      result.push({ ...schema, bottomHelpMessage: '模型内置优先使用当前对话模型，失败后转指定识别配置；专用识别直接使用下方所选配置。', componentProps: { options: [{ label: '模型内置优先', value: 'Orignal' }, { label: '专用识别', value: 'Gemini' }] } })
      result.push(select('imageProviderId', '图片识别模型提供商'))
      const gemini = listProviders(config).filter(row => row.type === 'gemini').map(row => ({ label: providerLabel(row), value: row.id }))
      result.push(select('videoProviderId', '视频识别模型提供商', gemini))
      result.push(select('geminiSearchProviderId', 'Gemini 原生搜索模型提供商', gemini))
      continue
    }
    if (['groupReply.provider', 'sandboxSubAgentProvider'].includes(schema.field)) {
      result.push(select(schema.field, schema.label, [{ label: '跟随全局对话模型', value: 'current' }, ...options]))
      continue
    }
    if (schema.field === 'translateSource') {
      result.push(select(schema.field, schema.label, [...options, { label: '百度翻译', value: 'baidu' }]))
      continue
    }
    result.push(schema)
  }
  return result
}
