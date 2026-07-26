import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { isIP } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fetch from 'node-fetch'
import { Config } from './config.js'

export const LOCAL_SANDBOX_LIMITS = Object.freeze({
  stdoutBytes: 1024 * 1024,
  stderrBytes: 1024 * 1024,
  outputFileBytes: 64 * 1024 * 1024,
  outputTotalBytes: 64 * 1024 * 1024,
  outputFiles: 32,
  sessionBytes: 256 * 1024 * 1024,
  inputFileBytes: 20 * 1024 * 1024,
  inputTotalBytes: 64 * 1024 * 1024,
  addressSpaceBytes: 2 * 1024 * 1024 * 1024,
  processes: 64,
  openFiles: 256
})

const SESSION_METADATA = '.session.json'
const LAST_USED_MARKER = '.last-used'
const SESSION_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
const PACKAGE_SPEC_PATTERN = /^[A-Za-z0-9@._+:/#=~-]{1,200}$/
const STORAGE_DIRECTORY_PATTERN = /^[a-f0-9]{64}$/
const SYSTEM_RUNTIME_ROOTS = [
  '/usr/bin',
  '/usr/sbin',
  '/usr/lib',
  '/usr/lib64',
  '/usr/share',
  '/usr/include',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/local/lib',
  '/usr/local/share',
  '/usr/local/include',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64'
]
const SYSTEM_READONLY_PATHS = [
  '/usr/bin',
  '/usr/sbin',
  '/usr/lib',
  '/usr/lib64',
  '/usr/share',
  '/usr/include',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/local/lib',
  '/usr/local/share',
  '/usr/local/include',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/etc/alternatives',
  '/etc/ssl',
  '/etc/ca-certificates',
  '/etc/fonts',
  '/etc/passwd',
  '/etc/group',
  '/etc/nsswitch.conf',
  '/etc/hosts',
  '/etc/resolv.conf',
  '/etc/localtime',
  '/etc/mime.types',
  '/etc/machine-id'
]

function logWarn(message) {
  globalThis.logger?.warn?.(`[localSandbox] ${message}`)
}

function logError(message) {
  globalThis.logger?.error?.(`[localSandbox] ${message}`)
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function safeOutputName(remotePath, index = 0) {
  const fallback = `sandbox-output-${index + 1}.bin`
  let name = path.posix.basename(String(remotePath || '').replace(/\\/g, '/')) || fallback
  name = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`
  return name || fallback
}

function clampRetentionMinutes(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 30
  return Math.max(1, Math.min(1440, Math.trunc(parsed)))
}

function currentRedisKey(actorHash) {
  return `CHATGPT:LOCAL_SANDBOX:CURRENT:${actorHash}`
}

export function actorKeyForEvent(e = {}) {
  const user = e.user_id || e.sender?.user_id || e.sender?.userId || 'owner'
  const group = e.group_id || e.group?.group_id
  const scope = group ? `group:${group}` : `private:${user}`
  return `${scope}:user:${user}`
}

export function validateSessionId(value) {
  const sessionId = String(value || '').trim()
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('session_id 只能包含字母、数字、点、下划线和连字符，长度为 1-64')
  }
  return sessionId
}

function sessionStorageKey(actorHash, sessionId) {
  return sha256(`${actorHash}\0${sessionId}`)
}

async function pathExists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function readLastUsed(directory) {
  const marker = path.join(directory, LAST_USED_MARKER)
  try {
    const value = Number((await readFile(marker, 'utf8')).trim())
    if (Number.isFinite(value) && value > 0) return value
    return (await stat(marker)).mtimeMs
  } catch {
    return (await stat(directory)).mtimeMs
  }
}

function sessionInfoFromMetadata(rootDirectory, storageKey, metadata, lastUsed) {
  if (
    !metadata ||
    !SESSION_ID_PATTERN.test(metadata.sessionId || '') ||
    !/^[a-f0-9]{64}$/.test(metadata.actorHash || '') ||
    sessionStorageKey(metadata.actorHash, metadata.sessionId) !== storageKey
  ) {
    return null
  }
  return {
    storageKey,
    sessionId: metadata.sessionId,
    actorHash: metadata.actorHash,
    directory: path.join(rootDirectory, storageKey),
    lastUsed,
    activeCount: 0,
    deleting: false
  }
}

export class LocalSandboxSessionManager {
  constructor(options = {}) {
    this.rootDirectory = options.rootDirectory || path.join(os.tmpdir(), 'chatgpt-plugin-local-sandbox')
    this.getRedis = options.getRedis || (() => globalThis.redis)
    this.getRetentionMinutes = options.getRetentionMinutes || (() => Config.localSandboxRetentionMinutes)
    this.now = options.now || (() => Date.now())
    this.sessions = new Map()
    this.locks = new Map()
    this.indexPromise = null
    this.indexed = false
    this.lastRetentionMs = 0
    this.nextExpiry = Number.POSITIVE_INFINITY
  }

  retentionMs() {
    return clampRetentionMinutes(this.getRetentionMinutes()) * 60 * 1000
  }

  async ensureIndexed() {
    if (this.indexed) return
    if (this.indexPromise) return await this.indexPromise
    this.indexPromise = this.loadIndex()
    try {
      await this.indexPromise
      this.indexed = true
    } finally {
      this.indexPromise = null
    }
  }

  async loadIndex() {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 })
    const entries = await readdir(this.rootDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !STORAGE_DIRECTORY_PATTERN.test(entry.name)) continue
      const directory = path.join(this.rootDirectory, entry.name)
      try {
        const lastUsed = await readLastUsed(directory)
        const metadata = JSON.parse(await readFile(path.join(directory, SESSION_METADATA), 'utf8'))
        const info = sessionInfoFromMetadata(
          this.rootDirectory,
          entry.name,
          metadata,
          lastUsed
        )
        if (info) {
          this.sessions.set(info.storageKey, info)
        } else {
          this.sessions.set(entry.name, {
            storageKey: entry.name,
            sessionId: '',
            actorHash: '',
            directory,
            lastUsed,
            activeCount: 0,
            deleting: false,
            orphan: true
          })
        }
      } catch (error) {
        try {
          this.sessions.set(entry.name, {
            storageKey: entry.name,
            sessionId: '',
            actorHash: '',
            directory,
            lastUsed: (await stat(directory)).mtimeMs,
            activeCount: 0,
            deleting: false,
            orphan: true
          })
        } catch {
          logWarn(`忽略无法恢复的会话目录 ${entry.name}: ${error?.message || error}`)
        }
      }
    }
    this.recomputeNextExpiry()
  }

  recomputeNextExpiry() {
    const retentionMs = this.retentionMs()
    this.lastRetentionMs = retentionMs
    let nextExpiry = Number.POSITIVE_INFINITY
    for (const info of this.sessions.values()) {
      if (info.deleting) continue
      nextExpiry = Math.min(nextExpiry, info.lastUsed + retentionMs)
    }
    this.nextExpiry = nextExpiry
  }

  async getCurrentSessionId(actorHash) {
    const redisClient = this.getRedis()
    if (!redisClient?.get) return ''
    try {
      return String(await redisClient.get(currentRedisKey(actorHash)) || '')
    } catch (error) {
      logWarn(`读取当前会话失败: ${error?.message || error}`)
      return ''
    }
  }

  async setCurrentSessionId(actorHash, sessionId) {
    const redisClient = this.getRedis()
    if (!redisClient?.set) return
    try {
      await redisClient.set(currentRedisKey(actorHash), sessionId)
    } catch (error) {
      logWarn(`保存当前会话失败: ${error?.message || error}`)
    }
  }

  async clearCurrentSessionId(actorHash, sessionId) {
    const redisClient = this.getRedis()
    if (!redisClient?.get || !redisClient?.del) return
    try {
      if (await redisClient.get(currentRedisKey(actorHash)) === sessionId) {
        await redisClient.del(currentRedisKey(actorHash))
      }
    } catch (error) {
      logWarn(`清理当前会话映射失败: ${error?.message || error}`)
    }
  }

  async createSession(actorHash, sessionId) {
    const storageKey = sessionStorageKey(actorHash, sessionId)
    const directory = path.join(this.rootDirectory, storageKey)
    await mkdir(path.join(directory, 'inputs'), { recursive: true, mode: 0o700 })
    await mkdir(path.join(directory, 'outputs'), { recursive: true, mode: 0o700 })
    await mkdir(path.join(directory, '.home'), { recursive: true, mode: 0o700 })
    await mkdir(path.join(directory, '.tmp'), { recursive: true, mode: 0o700 })
    const now = this.now()
    await writeFile(
      path.join(directory, SESSION_METADATA),
      JSON.stringify({ version: 1, actorHash, sessionId }),
      { encoding: 'utf8', mode: 0o600 }
    )
    await writeFile(path.join(directory, LAST_USED_MARKER), String(now), {
      encoding: 'utf8',
      mode: 0o600
    })
    const info = {
      storageKey,
      sessionId,
      actorHash,
      directory,
      lastUsed: now,
      activeCount: 0,
      deleting: false
    }
    this.sessions.set(storageKey, info)
    this.recomputeNextExpiry()
    return info
  }

  async findSession(actorHash, sessionId) {
    const storageKey = sessionStorageKey(actorHash, sessionId)
    const cached = this.sessions.get(storageKey)
    if (cached) return cached.deleting ? null : cached
    const directory = path.join(this.rootDirectory, storageKey)
    if (!await pathExists(directory)) return null
    try {
      const metadata = JSON.parse(await readFile(path.join(directory, SESSION_METADATA), 'utf8'))
      const info = sessionInfoFromMetadata(
        this.rootDirectory,
        storageKey,
        metadata,
        await readLastUsed(directory)
      )
      if (!info || info.actorHash !== actorHash || info.sessionId !== sessionId) return null
      this.sessions.set(storageKey, info)
      this.recomputeNextExpiry()
      return info
    } catch {
      return null
    }
  }

  async resolveSession({ e, newSession = false, sessionId = '' }) {
    await this.ensureIndexed()
    if (newSession && sessionId) {
      throw new Error('new_session=true 时不能同时提供 session_id')
    }
    const actorHash = sha256(actorKeyForEvent(e))
    let selected

    if (newSession) {
      selected = await this.createSession(actorHash, randomUUID())
    } else if (sessionId) {
      const validated = validateSessionId(sessionId)
      selected = await this.findSession(actorHash, validated)
      if (!selected) throw new Error(`沙箱会话 ${validated} 不存在或已过期`)
    } else {
      const current = await this.getCurrentSessionId(actorHash)
      if (current && SESSION_ID_PATTERN.test(current)) {
        selected = await this.findSession(actorHash, current)
      }
      if (!selected) selected = await this.createSession(actorHash, randomUUID())
    }

    await this.setCurrentSessionId(actorHash, selected.sessionId)
    return selected
  }

  async touch(info) {
    const now = this.now()
    info.lastUsed = now
    try {
      await writeFile(path.join(info.directory, LAST_USED_MARKER), String(now), {
        encoding: 'utf8',
        mode: 0o600
      })
    } catch (error) {
      logWarn(`更新会话时间失败: ${error?.message || error}`)
    }
    this.recomputeNextExpiry()
  }

  async withSession(info, fn) {
    if (info.deleting) throw new Error('沙箱会话正在过期清理，请创建新会话')
    info.activeCount += 1
    const previous = this.locks.get(info.storageKey) || Promise.resolve()
    const current = previous
      .catch(() => {})
      .then(async () => {
        if (info.deleting) throw new Error('沙箱会话已过期，请创建新会话')
        try {
          return await fn(info)
        } finally {
          info.activeCount -= 1
          await this.touch(info)
        }
      })
    this.locks.set(info.storageKey, current)
    try {
      return await current
    } finally {
      if (this.locks.get(info.storageKey) === current) this.locks.delete(info.storageKey)
    }
  }

  async cleanupExpiredSessions() {
    await this.ensureIndexed()
    const retentionMs = this.retentionMs()
    const now = this.now()
    if (retentionMs === this.lastRetentionMs && now < this.nextExpiry) {
      return { checked: 0, removed: 0, nextExpiry: this.nextExpiry }
    }

    let checked = 0
    let removed = 0
    for (const info of [...this.sessions.values()]) {
      checked += 1
      if (info.activeCount > 0 || info.deleting) continue
      if (info.lastUsed + retentionMs > now) continue
      info.deleting = true
      try {
        await rm(info.directory, { recursive: true, force: true })
        this.sessions.delete(info.storageKey)
        if (info.actorHash && info.sessionId) {
          await this.clearCurrentSessionId(info.actorHash, info.sessionId)
        }
        removed += 1
      } catch (error) {
        info.deleting = false
        logError(`删除过期会话 ${info.sessionId} 失败: ${error?.message || error}`)
      }
    }
    this.recomputeNextExpiry()
    return { checked, removed, nextExpiry: this.nextExpiry }
  }
}

export const localSandboxSessionManager = new LocalSandboxSessionManager()

export async function cleanupExpiredLocalSandboxSessions() {
  return await localSandboxSessionManager.cleanupExpiredSessions()
}

async function findExecutable(command, explicitPath = '') {
  const candidate = String(explicitPath || '').trim()
  if (candidate) {
    try {
      const resolved = await realpath(candidate)
      await access(resolved, fsConstants.X_OK)
      return resolved
    } catch {
      return ''
    }
  }
  for (const directory of String(process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue
    const target = path.join(directory, command)
    try {
      await access(target, fsConstants.X_OK)
      return await realpath(target)
    } catch {}
  }
  return ''
}

async function detectChromium() {
  const configured = String(Config.localSandboxChromePath || Config.chromePath || '').trim()
  if (configured) return await findExecutable('', configured)
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const executable = await findExecutable(name)
    if (executable) return executable
  }
  return ''
}

export async function preflightLocalSandbox() {
  if (process.platform !== 'linux') {
    throw new Error('localSandbox 仅支持 Linux/WSL2；原生 Windows 不会降级为无隔离执行')
  }
  const [bwrap, prlimit, bash, node, python, npm, chromium] = await Promise.all([
    findExecutable('bwrap'),
    findExecutable('prlimit'),
    findExecutable('bash'),
    findExecutable('node'),
    findExecutable('python3'),
    findExecutable('npm'),
    detectChromium()
  ])
  const missing = [
    !bwrap && 'bubblewrap(bwrap)',
    !prlimit && 'util-linux(prlimit)',
    !bash && 'bash'
  ].filter(Boolean)
  if (missing.length) {
    throw new Error(`localSandbox 缺少必需程序: ${missing.join(', ')}`)
  }
  return { bwrap, prlimit, bash, node, python, npm, chromium }
}

function isInsideSystemRoot(target) {
  return SYSTEM_RUNTIME_ROOTS.some(root => target === root || target.startsWith(`${root}/`))
}

async function addRuntimeMount(args, executable, name, mappedDirectories) {
  if (!executable || isInsideSystemRoot(executable)) return executable
  const executableDirectory = path.dirname(executable)
  const sourceDirectory = path.basename(executableDirectory) === 'bin'
    ? path.dirname(executableDirectory)
    : executableDirectory
  if (sourceDirectory === '/' || sourceDirectory === '/home' || sourceDirectory === '/root') {
    throw new Error(`拒绝映射过宽的运行时目录: ${sourceDirectory}`)
  }
  const destination = `/opt/host-runtimes/${name}`
  args.push('--dir', destination, '--ro-bind', sourceDirectory, destination)
  const relativeExecutable = path.relative(sourceDirectory, executable).split(path.sep).join('/')
  const mappedExecutable = path.posix.join(destination, relativeExecutable)
  mappedDirectories.push(path.posix.dirname(mappedExecutable))
  return mappedExecutable
}

async function existingReadonlyPaths() {
  const result = []
  for (const target of SYSTEM_READONLY_PATHS) {
    if (await pathExists(target)) result.push(target)
  }
  return result
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function validatePackageSpecs(value, field) {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`)
  if (value.length > 32) throw new Error(`${field} 最多包含 32 个包`)
  return value.map(item => {
    const spec = String(item || '').trim()
    if (!PACKAGE_SPEC_PATTERN.test(spec)) throw new Error(`${field} 包含无效包名: ${spec.slice(0, 80)}`)
    return spec
  })
}

function buildSandboxCommand(command, pythonPackages, nodePackages, runtime) {
  const lines = [
    'set -o pipefail',
    'mkdir -p "$SANDBOX_INPUT_DIR" "$SANDBOX_OUTPUT_DIR" "$HOME" .sandbox-deps/python .sandbox-deps/node',
    'export PYTHONPATH="$PWD/.sandbox-deps/python${PYTHONPATH:+:$PYTHONPATH}"',
    'export NODE_PATH="$PWD/.sandbox-deps/node/node_modules${NODE_PATH:+:$NODE_PATH}"'
  ]
  if (pythonPackages.length) {
    if (!runtime.python) throw new Error('当前宿主未安装 python3')
    lines.push(`${shellQuote(runtime.python)} -m pip install --disable-pip-version-check --target "$PWD/.sandbox-deps/python" -- ${pythonPackages.map(shellQuote).join(' ')}`)
  }
  if (nodePackages.length) {
    if (!runtime.npm) throw new Error('当前宿主未安装 npm')
    lines.push(`${shellQuote(runtime.npm)} install --prefix "$PWD/.sandbox-deps/node" --no-audit --no-fund -- ${nodePackages.map(shellQuote).join(' ')}`)
  }
  lines.push(command)
  return lines.join('\n')
}

async function buildBubblewrapInvocation(sessionDirectory, runtime, env) {
  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-user',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-cgroup-try',
    '--cap-drop', 'ALL',
    '--hostname', 'local-sandbox',
    '--dir', '/etc',
    '--dir', '/opt',
    '--dir', '/opt/host-runtimes',
    '--dir', '/usr',
    '--dir', '/usr/local',
    '--dir', '/run',
    '--dir', '/var',
    '--dir', '/home',
    '--proc', '/proc',
    '--dev', '/dev'
  ]
  if (!Config.localSandboxNetworkEnabled) args.push('--unshare-net')

  for (const target of await existingReadonlyPaths()) {
    args.push('--ro-bind', target, target)
  }

  const mappedDirectories = []
  const mappedRuntime = {
    bash: await addRuntimeMount(args, runtime.bash, 'bash', mappedDirectories),
    node: await addRuntimeMount(args, runtime.node, 'node', mappedDirectories),
    python: await addRuntimeMount(args, runtime.python, 'python', mappedDirectories),
    npm: await addRuntimeMount(args, runtime.npm, 'npm', mappedDirectories),
    chromium: await addRuntimeMount(args, runtime.chromium, 'chromium', mappedDirectories)
  }
  const sandboxPath = [
    ...mappedDirectories,
    '/usr/local/sbin',
    '/usr/local/bin',
    '/usr/sbin',
    '/usr/bin',
    '/sbin',
    '/bin'
  ].join(':')

  args.push(
    '--bind', sessionDirectory, '/workspace',
    '--bind', path.join(sessionDirectory, '.tmp'), '/tmp',
    '--chdir', '/workspace',
    '--clearenv',
    '--setenv', 'HOME', '/workspace/.home',
    '--setenv', 'TMPDIR', '/tmp',
    '--setenv', 'XDG_CACHE_HOME', '/workspace/.home/.cache',
    '--setenv', 'PATH', sandboxPath,
    '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'LC_ALL', 'C.UTF-8'
  )
  for (const [key, value] of Object.entries(env)) {
    args.push('--setenv', key, String(value))
  }
  args.push('--setenv', 'SANDBOX_CHROMIUM', mappedRuntime.chromium || '')
  args.push(mappedRuntime.bash, '--noprofile', '--norc', '-c')
  return { args, runtime: mappedRuntime }
}

