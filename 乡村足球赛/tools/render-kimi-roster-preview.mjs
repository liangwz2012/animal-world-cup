import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// 拼 Kimi人物素材 12 人阵容总览：4×3 网格，头像 + 姓名/职业/位置号码。

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(toolsDir, "..");
const packageDir = path.join(projectDir, "Kimi人物素材");
const manifest = JSON.parse(await fs.readFile(path.join(packageDir, "manifest.json"), "utf8"));

function textSvg(text, size, color, width, height, weight = 500) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="PingFang SC, Hiragino Sans GB, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${text}</text></svg>`,
  );
}

const cols = 4;
const rows = Math.ceil(manifest.players.length / cols);
const cellW = 230;
const cellH = 344;
const gap = 16;
const titleH = 76;
const width = cols * cellW + (cols + 1) * gap;
const height = titleH + rows * cellH + (rows + 1) * gap;
const composites = [
  { input: textSvg(`Kimi人物素材 · 村超 ${manifest.players.length} 人阵容预览（未应用）`, 30, "#F5E9D0", width, titleH, 600), left: 0, top: 0 },
];

async function keyMagenta(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const distance = Math.sqrt((red - 255) ** 2 + green ** 2 + (blue - 255) ** 2);
    let alpha = data[offset + 3];
    if (distance <= 42) alpha = 0;
    else if (distance < 104) alpha = Math.min(alpha, Math.round(255 * (distance - 42) / 62));
    // 去溢色：把残留的洋红边压回灰度
    const dominance = Math.min(red, blue) - green;
    if (alpha > 0 && red >= 140 && blue >= 140 && dominance > 24) {
      const excess = dominance - 24;
      data[offset] = Math.max(0, red - excess);
      data[offset + 2] = Math.max(0, blue - excess);
    }
    data[offset + 3] = alpha;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}

for (const [index, player] of manifest.players.entries()) {
  const col = index % cols;
  const row = Math.floor(index / cols);
  const left = gap + col * (cellW + gap);
  const top = titleH + gap + row * (cellH + gap);
  // 高清版：从 768px 三视图参考母版的左栏胸像裁切（约 256px 宽），比 192 运行头像更细腻
  const bustRaw = await sharp(path.join(packageDir, "players", player.id, "source-sheet.webp"))
    .extract({ left: 0, top: 0, width: 256, height: 340 })
    .resize(200, 266, { fit: "cover", position: "attention" })
    .png().toBuffer();
  const bust = await keyMagenta(bustRaw);
  composites.push({ input: bust, left: left + (cellW - 200) / 2, top });
  const label = `${player.number}号 ${player.name} · ${player.profession}`;
  const labelSize = label.length <= 13 ? 17 : label.length <= 16 ? 14 : 12;
  composites.push({
    input: textSvg(label, labelSize, "#E8E4D8", cellW, 34, 600),
    left, top: top + 272,
  });
  composites.push({
    input: textSvg(`${player.position} · ${player.age}岁`, 14, "#9AA3B2", cellW, 28),
    left, top: top + 304,
  });
}

const target = path.join(packageDir, "preview", "roster-12-hd.png");
await fs.mkdir(path.dirname(target), { recursive: true });
await sharp({
  create: { width, height, channels: 4, background: { r: 28, g: 32, b: 40, alpha: 255 } },
}).composite(composites).png().toFile(target);
console.info("[kimi-roster] PASS:", target);
