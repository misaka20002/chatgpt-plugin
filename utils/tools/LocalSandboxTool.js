import { Config } from '../config.js'
import { makeForwardMsg } from '../common.js'
import { hidePrivacyInfo } from '../paimonFuction.js'
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

  description =
    '在 Linux/WSL2 本地系统沙箱中执行 Shell、Python、Node.js、编译、文件处理和 Chromium 命令。' +
    '开始独立的新任务时必须设置 new_session=true；继续旧任务时使用返回的 session_id；两者都不传时继续当前任务。' +
    '输入附件位于 inputs/，路径同时写入 SANDBOX_INPUT_IMAGES、SANDBOX_INPUT_MEDIA 和 SANDBOX_INPUT_FILES。' +
    '需要发送给用户的图片、视频、音频、HTML、PDF、压缩包等必须写入 outputs/，工具会自动发送。' +
    '网页截图请先把 HTML 写入 outputs/，再用 "$SANDBOX_CHROMIUM" --headless=new --no-sandbox --disable-dev-shm-usage ' +
    '--screenshot=outputs/page.png --window-size=1440,1000 "file://$PWD/outputs/page.html" 生成截图；HTML 和 PNG 都会发送。' +
    '普通中间文件应写在当前会话目录，不要写入 outputs/。inputs/ 和 outputs/ 每次调用会清空，其他文件在锅巴配置的闲置保留期内复用。' +
    '默认禁止联网；仅当管理员在锅巴开启后才能联网或动态安装依赖。'

  parameters = {
    properties: {
      command: {
        type: 'string',
        description: '要执行的完整 Shell 命令。输入位于 inputs/，需要回传的文件必须写入 outputs/。'
      },
      new_session: {
        type: 'boolean',
        description: '开始全新独立任务时设为 true。不能和 session_id 同时使用。'
      },
      session_id: {
        type: 'string',
        description: '继续指定的旧沙箱任务；省略时继续当前用户最近使用的任务。'
      },
      timeout_seconds: {
        type: 'number',
        description: '可选超时时间，默认 120 秒，范围 1-300 秒。'
      },
      python_packages: {
        type: 'array',
        items: { type: 'string' },
        description: '可选，需要安装到当前会话 Python 环境的包；仅在管理员允许联网时可用。'
      },
      node_packages: {
        type: 'array',
        items: { type: 'string' },
        description: '可选，需要安装到当前会话 Node.js 环境的包；仅在管理员允许联网时可用。'
      },
      use_message_images: {
        type: 'boolean',
        description: '是否读取当前消息或引用消息中的图片、视频和音频，默认 true。'
      },
      send_output_media: {
        type: 'boolean',
        description: '是否自动发送 outputs/ 中的图片、视频和音频，默认 true。'
      },
      send_output_files: {
        type: 'boolean',
        description: '是否自动发送 outputs/ 中的普通附件，默认 true。'
      }
    },
    required: ['command']
  }

  func = async function (args, e) {
    const command = typeof args?.command === 'string' ? args.command.trim() : ''
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
