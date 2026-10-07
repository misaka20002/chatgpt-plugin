const MCP_SERVER_TYPES = new Set(['stdio', 'http', 'sse'])

export function parseMcpServersConfig(value, throwOnError = false) {
  if (!value) {
    return {}
  }

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (Object.prototype.hasOwnProperty.call(parsed, 'mcpServers')) {
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)) {
          return parsed.mcpServers
        }
        if (throwOnError) {
          throw new Error('mcpServers JSON must contain an object field named mcpServers')
        }
        return {}
      }
      return parsed
    }
  } catch (err) {
    if (throwOnError) {
      throw new Error(`mcpServers JSON parse failed: ${err.message}`)
    }
    globalThis.logger?.warn?.(`[Chatgpt][mcp] mcpServers JSON parse failed: ${err.message}`)
  }

  if (throwOnError) {
    throw new Error('mcpServers JSON must be an object')
  }
  return {}
}

export function formatMcpServersForGuoba(value) {
  const servers = parseMcpServersConfig(value)
  return Object.entries(servers).map(([name, serverConfig]) => {
    const config = serverConfig && typeof serverConfig === 'object' ? serverConfig : {}
    const configType = typeof config.type === 'string' ? config.type.toLowerCase() : ''
    const type = MCP_SERVER_TYPES.has(configType) ? configType : (config.url ? 'sse' : 'stdio')
    const env = config.env && typeof config.env === 'object' && !Array.isArray(config.env)
      ? Object.entries(config.env).map(([key, envValue]) => `${key}=${envValue ?? ''}`).join('\n')
      : ''
    const headers = config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)
      ? Object.entries(config.headers).map(([key, headerValue]) => `${key}=${headerValue ?? ''}`).join('\n')
      : ''

    return {
      enabled: config.enabled !== false,
      type,
      name,
      command: config.command || '',
      url: config.url || '',
      args: Array.isArray(config.args) ? config.args.map(arg => `${arg}`).join('\n') : '',
      env,
      headers
    }
  })
}

function splitLines(value) {
  if (Array.isArray(value)) {
    return value.map(item => `${item}`.trim()).filter(Boolean)
  }
  if (value == null) {
    return []
  }
  return `${value}`.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
}

/**
 * 解析面板中「每行一个 KEY=value」的文本，用于 env 与 headers。
 *
 * @param {string|object|undefined} value 面板提交的文本或对象
 * @param {number} rowNumber 行号（用于错误提示）
 * @param {string} fieldName 字段名（用于错误提示，如 'env' / 'headers'）
 * @returns {object}
 */
function parseKeyValueLines(value, rowNumber, fieldName = 'env') {
  if (!value) {
    return {}
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => `${key}`.trim()))
  }

  const result = {}
  for (const line of splitLines(value)) {
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      throw new Error(`MCP row ${rowNumber}: ${fieldName} must use KEY=value format`)
    }

    const key = line.slice(0, separatorIndex).trim()
    if (!key) {
      throw new Error(`MCP row ${rowNumber}: ${fieldName} key cannot be empty`)
    }
    result[key] = line.slice(separatorIndex + 1)
  }

  return result
}

function isEmptyMcpServerRow(row) {
  if (!row || typeof row !== 'object') {
    return true
  }
  return ['name', 'command', 'url', 'args', 'env', 'headers'].every(key => !`${row[key] ?? ''}`.trim())
}

export function stringifyMcpServersFromGuoba(rows) {
  if (typeof rows === 'string') {
    return JSON.stringify({ mcpServers: parseMcpServersConfig(rows, true) }, null, 2)
  }
  if (rows == null) {
    rows = []
  }
  if (!Array.isArray(rows)) {
    throw new Error('mcpServers must be a table array')
  }

  const names = new Set()
  const mcpServers = {}

  rows.forEach((row, index) => {
    const rowNumber = index + 1
    if (isEmptyMcpServerRow(row)) {
      return
    }

    const name = `${row.name || ''}`.trim()
    if (!name) {
      throw new Error(`MCP row ${rowNumber}: name is required`)
    }
    if (names.has(name)) {
      throw new Error(`MCP row ${rowNumber}: duplicate name "${name}"`)
    }
    names.add(name)

    const type = `${row.type || ''}`.trim().toLowerCase() || (`${row.url || ''}`.trim() ? 'sse' : 'stdio')
    if (!MCP_SERVER_TYPES.has(type)) {
      throw new Error(`MCP row ${rowNumber}: type must be stdio, http or sse`)
    }

    const serverConfig = {
      enabled: row.enabled !== false && row.enabled !== 'false',
      type
    }

    if (type === 'stdio') {
      const command = `${row.command || ''}`.trim()
      if (!command) {
        throw new Error(`MCP row ${rowNumber}: command is required for stdio`)
      }
      serverConfig.command = command

      const args = splitLines(row.args)
      if (args.length) {
        serverConfig.args = args
      }

      const env = parseKeyValueLines(row.env, rowNumber, 'env')
      if (Object.keys(env).length) {
        serverConfig.env = env
      }
    } else {
      const url = `${row.url || ''}`.trim()
      if (!url) {
        throw new Error(`MCP row ${rowNumber}: url is required for ${type}`)
      }
      serverConfig.url = url

      const headers = parseKeyValueLines(row.headers, rowNumber, 'headers')
      if (Object.keys(headers).length) {
        serverConfig.headers = headers
      }
    }

    mcpServers[name] = serverConfig
  })

  return JSON.stringify({ mcpServers }, null, 2)
}
