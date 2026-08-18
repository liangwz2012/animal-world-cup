# 球员体型系统微信开发者工具验收记录

- 验收时间：2026-07-29
- 工具：微信开发者工具 Stable 2.01.2510290
- 项目：乡村足球赛
- 运行模式：小游戏模式，横屏 iPhone 12/13 模拟器

## 真实运行结果

- 首页可见，赛前设置可进入。
- 点击“开始比赛”后约 23 秒取得可见比赛首帧。
- 动态观众图集在开发者工具中按安全设备画像跳过，未再出现此前约 150 秒的同步阻塞。
- 运行时日志：
  - `safe profile: skip dynamic fans atlas`
  - `game.load done → states.change(StandaloneMatch)`
  - `[rural-body-profiles] applied players=14`
  - `B2_VISIBLE_MATCH_STARTED`
- 14 名比赛球员均应用体型配置，裁判/球衣参考 Renderer（id=900）未计入。
- 画面检查可见高瘦、矮壮、标准、高壮和同比例偏大差异。
- 人物脚底仍落在原骨架根节点，选择圈未随体型漂移。
- 足球使用逆缩放抵消，不随人物 X/Y 缩放变成椭圆。

## 自动门禁

- `npm run test:body-profiles`：通过。
- `npm run build`：通过。
- `npm run verify`：通过。
- 主包约 2.76 MiB，资源分包约 12.34 MiB，总包低于 20 MiB。

## 已知非本功能问题

- 开发者工具账号访问令牌过期会显示 `webapi_getwxaasyncsecinfo:fail access_token expired`。
- `https://coaiz.com` 尚未进入当前小程序的 request 合法域名列表。
- 上述两项不阻断本地单机比赛和本次体型验收，但联网排行榜、好友对战仍需后台域名配置与有效登录后真机验收。

截图：`2026-07-29-body-profiles-wechat-devtools.jpeg`
