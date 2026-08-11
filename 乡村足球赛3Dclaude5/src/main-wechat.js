// 微信小游戏入口。第一行必须是平台垫片：它会在 three 被求值前补好 window/document。

import { createWechatPlatform } from "./platform/wechat-adapter.js";
import { createGame } from "./app/game.js";

const platform = createWechatPlatform();
const game = createGame(platform);
game.start();

if (typeof GameGlobal !== "undefined") {
  GameGlobal.__rural3d = game;
  // 真机验收标记：控制台看到它说明 3D 主循环已经跑起来
  GameGlobal.__RURAL3D_BOOTED = true;
}
