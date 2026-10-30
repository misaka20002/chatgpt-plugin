# 02 存储层：按时间分页读取原文

Status: done

## 目标

让保留期内的原文能被完整读到，而不是只读到最新 20000 条。

## 范围

- `MemoryStore` 新增 `getRecentRawMessagesPage(groupId, endTime, offset, limit)`：`ZREVRANGEBYSCORE` + `LIMIT offset limit`，按批 `mGet` 取值；返回 `{ rows, count }`，`count` 是这一页的 id 数量（用于判断是否最后一页）。
- 抽出批量取值助手，供新增方法与既有 `getRecentRawMessages` 共用；**既有方法的语义与 20000 上限不变**（`#at图谱` 在用）。
- 固定 `endTime` 后偏移才稳定：扫描期间新到的消息时间戳更大，不在区间内。

## 验收

- 既有 `npm run test:memory` 结果不变。
- 分页在数据不足一页时 `count < limit`，调用方能据此终止。
