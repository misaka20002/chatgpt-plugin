# 01: 一张地图能从云端落到本地

**What to build:** 给定地图仓索引与一份插件清单，把缺的地图下载下来、校验、落盘，并且能再读回来。完成后，任意一份云端地图都能在本机 `data/chatgpt/maps/<插件>/` 下变成一份 `entry.json`（地图与元信息同装一份）。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 索引 schema 不是 2、缺 `plugins`、返回的不是 JSON —— 三种情况都报人话错误，且不抛原始堆栈
- [x] 本地已有的地图版本相同 → 跳过，不重复下载
- [x] 云端条目没写 `version` 时按 `sha256` 判等，同一份内容第二轮不再下载
- [x] 下载回来的地图哈希不符 / schema 不符 / 正文 `plugin.key` 与索引 key 不符 —— 三种都拒收，且本地不留下半份文件
- [x] 索引里的 `file` 指向索引以外的域名时拒收
- [x] 一份下载失败不影响其余插件，失败信息带插件名
- [x] 落盘后再读出，指令条数与插件展示名与云端一致

## 落地

`utils/capability/map.js`：镜像链取文件（五级，哈希对上才算成功）、索引校验、版本比对、
下载校验、落盘。地图与元信息写在**同一份 `entry.json`** 里，一次 rename 落盘——
分两个文件写的话，两次 rename 之间崩掉会留下「新地图 + 旧版本号」，下一轮会当成已是最新。

索引不走镜像（它是校验的根），并且对响应体设了体积上限（声明值 + 流式累计两道）。
每份地图有 45s 总预算，镜像链再长也不会让整批同步卡在一份上。

测试 `test/commandMap.test.mjs` 11 项，已挂进 `npm run check`（`test:command-map`）。

真网络冒烟：对 `command-maps` 的 `dist/index.json` 拉 `zmd-plugin` 与 `miao-plugin`，
`revision 43 / 更新 2 份 / 失败 0`，落盘为一份 `entry.json`。
