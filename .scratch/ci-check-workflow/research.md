# chatgpt-plugin CI（check.yml）依赖解析问题调研

> 范围：仅外部一手资料 + 本机只读核查。所有"通常/一般"式表述均附来源；区分【已核实】与【推断】。
> 调研时间：2026-10-16。本机环境：Windows，pnpm 10.15.0 / npm 10.9.7 / Node v22.22.2（实测版本）。

---

## 结论摘要

1. 【已核实】插件的 `md5` / `moment` / `yaml` 之所以能在本机跑通，靠的是 Node 的**裸模块向上逐级查找 `node_modules`** 规则：从导入文件所在目录起，每上一级父目录试一次 `node_modules/<pkg>`，直到文件系统根。插件位于 `<宿主根>/plugins/chatgpt-plugin`，向上第一步就命中宿主根 `node_modules`。
2. 【已核实】上游两个宿主仓与本地宿主都**已声明**这三个包：`md5: "link:lib/modules/md5"`（自家替身）、`moment`、`yaml`。因此"上游已经有了"这个判断成立。
3. 【已核实】`lib/modules/md5` 是一个 3 行 ESM 替身，`export default (data) => createHash('md5').update(data).digest('hex')`，与 npm 正牌 `md5@2.3.0` 的默认导出 `(message[, options]) => hex` **在当前调用形态下等价**（插件全部调用都只传一个字符串参数）。
4. 【已核实】本机宿主根是 pnpm workspace（`pnpm-workspace.yaml` = `plugins/**`），生态里"把依赖声明在插件 package.json、在宿主根 `pnpm install`"是主流做法（miao-plugin、arknights-plugin 均如此）；但**未发现任何被抽样的插件把自己的依赖换成宿主已有的包**（详见问题 3）。
5. 【已核实】CI 变红是"独立检出"的必然结果：`actions/checkout` 把插件放到 `<work>/chatgpt-plugin/`，其上一级 `<work>/` 既没有 `node_modules/{md5,moment,yaml}`，也没有宿主 `lib/`。这正是问题 1 的解析规则在 CI 侧失效。
6. 【已核实】实测：`npm install --no-save md5` 在**无 package.json 的空目录**里能成功安装且**不生成/不修改 package.json**；在有 package.json 的目录加 `--no-save` 同样不改 manifest。`pnpm add md5` 在**空目录**会自动**新建** package.json 与 pnpm-lock.yaml。→ CI 临时补包优先用 `npm --no-save`。
7. 【已核实】"宿主提供的依赖"在 npm 语义里对应的 `peerDependencies`，在 pnpm 下默认 `autoInstallPeers = true`，**会自动把缺失 peer 装出来**，且改 peerDependencies 同样会改动锁文件——所以单靠 peerDependencies **不能**同时满足"不重复安装 + 不改锁文件 + CI 变绿"。
8. **不推荐直接删掉 check.yml**。可稳定、低成本达成"来件 PR 变绿"的做法是**改造**它（见 §建议）：首选把 CI 收敛为"只跑零依赖的语法预检 `node test/checkSyntax.mjs`"，完整 `npm run check` 留给本地/手动触发；若必须保留三套件，则在 CI 侧模拟宿主（造 `lib/` 空壳 + 用 `npm --no-save` 把三个包放到解析路径上），而**不动**插件 package.json 与锁文件。

---

## 0. 本机事实核对（对调用方背景的复核与一处更正）

