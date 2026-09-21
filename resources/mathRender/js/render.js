// mathRender 模板的渲染引导脚本。
//
// 必须是**外部文件**、不能在 index.html 里写内联 `<script>`：模板的 CSP 是
// `script-src file:`（不含 `'unsafe-inline'`），内联脚本与被注入的 `onerror=` 之类
// 行内事件处理器同属"inline script"，前者要跑就必须放开后者。markdown-it 开着
// `html: true`，放开 `'unsafe-inline'` 等于把行内事件处理器也放进来。
// 所以引导逻辑外置，让 CSP 保持「只允许本地文件里的脚本」。
window.onload = function () {
    let rawData = document.getElementById('raw-markdown').innerText || document.getElementById('raw-markdown').textContent;

    // 初始化 Markdown 渲染器，并挂载 KaTeX 插件
    // 注意：window.markdownitKatex 是 @vscode/markdown-it-katex 挂载到全局的变量
    const md = window.markdownit({
        html: true,
        breaks: true,
        linkify: true
    }).use(window.markdownitKatex);

    // 交给 markdown-it 识别完整的 Mermaid fence，再将其转成渲染容器。
    // 不能在 md.render() 前直接用 <div> 替换 fence：Mermaid 代码中的空行会
    // 使后续缩进行被 Markdown 解析成 <pre><code>，最终导致 Mermaid 语法错误。
    const defaultFenceRenderer = md.renderer.rules.fence;
    md.renderer.rules.fence = function (tokens, idx, options, env, self) {
        const token = tokens[idx];
        const language = (token.info || '').trim().split(/\s+/)[0].toLowerCase();

        if (language === 'mermaid') {
            return '<div class="mermaid">' + md.utils.escapeHtml(token.content) + '</div>\n';
        }

        return defaultFenceRenderer(tokens, idx, options, env, self);
    };

    // 表格外包一层容器，便于统一绘制圆角外框
    const defaultTableOpen = md.renderer.rules.table_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    const defaultTableClose = md.renderer.rules.table_close || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.table_open = (tokens, idx, options, env, self) => '<div class="table-wrap">' + defaultTableOpen(tokens, idx, options, env, self);
    md.renderer.rules.table_close = (tokens, idx, options, env, self) => defaultTableClose(tokens, idx, options, env, self) + '</div>';

    // markdown-it 默认没有脚注语法：`[^x]` 会命中引用式链接规则，生成一个指向定义文本的
    // 错误相对链接（href 是中文定义内容），定义行也会被 reference 规则吞掉。这里让引用和
    // 定义都退回普通文本，宁可原样显示，也不产出假链接、不静默丢内容。
    // label 只排除 `]` 与换行，允许内部空白：markdown-it 的 reference 规则本身接受含空格的
    // label（并会把连续空白折叠），若这里限成「不含任何空白」，`[^source 1]` + 同 label 定义
    // 就会绕过本规则、退回原生 shortcut reference，假链接照样出现。目标不是校验脚注 label，
    // 而是抢在 reference 之前保住 `[^...]` 原文。
    const footnoteRef = /^\[\^([^\]\r\n]+)\]/;
    md.inline.ruler.before('link', 'footnote_ref', function (state, silent) {
        if (state.src.charCodeAt(state.pos) !== 0x5B) return false;
        const match = footnoteRef.exec(state.src.slice(state.pos));
        if (!match) return false;
        if (!silent) {
            const token = state.push('text', '', 0);
            token.content = match[0];
        }
        state.pos += match[0].length;
        return true;
    });

    const footnoteDef = /^ {0,3}\[\^([^\]\r\n]+)\]:[ \t]*(.*)$/;
    md.block.ruler.before('reference', 'footnote_def', function (state, startLine, endLine, silent) {
        const start = state.bMarks[startLine] + state.tShift[startLine];
        const line = state.src.slice(start, state.eMarks[startLine]);
        if (!footnoteDef.test(line)) return false;
        if (silent) return true;
        const open = state.push('paragraph_open', 'p', 1);
        open.map = [startLine, startLine + 1];
        const inline = state.push('inline', '', 0);
        inline.content = line.trim();
        inline.map = [startLine, startLine + 1];
        inline.children = [];
        state.push('paragraph_close', 'p', -1);
        state.line = startLine + 1;
        return true;
    });

    // 任务列表：`- [ ]` / `- [x]` 默认只是纯文本（还挂着个圆点），这里换成主题化复选框
    const taskMarker = /^\[([ xX])\][ \t]+/;
    md.core.ruler.after('inline', 'task_list', function (state) {
        const tokens = state.tokens;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type !== 'inline') continue;
            const itemOpen = tokens[i - 2];
            if (!itemOpen || itemOpen.type !== 'list_item_open') continue;
            if (!tokens[i - 1] || tokens[i - 1].type !== 'paragraph_open') continue;
            const text = tokens[i].children[0];
            if (!text || text.type !== 'text') continue;
            const match = taskMarker.exec(text.content);
            if (!match) continue;
            const done = match[1].toLowerCase() === 'x';
            itemOpen.attrJoin('class', done ? 'task-item is-done' : 'task-item');
            text.content = text.content.slice(match[0].length);
            const box = new state.Token('html_inline', '', 0);
            box.content = done ? '<span class="task-box is-done"></span>' : '<span class="task-box"></span>';
            tokens[i].children.unshift(box);
        }
    });

    // 将内容写入容器
    const contentDiv = document.getElementById('content');
    contentDiv.innerHTML = md.render(rawData);

    // 初始化 Mermaid，配置超大字体以匹配我们的 24px 正文大小，避免重蹈 "修改JS" 的覆辙
    mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
            fontFamily: 'Outfit, Nunito, PingFang SC, sans-serif',
            fontSize: '20px',    // 直接在配置中覆盖字体大小
            primaryColor: '#ffe5e7',
            primaryTextColor: '#4a3735',
            primaryBorderColor: '#ff8fa3',
            lineColor: '#ff8fa3',
            secondaryColor: '#fcd373',
            tertiaryColor: '#e0ffff'
        }
    });

    // 渲染所有图表
    mermaid.run({ querySelector: '.mermaid' }).catch(e => console.error("Mermaid 渲染错误:", e)).finally(() => {
        // 延迟一下通知 Puppeteer 自适应截图容器高度
        setTimeout(() => {
            const card = document.getElementById('render-card');
            const container = document.getElementById('container');

            // 如果内容过高，自动撑开（由于 CSS 已设置 min-height 和 height: auto，基本会自动撑开）
            // 派发事件让 Puppeteer 如果有监听可以捕获
            window.dispatchEvent(new CustomEvent('math-render-complete'));
        }, 200);
    });
};
