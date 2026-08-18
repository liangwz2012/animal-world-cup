import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const outputDir = path.join(projectDir, "美术整体替换包", "乡村球衣系统", "image2-masters");
const VALID_IDS = new Set([
  "cunchao-red",
  "cunchao-green",
  "cunchao-navy",
  "cunchao-sky",
  "cunchao-orange",
  "cunchao-purple",
  "cunchao-teal",
  "cunchao-black",
]);

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseInput(value) {
  const separator = String(value || "").indexOf("=");
  if (separator <= 0) throw new Error(`参数应为 style-id=/absolute/source.png，收到：${value}`);
  const id = value.slice(0, separator);
  const source = value.slice(separator + 1);
  if (!VALID_IDS.has(id)) throw new Error(`不支持的球衣 ID：${id}`);
  if (!path.isAbsolute(source)) throw new Error(`${id} 必须使用绝对源文件路径`);
  return { id, source };
}

async function removeConnectedLightBackground(sourceBuffer) {
  const { data, info } = await sharp(sourceBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  const isLightNeutral = (index) => {
    const offset = index * info.channels;
    if (data[offset + 3] === 0) return true;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const minimum = Math.min(red, green, blue);
    const maximum = Math.max(red, green, blue);
    return minimum >= 228 && maximum - minimum <= 22;
  };
  const enqueue = (index) => {
    if (index < 0 || index >= pixels || visited[index] || !isLightNeutral(index)) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < info.width; x += 1) {
    enqueue(x);
    enqueue((info.height - 1) * info.width + x);
  }
  for (let y = 0; y < info.height; y += 1) {
    enqueue(y * info.width);
    enqueue(y * info.width + info.width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    data[index * info.channels + 3] = 0;
    const x = index % info.width;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < info.width) enqueue(index + 1);
    if (index >= info.width) enqueue(index - info.width);
    if (index + info.width < pixels) enqueue(index + info.width);
  }
  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  }).png().toBuffer();
}

async function main() {
  const inputs = process.argv.slice(2).map(parseInput);
  if (!inputs.length) throw new Error("至少提供一个 Image2 母版");
  await fs.mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "manifest.json");
  let manifest = { schemaVersion: 1, generator: "OpenAI Image2", masters: {} };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {}
  manifest.schemaVersion = 1;
  manifest.generator = "OpenAI Image2";
  manifest.masters = manifest.masters && typeof manifest.masters === "object" ? manifest.masters : {};

  for (const { id, source } of inputs) {
    const sourceBuffer = await fs.readFile(source);
    const sourceMetadata = await sharp(sourceBuffer).metadata();
    if (!sourceMetadata.width || !sourceMetadata.height) throw new Error(`${id} 无法读取像素尺寸`);
    const isolatedBuffer = sourceMetadata.hasAlpha
      ? sourceBuffer
      : await removeConnectedLightBackground(sourceBuffer);
    const output = path.join(outputDir, `${id}.webp`);
    const next = `${output}.next`;
    await sharp(isolatedBuffer)
      // 运行时最大只切出 56×52；512 px 参考母版仍有充足下采样余量，
      // 同时避免非上传美术包长期保存无效超清像素。
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 6, smartSubsample: true })
      .toFile(next);
    await fs.rename(next, output);
    const outputBuffer = await fs.readFile(output);
    const outputMetadata = await sharp(outputBuffer).metadata();
    manifest.masters[id] = {
      sourceSha256: sha256(sourceBuffer),
      sourcePixels: [sourceMetadata.width, sourceMetadata.height],
      compressedFile: `${id}.webp`,
      compressedSha256: sha256(outputBuffer),
      compressedPixels: [outputMetadata.width, outputMetadata.height],
      compressedBytes: outputBuffer.length,
      backgroundIsolation: sourceMetadata.hasAlpha ? "source-alpha" : "edge-connected-light-removal",
    };
    console.info(`[image2-master] ${id}: ${Math.round(outputBuffer.length / 1024)} KiB`);
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error("[image2-master] FAIL", error && error.message || error);
  process.exitCode = 1;
});
