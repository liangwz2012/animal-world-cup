import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// 村超主题球衣套件预览 v3（只输出到 Kimi人物素材/，不触碰任何运行素材）。
// v3 改动：
// ① 样式改为「村超经典撞色」——真实村超队服就是普通撞色队服，去掉民族纹样，
//    只保留领口/袖口撞色 + 一条干净胸条；
// ② 高清渲染：纹样按连续坐标在目标尺寸直接栅格化，切片轮廓 alpha 用 lanczos 平滑放大，
//    不再是小像素 nearest 硬放大。

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const donorDir = path.join(projectDir, "source-assets", "public", "match-runtime-min", "data", "teams", "argentina");
const outDir = path.join(projectDir, "Kimi人物素材", "球衣预览");

const STYLE = Object.freeze({
  id: "cunchao-classic",
  label: "村超经典撞色",
  home: Object.freeze({ primary: "#C3272B", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#16233F" }),
  away: Object.freeze({ primary: "#F2E7CE", secondary: "#C3272B", accent: "#22407A", dark: "#4A4232" }),
  goalkeeper: Object.freeze({ primary: "#E8B11B", secondary: "#22407A", accent: "#F5E9D0", dark: "#6B4E12" }),
});

const PIECE_SPECS = Object.freeze({
  "shirt_front.png": [56, 52],
  "shirt_back.png": [56, 52],
  "sleeve_left.png": [14, 22],
  "sleeve_right.png": [23, 18],
  "shorts.png": [55, 8],
  "shorts_leg_left.png": [12, 16],
  "shorts_leg_right.png": [12, 16],
  "socks.png": [11, 14],
  "socks_left.png": [11, 14],
  "socks_right.png": [11, 14],
  "shoes_left.png": [16, 6],
  "shoes_right.png": [16, 6],
  "hand_left.png": [26, 24],
  "hand_right.png": [26, 25],
});

const PIECE_LABELS = Object.freeze({
  "shirt_front.png": "球衣正面",
  "shirt_back.png": "球衣背面",
  "sleeve_left.png": "左袖",
  "sleeve_right.png": "右袖",
  "shorts.png": "短裤腰片",
  "shorts_leg_left.png": "左裤腿",
  "shorts_leg_right.png": "右裤腿",
  "socks.png": "球袜（中）",
  "socks_left.png": "左球袜",
  "socks_right.png": "右球袜",
  "shoes_left.png": "左球鞋",
  "shoes_right.png": "右球鞋",
  "hand_left.png": "左手套",
  "hand_right.png": "右手套",
});

function parseHex(hex) {
  const value = Number.parseInt(String(hex).replace(/^#/, ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
function mix(left, right, amount) {
  return left.map((value, index) => Math.round(value + (right[index] - value) * amount));
}
function shade(color, amount) {
  return color.map((channel) => Math.max(0, Math.min(255, Math.round(channel * amount))));
}

// —— 与运行时一致的重染逻辑（cunchao-classic：干净撞色，无民族纹样）——
function shirtColor(styleId, x, y, palette) {
  const primary = parseHex(palette.primary);
  const secondary = parseHex(palette.secondary);
  const accent = parseHex(palette.accent);
  const dark = parseHex(palette.dark);
  let color = primary;
  if (styleId === "cunchao-classic") {
    if (y < 0.1) return secondary; // 领口撞色
    if (y > 0.3 && y < 0.38) return accent; // 一条干净胸条
    if (y > 0.9) return mix(primary, dark, 0.4); // 下摆微压暗
  }
  return color;
}

function pieceColor(file, styleId, x, y, palette) {
  const primary = parseHex(palette.primary);
  const secondary = parseHex(palette.secondary);
  const accent = parseHex(palette.accent);
  const dark = parseHex(palette.dark);
  if (file.startsWith("shirt_")) return shirtColor(styleId, x, y, palette);
  if (file.startsWith("sleeve_")) {
    if (y > 0.74 || x < 0.08 || x > 0.92) return secondary;
    if (y > 0.64) return mix(primary, accent, 0.32);
    return primary;
  }
  if (file === "shorts.png" || file.startsWith("shorts_leg_")) {
    if (x < 0.12 || x > 0.88) return secondary;
    if (y < 0.15) return mix(dark, accent, 0.24);
    return dark;
  }
  if (file.startsWith("socks")) {
    if (y < 0.24) return secondary;
    if (y < 0.36) return accent;
    return mix(dark, primary, 0.42);
  }
  if (file.startsWith("shoes_")) {
    if (y < 0.28 && x > 0.12 && x < 0.88) return secondary;
    return [27, 31, 32];
  }
  if (file.startsWith("hand_")) {
    if (x < 0.14 || x > 0.86 || y < 0.12) return secondary;
    return mix(accent, [228, 230, 220], 0.42);
  }
  return primary;
}

// 原生尺寸重染（保留 alpha 轮廓），用于输出运行规格套件 PNG
async function recoloredPiece(kitName, file, palette) {
  const source = path.join(donorDir, kitName, file);
  const image = sharp(source, { failOn: "error" });
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 3] === 0) continue;
      const nx = info.width <= 1 ? 0 : x / (info.width - 1);
      const ny = info.height <= 1 ? 0 : y / (info.height - 1);
      const selected = pieceColor(file, STYLE.id, nx, ny, palette);
      const light = 0.82 + (1 - ny) * 0.18 + (0.5 - Math.abs(nx - 0.5)) * 0.08;
      const [r, g, b] = shade(selected, light);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}

// 高清渲染：在目标尺寸上直接按连续坐标栅格化纹样，轮廓 alpha 平滑放大
async function renderPieceHD(kitName, file, palette, targetW, targetH) {
  const [nativeW, nativeH] = PIECE_SPECS[file];
  const alphaUp = await sharp(path.join(donorDir, kitName, file))
    .resize(targetW, targetH, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const data = Buffer.alloc(targetW * targetH * 4);
  for (let y = 0; y < targetH; y += 1) {
    for (let x = 0; x < targetW; x += 1) {
      const offset = (y * targetW + x) * 4;
      const alpha = alphaUp.data[offset + 3];
      if (alpha === 0) continue;
      const nx = targetW <= 1 ? 0 : x / (targetW - 1);
      const ny = targetH <= 1 ? 0 : y / (targetH - 1);
      const selected = pieceColor(file, STYLE.id, nx, ny, palette);
      const light = 0.82 + (1 - ny) * 0.18 + (0.5 - Math.abs(nx - 0.5)) * 0.08;
      const [r, g, b] = shade(selected, light);
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = alpha;
    }
  }
  return sharp(data, { raw: { width: targetW, height: targetH, channels: 4 } }).png().toBuffer();
}

function textSvg(text, size, color, width, height, weight = 500) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${text}</text></svg>`,
  );
}

// 成衣人形图：沿用八套预览的拼接比例（piece 显示尺寸 + 偏移），单位放大 HD_SCALE 倍
const FIGURE_PIECES = Object.freeze([
  ["shirt_front.png", 80, 74, 8, 0],
  ["sleeve_left.png", 20, 31, 0, 10],
  ["sleeve_right.png", 31, 24, 75, 12],
  ["shorts.png", 78, 12, 9, 78],
  ["shorts_leg_left.png", 18, 25, 26, 86],
  ["shorts_leg_right.png", 18, 25, 53, 86],
  ["socks_left.png", 16, 21, 27, 111],
  ["socks_right.png", 16, 21, 55, 111],
  ["shoes_left.png", 24, 9, 22, 132],
  ["shoes_right.png", 24, 9, 54, 132],
]);
const FIGURE_GLOVES = Object.freeze([
  ["hand_left.png", 26, 24, 0, 40],
  ["hand_right.png", 26, 25, 78, 36],
]);
const FIGURE_W = 106;
const FIGURE_H = 141;
const HD_SCALE = 4;

async function renderFigure(kitName, palette, includeGloves) {
  const composites = [];
  const pieces = includeGloves ? [...FIGURE_PIECES, ...FIGURE_GLOVES] : FIGURE_PIECES;
  for (const [file, w, h, left, top] of pieces) {
    composites.push({
      input: await renderPieceHD(kitName, file, palette, w * HD_SCALE, h * HD_SCALE),
      left: left * HD_SCALE,
      top: top * HD_SCALE,
    });
  }
  return sharp({
    create: {
      width: FIGURE_W * HD_SCALE,
      height: FIGURE_H * HD_SCALE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png().toBuffer();
}

async function renderMainPreview() {
  const figureW = FIGURE_W * HD_SCALE;
  const figureH = FIGURE_H * HD_SCALE;
  const padX = 120;
  const gapX = 160;
  const titleH = 120;
  const labelH = 64;
  const swatchH = 56;
  const kits = [["home", "主场"], ["away", "客场"], ["goalkeeper", "门将"]];
  const width = padX * 2 + figureW * kits.length + gapX * (kits.length - 1);
  const height = titleH + labelH + figureH + swatchH + 70;
  const composites = [
    { input: textSvg(`村超主题球衣套件「${STYLE.label}」（未应用）`, 44, "#F5E9D0", width, titleH, 700), left: 0, top: 0 },
  ];
  for (const [index, [kitName, kitLabel]] of kits.entries()) {
    const palette = STYLE[kitName];
    const left = padX + index * (figureW + gapX);
    composites.push({ input: textSvg(kitLabel, 34, "#FFF7D8", figureW, labelH, 700), left, top: titleH });
    composites.push({ input: await renderFigure(kitName, palette, kitName === "goalkeeper"), left, top: titleH + labelH });
    composites.push({
      input: textSvg(`${palette.primary} · ${palette.secondary}`, 20, "#C9D2E0", figureW, swatchH),
      left, top: titleH + labelH + figureH + 8,
    });
  }
  const target = path.join(outDir, "村超球衣套件预览.png");
  await sharp({
    create: { width, height, channels: 4, background: { r: 23, g: 38, b: 24, alpha: 255 } },
  }).composite(composites).png().toFile(target);
  console.info("[cunchao-preview] 高清成衣预览:", target);
}

async function renderInventory() {
  const kits = [["home", "主场"], ["away", "客场"], ["goalkeeper", "门将"]];
  const homeAwayPieces = Object.keys(PIECE_SPECS).filter((f) => !f.startsWith("hand_"));
  const gkPieces = Object.keys(PIECE_SPECS);
  const perRow = 7;
  const cellW = 260;
  const cellH = 250;
  const gap = 20;
  const headerH = 70;
  const titleH = 100;
  let maxRows = 0;
  const kitLayouts = kits.map(([kitName, kitLabel]) => {
    const files = kitName === "goalkeeper" ? gkPieces : homeAwayPieces;
    const rows = Math.ceil(files.length / perRow);
    maxRows += rows;
    return { kitName, kitLabel, files, rows };
  });
  const width = perRow * cellW + (perRow + 1) * gap;
  const height = titleH + maxRows * (cellH + gap) + kits.length * headerH + gap * 2 + 30;
  const composites = [
    { input: textSvg(`「${STYLE.label}」全套件清单（每套 12 件，门将 +2 件手套，未应用）`, 36, "#F5E9D0", width, titleH, 700), left: 0, top: 0 },
  ];
  let cursorY = titleH;
  for (const { kitName, kitLabel, files } of kitLayouts) {
    composites.push({ input: textSvg(kitLabel, 28, "#FFF7D8", width, headerH, 700), left: 0, top: cursorY });
    cursorY += headerH;
    for (const [index, file] of files.entries()) {
      const col = index % perRow;
      const row = Math.floor(index / perRow);
      const left = gap + col * (cellW + gap);
      const top = cursorY + row * (cellH + gap);
      const [pieceW, pieceH] = PIECE_SPECS[file];
      const scale = Math.min((cellW - 32) / pieceW, (cellH - 56) / pieceH);
      const targetW = Math.max(2, Math.round(pieceW * scale));
      const targetH = Math.max(2, Math.round(pieceH * scale));
      composites.push({
        input: await renderPieceHD(kitName, file, STYLE[kitName], targetW, targetH),
        left: left + Math.round((cellW - targetW) / 2),
        top: top + Math.round((cellH - 40 - targetH) / 2),
      });
      composites.push({ input: textSvg(PIECE_LABELS[file] || file, 18, "#9AA3B2", cellW, 32), left, top: top + cellH - 36 });
    }
    cursorY += Math.ceil(files.length / perRow) * (cellH + gap) + gap;
  }
  const target = path.join(outDir, "村超球衣全套件清单.png");
  await sharp({
    create: { width, height, channels: 4, background: { r: 28, g: 32, b: 40, alpha: 255 } },
  }).composite(composites).png().toFile(target);
  console.info("[cunchao-preview] 高清全套件清单:", target);
}

async function writeKitFiles() {
  // 输出可直接检视/可直接应用的原生尺寸套件 PNG（预览阶段存放在包内，不进运行目录）
  const kitRoot = path.join(projectDir, "Kimi人物素材", "球衣套件(未应用)");
  const kits = [["home", "主场"], ["away", "客场"], ["goalkeeper", "门将"]];
  let count = 0;
  for (const [kitName] of kits) {
    const files = kitName === "goalkeeper"
      ? Object.keys(PIECE_SPECS)
      : Object.keys(PIECE_SPECS).filter((f) => !f.startsWith("hand_"));
    const targetDir = path.join(kitRoot, kitName);
    await fs.mkdir(targetDir, { recursive: true });
    for (const file of files) {
      const buffer = await recoloredPiece(kitName, file, STYLE[kitName]);
      const target = path.join(targetDir, file);
      await fs.writeFile(target, buffer);
      const metadata = await sharp(target).metadata();
      const [expectedW, expectedH] = PIECE_SPECS[file];
      if (metadata.width !== expectedW || metadata.height !== expectedH || !metadata.hasAlpha) {
        throw new Error(`${kitName}/${file} 规格异常：${metadata.width}×${metadata.height}`);
      }
      count += 1;
    }
  }
  console.info(`[cunchao-preview] 套件 PNG 已输出 ${count} 件:`, kitRoot);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await renderMainPreview();
  await renderInventory();
  await writeKitFiles();
}

main().catch((error) => {
  console.error("[cunchao-preview] FAIL", error && error.message || error);
  process.exitCode = 1;
});
