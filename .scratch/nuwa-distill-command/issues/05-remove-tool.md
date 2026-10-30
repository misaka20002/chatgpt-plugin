# 05 删除工具形态与注册

Status: done

Blocked by: 03

## 目标

模型侧不再看到这条能力，工具目录里也不再留一个非工具模块。

## 范围

- 删除工具类文件。
- 移除 `model/core.js` 的 import 与可选工具注册项。
- 确认没有其它地方引用该工具名（`generateGroupMemberSkill`）。

## 验收

- `node test/checkSyntax.mjs` 通过，`npm run check` 全绿。
- `rg generateGroupMemberSkill` 只剩文档里的历史说明。
