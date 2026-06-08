import { AbstractTool } from './AbstractTool.js'
import { render } from '../common.js'

/**
 * Generate Cartesian function graph images.
 */
export class GenerateGraphCalculatorTool extends AbstractTool {
    name = 'generate_graph_calculator'

    parameters = {
        properties: {
            title: {
                type: 'string',
                description: 'The title of the graph. Keep it concise.'
            },
            expressions: {
                type: 'array',
                items: {
                    type: 'string'
                },
                description: 'Function expressions to plot. Use expressions such as "y=x^2", "x2", "sin(x)", "sqrt(x)", or "x^3-2*x". Use x as the variable.'
            },
            xMin: {
                type: 'number',
                description: 'Optional minimum x value. Default is -10.'
            },
            xMax: {
                type: 'number',
                description: 'Optional maximum x value. Default is 10.'
            },
            yMin: {
                type: 'number',
                description: 'Optional minimum y value. Leave empty to auto-fit.'
            },
            yMax: {
                type: 'number',
                description: 'Optional maximum y value. Leave empty to auto-fit.'
            }
        },
        required: ['expressions']
    }

    description = 'Useful when the user asks to draw a Cartesian graph, plot a function, or use a graphing calculator for equations like y=x2, y=x^2, sin(x), cos(x), sqrt(x), or polynomial functions.'

    func = async (opts, e) => {
        const toFiniteNumber = (value, fallback = null) => {
            const number = Number(value)
            return Number.isFinite(number) ? number : fallback
        }

        const expressions = Array.isArray(opts.expressions)
            ? opts.expressions
            : [opts.expression || opts.expressions].filter(Boolean)

        if (!expressions.length) {
            return 'Error: No function expression was provided.'
        }

        const graphData = {
            title: opts.title || 'Graph Calculator',
            expressions: expressions.map(exp => String(exp)).filter(Boolean).slice(0, 6),
            xMin: toFiniteNumber(opts.xMin, -10),
            xMax: toFiniteNumber(opts.xMax, 10),
            yMin: toFiniteNumber(opts.yMin),
            yMax: toFiniteNumber(opts.yMax)
        }

        if (graphData.xMin >= graphData.xMax) {
            return 'Error: xMin must be smaller than xMax.'
        }

        if (graphData.yMin !== null && graphData.yMax !== null && graphData.yMin >= graphData.yMax) {
            return 'Error: yMin must be smaller than yMax.'
        }

        try {
            const img = await render(e, 'chatgpt-plugin', 'graphCalculator/index', {
                title: graphData.title,
                graphData: JSON.stringify(graphData),
                Viewport: {
                    width: 2560,
                    height: 1600,
                    deviceScaleFactor: 4
                }
            }, { retType: 'base64' })

            if (!img) {
                return 'Error: Failed to render the graph image.'
            }

            await e.reply(img, true)

            return 'Successfully generated and sent the graph image to the user. Do NOT output the expression data in your final response.'
        } catch (error) {
            return `Error generating graph image: ${error.message}`
        }
    }
}
