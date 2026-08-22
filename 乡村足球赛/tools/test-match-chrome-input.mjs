import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const matchChromeSource = fs.readFileSync(new URL("../src/ui/match-chrome.js", import.meta.url), "utf8");
assert.doesNotMatch(matchChromeSource, /team_cheer_\d+/, "进球不得再映射旧动物球队助威声");
assert.match(matchChromeSource, /sound\.play\("goal_cheer"/, "主客队进球必须统一播放人类观众欢呼");
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
    ball: { velocity: { x: 0, y: 0, z: 0 } },
  },
};
const inputHost = {
  devicePixelRatio: 3,
  __matchStats: {
    red: { ownTicks: 48, shots: 10, passes: 61, slides: 11, corners: 3, throwIns: 4, goalKicks: 5 },
    blue: { ownTicks: 52, shots: 18, passes: 54, slides: 6, corners: 7, throwIns: 6, goalKicks: 4 },
  },
  requestAnimationFrame() { return 1; },
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
const captainPortraits = chrome.root.children
  .flatMap((layer) => layer.children || [])
  .filter((node) => node instanceof Sprite && node.__ruralCaptainFacing);
assert.equal(captainPortraits.length, 2, "比分栏必须显示两名队长头像");
assert.match(captainPortraits.find((node) => node.__ruralCaptainFacing === "right").path, /graduate-forward\.png$/, "主队 HUD 必须固定显示返乡大学生主角");
assert.match(captainPortraits.find((node) => node.__ruralCaptainFacing === "left").path, /rider-winger\.png$/, "客队 HUD 必须显示真实客队名单人物");
assert.equal(captainPortraits.find((node) => node.__ruralCaptainFacing === "right").scale.x < 0, true, "左侧队长必须面向右侧");
assert.equal(captainPortraits.find((node) => node.__ruralCaptainFacing === "left").scale.x > 0, true, "右侧队长必须面向左侧");

// HUD 尺寸随 match-chrome 的 scale 公式（height/720*1.18，封顶 2.6）。
// 坐标全部按公式推导，避免 HUD 布局调整后测试坐标失效。
const S = Math.max(0.58, Math.min(720 / 720 * 1.18, 2.6));
// 顶部工具栏第 4 个按钮（home）中心：起点 12、按钮宽 44、间距 7、命中区 y 17..61。
const homeToolCx = (12 + 3 * (44 + 7) + 22) * S;
const homeToolCy = (17 + 22) * S;
listeners.mousedown({ clientX: 20 + homeToolCx / 2, clientY: 10 + homeToolCy / 2 });
assert.equal(homeCount, 1, "开发者工具点击主页图标必须立即调用返回主页");

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
