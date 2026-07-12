import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computeControlLayout } = require("../src/input/control-layout.js");
const { createTouchControlsOverlay } = require("../src/ui/touch-controls.js");
const { resolveRuntimePixi } = require("../src/boot/start.js");

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
  }
  addChild(child) {
    if (child.parent) child.parent.removeChild(child);
    child.parent = this;
    this.children.push(child);
    return child;
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
  drawCircle() { return this; }
  drawRoundedRect() { return this; }
  endFill() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  bezierCurveTo() { return this; }
}

class Text extends Container {
  constructor(value, style) {
    super();
    this.text = String(value);
    this.style = style;
    this.anchor = new Anchor();
    this.alpha = 1;
    this.visible = true;
  }
}

const PIXI = { Container, Graphics, Text };
const resolvedPixi = resolveRuntimePixi(
  { PIXI: { VERSION: "4.8.9" } },
  { window: { require(id) { return id === "pixi" ? PIXI : null; } } },
);
assert.equal(resolvedPixi, PIXI, "顶层 PIXI 被原版删除后必须从 AMD pixi 模块恢复");
const stage = new Container();
const game = { stage, renderer: { screen: { width: 1000, height: 500 }, resolution: 1 } };
const globalObject = {};
const layout = computeControlLayout(1000, 500);
const input = {
  active: true,
  vx: 0,
  vy: 0,
  shoot: false,
  sprint: false,
  __layout: layout,
  __visual: { flashUntil: { pass: 0, lob: 0, tackle: 0 } },
};

const overlay = createTouchControlsOverlay({ globalObject, PIXI, game, input });
assert.equal(globalObject.__ORIGINAL_RUNTIME_CONTROLS_VISIBLE__, true);
assert.equal(stage.children[0], overlay.root);
assert.equal(overlay.root.children.length, 8, "摇杆、五个动作键和教学提示层都必须存在");

input.vx = 1;
input.shoot = true;
overlay.update();
assert.ok(overlay.root.children[1].position.x > layout.stick.x, "摇杆帽必须跟随输入");
assert.equal(overlay.root.children[5].alpha, 1, "射门按下必须有视觉反馈");
const actionHint = overlay.root.children[7];
assert.equal(actionHint.visible, true, "按下动作键后必须显示中文教学提示");
assert.equal(actionHint.children[1].text, "射门", "射门键必须显示对应中文动作");

input.shoot = false;
input.__visual.lastAction = "lob";
input.__visual.lastActionAt = Date.now() + 1;
overlay.update();
assert.equal(actionHint.children[1].text, "挑传", "挑传键必须显示对应中文动作");

input.__visual.comboText = "二过一";
input.__visual.comboUntil = Date.now() + 1000;
overlay.update();
assert.equal(actionHint.children[1].text, "二过一", "组合技能必须复用教学提示层");

overlay.destroy();
assert.equal(globalObject.__ORIGINAL_RUNTIME_CONTROLS_VISIBLE__, false);
assert.equal(stage.children.length, 0);

console.info("[test:controls-ui] PASS：Pixi 摇杆、五键、按压反馈和销毁流程均正常");
