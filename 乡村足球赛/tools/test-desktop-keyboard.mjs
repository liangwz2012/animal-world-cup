import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DESKTOP_KEY_BINDINGS,
  installDesktopKeyboardInput,
  isDesktopWechat,
  normalizeDesktopKey,
} = require("../src/input/desktop-keyboard.js");

assert.equal(isDesktopWechat({ getDeviceInfo: () => ({ platform: "windows" }) }), true);
assert.equal(isDesktopWechat({ getDeviceInfo: () => ({ platform: "mac" }) }), true);
assert.equal(isDesktopWechat({ getDeviceInfo: () => ({ platform: "ios" }) }), false);
assert.equal(isDesktopWechat({ getDeviceInfo: () => ({ platform: "android" }) }), false);
assert.equal(isDesktopWechat({ getDeviceInfo: () => ({ platform: "devtools" }) }), false);
assert.equal(normalizeDesktopKey({ keyCode: 87 }), "KeyW");
assert.equal(normalizeDesktopKey({ key: " " }), "Space");
assert.deepEqual(DESKTOP_KEY_BINDINGS, {
  KeyW: "move-up", KeyA: "move-left", KeyS: "move-down", KeyD: "move-right",
  ArrowUp: "lob", ArrowLeft: "pass", ArrowRight: "sprint", ArrowDown: "tackle", Space: "shoot",
});

function makeInput() {
  return {
    active: true, vx: 0, vy: 0, shoot: false, sprint: false, pass: false, lob: false, tackle: false,
    __visual: { flashUntil: { pass: 0, lob: 0, tackle: 0 }, lastAction: "", lastActionAt: 0 },
  };
}

const callbacks = {};
const wxDesktop = {
  getDeviceInfo: () => ({ platform: "windows" }),
  onKeyDown(fn) { callbacks.down = fn; }, offKeyDown(fn) { if (callbacks.down === fn) delete callbacks.down; },
  onKeyUp(fn) { callbacks.up = fn; }, offKeyUp(fn) { if (callbacks.up === fn) delete callbacks.up; },
  onHide(fn) { callbacks.hide = fn; }, offHide(fn) { if (callbacks.hide === fn) delete callbacks.hide; },
};
const host = {};
const input = makeInput();
const installed = installDesktopKeyboardInput(host, wxDesktop, input);
assert.equal(installed.enabled, true);
assert.equal(host.__RURAL_DESKTOP_KEYBOARD_ACTIVE__, true);

callbacks.down({ code: "KeyW" });
callbacks.down({ code: "KeyD" });
assert.equal(Number(input.vx.toFixed(3)), 0.707);
assert.equal(Number(input.vy.toFixed(3)), -0.707);
callbacks.up({ code: "KeyW" });
assert.equal(input.vx, 1);
assert.equal(input.vy, 0);

callbacks.down({ code: "ArrowUp" });
assert.equal(input.lob, true);
input.lob = false;
callbacks.down({ code: "ArrowUp", repeat: true });
assert.equal(input.lob, false, "按住方向键不得重复触发挑传脉冲");
callbacks.up({ code: "ArrowUp" });

callbacks.down({ code: "ArrowLeft" });
assert.equal(input.pass, true);
callbacks.up({ code: "ArrowLeft" });
callbacks.down({ code: "ArrowDown" });
assert.equal(input.tackle, true);
callbacks.up({ code: "ArrowDown" });
callbacks.down({ code: "ArrowRight" });
assert.equal(input.sprint, true);
callbacks.up({ code: "ArrowRight" });
assert.equal(input.sprint, false);
callbacks.down({ code: "Space" });
assert.equal(input.shoot, true);
callbacks.up({ code: "Space" });
assert.equal(input.shoot, false);

callbacks.hide();
assert.equal(input.vx, 0);
installed.dispose();
assert.equal(host.__RURAL_DESKTOP_KEYBOARD_ACTIVE__, false);

const mobileInput = makeInput();
const mobile = installDesktopKeyboardInput({}, { getDeviceInfo: () => ({ platform: "ios" }) }, mobileInput);
assert.equal(mobile.enabled, false, "手机端不得安装电脑版键盘逻辑");
assert.equal(mobileInput.vx, 0);

console.info("[test:desktop-keyboard] PASS：PC 微信键位、持续/脉冲语义、手机隔离和清理正常");
