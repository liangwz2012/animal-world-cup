import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// 把 AI 生成的白色装备平铺母版切成各槽位的"光影灰度图"：
// 真实切片 alpha 决定轮廓，AI 灰度只提供布料明暗；染色时区域色 × 灰度比值。

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const donorInput = process.argv[2] || path.join(projectDir, ".tmp/cdp/out/kit-donor.png");
const teamsDir = path.join(projectDir, "source-assets", "public", "match-runtime-min", "data", "teams");
const alphaDonorDir = path.join(teamsDir, "argentina", "home");
const gkAlphaDir = path.join(teamsDir, "argentina", "goalkeeper");
const outDir = path.join(projectDir, "美术整体替换包", "乡村球衣系统", "luminance");

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

// 母版 2×3 网格：左上球衣正面 / 中上球衣背面 / 右上短裤 / 左下球袜 / 中下球鞋 / 右手套
const CELLS = Object.freeze({
  shirtFront: { col: 0, row: 0 },
  shirtBack: { col: 1, row: 0 },
  shorts: { col: 2, row: 0 },
  sock: { col: 0, row: 1 },
  shoe: { col: 1, row: 1 },
  glove: { col: 2, row: 1 },
});

const PIECE_CELL = Object.freeze({
  "shirt_front.png": "shirtFront",
  "shirt_back.png": "shirtBack",
  "sleeve_left.png": "shirtFront",
  "sleeve_right.png": "shirtBack",
  "shorts.png": "shorts",
  "shorts_leg_left.png": "shorts",
  "shorts_leg_right.png": "shorts",
  "socks.png": "sock",
  "socks_left.png": "sock",
  "socks_right.png": "sock",
  "shoes_left.png": "shoe",
  "shoes_right.png": "shoe",
  "hand_left.png": "glove",
  "hand_right.png": "glove",
});

async function keyMagentaToAlpha(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const distance = Math.sqrt((red - 255) ** 2 + green ** 2 + (blue - 255) ** 2);
    let alpha = data[offset + 3];
    if (distance <= 42) alpha = 0;
    else if (distance < 104) alpha = Math.min(alpha, Math.round(255 * (distance - 42) / 62));
    data[offset + 3] = alpha;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}

async function cellLuminance(sheet, meta, cell) {
  const cellW = Math.floor(meta.width / 3);
  const cellH = Math.floor(meta.height / 2);
  const crop = await sharp(sheet)
    .extract({ left: cell.col * cellW, top: cell.row * cellH, width: cellW, height: cellH })
    .png().toBuffer();
  const keyed = await keyMagentaToAlpha(crop);
  const trimmed = await sharp(keyed).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const gray = await sharp(trimmed).grayscale().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let count = 0;
  for (let offset = 0; offset < gray.data.length; offset += gray.info.channels) {
    if (gray.data[offset + gray.info.channels - 1] > 24) { sum += gray.data[offset]; count += 1; }
  }
  return {
    buffer: await sharp(trimmed).grayscale().png().toBuffer(),
    mean: count ? sum / count : 200,
  };
}

async function slotAlpha(file) {
  const dir = file.startsWith("hand_") ? gkAlphaDir : alphaDonorDir;
  const { data, info } = await sharp(path.join(dir, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: info.channels, data };
}

async function main() {
  const sheet = await fs.readFile(donorInput);
  const meta = await sharp(sheet).metadata();
  if (!meta.width || meta.width < 900) throw new Error(`母版分辨率异常：${meta.width}×${meta.height}`);
  const cells = {};
  for (const [name, cell] of Object.entries(CELLS)) {
    cells[name] = await cellLuminance(sheet, meta, cell);
  }
  await fs.mkdir(outDir, { recursive: true });
  for (const [file, [width, height]] of Object.entries(PIECE_SPECS)) {
    const cell = cells[PIECE_CELL[file]];
    const resized = await sharp(cell.buffer)
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = await slotAlpha(file);
    const out = Buffer.alloc(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const inOffset = index * resized.info.channels;
      const alphaValue = alpha.data[index * alpha.channels + alpha.channels - 1];
      out[index * 4] = resized.data[inOffset];
      out[index * 4 + 1] = resized.data[inOffset];
      out[index * 4 + 2] = resized.data[inOffset];
      out[index * 4 + 3] = alphaValue;
    }
    const target = path.join(outDir, file);
    await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(target);
    await fs.writeFile(path.join(outDir, `${file}.mean`), String(Math.round(cell.mean)));
  }
  console.info(`[kit-luminance] PASS：${Object.keys(PIECE_SPECS).length} 张光影灰度图已输出到 ${path.relative(projectDir, outDir)}`);
}

main().catch((error) => {
  console.error("[kit-luminance] FAIL", error && error.message || error);
  process.exitCode = 1;
});
