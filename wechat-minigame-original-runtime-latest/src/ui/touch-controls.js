function setPoint(point, x, y) {
  if (point && typeof point.set === "function") point.set(x, y);
  else if (point) { point.x = x; point.y = y; }
}

const ACTION_LABELS = {
  pass: "传球",
  lob: "挑传",
  tackle: "抢断",
  shoot: "射门",
  sprint: "冲刺",
};

function drawCircle(graphics, radius, color, fillAlpha, lineColor, lineAlpha, lineWidth) {
  graphics.clear();
  graphics.lineStyle(lineWidth, lineColor, lineAlpha);
  graphics.beginFill(color, fillAlpha);
  graphics.drawCircle(0, 0, radius);
  graphics.endFill();
}

function drawPassIcon(graphics, size, color) {
  graphics.lineStyle(2.5 * size, color, 0.96);
  graphics.moveTo(-9 * size, 0);
  graphics.lineTo(8 * size, 0);
  graphics.moveTo(2 * size, -6 * size);
  graphics.lineTo(9 * size, 0);
  graphics.lineTo(2 * size, 6 * size);
}

function drawLobIcon(graphics, size, color) {
  graphics.lineStyle(2.5 * size, color, 0.96);
  graphics.moveTo(-10 * size, 6 * size);
  graphics.bezierCurveTo(-4 * size, -9 * size, 6 * size, -9 * size, 10 * size, 2 * size);
  graphics.moveTo(10 * size, 2 * size);
  graphics.lineTo(10 * size, -4 * size);
  graphics.moveTo(10 * size, 2 * size);
  graphics.lineTo(4 * size, 4 * size);
}

function drawTackleIcon(graphics, size, color) {
  graphics.lineStyle(2.5 * size, color, 0.96);
  graphics.moveTo(0, -10 * size);
  graphics.lineTo(9 * size, -6 * size);
  graphics.lineTo(8 * size, 3 * size);
  graphics.bezierCurveTo(7 * size, 9 * size, 2 * size, 12 * size, 0, 13 * size);
  graphics.bezierCurveTo(-2 * size, 12 * size, -7 * size, 9 * size, -8 * size, 3 * size);
  graphics.lineTo(-9 * size, -6 * size);
  graphics.lineTo(0, -10 * size);
}

function drawShootIcon(graphics, size, color) {
  graphics.lineStyle(2.1 * size, color, 0.96);
  graphics.drawCircle(0, 0, 10 * size);
  const points = [];
  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
    points.push({ x: Math.cos(angle) * 4.2 * size, y: Math.sin(angle) * 4.2 * size });
  }
  graphics.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) graphics.lineTo(points[index].x, points[index].y);
  graphics.lineTo(points[0].x, points[0].y);
  for (const point of points) {
    const magnitude = Math.hypot(point.x, point.y) || 1;
    graphics.moveTo(point.x, point.y);
    graphics.lineTo(point.x / magnitude * 9.5 * size, point.y / magnitude * 9.5 * size);
  }
}

function drawSprintIcon(graphics, size, color) {
  graphics.lineStyle(2.8 * size, color, 0.92);
  for (const offset of [-4, 4]) {
    graphics.moveTo((offset - 4) * size, -7 * size);
    graphics.lineTo((offset + 3) * size, 0);
    graphics.lineTo((offset - 4) * size, 7 * size);
  }
}

function createButton(PIXI, parent, layout, action, color, iconDrawer) {
  const button = new PIXI.Graphics();
  const circle = layout.actions[action];
  drawCircle(button, circle.radius, color, 0.42, 0xffffff, 0.45, 2.5 * layout.scale);
  iconDrawer(button, layout.scale, action === "sprint" ? 0x3a2e0a : 0xfff7e2);
  setPoint(button.position, circle.x, circle.y);
  button.alpha = 0.82;
  button.interactive = false;
  button.name = `original-runtime-control-${action}`;
  parent.addChild(button);
  return button;
}

function visibleStageSize(game, fallbackWidth, fallbackHeight) {
  const renderer = game && game.renderer;
  const screen = renderer && renderer.screen;
  const resolution = renderer && renderer.resolution || 1;
  const width = screen && Number(screen.width)
    || renderer && Number(renderer.width) / resolution
    || fallbackWidth;
  const height = screen && Number(screen.height)
    || renderer && Number(renderer.height) / resolution
    || fallbackHeight;
  return { width, height };
}