| 事实 | 结论 | 来源 |
| --- | --- | --- |
| CI 工作流存在，push(v2)+PR 触发，跑 `pnpm install --frozen-lockfile` 与 `pnpm run check` | 【已核实】与描述一致；当前检出**没有**"宿主 lib 空壳"步骤（`check.yml` 仅 22 行） | `<仓库根>/.github/workflows/check.yml:1-23` |
| `check` 脚本内容 | 【已核实】`node test/checkSyntax.mjs && npm run test:config && npm run test:providers && npm run test:thinking` | `<仓库根>/package.json:65` |
| 三个模块被源码直接 import | 【已核实】`md5`：`apps/management.js:19`、`utils/bilibili/wbi.js:1`、`utils/translate.js:2`；`moment`：`apps/派蒙戳一戳.js:4`、`utils/SydneyAIClient.js:11`；`yaml`：`utils/common.js:6` | 仓库内 grep（见下） |
| 宿主 package.json 声明 | 【已核实】`"md5": "link:lib/modules/md5"`、`"moment": "^2.30.1"`、`"yaml": "^2.9.0"` | `<Yunzai 根目录>/package.json:32,33,45` |
| 宿主用 pnpm | 【已核实】存在 `pnpm-lock.yaml`、`node_modules/.pnpm`；`pnpm-workspace.yaml` 的 `packages` 含 `plugins/**` | `<Yunzai 根目录>/pnpm-workspace.yaml:1-2` |
| 宿主根 `node_modules` 实际布局 | 【已核实】`md5 -> <Yunzai 根目录>/lib/modules/md5`（符号链接）、`moment -> .../.pnpm/moment@2.30.1/...`、`yaml -> .../.pnpm/yaml@2.9.0/...` | 本机 `ls -la node_modules`（实测） |
| **更正**：调用方称"插件自己的 `node_modules/` 为空" | 【已核实】**不准确**。插件 `node_modules/` 有内容（lodash、node-fetch、fastify 等大量包，且含 `.package-lock.json`/`.yarn-integrity` 混合痕迹），只是**恰好缺** `md5`/`moment`/`yaml` 三个。 | 本机 `ls`（实测） |
| 插件锁文件不含这三个包 | 【已核实】`pnpm-lock.yaml` 无 `md5@`/`moment@`/`yaml@` 顶层条目 | 仓库内 grep（实测） |
| `moment` 的引用面 | 【已核实】全仓仅 2 个文件 import `moment`：`apps/派蒙戳一戳.js`、`utils/SydneyAIClient.js`。两者都**不在** `check` 三套件所 import 的生产模块闭包里（`apps/management.js:17` 虽 import `SydneyAIClient.js`，但 `test/providerMenu.test.mjs:78` 对它做了 `mock.module`） | grep 结果 + `test/providerMenu.test.mjs:78,91` |
| 由套件实际触达的依赖 | 【已核实】**`md5`**：`test/providerSources.test.mjs:21` → `utils/translate.js`（`import md5 from 'md5'`）；`test/providerMenu.test.mjs:91` → `apps/management.js:19`。**`yaml` + 宿主 lib**：`test/toolRoundTextForward.test.mjs:16` → `utils/toolForward.js:2` → `utils/common.js:6,7,8`（`yaml`、`../../../lib/puppeteer/puppeteer.js`、`../../../lib/common/common.js`） | 各测试文件与生产文件 import 行 |

> 关于 `moment`：它**可能**被 `providerMenu` 套件规避（`SydneyAIClient` 被 mock）。这一点属【推断】——未实测 `mock.module` 是否 100% 阻止被 mock 模块的传递加载；但结论 5/8 不依赖该推断。

### 0.1 文档漂移：`AGENTS.md` 与 `check.yml` 相矛盾（供后续修正，本报告不改动）

- 【已核实】`AGENTS.md` 的路径表 `test/` 一行写着"随仓库入库的本地辅助验证；**仓库没有 CI**"——见 `<仓库根>/AGENTS.md:61`。
- 【已核实】同一提交 `c20ba99`（`git show --stat`）既**新增**了 `.github/workflows/check.yml`（22 行），又改了 `AGENTS.md`（`AGENTS.md | 2 +-`）。
- 但 `AGENTS.md:85` 又写着"常用入口：`npm run check`（全仓语法预检 + 快套件，**CI 同款**）"——即同一文件内一处说"没有 CI"、另一处已把它当 CI 描述。
- **结论**：`AGENTS.md` 的"仓库没有 CI"是**过期表述**，与仓库现状（已有 check.yml）冲突。属**文档漂移**，建议后续把该行改为"CI（`.github/workflows/check.yml`）跑语法预检+快套件"之类，并复核 `AGENTS.md:85` 的"CI 同款"措辞在方案落地后是否仍成立。本报告按要求**只指出、不修改**。

---

## 1. Node 模块解析规则（官方文档）

### 1.1 ESM：`PACKAGE_RESOLVE` 第 10 步

来源：<https://nodejs.org/api/esm.html> → `Modules: ECMAScript modules` → `Resolution and loading algorithm` → `Resolution Algorithm Specification` → `PACKAGE_RESOLVE`。

逐字要点（该页原文）：

> 10. **While *parentURL* is not the file system root,**
>     1. Let *packageURL* be the URL resolution of *`node_modules/`* concatenated with *packageName*, relative to *parentURL*.
>     2. Set *parentURL* to the parent folder URL of *parentURL*.
>     3. If the folder at *packageURL* does not exist, then continue the next loop iteration.
>     …（找到则按 exports / main / subpath 解析）
> 11. Throw a *Module Not Found* error.

