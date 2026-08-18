import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(
  projectDir,
  "美术整体替换包/省份球场与观众/观众母版/乡村观众16人夏季透明母版.webp",
);
const runtimePath = path.join(
  projectDir,
  "source-assets/public/match-runtime-min/data/stadiums/common/fans.png",
);
const previewPath = path.join(
  projectDir,
  "美术整体替换包/省份球场与观众/运行时预览/乡村观众夏季运行时条.png",
);

const GRID = 4;
const OUTPUT_WIDTH = 1024;
const OUTPUT_HEIGHT = 128;

async function extractPerson(source, metadata, index, height) {
  const cellWidth = Math.floor(metadata.width / GRID);
  const cellHeight = Math.floor(metadata.height / GRID);
  const col = index % GRID;
  const row = Math.floor(index / GRID);
  const left = col * cellWidth;
  const top = row * cellHeight;
  const width = col === GRID - 1 ? metadata.width - left : cellWidth;
  const sourceHeight = row === GRID - 1 ? metadata.height - top : cellHeight;
  // sharp 会重排部分裁切/trim 操作；先把网格单元固化为缓冲区，避免 trim 后再按
  // 母版坐标裁切导致 extract_area 越界。
  const cell = await sharp(source)
    .extract({ left, top, width, height: sourceHeight })
    .png()
    .toBuffer();
  const { data, info } = await sharp(cell)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 12 })
    .resize({ height, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function build() {
  const source = await fs.readFile(sourcePath);
  const metadata = await sharp(source).metadata();
  if (metadata.width !== metadata.height || metadata.width < 1000) {
    throw new Error(`观众母版尺寸异常: ${metadata.width}x${metadata.height}`);
  }

  const layers = [];
  for (let index = 0; index < 16; index += 1) {
    const front = index >= 8;
    const person = await extractPerson(source, metadata, index, front ? 58 : 45);
    const col = index % 8;
    const laneWidth = OUTPUT_WIDTH / 8;
    const stagger = front ? 35 : 0;
    const center = col * laneWidth + laneWidth / 2 + stagger;
    const left = Math.max(
      0,
      Math.min(OUTPUT_WIDTH - person.width, Math.round(center - person.width / 2)),
    );
    const top = front ? OUTPUT_HEIGHT - person.height - 2 : 18;
    layers.push({ input: person.data, left, top });
  }

  const output = await sharp({
    create: {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colours: 256 })
    .toBuffer();

  await fs.mkdir(path.dirname(runtimePath), { recursive: true });
  await fs.mkdir(path.dirname(previewPath), { recursive: true });
  await fs.writeFile(runtimePath, output);
  await fs.writeFile(previewPath, output);

  console.info(
    `[rural-audience] 已生成夏季人类观众条 ${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}, ${(output.length / 1024).toFixed(1)} KiB`,
  );
}

await build();
