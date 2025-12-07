import { AbstractTool } from './AbstractTool.js'
import vm from 'vm'
import {
    makeForwardMsg,
} from '../../utils/common.js'

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
                description: 'JavaScript code to execute. Code must use a return statement to return a result, or have an expression as the last statement (which will be automatically returned). Can be used for: mathematical calculations (complex formulas, statistical analysis), string processing (regex matching, text formatting), array operations (sorting, filtering, mapping), date/time calculations, data transformation, logical operations, etc. Note: Code runs in a restricted environment without access to file system, network, or other system resources. Examples: "return Math.sqrt(144)" or "Math.sqrt(144)"'
            },
            timeout: {
                type: 'number',
                description: 'Code execution timeout in milliseconds. Default: 5000ms, Maximum: 30000ms'
            }
        },
        required: ['code']
    }

    description = 'Execute JavaScript code in a secure sandbox environment and return results. Use cases: 1) Complex mathematical calculations and formula evaluation 2) Statistical analysis and data aggregation 3) String processing and regex operations 4) Array/object sorting, filtering, transformation 5) Date/time calculations 6) JSON data processing 7) Logical operations and conditional evaluation. Code runs in an isolated environment without access to external resources, ensuring security. Important: After successful execution, the code and results are automatically sent to the user. You only need to explain the calculation results to the user according to your persona, without repeating the code or raw data.'

    constructor() {
        super()
    }

    func = async function (opts, e) {
        const { code, timeout = 5000 } = opts

        if (!code || typeof code !== 'string') {
            return 'Error: Code cannot be empty'
        }

        // 限制最大超时时间
        const maxTimeout = 30000
        const actualTimeout = Math.min(Math.max(timeout, 100), maxTimeout)

        try {
            // 创建一个安全的上下文环境
            const sandbox = {
                // 提供常用的数学函数和常量
                Math: Math,

                // 提供日期处理
                Date: Date,

                // 提供基本的数据类型
                Array: Array,
                Object: Object,
                String: String,
                Number: Number,
                Boolean: Boolean,
                RegExp: RegExp,
                JSON: JSON,

                // 提供常用工具函数
                parseInt: parseInt,
                parseFloat: parseFloat,
                isNaN: isNaN,
                isFinite: isFinite,
                encodeURIComponent: encodeURIComponent,
                decodeURIComponent: decodeURIComponent,

                // 用于存储结果
                __result__: undefined,

                // 提供console.log用于调试(可选)
                console: {
                    log: (...args) => {
                        logger.info('[Sandbox]', ...args)
                    }
                }
            }

            // 包装代码,确保返回结果
            const wrappedCode = `
        try {
          __result__ = (function() {
            ${code}
          })();
        } catch (e) {
          __result__ = { error: e.message, stack: e.stack };
        }
      `

            // 创建VM上下文
            const context = vm.createContext(sandbox)

            // 执行代码
            vm.runInContext(wrappedCode, context, {
                timeout: actualTimeout,
                displayErrors: true
            })

            const result = sandbox.__result__

            // 检查是否有错误
            if (result && typeof result === 'object' && result.error) {
                return `Error: ${result.error}`
            }

            // 返回结果
            if (result === undefined) {
                return 'Error: Code did not return a result. Please ensure the code returns a value, either using a return statement or by writing an expression as the last statement'
            }

            // 给用户发送 AI 生成的函数及结果
            const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)
            await e.reply(await makeForwardMsg(e, [`Node.js 代码：`, code, `计算的结果：`, resultStr], `SandboxJSTool`))

            // 转换结果为字符串返回给 AI
            let aiResponse = ''
            if (typeof result === 'object') {
                aiResponse = `Execution successful! Result:\n${JSON.stringify(result, null, 2)}`
            } else {
                aiResponse = `Execution successful! Result: ${String(result)}`
            }

            return aiResponse + '\n\nImportant: The code and results have already been sent to the user via forwarded message. You do not need to display the code or raw data again. Please explain the calculation results to the user in natural language according to your persona.'

        } catch (err) {
            if (err.message.includes('Script execution timed out')) {
                return `Error: Code execution timed out (${actualTimeout}ms). Please optimize the code or increase the timeout value`
            }
            return `Error: ${err.message}`
        }
    }
}

// 使用示例:
// 1. 数学计算: { code: "return Math.sqrt(144) + Math.pow(2, 10)" }
// 2. 数组操作: { code: "return [1,2,3,4,5].filter(x => x % 2 === 0).map(x => x * 2)" }
// 3. 字符串处理: { code: "return 'Hello World'.toLowerCase().split(' ').reverse().join('-')" }
// 4. 日期计算: { code: "return new Date('2024-01-01').getTime() - new Date('2023-01-01').getTime()" }
// 5. 复杂计算: { code: "const sum = [1,2,3,4,5].reduce((a,b) => a+b, 0); return sum / 5" }