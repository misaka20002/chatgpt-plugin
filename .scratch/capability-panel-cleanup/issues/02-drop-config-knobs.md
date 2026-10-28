# 02 回收两个配置旋钮与它们的读取点

Status: ready-for-agent
Blocked by: 01

## 目标

目录展开上限与审核并发不再是用户配置：取值回到各自模块的单一来源，配置默认值删除，编排层不再读它们。

## 范围

- `utils/config.js`：删除 `capabilityDirectoryLimit` 与 `capabilityAuditConcurrency` 两个默认值；同一处注释里「只读扫描」的措辞改成与实际行为一致。
- `utils/capability/rebuild.js`：不再向审核函数传 `concurrency`、不再向表单渲染传 `limit`——两边模块各自已有默认（审核函数默认参数、渲染侧常量）。
- `utils/capability/audit.js`：返回值增加「实际并行度」，空列表分支给 0；`rebuild.js` 的完成日志改读这个字段，替代原来的 `Config.capabilityAuditConcurrency || 3`。
- `apps/capability.js`：手动重建的回复文案去掉「实测 1161 条（15 批）约 3 分钟」，改成不含量化承诺的说法。

## 验收

- 全仓 grep 两个配置键零出现（`.scratch/` 与本文件除外）。
- 审核并发仍为 3、目录展开仍为 100——删的是配置入口，不是默认值本身。
- `node --check` 过改动文件；能力地图相关套件（审核、表单、工具、命令派发）全绿。
- 用户可见文案不含时长或条数断言。

## 备注

删除 `capabilityAuditProvider` 不在本票——它随 01 整块消失，且没有任何代码读过它。
