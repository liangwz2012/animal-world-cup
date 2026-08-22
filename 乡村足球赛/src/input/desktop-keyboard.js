const DESKTOP_PLATFORMS = new Set(["windows", "win32", "mac", "macos"]);

const DESKTOP_KEY_BINDINGS = Object.freeze({
  KeyW: "move-up",
  KeyA: "move-left",
  KeyS: "move-down",
  KeyD: "move-right",
  ArrowUp: "lob",
  ArrowLeft: "pass",
  ArrowRight: "sprint",
  ArrowDown: "tackle",
  Space: "shoot",
});

const KEY_CODE_ALIASES = Object.freeze({
  32: "Space", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown",
  65: "KeyA", 68: "KeyD", 83: "KeyS", 87: "KeyW",
});

function platformName(wxApi) {
  if (!wxApi) return "";
  try {
    const info = typeof wxApi.getDeviceInfo === "function"
      ? wxApi.getDeviceInfo()
      : typeof wxApi.getSystemInfoSync === "function"
        ? wxApi.getSystemInfoSync()
        : null;
    return String(info && (info.platform || info.system) || "").toLowerCase();
  } catch (error) {
    return "";
  }
}

function isDesktopWechat(wxApi) {
  const platform = platformName(wxApi);
  return [...DESKTOP_PLATFORMS].some((name) => platform === name || platform.startsWith(`${name} `));
}

function normalizeDesktopKey(event) {
  const source = event && typeof event === "object" ? event : {};
  if (typeof source.code === "string" && DESKTOP_KEY_BINDINGS[source.code]) return source.code;
  const key = typeof source.key === "string" ? source.key : "";
  const aliases = {
    w: "KeyW", W: "KeyW", a: "KeyA", A: "KeyA", s: "KeyS", S: "KeyS", d: "KeyD", D: "KeyD",
    " ": "Space", Spacebar: "Space",
    ArrowUp: "ArrowUp", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowDown: "ArrowDown",
  };
  if (aliases[key]) return aliases[key];
  return KEY_CODE_ALIASES[Number(source.keyCode || source.which)] || "";
}

function installDesktopKeyboardInput(globalObject, wxApi, input) {
  const host = globalObject || {};
  if (typeof host.__RURAL_DESKTOP_KEYBOARD_DISPOSE__ === "function") {
    try { host.__RURAL_DESKTOP_KEYBOARD_DISPOSE__(); } catch (error) {}
  }
  if (!isDesktopWechat(wxApi) || !input) {
    host.__RURAL_DESKTOP_KEYBOARD_ACTIVE__ = false;
    return { enabled: false, dispose() {} };
  }

  const pressed = new Set();
  const listeners = [];
  const pulses = new Set(["lob", "pass", "tackle"]);

  const updateContinuous = () => {
    let x = (pressed.has("KeyD") ? 1 : 0) - (pressed.has("KeyA") ? 1 : 0);
    let y = (pressed.has("KeyS") ? 1 : 0) - (pressed.has("KeyW") ? 1 : 0);
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    input.active = true;
    input.vx = x;
    input.vy = y;
    input.sprint = pressed.has("ArrowRight");
    input.shoot = pressed.has("Space");
    if (x || y || input.sprint || input.shoot) host.__ORIGINAL_RUNTIME_INPUT_SEEN__ = true;
  };

  const onKeyDown = (event) => {
    const code = normalizeDesktopKey(event);
    const action = DESKTOP_KEY_BINDINGS[code];
    if (!action) return;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    const firstPress = !pressed.has(code);
    pressed.add(code);
    if (firstPress && pulses.has(action)) {
      input[action] = true;
      if (input.__visual) {
        input.__visual.lastAction = action;
        input.__visual.lastActionAt = Date.now();
        if (input.__visual.flashUntil) input.__visual.flashUntil[action] = Date.now() + 140;
      }
    }
    updateContinuous();
    host.__RURAL_DESKTOP_KEYBOARD_LAST__ = { phase: "down", code, action, at: Date.now() };
  };

  const onKeyUp = (event) => {
    const code = normalizeDesktopKey(event);
    const action = DESKTOP_KEY_BINDINGS[code];
    if (!action) return;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    pressed.delete(code);
    if (pulses.has(action)) input[action] = false;
    updateContinuous();
    host.__RURAL_DESKTOP_KEYBOARD_LAST__ = { phase: "up", code, action, at: Date.now() };
  };

  const clear = () => {
    pressed.clear();
    input.vx = 0;
    input.vy = 0;
    input.shoot = false;
    input.sprint = false;
    input.pass = false;
    input.lob = false;
    input.tackle = false;
  };

  const listen = (target, onName, offName, handler) => {
    if (!target || typeof target[onName] !== "function") return false;
    target[onName](handler);
    listeners.push({ target, offName, handler });
    return true;
  };

  const wxBound = listen(wxApi, "onKeyDown", "offKeyDown", onKeyDown)
    && listen(wxApi, "onKeyUp", "offKeyUp", onKeyUp);
  if (!wxBound && typeof host.addEventListener === "function") {
    host.addEventListener("keydown", onKeyDown);
    host.addEventListener("keyup", onKeyUp);
    listeners.push({ target: host, offName: "removeEventListener:keydown", handler: onKeyDown });
    listeners.push({ target: host, offName: "removeEventListener:keyup", handler: onKeyUp });
  }
  listen(wxApi, "onHide", "offHide", clear);

  const dispose = () => {
    clear();
    for (const listener of listeners) {
      if (listener.offName.startsWith("removeEventListener:")) {
        const type = listener.offName.split(":")[1];
        if (typeof listener.target.removeEventListener === "function") listener.target.removeEventListener(type, listener.handler);
      } else if (typeof listener.target[listener.offName] === "function") {
        try { listener.target[listener.offName](listener.handler); } catch (error) {}
      }
    }
    host.__RURAL_DESKTOP_KEYBOARD_ACTIVE__ = false;
  };

  host.__RURAL_DESKTOP_KEYBOARD_ACTIVE__ = true;
  host.__RURAL_DESKTOP_KEYBOARD_DISPOSE__ = dispose;
  return { enabled: true, bindings: DESKTOP_KEY_BINDINGS, dispose };
}

module.exports = {
  DESKTOP_KEY_BINDINGS,
  installDesktopKeyboardInput,
  isDesktopWechat,
  normalizeDesktopKey,
  platformName,
};
