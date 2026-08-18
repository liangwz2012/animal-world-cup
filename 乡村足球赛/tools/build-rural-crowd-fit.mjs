import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const masterPath = path.join(
  projectDir,
  "美术整体替换包/省份球场与观众/观众母版/乡村四周人类观众透明母版.webp",
);
const runtimePath = path.join(
  projectDir,
  "source-assets/public/match-runtime-min/data/stadiums/common/rural_crowd.png",
);
const previewPath = path.join(
  projectDir,
  "美术整体替换包/省份球场与观众/运行时预览/乡村四周观众-球员比例版.png",
);
const manifestPath = path.join(
  projectDir,
  "美术整体替换包/省份球场与观众/运行时预览/乡村四周观众-球员比例版.json",
);

const WIDTH = 4096;
const HEIGHT = 2048;
const TOP_BAND = 650;
const BOTTOM_TOP = HEIGHT - TOP_BAND;
const SIDE_WIDTH = 700;
const SIDE_TOP = TOP_BAND;
const SIDE_HEIGHT = HEIGHT - TOP_BAND * 2;
const HORIZONTAL_TILE_WIDTH = WIDTH / 2;
const HORIZONTAL_TILE_HEIGHT = Math.round(TOP_BAND * 0.58);
const VERTICAL_TILE_WIDTH = Math.round(SIDE_WIDTH * 0.58);
const VERTICAL_TILE_HEIGHT = SIDE_HEIGHT / 2;

async function build() {
  const master = await fs.readFile(masterPath);
  const full = await sharp(master)
    .resize(WIDTH, HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const top = await sharp(full)
    .extract({ left: 0, top: 0, width: WIDTH, height: TOP_BAND })
    .resize(HORIZONTAL_TILE_WIDTH, HORIZONTAL_TILE_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const bottom = await sharp(full)
    .extract({ left: 0, top: BOTTOM_TOP, width: WIDTH, height: TOP_BAND })
    .resize(HORIZONTAL_TILE_WIDTH, HORIZONTAL_TILE_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const left = await sharp(full)
    .extract({ left: 0, top: SIDE_TOP, width: SIDE_WIDTH, height: SIDE_HEIGHT })
    .resize(VERTICAL_TILE_WIDTH, VERTICAL_TILE_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const right = await sharp(full)
    .extract({ left: WIDTH - SIDE_WIDTH, top: SIDE_TOP, width: SIDE_WIDTH, height: SIDE_HEIGHT })
    .resize(VERTICAL_TILE_WIDTH, VERTICAL_TILE_HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();

  const layers = [
    { input: top, left: 0, top: 0 },
    { input: top, left: HORIZONTAL_TILE_WIDTH, top: 0 },
    { input: bottom, left: 0, top: HEIGHT - HORIZONTAL_TILE_HEIGHT },
    { input: bottom, left: HORIZONTAL_TILE_WIDTH, top: HEIGHT - HORIZONTAL_TILE_HEIGHT },
    { input: left, left: 0, top: SIDE_TOP },
    { input: left, left: 0, top: SIDE_TOP + VERTICAL_TILE_HEIGHT },
    { input: right, left: WIDTH - VERTICAL_TILE_WIDTH, top: SIDE_TOP },
    { input: right, left: WIDTH - VERTICAL_TILE_WIDTH, top: SIDE_TOP + VERTICAL_TILE_HEIGHT },
  ];
  const output = await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colours: 256, quality: 88 })
    .toBuffer();

  await fs.mkdir(path.dirname(previewPath), { recursive: true });
  await fs.writeFile(runtimePath, output);
  await fs.writeFile(previewPath, output);
  await fs.writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    canvas: [WIDTH, HEIGHT],
    worldScale: [1.25, 1.25],
    horizontalSpectatorScale: [0.5, 0.58],
    verticalSpectatorScale: [0.58, 0.5],
    cameraLayer: "stadium.top",
    source: path.relative(projectDir, masterPath),
    outputBytes: output.length,
  }, null, 2)}\n`);
  console.info(`[rural-crowd-fit] PASS：4096×2048 世界观众贴图 ${(output.length / 1024).toFixed(1)} KiB`);
}

await build();

