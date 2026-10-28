# 本机环境事实（多账号字段、开发机工具链）

本文件只收**换机器或换账号拓扑就要重新核实**的事实。插件与框架交互的契约（事件只读字段、accept 阶段、规则匹配语义、日志通道）不在本文件内。

## 一、多账号与适配器：谁是谁

TRSS 一个进程可以挂多个账号，下面几个字段容易混：

| 字段 | 是什么 |
| --- | --- |
| `Bot.bots[self_id]` | 账号实例。`.adapter` 指向适配器实例（含 `id` / `name` / `path`），`.info.nickname` 是登录昵称 |
| `Bot.uin` | TRSS 下是**数组**（所有已登录的 `self_id`），带自定义 `toString` / `toJSON`；非 TRSS 是单值 |
| `Bot.adapter` | **适配器实例**数组（`OneBotv11` / `Milky` / `Satori` / `stdin` / `ComWeChat`），不是账号；各适配器用 `Bot.adapter.push(new …)` 注册 |
| 事件上的 `adapter_id` / `adapter_name` | 宿主 `prepareEvent` 从 `data.bot.adapter` 抄到事件上；插件侧目前没有使用 |

- `utils/bot.js` 的 `getBots()` 把 `Bot.adapter` 的元素当 uin 去 `Bot[uin]`，取到的是 `undefined`——既有缺陷，枚举账号别复用它。
- 账号级判断一律用事件自带的 `e.self_id`；`Config.trssBotUin` 只影响 `getUin(e)` 的返回值，不是准入开关。

## 二、本机开发机（Windows / Git Bash）

以下只在开发机上跑 git 时成立。

- `git rev-parse --short` 只接受单参数（多参数报 `Needed a single revision`）。
- `git grep` 没有 `--branches` / `--remotes`，要逐 ref 循环查。
- `ref:path` 形式的参数（`git show` / `cat-file` / `ls-tree` / `diff`）先加 `MSYS_NO_PATHCONV=1`：不设时 Git Bash 的路径转换会改写参数——`show` 报 ambiguous argument，`cat-file -e` 这类探测还会给出假的「不存在」。结论是否定或异常时，先怀疑它。
- 对比新生成文件用 `--ignore-cr-at-eol`；全仓搜索排除 `server/static`（打包产物）。
- **`git log -S<str> -- <path>` 本机出现过假空**：同一个字符串，带 pathspec 返回空，换 `--all -- .` 就命中 `738a306`，而 `git show b5a5c78:utils/config.js` 里明明有它。取证结论是「没有」之前，换手法复核一次。
- **取历史血统的可靠手法**：先 `git log --format=%h A..B -- <path>` 列出碰过该文件的提交，再逐个 `git show <c>:<path> | grep -c` 看目标是否存在；断言「这一行由哪个提交引入」用 `git blame -L <起>,<止> -- <path>`，**不要用 `-S` 的返回顺序推断**。本次据此把一次合并产物错认成单个功能提交（`50cd979` 认成 `3737fc9`），被用户当场纠正。
- 同一 `field`/配置键在两个分节各出现一次，多半是 merge 把两条分支各自的版本都留下了。用「每个提交里该字段出现几次」的循环（`for c in $(git log --format=%h A..B -- <file>); do … | grep -c`）能直接看出是哪次合并引入的。

### 读文件与跑命令的本地习惯

- 读源码区间先 `Grep -n` 定位，再 `Read` 带 `offset`/`limit`；不用 `sed -n` / `tail` 取区间——大文件上容易截错行，输出也没有行号。
- 复杂内联 `node -e` / `python -c` 先落临时脚本再执行，便于重跑和读错误栈。
- 长输出先落 `temp/`（`.gitignore` 里）再 `Read`；Git Bash 的 `/tmp` 映射到别处，`Read` 打不开。
- 判成败用 `(cmd > log 2>&1; echo EXIT=$?)`，不接 `tail` / `grep` 管道：退出码会变成后者的，`grep` 无匹配还会给出假的失败。
- 对大目录递归 `grep` 会超时（实测 `.workbuddy` 全盘三次全被 SIGTERM，换 `Grep` 工具三次全一次命中）。

## 三、这套事实怎么用

- 在开发机上跑 git、读文件或跑长命令前读第二节。
