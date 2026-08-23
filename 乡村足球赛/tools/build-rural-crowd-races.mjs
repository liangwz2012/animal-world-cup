import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const masterDir = path.join(projectDir, "美术整体替换包", "乡村观众", "masters");
const racesDir = path.join(projectDir, "source-assets", "public", "match-runtime-min", "data", "player", "races");
const sheetFiles = [1, 2, 3].map((index) => path.join(masterDir, `crowd-heads-${String(index).padStart(2, "0")}.webp`));

function donorRace(index) {
  const number = index % 14 + 1;
  return number === 1 ? "rural_v2_01" : `rural_${String(number).padStart(2, "0")}`;
}

function isCheckerBackground(data, offset, channels) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  return maximum - minimum <= 16 && (r + g + b) / 3 >= 218;
}

function removeConnectedCheckerboard(data, info) {
  const { width, height, channels } = info;
  const count = width * height;
  const background = new Uint8Array(count);
  const queued = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (queued[index]) return;
    const offset = index * channels;
    if (!isCheckerBackground(data, offset, channels)) return;
    queued[index] = 1;
    queue[tail++] = index;
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    background[index] = 1;
    const x = index % width;
    const y = Math.floor(index / width);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  const rgba = Buffer.alloc(count * 4);
  for (let index = 0; index < count; index += 1) {
    const source = index * channels;
    const target = index * 4;
    rgba[target] = data[source];
    rgba[target + 1] = data[source + 1];
    rgba[target + 2] = data[source + 2];
    rgba[target + 3] = background[index] ? 0 : 255;
  }
  // 生图棋盘偶尔在下巴外留下与边缘不连通的小白块。保留最大前景连通域，
  // 删除这些孤岛；头、耳朵、头发和颈部本身始终属于同一主体。
  const seen = new Uint8Array(count);
  const componentQueue = new Int32Array(count);
  let largest = [];
  for (let start = 0; start < count; start += 1) {
    if (seen[start] || rgba[start * 4 + 3] === 0) continue;
    let componentHead = 0;
    let componentTail = 0;
    const component = [];
    seen[start] = 1;
    componentQueue[componentTail++] = start;
    while (componentHead < componentTail) {
      const index = componentQueue[componentHead++];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (let direction = 0; direction < neighbors.length; direction += 1) {
        if (direction === 0 && x === 0) continue;
        if (direction === 1 && x === width - 1) continue;
        if (direction === 2 && y === 0) continue;
        if (direction === 3 && y === height - 1) continue;
        const next = neighbors[direction];
        if (next < 0 || next >= count || seen[next] || rgba[next * 4 + 3] === 0) continue;
        seen[next] = 1;
        componentQueue[componentTail++] = next;
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const keep = new Uint8Array(count);
  for (const index of largest) keep[index] = 1;
  for (let index = 0; index < count; index += 1) {
    if (!keep[index]) rgba[index * 4 + 3] = 0;
  }
  return rgba;
}

async function extractHead(sheetPath, row, column) {
  const metadata = await sharp(sheetPath).metadata();
  const left = Math.round(column * metadata.width / 4);
  const top = Math.round(row * metadata.height / 4);
  const right = Math.round((column + 1) * metadata.width / 4);
  const bottom = Math.round((row + 1) * metadata.height / 4);
  const { data, info } = await sharp(sheetPath)
    .extract({ left, top, width: right - left, height: bottom - top })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = removeConnectedCheckerboard(data, info);
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .resize(77, 73, {
      fit: "contain",
      position: "centre",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.lanczos3,
    })
    .extend({
      top: 2,
      bottom: 2,
      left: 2,
      right: 2,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

const manifest = [];
for (let index = 0; index < 24; index += 1) {
  const id = `crowd_${String(index + 1).padStart(2, "0")}`;
  const sheetIndex = Math.floor(index / 8);
  const withinSheet = index % 8;
  const row = Math.floor(withinSheet / 2);
  const pair = withinSheet % 2;
  const frontColumn = pair * 2;
  const backColumn = frontColumn + 1;
  const donor = donorRace(index);
  const targetDir = path.join(racesDir, id);
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.cp(path.join(racesDir, donor), targetDir, { recursive: true });
  const front = await extractHead(sheetFiles[sheetIndex], row, frontColumn);
  const back = await extractHead(sheetFiles[sheetIndex], row, backColumn);
  await fs.writeFile(path.join(targetDir, "head.png"), front);
  await fs.writeFile(path.join(targetDir, "head_back.png"), back);
  manifest.push({
    id,
    donor,
    master: path.basename(sheetFiles[sheetIndex]),
    row,
    frontColumn,
    backColumn,
    frontBytes: front.length,
    backBytes: back.length,
  });
}

await fs.writeFile(
  path.join(masterDir, "crowd-head-manifest.json"),
  `${JSON.stringify({ version: 1, count: manifest.length, characters: manifest }, null, 2)}\n`,
);
console.info(`[art:rural-audience] PASS：生成 ${manifest.length} 名独立村民观众正背头像`);
