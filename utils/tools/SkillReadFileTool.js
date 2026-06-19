import { AbstractTool } from './AbstractTool.js'
import path from 'node:path'
import fs from 'node:fs'
import { Config } from '../config.js'

const SKILLS_INSTALL_DIR = path.resolve(process.cwd(), 'plugins', 'chatgpt-plugin', 'data', 'skills', 'installed')

export class SkillReadFileTool extends AbstractTool {
  name = 'skill_read_file'
  parameters = {
    properties: {
      skill_name: { type: 'string', description: 'Skill name from the list below' },
      file_path: {
        type: 'string',
        description: 'Optional relative path within skill dir, default "SKILL.md". Supports references/xxx.md, assets/xxx.json etc.'
      }
    },
    required: ['skill_name']
  }

  // NOTE: description 不用 getter——AbstractTool 的 description = '' 类字段会在实例化时遮蔽原型 getter
  constructor(skills = [], userMessage = '') {
    super()
    this.skills = skills
    this.currentUserMessage = userMessage || ''
    const mode = Config.skillsPromptInjectMode || 'all'
    let filtered = skills
    if (mode === 'match') {
      const matched = this._filterByKeywords(skills, this.currentUserMessage)
      filtered = matched.length > 0 ? matched : skills  // 零命中回退全量，避免模型误判无可用 skill
    }
    const listText = filtered.length
      ? filtered.map(s => `- ${s.name}: ${s.description}`).join('\n')
      : '(no skills installed)'

    this.description = `Access installed Agent Skills (procedural knowledge resources, NOT callable functions).

Available skills in this session:
${listText}

Use this tool to READ a skill's instructions before acting on a task that matches the skill's description. The skill content is markdown, follow its instructions using your other tools (including execute_shell for CLI skills).

Usage:
- skill_name: pick from the list above
- file_path: optional, defaults to "SKILL.md"; use for progressive disclosure (references/xxx.md, assets/xxx.json)

Skills are knowledge resources, not function calls. Reading does not execute code.`
  }

  _filterByKeywords(skills, message) {
    if (!message) return skills
    const msgLower = message.toLowerCase()
    const keywords = msgLower.split(/\s+/).filter(kw => kw.length > 2)
    if (keywords.length === 0) return skills
    return skills.filter(s => {
      const blob = (s.name + ' ' + s.description).toLowerCase()
      return keywords.some(kw => blob.includes(kw))
    })
  }

  func = async function (opts) {
    const { skill_name, file_path } = opts
    if (!skill_name || typeof skill_name !== 'string') return 'Error: skill_name required'
    if (/[\\/]/.test(skill_name) || skill_name.includes('..')) {
      return 'Error: invalid skill_name (path traversal blocked)'
    }
    const normalizedFilePath = file_path || 'SKILL.md'
    const pathSegs = normalizedFilePath.split(/[\\/]/)
    if (pathSegs.some(seg => seg === '..') || path.isAbsolute(normalizedFilePath)) {
      return 'Error: invalid file_path (path traversal blocked)'
    }

    const skillBase = path.join(SKILLS_INSTALL_DIR, skill_name)
    const fullPath = path.resolve(skillBase, normalizedFilePath)
    if (!fullPath.startsWith(skillBase + path.sep) && fullPath !== skillBase) {
      return 'Error: file_path escapes skill directory'
    }

    try {
      if (!fs.existsSync(fullPath)) return `Error: file not found: ${normalizedFilePath}`
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) return `Error: ${normalizedFilePath} is a directory, expected a file`
      const content = fs.readFileSync(fullPath, 'utf-8')
      return content.length > 30000 ? content.slice(0, 30000) + '\n...(truncated)' : content
    } catch (err) {
      return `Error reading ${skill_name}/${normalizedFilePath}: ${err.message}`
    }
  }
}