同页 `Features` 小节列出该行为：`Bare specifier package resolution lookup through node_modules`。

**对本仓的意义**：`plugins/chatgpt-plugin/utils/translate.js` 里 `import md5 from 'md5'` 是裸标识符，解析从 `utils/` 起：`utils/node_modules/md5` → `chatgpt-plugin/node_modules/md5` → `plugins/node_modules/md5` → `<宿主根>/node_modules/md5`（命中）→ …… 直到根。这就是"插件靠宿主 node_modules"的机制。

### 1.2 CJS：`NODE_MODULES_PATHS` 与 `Loading from node_modules folders`

来源：<https://nodejs.org/api/modules.html> → `Loading from node_modules folders` 与 `All together`。

逐字要点（该页原文）：

> If the module identifier passed to `require()` is not a built-in module, and does not begin with `'/'`, `'../'`, or `'./'`, then Node.js starts at the directory of the current module, and adds `/node_modules`, and attempts to load the module from that location. … If it is not found there, then it moves to the parent directory, and so on, until the root of the file system is reached.

以及伪代码 `NODE_MODULES_PATHS(START)`（同上路径的 `All together` 小节）：

> 1. let PARTS = path split(START)
> 2. let I = count of PARTS - 1
> 3. let DIRS = []
> 4. while I >= 0, … DIR = path join(PARTS[0 .. I] + "node_modules") …
> 5. return DIRS + GLOBAL_FOLDERS

**结论**：ESM 与 CJS 的"逐级向上查找 `node_modules`"语义一致（分别规范在 `PACKAGE_RESOLVE` 与 `NODE_MODULES_PATHS`）。插件是纯 ESM（`package.json` 的 `"type": "module"`），走前者。

### 1.3 本机实证（模拟宿主位于上一层）

在系统临时目录构造 `<work>/chatgpt-plugin/` 与 `<work>/node_modules/md5`（替身内容与宿主相同），从 `chatgpt-plugin/` 下执行：

```
$ node probe.mjs
resolved md5 -> 5d41402abc4b2a76b9719d911017c592
$ node --input-type=module -e "… require.resolve('md5')"
<系统临时目录>\ciexp-work\node_modules\md5\index.js
```

【已核实】向上查找命中上层 `node_modules`，与 1.1 一致。实验目录已删除。

---

## 2. 上游事实核查

### 2.1 TimeRainStarSky/Yunzai（上游正统）

- `package.json`（raw）：<https://raw.githubusercontent.com/TimeRainStarSky/Yunzai/main/package.json>
  【已核实】`dependencies` 含：
  ```json
  "lodash": "link:lib/modules/lodash",
  "md5": "link:lib/modules/md5",
  "moment": "^2.31.0",
  "node-fetch": "link:lib/modules/node-fetch",
  "oicq": "link:lib/modules/oicq",
  "yaml": "^2.9.1"
  ```
- `lib/modules/` 仓库树：<https://github.com/TimeRainStarSky/Yunzai/tree/main/lib/modules>
  【已核实】目录含 `md5/`、`node-fetch/`、`lodash/`、`oicq/` 四个替身目录，及 `body-parser.patch`、`compression.patch`、`log4js.patch`、`streamroller.patch`。**md5 与 moment/yaml 不同**：md5 是仓库内替身（`link:`），moment/yaml 是从 npm registry 安装的正牌包。

### 2.2 AIGC-Yunzai/TRSS-Yunzai-Lagrange（用户实际使用的变体）

- `package.json`（raw）：<https://raw.githubusercontent.com/AIGC-Yunzai/TRSS-Yunzai-Lagrange/main/package.json>
  【已核实】与 2.1 同样声明 `md5: "link:lib/modules/md5"`、`moment: "^2.30.1"`、`yaml: "^2.9.0"`，另有 `sharp: "^0.33.5"`。此内容与本机 `<Yunzai 根目录>/package.json` **逐字段一致** → 本机宿主就是该变体。
- 【已核实】本机 `git remote`：`origin=https://github.com/AIGC-Yunzai/TRSS-Yunzai-Lagrange.git`、`upstream=https://github.com/TimeRainStarSky/Yunzai.git`。

### 2.3 本机替身模块 `lib/modules/md5`

