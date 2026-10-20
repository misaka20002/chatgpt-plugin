# QQ `nt_data` 缓存：有没有上限、会不会自动清理

调研对象：`参考/NapCatQQ`（main @ `450fb042`）与官方清理插件 `NapNeko/napcat-plugin-cleaner`。
结论只覆盖能在一手源码里核实的行为；QQ 客户端本体闭源，涉及它的部分单独标注为「无法从源码确认」。

## 结论

| 目录 | 归属 | 上限 | 自动清理 | 能否安全删 |
| --- | --- | --- | --- | --- |
| `nt_data/log` | QQ 客户端自身运行日志 | 无 | **不会**（NapCat 侧无任何定时任务） | 可以，删了不影响聊天记录与登录 |
| `nt_data/Pic`、`Ptt`、`Video` | QQ 聊天媒体缓存 | 无 | **不会** | 可以，属于可再下载的本地缓存 |
| `nt_data/File` | 接收文件缓存 | 无 | **不会** | 谨慎，可能是唯一本地副本 |
| NapCat 自己的日志（`NapCat/logs`） | NapCat | 5MB × 5 轮转 | **会**：启动时删 7 天前的日志 | 可以 |

一句话：**这两块都没有容量上限，也不会自己收敛**；NapCat 只提供一个手动清理接口，QQ 客户端只提供手动的「存储管理 → 清理缓存」。289M + 716M 会一直留在那里，直到有人主动清。

## 证据：NapCat 侧确实没有自动清理

### 1. 唯一的清理入口是手动 API

`packages/napcat-onebot/action/system/CleanCache.ts`：

```ts
const basic_path = path.join(this.core.dataPath, this.core.selfInfo.uin || '10001', 'nt_qq', 'nt_data');
const dirsToClean = ['Pic', 'Ptt', 'Video', 'File', 'log'];
```

- 对应 OneBot 动作 `clean_cache`（`packages/napcat-onebot/action/router.ts:93`），只在收到请求时执行一次。
- 全仓 `packages/napcat-core`、`packages/napcat-onebot` 里没有针对这些目录的 `setInterval` / 定时任务；`setInterval` 只有时钟同步（`napcat-core/index.ts:214`）和状态上报（`helper/status.ts:124`）。
- 配置项里也没有任何缓存/保留期开关：`packages/napcat-core/helper/config.ts:20-30` 只有 `fileLog`、日志级别、packet、时区同步、bypass。

### 2. 这个接口是「浅层删除」，媒体目录多半删不掉

`CleanCache.ts` 对每个子目录只做一层 `readdir` + `unlink`：

```ts
const files = await readdir(dirPath).catch(() => null);
...
await unlink(filePath);   // 遇到目录会抛错，只记一条「删除文件 ... 失败」
```

而官方清理插件按 `<日期>/Ori`、`<日期>/Thumb`、`<日期>/ThumbTemp` 的结构遍历（`napcat-plugin-cleaner/src/services/cleaner-service.ts` 的 `getCleanablePaths`），说明当前 QQ 的 `Pic` / `Ptt` / `Video` 是按日期分子目录的。**顶层是目录，`unlink` 必然失败**——所以 `clean_cache` 实际能清掉的是 `log` 这种平铺文件，以及 `File` 顶层的零散文件；`Video`/`Ptt`/`Pic` 往往原样保留（日志里只留下成片的「删除文件 xxx 失败」）。

### 3. Linux / Docker 下路径根本对不上

`CleanCache.ts:38` 硬编码了 Windows 布局 `{dataPath}/{uin}/nt_qq/nt_data`；而 Linux 的账号目录是 `{dataPath}/nt_qq_{hash}/nt_data`（见 `napcat-plugin-cleaner` 的 `getNtDataPath`，以及 `napcat-shell/base.ts:68-71` 的 global 路径分支）。在 Linux 上 `readdir` 返回 `null` 被静默跳过，`clean_cache` 只剩清 `NapCat/temp` 的作用。

### 4. NapCat 自己的日志才有自动清理

`packages/napcat-core/helper/log.ts`：

- 每次启动生成一个带时间戳的新文件（`log.ts:70-72`）；
- 启动时扫描日志目录，删除 mtime 超过 7 天的文件（`log.ts:100-130`）；
- 当前文件用 winston 轮转，`maxsize: 5MB`、`maxFiles: 5`（`log.ts:152-157`）。

注意这是 `NapCat/logs`，不是 `nt_data/log`。默认 `fileLog: false`，不写文件。

### 5. 官方插件才补上「定时 + 保留天数」

`NapNeko/napcat-plugin-cleaner`（在 NapCat 插件白名单里，`packages/napcat-onebot/network/plugin/loader.ts:13-19`）：

