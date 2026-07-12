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

function computeControlLayout(width, height, safeArea) {
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
  const padLeft = logicalWidth - safe.right - margin - padSize;
  // Reserve a small teaching-caption strip below the action diamond.  The
  // direction stick stays where players expect it; only the right cluster is
  // lifted slightly so labels never collide with the home indicator.
  const hintReserve = 34 * scale;
  const padTop = logicalHeight - safe.bottom - margin - padSize - hintReserve;

  const layout = {
    width: logicalWidth,
    height: logicalHeight,
    scale,
    safe,
    stick: {
      x: safe.left + margin + stickRadius,
      y: logicalHeight - safe.bottom - margin - stickRadius,
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