async function directorySize(directory, limit = Number.POSITIVE_INFINITY) {
  let total = 0
  const pending = [directory]
  while (pending.length) {
    const current = pending.pop()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        pending.push(target)
      } else if (entry.isFile()) {
        total += (await stat(target)).size
        if (total > limit) return total
      }
    }
  }
  return total
}

function cappedCollector(limit) {
  let length = 0
  let truncated = false
  const chunks = []
  return {
    push(chunk) {
      const buffer = Buffer.from(chunk)
      if (length >= limit) {
        truncated = true
        return
      }
      const available = limit - length
      chunks.push(buffer.subarray(0, available))
      length += Math.min(buffer.length, available)
      if (buffer.length > available) truncated = true
    },
    result() {
      return {
        text: Buffer.concat(chunks).toString('utf8'),
        truncated
      }
    }
  }
}

function killProcessTree(child) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {}
  }
}

export async function runLocalSandboxCommand(options) {
  const {
    sessionDirectory,
    command,
    timeoutSeconds = 120,
    pythonPackages = [],
    nodePackages = [],
    env = {}
  } = options
  const runtime = options.runtime || await preflightLocalSandbox()
  if ((pythonPackages.length || nodePackages.length) && !Config.localSandboxNetworkEnabled) {
    throw new Error('动态安装依赖需要先在锅巴开启“本地沙箱联网”')
  }

  const invocation = await buildBubblewrapInvocation(sessionDirectory, runtime, env)
  const sandboxCommand = buildSandboxCommand(command, pythonPackages, nodePackages, invocation.runtime)
  invocation.args.push(sandboxCommand)

  const stdout = cappedCollector(LOCAL_SANDBOX_LIMITS.stdoutBytes)
  const stderr = cappedCollector(LOCAL_SANDBOX_LIMITS.stderrBytes)
  const actualTimeout = Math.max(1, Math.min(300, Number(timeoutSeconds) || 120))
  let terminationReason = ''
  let monitorBusy = false

  return await new Promise((resolve, reject) => {
    let processClosed = false
    let storageTimer
    const child = spawn(runtime.prlimit, [
      `--as=${LOCAL_SANDBOX_LIMITS.addressSpaceBytes}`,
      `--nproc=${LOCAL_SANDBOX_LIMITS.processes}`,
      `--nofile=${LOCAL_SANDBOX_LIMITS.openFiles}`,
      '--',
      runtime.bwrap,
      ...invocation.args
    ], {
      cwd: sessionDirectory,
      detached: true,
      env: {
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)

    const timeout = setTimeout(() => {
      terminationReason = 'timeout'
      killProcessTree(child)
    }, actualTimeout * 1000)

    const monitorStorage = async () => {
      if (processClosed) return
      if (monitorBusy || terminationReason) {
        storageTimer = setTimeout(monitorStorage, 2000)
        storageTimer.unref?.()
        return
      }
      monitorBusy = true
      try {
        if (await directorySize(sessionDirectory, LOCAL_SANDBOX_LIMITS.sessionBytes) > LOCAL_SANDBOX_LIMITS.sessionBytes) {
          terminationReason = 'storage_limit'
          killProcessTree(child)
        }
      } catch (error) {
        logWarn(`检查会话空间失败: ${error?.message || error}`)
      } finally {
        monitorBusy = false
      }
      if (!processClosed) {
        storageTimer = setTimeout(monitorStorage, 2000)
        storageTimer.unref?.()
      }
    }
    storageTimer = setTimeout(monitorStorage, 2000)
    storageTimer.unref?.()

    child.once('close', async (exitCode, signal) => {
      processClosed = true
      clearTimeout(timeout)
      clearTimeout(storageTimer)
      if (!terminationReason) {
        try {
          if (await directorySize(sessionDirectory, LOCAL_SANDBOX_LIMITS.sessionBytes) > LOCAL_SANDBOX_LIMITS.sessionBytes) {
            terminationReason = 'storage_limit'
          }
        } catch (error) {
          logWarn(`命令结束后检查会话空间失败: ${error?.message || error}`)
        }
      }
      const out = stdout.result()
      const err = stderr.result()
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : -1,
        signal,
        stdout: out.text,
        stderr: err.text,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
        terminationReason,
        runtime: {
          node: !!runtime.node,
          python: !!runtime.python,
          npm: !!runtime.npm,
          chromium: !!runtime.chromium
        }
      })
    })
  })
}

