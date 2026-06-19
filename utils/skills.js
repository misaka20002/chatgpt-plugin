import path from 'node:path'
import fs from 'node:fs'
import { fetchAndExtractZip } from './compress.js'
import { Config } from './config.js'

const SKILLS_BASE = path.resolve(process.cwd(), 'plugins', 'chatgpt-plugin', 'data', 'skills')
const INSTALL_DIR = path.join(SKILLS_BASE, 'installed')
const CACHE_DIR = path.join(SKILLS_BASE, 'cache')
const REPO_MONITORS_DIR = path.join(CACHE_DIR, 'repo-monitors')
const MANAGED_FILE = path.join(SKILLS_BASE, 'managed.json')
const REPO_MONITORS_FILE = path.join(SKILLS_BASE, 'skill_repos.json')

const BRANCH_CANDIDATES = ['main', 'master']

// managed.json 串行写入队列 — 确保多个 install/disable/enable/uninstall 操作不会并发读写同一文件
let _managedMutex = Promise.resolve()
function _withManagedMutex(fn) {
  const p = _managedMutex.then(fn, fn)
  _managedMutex = p.then(() => {}, () => {})
  return p
}

export function getGithubToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || Config.githubAPIKey || ''
}

function sanitizeInstallName(name) {
  if (!name) throw new Error('install_name 不能为空')
  const trimmed = String(name).trim().replace(/\s+/g, '-')
  if (trimmed.startsWith('.')) throw new Error(`install_name 不能以 . 开头: ${name}`)
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error(`install_name 含非法字符: ${name}`)
  }
  return trimmed
}

function sanitizeRelativePath(p) {
  if (!p) return ''
  if (path.isAbsolute(p) || p.includes('..')) {
    throw new Error(`illegal relative path: ${p}`)
  }
  return p.trim()
}

function readManaged() {
  if (!fs.existsSync(MANAGED_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(MANAGED_FILE, 'utf8')) || []
  } catch (e) {
    logger.warn(`[skills] managed.json parse failed: ${e.message}`)
    return []
  }
}

function writeManaged(list) {
  fs.mkdirSync(path.dirname(MANAGED_FILE), { recursive: true })
  fs.writeFileSync(MANAGED_FILE, JSON.stringify(list, null, 2))
}

export function readRepoMonitors() {
  if (!fs.existsSync(REPO_MONITORS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(REPO_MONITORS_FILE, 'utf8')) || []
  } catch (e) {
    logger.warn(`[skills] skill_repos.json parse failed: ${e.message}`)
    return []
  }
}

function writeRepoMonitors(list) {
  fs.mkdirSync(path.dirname(REPO_MONITORS_FILE), { recursive: true })
  fs.writeFileSync(REPO_MONITORS_FILE, JSON.stringify(list, null, 2))
}

function parseSkillFrontmatter(skillMdPath) {
  if (!fs.existsSync(skillMdPath)) return null
  const content = fs.readFileSync(skillMdPath, 'utf8')
  if (!content.startsWith('---')) return { name: '', description: '' }
  const end = content.indexOf('\n---', 3)
  if (end === -1) return { name: '', description: '' }
  const front = content.slice(3, end)
  const lines = front.split('\n')
  const meta = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (!m) { i++; continue }
    const key = m[1]
    let value = m[2].replace(/^["']|["']$/g, '')

    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const blockLines = []
      i++
      while (i < lines.length) {
        const next = lines[i]
        if (/^\s+/.test(next)) {
          blockLines.push(next.replace(/^\s+/, ''))
          i++
        } else break
      }
      value = blockLines.join(value.startsWith('>') ? ' ' : '\n').trim()
    } else {
      i++
    }

    if (!(key in meta)) meta[key] = value
  }
  return meta
}

function parseInput(input) {
  const trimmed = String(input).trim()
  if (!trimmed) return null
  const parts = trimmed.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const [owner, repo, ...rest] = parts
  return {
    owner: sanitizeRelativePath(owner),
    repo: sanitizeRelativePath(repo),
    skill_id: rest.length ? sanitizeRelativePath(rest.join('/')) : null,
    branch: null
  }
}

