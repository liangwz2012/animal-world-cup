import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { installMiniWindow, normalizeAssetPath } = require("../src/platform/adapter.js");
const { bindMatchSyncState, detectPhysicalMobileDevice } = require("../src/boot/start.js");

const canvas = {
  width: 0,
  height: 0,
  style: {},
  getContext() { return {}; },
};

globalThis.wx = {
  getSystemInfoSync() {
    return { windowWidth: 412, windowHeight: 915, screenWidth: 412, screenHeight: 915, pixelRatio: 3 };
  },
};

const platform = installMiniWindow({ canvas });
assert.equal(globalThis.innerWidth, 915);
assert.equal(globalThis.innerHeight, 412);
assert.equal(globalThis.devicePixelRatio, 3);
assert.equal(canvas.width, 2745);
assert.equal(canvas.height, 1236);
assert.deepEqual(globalThis.navigator.getGamepads(), [], "微信真机必须用空数组兼容网页 Gamepad 轮询");
assert.equal(normalizeAssetPath("/animal-cup/audio/pass.mp3"), "runtime-assets/animal-cup/audio/pass.mp3");
assert.equal(normalizeAssetPath("shell-assets/portraits/argentina.png"), "shell-assets/portraits/argentina.png");
assert.equal(platform.canvas, canvas);
assert.equal(detectPhysicalMobileDevice({ getDeviceInfo: () => ({ platform: "ios" }) }), true);
assert.equal(detectPhysicalMobileDevice({ getDeviceInfo: () => ({ platform: "android" }) }), true);
assert.equal(detectPhysicalMobileDevice({ getDeviceInfo: () => ({ platform: "devtools" }) }), false);

const remoteInput = { active: false, vx: 0, vy: 0 };
const matchSync = {
  role: "off",
  sessionKind: "friend",
  remoteInput,
  acceptsRemoteInput() { return false; },
};
const separateRoot = { window: {} };
const separateHost = { window: { __touchInput2: { stale: true } } };
const firstBinding = bindMatchSyncState(separateRoot, separateHost, matchSync);
assert.equal(firstBinding.runtimeWindow, separateHost.window, "必须绑定原版脚本实际读取的 runtime window");
assert.equal(firstBinding.touch2Bound, true);
assert.equal(separateHost.window.__touchInput2, remoteInput);
assert.equal(separateRoot.window.__touchInput2, remoteInput);
separateHost.window.__touchInput2 = { staleAfterHotReload: true };
const rebound = bindMatchSyncState(separateRoot, separateHost, matchSync);
assert.equal(rebound.touch2Bound, true, "热重载覆盖 touchInput2 后必须再次强制重绑");
assert.equal(separateHost.window.__touchInput2, remoteInput);

console.info("[test:platform] PASS：真机横屏、高 DPI、Gamepad 空实现和资源路径正常");
