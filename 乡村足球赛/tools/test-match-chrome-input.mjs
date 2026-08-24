import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const matchChromeSource = fs.readFileSync(new URL("../src/ui/match-chrome.js", import.meta.url), "utf8");
const generatedMatchSource = fs.readFileSync(new URL("../generated/match.static.js", import.meta.url), "utf8");
assert.doesNotMatch(matchChromeSource, /team_cheer_\d+/, "进球不得再映射旧动物球队助威声");
assert.match(matchChromeSource, /sound\.play\("goal_cheer"/, "主客队进球必须统一播放人类观众欢呼");
assert.match(generatedMatchSource, /this\._showPassPaws\(t\)/, "比赛必须保留传球队友方向脚印");
assert.doesNotMatch(generatedMatchSource, /h\.local&&h\.localIndex>=0&&h\.hasBall&&h\.id>=0/, "传球方向不得继续依赖持球瞬间才显示");
assert.match(generatedMatchSource, /h\.local&&h\.localIndex>=0&&h\.id>=0/, "传球方向必须常驻跟随当前操控球员");
const {
  createMatchChrome,
  mapMatchPointerCandidates,
  placardCharacters,
  sidelinePlacardLayout,
} = require("../src/ui/match-chrome.js");

assert.deepEqual(placardCharacters(" 镇 隆 青 年 队 "), ["镇", "隆", "青", "年", "队"]);
assert.deepEqual(placardCharacters("一二三四五六七"), ["一", "二", "三", "四", "五", "六"]);
const fiveBoardLayout = sidelinePlacardLayout("镇隆青年队", 720, 1.18);
assert.equal(fiveBoardLayout.length, 5, "五字队名必须生成五块独立牌");
assert.ok(fiveBoardLayout.every((item, index) => index === 0 || item.y > fiveBoardLayout[index - 1].y));

class Point {
  constructor() { this.x = 0; this.y = 0; }
  set(x, y) { this.x = x; this.y = y == null ? x : y; }
}

class Anchor extends Point {}

class Container {
  constructor() {
    this.children = [];
    this.position = new Point();
    this.scale = new Point();
    this.scale.set(1, 1);
    this.parent = null;
    this.visible = true;
    this.rotation = 0;
  }
  addChild(...children) {
    for (const child of children) {
      if (child.parent) child.parent.removeChild(child);
      child.parent = this;
      this.children.push(child);
    }
    return children[0];
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = null;
  }
  removeChildren() {
    for (const child of this.children) child.parent = null;
    this.children = [];
  }
  destroy() { this.removeChildren(); }
}

class Graphics extends Container {
  clear() { return this; }
  lineStyle() { return this; }
  beginFill() { return this; }
  drawRect() { return this; }
  drawRoundedRect() { return this; }
  drawCircle() { return this; }
  endFill() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  arc() { return this; }
  bezierCurveTo() { return this; }
}

class Sprite extends Container {
  constructor(path) {
    super();
    this.path = path;
    this.anchor = new Anchor();
    this.width = 0;
    this.height = 0;
  }
  static fromImage(path) { return new Sprite(path); }
}

class Text extends Container {
  constructor(value, style) {
    super();
    this.text = String(value);
    this.style = { ...style };
    this.anchor = new Anchor();
  }
  get width() { return this.text.length * (Number(this.style.fontSize) || 14) * 0.58; }
}

const PIXI = { Container, Graphics, Sprite, Text };
const listeners = {};
const shareCalls = [];
const canvasListeners = {};
const canvas = {
  width: 2560,
  height: 1440,
  getBoundingClientRect() { return { left: 20, top: 10, width: 640, height: 360 }; },
  addEventListener(type, handler) { canvasListeners[type] = handler; },
  removeEventListener(type, handler) { if (canvasListeners[type] === handler) delete canvasListeners[type]; },
};
const wxApi = {
  getSystemInfoSync() { return { pixelRatio: 3 }; },
  onTouchStart(handler) { listeners.touchstart = handler; },
  offTouchStart(handler) { if (listeners.touchstart === handler) delete listeners.touchstart; },
  onMouseDown(handler) { listeners.mousedown = handler; },
  offMouseDown(handler) { if (listeners.mousedown === handler) delete listeners.mousedown; },
  onShow(handler) { listeners.show = handler; },
  offShow(handler) { if (listeners.show === handler) delete listeners.show; },
  shareAppMessage(payload) { shareCalls.push(payload); },
};
const runtimeEvents = {
  handlers: {},
  addEventListener(type, handler) { this.handlers[type] = handler; },
  removeEventListener(type, handler) { if (this.handlers[type] === handler) delete this.handlers[type]; },
};
const stage = new Container();
const game = {
  stage,
  renderer: { screen: { width: 1280, height: 720 }, width: 2560, height: 1440, resolution: 2, view: canvas },
  pitch: {
    redTeam: { score: 1 },
    blueTeam: { score: 3 },
    matchTime: 5400,
    secondHalf: false,
    paused: false,
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    ball: { velocity: { x: 0, y: 0, z: 0 } },
  },
};
const inputHost = {
  devicePixelRatio: 3,
  __matchStats: {
    red: { ownTicks: 48, shots: 10, passes: 61, slides: 11, corners: 3, throwIns: 4, goalKicks: 5 },
    blue: { ownTicks: 52, shots: 18, passes: 54, slides: 6, corners: 7, throwIns: 6, goalKicks: 4 },
  },
  requestAnimationFrame(callback) { this.__nextFrame = callback; return 1; },
  cancelAnimationFrame() {},
};
let homeCount = 0;
let rematchCount = 0;

const chrome = createMatchChrome({
  PIXI,
  game,
  inputHost,
  runtimeEvents,
  wxApi,
  config: {
    redTeam: "england",
    blueTeam: "portugal",
    redJersey: { locationLabel: "镇隆" },
    blueJersey: { locationLabel: "广州" },
  },
  onHome() { homeCount += 1; },
  onRematch() { rematchCount += 1; },
});

assert.equal(typeof listeners.touchstart, "function", "真机 HUD 必须在 touchstart 即时响应");
assert.equal(typeof listeners.mousedown, "function", "开发者工具 HUD 必须接入 wx.onMouseDown");
assert.equal(typeof canvasListeners.mousedown, "function", "Canvas 鼠标必须接入比赛 HUD");

// Canvas screen position (640, 69) -> CSS position (340, 44.5) -> physical pointer (1020, 133.5).
listeners.touchstart({ touches: [{ clientX: 1020, clientY: 133.5 }] });
assert.equal(inputHost.__RURAL_FOOTBALL_MATCH_LAST_TOUCH__.hit.kind, "score", "物理像素触点必须命中比分栏");
const allTexts = [];
const collectTexts = (node) => {
  if (node instanceof Text) allTexts.push(node.text);
  for (const child of node.children || []) collectTexts(child);
};
collectTexts(chrome.root);
assert.ok(allTexts.includes("比赛数据"), "点击比分栏后必须展开射门、传球、抢断等比赛数据");
assert.ok(allTexts.includes("镇") && allTexts.includes("隆") && allTexts.includes("广") && allTexts.includes("州"), "场边必须一字一牌展示双方最终地名");
assert.ok(!allTexts.includes("镇\n隆") && !allTexts.includes("广\n州"), "同一块牌不得再挤入多个地名字");
const sidelineBackgrounds = chrome.root.children
  .flatMap((layer) => layer.children || [])
  .filter((node) => node.__ruralSidelineBackgroundAlpha != null);
const sidelineLabels = chrome.root.children
  .flatMap((layer) => layer.children || [])
  .filter((node) => node.__ruralSidelineLabelOpaque);
assert.ok(sidelineBackgrounds.length >= 4 && sidelineBackgrounds.every((node) => node.__ruralSidelineBackgroundAlpha === 0.72), "场边队名牌主底板必须与比分牌使用相同透明度");
assert.ok(sidelineLabels.length >= 4 && sidelineLabels.every((node) => node.alpha === 1), "场边地名字必须保持完全不透明");
const captainPortraits = chrome.root.children
  .flatMap((layer) => layer.children || [])
  .filter((node) => node instanceof Sprite && node.__ruralCaptainFacing);
assert.equal(captainPortraits.length, 2, "比分栏必须显示两名队长头像");
assert.match(captainPortraits.find((node) => node.__ruralCaptainFacing === "right").path, /graduate-forward\.png$/, "主队 HUD 必须固定显示返乡大学生主角");
assert.match(captainPortraits.find((node) => node.__ruralCaptainFacing === "left").path, /rider-winger\.png$/, "客队 HUD 必须显示真实客队名单人物");
assert.equal(captainPortraits.find((node) => node.__ruralCaptainFacing === "right").scale.x < 0, true, "左侧队长必须面向右侧");
assert.equal(captainPortraits.find((node) => node.__ruralCaptainFacing === "left").scale.x > 0, true, "右侧队长必须面向左侧");
const scoreBackground = chrome.root.children
  .flatMap((layer) => layer.children || [])
  .find((node) => node.__ruralScoreBackgroundAlpha != null);
assert.equal(scoreBackground.__ruralScoreBackgroundAlpha, 0.94, "比分牌白色底板必须与暂停键使用相同不透明度");
assert.equal(scoreBackground.parent.alpha, 1, "比分牌文字和数字所在层必须保持完全不透明");

runtimeEvents.handlers["ab-goal"]({
  detail: { score: [2, 3], red: "england", blue: "portugal", scoringSide: "red", scorerSide: "red", scorerId: 5 },
});
let goalPortraits = chrome.root.children.flatMap((layer) => layer.children || []).filter((node) => node instanceof Sprite);
assert.ok(goalPortraits.some((node) => /bamboo-craftsman\.png$/.test(node.path)), "非Argentina红方进球必须显示该球队实际名单的进球队员头像");
runtimeEvents.handlers["ab-goal"]({
  detail: { score: [2, 4], red: "england", blue: "portugal", scoringSide: "blue", scorerSide: "blue", scorerId: 10 },
});
goalPortraits = chrome.root.children.flatMap((layer) => layer.children || []).filter((node) => node instanceof Sprite);
assert.ok(goalPortraits.some((node) => /fishpond-farmer\.png$/.test(node.path)), "蓝方进球必须显示真实进球队员头像");
runtimeEvents.handlers["ab-goal"]({
  detail: { score: [2, 5], red: "england", blue: "portugal", scoringSide: "blue", scorerSide: "blue", scorerId: -1 },
});
goalPortraits = chrome.root.children.flatMap((layer) => layer.children || []).filter((node) => node instanceof Sprite);
assert.ok(goalPortraits.some((node) => /rider-winger\.png$/.test(node.path)), "缺失进球人ID时必须回退得分方队长");
const toolbarKinds = chrome.root.children
  .flatMap((layer) => layer.children || [])
  .filter((node) => node.__ruralToolKind)
  .map((node) => node.__ruralToolKind);
assert.deepEqual(
  toolbarKinds,
  ["zoom-out", "zoom-in", "home", "sound-on", "camera"],
  "左上工具栏必须只保留缩小、放大、主页、声音和截图",
);
assert.equal(toolbarKinds.includes("replay"), false, "无效复位按钮必须删除");
assert.equal(toolbarKinds.includes("adjust"), false, "按键调整按钮不得继续占据比赛界面");
assert.equal(toolbarKinds.includes("info"), false, "说明按钮不得继续占据比赛界面");
const largeShareControls = chrome.root.children
  .flatMap((layer) => layer.children || [])
  .filter((node) => node.__ruralShareControl);
assert.equal(largeShareControls.length, 2, "比分牌旁必须有大号分享按钮的背景和图标");

// HUD 尺寸随 match-chrome 的 scale 公式（height/720*1.18，封顶 2.6）。
// 坐标全部按公式推导，避免 HUD 布局调整后测试坐标失效。
const S = Math.max(0.58, Math.min(720 / 720 * 1.18, 2.6));
// 顶部工具栏第 3 个按钮（home）中心：起点 12、按钮宽 44、间距 7、命中区 y 17..61。
const homeToolCx = (12 + 2 * (44 + 7) + 22) * S;
const homeToolCy = (17 + 22) * S;
listeners.mousedown({ clientX: 20 + homeToolCx / 2, clientY: 10 + homeToolCy / 2 });
assert.equal(homeCount, 1, "开发者工具点击主页图标必须立即调用返回主页");

// 分享、暂停按钮依次位于比分栏右侧，分享时自动暂停，返回后恢复。
const barW = Math.min(1280 * 0.5, 490 * S);
const barX = (1280 - barW) / 2;
const shareX = Math.min(barX + barW + 16 * S, 1280 - (66 + 10 + 66 + 18) * S);
const shareCx = shareX + 33 * S;
const pauseCx = shareX + (66 + 10 + 33) * S;
const pauseCy = (16 + 33) * S;
listeners.mousedown({ clientX: 20 + shareCx / 2, clientY: 10 + pauseCy / 2 });
assert.equal(game.pitch.paused, true, "分享过程中必须自动暂停比赛");
assert.equal(shareCalls.length, 1);
assert.match(shareCalls[0].title, /1:3！快来踢球$/, "比赛分享标题必须携带实时比分");
listeners.show();
assert.equal(game.pitch.paused, false, "从分享界面返回后必须自动继续原本运行的比赛");
listeners.mousedown({ clientX: 20 + pauseCx / 2, clientY: 10 + pauseCy / 2 });
assert.equal(game.pitch.paused, true, "点击暂停必须调用真实 pitch.pause");
assert.equal(chrome.setPaused(false), false, "继续按钮必须恢复比赛");
assert.equal(game.pitch.paused, false);
chrome.setPaused(true);
chrome.pauseForShare();
listeners.show();
assert.equal(game.pitch.paused, true, "分享前已经手动暂停时，返回后不得自动继续比赛");
chrome.setPaused(false);

// 下半场双方实际换边后，场边队名牌也必须同步换边。
game.pitch.secondHalf = true;
inputHost.__nextFrame();
const sidelineTexts = chrome.root.children[0].children.filter((node) => node instanceof Text);
const redPlacard = sidelineTexts.find((node) => node.text === "镇");
const bluePlacard = sidelineTexts.find((node) => node.text === "广");
assert.ok(redPlacard.position.x > 1000, "下半场红队名牌必须移动到右侧");
assert.ok(bluePlacard.position.x < 200, "下半场蓝队名牌必须移动到左侧");
assert.ok(redPlacard.position.y < 260, "场边队名牌必须整体上移并避开右下操作区");

chrome.showResult({ score: [1, 3] });
// 赛果卡按钮几何（与 showResult 中公式一致）。
const cardH = Math.min(720 * 0.78, 510 * S);
const cardY = (720 - cardH) / 2;
const resultButtonY = cardY + cardH - 65 * S;
const resultButtonW = 185 * S;
const resultGap = 24 * S;
const rematchCx = 640 - resultButtonW - resultGap / 2 + resultButtonW / 2;
const homeResultCx = 640 + resultGap / 2 + resultButtonW / 2;
const resultBtnCy = resultButtonY + 24 * S;
// 再来一局：开发者工具逻辑 CSS 鼠标坐标。
canvasListeners.mousedown({ clientX: 20 + rematchCx / 2, clientY: 10 + resultBtnCy / 2 });
assert.equal(rematchCount, 1, "赛果页再来一局必须可点击");
// 返回主页：真机 3 倍物理像素触点。
listeners.touchstart({ touches: [{ clientX: (20 + homeResultCx / 2) * 3, clientY: (10 + resultBtnCy / 2) * 3 }] });
assert.equal(homeCount, 2, "赛果页返回主页必须兼容真机物理像素触点");

const mapped = mapMatchPointerCandidates({
  raw: { x: (20 + homeResultCx / 2) * 3, y: (10 + resultBtnCy / 2) * 3 },
  width: 1280,
  height: 720,
  canvas,
  devicePixelRatio: 3,
  resolution: 2,
});
assert.ok(mapped.some((entry) => Math.abs(entry.point.x - homeResultCx) < 0.1 && Math.abs(entry.point.y - resultBtnCy) < 0.1));

chrome.destroy();
assert.equal(listeners.touchstart, undefined, "销毁 HUD 必须注销真机触摸监听");
assert.equal(listeners.mousedown, undefined, "销毁 HUD 必须注销开发者工具鼠标监听");
assert.equal(canvasListeners.mousedown, undefined, "销毁 HUD 必须注销 Canvas 鼠标监听");
assert.equal(listeners.show, undefined, "销毁 HUD 必须注销分享返回监听");

inputHost.__ORIGINAL_RUNTIME_MATCH_SYNC__ = {
  role: "guest",
  currentGuestFrame: {
    redTeam: { score: 2 },
    blueTeam: { score: 4 },
    matchTime: 3600,
    secondHalf: true,
    ball: { velocity: { x: 1, y: 0, z: 0 } },
  },
};
const guestChrome = createMatchChrome({
  PIXI,
  game,
  inputHost,
  runtimeEvents,
  wxApi,
  config: { redTeam: "england", blueTeam: "portugal", localRole: "guest", friendPhase: "friend" },
});
const guestTexts = [];
const collectGuestTexts = (node) => {
  if (node instanceof Text) guestTexts.push(node.text);
  for (const child of node.children || []) collectGuestTexts(child);
};
collectGuestTexts(guestChrome.root);
assert.ok(guestTexts.includes("2") && guestTexts.includes("4"), "好友 HUD 比分必须来自房主权威帧");
assert.ok(guestTexts.includes("60'"), "好友 HUD 时间必须来自房主权威帧");
assert.match(guestChrome.shareTitle(), /2:4！快来踢球$/, "好友客机分享必须读取房主权威比分");
guestChrome.showResult({ score: [2, 4] });
const guestResultTexts = [];
const collectGuestResultTexts = (node) => {
  if (node instanceof Text) guestResultTexts.push(node.text);
  for (const child of node.children || []) collectGuestResultTexts(child);
};
collectGuestResultTexts(guestChrome.root);
assert.ok(guestResultTexts.includes("我的球队获胜"), "蓝方好友获胜时赛果视角必须正确");
guestChrome.destroy();

console.info("[test:match-chrome-input] PASS：比分展开、主页、再来一局和高 DPI 触点均正常");
