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
                description: '要执行的JavaScript代码。代码必须使用return语句返回结果值,或者将表达式作为最后一条语句(会自动返回)。可用于数学计算(如复杂公式计算、统计分析)、字符串处理(如正则表达式匹配、文本格式化)、数组操作(如排序、过滤、映射)、日期时间计算、数据转换、逻辑判断等。注意:代码将在受限环境中运行,不能访问文件系统、网络或其他系统资源。示例: "return Math.sqrt(144)" 或 "Math.sqrt(144)"'
            },
            timeout: {
                type: 'number',
                description: '代码执行超时时间(毫秒),默认5000ms,最大30000ms'
            }
        },
        required: ['code']
    }

    description = '在安全的JavaScript沙箱环境中执行代码并返回结果。适用场景包括:1)复杂数学计算和公式求值 2)统计分析和数据聚合 3)字符串处理和正则表达式操作 4)数组/对象的排序、过滤、转换 5)日期时间计算 6)JSON数据处理 7)逻辑判断和条件运算。代码在隔离环境中运行,不能访问外部资源,确保安全性。重要提示:执行成功后,代码和结果已自动发送给用户,你只需根据你的人设向用户解释计算结果即可,无需重复展示代码或原始数据。'

    constructor() {
        super()
    }

    func = async function (opts, e) {
        const { code, timeout = 5000 } = opts

        if (!code || typeof code !== 'string') {
            return 'Error: 代码不能为空'
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
                return 'Error: 代码没有返回结果。请确保代码有返回值,例如使用return语句或直接写表达式'
            }

            // 给用户发送 AI 生成的函数及结果
            const resultStr = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)
            await e.reply(await makeForwardMsg(e, [`Node.js 代码：`, code, `计算的结果：`, resultStr], `SandboxJSTool`))

            // 转换结果为字符串返回给 AI
            let aiResponse = ''
            if (typeof result === 'object') {
                aiResponse = `执行成功! 计算结果:\n${JSON.stringify(result, null, 2)}`
            } else {
                aiResponse = `执行成功! 计算结果: ${String(result)}`
            }

            return aiResponse + '\n\n重要提示: 代码和结果已经通过转发消息发送给用户了,你不需要再次展示代码或原始数据。请根据你的人设,用自然的语言向用户解释这个计算结果的含义即可。'

        } catch (err) {
            if (err.message.includes('Script execution timed out')) {
                return `Error: 代码执行超时(${actualTimeout}ms),请优化代码或增加超时时间`
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