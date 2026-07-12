import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createGameShell } = require("../src/ui/game-shell.js");
const { defaults } = require("../src/data/game-options.js");

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
  getChildByName(name) { return this.children.find((child) => child.name === name); }
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
}

const imagePaths = [];
class Sprite extends Container {
  constructor(path) {
    super();
    this.path = path;
    this.anchor = new Anchor();
    this.alpha = 1;
    this.rotation = 0;
  }
  static fromImage(path) {
    imagePaths.push(path);
    return new Sprite(path);
  }
}

class Text extends Container {
  constructor(value, style) {
    super();
    this.text = String(value);
    this.style = style;
    this.anchor = new Anchor();
  }
}

let rendererOptions = null;
const renderer = {
  render() {},
  resize(width, height) { this.lastResize = { width, height }; },
};
const PIXI = {
  Container,
  Graphics,
  Sprite,
  Text,
  autoDetectRenderer(width, height, options) {
    rendererOptions = { width, height, options };
    return renderer;
  },
};

let touchStart = null;
let mouseDown = null;
let action = null;
const wxApi = {
  getSystemInfoSync() { return { windowWidth: 915, windowHeight: 412, pixelRatio: 2 }; },
  onTouchStart(handler) { touchStart = handler; },
  offTouchStart(handler) { if (touchStart === handler) touchStart = null; },
  onMouseDown(handler) { mouseDown = handler; },
  offMouseDown(handler) { if (mouseDown === handler) mouseDown = null; },
};

const canvasListeners = {};
const canvas = {
  addEventListener(type, handler) { canvasListeners[type] = handler; },
  removeEventListener(type, handler) { if (canvasListeners[type] === handler) delete canvasListeners[type]; },
};

const shell = createGameShell({
  PIXI,
  canvas,
  wxApi,
  width: 915,
  height: 412,
  resolution: 2,
  pixelRatio: 3,
  config: defaults(),
  onAction(type) { action = type; },
  requestFrame() { return 1; },
  cancelFrame() {},
});
shell.showHome(defaults());

assert.equal(rendererOptions.options.resolution, 2, "高 DPI 真机必须以 2 倍分辨率渲染");
assert.equal(rendererOptions.options.autoResize, true);
assert.equal(typeof touchStart, "function", "真机选队页必须在 touchstart 即时响应");
assert.equal(typeof mouseDown, "function", "PC 小游戏鼠标必须接入选队页");
assert.equal(typeof canvasListeners.mousedown, "function", "开发者工具 Canvas 鼠标必须接入选队页");
for (const teamId of ["england", "france", "germany", "spain", "portugal", "brazil", "argentina", "usa"]) {
  assert.ok(imagePaths.includes(`shell-assets/portraits/${teamId}.png`), `${teamId} 头像必须从主包加载`);
}

// Android 某些基础库会返回设备物理像素，而 Canvas 为节省性能只按 2 倍渲染。
// 金色“立即开赛”几何中心为 (640, 635)，换算 3 倍设备像素约 (1373, 1090)。
touchStart({ touches: [{ clientX: 1373, clientY: 1090 }] });
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "ai", "设备像素比与 Canvas 分辨率不同时仍必须命中立即对战按钮");

action = null;
shell.showHome(defaults());
mouseDown({ clientX: 458, clientY: 363 });
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "ai", "PC 小游戏逻辑像素鼠标必须命中立即对战按钮");

action = null;
shell.showHome(defaults());
canvasListeners.mousedown({ clientX: 271, clientY: 363 });
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "watch", "开发者工具 Canvas 鼠标必须命中观看对战按钮");

action = null;
shell.showHome(defaults());
canvasListeners.mousedown({ clientX: 644, clientY: 363 });
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "invite", "右侧好友对战必须使用当前配置创建邀请");
assert.equal(shell.screen, "friend-room");
assert.equal(shell.config.mode, "friend");
assert.equal(shell.friendState.status, "creating");

shell.setFriendState({ status: "waiting_host", roomId: "room-test" });
assert.equal(shell.friendState.status, "waiting_host", "公共状态方法必须能驱动等待好友界面");
shell.setFriendState({ status: "guest_can_spectate", role: "guest" });
assert.equal(shell.friendState.status, "guest_can_spectate", "好友端必须可表达观看热身赛状态");
shell.setFriendState({ status: "queue_after_warmup", role: "guest", guestSpectating: false });
assert.equal(shell.friendState.status, "queued_after_warmup", "服务端热身排队状态必须映射到等待层");

action = null;
shell.setFriendState({ status: "waiting_host", role: "host" });
canvasListeners.mousedown({ clientX: 458, clientY: 258 });
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "warmup-ai", "房主等待时必须可先开始 AI 热身");

action = null;
shell.setFriendState({ status: "host_warmup", role: "host" });
canvasListeners.mousedown({ clientX: 530, clientY: 258 });
await new Promise((resolve) => setTimeout(resolve, 130));
assert.equal(action, "queue-friend-after-warmup", "好友上线后房主必须可选择踢完当前热身局");

shell.destroy();
assert.equal(touchStart, null, "销毁页面必须注销真机触摸监听");
assert.equal(mouseDown, null, "销毁页面必须注销 PC 鼠标监听");
assert.equal(canvasListeners.mousedown, undefined, "销毁页面必须注销 Canvas 鼠标监听");

console.info("[test:game-shell] PASS：主包头像、高 DPI、Android 触点和开发者工具鼠标正常");
