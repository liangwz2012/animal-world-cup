import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const mastersDir = path.join(projectDir, "美术整体替换包", "乡村球衣系统", "image2-masters");
const output = path.join(projectDir, "美术整体替换包", "乡村球衣系统", "Image2正式球衣母版预览.webp");
const styles = [
  ["cunchao-red", "红金"],
  ["cunchao-green", "翠绿"],
  ["cunchao-navy", "藏青"],
  ["cunchao-sky", "天蓝"],
  ["cunchao-orange", "暖橙"],
  ["cunchao-purple", "靛紫"],
  ["cunchao-teal", "青金"],
  ["cunchao-black", "黑红"],
];

async function main() {
  const width = 1600;
  const height = 900;
  const columns = 4;
  const cellWidth = width / columns;
  const cellHeight = height / 2;
  const composites = [];
  const labels = [];
  for (const [index, [id, label]] of styles.entries()) {
    const left = (index % columns) * cellWidth;
    const top = Math.floor(index / columns) * cellHeight;
    const image = await sharp(path.join(mastersDir, `${id}.webp`))
      .resize(360, 360, { fit: "contain", background: { r: 244, g: 240, b: 224, alpha: 1 } })
      .webp({ quality: 86, effort: 5 })
      .toBuffer();
    composites.push({ input: image, left: left + 20, top: top + 58 });
    labels.push(`<text x="${left + 24}" y="${top + 38}" font-size="25" font-weight="800" fill="#fff6d6">${index + 1}. ${label}</text>`);
  }
  const background = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#315c31"/><stop offset="1" stop-color="#172f24"/></linearGradient></defs>
      <rect width="100%" height="100%" rx="28" fill="url(#g)"/>
      ${labels.join("")}
    </svg>
  `);
  await sharp(background)
    .composite(composites)
    .webp({ quality: 84, effort: 6 })
    .toFile(output);
  const stat = await fs.stat(output);
  console.info(`[image2-preview] PASS：${path.relative(projectDir, output)} ${Math.round(stat.size / 1024)} KiB`);
}

main().catch((error) => {
  console.error("[image2-preview] FAIL", error && error.message || error);
  process.exitCode = 1;
});