function safeRelativeInputPath(value) {
  const normalized = path.posix.normalize(String(value || '').replace(/\\/g, '/'))
  if (!normalized.startsWith('inputs/') || normalized.includes('..') || path.posix.isAbsolute(normalized)) {
    throw new Error(`无效输入路径: ${value}`)
  }
  return normalized
}

async function fetchInput(url, maxBytes) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    let currentUrl = new URL(url)
    let response
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await assertSafeInputUrl(currentUrl)
      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual'
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      if (!location) throw new Error('附件重定向缺少 Location')
      response.body?.destroy?.()
      currentUrl = new URL(location, currentUrl)
      if (redirects === 5) throw new Error('附件重定向次数过多')
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const declaredSize = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new Error(`附件超过 ${Math.floor(maxBytes / 1024 / 1024)}MB`)
    }
    const chunks = []
    let totalBytes = 0
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > maxBytes) {
        controller.abort()
        throw new Error(`附件超过 ${Math.floor(maxBytes / 1024 / 1024)}MB`)
      }
      chunks.push(buffer)
    }
    return Buffer.concat(chunks, totalBytes)
  } finally {
    clearTimeout(timer)
  }
}

function isPrivateNetworkAddress(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0]
  if (isIP(normalized) === 4) {
    const parts = normalized.split('.').map(Number)
    const [a, b] = parts
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (isIP(normalized) === 6) {
    if (normalized.startsWith('::ffff:')) {
      return isPrivateNetworkAddress(normalized.slice('::ffff:'.length))
    }
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff')
    )
  }
  return true
}

