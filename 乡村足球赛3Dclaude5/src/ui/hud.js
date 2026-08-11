// 比赛内 HUD 与触控：左摇杆移动，右侧七个按键覆盖传球、传中、射门蓄力、
// 抢断/滑铲、冲刺、换人和过人。按键位置按安全区自适配，横竖屏都能用。

import { MATCH_PHASE } from "../core/constants.js";

const FONT = '"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif';

const BUTTONS = [
  { id: "pass", label: "传", sub: "长按直塞", color: "#2E7350", r: 40 },
  { id: "cross", label: "中", sub: "传中/挑传", color: "#2E6B8A", r: 34 },
  { id: "shoot", label: "射", sub: "长按蓄力", color: "#C3272B", r: 50 },
  { id: "tackle", label: "抢", sub: "长按滑铲", color: "#8A5A22", r: 38 },
  { id: "sprint", label: "冲", sub: "按住加速", color: "#6B3B8F", r: 34 },
  { id: "switch", label: "换", sub: "切换球员", color: "#4A4A52", r: 28 },
  { id: "skill", label: "技", sub: "变向过人", color: "#B8862B", r: 28 },
];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawButtonTexture(surface, label, color, pressed) {
  const { ctx, width: w, height: h } = surface;
  surface.clear();
  const cx = w / 2;
  const cy = h / 2;
  ctx.globalAlpha = pressed ? 0.95 : 0.72;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.44, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = w * 0.045;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `bold ${Math.floor(w * 0.36)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + w * 0.02);
  surface.flush();
}

export function createHud({ platform, layer, match, home, away }) {
  const surfaces = {};
  const quads = {};

  // ---- 顶部记分条 ----
  surfaces.score = layer.createSurface(768, 132);
  quads.score = layer.addQuad({ texture: surfaces.score.texture, w: 384, h: 66, x: 0, y: 0, anchor: "top-left", depth: 10 });

  // ---- 事件提示 ----
  surfaces.toast = layer.createSurface(768, 128);
  quads.toast = layer.addQuad({ texture: surfaces.toast.texture, w: 384, h: 64, x: 0, y: 0, anchor: "center", depth: 12 });
  quads.toast.setVisible(false);

  // ---- 摇杆 ----
  surfaces.stickBase = layer.createSurface(192, 192);
  drawStickBase(surfaces.stickBase);
  surfaces.stickKnob = layer.createSurface(96, 96);
  drawStickKnob(surfaces.stickKnob);
  quads.stickBase = layer.addQuad({ texture: surfaces.stickBase.texture, w: 160, h: 160, depth: 11 });
  quads.stickKnob = layer.addQuad({ texture: surfaces.stickKnob.texture, w: 74, h: 74, depth: 12 });

  // ---- 按键 ----
  for (const button of BUTTONS) {
    surfaces[button.id] = layer.createSurface(128, 128);
    drawButtonTexture(surfaces[button.id], button.label, button.color, false);
    quads[button.id] = layer.addQuad({ texture: surfaces[button.id].texture, w: button.r * 2, h: button.r * 2, depth: 11 });
  }

  // ---- 蓄力环与体力条 ----
  surfaces.charge = layer.createSurface(128, 128);
  quads.charge = layer.addQuad({ texture: surfaces.charge.texture, w: 128, h: 128, depth: 13 });
  quads.charge.setVisible(false);
  surfaces.stamina = layer.createSurface(256, 32);
  quads.stamina = layer.addQuad({ texture: surfaces.stamina.texture, w: 168, h: 21, anchor: "top-left", depth: 11 });

  const state = {
    layout: null,
    stick: { active: false, touchId: -1, baseX: 0, baseY: 0, x: 0, y: 0 },
    pressed: new Map(), // touchId -> buttonId
    holdStart: new Map(), // buttonId -> ms
    edges: {},
    sprint: false,
    shootCharge: 0,
    toastText: "",
    toastUntil: 0,
    lastScore: "",
  };

  function layout() {
    const w = platform.width;
    const h = platform.height;
    const safeBottom = Math.max(18, h - (platform.safeArea?.bottom ?? h) + 18);
    const scale = Math.min(1.25, Math.max(0.82, Math.min(w, h) / 420));
    const stickR = 80 * scale;
    const stickX = Math.max(24, w * 0.035) + stickR;
    const stickY = h - safeBottom - stickR - 8;

    // 横屏宽度富余，记分条要收窄，别横贯半个屏幕
    const scoreW = Math.min(430, w * (w > h ? 0.34 : 0.62));
    quads.score.setSize(scoreW, scoreW * (66 / 384));
    quads.score.setPosition(w > h ? (w - scoreW) / 2 : 10, Math.max(8, (platform.safeArea?.top ?? 0) + 6));
    quads.stamina.setSize(150 * scale, 19 * scale);
    quads.stamina.setPosition(stickX - stickR, stickY - stickR - 26 * scale);
    quads.toast.setSize(Math.min(420, w * 0.78), Math.min(420, w * 0.78) * (64 / 384));
    quads.toast.setPosition(w / 2, h * 0.28);

    quads.stickBase.setSize(stickR * 2, stickR * 2);
    quads.stickBase.setPosition(stickX, stickY);
    quads.stickKnob.setSize(stickR * 0.92, stickR * 0.92);
    quads.stickKnob.setPosition(stickX, stickY);

    // 右侧按键：射门为核心，其余围绕它排布
    const anchorX = w - Math.max(26, w * 0.035);
    const anchorY = h - safeBottom;
    const s = scale;
    const spots = {
      shoot: [anchorX - 62 * s, anchorY - 66 * s],
      pass: [anchorX - 150 * s, anchorY - 52 * s],
      cross: [anchorX - 158 * s, anchorY - 132 * s],
      tackle: [anchorX - 68 * s, anchorY - 156 * s],
      sprint: [anchorX - 30 * s, anchorY - 232 * s],
      switch: [anchorX - 150 * s, anchorY - 206 * s],
      skill: [anchorX - 216 * s, anchorY - 110 * s],
    };
    for (const button of BUTTONS) {
      const [x, y] = spots[button.id];
      const r = button.r * s;
      quads[button.id].setSize(r * 2, r * 2);
      quads[button.id].setPosition(x, y);
      button.cx = x;
      button.cy = y;
      button.hitR = r * 1.18;
    }
    quads.charge.setSize(BUTTONS[2].r * s * 2.7, BUTTONS[2].r * s * 2.7);
    quads.charge.setPosition(spots.shoot[0], spots.shoot[1]);
    state.layout = { stickX, stickY, stickR, scale, safeBottom };
  }

  layout();

  function hitButton(x, y) {
    for (const button of BUTTONS) {
      if (Math.hypot(x - button.cx, y - button.cy) <= button.hitR) return button;
    }
    return null;
  }

  function onTouchStart({ changed }) {
    for (const touch of changed) {
      const button = hitButton(touch.x, touch.y);
      if (button) {
        state.pressed.set(touch.id, button.id);
        state.holdStart.set(button.id, platform.now());
        drawButtonTexture(surfaces[button.id], button.label, button.color, true);
        if (button.id === "sprint") state.sprint = true;
        if (button.id === "switch") state.edges.switch = true;
        continue;
      }
      if (!state.stick.active && touch.x < platform.width * 0.55) {
        state.stick.active = true;
        state.stick.touchId = touch.id;
        state.stick.baseX = touch.x;
        state.stick.baseY = touch.y;
        state.stick.x = 0;
        state.stick.y = 0;
        quads.stickBase.setPosition(touch.x, touch.y);
        quads.stickKnob.setPosition(touch.x, touch.y);
      }
    }
  }

  function onTouchMove({ touches }) {
    if (!state.stick.active) return;
    const touch = touches.find((t) => t.id === state.stick.touchId);
    if (!touch) return;
    const r = state.layout.stickR;
    let dx = touch.x - state.stick.baseX;
    let dy = touch.y - state.stick.baseY;
    const len = Math.hypot(dx, dy);
    const max = r * 0.82;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    state.stick.x = dx / max;
    state.stick.y = dy / max;
    quads.stickKnob.setPosition(state.stick.baseX + dx, state.stick.baseY + dy);
  }

  function onTouchEnd({ changed }) {
    for (const touch of changed) {
      if (state.stick.active && touch.id === state.stick.touchId) {
        state.stick.active = false;
        state.stick.x = 0;
        state.stick.y = 0;
        quads.stickBase.setPosition(state.layout.stickX, state.layout.stickY);
        quads.stickKnob.setPosition(state.layout.stickX, state.layout.stickY);
      }
      const buttonId = state.pressed.get(touch.id);
      if (!buttonId) continue;
      state.pressed.delete(touch.id);
      const button = BUTTONS.find((b) => b.id === buttonId);
      drawButtonTexture(surfaces[buttonId], button.label, button.color, false);
      const held = (platform.now() - (state.holdStart.get(buttonId) || 0)) / 1000;
      state.holdStart.delete(buttonId);
      if (buttonId === "sprint") {
        state.sprint = false;
      } else if (buttonId === "shoot") {
        state.edges.shoot = true;
        state.edges.shootPower = Math.min(1, 0.42 + held * 1.15);
        state.shootCharge = 0;
      } else if (buttonId === "pass") {
        if (held > 0.32) state.edges.through = true;
        else state.edges.pass = true;
      } else if (buttonId === "cross") {
        state.edges.cross = true;
      } else if (buttonId === "tackle") {
        if (held > 0.26) state.edges.slide = true;
        else state.edges.tackle = true;
      } else if (buttonId === "skill") {
        state.edges.skill = true;
      }
    }
  }

  platform.onTouchStart(onTouchStart);
  platform.onTouchMove(onTouchMove);
  platform.onTouchEnd(onTouchEnd);

  // 键盘（浏览器调试用）
  const keys = new Set();
  if (platform.keyboard && typeof window !== "undefined") {
    window.addEventListener("keydown", (e) => {
      keys.add(e.code);
      if (e.code === "KeyJ") state.edges.pass = true;
      if (e.code === "KeyK") state.edges.cross = true;
      if (e.code === "KeyI") state.edges.through = true;
      if (e.code === "KeyH") state.edges.tackle = true;
      if (e.code === "KeyG") state.edges.slide = true;
      if (e.code === "KeyU") state.edges.skill = true;
      if (e.code === "Tab") {
        state.edges.switch = true;
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      keys.delete(e.code);
      if (e.code === "Space") {
        state.edges.shoot = true;
        state.edges.shootPower = Math.min(1, 0.42 + state.shootCharge * 1.15);
        state.shootCharge = 0;
      }
    });
  }

  // 返回的是"屏幕方向"，由渲染层按当前机位换算成球场方向
  function readInput(dt) {
    let screenX = state.stick.x;
    let screenY = state.stick.y;
    if (keys.size) {
      if (keys.has("KeyW") || keys.has("ArrowUp")) screenY -= 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) screenY += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) screenX -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) screenX += 1;
    }
    const sprint = state.sprint || keys.has("ShiftLeft") || keys.has("ShiftRight");
    const holdingShoot = [...state.pressed.values()].includes("shoot") || keys.has("Space");
    if (holdingShoot) state.shootCharge = Math.min(1, state.shootCharge + dt * 1.15);

    const edges = state.edges;
    const input = {
      screenX,
      screenY,
      moveX: screenX,
      moveZ: screenY,
      sprint,
      shootPower: edges.shootPower ?? 0.8,
      actions: {
        pass: Boolean(edges.pass),
        through: Boolean(edges.through),
        cross: Boolean(edges.cross),
        shoot: Boolean(edges.shoot),
        tackle: Boolean(edges.tackle),
        slide: Boolean(edges.slide),
        switch: Boolean(edges.switch),
        skill: Boolean(edges.skill),
      },
    };
    state.edges = {};
    return input;
  }

  function drawScore() {
    const s = surfaces.score;
    const { ctx, width: w, height: h } = s;
    s.clear();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = "#14181C";
    roundRect(ctx, 6, 6, w - 12, h - 12, 22);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = home.kit.primary;
    roundRect(ctx, 10, 10, 14, h - 20, 6);
    ctx.fill();
    ctx.fillStyle = away.kit.primary;
    roundRect(ctx, w - 24, 10, 14, h - 20, 6);
    ctx.fill();

    ctx.textBaseline = "middle";
    ctx.fillStyle = "#F5F0E1";
    ctx.font = `bold 34px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(home.shortName.slice(0, 5), 36, h * 0.42);
    ctx.textAlign = "right";
    ctx.fillText(away.shortName.slice(0, 5), w - 36, h * 0.42);

    ctx.textAlign = "center";
    ctx.font = `bold 46px ${FONT}`;
    ctx.fillText(`${match.score.home} - ${match.score.away}`, w / 2, h * 0.4);

    const total = Math.max(1, match.halfSeconds * 2);
    const minute = Math.floor((match.time / total) * 90);
    ctx.font = `24px ${FONT}`;
    ctx.fillStyle = "#C8C2B2";
    const phaseLabel = phaseText(match);
    ctx.fillText(`${String(minute).padStart(2, "0")}′  ${match.half === 1 ? "上半场" : "下半场"}  ${phaseLabel}`, w / 2, h * 0.78);
    s.flush();
  }

  function drawStamina(player) {
    const s = surfaces.stamina;
    const { ctx, width: w, height: h } = s;
    s.clear();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#14181C";
    roundRect(ctx, 0, 0, w, h, h / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const value = player ? player.stamina : 1;
    ctx.fillStyle = value > 0.5 ? "#5FBF6A" : value > 0.25 ? "#E8B11B" : "#C3272B";
    roundRect(ctx, 3, 3, Math.max(6, (w - 6) * value), h - 6, (h - 6) / 2);
    ctx.fill();
    ctx.fillStyle = "#F5F0E1";
    ctx.font = `bold 15px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (player) ctx.fillText(`${player.number} 号 ${player.name}`, 10, h / 2 + 1);
    s.flush();
  }

  function drawCharge(value) {
    const s = surfaces.charge;
    const { ctx, width: w } = s;
    s.clear();
    if (value > 0.01) {
      ctx.strokeStyle = value > 0.85 ? "#FFE08A" : "#F5F0E1";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(w / 2, w / 2, w * 0.36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * value);
      ctx.stroke();
    }
    s.flush();
  }

  function drawToast(text, tone = "#F5F0E1") {
    const s = surfaces.toast;
    const { ctx, width: w, height: h } = s;
    s.clear();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#14181C";
    roundRect(ctx, 8, 8, w - 16, h - 16, 20);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = tone;
    ctx.font = `bold 40px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text).slice(0, 18), w / 2, h / 2);
    s.flush();
  }

  function toast(text, tone) {
    state.toastText = text;
    state.toastUntil = platform.now() + 2200;
    drawToast(text, tone);
    quads.toast.setVisible(true);
  }

  drawScore();
  drawStamina(null);

  function update(dt) {
    const key = `${match.score.home}-${match.score.away}-${Math.floor(match.time)}-${match.phase}`;
    if (key !== state.lastScore) {
      state.lastScore = key;
      drawScore();
    }
    const controlled = match.players.find((p) => p.id === match.controlledId);
    drawStamina(controlled);
    const charging = [...state.pressed.values()].includes("shoot") || keys.has("Space");
    quads.charge.setVisible(charging);
    if (charging) drawCharge(state.shootCharge);
    if (state.toastUntil && platform.now() > state.toastUntil) {
      quads.toast.setVisible(false);
      state.toastUntil = 0;
    }
    // 冲刺键按下时高亮
    quads.sprint.setOpacity(state.sprint ? 1 : 0.85);
  }

  function resize() {
    layout();
  }

  return { readInput, update, toast, resize, state };
}

