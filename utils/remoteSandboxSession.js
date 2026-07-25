import { createHash } from 'node:crypto'

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const CURRENT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function remoteSandboxActorKey(e = {}) {
  const user = e.user_id || e.sender?.user_id || e.sender?.userId || 'owner'
  const group = e.group_id || e.group?.group_id
  const scope = group ? `group:${group}` : `private:${user}`
  return `${scope}:user:${user}`
}

export function remoteSandboxOwnerKey(e = {}) {
  return sha256(remoteSandboxActorKey(e))
}

function currentRedisKey(ownerKey) {
  return `CHATGPT:REMOTE_SANDBOX:CURRENT:${ownerKey}`
}

export async function getCurrentRemoteSandboxSession(ownerKey, redisClient = globalThis.redis) {
  if (!redisClient?.get) return ''
  try {
    const value = String(await redisClient.get(currentRedisKey(ownerKey)) || '')
    return SESSION_ID_PATTERN.test(value) ? value : ''
  } catch (error) {
    globalThis.logger?.warn?.(`[remoteSandbox] 读取当前会话失败: ${error?.message || error}`)
    return ''
  }
}

export async function setCurrentRemoteSandboxSession(ownerKey, sessionId, redisClient = globalThis.redis) {
  if (!redisClient?.set || !SESSION_ID_PATTERN.test(sessionId)) return
  try {
    await redisClient.set(currentRedisKey(ownerKey), sessionId, {
      EX: CURRENT_SESSION_TTL_SECONDS
    })
  } catch (error) {
    globalThis.logger?.warn?.(`[remoteSandbox] 保存当前会话失败: ${error?.message || error}`)
  }
}

export async function clearCurrentRemoteSandboxSession(ownerKey, sessionId, redisClient = globalThis.redis) {
  if (!redisClient?.get || !redisClient?.del) return
  try {
    const key = currentRedisKey(ownerKey)
    if (await redisClient.get(key) === sessionId) await redisClient.del(key)
  } catch (error) {
    globalThis.logger?.warn?.(`[remoteSandbox] 清理当前会话失败: ${error?.message || error}`)
  }
}

function validateSessionId(value) {
  const sessionId = String(value || '').trim()
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('session_id 只能包含字母、数字、点、下划线和连字符，长度为 1-64')
  }
  return sessionId
}

export function resolveRemoteSandboxSelection(args = {}, currentSessionId = '') {
  const requestedNewSession = args?.new_session === true
  const explicitSessionId = typeof args?.session_id === 'string' && args.session_id.trim()
    ? validateSessionId(args.session_id)
    : ''
  if (requestedNewSession && explicitSessionId) {
    throw new Error('new_session=true 时不能同时提供 session_id')
  }
  if (requestedNewSession) {
    return {
      selection: {
        newSession: true,
        sessionId: '',
        replaceSessionId: currentSessionId
      },
      implicitResume: false
    }
  }
  if (explicitSessionId) {
    return {
      selection: {
        newSession: false,
        sessionId: explicitSessionId,
        replaceSessionId: ''
      },
      implicitResume: false
    }
  }
  if (currentSessionId) {
    return {
      selection: {
        newSession: false,
        sessionId: currentSessionId,
        replaceSessionId: ''
      },
      implicitResume: true
    }
  }
  return {
    selection: {
      newSession: true,
      sessionId: '',
      replaceSessionId: ''
    },
    implicitResume: false
  }
}
