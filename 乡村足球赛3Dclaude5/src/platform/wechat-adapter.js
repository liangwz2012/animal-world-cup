// 微信小游戏运行时垫片：three.js 假定自己活在浏览器里，这里补齐它真正会用到的那几个口子。
// 只补最小面：window/document/navigator 存根、主 canvas 的事件与样式属性、Image/URL 的空壳。
// 这个模块必须在 import three 之前被求值（入口文件里放在第一行 import）。

const wxApi = typeof wx !== "undefined" ? wx : null;
const root = typeof GameGlobal !== "undefined" ? GameGlobal : typeof globalThis !== "undefined" ? globalThis : this;

export const isWechatMiniGame = Boolean(wxApi && typeof wxApi.createCanvas === "function");

function noop() {}

function patchCanvas(canvas, width, height) {
  if (!canvas || canvas.__ruralPatched) return canvas;
  canvas.__ruralPatched = true;
  if (!canvas.style) canvas.style = { width: `${width}px`, height: `${height}px` };
  if (!canvas.addEventListener) canvas.addEventListener = noop;
  if (!canvas.removeEventListener) canvas.removeEventListener = noop;
  if (!canvas.dispatchEvent) canvas.dispatchEvent = noop;
  if (!canvas.setAttribute) canvas.setAttribute = noop;
  if (!canvas.getAttribute) canvas.getAttribute = () => null;
  if (!canvas.getBoundingClientRect) {
    canvas.getBoundingClientRect = () => ({ top: 0, left: 0, right: width, bottom: height, width, height, x: 0, y: 0 });
  }
  if (canvas.clientWidth === undefined) canvas.clientWidth = width;
  if (canvas.clientHeight === undefined) canvas.clientHeight = height;
  if (!canvas.ownerDocument) canvas.ownerDocument = root.document;
  return canvas;
}

export function installWechatShims() {
  if (!isWechatMiniGame || root.__ruralShimInstalled) return false;
  root.__ruralShimInstalled = true;

  const info = wxApi.getWindowInfo ? wxApi.getWindowInfo() : wxApi.getSystemInfoSync();
  const width = info.windowWidth || info.screenWidth || 375;
  const height = info.windowHeight || info.screenHeight || 667;
  const dpr = info.pixelRatio || 2;

  const documentShim = {
    createElement(tag) {
      if (String(tag).toLowerCase() === "canvas") return patchCanvas(wxApi.createCanvas(), 1, 1);
      return { style: {}, addEventListener: noop, removeEventListener: noop, appendChild: noop };
    },
    createElementNS(_ns, tag) {
      return documentShim.createElement(tag);
    },
    createTextNode: () => ({}),
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    getElementById: () => null,
    documentElement: { style: {} },
    body: { appendChild: noop, style: {} },
    head: { appendChild: noop },
    // three 的 WebGLRenderer 会读它判断是否可以做全屏纹理拷贝
    createEvent: () => ({ initEvent: noop }),
  };

  if (!root.document) root.document = documentShim;
  if (!root.navigator) {
    root.navigator = { userAgent: "wechat-minigame", platform: info.platform || "devtools", language: "zh-CN", maxTouchPoints: 5 };
  }
  if (!root.window) root.window = root;
  if (!root.self) root.self = root;
  root.innerWidth = width;
  root.innerHeight = height;
  root.devicePixelRatio = dpr;
  if (!root.HTMLCanvasElement) root.HTMLCanvasElement = function HTMLCanvasElement() {};
  if (!root.HTMLImageElement) root.HTMLImageElement = function HTMLImageElement() {};
  if (!root.ImageBitmap) root.ImageBitmap = function ImageBitmap() {};
  if (!root.OffscreenCanvas) root.OffscreenCanvas = function OffscreenCanvas() {};
  if (!root.URL) root.URL = { createObjectURL: () => "", revokeObjectURL: noop };
  if (!root.addEventListener) root.addEventListener = noop;
  if (!root.removeEventListener) root.removeEventListener = noop;
  if (!root.performance) root.performance = { now: () => Date.now() };
  if (!root.requestAnimationFrame && typeof requestAnimationFrame !== "undefined") {
    root.requestAnimationFrame = requestAnimationFrame;
  }
  return true;
}

// 模块被求值时立刻装垫片：入口文件把这一行放在 import three 之前，
// three 里任何 `typeof window` 判断看到的都已经是补好的环境。
if (isWechatMiniGame) installWechatShims();

export function createWechatPlatform() {
  installWechatShims();
  const info = wxApi.getWindowInfo ? wxApi.getWindowInfo() : wxApi.getSystemInfoSync();
  const width = info.windowWidth || info.screenWidth || 375;
  const height = info.windowHeight || info.screenHeight || 667;
  const dpr = Math.min(info.pixelRatio || 2, 2.5);
  const canvas = patchCanvas(wxApi.createCanvas(), width, height);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  return {
    id: "wechat",
    canvas,
    width,
    height,
    dpr,
    safeArea: info.safeArea || { top: 0, bottom: height, left: 0, right: width },
    createCanvas(w, h) {
      const off = patchCanvas(wxApi.createCanvas(), w, h);
      off.width = w;
      off.height = h;
      return off;
    },
    raf(callback) {
      return (root.requestAnimationFrame || requestAnimationFrame)(callback);
    },
    now() {
      return Date.now();
    },
    onTouchStart(handler) {
      wxApi.onTouchStart((event) => handler(normalizeTouches(event)));
    },
    onTouchMove(handler) {
      wxApi.onTouchMove((event) => handler(normalizeTouches(event)));
    },
    onTouchEnd(handler) {
      wxApi.onTouchEnd((event) => handler(normalizeTouches(event)));
      wxApi.onTouchCancel((event) => handler(normalizeTouches(event)));
    },
    onShow(handler) {
      wxApi.onShow?.(handler);
    },
    onHide(handler) {
      wxApi.onHide?.(handler);
    },
    vibrate(kind = "light") {
      wxApi.vibrateShort?.({ type: kind });
    },
    storage: {
      get(key, fallback) {
        try {
          const value = wxApi.getStorageSync(key);
          return value === "" || value === undefined ? fallback : value;
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          wxApi.setStorageSync(key, value);
        } catch {
          /* 存储写失败不影响比赛 */
        }
      },
    },
  };
}

function normalizeTouches(event) {
  const list = event.touches || event.changedTouches || [];
  return {
    touches: Array.prototype.map.call(list, (t) => ({ id: t.identifier, x: t.clientX ?? t.x ?? 0, y: t.clientY ?? t.y ?? 0 })),
    changed: Array.prototype.map.call(event.changedTouches || [], (t) => ({ id: t.identifier, x: t.clientX ?? t.x ?? 0, y: t.clientY ?? t.y ?? 0 })),
  };
}
