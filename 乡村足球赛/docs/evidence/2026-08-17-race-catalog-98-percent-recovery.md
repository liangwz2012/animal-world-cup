# 98% 卡死与 `.skin` 空值根治记录

日期：2026-08-17

## 根因

1. 旧 `__dirlist.json` 仍列出已删除动物目录，却没有新的 `rural_*` 人物目录；开发者工具热更新会继续复用旧 `races` 集合。
2. 清理旧角色时误删了内核必需的 `skeleton` 结构模板。它不是可选或可见球员，但 `teams.makeSharedSpineSkins` 必须读取其 `skin`。
3. 原首帧显示只等待 `requestAnimationFrame` 的开球定位；开发者工具暂停 RAF 时，资源已完成也可能一直显示 98%。

## 修复

- 每次构建从真实文件树重建完整 `__dirlist.json`。
- 恢复不可选、不可见的 `skeleton` 结构模板，并用发布门禁确保八支球队均不得把它作为球员。
- 生成主包内 `rural-race-catalog.static.js`，每次 `setupCollections` 后重新补齐 15 套乡村人物与结构模板。
- `teams` 在读取单队/共享皮肤前再次检查并调用自愈钩子，失败时报告具体 race id。
- 首帧显示采用 RAF、3 秒真实时间和 3.5 秒独立定时器三重门，且以 `__ruralRevealDone` 保证幂等。
- 每场开始重置上一场启动错误和 FATAL 状态，避免一次失败污染后续重赛。

## 验证

- 微信开发者工具真实日志已越过原崩溃点：`teams: packImages done`、`teams: flags done`、`onMatchLoaded: setupMatch`、`onMatchLoaded: phase.change`。
- 同一验证流程未再出现 `Cannot read properties of null (reading 'skin')`。
- `test-race-catalog-recovery` 通过：空/旧缓存一次补齐、重复注入幂等、目录索引完整、teams 双入口均有空值门、首帧定时器存在。
- `npm run check` 与 `node tools/release-check.mjs` 全部通过。
- 主包约 3.12 MiB，普通资源分包约 8.97 MiB，仍低于 4 MiB / 20 MiB 门限。

## 未混淆的外部状态

- `coaiz.com/rural-football/config/v1` 当前仍返回 404；联网排行榜、好友房间和头像生成服务未因此变成已部署状态。
- 当前证据为开发者工具与自动门禁，不替代 iOS/Android 真机完整一局。