- `schedule-service.ts` 支持 `daily` / `weekly` / `interval` 三种频率定时执行；
- `cleaner-service.ts` 的 `cleanDirectory(dirPath, retainDays)` 递归删除、只删 `mtime` 超过 `retainDays` 的文件，并顺手删空目录；
- 默认 `retainDays: 7`（`src/types.ts:87`），覆盖 `Video/Ori`、`Video/Thumb`、`Ptt/Ori`、`Pic/Ori`、`File/{Ori,Thumb,ThumbTemp}`、`log`、`log-cache`；
- 没有「按体积阈值触发」的配置，只有时间维度。

## 证据：QQ 客户端侧能确定与不能确定的部分

能确定：NapCat 声明的 QQ wrapper 接口里，缓存管理只有被动调用，没有配额/周期参数。

`packages/napcat-core/services/NodeIKernelStorageCleanService.ts`：

```ts
scanCache(): Promise<...>
getChatCacheInfo(tableType, pageSize, order, startPosition)
clearChatCacheInfo(chatInfoList, clearKeys)
clearCacheDataByKeys(keys)
setSilentScan(isSilent)
```

`NodeIKernelSettingService.ts:34,48` 也只有 `clearCache` / `scanCache`。这组接口对应 QQ「设置 → 通用 → 存储管理」里的手动扫描/清理：**由 UI 或调用方发起，接口签名里没有任何「上限」「保留天数」「定时」概念**。NapCat 自己也从未调用它们（全仓除接口声明外无引用），清理走的是直接删文件。

不能确定：QQ 客户端内部是否存在未暴露的自动清理策略（例如只保留最近 N 天日志）。`nt_data/log` 由闭源的 QQ 写入，腾讯没有公开保留策略文档，仓库里也没有可验证的实现。因此「不会自动清理」这一条，证据强度是：**NapCat 不会清 + QQ 未暴露任何自动清理入口 + 社区长期反馈目录会涨到十几 GB**，而不是「读过 QQ 源码确认没有」。

## 清理风险

- `log`：纯诊断日志，删除不影响登录、消息、数据库（消息在 `nt_db`）。QQ 运行中正在写的那个文件在 Windows 上可能被占用，删不掉属正常，跳过即可。
- `Pic` / `Ptt` / `Video`：只是本地缓存。聊天记录仍在，图片/视频/语音在需要时向服务器重新拉取；**但服务端对历史媒体有保留期，过期后本地这份就是唯一副本**。机器人场景里，依赖「引用图」「历史语音」的功能在清理后会失效。
- `File`：接收文件可能只有本地一份，删了发送方也补不回来。不建议顺手清。
- 清理时最好让 QQ 处于停止状态，避免文件占用导致的半删状态。

## 建议

1. 289M 的 `log` 直接清，风险最低；716M 的 `Pic/Ptt/Video` 按「是否需要回看历史媒体」决定。
2. 不要指望 `clean_cache` 清媒体：它是浅层删除，且 Linux 下路径不匹配。要清就装官方 `napcat-plugin-cleaner`，设 `retainDays`（如 7/30）+ 每日或每周定时。
3. 若只想一次性清干净，停 QQ 后直接删 `nt_data/{Pic,Ptt,Video,log}` 下的日期目录/文件即可，聊天记录不受影响。
4. 判断「是否已经在自动清理」的简单办法：看 `nt_data/log` 里最旧文件的 mtime。如果机器人天天在跑、最旧文件却是几个月前，说明没有自动清理；如果始终只有最近几天，才说明有轮转。

## 未验证 / 限制

- 本机没有可读的 QQ 数据目录，以上均为源码与官方插件代码推导，未对 289M/716M 这两个实际目录做抽样统计。
- `Pic/Ptt/Video` 的具体层级以官方清理插件的路径假设为准；不同 QQ 版本可能混有平铺文件，`clean_cache` 的清理效果会随版本变化。
- QQ 客户端内部的日志保留策略无法从公开源码确认。

## 参考

- `packages/napcat-onebot/action/system/CleanCache.ts`（清理实现）
- `packages/napcat-onebot/action/router.ts:93`（`clean_cache` 动作名）
- `packages/napcat-core/helper/log.ts:70-157`（NapCat 日志轮转与 7 天清理）
- `packages/napcat-core/helper/config.ts:20-30`（无缓存相关配置）
- `packages/napcat-core/services/NodeIKernelStorageCleanService.ts`（QQ 缓存接口，仅扫描/清理）
- https://github.com/NapNeko/napcat-plugin-cleaner（官方清理插件，定时 + retainDays）
- https://napneko.github.io/api/4.15.1（`/clean_cache` 属系统接口）