async function assertSafeInputUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('附件地址必须是无凭据的 HTTP/HTTPS URL')
  }
  if (Config.localSandboxNetworkEnabled) return
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (hostname.toLowerCase() === 'localhost') throw new Error('默认禁网时不允许读取本机附件 URL')
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(item => isPrivateNetworkAddress(item.address))) {
    throw new Error('默认禁网时不允许读取本地或私有网络附件 URL')
  }
}

export async function resetSessionExchangeDirectories(sessionDirectory) {
  for (const name of ['inputs', 'outputs', '.tmp']) {
    const target = path.join(sessionDirectory, name)
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true, mode: 0o700 })
  }
}

export async function materializePreparedInputs(sessionDirectory, preparedInputs) {
  let totalBytes = 0
  for (const input of preparedInputs.inputFiles || []) {
    const relativePath = safeRelativeInputPath(input.path)
    const buffer = Buffer.from(String(input.content_base64 || ''), 'base64')
    if (buffer.length > LOCAL_SANDBOX_LIMITS.inputFileBytes) throw new Error(`输入文件 ${relativePath} 超过限制`)
    totalBytes += buffer.length
    if (totalBytes > LOCAL_SANDBOX_LIMITS.inputTotalBytes) throw new Error('输入附件总大小超过 64MB')
    const target = path.join(sessionDirectory, ...relativePath.split('/'))
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, buffer, { mode: 0o600 })
  }
  for (const input of preparedInputs.inputUrls || []) {
    const relativePath = safeRelativeInputPath(input.path)
    const buffer = await fetchInput(input.url, LOCAL_SANDBOX_LIMITS.inputFileBytes)
    totalBytes += buffer.length
    if (totalBytes > LOCAL_SANDBOX_LIMITS.inputTotalBytes) throw new Error('输入附件总大小超过 64MB')
    const target = path.join(sessionDirectory, ...relativePath.split('/'))
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, buffer, { mode: 0o600 })
  }
}

