import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import fetch from 'node-fetch'
import { Config } from '../config.js'
import { makeForwardMsg } from '../common.js'
import { hidePrivacyInfo } from '../paimonFuction.js'
import {
  prepareInputs,
  processOutputFiles,
  readStreamResponse,
  validatedApiUrl
} from '../sandboxIO.js'
import {
  clearCurrentRemoteSandboxSession,
  getCurrentRemoteSandboxSession,
  remoteSandboxOwnerKey,
  resolveRemoteSandboxSelection,
  setCurrentRemoteSandboxSession
} from '../remoteSandboxSession.js'
import { buildSandboxSubAgentPlan } from '../sandboxSubAgent.js'
import { AbstractTool } from './AbstractTool.js'

const MAX_CALL_FORWARD_CHARS = 6000

function buildCallForwardBatches(command, result) {
  const sourceMessage = `执行源码：\n${command || '(空)'}`
  const resultMessage = `执行结果：\n${hidePrivacyInfo(String(result ?? ''))}`
  if (sourceMessage.length + resultMessage.length <= MAX_CALL_FORWARD_CHARS) {
    return [{ title: '远程沙箱调用', messages: [sourceMessage, resultMessage] }]
  }
  return [
    { title: '远程沙箱调用 1/2（源码）', messages: [sourceMessage] },
    { title: '远程沙箱调用 2/2（结果）', messages: [resultMessage] }
  ]
}

async function sendCallForward(e, command, result) {
  if (!Config.remoteSandboxSendCallForward || !e?.reply) return
  try {
    for (const batch of buildCallForwardBatches(command, result)) {
      await e.reply(await makeForwardMsg(e, batch.messages, batch.title))
    }
  } catch (error) {
    globalThis.logger?.warn?.(`[remoteSandbox] 发送源码与结果合并转发失败: ${error?.message || error}`)
  }
}

function emptyPreparedInputs() {
  return {
    inputUrls: [],
    inputFiles: [],
    imagePaths: [],
    mediaPaths: [],
    inputPaths: []
  }
}

function requestPayload({
  args,
  command,
  ownerKey,
  preparedInputs,
  selection
}) {
  return {
    command,
    new_session: selection.newSession,
    session_id: selection.sessionId || undefined,
    replace_session_id: selection.replaceSessionId || undefined,
    owner_key: ownerKey,
    timeout_seconds: Math.max(1, Math.min(300, Number(args.timeout_seconds) || 120)),
    python_packages: Array.isArray(args.python_packages) ? args.python_packages : [],
    node_packages: Array.isArray(args.node_packages) ? args.node_packages : [],
    input_urls: preparedInputs.inputUrls,
    input_files: preparedInputs.inputFiles,
    output_files: ['outputs/*', 'outputs/**/*'],
    env: {
      SANDBOX_INPUT_IMAGES: JSON.stringify(preparedInputs.imagePaths),
      SANDBOX_INPUT_MEDIA: JSON.stringify(preparedInputs.mediaPaths),
      SANDBOX_INPUT_FILES: JSON.stringify(preparedInputs.inputPaths)
    }
  }
}

async function parseErrorResponse(response) {
  const text = await response.text()
  try {
    const body = JSON.parse(text)
    const detail = body?.detail
    return {
      code: typeof detail === 'object' ? detail?.code : '',
      message: typeof detail === 'object'
        ? detail?.message || JSON.stringify(detail)
        : detail || text
    }
  } catch {
    return { code: '', message: text }
  }
}