- `<Yunzai 根目录>/lib/modules/md5/package.json`（全文）：
  ```json
  { "name": "md5", "type": "module", "main": "index.js" }
  ```
  【已核实】无 `version` 字段（与调用方"`node -p` 读 version 为 undefined"一致）。
- `<Yunzai 根目录>/lib/modules/md5/index.js`（全文）：
  ```js
  import { createHash } from "node:crypto"
  export default function md5(data) {
    return createHash("md5").update(data).digest("hex")
  }
  ```
- 与 npm 正牌对比（本机临时目录实测安装 `md5@2.3.0`）：
  - 正牌 `package.json`：`"main": "md5.js"`，依赖 `charenc`/`crypt`/`is-buffer`。
  - `import md5 from 'md5'` → `typeof md5 === "function"`，`md5('hello') === '5d41402abc4b2a76b9719d911017c592'`，且接受第二参数 `options`（`md5('hello',{encoding:'utf8'})` 同样返回该值）。
  - **API 兼容性**：默认导出都是 `(str) => hex`。替身**只接受一个参数**，忽略 `options`。插件现网全部调用都只传单参（`md5(query + mixinKey)`、`md5(passwd)`、`md5(auth.appid + q + salt + auth.key)`，见 `utils/bilibili/wbi.js:37`、`apps/management.js:967,986,996`、`utils/translate.js:69`）→ 【已核实】**当前使用形态下行为等价**；【推断】若将来用 `options`（如二进制/编码控制）则替身与正牌分叉。

---

## 3. 生态惯例：Yunzai/TRSS 插件如何处理额外运行时依赖

抽样的真实插件与其做法（全部【已核实】）：

| 插件 | 额外运行时依赖怎么处理 | 安装说明 | 证据 |
| --- | --- | --- | --- |
| **miao-plugin** <https://github.com/yoimiya-kokomi/miao-plugin> | **自己在插件 package.json 声明**（`cheerio`、`image-size`），不依赖宿主替身 | README：`git clone … plugins/miao-plugin` → 在"Yunzai 根目录"执行 `pnpm install -P` | `package.json`：<https://raw.githubusercontent.com/yoimiya-kokomi/miao-plugin/master/package.json>；README：<https://raw.githubusercontent.com/yoimiya-kokomi/miao-plugin/master/README.md> §安装与更新 |
| **arknights-plugin** <https://github.com/gxy12345/arknights-plugin> | **自己在插件 package.json 声明**，其中**就包含 `moment: "^2.30.1"`**（另有 `jsdom`、`qrcode`） | README：yunzai 根目录执行 `pnpm install --filter=arknights-plugin` | `package.json`：<https://raw.githubusercontent.com/gxy12345/arknights-plugin/master/package.json>；README 摘录见搜索结果页 <https://ghub.com/QingYingX-Bot/arknights-plugin> |
| **TRSS-Plugin** <https://github.com/TimeRainStarSky/TRSS-Plugin> | **自己声明**（`markdown-it`、`qrcode`、`ansi_up` 等） | — | `package.json`：<https://raw.githubusercontent.com/TimeRainStarSky/TRSS-Plugin/main/package.json> |
| **KaguyaJs/Yunzai-Plugin-Example-TS**（官方 TS 模板） | 模板 README 指示在插件目录 `pnpm install` 装生产+开发依赖 | — | 仓库树见 <https://github.com/KaguyaJs/Yunzai-Plugin-Example-TS> |

**关于"跑 CI 的先例"**：
- 【已核实】插件跑 GitHub Actions 是被文档认可的惯例：Yunzai 插件目录结构文档在 `JS 插件包结构` 里明确列出 `.github`——"用途：GitHub 专用目录；存放内容：GitHub Actions(CI/CD)"。来源：<https://yunzai-bot.com/dev/folder>。
- 【已核实】真实存在带 workflow 的插件仓库，抽查到的两个都不是"测试型 CI"：
  - `gxy12345/arknights-plugin` → `.github/workflows/update-operators.yml`（每日 cron 抓数据 + 建 PR；<https://github.com/gxy12345/arknights-plugin/blob/main/.github/workflows/update-operators.yml>）。
  - `KaguyaJs/Yunzai-Plugin-Example-TS` → `.github/workflows/build-push-lib.yml`（构建产物；<https://github.com/KaguyaJs/Yunzai-Plugin-Example-TS/blob/main/.github/workflows/build-push-lib.yml>）。
  - 【已核实】`miao-plugin`、`yenai-plugin` 的 `.github/workflows` 目录**不存在**（GitHub contents API 返回 404）→ 头部流行插件并未普遍跑测试 CI。

