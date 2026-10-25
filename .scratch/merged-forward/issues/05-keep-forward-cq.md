# 05: 输入侧保留 forward 的 CQ 码

**What to build:** 工具开启时，消息文本里的 `[CQ:forward,id=…]` 不再被清掉，模型才有 id 可传给工具；关闭时行为与现在一致。Bot 回复里的 CQ 码仍一律移除。

**Blocked by:** 04（view_forward_msg 工具与配置开关）

**Status:** done

- [x] 输入侧 CQ 清理新增「保留 forward」选项，其余非 at 的 CQ 码照旧剥离
- [x] 取 prompt 的两处调用都按工具开关传参
- [x] 输出侧 `removeCQCodeFocus` 行为不变
