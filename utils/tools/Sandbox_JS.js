import { AbstractTool } from './AbstractTool.js'
import vm from 'vm'
import { makeForwardMsg } from '../../utils/common.js'

/**
 * Tool: 在安全沙箱中执行JavaScript代码
 * 用于数学计算、数据处理、逻辑运算等场景
 */
export class SandboxJSTool extends AbstractTool {
    name = 'execute_javascript'

    parameters = {
        properties: {
            code: {
                type: 'string',
                description: 'The JavaScript code to execute. CRITICAL: You MUST use the "return" keyword to output the final result (e.g., "return Math.sqrt(144);"). Supports basic ES6 JS, Math, Date, Array, and JSON operations.'
            },
            timeout: {
                type: 'number',
                description: 'Timeout in ms (default 5000, max 30000).'
            }
        },
        required: ['code']
    }

    description = 'Execute JavaScript code in a secure sandbox. Use for: math calculations, data/string/array processing, date logic, etc. \nRules: \n1. You MUST use "return" to yield the result.\n2. No file/network access.\n3. The raw code and results are automatically sent to the user by the system. \n4. In your final reply, DO NOT repeat the code or raw JSON/data. Just directly explain or summarize the result in natural language based on your persona.'

    constructor() {
        super()
    }

    func = async function (opts, e) {
        const { code, timeout = 5000 } = opts

        // 统一格式化返回给 LLM 的结果，防止 LLM 解析混乱
        const formatLLMResponse = (status, result, systemNote = '') => {
            return JSON.stringify({
                status: status,
                result: result,
                system_instruction: systemNote || "DO NOT show code/raw data to the user. Directly explain the result."
            }, null, 2)
        }

        if (!code || typeof code !== 'string') {
            return formatLLMResponse('error', 'Code cannot be empty.')
        }

        const maxTimeout = 30000
        const actualTimeout = Math.min(Math.max(timeout, 100), maxTimeout)

        try {
            const sandbox = {
                Math, Date, Array, Object, String, Number, Boolean, RegExp, JSON,
                parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
                __sandbox_result__: null,
                console: {
                    log: (...args) => {
                        logger.info('[Sandbox]', ...args)
                    }
                }
            }

            const wrappedCode = `
                try {
                    const __fn = function() {
                        ${code}
                    };
                    __sandbox_result__ = { success: true, data: __fn() };
                } catch (err) {
                    __sandbox_result__ = { success: false, error: err.name + ': ' + err.message };
                }
            `

            const context = vm.createContext(sandbox)

            vm.runInContext(wrappedCode, context, {
                timeout: actualTimeout,
                displayErrors: true
            })

            const resultObj = sandbox.__sandbox_result__

            // 处理沙箱内部捕获的语法/运行错误
            if (!resultObj) {
                return formatLLMResponse('error', 'Critical Error: Sandbox failed to return a result object.')
            }

            if (!resultObj.success) {
                return formatLLMResponse('error', resultObj.error, 'Modify your code to fix this error and try again.')
            }

            const finalData = resultObj.data

            // 检查是否忘记写 return
            if (finalData === undefined) {
                return formatLLMResponse('error', 'Result is undefined. CRITICAL: Did you forget to use the "return" statement? (e.g., "return 1+1;")')
            }

            // 格式化要发给用户的聊天记录
            const resultStr = typeof finalData === 'object' ? JSON.stringify(finalData, null, 2) : String(finalData)

            // 发送转发消息给用户
            try {
                await e.reply(await makeForwardMsg(e, [`Node.js 代码：`, code, `计算的结果：`, resultStr], `SandboxJSTool`))
            } catch (forwardErr) {
                logger.error('[SandboxJSTool] Failed to send forward message:', forwardErr)
            }

            // 返回给 LLM 的最终成功结构
            return formatLLMResponse(
                'success',
                finalData,
                "Success! The code and raw output have been auto-forwarded to the user. DO NOT repeat the code or raw JSON. Just naturally answer the user's question using this result."
            )

        } catch (err) {
            // 处理沙箱外部级别的错误（如超时）
            if (err.message.includes('Script execution timed out')) {
                return formatLLMResponse('error', `Timeout (${actualTimeout}ms). Code took too long to execute.`)
            }
            return formatLLMResponse('error', `VM Exception: ${err.message}`)
        }
    }
}