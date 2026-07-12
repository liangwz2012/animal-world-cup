const { computeControlLayout, hitTestControl } = require("./control-layout");

const PULSE_ACTIONS = new Set(["pass", "lob", "tackle"]);
const HOLD_ACTIONS = new Set(["shoot", "sprint"]);

function touchId(touch, fallbackIndex) {
  if (touch && touch.identifier != null) return String(touch.identifier);
  if (touch && touch.id != null) return String(touch.id);
  if (touch && touch.fingerId != null) return String(touch.fingerId);
  return `index-${fallbackIndex}`;
}

function touchPoint(touch, fallbackIndex) {
  return {
    id: touchId(touch, fallbackIndex),
    x: Number(touch && (touch.clientX == null ? touch.x : touch.clientX)) || 0,
    y: Number(touch && (touch.clientY == null ? touch.y : touch.clientY)) || 0,
  };
}

function touchList(list) {
  const result = [];
  const source = list || [];
  for (let index = 0; index < source.length; index += 1) {
    result.push(touchPoint(source[index], index));
  }
  return result;
}

function installTouchInput(globalObject, wxApi, width, height, safeArea) {
  if (typeof globalObject.__ORIGINAL_RUNTIME_TOUCH_DISPOSE__ === "function") {
    try { globalObject.__ORIGINAL_RUNTIME_TOUCH_DISPOSE__(); } catch (error) {}
  }

  const primary = globalObject.__touchInput = {
    // 与原网站 TouchControls 一致：控制层挂载期间始终激活。松手由零向量表达，
    // 不能把 active 设为 false，否则原版循环会跳过归零输入并产生粘键。
    active: true,
    vx: 0,
    vy: 0,
    shoot: false,
    sprint: false,
    pass: false,
    lob: false,
    switchPlayer: false,
    tackle: false,
    __visual: {
      flashUntil: { pass: 0, lob: 0, tackle: 0 },
      lastAction: "",
      lastActionAt: 0,
      comboText: "",
      comboUntil: 0,
    },
  };
  const assignments = new Map();
  let pinch = null;
  let layout = computeControlLayout(width, height, safeArea);
  primary.__layout = layout;
  globalObject.__ORIGINAL_RUNTIME_CONTROL_LAYOUT__ = layout;

  const updateLayout = (nextWidth, nextHeight, nextSafeArea) => {
    layout = computeControlLayout(nextWidth, nextHeight, nextSafeArea);
    primary.__layout = layout;
    globalObject.__ORIGINAL_RUNTIME_CONTROL_LAYOUT__ = layout;
    return layout;
  };
  globalObject.__ORIGINAL_RUNTIME_UPDATE_CONTROL_LAYOUT__ = updateLayout;

  const assignStart = (point) => {
    if (assignments.has(point.id)) return;
    const role = hitTestControl(layout, point.x, point.y);
    if (!role) return;
    if (role === "stick") {
      for (const assignment of assignments.values()) {
        if (assignment.role === "stick") return;
      }
    }
    assignments.set(point.id, { role, point });
    if (role !== "stick") {
      primary.__visual.lastAction = role;
      primary.__visual.lastActionAt = Date.now();
    }
    if (PULSE_ACTIONS.has(role)) {
      primary[role] = true;
      primary.__visual.flashUntil[role] = Date.now() + 140;
    }
  };

  const applyContinuousState = () => {
    primary.active = true;
    primary.vx = 0;
    primary.vy = 0;
    primary.shoot = false;
    primary.sprint = false;
    primary.switchPlayer = false;

    for (const assignment of assignments.values()) {
      const { role, point } = assignment;
      if (role === "stick") {
        const dx = point.x - layout.stick.x;
        const dy = point.y - layout.stick.y;
        const magnitude = Math.hypot(dx, dy);
        const normalized = magnitude / layout.stick.radius;
        if (normalized >= layout.stick.deadZone) {
          const factor = magnitude > layout.stick.radius
            ? layout.stick.radius / magnitude
            : 1;
          primary.vx = Math.max(-1, Math.min(1, (dx * factor) / layout.stick.radius));
          primary.vy = Math.max(-1, Math.min(1, (dy * factor) / layout.stick.radius));
        }
      } else if (HOLD_ACTIONS.has(role)) {
        primary[role] = true;
      }
    }
  };

  const recordTelemetry = (phase, activeTouchCount) => {
    globalObject.__ORIGINAL_RUNTIME_TOUCH_EVENTS__ = (globalObject.__ORIGINAL_RUNTIME_TOUCH_EVENTS__ || 0) + 1;
    globalObject.__ORIGINAL_RUNTIME_LAST_TOUCH__ = {
      phase: phase || "update",
      touches: activeTouchCount,
      active: primary.active,
      vx: primary.vx,
      vy: primary.vy,
      pass: primary.pass,
      lob: primary.lob,
      tackle: primary.tackle,
      shoot: primary.shoot,
      sprint: primary.sprint,
      zooming: !!pinch,
      at: Date.now(),
    };
    if (primary.vx || primary.vy || primary.pass || primary.lob || primary.tackle || primary.shoot || primary.sprint) {
      globalObject.__ORIGINAL_RUNTIME_INPUT_SEEN__ = true;
    }
  };

  const updatePinch = (activePoints, phase) => {
    if (phase === "cancel" || activePoints.length < 2) {
      pinch = null;
      return;
    }
    const zoom = globalObject.__matchZoom
      || globalObject.window && globalObject.window.__matchZoom;
    if (!zoom || typeof zoom.set !== "function") return;

    if (!pinch) {
      const first = activePoints[0];
      const second = activePoints[1];
      // 两根手指必须都从球场空白区域开始。摇杆+动作键双指组合不能误触缩放。
      if (assignments.has(first.id) || assignments.has(second.id)) return;
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (distance < 20) return;
      pinch = {
        ids: [first.id, second.id],
        startDistance: distance,
        startZoom: typeof zoom.get === "function" ? Number(zoom.get()) || 1 : 1,
      };
      return;
    }

    const first = activePoints.find((item) => item.id === pinch.ids[0]);
    const second = activePoints.find((item) => item.id === pinch.ids[1]);
    if (!first || !second) {
      pinch = null;
      return;
    }
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    zoom.set(pinch.startZoom * distance / pinch.startDistance);
    globalObject.__ORIGINAL_RUNTIME_ZOOM_GESTURE_SEEN__ = true;
  };

  const update = (event, phase) => {
    const activePoints = touchList(event && event.touches);
    const activeById = new Map(activePoints.map((point) => [point.id, point]));

    if (phase === "cancel") {
      assignments.clear();
    } else {
      if (phase === "start") {
        const changed = touchList(event && event.changedTouches);
        const startingPoints = changed.length ? changed : activePoints;
        for (const point of startingPoints) assignStart(point);
      }

      for (const [id, assignment] of assignments) {
        const point = activeById.get(id);
        if (!point) assignments.delete(id);
        else assignment.point = point;
      }
    }

    updatePinch(activePoints, phase);
    applyContinuousState();
    recordTelemetry(phase, activePoints.length);
    return globalObject.__ORIGINAL_RUNTIME_LAST_TOUCH__;
  };

  // 桌面模拟器不会把鼠标拖动转换为 wx.onTouch*。此钩子只验证
  // “触摸坐标 → 原版输入对象 → Pixi 控件反馈”的后半段，不替代真机验收。
  globalObject.__ORIGINAL_RUNTIME_INJECT_TOUCH__ = (touches, phase) => {
    const normalizedPhase = phase || "diagnostic";
    return update({
      touches: touches || [],
      changedTouches: normalizedPhase === "start" ? (touches || []) : [],
    }, normalizedPhase);
  };

  const listeners = [];
  const listen = (onName, offName, callback) => {
    if (!wxApi || typeof wxApi[onName] !== "function") return;
    wxApi[onName](callback);
    listeners.push({ offName, callback });
  };
  const clear = () => update({ touches: [], changedTouches: [] }, "cancel");
  listen("onTouchStart", "offTouchStart", (event) => update(event, "start"));
  listen("onTouchMove", "offTouchMove", (event) => update(event, "move"));
  listen("onTouchEnd", "offTouchEnd", (event) => update(event, "end"));
  listen("onTouchCancel", "offTouchCancel", clear);
  listen("onHide", "offHide", clear);

  globalObject.__ORIGINAL_RUNTIME_TOUCH_DISPOSE__ = () => {
    clear();
    for (const listener of listeners) {
      if (wxApi && typeof wxApi[listener.offName] === "function") {
        try { wxApi[listener.offName](listener.callback); } catch (error) {}
      }
    }
    assignments.clear();
    pinch = null;
  };

  return primary;
}

module.exports = { installTouchInput, touchId, touchPoint };