function createTouchControlsOverlay(options) {
  const globalObject = options.globalObject;
  const PIXI = options.PIXI;
  const game = options.game;
  const input = options.input;
  if (!PIXI || !PIXI.Container || !PIXI.Graphics || !PIXI.Text) {
    throw new Error(
      `Pixi Graphics 不可用: pixi=${typeof PIXI}, Container=${typeof (PIXI && PIXI.Container)}, Graphics=${typeof (PIXI && PIXI.Graphics)}, version=${PIXI && PIXI.VERSION || "none"}`,
    );
  }
  if (!game || !game.stage || typeof game.stage.addChild !== "function") throw new Error("原版 game.stage 不可用");
  if (!input || !input.__layout) throw new Error("触控布局尚未安装");

  if (globalObject.__ORIGINAL_RUNTIME_CONTROLS_OVERLAY__
      && typeof globalObject.__ORIGINAL_RUNTIME_CONTROLS_OVERLAY__.destroy === "function") {
    globalObject.__ORIGINAL_RUNTIME_CONTROLS_OVERLAY__.destroy();
  }

  const root = new PIXI.Container();
  root.name = "original-runtime-touch-controls";
  root.interactive = false;
  root.interactiveChildren = false;
  game.stage.addChild(root);

  let layout = null;
  let stickBase = null;
  let stickThumb = null;
  let buttons = {};
  let hintRoot = null;
  let hintBackground = null;
  let hintText = null;
  let hintUntil = 0;
  let hintedAction = "";
  let lastActionAt = 0;
  let frameId = null;
  let destroyed = false;
  let editLayer = null;
  let editActive = false;

  // 编辑态覆盖层：半透明遮罩 + 顶部提示 + 底部“重置默认 / 完成”按钮。
  // 与控件同处 root 坐标空间(布局像素)，随 root.scale 一起映射到舞台。
  const buildEditLayer = () => {
    if (editLayer && typeof editLayer.destroy === "function") {
      if (editLayer.parent) editLayer.parent.removeChild(editLayer);
      try { editLayer.destroy({ children: true }); } catch (error) { editLayer.destroy(); }
    }
    editLayer = new PIXI.Container();
    editLayer.name = "original-runtime-control-edit";
    const s = layout.scale || 1;
    const W = layout.width;
    const H = layout.height;

    const scrim = new PIXI.Graphics();
    scrim.beginFill(0x0a1608, 0.42);
    scrim.drawRect(0, 0, W, H);
    scrim.endFill();
    editLayer.addChild(scrim);

    const stageSize = visibleStageSize(game, W, H);
    const upscale = Math.ceil(Math.max(1, stageSize.width / W));
    const makeText = (value, size, fill, weight) => {
      const t = new PIXI.Text(value, {
        fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif",
        fontSize: Math.max(11, Math.round(size * s)) * upscale,
        fontWeight: weight || "800",
        fill,
        align: "center",
      });
      t.scale.set(1 / upscale, 1 / upscale);
      if (t.anchor && t.anchor.set) t.anchor.set(0.5, 0.5);
      return t;
    };

    const hint = makeText("拖动摇杆和按钮到顺手的位置", 18, 0xfff7e2, "900");
    setPoint(hint.position, W / 2, (layout.safe && layout.safe.top || 0) + 30 * s);
    editLayer.addChild(hint);

    const rectsFn = globalObject.__ORIGINAL_RUNTIME_CONTROL_EDIT_RECTS__;
    const rects = typeof rectsFn === "function" ? rectsFn() : null;
    if (rects) {
      const drawButton = (rect, label, bg, fg) => {
        const g = new PIXI.Graphics();
        g.lineStyle(2 * s, 0xffffff, 0.4);
        g.beginFill(bg, 0.94);
        g.drawRoundedRect(rect.x, rect.y, rect.w, rect.h, rect.h / 2);
        g.endFill();
        editLayer.addChild(g);
        const t = makeText(label, 17, fg, "900");
        setPoint(t.position, rect.x + rect.w / 2, rect.y + rect.h / 2);
        editLayer.addChild(t);
      };
      drawButton(rects.reset, "重置默认", 0x7b8a9a, 0xffffff);
      drawButton(rects.done, "完成", 0x5d9038, 0xfff8dc);
    }
    root.addChild(editLayer);
  };

  const redraw = () => {
    layout = input.__layout;
    if (!layout) throw new Error("触控布局丢失");
    if (typeof root.removeChildren === "function") root.removeChildren();

    stickBase = new PIXI.Graphics();
    drawCircle(
      stickBase,
      layout.stick.radius,
      0xfffef8,
      0.14,
      0xffffff,
      0.28,
      2.5 * layout.scale,
    );
    setPoint(stickBase.position, layout.stick.x, layout.stick.y);
    root.addChild(stickBase);

    stickThumb = new PIXI.Graphics();
    drawCircle(
      stickThumb,
      layout.stick.thumbRadius,
      0xfffef8,
      0.48,
      0xffffff,
      0.34,
      2 * layout.scale,
    );
    setPoint(stickThumb.position, layout.stick.x, layout.stick.y);
    root.addChild(stickThumb);

    buttons = {
      lob: createButton(PIXI, root, layout, "lob", 0xc98a3b, drawLobIcon),
      pass: createButton(PIXI, root, layout, "pass", 0x4f8a2f, drawPassIcon),
      tackle: createButton(PIXI, root, layout, "tackle", 0x7b8a9a, drawTackleIcon),
      shoot: createButton(PIXI, root, layout, "shoot", 0x5d9038, drawShootIcon),
      sprint: createButton(PIXI, root, layout, "sprint", 0xf2b705, drawSprintIcon),
    };

    hintRoot = new PIXI.Container();
    hintRoot.name = "original-runtime-action-hint";
    hintRoot.visible = false;
    setPoint(hintRoot.position, layout.hint.x, layout.hint.y);
    hintBackground = new PIXI.Graphics();
    // 触控层整体会被 root.scale 放大到舞台物理尺寸（可达 3 倍）。文字纹理若按布局
    // 逻辑字号渲染再放大会糊；把放大倍数烘进字号、再等比缩回，得到逐物理像素的清晰文字。
    const stageSize = visibleStageSize(game, layout.width, layout.height);
    const upscale = Math.max(1, stageSize.width / layout.width);
    hintText = new PIXI.Text("", {
      fontFamily: "Arial, PingFang SC, Microsoft YaHei, sans-serif",
      fontSize: Math.max(11, Math.round(16 * layout.scale)) * Math.ceil(upscale),
      fontWeight: "800",
      fill: 0xfff7e2,
      align: "center",
    });
    hintText.scale.set(1 / Math.ceil(upscale), 1 / Math.ceil(upscale));
    if (hintText.anchor && hintText.anchor.set) hintText.anchor.set(0.5, 0.5);
    setPoint(hintText.position, 0, 0);
    hintRoot.addChild(hintBackground);
    hintRoot.addChild(hintText);
    root.addChild(hintRoot);
  };

  const setHintLabel = (label, action) => {
    const value = String(label || "");
    if (!hintRoot || !hintBackground || !hintText) return;
    hintText.text = value;
    const width = Math.max(layout.hint.width, (value.length * 18 + 24) * layout.scale);
    const height = layout.hint.height;
    hintBackground.clear();
    hintBackground.lineStyle(1.5 * layout.scale, 0xffffff, 0.34);
    hintBackground.beginFill(0x203018, 0.82);
    hintBackground.drawRoundedRect(-width / 2, -height / 2, width, height, height / 2);
    hintBackground.endFill();
    // 提示气泡出现在对应按钮的左侧（按钮群在右下角，向场内一侧展开），
    // 而不是固定在底部；组合技等无具体按钮时，挂在按钮群中心键左侧。
    const circle = (layout.actions && layout.actions[action]) || (layout.actions && layout.actions.sprint) || null;
    if (circle) {
      setPoint(
        hintRoot.position,
        circle.x - circle.radius - 14 * layout.scale - width / 2,
        circle.y,
      );
    } else {
      setPoint(hintRoot.position, layout.hint.x, layout.hint.y);
    }
  };

  const update = () => {
    if (destroyed) return;
    if (layout !== input.__layout) redraw();

    // 编辑态覆盖层：进入时构建、退出时摘除；控件 redraw() 会清空 root，
    // 故编辑中每帧确保 editLayer 仍挂在 root 顶层(重挂而非重建，开销极低)。
    const editing = !!globalObject.__ORIGINAL_RUNTIME_CONTROL_EDIT__;
    if (editing !== editActive) {
      editActive = editing;
      if (editing) buildEditLayer();
      else if (editLayer && editLayer.parent) editLayer.parent.removeChild(editLayer);
    }
    if (editing) {
      if (!editLayer) buildEditLayer();
      const kids = root.children || [];
      if (editLayer.parent !== root || kids[kids.length - 1] !== editLayer) root.addChild(editLayer);
    }

    const stageSize = visibleStageSize(game, layout.width, layout.height);
    setPoint(root.scale, stageSize.width / layout.width, stageSize.height / layout.height);

    const travel = Math.max(0, layout.stick.radius - layout.stick.thumbRadius);
    setPoint(
      stickThumb.position,
      layout.stick.x + input.vx * travel,
      layout.stick.y + input.vy * travel,
    );

    const now = Date.now();
    let pressedAction = "";
    for (const action of Object.keys(buttons)) {
      const held = action === "shoot" || action === "sprint" ? !!input[action] : false;
      const flashed = !!(input.__visual && input.__visual.flashUntil
        && now < (input.__visual.flashUntil[action] || 0));
      const pressed = held || flashed;
      if (pressed) pressedAction = action;
      buttons[action].alpha = pressed ? 1 : 0.82;
      setPoint(buttons[action].scale, pressed ? 0.94 : 1, pressed ? 0.94 : 1);
    }

    const visual = input.__visual || {};
    const comboActive = visual.comboText && now < (Number(visual.comboUntil) || 0);
    if (comboActive) {
      const comboKey = `combo:${visual.comboText}`;
      if (hintedAction !== comboKey) {
        hintedAction = comboKey;
        setHintLabel(visual.comboText, visual.comboAction || null);
      }
      hintUntil = Math.max(hintUntil, Number(visual.comboUntil) || now);
    } else {
      if (Number(visual.lastActionAt) > lastActionAt) {
        lastActionAt = Number(visual.lastActionAt);
        hintedAction = visual.lastAction || pressedAction || "";
        setHintLabel(ACTION_LABELS[hintedAction] || hintedAction, hintedAction);
        hintUntil = now + 1200;
      } else if (pressedAction) {
        if (hintedAction !== pressedAction) {
          hintedAction = pressedAction;
          setHintLabel(ACTION_LABELS[pressedAction] || pressedAction, pressedAction);
        }
        hintUntil = now + 700;
      }
    }
    const remaining = hintUntil - now;
    hintRoot.visible = remaining > 0 && !!hintText.text;
    hintRoot.alpha = remaining > 0 ? Math.min(1, remaining / 180) : 0;

    // 原版有时会在状态切换时追加舞台节点；控件必须始终位于最上层。
    const children = game.stage.children || [];
    if (children[children.length - 1] !== root) game.stage.addChild(root);
  };

  const requestFrame = options.requestFrame
    || (globalObject.requestAnimationFrame && globalObject.requestAnimationFrame.bind(globalObject));
  const cancelFrame = options.cancelFrame
    || (globalObject.cancelAnimationFrame && globalObject.cancelAnimationFrame.bind(globalObject));
  const loop = () => {
    update();
    if (!destroyed && requestFrame) frameId = requestFrame(loop);
  };

  redraw();
  update();
  if (requestFrame) frameId = requestFrame(loop);
  globalObject.__ORIGINAL_RUNTIME_CONTROLS_VISIBLE__ = true;

  const api = {
    root,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frameId != null && cancelFrame) cancelFrame(frameId);
      if (root.parent && typeof root.parent.removeChild === "function") root.parent.removeChild(root);
      if (typeof root.destroy === "function") {
        try { root.destroy({ children: true }); } catch (error) { root.destroy(); }
      }
      globalObject.__ORIGINAL_RUNTIME_CONTROLS_VISIBLE__ = false;
    },
  };
  globalObject.__ORIGINAL_RUNTIME_CONTROLS_OVERLAY__ = api;
  return api;
}

module.exports = { createTouchControlsOverlay, visibleStageSize };
