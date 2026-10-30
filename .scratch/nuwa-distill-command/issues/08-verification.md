# 08 验证与收尾

Status: done

Blocked by: 01, 02, 03, 04, 05, 06, 07

## 目标

用最小的充分验证确认改动可用，并记录没验证到的部分。

## 范围

- `node --check` 覆盖所有改动过的 `.js/.mjs`。
- `npm run test:nuwa`、`npm run check`。
- 与改动相关的专项：`npm run test:tools`（工具审计与上下文用例不受影响）、`npm run test:memory`（store 改动）。
- 清理临时文件与产物目录。

## 验收

- 全绿，或明确记录与本次无关的既有失败。
- 最终汇报包含 Changes / Validation / Risks。
