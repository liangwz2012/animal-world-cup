const ACTIONS = ["lob", "pass", "tackle", "shoot", "sprint"];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSafeArea(width, height, safeArea) {
  if (!safeArea || typeof safeArea !== "object") {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }
  const left = clamp(Number(safeArea.left) || 0, 0, width * 0.2);
  const top = clamp(Number(safeArea.top) || 0, 0, height * 0.2);
  const rightEdge = Number(safeArea.right);
  const bottomEdge = Number(safeArea.bottom);
  const right = Number.isFinite(rightEdge)
    ? clamp(width - rightEdge, 0, width * 0.2)
    : 0;
  const bottom = Number.isFinite(bottomEdge)
    ? clamp(height - bottomEdge, 0, height * 0.2)
    : 0;
  return { left, right, top, bottom };
}

function computeControlLayout(width, height, safeArea, overrides) {
  const logicalWidth = Math.max(1, Number(width) || 1280);
  const logicalHeight = Math.max(1, Number(height) || 720);
  const safe = normalizeSafeArea(logicalWidth, logicalHeight, safeArea);
  const scale = clamp(logicalHeight / 720, 0.75, 1);
  const margin = 22 * scale;
  const stickRadius = 66 * scale;
  const thumbRadius = 30 * scale;
  const padSize = 208 * scale;
  const actionRadius = 31 * scale;
  const sprintRadius = 28 * scale;
  // 横向内边距封顶：底部两角是拇指区，横屏刘海/灵动岛在顶部中央，不应把摇杆和
  // 动作键群按整段刘海安全区(可达 ~50px)往屏幕中间推。这里只保留“圆角安全余量”
  // 级别的内边距，让两簇控件贴回左右下角——这是大屏机型“波轮太右/按钮太左”的根因修复。
  const cornerInsetCap = 16 * scale;
  const insetLeft = clamp(safe.left, 0, cornerInsetCap);
  const insetRight = clamp(safe.right, 0, cornerInsetCap);

  // Reserve a small teaching-caption strip below the action diamond.  The
  // direction stick stays where players expect it; only the right cluster is
  // lifted slightly so labels never collide with the home indicator.
  const hintReserve = 34 * scale;

  // 默认(自适配)簇中心：波轮贴左下角，动作键群贴右下角。
  let stickX = insetLeft + margin + stickRadius;
  let stickY = logicalHeight - safe.bottom - margin - stickRadius;
  // 动作键群以中央冲刺键为中心，与 padLeft+104*scale / padTop+104*scale 对齐。
  const padHalf = 104 * scale;
  let padCenterX = (logicalWidth - insetRight - margin - padSize) + padHalf;
  let padCenterY = (logicalHeight - safe.bottom - margin - padSize - hintReserve) + padHalf;

  // 玩家自定义位置(归一化中心)覆盖默认值，并夹紧到屏内保证整簇可见可点。
  if (overrides && overrides.stick) {
    const minX = stickRadius + 4;
    const minY = stickRadius + 4;
    stickX = clamp(overrides.stick.nx * logicalWidth, minX, logicalWidth - minX);
    stickY = clamp(overrides.stick.ny * logicalHeight, minY, logicalHeight - minY);
  }
  if (overrides && overrides.pad) {
    const halfW = padHalf + actionRadius;
    const halfH = padHalf + actionRadius;
    padCenterX = clamp(overrides.pad.nx * logicalWidth, halfW + 4, logicalWidth - halfW - 4);
    padCenterY = clamp(overrides.pad.ny * logicalHeight, halfH + 4, logicalHeight - halfH - 4);
  }
  const padLeft = padCenterX - padHalf;
  const padTop = padCenterY - padHalf;

  const layout = {
    width: logicalWidth,
    height: logicalHeight,
    scale,
    safe,
    stick: {
      x: stickX,
      y: stickY,
      radius: stickRadius,
      thumbRadius,
      hitRadius: stickRadius + 14 * scale,
      deadZone: 0.18,
    },
    actions: {
      lob: {
        x: padLeft + 104 * scale,
        y: padTop + 31 * scale,
        radius: actionRadius,
        hitRadius: 36 * scale,
        mode: "pulse",
      },
      pass: {
        x: padLeft + 31 * scale,
        y: padTop + 104 * scale,
        radius: actionRadius,
        hitRadius: 36 * scale,
        mode: "pulse",
      },
      tackle: {
        x: padLeft + 177 * scale,
        y: padTop + 104 * scale,
        radius: actionRadius,
        hitRadius: 36 * scale,
        mode: "pulse",
      },
      shoot: {
        x: padLeft + 104 * scale,
        y: padTop + 177 * scale,
        radius: actionRadius,
        hitRadius: 36 * scale,
        mode: "hold",
      },
      sprint: {
        x: padLeft + 104 * scale,
        y: padTop + 104 * scale,
        radius: sprintRadius,
        hitRadius: 32 * scale,
        mode: "hold",
      },
    },
    hint: {
      x: padLeft + 104 * scale,
      y: logicalHeight - safe.bottom - 43 * scale,
      width: 74 * scale,
      height: 27 * scale,
    },
  };
  return layout;
}

function pointInCircle(x, y, circle) {
  const dx = x - circle.x;
  const dy = y - circle.y;
  const radius = circle.hitRadius || circle.radius;
  return dx * dx + dy * dy <= radius * radius;
}

function hitTestControl(layout, x, y) {
  if (pointInCircle(x, y, layout.stick)) return "stick";
  // 中央冲刺键与四周动作键接近，先检测较小的中央键。
  const order = ["sprint", "lob", "pass", "tackle", "shoot"];
  for (const action of order) {
    if (pointInCircle(x, y, layout.actions[action])) return action;
  }
  return null;
}

module.exports = { ACTIONS, computeControlLayout, hitTestControl, pointInCircle };
