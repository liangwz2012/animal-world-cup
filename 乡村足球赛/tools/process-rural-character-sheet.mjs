import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { readRuralManifest, validateRgbaPng } from "./lib/rural-art-contract.mjs";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const rosterDir = path.join(projectDir, "美术整体替换包", "乡村队12人", "players");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--player") result.player = argv[++index];
    else if (current === "--input") result.input = argv[++index];
    else if (current === "--output-root") result.outputRoot = argv[++index];
    else if (current === "--manifest") result.manifest = argv[++index];
  }
  return result;
}

const SPECIAL_CHARACTERS = Object.freeze({
  referee: {
    id: "referee",
    name: "标准人类裁判员",
    age: 39,
    gender: "男",
    profession: "足球裁判员",
    skinTone: "#C47F55",
  },
});

async function removeChromaKey(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] <= 16) transparentPixels += 1;
  }
  // imagegen 官方去底脚本已经产生透明背景时，不能再次从“非透明边缘”猜键色。
  // 三分栏底部可能正好碰到蓝色球衣，二次猜色会把球衣误认为背景并掏空主体。
  if (transparentPixels / (info.width * info.height) >= 0.15) {
    return sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels,
      },
    }).png().toBuffer();
  }
  const keySamples = [];
  const sample = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    const alpha = data[offset + 3];
    if (alpha < 16) return;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    keySamples.push([red, green, blue]);
  };
  const strideX = Math.max(1, Math.floor(info.width / 48));
  const strideY = Math.max(1, Math.floor(info.height / 48));
  for (let x = 0; x < info.width; x += strideX) {
    sample(x, 0);
    sample(x, info.height - 1);
  }
  for (let y = 0; y < info.height; y += strideY) {
    sample(0, y);
    sample(info.width - 1, y);
  }
  // 接受绿色或洋红色等任意平整色键。选择边缘像素中数量最多的量化色桶，
  // 避免把角色偶然接触画布边缘的皮肤或球衣误判成背景。
  const buckets = new Map();
  for (const color of keySamples) {
    const key = color.map((channel) => Math.round(channel / 16)).join(",");
    const bucket = buckets.get(key) || { colors: [], count: 0 };
    bucket.colors.push(color);
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const selected = Array.from(buckets.values()).sort((left, right) => right.count - left.count)[0];
  if (!selected || selected.count < 4) return sharp(input).ensureAlpha().png().toBuffer();
  const [keyRed, keyGreen, keyBlue] = [0, 1, 2].map((channel) => (
    Math.round(selected.colors.reduce((sum, color) => sum + color[channel], 0) / selected.colors.length)
  ));

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    let alpha = data[offset + 3];
    const colorDistance = Math.sqrt(
      (red - keyRed) ** 2
      + (green - keyGreen) ** 2
      + (blue - keyBlue) ** 2,
    );
    // 只按“与边缘采样键色的距离”去底，不能再按绿色占优直接扣除；
    // 否则深绿色球衣会被误当背景，出现截图里的破洞和绿块。
    if (colorDistance <= 42) {
      alpha = 0;
    } else if (colorDistance < 104) {
      alpha = Math.min(alpha, Math.round(255 * (colorDistance - 42) / 62));
    }
    data[offset + 3] = Math.max(0, alpha);
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  }).png().toBuffer();
}

async function despillMagenta(input) {
  // 洋红底抠图后，半透明边缘会残留洋红溢色。把溢色压回灰度，保住边缘羽化：
  // 只处理 min(R,B)-G 明显占优的像素，肤色/黑发/灰白衣服不会被误伤。
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset + 3] === 0) continue;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const dominance = Math.min(red, blue) - green;
    if (red >= 140 && blue >= 140 && dominance > 24) {
      const excess = dominance - 24;
      data[offset] = Math.max(0, red - excess);
      data[offset + 2] = Math.max(0, blue - excess);
    }
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  }).png().toBuffer();
}

async function keepLargestConnectedComponent(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let largest = [];

  for (let start = 0; start < pixels; start += 1) {
    if (visited[start]) continue;
    visited[start] = 1;
    if (data[start * info.channels + info.channels - 1] <= 16) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    const component = [];
    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < info.width ? index + 1 : -1,
        y > 0 ? index - info.width : -1,
        y + 1 < info.height ? index + info.width : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || visited[next]) continue;
        visited[next] = 1;
        if (data[next * info.channels + info.channels - 1] > 16) queue[tail++] = next;
      }
    }
    if (component.length > largest.length) largest = component;
  }

  const keep = new Uint8Array(pixels);
  for (const index of largest) keep[index] = 1;
  for (let index = 0; index < pixels; index += 1) {
    if (!keep[index]) data[index * info.channels + info.channels - 1] = 0;
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  }).png().toBuffer();
}