**本轮调研的关键空白**：未能找到"插件把宿主已有的 `md5`/`moment`/`yaml` 直接当作自己依赖、不声明"的公开先例。抽样到的插件都是**显式声明自己用到的第三方包**。这与本插件现状（不声明、靠宿主向上查找）形成对比。（未穷举，属【推断】：依赖宿主而非自声明，在本生态里至少不是主流做法。）

---

## 4. pnpm / npm 机制

### 4.1 `pnpm install --frozen-lockfile`

来源：<https://pnpm.io/cli/install#--frozen-lockfile>。原文要点：

> - Default: For non-CI: false；For CI: true（若存在锁文件）
> - If `true`, pnpm doesn't generate a lockfile and fails to install if the lockfile is out of sync with the manifest / an update is needed or no lockfile is present.

同页另注："In a CI environment, installation fails if a lockfile is present but needs an update."

【已核实】含义：**只要"插件 package.json 声明的依赖集合"与 `pnpm-lock.yaml` 不一致，`--frozen-lockfile` 就会失败**。因此任何"往 package.json 加依赖"的方案（含 `dependencies` 与 `peerDependencies`）都必须**同步提交新锁文件**，否则 CI 在 install 步就红——与"不改锁文件"的诉求直接冲突。

### 4.2 `link:` 依赖

来源：<https://pnpm.io/cli/link#whats-the-difference-between-pnpm-link-and-using-the-file-protocol>。原文要点：

> When you use `pnpm link`, the linked package is symlinked from the source code. … pnpm will not install the dependencies of the linked package, you will have to install them manually…
> When you use the `file:` protocol in `dependencies`, the linked package is hard-linked to your project node_modules … pnpm will also install the dependencies of the linked package…

【已核实】`link:` 是**本地目录依赖**（软链到源目录），不会去 registry 拉同名包。这正是宿主 `"md5": "link:lib/modules/md5"` 能把 npm 的 `md5` 替换成自家替身的机制；`node_modules/md5 -> lib/modules/md5` 的软链已在本机确认。

### 4.3 peerDependencies 在 pnpm 下的行为

来源：<https://pnpm.io/settings/peer-dependencies#autoinstallpeers>。原文：

> `autoInstallPeers`
> - Default: **true**
> - When `true`, any missing non-optional peer dependencies are automatically installed. The version picked is the highest one satisfying the peer range.

以及同页 optional peer："pnpm installs a missing optional peer dependency only if the workspace already has a version of it that satisfies the optional peer range."

【已核实】结论：把 `md5`/`moment`/`yaml` 声明为**普通 peerDependencies**，pnpm 默认会**自动把它们装出来**（和 dependencies 一样会落进锁文件与 `node_modules`）；要"不自动装"须显式标 `peerDependenciesMeta.*.optional = true`。但无论哪种：
- 改 peerDependencies = 改 manifest = **必须重生锁文件**（见 4.1，否则 `--frozen-lockfile` 失败）；
- Node 的解析**完全不看** peerDependencies（§1 只认物理 `node_modules`），所以 peerDependencies **对"CI 里 import 报 ERR_MODULE_NOT_FOUND"零作用**。

→ 【已核实】"宿主提供依赖"用 npm 语义对应 peerDependencies**属实**，但它**不能单独满足**用户"不重复安装 / 不重复声明 / CI 稳定变绿"三项目标。

### 4.4 不改 package.json/锁文件的前提下，CI 临时补包（含实证）

官方行为依据：
- npm `--no-save`：<https://docs.npmjs.com/cli/v10/commands/npm-install>。原文：`--no-save: Prevents saving to dependencies`；`save` 配置项："Will also prevent writing to package-lock.json if set to false"。
- npm 在**无 package.json 目录**安装：同页 Description 说明 `npm install` 会装到本地 `node_modules`；实测（本节实验）无需 package.json 也能装。

本机实测（均在系统临时目录，用完已清理；未触碰宿主根与插件仓库）：

