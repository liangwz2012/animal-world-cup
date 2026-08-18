import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computeControlLayout } = require("../src/input/control-layout.js");
const { installTouchInput } = require("../src/input/touch.js");
const { mirrorTouchTelemetry } = require("../src/boot/start.js");

const callbacks = {};
let zoomValue = 1;
const wxMock = {
  onTouchStart(cb) { callbacks.start = cb; },
  onTouchMove(cb) { callbacks.move = cb; },
  onTouchEnd(cb) { callbacks.end = cb; },
  onTouchCancel(cb) { callbacks.cancel = cb; },
  onHide(cb) { callbacks.hide = cb; },
};
const root = {
  __matchZoom: {
    get() { return zoomValue; },
    set(value) { zoomValue = value; },
  },
};
const input = installTouchInput(root, wxMock, 1000, 500);
const layout = computeControlLayout(1000, 500);
const touch = (identifier, x, y) => ({ identifier, clientX: x, clientY: y });

const stickRight = touch("stick", layout.stick.x + layout.stick.radius, layout.stick.y);
callbacks.start({ touches: [stickRight], changedTouches: [stickRight] });
assert.equal(input.active, true);
assert.equal(input.vx, 1);
assert.equal(input.vy, 0);
assert.equal(input.sprint, false, "推动摇杆不应自动冲刺");

const sprint = touch("sprint", layout.actions.sprint.x, layout.actions.sprint.y);
callbacks.start({ touches: [stickRight, sprint], changedTouches: [sprint] });
assert.equal(input.vx, 1);
assert.equal(input.sprint, true, "双指应能同时移动和冲刺");
callbacks.end({ touches: [stickRight], changedTouches: [sprint] });
assert.equal(input.vx, 1);
assert.equal(input.sprint, false);
callbacks.end({ touches: [], changedTouches: [stickRight] });
assert.equal(input.active, true, "控制层挂载期间 active 必须保持为 true");
assert.equal(input.vx, 0);

const pass = touch("pass", layout.actions.pass.x, layout.actions.pass.y);
callbacks.start({ touches: [pass], changedTouches: [pass] });
assert.equal(input.pass, true);
input.pass = false; // 模拟原版 acApplyInput 消费单次脉冲
callbacks.move({ touches: [pass], changedTouches: [] });
assert.equal(input.pass, false, "传球按住时不能重复产生脉冲");
callbacks.end({ touches: [], changedTouches: [pass] });

const lob = touch("lob", layout.actions.lob.x, layout.actions.lob.y);
callbacks.start({ touches: [lob], changedTouches: [lob] });
assert.equal(input.lob, true);
input.lob = false;
callbacks.end({ touches: [], changedTouches: [lob] });

const tackle = touch("tackle", layout.actions.tackle.x, layout.actions.tackle.y);
callbacks.start({ touches: [tackle], changedTouches: [tackle] });
assert.equal(input.tackle, true);
input.tackle = false;
callbacks.end({ touches: [], changedTouches: [tackle] });

const shoot = touch("shoot", layout.actions.shoot.x, layout.actions.shoot.y);
callbacks.start({ touches: [shoot], changedTouches: [shoot] });
assert.equal(input.shoot, true);
const shootMoved = touch("shoot", layout.actions.shoot.x - 100, layout.actions.shoot.y - 100);
callbacks.move({ touches: [shootMoved], changedTouches: [] });
assert.equal(input.shoot, true, "射门应沿用网页 pointer capture 的按住语义");
callbacks.end({ touches: [], changedTouches: [shootMoved] });
assert.equal(input.shoot, false);

callbacks.start({ touches: [stickRight, sprint], changedTouches: [stickRight, sprint] });
callbacks.cancel({ touches: [], changedTouches: [stickRight, sprint] });
assert.equal(input.vx, 0);
assert.equal(input.sprint, false);

const pinchA = { identifier: 10, clientX: 400, clientY: 190 };
const pinchB = { identifier: 11, clientX: 600, clientY: 190 };
callbacks.start({ touches: [pinchA, pinchB], changedTouches: [pinchA, pinchB] });
callbacks.move({ touches: [pinchA, { ...pinchB, clientX: 700 }], changedTouches: [] });
assert.equal(Math.round(zoomValue * 10) / 10, 1.5, "球场空白区双指张开应放大镜头");
assert.equal(root.__ORIGINAL_RUNTIME_ZOOM_GESTURE_SEEN__, true);
callbacks.end({ touches: [], changedTouches: [pinchA, pinchB] });

zoomValue = 1;
callbacks.start({ touches: [stickRight, sprint], changedTouches: [stickRight, sprint] });
callbacks.move({ touches: [stickRight, { ...sprint, clientX: sprint.clientX + 80 }], changedTouches: [] });
assert.equal(zoomValue, 1, "摇杆加动作键的双指组合不得触发缩放");
callbacks.cancel({ touches: [], changedTouches: [stickRight, sprint] });
assert.ok(root.__ORIGINAL_RUNTIME_TOUCH_EVENTS__ >= 12);

// GameGlobal === globalThis 时不能安装读取自身的 getter。模拟一次旧热重载
// 留下的递归访问器，确认新逻辑会把它安全替换为普通数据属性。
const sharedRoot = {};
Object.defineProperty(sharedRoot, "__ORIGINAL_RUNTIME_TOUCH_EVENTS__", {
  configurable: true,
  get() { return sharedRoot.__ORIGINAL_RUNTIME_TOUCH_EVENTS__; },
});
mirrorTouchTelemetry(sharedRoot, sharedRoot);
const repairedDescriptor = Object.getOwnPropertyDescriptor(
  sharedRoot,
  "__ORIGINAL_RUNTIME_TOUCH_EVENTS__",
);
assert.equal(typeof repairedDescriptor.get, "undefined");
assert.equal(sharedRoot.__ORIGINAL_RUNTIME_TOUCH_EVENTS__, 0);

const gameRoot = {};
const separateInputHost = { __ORIGINAL_RUNTIME_TOUCH_EVENTS__: 7 };
mirrorTouchTelemetry(gameRoot, separateInputHost);
assert.equal(gameRoot.__ORIGINAL_RUNTIME_TOUCH_EVENTS__, 7);
gameRoot.__ORIGINAL_RUNTIME_TOUCH_EVENTS__ = 8;
assert.equal(separateInputHost.__ORIGINAL_RUNTIME_TOUCH_EVENTS__, 8);

console.info("[test:touch] PASS：原网站摇杆、双指、点按、长按、松手与取消语义均正常");
