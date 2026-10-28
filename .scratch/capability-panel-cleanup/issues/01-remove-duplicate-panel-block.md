# 01 删掉旧分节与指向它的入口文案

Status: ready-for-agent
Type: task

## 目标

锅巴「智能模式」页里不再出现第二个「启用插件能力地图」，也不再出现那个从未接线的审核供应商下拉。

## 范围

- `guoba.support.js`：删除「智能模式 能力地图」分节整块——分隔线、重复的 `enableCapabilityMap`、`capabilityDirectoryLimit`、`capabilityAuditProvider`、`capabilityAuditConcurrency`。删完这个功能只剩「可选工具」里那一个开关。
- `guoba.support.js`：「可选工具」开关的说明里，把「#chatgpt刷新功能表」那段的耗时数字删掉，改成「耗时视插件数量与模型速度而定；期间机器人继续用旧表」。别留任何条数或秒数。
- `apps/capability.js`：关闭状态下回复的「请先在锅巴『智能模式 能力地图』里开启」指向的小节即将不存在，改成「可选工具」。

## 验收

- `grep -o "field: '[^']*'" guoba.support.js | sort | uniq -d` 不再包含 `enableCapabilityMap`。
- 文件里 `capabilityAuditProvider`、`capabilityDirectoryLimit`、`capabilityAuditConcurrency` 零出现。
- `node --check guoba.support.js` 通过；import 该模块的既有套件不红。
- 说明文本不含「分钟」「秒」「N 条」这类量化承诺。

## 备注

这一块是 `50cd979` 合并上游时留下的，不是设计。不要顺手改其他分节。
