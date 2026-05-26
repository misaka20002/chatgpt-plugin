import { AbstractTool } from './AbstractTool.js'
import { render } from '../common.js'

/**
 * 生成 包含数学公式与作图的 Markdown 渲染图像 LLM 工具
 */
export class GenerateMathRenderTool extends AbstractTool {
    name = 'generate_math_markdown'

    parameters = {
        properties: {
            title: {
                type: 'string',
                description: 'The title of the document. Keep it concise.'
            },
            markdown: {
                type: 'string',
                description: 'The Markdown text. MUST use `$...$` for inline math, `$$...$$` for block math formulas.\n\n🚨 CRITICAL MERMAID RULES (v10+):\n1. Flowcharts: Node text with spaces, punctuation, or special characters MUST be double-quoted inside shapes, e.g., A["Hello"] (NOT A[Hello]). Edge text MUST be double-quoted, e.g., A -- "Wait!" --> B.\n2. State Diagrams: State descriptions and transitions after a colon (:) MUST NOT use double quotes, e.g., State1 --> State2 : Trigger (NOT State1 --> State2 : "Trigger").\n3. Sequence Diagrams: Message labels after a colon (:) MUST NOT use double quotes.\n4. NEVER use literal \\n or real newlines inside labels. You MUST use <br/> for line breaks.\n5. Node IDs must be alphanumeric without spaces (e.g., Step1, not Step 1).'
            }
        },
        required: ['title', 'markdown']
    }

    // 强化 Description，让模型在调用工具前区分不同图表类型的引号规则
    description = 'Useful to render math formulas, complex equations, and diagrams (Mermaid flowcharts, state diagrams, sequence diagrams). Always strictly follow diagram-specific Mermaid quoting and syntax rules to avoid parser errors.'

    func = async (opts, e) => {
        let { title, markdown } = opts

        try {
            // 在发送给渲染引擎之前，根据图形类型对 Mermaid 语法进行自动纠错
            markdown = markdown.replace(/```mermaid([\s\S]*?)```/g, (match, mermaidCode) => {
                let code = mermaidCode;
                code = code.replace(/\\"/g, '"');
                const lines = code.split('\n');
                const firstLine = lines.find(l => l.trim() !== '') || '';
                const isFlowchart = /^(graph|flowchart)\b/i.test(firstLine.trim());
                const isStateDiagram = /^(stateDiagram|stateDiagram-v2)\b/i.test(firstLine.trim());
                const isSequenceDiagram = /^sequenceDiagram\b/i.test(firstLine.trim());
                if (isFlowchart) {
                    code = code.replace(/"([^"]*?)"/g, (m, text) => {
                        return '"' + text.replace(/\n/g, '<br/>') + '"';
                    });
                    code = code.replace(/(--|==|-\.)\s*([^"\s][^"|>]*?[^"\s]|[^"\s])\s*(-->|==>|\.->)/g, (m, start, text, end) => {
                        if (/^[-=\s]+$/.test(text)) return m; // 如果 text 只是单纯的延长线，直接跳过
                        text = text.replace(/\n/g, '<br/>').trim();
                        return `${start} "${text}" ${end}`;
                    });
                    code = code.replace(/-->\|([^"|]+)\|/g, (m, text) => {
                        text = text.replace(/\n/g, '<br/>').trim();
                        return `-->|"${text}"|`;
                    });
                    const bracketRules = [
                        { regex: /([a-zA-Z0-9_-]+)\s*(\[\[)([^"]*?)(\]\])/g }, // subroutine
                        { regex: /([a-zA-Z0-9_-]+)\s*(\[\{)([^"]*?)(\}\])/g }, // asymmetric
                        { regex: /([a-zA-Z0-9_-]+)\s*(\{\{)([^"]*?)(\}\})/g }, // hexagon
                        { regex: /([a-zA-Z0-9_-]+)\s*(\(\()([^"]*?)(\)\))/g }, // circle
                        { regex: /([a-zA-Z0-9_-]+)\s*(\[\\[\s]*)([^"]*?)([\s]*\\\])/g }, // parallelogram alt [\text\]
                        { regex: /([a-zA-Z0-9_-]+)\s*(\[\/)([^"]*?)(\/\])/g },       // parallelogram [/text/]
                        { regex: /([a-zA-Z0-9_-]+)\s*(\[)([^"]*?)(\])/g },           // rect [text]
                        { regex: /([a-zA-Z0-9_-]+)\s*(\()([^"]*?)(\))/g },           // round (text)
                        { regex: /([a-zA-Z0-9_-]+)\s*(\{)([^"]*?)(\})/g }            // diamond {text}
                    ];
                    for (const rule of bracketRules) {
                        code = code.replace(rule.regex, (m, id, open, text, close) => {
                            if (!text.trim()) return m;
                            text = text.replace(/\n/g, '<br/>').trim();
                            return `${id}${open}"${text}"${close}`;
                        });
                    }
                } else if (isStateDiagram || isSequenceDiagram) {
                    code = code.replace(/:\s*"([^"]*?)"\s*$/gm, (m, text) => {
                        return `: ${text.trim()}`;
                    });
                    code = code.replace(/-->\s*([a-zA-Z0-9_-]+)\s*:\s*"([^"]*?)"/g, (m, target, text) => {
                        return `--> ${target} : ${text.trim()}`;
                    });
                }
                return "```mermaid\n" + code + "\n```";
            });

            let img = await render(e, 'chatgpt-plugin', 'mathRender/index', {
                markdown: markdown,
                title: title || '数学演算与图表',
                Viewport: {
                    width: 2560,
                    height: 1600,
                    deviceScaleFactor: 4
                }
            }, { retType: 'base64' })

            if (!img) {
                return 'Error: Failed to render the math markdown image.'
            }

            await e.reply(img, true)

            return `Successfully generated and sent the rendered math document to the user. Do NOT output the markdown text in your final response.`

        } catch (error) {
            return `Error generating math document image: ${error.message}`
        }
    }
}