# 能力地图与指令地图入口合并为单文件

Status: done（2026-10-28 合并完成，同日按两轴评审修正文案与命名）

## Problem Statement

能力地图（`#chatgpt刷新功能表`）与指令地图（`#chatgpt更新指令地图`）拆在 `apps/capability.js`、`apps/commandMap.js` 两个文件里，各自只有一个类、一条规则、一个处理函数。两个入口都属于「主人手动触发的地图维护」，样板代码重复，文件数量也不必要。

## Solution

合并为单个 `apps/capability.js`：一个类 `mapMaintenance`、两条 rule，两个处理函数原样保留。`apps/commandMap.js` 删除。

## Implementation Decisions

- **必须合成一个类，不能同文件导出两个类**：`index.js` 对每个 app 文件只取 `Object.keys(mod)[0]` 注册，宿主 `lib/plugins/loader.js` 再按值实例化；同文件第二个导出会被静默丢弃。改 `index.js` 去收集全部导出会波及 `apps/help.js`（首个导出是数组）、`apps/派蒙戳一戳.js`（导出了 async 函数，无构造能力），故不动注册层。
- **类名与插件名改为覆盖两件事**：`capabilityMap` / 「能力地图」只描述了一半职责，改为 `mapMaintenance` / 「ChatGPT-Plugin 地图维护」；文件名保持 `capability.js`（本仓 `apps/` 下文件与类名不同名是常态，如 `management.js` → `ChatgptManagement`）。
- **两条指令共用总开关**：`sync` 补上与 `refresh`、每日同步（`utils/commandMap/dailySync.js`）一致的 `enableCapabilityMap === false` 拦截。默认值是 `false`，此前手动同步是该开关唯一管不到的入口。
- **「功能已关闭」文案收敛为文件内常量** `DISABLED_HINT`，与该功能另外两处提示（`utils/tools/CapabilityLookupTool.js`、`RunPluginCommandTool.js`）逐字一致，点名分节「插件能力地图（AI 代执行）」与开关「启用插件能力地图」。
- **地图地址缺失的提示指向真实位置**：锅巴面板没有 `commandMapIndexUrl` 字段（内置地址在 `utils/config.js` 默认值里），原文案指向「可选工具」分节属于指错位置，改为提示检查 `config.json` 的该键。

## Testing Decisions

- 无新增行为测试：两个处理函数的函数体与合并前逐行一致，合并只改注册形态；`sync` 新增的总开关拦截由 `refresh` 的既有同款逻辑担保，属一致性修补而非新业务。
- 验证取最小充分集：`node --check apps/capability.js`、import 后确认单导出与两条规则均可解析、`node test/lint.check.mjs`。注册路径本身由框架加载器决定，不在单测范围。
