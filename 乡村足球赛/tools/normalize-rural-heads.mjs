import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const playersDir = path.join(projectDir, "美术整体替换包", "乡村队12人", "players");
const stageDir = path.join(projectDir, ".tmp", `normalize-rural-heads-${process.pid}-${Date.now()}`);
const OUTPUT_WIDTH = 81;
const OUTPUT_HEIGHT = 77;
const TARGET = Object.freeze({ left: 6, top: 2, width: 69, height: 73 });
const FILES = ["head.png", "head_back.png"];

function alphaBounds(data, info, threshold = 16) {
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] <= threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("头像没有可见像素");
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

async function keepLargestConnectedComponent(input) {
  const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = decoded;
  const pixels = info.width * info.height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let largest = [];
  for (let start = 0; start < pixels; start += 1) {
    if (visited[start]) continue;
    visited[start] = 1;
    if (data[start * info.channels + 3] <= 16) continue;
    let head = 0;
    let tail = 0;
    const component = [];
    queue[tail++] = start;
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
        if (data[next * info.channels + 3] > 16) queue[tail++] = next;
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const keep = new Uint8Array(pixels);
  for (const index of largest) keep[index] = 1;
  for (let index = 0; index < pixels; index += 1) {
    if (!keep[index]) data[index * info.channels + 3] = 0;
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  }).png().toBuffer();
}

async function normalizeHead(input, output) {
  const isolated = await keepLargestConnectedComponent(input);
  const decoded = await sharp(isolated).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== OUTPUT_WIDTH || decoded.info.height !== OUTPUT_HEIGHT) {
    throw new Error(`${input} 尺寸必须为 ${OUTPUT_WIDTH}×${OUTPUT_HEIGHT}`);
  }
  const bounds = alphaBounds(decoded.data, decoded.info);
  if (bounds.left === TARGET.left && bounds.top === TARGET.top
    && bounds.width === TARGET.width && bounds.height === TARGET.height) {
    await fs.writeFile(output, isolated);
    return { before: bounds, changed: true };
  }
  const subject = await sharp(isolated)
    .extract(bounds)
    .resize(TARGET.width, TARGET.height, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await sharp({
    create: {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: subject, left: TARGET.left, top: TARGET.top }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);
  const result = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const after = alphaBounds(result.data, result.info);
  if (after.width < 65 || after.height < 71 || Math.abs((after.left + after.width / 2) - 40.5) > 2) {
    throw new Error(`${input} 归一化失败：${JSON.stringify(after)}`);
  }
  return { before: bounds, after, changed: true };
}

async function main() {
  const entries = await fs.readdir(playersDir, { withFileTypes: true });
  const players = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  await fs.mkdir(stageDir, { recursive: true });
  const reports = [];
  try {
    for (const player of players) {
      const targetDir = path.join(stageDir, player);
      await fs.mkdir(targetDir, { recursive: true });
      for (const file of FILES) {
        const input = path.join(playersDir, player, file);
        const output = path.join(targetDir, file);
        reports.push({ player, file, ...(await normalizeHead(input, output)) });
      }
    }
    // 全部 24 张先处理和校验成功，最后才逐文件原子换入。
    for (const report of reports) {
      await fs.rename(
        path.join(stageDir, report.player, report.file),
        path.join(playersDir, report.player, report.file),
      );
    }
    const changed = reports.filter((report) => report.changed).length;
    console.info(`[normalize-rural-heads] PASS：${reports.length} 张正背头像统一到 81×77 / 主体 69×73，实际改写 ${changed} 张`);
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[normalize-rural-heads] FAIL", error && error.message || error);
  process.exitCode = 1;
});
