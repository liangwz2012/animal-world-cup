import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createMatchChrome, mapMatchPointerCandidates } = require("../src/ui/match-chrome.js");

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
  config: { redTeam: "england", blueTeam: "portugal" },
  onHome() { homeCount += 1; },
  onRematch() { rematchCount += 1; },
});

assert.equal(typeof listeners.touchstart, "function", "真机 HUD 必须在 touchstart 即时响应");
assert.equal(typeof listeners.mousedown, "function", "开发者工具 HUD 必须接入 wx.onMouseDown");
assert.equal(typeof canvasListeners.mousedown, "function", "Canvas 鼠标必须接入比赛 HUD");

// Canvas screen position (640, 69) -> CSS position (340, 44.5) -> physical pointer (1020, 133.5).
listeners.touchstart({ touches: [{ clientX: 1020, clientY: 133.5 }] });
assert.equal(inputHost.__ANIMAL_FOOTBALL_MATCH_LAST_TOUCH__.hit.kind, "score", "物理像素触点必须命中比分栏");
const allTexts = [];
const collectTexts = (node) => {
  if (node instanceof Text) allTexts.push(node.text);
  for (const child of node.children || []) collectTexts(child);
};
collectTexts(chrome.root);
assert.ok(allTexts.includes("比赛数据"), "点击比分栏后必须展开射门、传球、抢断等比赛数据");

// Top toolbar home icon center is renderer position (187, 38).
listeners.mousedown({ clientX: 20 + 187 / 2, clientY: 10 + 38 / 2 });
assert.equal(homeCount, 1, "开发者工具点击主页图标必须立即调用返回主页");

chrome.showResult({ score: [1, 3] });
// Result rematch center is (535.5, 574); use logical CSS mouse coordinates.
canvasListeners.mousedown({ clientX: 20 + 535.5 / 2, clientY: 10 + 574 / 2 });
assert.equal(rematchCount, 1, "赛果页再来一局必须可点击");
// Result home center is (744.5, 574); use 3x physical touch coordinates.
listeners.touchstart({ touches: [{ clientX: (20 + 744.5 / 2) * 3, clientY: (10 + 574 / 2) * 3 }] });
assert.equal(homeCount, 2, "赛果页返回主页必须兼容真机物理像素触点");

const mapped = mapMatchPointerCandidates({
  raw: { x: (20 + 744.5 / 2) * 3, y: (10 + 574 / 2) * 3 },
  width: 1280,
  height: 720,
  canvas,
  devicePixelRatio: 3,
  resolution: 2,
});
assert.ok(mapped.some((entry) => Math.abs(entry.point.x - 744.5) < 0.1 && Math.abs(entry.point.y - 574) < 0.1));

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