async function normalizePanel(panel, width, height, options = {}) {
  const keyed = await removeChromaKey(panel);
  // 生图常把相邻分栏的肩膀/头发越过分界线。每个分栏只保留最大主体，
  // 从源头消灭赛场上突然出现的半截肩膀、绿点和游离头发。
  const isolated = await keepLargestConnectedComponent(keyed);
  const despilled = await despillMagenta(isolated);
  const trimmed = await sharp(despilled).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const metadata = await sharp(trimmed).metadata();
  const exactWidth = Number(options.exactWidth) || 0;
  const exactHeight = Number(options.exactHeight) || 0;
  const fillRatio = Number(options.fillRatio) || 0.92;
  let resizedWidth;
  let resizedHeight;
  if (exactWidth > 0 && exactHeight > 0) {
    // 原动物 head/head_back 几乎铺满 81×77 画布；旧人物只占 42–56px 宽，
    // 所以比赛中会显得忽大忽小。比赛小图统一锁成 69×73 的视觉包围盒：
    // 同一中心、同一顶/底线、同一占框比例，轻微的横向归一化在 81px 下
    // 不会改变人物身份，却能保证所有角色跑动时头部重心一致。
    resizedWidth = exactWidth;
    resizedHeight = exactHeight;
  } else {
    const maxWidth = Math.max(1, Math.floor(width * fillRatio));
    const maxHeight = Math.max(1, Math.floor(height * fillRatio));
    const scale = Math.min(maxWidth / metadata.width, maxHeight / metadata.height);
    resizedWidth = Math.max(1, Math.round(metadata.width * scale));
    resizedHeight = Math.max(1, Math.round(metadata.height * scale));
  }
  const resized = await sharp(trimmed).resize(resizedWidth, resizedHeight, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  const left = Math.floor((width - resizedWidth) / 2);
  const top = options.align === "bottom"
    ? Math.max(0, height - resizedHeight - (Number(options.bottomPadding) || 0))
    : Math.max(0, Math.floor((height - resizedHeight) / 2));
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: resized, left, top }]).png().toBuffer();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.player || !args.input) {
    throw new Error("用法：npm run art:rural-process-sheet -- --player <角色id> --input <三视图PNG> [--output-root <输出根目录>]");
  }
  const manifest = await readRuralManifest(projectDir, args.manifest);
  const player = manifest.players.find((item) => item.id === args.player) || SPECIAL_CHARACTERS[args.player];
  if (!player) throw new Error(`未知角色 id：${args.player}`);
  const inputPath = path.resolve(args.input);
  await fs.access(inputPath);
  const metadata = await sharp(inputPath).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 720 || metadata.height < 360) {
    throw new Error("三视图源图分辨率过低，至少需要 720×360；推荐 768×432，不需要高清大图");
  }

  const panelWidth = Math.floor(metadata.width / 3);
  const panels = [
    await sharp(inputPath).extract({ left: 0, top: 0, width: panelWidth, height: metadata.height }).png().toBuffer(),
    await sharp(inputPath).extract({ left: panelWidth, top: 0, width: panelWidth, height: metadata.height }).png().toBuffer(),
    await sharp(inputPath).extract({ left: panelWidth * 2, top: 0, width: metadata.width - panelWidth * 2, height: metadata.height }).png().toBuffer(),
  ];

  const outputRoot = args.outputRoot ? path.resolve(projectDir, args.outputRoot) : rosterDir;
  const relativeOutputRoot = path.relative(projectDir, outputRoot);
  if (relativeOutputRoot.startsWith("..") || path.isAbsolute(relativeOutputRoot)) {
    throw new Error("output-root 必须位于项目目录内");
  }
  const playerDir = path.join(outputRoot, player.id);
  await fs.mkdir(playerDir, { recursive: true });
  const outputs = [
    ["portrait.png", await normalizePanel(panels[0], 192, 192, { fillRatio: 0.92 }), [192, 192]],
    ["head.png", await normalizePanel(panels[1], 81, 77, {
      exactWidth: 69,
      exactHeight: 73,
      align: "bottom",
      bottomPadding: 2,
    }), [81, 77]],
    ["head_back.png", await normalizePanel(panels[2], 81, 77, {
      exactWidth: 69,
      exactHeight: 73,
      align: "bottom",
      bottomPadding: 2,
    }), [81, 77]],
  ];
  for (const [file, buffer, size] of outputs) {
    const target = path.join(playerDir, file);
    await fs.writeFile(target, buffer);
    await validateRgbaPng(target, size);
  }
  // 高分辨率三视图只用于切片。项目内只保留低清 WebP 参考，避免美术工作区持续膨胀。
  await sharp(inputPath)
    .resize({
      width: 768,
      height: 512,
      fit: "contain",
      withoutEnlargement: true,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 72, effort: 4, smartSubsample: true, alphaQuality: 90 })
    .toFile(path.join(playerDir, "source-sheet.webp"));
  await fs.rm(path.join(playerDir, "source-sheet.png"), { force: true });
  console.info(`[art:rural-process-sheet] PASS：${player.name} 的 portrait/head/head_back 已归一化并锁定运行尺寸`);
}

main().catch((error) => {
  console.error("[art:rural-process-sheet] FAIL", error && error.message || error);
  process.exitCode = 1;
});
