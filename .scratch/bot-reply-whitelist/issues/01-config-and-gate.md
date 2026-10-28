# 01 配置项与判定 util

Type: task
Status: done

新增 `botReplyWhitelist` 默认值（空数组）与一个可单测的判定 util：`eventBotId(e)` 取账号，`isBotReplyAllowed(e, { label, silent })` 决定放行与否。

空列表与非数组按「未启用」处理；取不到账号身份时 fail-open；被拦时的日志由调用方决定是否静默。

## Answer

- `utils/config.js`：`botReplyWhitelist: []`，紧挨 `whitelist` / `blacklist`，注释写明三层名单的区别。
- `utils/botReplyWhitelist.js`：两个导出，判定逻辑只此一份。
- `test/botReplyWhitelist.test.mjs`：10 例，挂进 `package.json` 的 `test:config`。

验证：`npm run test:config` 45 例全绿（新增 10 例）。
