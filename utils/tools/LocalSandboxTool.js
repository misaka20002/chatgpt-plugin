import { Config } from '../config.js'
import { makeForwardMsg } from '../common.js'
import { hidePrivacyInfo } from '../paimonFuction.js'
import { buildSandboxSubAgentPlan } from '../sandboxSubAgent.js'
import {
  collectLocalSandboxOutputs,
  localSandboxSessionManager,
  materializePreparedInputs,
  preflightLocalSandbox,
  resetSessionExchangeDirectories,
  runLocalSandboxCommand,
  validateLocalSandboxPackages
} from '../localSandbox.js'
import { prepareInputs, processOutputFiles } from '../sandboxIO.js'
import { AbstractTool } from './AbstractTool.js'

const MAX_CALL_FORWARD_CHARS = 6000

function buildCallForwardBatches(command, result) {
  const sourceMessage = `执行源码：\n${command || '(空)'}`
  const resultMessage = `执行结果：\n${hidePrivacyInfo(String(result ?? ''))}`
  if (sourceMessage.length + resultMessage.length <= MAX_CALL_FORWARD_CHARS) {
    return [{ title: '本地沙箱调用', messages: [sourceMessage, resultMessage] }]
  }
  return [
    { title: '本地沙箱调用 1/2（源码）', messages: [sourceMessage] },
    { title: '本地沙箱调用 2/2（结果）', messages: [resultMessage] }
  ]
}

async function sendCallForward(e, command, result) {
  if (!Config.localSandboxSendCallForward || !e?.reply) return
  try {
    for (const batch of buildCallForwardBatches(command, result)) {
      await e.reply(await makeForwardMsg(e, batch.messages, batch.title))
    }
  } catch (error) {
    globalThis.logger?.warn?.(`[localSandbox] 发送源码与结果合并转发失败: ${error?.message || error}`)
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

export class LocalSandboxTool extends AbstractTool {
  name = 'localSandbox'

  description = '将任务交给本地 Linux/WSL2 隔离沙箱完成，适合本机文件处理、离线计算、编译和本地网页渲染。说明目标与期望交付物即可。'

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
      planned = await buildSandboxSubAgentPlan('local', args?.task, e)
      args = planned.plan
    } catch (error) {
      return `本地沙箱子代理规划失败: ${error?.message || error}`
    }
    const command = args.command
    const finish = async result => {
      await sendCallForward(e, command, result)
      return result
    }

    if (!command) return await finish('command is required')
    if (args?.new_session === true && typeof args?.session_id === 'string' && args.session_id.trim()) {
      return await finish('new_session=true 时不能同时提供 session_id')
    }

    let runtime
    let packageOptions
    try {
      runtime = await preflightLocalSandbox()
      packageOptions = validateLocalSandboxPackages(args)
    } catch (error) {
      return await finish(`本地沙箱不可用: ${error?.message || error}`)
    }

    let session
    try {
      session = await localSandboxSessionManager.resolveSession({
        e,
        newSession: args?.new_session === true,
        sessionId: typeof args?.session_id === 'string' ? args.session_id.trim() : ''
      })
    } catch (error) {
      return await finish(`本地沙箱会话错误: ${error?.message || error}`)
    }

    try {
      return await localSandboxSessionManager.withSession(session, async info => {
        await resetSessionExchangeDirectories(info.directory)
        const preparedInputs = args?.use_message_images === false
          ? emptyPreparedInputs()
          : await prepareInputs(e)
        await materializePreparedInputs(info.directory, preparedInputs)

        const execution = await runLocalSandboxCommand({
          sessionDirectory: info.directory,
          command,
          timeoutSeconds: args?.timeout_seconds,
          pythonPackages: packageOptions.pythonPackages,
          nodePackages: packageOptions.nodePackages,
          runtime,
          env: {
            SANDBOX_SESSION_DIR: '/workspace',
            SANDBOX_INPUT_DIR: '/workspace/inputs',
            SANDBOX_OUTPUT_DIR: '/workspace/outputs',
            SANDBOX_INPUT_IMAGES: JSON.stringify(preparedInputs.imagePaths),
            SANDBOX_INPUT_MEDIA: JSON.stringify(preparedInputs.mediaPaths),
            SANDBOX_INPUT_FILES: JSON.stringify(preparedInputs.inputPaths)
          }
        })

        let files = []
        let outputError = ''
        try {
          files = await collectLocalSandboxOutputs(info.directory)
        } catch (error) {
          outputError = error?.message || String(error)
        }

        const { sent, sendErrors } = outputError
          ? {
              sent: { images: 0, videos: 0, audios: 0, files: 0 },
              sendErrors: []
            }
          : await processOutputFiles(e, files, {
              sendMedia: args?.send_output_media !== false,
              sendFiles: args?.send_output_files !== false
            })
        const totalSent = sent.images + sent.videos + sent.audios + sent.files
        const success = execution.exitCode === 0 && !execution.terminationReason && !outputError
        const toolResult = JSON.stringify({
          success,
          status: execution.terminationReason || (outputError ? 'output_error' : success ? 'completed' : 'failed'),
          exit_code: execution.exitCode,
          signal: execution.signal,
          session_id: info.sessionId,
          stdout: execution.stdout,
          stderr: execution.stderr,
          stdout_truncated: execution.stdoutTruncated,
          stderr_truncated: execution.stderrTruncated,
          runtime: execution.runtime,
          input_images: preparedInputs.imagePaths,
          input_media: preparedInputs.mediaPaths,
          input_files: preparedInputs.inputPaths,
          output_files: files.map(file => ({
            path: file.path,
            mime_type: file.mime_type,
            size: file.size
          })),
          output_error: outputError || undefined,
          images_sent: sent.images,
          videos_sent: sent.videos,
          audios_sent: sent.audios,
          files_sent: sent.files,
          send_errors: sendErrors,
          message: totalSent > 0
            ? `已直接发送 ${sent.images} 张图片、${sent.videos} 个视频、${sent.audios} 个音频和 ${sent.files} 个附件，无需再次调用发送工具`
            : undefined
        })
        return await finish(toolResult)
      })
    } catch (error) {
      return await finish(`本地沙箱调用失败: ${error?.message || error}`)
    }
  }
}
