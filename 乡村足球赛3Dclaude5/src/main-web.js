// 浏览器入口：本地开发和真机前的观感验收都跑这个。

import { createBrowserPlatform } from "./platform/browser.js";
import { createGame } from "./app/game.js";

const platform = createBrowserPlatform(document.getElementById("game"));
const game = createGame(platform);
window.addEventListener("resize", () => game.resize());
game.start();
// 自动化验收脚本用它读取状态
window.__rural3d = game;
