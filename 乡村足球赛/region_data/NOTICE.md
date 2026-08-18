# 行政区划数据说明

本目录中的 `game.js`（自包含乡镇/街道单模块）与 `src/data/china-administrative-core.js` 由
`tools/sync-administrative-regions.mjs` 从 [uiwjs/province-city-china](https://github.com/uiwjs/province-city-china)
生成，数据快照提交为 `ca2ada5ea608b57c7b0178aa568ced6e363b57f7`（2026-04-21）。

注意：分包内只保留 `game.js` 一个自包含模块，不得再放入第二个 `.js` 文件——微信原生端执行
分包内 `require("./xxx")` 时会把含点号的模块名（`region_data/xxx.js`）判定为非法，镇级选择会崩溃。

上游项目采用 MIT License；本项目保留上游版权及许可说明。数据用于本地选择省、市、县区、乡镇/街道，
不联网读取玩家位置，也不向服务器上传选择结果。

村名、自然村和用户自定义队名不随包内置：村级清单量级远超小游戏包体限制，用户可以在后续输入控件中自由填写。
