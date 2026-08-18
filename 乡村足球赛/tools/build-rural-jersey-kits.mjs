import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validateNoMagentaResidue, validateRgbaPng } from "./lib/rural-art-contract.mjs";

const require = createRequire(import.meta.url);
const { RURAL_JERSEY_STYLES } = require("../src/data/rural-jersey-styles.js");
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const teamsDir = path.join(projectDir, "source-assets", "public", "match-runtime-min", "data", "teams");
const artDir = path.join(projectDir, "美术整体替换包", "乡村球衣系统");
const backupDir = path.join(projectDir, "美术替换备份", "2026-07-30-全队乡村球衣应用前");
const image2MasterDir = path.join(artDir, "image2-masters");

const KITS = Object.freeze(["home", "away", "goalkeeper"]);
// Image2 母版只提供面料、领口、侧片与文化暗纹。透明轮廓必须始终来自
// 换皮前同球队、同套装、同部件的骨架切片，不能让 AI 生成的完整短袖轮廓
// 同时进入 chest_shirt 和左右袖动作槽。
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
});
const GOALKEEPER_SPECS = Object.freeze({
  "hand_left.png": [26, 24],
  "hand_right.png": [26, 25],
});

function outputScaleForPiece(file) {
  // 原引擎把图集中的物理像素直接作为 Spine attachment 尺寸；它不会根据
  // team.json 的 width/height 自动识别 2 倍纹理。所有运行切片必须保持 1 倍，
  // 高清母版只用于下采样抗锯齿，不能让 112×104 图片进入 56×52 动作槽。
  return 1;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function parseHex(hex) {
  const value = Number.parseInt(String(hex).replace(/^#/, ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(color) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function paletteRole(pixel, sourcePalette) {
  const roles = ["primary", "secondary", "accent", "dark"];
  const sum = Math.max(1, pixel[0] + pixel[1] + pixel[2]);
  const normalized = pixel.map((value) => value / sum);
  let selected = roles[0];
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const role of roles) {
    const reference = parseHex(sourcePalette[role]);
    const referenceSum = Math.max(1, reference[0] + reference[1] + reference[2]);
    const chromaDistance = normalized.reduce((total, value, index) => {
      const delta = value - reference[index] / referenceSum;
      return total + delta * delta;
    }, 0);
    const lightDistance = Math.abs(luminance(pixel) - luminance(reference)) / 255;
    const distance = chromaDistance * 3.2 + lightDistance * 0.12;
    if (distance < selectedDistance) {
      selected = role;
      selectedDistance = distance;
    }
  }
  return selected;
}

function transferPalette(pixel, sourcePalette, targetPalette) {
  const role = paletteRole(pixel, sourcePalette);
  const source = parseHex(sourcePalette[role]);
  const target = parseHex(targetPalette[role]);
  const ratio = Math.max(0.48, Math.min(1.38, (luminance(pixel) + 12) / (luminance(source) + 12)));
  return target.map((value) => Math.max(0, Math.min(255, Math.round(value * ratio))));
}

function paletteContainsIntentionalPurple(palette) {
  return ["primary", "secondary", "accent", "dark"].some((role) => {
    const [red, green, blue] = parseHex(palette[role]);
    return red >= 120 && blue >= 80 && Math.min(red, blue) - green >= 38;
  });
}

function masterCrop(file, width, height) {
  const topHeight = Math.max(1, Math.min(height, Math.round(height * 0.56)));
  const halfWidth = Math.floor(width / 2);
  if (file === "shirt_back.png") {
    return { left: halfWidth, top: 0, width: width - halfWidth, height: topHeight };
  }
  if (file.startsWith("shirt_") || file.startsWith("sleeve_") || file.startsWith("hand_")) {
    return { left: 0, top: 0, width: halfWidth, height: topHeight };
  }
  if (file.startsWith("shoes_")) {
    const left = Math.round(width * 0.68);
    const top = Math.round(height * 0.78);
    return {
      left,
      top,
      width: Math.max(1, width - left),
      height: Math.max(1, height - top),
    };
  }
  if (file.startsWith("socks")) {
    const left = Math.round(width * 0.68);
    const top = Math.round(height * 0.55);
    return {
      left,
      top,
      width: Math.max(1, width - left),
      height: Math.max(1, height - top),
    };
  }
  const top = Math.round(height * 0.55);
  return {
    left: 0,
    top,
    width: Math.max(1, Math.round(width * 0.38)),
    height: Math.max(1, Math.round(height * 0.38)),
  };
}

async function renderImage2Piece(target, file, style, kitName, expected) {
  const masterPath = path.join(image2MasterDir, `${style.id}.webp`);
  const metadata = await sharp(masterPath).metadata();
  if (!metadata.width || !metadata.height || !metadata.hasAlpha) {
    throw new Error(`${style.id} Image2 母版缺少真实透明通道`);
  }
  const [logicalWidth, logicalHeight] = expected;
  const outputScale = outputScaleForPiece(file);
  const width = logicalWidth * outputScale;
  const height = logicalHeight * outputScale;
  const crop = masterCrop(file, metadata.width, metadata.height);
  const texture = await sharp(masterPath)
    .flatten({ background: style.home.primary })
    .extract(crop)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const silhouetteSource = sharp(path.join(backupDir, style.teamId, kitName, file)).ensureAlpha();
  const silhouetteMetadata = await silhouetteSource.metadata();
  const silhouette = await (silhouetteMetadata.width === width && silhouetteMetadata.height === height
    ? silhouetteSource
    : silhouetteSource.resize(width, height, { fit: "fill", kernel: "nearest" }))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const data = texture.data;
  const sourcePalette = style.master || style.home;
  const targetPalette = style[kitName];
  for (let y = 0; y < texture.info.height; y += 1) {
    for (let x = 0; x < texture.info.width; x += 1) {
      const offset = (y * texture.info.width + x) * texture.info.channels;
      const maskOffset = (y * silhouette.info.width + x) * silhouette.info.channels;
      if (kitName !== "home" || style.master) {
        const mapped = transferPalette(
          [data[offset], data[offset + 1], data[offset + 2]],
          sourcePalette,
          targetPalette,
        );
        data[offset] = mapped[0];
        data[offset + 1] = mapped[1];
        data[offset + 2] = mapped[2];
      }
      const alpha = silhouette.data[maskOffset + silhouette.info.channels - 1];
      data[offset + 3] = alpha;
      if (alpha === 0) {
        // 透明像素颜色归零，提升 DEFLATE 压缩率且不改变可见结果。
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      } else {
        // 仅量化 RGB，透明通道逐像素保留。胸衣使用 6-bit、小部件使用 5-bit，
        // 在比赛实际显示尺寸下不可见色阶损失，但比完整 8-bit RGBA 更易压缩。
        const step = file.startsWith("shirt_") ? 4 : 8;
        data[offset] = Math.min(255, Math.round(data[offset] / step) * step);
        data[offset + 1] = Math.min(255, Math.round(data[offset + 1] / step) * step);
        data[offset + 2] = Math.min(255, Math.round(data[offset + 2] / step) * step);
      }
    }
  }
  await sharp(data, {
    raw: {
      width: texture.info.width,
      height: texture.info.height,
      channels: texture.info.channels,
    },
  }).png({
    compressionLevel: 9,
    adaptiveFiltering: true,
    // 调色板会重新量化透明通道，让小袖片边缘偏离原骨架。
    // RGBA PNG 仍使用最高级别无损压缩，透明轮廓可以逐像素保持一致。
    palette: false,
  }).toFile(`${target}.next`);
  await fs.rename(`${target}.next`, target);
  await validateRgbaPng(target, [width, height], {
    transparentCorners: false,
    requireTransparentPadding: false,
  });
  if (!paletteContainsIntentionalPurple(targetPalette)) {
    await validateNoMagentaResidue(target, { allowedRatio: 0.0015 });
  }
}

function opaque(hex) {
  return `${String(hex).replace(/^#/, "").toLowerCase()}ff`;
}

function setPiece(kit, slot, name, color = "ffffffff") {
  if (!kit[slot] || typeof kit[slot] !== "object") return;
  kit[slot].name = name;
  kit[slot].color = color;
}

async function updateTeamDefinition(style) {
  const target = path.join(teamsDir, style.teamId, "team.json");
  const team = JSON.parse(await fs.readFile(target, "utf8"));
  for (const kitName of KITS) {
    const kit = team.kits && team.kits[kitName];
    if (!kit) throw new Error(`${style.teamId} 缺少 ${kitName} 球衣配置`);
    setPiece(kit, "arm_left_sleeve", `${kitName}/sleeve_left.png`);
    setPiece(kit, "arm_right_sleeve", `${kitName}/sleeve_right.png`);
    setPiece(kit, "shirt_front", `${kitName}/shirt_front.png`);
    setPiece(kit, "shirt_back", `${kitName}/shirt_back.png`);
    setPiece(kit, "pelvis_shorts", `${kitName}/shorts.png`);
    setPiece(kit, "leg_left_shorts", `${kitName}/shorts_leg_left.png`);
    setPiece(kit, "leg_right_shorts", `${kitName}/shorts_leg_right.png`);
    setPiece(kit, "leg_left_sock", `${kitName}/socks_left.png`);
    setPiece(kit, "leg_right_sock", `${kitName}/socks_right.png`);
    setPiece(kit, "leg_left_shoe", `${kitName}/shoes_left.png`);
    setPiece(kit, "leg_right_shoe", `${kitName}/shoes_right.png`);
    if (kitName === "goalkeeper") {
      setPiece(kit, "hand_left_glove", `${kitName}/hand_left.png`);
      setPiece(kit, "hand_right_glove", `${kitName}/hand_right.png`);
    }
    if (kit.number) kit.number.color = opaque(style[kitName].accent);
  }
  team.kitColors = {
    home: style.home.primary.replace(/^#/, "").toLowerCase(),
    away: style.away.primary.replace(/^#/, "").toLowerCase(),
    goalkeeper: style.goalkeeper.primary.replace(/^#/, "").toLowerCase(),
  };
  await fs.writeFile(target, `${JSON.stringify(team, null, 2)}\n`);
}

async function backupOriginals() {
  if (await exists(backupDir)) return;
  await fs.mkdir(backupDir, { recursive: true });
  for (const style of RURAL_JERSEY_STYLES) {
    await fs.cp(
      path.join(teamsDir, style.teamId),
      path.join(backupDir, style.teamId),
      { recursive: true },
    );
  }
}

async function renderPreview() {
  const width = 1536;
  const height = 900;
  const cellWidth = width / 4;
  const cellHeight = height / 2;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#78ad31"/>
          <stop offset="1" stop-color="#4d8725"/>
        </linearGradient>
        <pattern id="stripe" width="96" height="96" patternUnits="userSpaceOnUse">
          <rect width="48" height="96" fill="#ffffff" opacity=".025"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" rx="36" fill="url(#grass)"/>
      <rect width="${width}" height="${height}" rx="36" fill="url(#stripe)"/>
      ${RURAL_JERSEY_STYLES.map((style, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const left = column * cellWidth;
        const top = row * cellHeight;
        return `
          <rect x="${left + 16}" y="${top + 16}" width="${cellWidth - 32}" height="${cellHeight - 32}"
            rx="24" fill="#17361f" opacity=".34" stroke="#f6efd3" stroke-width="3"/>
          <text x="${left + 32}" y="${top + 56}" font-family="PingFang SC,Arial,sans-serif"
            font-size="27" font-weight="800" fill="#fff7d8">${index + 1}. ${style.label}</text>
          <text x="${left + 32}" y="${top + 88}" font-family="PingFang SC,Arial,sans-serif"
            font-size="17" fill="#ffffff" opacity=".78">${style.teamId} · 主场 / 客场 / 门将</text>
          <text x="${left + 75}" y="${top + 340}" font-family="PingFang SC,Arial,sans-serif"
            text-anchor="middle" font-size="17" fill="#fff7d8">主场</text>
          <text x="${left + 186}" y="${top + 340}" font-family="PingFang SC,Arial,sans-serif"
            text-anchor="middle" font-size="17" fill="#fff7d8">客场</text>
          <text x="${left + 297}" y="${top + 340}" font-family="PingFang SC,Arial,sans-serif"
            text-anchor="middle" font-size="17" fill="#fff7d8">门将</text>
        `;
      }).join("")}
    </svg>`;
  const composites = [];
  for (const [index, style] of RURAL_JERSEY_STYLES.entries()) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    for (const [kitIndex, kit] of KITS.entries()) {
      const groupLeft = Math.round(column * cellWidth + 32 + kitIndex * 111);
      const groupTop = Math.round(row * cellHeight + 124);
      const pieces = [
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
      ];
      for (const [file, pieceWidth, pieceHeight, leftOffset, topOffset] of pieces) {
        const input = await sharp(path.join(teamsDir, style.teamId, kit, file))
          .resize(pieceWidth, pieceHeight, { fit: "fill", kernel: "nearest" })
          .png()
          .toBuffer();
        composites.push({
          input,
          left: groupLeft + leftOffset,
          top: groupTop + topOffset,
        });
      }
    }
  }
  await fs.mkdir(artDir, { recursive: true });
  await sharp(Buffer.from(svg))
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, quality: 90 })
    .toFile(path.join(artDir, "八套乡村球衣预览.png"));
  await fs.writeFile(
    path.join(artDir, "styles.json"),
    `${JSON.stringify({ schemaVersion: 1, styles: RURAL_JERSEY_STYLES }, null, 2)}\n`,
  );
}

async function main() {
  await backupOriginals();
  for (const style of RURAL_JERSEY_STYLES) {
    for (const kitName of KITS) {
      const kitDir = path.join(teamsDir, style.teamId, kitName);
      const specs = kitName === "goalkeeper"
        ? Object.assign({}, PIECE_SPECS, GOALKEEPER_SPECS)
        : PIECE_SPECS;
      for (const [file, expected] of Object.entries(specs)) {
        const target = path.join(kitDir, file);
        if (!(await exists(target))) throw new Error(`${style.teamId}/${kitName} 缺少 ${file}`);
        await renderImage2Piece(target, file, style, kitName, expected);
      }
    }
    await updateTeamDefinition(style);
  }
  await renderPreview();
  console.info("[art:rural-jerseys] PASS：8套 Image2 正式球衣已按原骨架1倍显示尺寸下采样切片");
}

main().catch((error) => {
  console.error("[art:rural-jerseys] FAIL", error && error.message || error);
  process.exitCode = 1;
});