function mimeTypeForFile(filename) {
  const extension = path.extname(filename).toLowerCase()
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip'
  }[extension] || 'application/octet-stream'
}

export async function collectLocalSandboxOutputs(sessionDirectory) {
  const outputDirectory = path.join(sessionDirectory, 'outputs')
  const pending = [outputDirectory]
  const files = []
  let totalBytes = 0

  while (pending.length) {
    const current = pending.pop()
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        pending.push(target)
        continue
      }
      if (!entry.isFile()) continue
      const fileStat = await lstat(target)
      if (!fileStat.isFile()) continue
      if (fileStat.size > LOCAL_SANDBOX_LIMITS.outputFileBytes) {
        throw new Error(`输出文件 ${entry.name} 超过 64MB`)
      }
      totalBytes += fileStat.size
      if (totalBytes > LOCAL_SANDBOX_LIMITS.outputTotalBytes) throw new Error('输出文件总大小超过 64MB')
      if (files.length >= LOCAL_SANDBOX_LIMITS.outputFiles) throw new Error('输出文件数量超过 32 个')
      const relativePath = path.relative(sessionDirectory, target).split(path.sep).join('/')
      files.push({
        path: relativePath,
        name: safeOutputName(relativePath, files.length),
        local_path: target,
        mime_type: mimeTypeForFile(entry.name),
        size: fileStat.size
      })
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export function validateLocalSandboxPackages(args = {}) {
  return {
    pythonPackages: validatePackageSpecs(args.python_packages, 'python_packages'),
    nodePackages: validatePackageSpecs(args.node_packages, 'node_packages')
  }
}
