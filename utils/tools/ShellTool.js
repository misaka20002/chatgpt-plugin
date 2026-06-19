import { AbstractTool } from './AbstractTool.js'
import { spawn } from 'child_process'
import { Config } from '../config.js'
import { CommandReviewer } from '../skills/CommandReviewer.js'

export class ShellTool extends AbstractTool {
  name = 'execute_shell'
  parameters = {
    properties: {
      command: {
        type: 'string',
        description: 'Executable name only, e.g. "smart-search". Do NOT include arguments or spaces here. The binary must exist in PATH.'
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command arguments as separate string elements. Split flags and values: ["doctor","--format","json"], NOT ["doctor --format json"].'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in ms (default 30000, max 120000).'
      }
    },
    required: ['command', 'args']
  }
  description = `Execute a shell command under three layers of protection (whitelist → SubLLM review → spawn).
Used to run CLI-based Agent Skills (e.g. smart-search, git) that the AI learned about from skill_read_file.

CRITICAL input rules:
- command: ONLY the binary name. "smart-search" OK. "smart-search doctor" WRONG (will ENOENT).
- args: each flag/value as its own array element. ["search","比特币","--format","json"] OK. ["search 比特币 --format json"] WRONG.
- No shell features: pipes (|), redirects (>), &&, backticks, $() are NOT processed (shell:false).

Three layers of protection:
1. If command is in shellToolAllowedCommands (default ["smart-search"]), execute immediately.
2. Otherwise SubLLM CommandReviewer evaluates user authorization + risk (Codex auto_review framework).
3. Only on approve (or whitelist hit) does cross-platform spawn execute.

Output: stdout+stderr truncated to 20k chars, exit code included. Non-zero exit returns status="error" but still returns output.`

  constructor() {
    super()
    const whitelist = Array.isArray(Config.shellToolAllowedCommands)
      ? Config.shellToolAllowedCommands
      : ['smart-search']
    this.whitelist = whitelist
    this.reviewer = Config.enableCommandReview ? new CommandReviewer() : null
    this.defaultTimeout = Math.min(Number(Config.shellToolTimeout) || 30000, 120000)
  }

  func = async function (opts, e) {
    const { command, args } = opts
    if (!command || typeof command !== 'string') {
      return JSON.stringify({ status: 'invalid_input', error: 'command (string) required' })
    }
    // 拒绝任何包含 shell 特征字符的 command（避免 LLM 试图注入复合命令）
    if (/[|&;>$`\n\r]/.test(command) || command.includes('..')) {
      return JSON.stringify({ status: 'blocked', reason: 'command contains shell metacharacters' })
    }
    const safeArgs = Array.isArray(args) ? args.filter(a => typeof a === 'string') : []

    // 1. 白名单检查
    if (this.whitelist.includes(command)) {
      return await this._spawn(command, safeArgs, opts.timeout)
    }

    // 2. CommandReviewer（如果启用）
    if (this.reviewer) {
      let review
      try {
        review = await this.reviewer.review(command, safeArgs, {
          e,
          userMessage: e?.msg?.text || '',
          cwd: process.cwd()
        })
      } catch (err) {
        // 审核异常默认 ask_user，绝不放行
        return JSON.stringify({
          status: 'review_error',
          error: err.message,
          action: 'ask_user'
        })
      }

      if (review.outcome !== 'approve') {
        return JSON.stringify({
          status: 'denied',
          outcome: review.outcome,
          risk_level: review.risk_level,
          user_authorization: review.user_authorization,
          reason: review.reason
        })
      }
    } else {
      // 非白名单 + 未启用审核 → 保守拒绝
      return JSON.stringify({
        status: 'denied',
        reason: 'not in whitelist and command review disabled'
      })
    }

    // 3. spawn 执行
    return await this._spawn(command, safeArgs, opts.timeout)
  }

  async _spawn(command, args, timeoutOverride) {
    const timeout = Math.min(Number(timeoutOverride) || this.defaultTimeout, 120000)
    const isWin = process.platform === 'win32'

    // Windows 兼容：尝试补 .cmd/.bat 扩展名，使 PATH 中的脚本能正确执行
    let cmd = command
    if (isWin && !/\.(exe|cmd|bat)$/i.test(command)) {
      const { execFileSync } = await import('child_process')
      try {
        // 先试原 command；找不到时尝试依次补 .cmd / .bat
        const extOrder = ['.cmd', '.bat', '.exe']
        let found = false
        try { execFileSync(command, ['--version'], { shell: false, stdio: 'ignore', timeout: 2000 }); found = true } catch {}
        if (!found) {
          for (const ext of extOrder) {
            try {
              execFileSync(command + ext, ['--version'], { shell: false, stdio: 'ignore', timeout: 2000 })
              cmd = command + ext
              found = true
              break
            } catch {}
          }
          if (!found) cmd = command // 都不行，保留原值让 spawn 抛 ENOENT
        }
      } catch {
        // 探测失败仍用原 command
        cmd = command
      }
    }

    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: process.cwd(),
        env: process.env,
        shell: false,
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      const MAX = 20000

      child.stdout.on('data', (chunk) => {
        if (stdout.length < MAX) stdout += chunk.toString('utf8').slice(0, MAX - stdout.length)
      })
      child.stderr.on('data', (chunk) => {
        if (stderr.length < MAX) stderr += chunk.toString('utf8').slice(0, MAX - stderr.length)
      })

      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        resolve(JSON.stringify({
          status: 'timeout',
          stdout: stdout.slice(0, MAX),
          stderr: stderr.slice(0, MAX),
          exit_code: null,
          timed_out_at: timeout
        }))
      }, timeout)

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve(JSON.stringify({
          status: 'spawn_error',
          error: err.message,
          code: err.code
        }))
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(JSON.stringify({
          status: code === 0 ? 'ok' : 'error',
          stdout: stdout.slice(0, MAX),
          stderr: stderr.slice(0, MAX),
          exit_code: code
        }))
      })
    })
  }
}
