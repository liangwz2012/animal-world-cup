import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const {
  createJerseyTextLayout,
  jerseyTextPalette,
} = require("../src/ui/dynamic-jersey.js");

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const teamsDir = path.join(projectDir, "source-assets", "public", "match-runtime-min", "data", "teams");
const outputDir = path.join(projectDir, "美术整体替换包", "乡村球衣系统");
const outputPath = path.join(outputDir, "动态地区名称预览.png");
const WIDTH = 1200;
const HEIGHT = 740;

const examples = Object.freeze([
  { label: "广东", teamId: "argentina", kit: "home" },
  { label: "广州", teamId: "brazil", kit: "home" },
  { label: "茂名", teamId: "england", kit: "home" },
  { label: "信宜", teamId: "france", kit: "away" },
  { label: "镇隆", teamId: "germany", kit: "home" },
  { label: "镇隆青年队", teamId: "portugal", kit: "goalkeeper" },
]);

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function measureContext() {
  return {
    font: "",
    measureText(label) {
      const size = Number.parseFloat(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || "8");
      return { width: Array.from(label).length * size };
    },
  };
}

async function averageLuminance(source) {
  const { data } = await sharp(source)
    .ensureAlpha()
    .resize(1, 1, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[0] * 0.2126 + data[1] * 0.7152 + data[2] * 0.0722;
}

async function renderShirt(source, label, face) {
  const metadata = await sharp(source).metadata();
  const width = metadata.width || 112;
  const height = metadata.height || 104;
  const layout = createJerseyTextLayout(measureContext(), label, face, width, height);
  const palette = jerseyTextPalette(await averageLuminance(source));
  const textLength = Math.min(layout.maxWidth, layout.measuredWidth * layout.scaleX);
  const safeLabel = escapeXml(label);
  const common = [
    `x="${layout.x}"`,
    `y="${layout.y}"`,
    `font-family="PingFang SC,Noto Sans CJK SC,sans-serif"`,
    `font-size="${layout.size}"`,
    `font-weight="900"`,
    `text-anchor="middle"`,
    `dominant-baseline="middle"`,
    `textLength="${textLength}"`,
    `lengthAdjust="spacingAndGlyphs"`,
    `stroke-linejoin="round"`,
  ].join(" ");
  const number = face === "back"
    ? `<text x="${width / 2}" y="${Math.round(height * 0.66)}" font-family="Arial,sans-serif" font-size="${Math.round(height * 0.29)}" font-weight="900" text-anchor="middle" dominant-baseline="middle" fill="#fff7db" stroke="#17352b" stroke-width="${Math.max(1, height * 0.018)}">7</text>`
    : "";
  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
      + `<text ${common} fill="none" stroke="${palette.outerStroke}" stroke-width="${Math.max(1.7, layout.size * 0.28)}">${safeLabel}</text>`
      + `<text ${common} fill="none" stroke="${palette.innerStroke}" stroke-width="${Math.max(0.65, layout.size * 0.1)}">${safeLabel}</text>`
      + `<text ${common} fill="${palette.fill}" stroke="none">${safeLabel}</text>`
      + number
      + "</svg>",
  );
  return sharp(source)
    .ensureAlpha()
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 9, palette: true, colours: 128 })
    .toBuffer();
}

async function renderCard(example, index) {
  const cardWidth = 360;
  const cardHeight = 260;
  const column = index % 3;
  const row = Math.floor(index / 3);
  const left = 40 + column * 385;
  const top = 150 + row * 280;
  const sourceRoot = path.join(teamsDir, example.teamId, example.kit);
  const [front, back] = await Promise.all([
    renderShirt(path.join(sourceRoot, "shirt_front.png"), example.label.slice(0, 4), "front"),
    renderShirt(path.join(sourceRoot, "shirt_back.png"), example.label.slice(0, 6), "back"),
  ]);
  const card = Buffer.from(
    `<svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">`
      + `<rect x="1" y="1" width="${cardWidth - 2}" height="${cardHeight - 2}" rx="22" fill="#fffdf4" stroke="#cbd6a8" stroke-width="2"/>`
      + `<text x="180" y="34" font-family="PingFang SC,Noto Sans CJK SC,sans-serif" font-size="22" font-weight="900" text-anchor="middle" fill="#31481f">${escapeXml(example.label)}</text>`
      + `<text x="91" y="236" font-family="PingFang SC,Noto Sans CJK SC,sans-serif" font-size="15" font-weight="700" text-anchor="middle" fill="#62734b">正面</text>`
      + `<text x="269" y="236" font-family="PingFang SC,Noto Sans CJK SC,sans-serif" font-size="15" font-weight="700" text-anchor="middle" fill="#62734b">背面 · 号码另层</text>`
      + "</svg>",
  );
  return {
    left,
    top,
    layers: [
      { input: card, left, top },
      {
        input: await sharp(front).resize(150, 140, { kernel: "nearest" }).png().toBuffer(),
        left: left + 16,
        top: top + 65,
      },
      {
        input: await sharp(back).resize(150, 140, { kernel: "nearest" }).png().toBuffer(),
        left: left + 194,
        top: top + 65,
      },
    ],
  };
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const cards = await Promise.all(examples.map(renderCard));
  const header = Buffer.from(
    `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`
      + `<rect width="${WIDTH}" height="${HEIGHT}" fill="#f1f6df"/>`
      + `<text x="600" y="55" font-family="PingFang SC,Noto Sans CJK SC,sans-serif" font-size="32" font-weight="900" text-anchor="middle" fill="#31481f">动态地区名称 · Image2 正式球衣预览</text>`
      + `<text x="600" y="92" font-family="PingFang SC,Noto Sans CJK SC,sans-serif" font-size="18" font-weight="600" text-anchor="middle" fill="#62734b">运行时合成，不为全国行政区生产图片；文字随原骨架跑动、转身与缩放</text>`
      + `<text x="600" y="120" font-family="PingFang SC,Noto Sans CJK SC,sans-serif" font-size="15" font-weight="600" text-anchor="middle" fill="#7a875e">纹理 112×104，骨架逻辑尺寸仍为 56×52；清晰度提升但人物大小、锚点与动作不变</text>`
      + "</svg>",
  );
  const layers = [{ input: header, left: 0, top: 0 }];
  for (const card of cards) layers.push(...card.layers);
  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: "#f1f6dfff",
    },
  })
    .composite(layers)
    .png({ compressionLevel: 9, palette: true, colours: 192 })
    .toFile(outputPath);
  console.info(`[art:jersey-label-preview] PASS：${path.relative(projectDir, outputPath)}`);
}

main().catch((error) => {
  console.error("[art:jersey-label-preview] FAIL", error && error.message || error);
  process.exitCode = 1;
});