| 实验 | 命令 | 结果 |
| --- | --- | --- |
| A. 空目录 + npm --no-save | `npm install --no-save --silent md5@2.3.0`（目录**无** package.json） | 【已核实】exit=0；生成 `node_modules/{md5,charenc,crypt,is-buffer}`；**未生成 package.json** |
| B. 空目录 + pnpm add | `pnpm add md5@2.3.0`（目录**无** package.json） | 【已核实】exit=0；但**自动新建了 package.json**（`{"dependencies":{"md5":"2.3.0"}}`）**和 pnpm-lock.yaml** |
| C. 模拟宿主向上解析 | `<work>/node_modules/md5` + `<work>/chatgpt-plugin/probe.mjs`，在 `chatgpt-plugin/` 运行 | 【已核实】命中上层 `node_modules/md5`（见 §1.3） |

【已核实】可落地的 CI 补包命令形态（不改 manifest/锁文件）：
- 用 **npm**：在目标目录 `npm install --no-save md5 moment yaml`（有/无 package.json 都行，且不改 package.json、不写 package-lock）。
- **pnpm 没有等价的 `--no-save`**；在无 package.json 的空目录 `pnpm add` 会**新建** manifest（实验 B），不适合"保持干净"。
- 【重要时序】`pnpm install --frozen-lockfile`（及 `pnpm install`）会把 `node_modules` 收敛到锁文件状态，**会清掉手工塞入的多余包** → 补包必须放在 `pnpm install` **之后**。
- 【陷阱】用 npm 装 **正牌** `md5` 会与生产环境（宿主替身）**分叉**（见 §2.3）；要保真，应把宿主的 `lib/modules/md5`（及 `lodash`/`node-fetch` 等替身）一并复制/软链进解析路径，而不是 `npm install md5`。

---

## 5. 方案对比

**目标**：来件 PR 的 CI 稳定变绿。**约束**：不往插件 `package.json` 加 `md5`/`moment`/`yaml`。

| 方案 | 违反约束? | 对"CI 变绿"的作用 | 对 package.json / 锁文件影响 | 与生产保真度 | 维护成本 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| **(a) 声明进 dependencies**（PR #8 现做法的一部分） | **是**（直接违反） | 能（装出包后 import 成立） | 必须新增依赖 + **重生锁文件** | 低：`md5` 会取 npm 正牌 → **CI 与生产走不同实现**；`moment`/`yaml` 版本可能与宿主漂移 | 中（每次宿主编排变都需跟） | 不推荐 |
| **(b) 声明为 peerDependencies** | 是（改写 manifest） | 单独无作用（§4.3：Node 不看 peer；pnpm 还会 autoInstall） | 仍须重生锁文件 | 中 | 中 | 不推荐作唯一方案 |
| **(c) CI 侧模拟宿主**：checkout 到 `host/plugins/chatgpt-plugin`，造 `host/lib/**` 空壳 + 用 `npm --no-save`（或复制宿主替身）把三包放上解析路径 | **否** | 能（且可跑完整三套件） | **不动** manifest/锁文件 | 高（可精确复刻宿主替身）；风险：`lib/` 空壳需覆盖 `lib/common/common.js`、`lib/puppeteer/puppeteer.js` 等真实被 import 的面，宿主演化会导致空壳腐烂 | 中高 | 推荐（若必须跑三套件） |
| **(d) 精简／改造 check.yml**：来件 PR 只跑 `node test/checkSyntax.mjs`（纯 `node --check`，不解析 import、零宿主依赖）；完整 `npm run check` 留本地或 `workflow_dispatch` | **否** | **最稳**（语法预检不会因宿主缺失而红） | 不动 | —（不模拟运行时） | **最低** | **首选** |
| **(e) 直接删 check.yml** | 否 | 变"无 CI"（不再是红，但也没信号） | 不动 | — | 最低 | 不推荐（见下） |

