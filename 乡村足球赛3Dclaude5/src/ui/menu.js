// 菜单：选村（省 → 区县 → 乡镇，全部是真实地名）、赛制、难度、时段天气、球员名册。
// 整屏画在一张按需重绘的贴图上，只有交互时才重传，静止时零开销。

import { countiesOf, listProvinces } from "../content/teams.js";
import { CULTURE_FAMILIES, TIME_OF_DAY, provinceStyle } from "../content/regions.js";
import { FORMATS } from "../core/constants.js";
import { DIFFICULTY } from "../core/ai.js";
import { clamp } from "../core/mathx.js";

const FONT = '"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createMenu({ platform, layer, config, onStart, onWatch, onCup }) {
  const scale = 1.5;
  let width = Math.round(platform.width * scale);
  let height = Math.round(platform.height * scale);
  const surface = layer.createSurface(width, height);
  const quad = layer.addQuad({ texture: surface.texture, w: platform.width, h: platform.height, x: 0, y: 0, anchor: "top-left", depth: 30 });

  const state = {
    view: "home", // home | province | county | town | squad
    scroll: 0,
    maxScroll: 0,
    provinceCode: config.provinceCode,
    countyCode: config.countyCode,
    townIndex: config.townIndex,
    drag: null,
    visible: true,
    hits: [],
  };

  function px(v) {
    return v * scale;
  }

  function addHit(x, y, w, h, action, payload) {
    state.hits.push({ x, y, w, h, action, payload });
  }

  function button(ctx, x, y, w, h, label, { active = false, tone = "#2E7350", small = false } = {}) {
    ctx.globalAlpha = active ? 1 : 0.9;
    ctx.fillStyle = active ? tone : "#232A2E";
    roundRect(ctx, x, y, w, h, h * 0.28);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = active ? "#F5F0E1" : "#4A5258";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#F5F0E1";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 中文标签长短差别大，字号按可用宽度收缩，绝不允许压到按钮外面
    let size = Math.round(small ? h * 0.42 : h * 0.44);
    const maxWidth = w - h * 0.34;
    for (let i = 0; i < 6; i += 1) {
      ctx.font = `${active ? "bold " : ""}${size}px ${FONT}`;
      if (ctx.measureText(label).width <= maxWidth || size <= 10) break;
      size -= 2;
    }
    ctx.fillText(label, x + w / 2, y + h / 2 + 1, maxWidth);
  }

  function header(ctx, title, subtitle) {
    const grd = ctx.createLinearGradient(0, 0, 0, height);
    grd.addColorStop(0, "#1B2A22");
    grd.addColorStop(0.45, "#16211C");
    grd.addColorStop(1, "#0F1613");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#E8B11B";
    ctx.font = `bold ${px(30)}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(title, px(24), px(58));
    if (subtitle) {
      ctx.fillStyle = "#B9C4BC";
      ctx.font = `${px(15)}px ${FONT}`;
      ctx.fillText(subtitle, px(24), px(82));
    }
  }

  // 横屏时分两栏：左边"选哪个村 + 参数"，右边"开赛按钮组"；竖屏保持单栏堆叠。
  function isWide() {
    return width > height * 1.25;
  }

  function drawHome() {
    const ctx = surface.ctx;
    state.hits = [];
    const province = listProvinces().find((p) => p.code === state.provinceCode);
    const county = countiesOf(state.provinceCode).find((c) => c.code === state.countyCode) || countiesOf(state.provinceCode)[0];
    const town = county.towns[state.townIndex % county.towns.length];
    const style = provinceStyle(state.provinceCode);
    const family = CULTURE_FAMILIES[style.family];

    header(ctx, "乡村足球赛 3D", "真实地名 · 村超身材 · 家乡球场");

    const wide = isWide();
    const leftW = wide ? width * 0.56 : width;
    const rightX = wide ? width * 0.6 : px(24);
    const rightW = wide ? width - rightX - px(24) : width - px(48);

    // 主队卡片。横屏竖向空间紧，卡片和参数行都要压扁一档。
    const cardY = wide ? px(80) : px(96);
    const cardW = leftW - px(44);
    const cardH = wide ? px(96) : px(118);
    ctx.fillStyle = "#20302A";
    roundRect(ctx, px(20), cardY, cardW, cardH, px(18));
    ctx.fill();
    ctx.fillStyle = "#F5F0E1";
    ctx.font = `bold ${px(25)}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${town}村队`, px(38), cardY + (wide ? px(36) : px(42)));
    ctx.fillStyle = "#B9C4BC";
    ctx.font = `${px(14)}px ${FONT}`;
    const textWidth = cardW - px(150);
    ctx.fillText(`${province.name} ${county.name}${county.city ? ` · ${county.city}` : ""}`, px(38), cardY + (wide ? px(60) : px(68)), textWidth);
    ctx.fillStyle = "#8FA89A";
    ctx.fillText(`${family.name} · ${style.flavor}`, px(38), cardY + (wide ? px(82) : px(94)), textWidth);
    const swapW = px(100);
    const swapY = cardY + (wide ? px(26) : px(34));
    button(ctx, px(20) + cardW - swapW - px(14), swapY, swapW, px(44), "换个村", { active: true, tone: "#2E6B8A" });
    addHit(px(20) + cardW - swapW - px(14), swapY, swapW, px(44), "view", "province");

    let y = cardY + cardH + (wide ? px(12) : px(18));
    const rowH = wide ? px(40) : px(46);
    const rowGap = wide ? px(9) : px(12);
    const drawRow = (label, options, currentKey, action) => {
      ctx.fillStyle = "#8FA89A";
      ctx.font = `${px(14)}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(label, px(24), y + px(16));
      const startX = px(84);
      const gap = px(7);
      const each = (leftW - startX - px(24) - gap * (options.length - 1)) / options.length;
      options.forEach((option, index) => {
        const x = startX + index * (each + gap);
        button(ctx, x, y, each, rowH, option.label, { active: option.key === currentKey, tone: option.tone || "#2E7350", small: true });
        addHit(x, y, each, rowH, action, option.key);
      });
      y += rowH + rowGap;
    };

    drawRow("赛制", Object.values(FORMATS).map((f) => ({ key: f.id, label: f.id })), config.formatId, "format");
    drawRow("难度", Object.entries(DIFFICULTY).map(([key, d]) => ({ key, label: d.label })), config.difficulty, "difficulty");
    drawRow("时段", Object.values(TIME_OF_DAY).map((t) => ({ key: t.id, label: t.label })), config.timeOfDay, "time");

    // 右栏（横屏）或继续往下（竖屏）
    let by = wide ? cardY : y + px(6);
    const mainH = wide ? px(56) : px(62);
    button(ctx, rightX, by, rightW, mainH, "开  赛", { active: true, tone: "#C3272B" });
    addHit(rightX, by, rightW, mainH, "start");
    by += mainH + px(12);
    button(ctx, rightX, by, rightW, px(54), "村寨杯 · 四轮晋级", { active: true, tone: "#8A5A22" });
    addHit(rightX, by, rightW, px(54), "cup");
    by += px(66);
    const halfW = (rightW - px(10)) / 2;
    button(ctx, rightX, by, halfW, px(50), "看名册", { tone: "#4A5258" });
    addHit(rightX, by, halfW, px(50), "view", "squad");
    button(ctx, rightX + halfW + px(10), by, halfW, px(50), "观战演示", { tone: "#4A5258" });
    addHit(rightX + halfW + px(10), by, halfW, px(50), "watch");

    ctx.fillStyle = "#6E7C74";
    ctx.font = `${px(11)}px ${FONT}`;
    ctx.textAlign = wide ? "left" : "center";
    // 横屏时脚注放右栏按钮下面，避免和左边的参数行叠在一起
    ctx.fillText(
      "地名数据来自公开行政区划快照，人物与队名均为虚构",
      wide ? rightX : width / 2,
      wide ? by + px(78) : height - px(14),
      rightW,
    );
    state.maxScroll = 0;
  }

  function drawList(title, subtitle, items, action, backView) {
    const ctx = surface.ctx;
    state.hits = [];
    header(ctx, title, subtitle);
    const top = px(96);
    const cols = isWide() ? 2 : 1;
    const rowH = isWide() ? px(46) : px(58);
    const listH = height - top - px(74);
    const rows = Math.ceil(items.length / cols);
    state.maxScroll = Math.max(0, rows * rowH - listH);
    state.scroll = clamp(state.scroll, 0, state.maxScroll);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, width, listH);
    ctx.clip();
    const colW = (width - px(40) - (cols - 1) * px(12)) / cols;
    items.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const y = top + row * rowH - state.scroll;
      if (y + rowH < top || y > top + listH) return;
      const x = px(20) + col * (colW + px(12));
      ctx.fillStyle = row % 2 ? "#1C2622" : "#202C27";
      ctx.fillRect(x, y + 2, colW, rowH - 4);
      ctx.fillStyle = "#F5F0E1";
      ctx.font = `${px(17)}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(item.label, x + px(16), y + rowH / 2, colW * 0.6);
      if (item.note) {
        ctx.fillStyle = "#8FA89A";
        ctx.font = `${px(13)}px ${FONT}`;
        ctx.textAlign = "right";
        ctx.fillText(item.note, x + colW - px(14), y + rowH / 2, colW * 0.36);
      }
      addHit(x, y, colW, rowH, action, item.key);
    });
    ctx.restore();
    button(ctx, px(24), height - px(64), width - px(48), px(46), "返回", { tone: "#4A5258" });
    addHit(px(24), height - px(64), width - px(48), px(46), "view", backView);
  }

  function drawSquad() {
    const ctx = surface.ctx;
    state.hits = [];
    const county = countiesOf(state.provinceCode).find((c) => c.code === state.countyCode) || countiesOf(state.provinceCode)[0];
    const town = county.towns[state.townIndex % county.towns.length];
    header(ctx, `${town}村队名册`, "年龄、职业和身材都会影响场上表现");
    const players = config.previewSquad || [];
    const top = px(96);
    const cols = isWide() ? 2 : 1;
    const rowH = px(50);
    const colW = (width - px(40) - (cols - 1) * px(12)) / cols;
    players.forEach((player, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const y = top + row * rowH;
      const x = px(20) + col * (colW + px(12));
      ctx.fillStyle = row % 2 ? "#1C2622" : "#202C27";
      ctx.fillRect(x, y + 2, colW, rowH - 4);
      ctx.fillStyle = "#E8B11B";
      ctx.font = `bold ${px(20)}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(player.number).padStart(2, " "), x + px(16), y + rowH / 2);
      ctx.fillStyle = "#F5F0E1";
      ctx.font = `${px(17)}px ${FONT}`;
      ctx.fillText(player.name, x + px(56), y + rowH / 2, px(70));
      ctx.fillStyle = "#8FA89A";
      ctx.font = `${px(13)}px ${FONT}`;
      ctx.fillText(`${player.age} 岁 · ${player.vocation} · ${player.body.label}`, x + px(132), y + rowH / 2, colW - px(190));
      ctx.textAlign = "right";
      ctx.fillStyle = "#B9C4BC";
      ctx.fillText(roleLabel(player.role), x + colW - px(14), y + rowH / 2);
    });
    button(ctx, px(24), height - px(64), width - px(48), px(46), "返回", { tone: "#4A5258" });
    addHit(px(24), height - px(64), width - px(48), px(46), "view", "home");
    state.maxScroll = 0;
  }

  function redraw() {
    surface.clear();
    if (state.view === "home") drawHome();
    else if (state.view === "province") {
      drawList("选择省份", "先定省，再定县和乡镇", listProvinces().map((p) => ({ key: p.code, label: p.name, note: CULTURE_FAMILIES[p.style.family].name })), "province", "home");
    } else if (state.view === "county") {
      const list = countiesOf(state.provinceCode);
      drawList("选择区县", `${listProvinces().find((p) => p.code === state.provinceCode)?.name || ""} · 共 ${list.length} 个`, list.map((c) => ({ key: c.code, label: c.name, note: c.city })), "county", "province");
    } else if (state.view === "town") {
      const county = countiesOf(state.provinceCode).find((c) => c.code === state.countyCode);
      drawList("选择乡镇", `${county?.name || ""} · 主队将以此命名`, (county?.towns || []).map((t, index) => ({ key: index, label: `${t}村队`, note: t })), "town", "county");
    } else if (state.view === "squad") drawSquad();
    surface.flush();
  }

  function setView(view) {
    state.view = view;
    state.scroll = 0;
    redraw();
  }

  function handleTap(x, y) {
    const sx = x * scale;
    const sy = y * scale;
    for (let i = state.hits.length - 1; i >= 0; i -= 1) {
      const hit = state.hits[i];
      if (sx < hit.x || sx > hit.x + hit.w || sy < hit.y || sy > hit.y + hit.h) continue;
      applyAction(hit.action, hit.payload);
      return true;
    }
    return false;
  }

  function applyAction(action, payload) {
    switch (action) {
      case "view":
        setView(payload);
        break;
      case "province":
        state.provinceCode = payload;
        state.countyCode = countiesOf(payload)[0].code;
        state.townIndex = 0;
        setView("county");
        break;
      case "county":
        state.countyCode = payload;
        state.townIndex = 0;
        setView("town");
        break;
      case "town":
        state.townIndex = payload;
        config.provinceCode = state.provinceCode;
        config.countyCode = state.countyCode;
        config.townIndex = state.townIndex;
        setView("home");
        break;
      case "format":
        config.formatId = payload;
        redraw();
        break;
      case "difficulty":
        config.difficulty = payload;
        redraw();
        break;
      case "time":
        config.timeOfDay = payload;
        redraw();
        break;
      case "start":
        config.provinceCode = state.provinceCode;
        config.countyCode = state.countyCode;
        config.townIndex = state.townIndex;
        onStart();
        break;
      case "watch":
        config.provinceCode = state.provinceCode;
        config.countyCode = state.countyCode;
        config.townIndex = state.townIndex;
        onWatch();
        break;
      case "cup":
        config.provinceCode = state.provinceCode;
        config.countyCode = state.countyCode;
        config.townIndex = state.townIndex;
        onCup?.();
        break;
      default:
        break;
    }
  }

  const pointer = { id: -1, startY: 0, startScroll: 0, moved: 0, x: 0, y: 0 };
  platform.onTouchStart(({ changed }) => {
    if (!state.visible) return;
    const touch = changed[0];
    if (!touch) return;
    pointer.id = touch.id;
    pointer.startY = touch.y;
    pointer.startScroll = state.scroll;
    pointer.moved = 0;
    pointer.x = touch.x;
    pointer.y = touch.y;
  });
  platform.onTouchMove(({ touches }) => {
    if (!state.visible || pointer.id < 0) return;
    const touch = touches.find((t) => t.id === pointer.id);
    if (!touch) return;
    const dy = touch.y - pointer.startY;
    pointer.moved = Math.max(pointer.moved, Math.abs(dy));
    if (state.maxScroll > 0) {
      state.scroll = clamp(pointer.startScroll - dy * scale, 0, state.maxScroll);
      redraw();
    }
  });
  platform.onTouchEnd(({ changed }) => {
    if (!state.visible) return;
    const touch = changed.find((t) => t.id === pointer.id) || changed[0];
    pointer.id = -1;
    if (!touch || pointer.moved > 10) return;
    handleTap(touch.x, touch.y);
  });

  function setVisible(value) {
    state.visible = value;
    quad.setVisible(value);
    if (value) redraw();
  }

  function resize() {
    quad.setSize(platform.width, platform.height);
    quad.setPosition(0, 0);
    redraw();
  }

  redraw();
  return { state, setVisible, setView, redraw, resize, handleTap };
}

function roleLabel(role) {
  return { G: "门将", D: "后卫", M: "中场", A: "前锋" }[role] || role;
}