async function executeRemoteRequest(apiUrl, token, payload, signal) {
  return await fetch(`${apiUrl}/v1/exec-stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal
  })
}

export class RemoteSandboxTool extends AbstractTool {
  name = 'remoteSandbox'

  description = '将任务交给持久化 Docker 远程沙箱完成，适合联网执行、持续文件工作、编译和真实网页渲染。说明目标与期望交付物即可。'

  parameters = {
    properties: {
      task: {
        type: 'string',
        description: '要完成的自然语言任务，以及需要回复或交付给用户的结果。'
      }
    },
    required: ['task']
  }

  func = async function (args, e) {
    let planned
    try {
      planned = await buildSandboxSubAgentPlan('remote', args?.task, e)
      args = planned.plan
    } catch (error) {
      return `远程沙箱子代理规划失败: ${error?.message || error}`
    }
    const command = args.command
    const finish = async result => {
      await sendCallForward(e, command, result)
      return result
    }

    const apiUrl = validatedApiUrl(Config.remoteSandboxApiUrl)
    const token = String(Config.remoteSandboxToken || '').trim()
    if (!apiUrl) return await finish('remoteSandbox 尚未配置有效的 API URL，请在锅巴中填写 remoteSandboxApiUrl。')
    if (!token) return await finish('remoteSandbox 尚未配置鉴权 Token，请在锅巴中填写 remoteSandboxToken。')
    if (!command) return await finish('command is required')
    let resolvedSelection
    try {
      const ownerKey = remoteSandboxOwnerKey(e)
      const currentSessionId = await getCurrentRemoteSandboxSession(ownerKey)
      resolvedSelection = {
        ownerKey,
        currentSessionId,
        ...resolveRemoteSandboxSelection(args, currentSessionId)
      }
    } catch (error) {
      return await finish(`远程沙箱会话错误: ${error?.message || error}`)
    }

    const {
      ownerKey,
      currentSessionId,
      implicitResume
    } = resolvedSelection
    let { selection } = resolvedSelection

    const preparedInputs = args?.use_message_images === false
      ? emptyPreparedInputs()
      : await prepareInputs(e)
    const timeoutSeconds = Math.max(1, Math.min(300, Number(args.timeout_seconds) || 120))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), (timeoutSeconds + 180) * 1000)
    let temporaryDirectory

    try {
      let payload = requestPayload({
        args,
        command,
        ownerKey,
        preparedInputs,
        selection
      })
      let response = await executeRemoteRequest(apiUrl, token, payload, controller.signal)

      if (!response.ok) {
        const error = await parseErrorResponse(response)
        if (response.status === 404 && error.code === 'session_not_found' && implicitResume) {
          await clearCurrentRemoteSandboxSession(ownerKey, currentSessionId)
          selection = { newSession: true, sessionId: '', replaceSessionId: '' }
          payload = requestPayload({
            args,
            command,
            ownerKey,
            preparedInputs,
            selection
          })
          response = await executeRemoteRequest(apiUrl, token, payload, controller.signal)
        } else {
          return await finish(`远程沙箱请求失败，HTTP ${response.status}: ${error.message.slice(0, 1000)}`)
        }
      }

      if (!response.ok) {
        const error = await parseErrorResponse(response)
        return await finish(`远程沙箱请求失败，HTTP ${response.status}: ${error.message.slice(0, 1000)}`)
      }

      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'remote-sandbox-'))
      const { result, files } = await readStreamResponse(response, temporaryDirectory)
      await setCurrentRemoteSandboxSession(ownerKey, result.session_id)

      const { sent, sendErrors } = await processOutputFiles(e, files, {
        sendMedia: args?.send_output_media !== false && args?.send_output_images !== false,
        sendFiles: args?.send_output_files !== false
      })
      const totalSent = sent.images + sent.videos + sent.audios + sent.files
      const success = result.exit_code === 0 && result.status === 'completed'

      return await finish(JSON.stringify({
        success,
        status: result.status,
        exit_code: result.exit_code,
        session_id: result.session_id,
        session_created: result.session_created,
        replaced_session_id: result.replaced_session_id,
        replaced_session_removed: result.replaced_session_removed,
        expires_at: result.expires_at,
        stdout: result.stdout,
        stderr: result.stderr,
        output_truncated: result.output_truncated,
        input_images: preparedInputs.imagePaths,
        input_media: preparedInputs.mediaPaths,
        input_files: preparedInputs.inputPaths,
        output_files: files.map(file => ({
          path: file.path,
          mime_type: file.mime_type,
          size: file.size
        })),
        images_sent: sent.images,
        videos_sent: sent.videos,
        audios_sent: sent.audios,
        files_sent: sent.files,
        send_errors: sendErrors,
        files_truncated: result.files_truncated,
        message: totalSent > 0
          ? `已直接发送 ${sent.images} 张图片、${sent.videos} 个视频、${sent.audios} 个音频和 ${sent.files} 个附件，无需再次调用发送工具`
          : undefined
      }))
    } catch (error) {
      if (error?.name === 'AbortError') return await finish('远程沙箱请求超时')
      return await finish(`远程沙箱调用失败: ${error?.message || error}`)
    } finally {
      clearTimeout(timer)
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}