补充说明：
- **(a) 的行为分叉**不是假设：生产用宿主 `lib/modules/md5` 替身，声明 dependencies 后 CI 用 npm `md5@2.x` 正牌。当前调用形态等价（§2.3），但语义与版本控制权分道扬镳；同一逻辑在 `lodash`/`node-fetch` 上同理（宿主也是 `link:` 替身）。
- **(c) 的具体可行命令**（供实现参考）：`actions/checkout` 加 `path: host/plugins/chatgpt-plugin` → 在该插件目录 `pnpm install --frozen-lockfile` → 造 `host/lib/{plugins/common,puppeteer}/…` 空壳 → **之后**在插件目录 `npm install --no-save md5 moment yaml`（并在可行时改用宿主 `lib/modules` 替身以保真）→ `pnpm run check`。**注意**：`<work>/chatgpt-plugin` 布局下 `utils/common.js` 的 `../../../lib` 指向 `<work>/lib`，故"假宿主根"就是检出目录的上一级；用 `path:` 参数把检出嵌进 `host/plugins/` 可让整个假宿主落在 `$GITHUB_WORKSPACE` 内。
- **(d) 的中间态**：`checkSyntax.mjs` 只对每个文件 spawn `node --check`（`test/checkSyntax.mjs:31`），**不解析 import**，因此**不依赖任何第三方包与宿主 lib**，对来件 PR 天然稳定。代价是放弃 config/providers/thinking 三套行为测试的 CI 覆盖。
- **(e) 的代价**：该仓库正在接收外部 PR，维护者 2026-10-15 刚加此工作流（提交 `c20ba99`）。删掉后：③ 失去对来件 PR 的第一道语法/回归网；② 与 `AGENTS.md` 里"`npm run check`（…CI 同款）"的描述脱节；① 一旦将来想恢复，需重来一遍。所以删除是"消除问题"而非"解决问题"。

---

## 6. 建议

**明确回答："是否应该直接删掉 check.yml？"——不应该。**

推荐排序：

1. **首选：把 check.yml 收敛为"零依赖"检查（方案 d 的中间态）。**
   - 让 `push`/`pull_request` 只跑 `node test/checkSyntax.mjs`（全仓 `node --check`，无 import 解析、无宿主依赖），稳定变绿且仍有价值。
   - 完整 `npm run check`（三套件）保留为本地入口 / 或加一个 `workflow_dispatch` 手动任务（不进 PR 必过项），避免"宿主不在这里"导致的误导性红叉。
   - 若希望 PR 也跑三套件又不想删测试，进入第 2 条。

2. **次选：CI 侧模拟宿主（方案 c），保持 manifest/锁文件干净。**
   - 该做法正是 PR #8"造宿主 `lib/` 空壳"思路的正确延伸；**建议只保留其 lib 空壳部分，去掉"往 dependencies 加三包"，改为 CI 里 `npm --no-save` 补包**（或用 `link:`/软链指向从 `lib/modules` 复制的替身以保真）。
   - 必须遵守时序：补包在 `pnpm install --frozen-lockfile` **之后**（§4.4）。
   - 局限：`lib/` 空壳要覆盖 `utils/common.js` 真实 import 的宿主模块，会随宿主演化而腐烂——需要把它当成"有意维护的小适配层"。

3. **不推荐：peerDependencies（b）**——语义对但解决了错的问题：不改锁文件就过不了 `--frozen-lockfile`，改了又等于动了 manifest；对 Node 解析无帮助。

4. **不推荐：dependencies（a）**——直接违反约束，且引入 `md5` 的 CI/生产实现分叉。

5. **最后手段：删 check.yml（e）**——若维护者判断"宁可无 CI"，也应退到第 1 条（只留 `checkSyntax`），而不是全删。

**长期替代（一段可行性说明，不深挖）：** `md5` 可直接用 `node:crypto` 替换（宿主替身本身就是 3 行 `createHash`，插件三处调用可内联，从而彻底移除对 `md5` 的依赖）；`yaml` 的用法仅 `yaml.parse(...)` 一处（`utils/common.js:45`），若接受可换成宿主未必提供的纯 JS 解析器、或改为按需 `await import('yaml')` 让"没有就降级"；`moment` 两处用法都是日期格式化，可换 `dayjs` 或 `Intl.DateTimeFormat`。这些属独立议题，本调研不展开。

---

## 7. 未决问题 / 待验证