export async function resolveBySkillsSh(query) {
  const url = `https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'chatgpt-plugin-skills-sync' },
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) throw new Error(`skills.sh 搜索失败: ${res.status}`)
  const data = await res.json()
  const skills = data.skills || []
  const hit = skills.find(s => {
    const [owner, repo] = (s.source || '').split('/')
    return owner && repo && !owner.includes('.') && !repo.includes('.')
  })
  if (!hit) throw new Error(`skills.sh 无 GitHub 源匹配: ${query}`)
  const [owner, repo] = hit.source.split('/')
  return {
    owner,
    repo,
    skill_id: hit.skillId || hit.name || null,
    branch: null
  }
}

function findSkillDirByName(root, name) {
  const target = name.toLowerCase()
  function walk(dir, depth) {
    if (depth > 3) return null
    if (!fs.existsSync(dir)) return null
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.name.toLowerCase() === target) return fullPath
      const nested = walk(fullPath, depth + 1)
      if (nested) return nested
    }
    return null
  }
  return walk(root, 0)
}

function findFirstSkillDir(root) {
  function walk(dir, depth) {
    if (depth > 3) return null
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) return dir
    if (!fs.existsSync(dir)) return null
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const nested = walk(path.join(dir, entry.name), depth + 1)
      if (nested) return nested
    }
    return null
  }
  return walk(root, 0)
}

function resolveSkillSourceDir(extractRoot, skillId) {
  if (skillId) {
    const exact = path.join(extractRoot, skillId)
    if (fs.existsSync(path.join(exact, 'SKILL.md'))) return exact
    const found = findSkillDirByName(extractRoot, skillId)
    if (found && fs.existsSync(path.join(found, 'SKILL.md'))) return found
  } else {
    if (fs.existsSync(path.join(extractRoot, 'SKILL.md'))) return extractRoot
    const found = findFirstSkillDir(extractRoot)
    if (found) return found
  }
  return null
}

const UA = 'chatgpt-plugin-skills-sync'

async function tryDownloadAndExtract(owner, repo, branch, destDir) {
  const branches = [...new Set([branch, ...BRANCH_CANDIDATES].filter(Boolean))]
  let lastErr = null
  for (const b of branches) {
    const url = `https://github.com/${owner}/${repo}/archive/refs/heads/${b}.zip`
    const headers = { 'User-Agent': UA }
    const token = getGithubToken()
    if (token) headers.Authorization = `Bearer ${token}`
    try {
      await fetchAndExtractZip(url, destDir, { headers, timeoutMs: 60000 })
      return b
    } catch (e) {
      lastErr = e
      logger.warn(`[skills] download ${owner}/${repo}@${b} failed: ${e.message}`)
    }
  }
  throw lastErr || new Error(`download failed: ${owner}/${repo}`)
}

