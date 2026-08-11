// 浏览器平台实现：和微信实现暴露同一套接口，游戏层完全不知道自己跑在哪。

export function createBrowserPlatform(canvas) {
  const target = canvas || document.getElementById("game") || document.createElement("canvas");
  if (!target.parentNode) document.body.appendChild(target);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const state = { width: window.innerWidth, height: window.innerHeight };

  // 有些容器（预览面板、内嵌 webview）首帧的 innerWidth 是 0，
  // 所以既要多路取值兜底，也要每帧轮询一次尺寸变化。
  // ?w=390&h=844 可以强制画布尺寸：自动化截图和不同机型比例的验收都靠它
  const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const forcedW = Number(params.get("w")) || 0;
  const forcedH = Number(params.get("h")) || 0;
  const measure = () => ({
    width: forcedW || window.innerWidth || document.documentElement?.clientWidth || window.visualViewport?.width || screen?.width || 375,
    height: forcedH || window.innerHeight || document.documentElement?.clientHeight || window.visualViewport?.height || screen?.height || 667,
  });

  const resize = () => {
    const next = measure();
    state.width = next.width;
    state.height = next.height;
    target.style.width = `${state.width}px`;
    target.style.height = `${state.height}px`;
    target.width = Math.floor(state.width * dpr);
    target.height = Math.floor(state.height * dpr);
  };
  resize();
  window.addEventListener("resize", resize);

  const pointerHandlers = { start: [], move: [], end: [] };
  const toPoint = (event) => ({ id: event.pointerId ?? 0, x: event.clientX, y: event.clientY });
  const active = new Map();
  const emit = (kind, event) => {
    const point = toPoint(event);
    if (kind === "start") active.set(point.id, point);
    else if (kind === "move" && active.has(point.id)) active.set(point.id, point);
    else if (kind === "end") active.delete(point.id);
    const payload = { touches: [...active.values()], changed: [point] };
    for (const handler of pointerHandlers[kind]) handler(payload);
  };
  target.addEventListener("pointerdown", (e) => {
    target.setPointerCapture?.(e.pointerId);
    emit("start", e);
  });
  target.addEventListener("pointermove", (e) => emit("move", e));
  target.addEventListener("pointerup", (e) => emit("end", e));
  target.addEventListener("pointercancel", (e) => emit("end", e));
  target.addEventListener("contextmenu", (e) => e.preventDefault());

  return {
    id: "browser",
    canvas: target,
    get width() {
      return state.width;
    },
    get height() {
      return state.height;
    },
    dpr,
    safeArea: { top: 0, bottom: state.height, left: 0, right: state.width },
    createCanvas(w, h) {
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      return off;
    },
    raf(callback) {
      return requestAnimationFrame(callback);
    },
    now() {
      return performance.now();
    },
    // 返回 true 表示尺寸变了，游戏层据此重建布局
    pollResize() {
      const next = measure();
      if (next.width === state.width && next.height === state.height) return false;
      resize();
      return true;
    },
    onTouchStart(handler) {
      pointerHandlers.start.push(handler);
    },
    onTouchMove(handler) {
      pointerHandlers.move.push(handler);
    },
    onTouchEnd(handler) {
      pointerHandlers.end.push(handler);
    },
    onShow(handler) {
      window.addEventListener("focus", handler);
    },
    onHide(handler) {
      window.addEventListener("blur", handler);
    },
    vibrate() {},
    storage: {
      get(key, fallback) {
        try {
          const value = localStorage.getItem(key);
          return value === null ? fallback : JSON.parse(value);
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* 隐私模式下写不进去也不影响比赛 */
        }
      },
    },
    keyboard: true,
  };
}