1. ~~**PR #8 的精确内容未取得**~~ → **2026-10-16 晚已补全**：PR #8 已 fetch 为本地分支 `pr-8`（head=461e9e4），改动 3 文件 +84/-1：`package.json`（+md5/moment/yaml 声明）、`pnpm-lock.yaml`（+node-silk/md5/moment/yaml 条目）、`.github/workflows/check.yml`（4 件宿主 lib 空壳 + concurrency）。其 CI 在 install 阶段失败——锁文件多出 `node-silk` 孤儿条目，本地已用 pnpm 10.15.0 复现 `ERR_PNPM_OUTDATED_LOCKFILE`，重生成恰好删该 15 行、其余无差。
2. **`mock.module` 是否让被 mock 模块的传递依赖（`moment`）完全不加载**：未实测。**处理**：方案 (c) 落地时三个包一并补装，此项不影响任何结论。
3. **`lib/` 空壳的最小充分集**：**已有实证**——作者 fork 的 v2 绿色 run（head=e3babfd，install→空壳→check 全 success）证明其 4 件套（`lib/plugins/plugin.js`、`lib/plugins/loader.js`、`lib/common/common.js`、`lib/puppeteer/puppeteer.js`）对当前三套件充分；宿主演化时随插件新增的宿主 import 面扩展即可。
4. **CI 检出目录名与 runner 工作目录**：本报告按 `actions/checkout` 默认把仓库检出到 `$GITHUB_WORKSPACE`（即 `<work>/<repo>`）理解。此为 GitHub Actions 通行行为，但本轮未引用官方原文逐字核对（【推断】）；实现方案 (c) 时以显式 `path:` 参数固定布局即可规避不确定性。
5. **生态反例**：未穷举"依赖宿主已有包、自己完全不声明"的插件先例（§3），该结论作【推断】处理。

---

## 附：来源清单

**本机绝对路径（只读核查）**
- `<仓库根>/.github/workflows/check.yml`
- `<仓库根>/package.json`
- `<仓库根>/AGENTS.md`
- `<仓库根>/test/checkSyntax.mjs`
- `<仓库根>/test/{providerSources,providerMenu,toolRoundTextForward}.test.mjs`
- `<仓库根>/utils/{common,config,translate,toolForward}.js`
- `<Yunzai 根目录>/package.json`、`pnpm-workspace.yaml`、`.npmrc`
- `<Yunzai 根目录>/lib/modules/md5/{package.json,index.js}`
- `<Yunzai 根目录>/lib/modules/{lodash,node-fetch}/index.js`

**外部一手来源**
- Node.js ESM 解析：<https://nodejs.org/api/esm.html>（`PACKAGE_RESOLVE` 第 10 步）
- Node.js CJS 解析：<https://nodejs.org/api/modules.html>（`Loading from node_modules folders`、`NODE_MODULES_PATHS`）
- 上游 package.json：<https://raw.githubusercontent.com/TimeRainStarSky/Yunzai/main/package.json>
- 上游 lib/modules 树：<https://github.com/TimeRainStarSky/Yunzai/tree/main/lib/modules>
- Lagrange 变体 package.json：<https://raw.githubusercontent.com/AIGC-Yunzai/TRSS-Yunzai-Lagrange/main/package.json>
- pnpm install（`--frozen-lockfile`）：<https://pnpm.io/cli/install>
- pnpm link / `file:` 对比：<https://pnpm.io/cli/link>
- pnpm `autoInstallPeers`：<https://pnpm.io/settings/peer-dependencies>
- npm install（`--no-save` / `save`）：<https://docs.npmjs.com/cli/v10/commands/npm-install>
- miao-plugin：<https://raw.githubusercontent.com/yoimiya-kokomi/miao-plugin/master/package.json>、<https://raw.githubusercontent.com/yoimiya-kokomi/miao-plugin/master/README.md>
- arknights-plugin：<https://raw.githubusercontent.com/gxy12345/arknights-plugin/master/package.json>、<https://github.com/gxy12345/arknights-plugin/blob/main/.github/workflows/update-operators.yml>
- TRSS-Plugin：<https://raw.githubusercontent.com/TimeRainStarSky/TRSS-Plugin/main/package.json>
- Yunzai-Plugin-Example-TS：<https://github.com/KaguyaJs/Yunzai-Plugin-Example-TS>
- Yunzai 插件目录结构（`.github` 用途）：<https://yunzai-bot.com/dev/folder>

---

## 落地记录（2026-10-16 晚）

- **决策**（grill 定稿）：不删 check.yml；采用 §5 方案 (c)——CI 侧模拟宿主（保留宿主 lib 空壳 + 新增补包步骤），不动插件 package.json / 锁文件；修正直接推到贡献者 PR 分支。
- **实现**：PR #8 分支（`ci/fix-check-workflow`）追加两个提交——`3cc9b89`（撤销依赖声明与锁文件改动；check.yml 新增"补宿主提供的依赖"步骤：md5 内联替身 + `npm --no-save --prefix <宿主根> moment yaml`）、`ae46355`（AGENTS.md 漂移修正）。
- **验证**：本地按 CI 步骤全流程复跑全绿（语法预检 288 文件；config 31/31、providers 38/38、thinking 8/8 + 5/5）；PR CI 在推送后 22 秒通过（run 38898378636）。
