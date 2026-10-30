# 06 测试套件与验证

Status: done

Blocked by: 04

## 目标

用纯函数与行为测试锁住本次决策，并跑通仓库检查。

## 范围

- 新增群友 Skill 测试文件：token 估算、抽样、切块、合并去重、媒体时间线、事实选择、质量自检、`research_dimensions` 规范化、渲染包含/不包含断言。
- 新增 `test:nuwa` 脚本并纳入 `npm run check`。
- 跑 `npm run test:memory`（token 函数搬家）与 `npm run check`。
- 改过的 `.js` 逐个 `node --check`。

## 验收

- 新测试全绿；记忆测试全绿；`npm run check` EXIT=0。
- 记录实际跑过的命令与结果。

## Comments

- 不测真实 Redis / 真实模型链路。