export async function installFromGithub({ owner, repo, skill_id, branch }) {
  const tmpDir = path.join(CACHE_DIR, `.staging-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  try {
    const usedBranch = await tryDownloadAndExtract(owner, repo, branch, tmpDir)
    const entries = fs.readdirSync(tmpDir)
    const rootName = entries.length === 1 && fs.statSync(path.join(tmpDir, entries[0])).isDirectory()
      ? entries[0] : ''
    const extractRoot = rootName ? path.join(tmpDir, rootName) : tmpDir

    const srcDir = resolveSkillSourceDir(extractRoot, skill_id)
    if (!srcDir) {
      throw new Error(`未在 ${owner}/${repo} 找到 SKILL.md；如为合集 repo，请用 owner/repo/<skill_id> 格式指定子目录`)
    }

    const meta = parseSkillFrontmatter(path.join(srcDir, 'SKILL.md')) || {}
    const rawName = meta.name || skill_id || repo
    const installName = sanitizeInstallName(rawName)

    // managed.json 操作串行化，避免并发写入覆盖
    await _withManagedMutex(() => {
      const managed = readManaged()
      const existing = managed.find(m => m.install_name === installName)
      if (existing && existing.owner && existing.repo &&
          (existing.owner !== owner || existing.repo !== repo)) {
        throw new Error(`install_name 冲突: ${installName} 已被 ${existing.owner}/${existing.repo} 占用`)
      }

      const destDir = path.join(INSTALL_DIR, installName)
      fs.mkdirSync(INSTALL_DIR, { recursive: true })
      fs.rmSync(destDir, { recursive: true, force: true })
      fs.cpSync(srcDir, destDir, { recursive: true })

      if (existing) {
        existing.owner = owner
        existing.repo = repo
        existing.skill_id = skill_id
        existing.branch = usedBranch
        existing.source_type = 'github'
        existing.installed_at = Date.now()
        existing.disabled = false
        existing.description = meta.description || existing.description || ''
      } else {
        managed.push({
          install_name: installName,
          owner,
          repo,
          skill_id,
          branch: usedBranch,
          source_type: 'github',
          installed_at: Date.now(),
          disabled: false,
          description: meta.description || ''
        })
      }
      writeManaged(managed)
    })
    logger.mark(`[skills] installed: ${installName} (${owner}/${repo}${skill_id ? `/${skill_id}` : ''})`)
    return { install_name: installName, owner, repo, branch: usedBranch }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

export async function installSkillFromInput(input) {
  let parsed = parseInput(input)
  if (!parsed) {
    parsed = await resolveBySkillsSh(input)
  }
  return installFromGithub(parsed)
}

export async function disableSkill(installName) {
  const safe = sanitizeInstallName(installName)
  await _withManagedMutex(() => {
    const managed = readManaged()
    let item = managed.find(m => m.install_name === safe)
    if (!item) {
      const skillMdPath = path.join(INSTALL_DIR, safe, 'SKILL.md')
      const meta = parseSkillFrontmatter(skillMdPath) || {}
      item = {
        install_name: safe,
        owner: null,
        source_type: 'local',
        installed_at: Date.now(),
        disabled: false,
        description: meta.description || ''
      }
      managed.push(item)
    }
    item.disabled = true
    writeManaged(managed)
  })
  logger.mark(`[skills] disabled: ${safe} (directory preserved)`)
  return true
}

export async function enableSkill(installName) {
  const safe = sanitizeInstallName(installName)
  const found = await _withManagedMutex(() => {
    const managed = readManaged()
    const item = managed.find(m => m.install_name === safe)
    if (!item) return false
    item.disabled = false
    writeManaged(managed)
    return true
  })
  if (found) logger.mark(`[skills] enabled: ${safe}`)
  return found
}

export async function uninstallSkill(installName) {
  const safe = sanitizeInstallName(installName)
  const destDir = path.join(INSTALL_DIR, safe)
  fs.rmSync(destDir, { recursive: true, force: true })
  await _withManagedMutex(() => {
    const managed = readManaged().filter(m => m.install_name !== safe)
    writeManaged(managed)
  })
  logger.mark(`[skills] uninstalled: ${safe}`)
  return true
}

export function scanInstalledSkills() {
  if (!fs.existsSync(INSTALL_DIR)) return []
  const managed = readManaged()
  const disabledNames = new Set(managed.filter(m => m.disabled).map(m => m.install_name))

  const skills = []
  for (const entry of fs.readdirSync(INSTALL_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const skillMdPath = path.join(INSTALL_DIR, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) continue

    const meta = parseSkillFrontmatter(skillMdPath)
    const installName = entry.name
    skills.push({
      install_name: installName,
      name: meta?.name || installName,
      description: meta?.description || '',
      disabled: disabledNames.has(installName)
    })
  }
  return skills
}

function atomicReplaceDir(newDir, targetDir) {
  const oldDir = targetDir + '.old'
  fs.rmSync(oldDir, { recursive: true, force: true })
  if (fs.existsSync(targetDir)) fs.renameSync(targetDir, oldDir)
  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  fs.renameSync(newDir, targetDir)
  fs.rmSync(oldDir, { recursive: true, force: true })
}

function scanAllSkillDirs(root) {
  const results = []
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
      results.push(dir)
      return
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      walk(path.join(dir, entry.name))
    }
  }
  walk(root)
  return results
}

export async function refreshRepoMonitors() {
  const repos = readRepoMonitors().filter(r => r.enabled !== false)
  const allCandidates = []

  for (const repo of repos) {
    const targetDir = path.join(REPO_MONITORS_DIR, `${repo.owner}__${repo.repo}`)
    const tmpDir = path.join(REPO_MONITORS_DIR, `.staging-${repo.owner}-${repo.repo}`)

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      await tryDownloadAndExtract(repo.owner, repo.repo, repo.branch, tmpDir)

      const entries = fs.readdirSync(tmpDir)
      const rootName = entries.length === 1 && fs.statSync(path.join(tmpDir, entries[0])).isDirectory()
        ? entries[0] : ''
      const extractRoot = rootName ? path.join(tmpDir, rootName) : tmpDir

      atomicReplaceDir(extractRoot, targetDir)

      const found = scanAllSkillDirs(targetDir)
      for (const dir of found) {
        const meta = parseSkillFrontmatter(path.join(dir, 'SKILL.md')) || {}
        allCandidates.push({
          install_name: meta.name || path.basename(dir),
          description: meta.description || '',
          source: `${repo.owner}/${repo.repo}`,
          skill_id: path.relative(targetDir, dir) || null
        })
      }
      logger.mark(`[skills] repo-monitor ${repo.owner}/${repo.repo} 刷新完成，扫到 ${found.length} 个候选`)
    } catch (e) {
      logger.warn(`[skills] repo-monitor ${repo.owner}/${repo.repo} 刷新失败，保留旧缓存: ${e.message}`)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }
  return allCandidates
}

export function listInstalledForGuoba() {
  return scanInstalledSkills()
}

export function saveRepoMonitors(repos) {
  const sanitized = (repos || []).filter(r => r && r.owner && r.repo).map(r => ({
    owner: sanitizeRelativePath(r.owner),
    repo: sanitizeRelativePath(r.repo),
    branch: r.branch || 'main',
    enabled: r.enabled !== false
  }))
  writeRepoMonitors(sanitized)
  return sanitized
}
