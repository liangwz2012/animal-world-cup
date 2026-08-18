import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { installMiniWindow, normalizeAssetPath } = require("../src/platform/adapter.js");
const {
  bindMatchSyncState,
  bindRuntimeEventBus,
  detectPhysicalMobileDevice,
  isVisibleMatchReady,
} = require("../src/boot/start.js");

const canvas = {
  width: 0,
  height: 0,
  style: {},
  getContext() { return {}; },
};

let imageStatSyncCalls = 0;
const imageReadCalls = [];
function createTestImage() {
  let src = "";
  const image = {};
  Object.defineProperty(image, "src", {
    configurable: true,
    get() { return src; },
    set(value) {
      src = value;
      if (typeof image.onload === "function") image.onload({ type: "load", target: image });
    },
  });
  return image;
}

globalThis.wx = {
  getSystemInfoSync() {
    return { windowWidth: 412, windowHeight: 915, screenWidth: 412, screenHeight: 915, pixelRatio: 3 };
  },
  createImage: createTestImage,
  getFileSystemManager() {
    return {
      statSync() {
        imageStatSyncCalls += 1;
        return null;
      },
      readFileSync(path, encoding) {
        imageReadCalls.push([path, encoding]);
        return "ZmFrZS1wbmc=";
      },
    };
  },
};

const platform = installMiniWindow({ canvas });
assert.equal(globalThis.innerWidth, 915);
assert.equal(globalThis.innerHeight, 412);
assert.equal(globalThis.devicePixelRatio, 3);
assert.equal(canvas.width, 2745);
assert.equal(canvas.height, 1236);
assert.deepEqual(globalThis.navigator.getGamepads(), [], "微信真机必须用空数组兼容网页 Gamepad 轮询");
assert.equal(normalizeAssetPath("/rural-football/audio/pass.mp3"), "runtime-assets/rural-football/audio/pass.mp3");
assert.equal(normalizeAssetPath("shell-assets/portraits/argentina.png"), "shell-assets/portraits/argentina.png");
assert.equal(platform.canvas, canvas);
assert.equal(detectPhysicalMobileDevice({ getDeviceInfo: () => ({ platform: "ios" }) }), true);
assert.equal(detectPhysicalMobileDevice({ getDeviceInfo: () => ({ platform: "android" }) }), true);
assert.equal(detectPhysicalMobileDevice({ getDeviceInfo: () => ({ platform: "devtools" }) }), false);

const testImage = new globalThis.Image();
testImage.__rfSrc = "runtime-assets/rural-football/images/fans-stat-regression.png";
assert.equal(imageStatSyncCalls, 0, "分包图片不得调用会在 DevTools 内部 Object.keys(null) 的 statSync");
assert.deepEqual(
  imageReadCalls[0],
  ["runtime-assets/rural-football/images/fans-stat-regression.png", "base64"],
  "分包图片应直接读取 base64",
);
assert.equal(testImage.src, "data:image/png;base64,ZmFrZS1wbmc=");

const staleRootBus = {
  addEventListener() {},
  dispatchEvent() {},
};
const standaloneWindowBus = {
  addEventListener() {},
  dispatchEvent() {},
};
const makeRuntimeEvent = () => ({ type: "test" });
const eventRoot = {
  __ruralFootballEvents: staleRootBus,
};
const eventInputHost = {
  window: {
    __ruralFootballEvents: standaloneWindowBus,
    __ruralFootballCustomEvent: makeRuntimeEvent,
  },
};
assert.equal(
  bindRuntimeEventBus(eventRoot, eventInputHost),
  standaloneWindowBus,
  "监听端必须优先绑定 standalone 实际派发事件的 window 总线",
);
assert.equal(eventRoot.__ruralFootballEvents, standaloneWindowBus, "GameGlobal 必须与原版 window 共用业务事件总线");
assert.equal(eventInputHost.__ruralFootballEvents, standaloneWindowBus);
assert.equal(eventRoot.__ruralFootballCustomEvent, makeRuntimeEvent);
assert.equal(
  isVisibleMatchReady({
    __matchGame: {
      renderer: { gl: {} },
      stadium: {},
      states: { current: { ready: true } },
    },
  }, {}),
  true,
  "比赛状态已进入 play phase 且 WebGL/球场存在时，B2 watchdog 应识别为真实可见",
);
assert.equal(
  isVisibleMatchReady({
    __matchGame: {
      renderer: { gl: {} },
      stadium: {},
      states: { current: { ready: false } },
    },
  }, {}),
  false,
  "仍未进入 play phase 时不得把加载中的球场误判为首帧",
);

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
