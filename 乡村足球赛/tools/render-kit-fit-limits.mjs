import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// 球衣体型缩放极限探索：同一套球衣按不同裁剪系数拼装，直观看哪里出现破洞/重叠。
// 骨骼位置不动（真实行为），附件绕自身中心缩放。

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const kitDir = path.join(projectDir, "source-assets", "public", "match-runtime-min", "data", "teams", "argentina", "home");
const outDir = path.join(projectDir, "Kimi人物素材", "球衣预览");

const FIGURE_PIECES = Object.freeze([
  ["shirt_front.png", 80, 74, 8, 0, "shirt"],
  ["sleeve_left.png", 20, 31, 0, 10, "sleeve"],
  ["sleeve_right.png", 31, 24, 75, 12, "sleeve"],
  ["shorts.png", 78, 12, 9, 78, "shorts"],
  ["shorts_leg_left.png", 18, 25, 26, 86, "shorts"],
  ["shorts_leg_right.png", 18, 25, 53, 86, "shorts"],
  ["socks_left.png", 16, 21, 27, 111, "sock"],
  ["socks_right.png", 16, 21, 55, 111, "sock"],
  ["shoes_left.png", 24, 9, 22, 132, "shoe"],
  ["shoes_right.png", 24, 9, 54, 132, "shoe"],
]);
const FIGURE_W = 106;
const FIGURE_H = 141;
const HD = 4;

const FITS = Object.freeze([
  ["极限窄 0.85×/0.88", { x: 0.85, y: 0.88 }],
  ["高瘦 0.94×/1.05", { x: 0.94, y: 1.05 }],
  ["标准 1.00", { x: 1, y: 1 }],
  ["矮壮 1.08×/0.95", { x: 1.08, y: 0.95 }],
  ["极限宽 1.18×/0.90", { x: 1.18, y: 0.90 }],
]);

function factorFor(kind, fit) {
  if (kind === "shirt") return { x: fit.x, y: fit.y };
  if (kind === "sleeve") return { x: 1 + (fit.x - 1) * 0.7, y: 1 };
  if (kind === "shorts") return { x: fit.x, y: 1 };
  if (kind === "sock") return { x: 1 + (fit.x - 1) * 0.5, y: 1 };
  return { x: 1 + (fit.x - 1) * 0.4, y: 1 };
}

function textSvg(text, size, color, width, height, weight = 600) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${text}</text></svg>`,
  );
}

async function main() {
  const titleH = 70;
  const labelH = 46;
  const gapX = 60;
  const padX = 40;
  const width = padX * 2 + FITS.length * FIGURE_W * HD + (FITS.length - 1) * gapX;
  const height = titleH + labelH + FIGURE_H * HD + 40;
  const composites = [
    { input: textSvg("球衣体型缩放极限对比（骨骼不动，附件绕中心缩放）", 30, "#F5E9D0", width, titleH), left: 0, top: 0 },
  ];
  for (const [index, [label, fit]] of FITS.entries()) {
    const left = padX + index * (FIGURE_W * HD + gapX);
    composites.push({ input: textSvg(label, 19, "#FFF7D8", FIGURE_W * HD, labelH), left, top: titleH });
    for (const [file, w, h, leftOff, topOff, kind] of FIGURE_PIECES) {
      const factor = factorFor(kind, fit);
      const dispW = Math.max(2, Math.round(w * HD * factor.x));
      const dispH = Math.max(2, Math.round(h * HD * factor.y));
      const centerX = left + (leftOff + w / 2) * HD;
      const centerY = titleH + labelH + (topOff + h / 2) * HD;
      const input = await sharp(path.join(kitDir, file))
        .resize(dispW, dispH, { fit: "fill", kernel: "nearest" })
        .png().toBuffer();
      composites.push({ input, left: Math.round(centerX - dispW / 2), top: Math.round(centerY - dispH / 2) });
    }
  }
  const target = path.join(outDir, "球衣体型缩放极限.png");
  await fs.mkdir(outDir, { recursive: true });
  await sharp({ create: { width, height, channels: 4, background: { r: 23, g: 38, b: 24, alpha: 255 } } })
    .composite(composites).png().toFile(target);
  console.info("[kit-fit-limits] PASS:", target);
}

main().catch((error) => {
  console.error("[kit-fit-limits] FAIL", error && error.message || error);
  process.exitCode = 1;
});