function phaseText(match) {
  switch (match.phase) {
    case MATCH_PHASE.KICKOFF:
      return "开球";
    case MATCH_PHASE.THROW_IN:
      return "界外球";
    case MATCH_PHASE.CORNER:
      return "角球";
    case MATCH_PHASE.GOAL_KICK:
      return "球门球";
    case MATCH_PHASE.FREE_KICK:
      return "任意球";
    case MATCH_PHASE.PENALTY:
      return "点球";
    case MATCH_PHASE.GOAL:
      return "进球";
    case MATCH_PHASE.HALF_TIME:
      return "中场";
    case MATCH_PHASE.FULL_TIME:
      return "全场结束";
    default:
      return "";
  }
}

function drawStickBase(surface) {
  const { ctx, width: w } = surface;
  surface.clear();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = "#0E1216";
  ctx.beginPath();
  ctx.arc(w / 2, w / 2, w * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = "#EFE9D8";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.globalAlpha = 0.4;
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(w / 2 + Math.cos(a) * w * 0.2, w / 2 + Math.sin(a) * w * 0.2);
    ctx.lineTo(w / 2 + Math.cos(a) * w * 0.38, w / 2 + Math.sin(a) * w * 0.38);
    ctx.stroke();
  }
  surface.flush();
}

function drawStickKnob(surface) {
  const { ctx, width: w } = surface;
  surface.clear();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#F2ECDC";
  ctx.beginPath();
  ctx.arc(w / 2, w / 2, w * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#8A8474";
  ctx.beginPath();
  ctx.arc(w / 2, w / 2, w * 0.22, 0, Math.PI * 2);
  ctx.fill();
  surface.flush();
}
