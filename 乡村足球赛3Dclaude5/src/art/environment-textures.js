// 现代村镇主场的环境材质：维护草坪与农田村路。
// 全部在运行时 Canvas 生成，seed 固定，不引入发行包图片。

import { createPrng, hashSeed } from "../core/prng.js";

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const channel = (key) => Math.round(ca[key] + (cb[key] - ca[key]) * t);
  return `rgb(${channel("r")},${channel("g")},${channel("b")})`;
}

export function venueTextureBudget(quality = "high") {
  const pitch = quality === "low" ? 1024 : 2048;
  const ground = quality === "low" ? 512 : 1024;
  return { pitch, ground, totalPixels: pitch * pitch + ground * ground };
}

function paintFieldLines(ctx, culture, format, scale, toX, toY) {
  const halfL = format.pitch.length / 2;
  const halfW = format.pitch.width / 2;
  ctx.strokeStyle = culture.ground.line;
  ctx.fillStyle = culture.ground.line;
  ctx.lineWidth = Math.max(2, 0.12 * scale);
  ctx.globalAlpha = 0.96;
  ctx.strokeRect(toX(-halfL), toY(-halfW), format.pitch.length * scale, format.pitch.width * scale);
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(-halfW));
  ctx.lineTo(toX(0), toY(halfW));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(toX(0), toY(0), format.pitch.width * 0.16 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(toX(0), toY(0), 0.26 * scale, 0, Math.PI * 2);
  ctx.fill();

  const boxDepth = format.penaltyDepth;
  const boxHalf = format.penaltyWidth / 2;
  const smallDepth = boxDepth * 0.38;
  const smallHalf = format.goal.width * 0.9;
  for (const sign of [-1, 1]) {
    const outer = sign * halfL;
    ctx.beginPath();
    ctx.rect(toX(Math.min(outer, outer - sign * boxDepth)), toY(-boxHalf), boxDepth * scale, boxHalf * 2 * scale);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(toX(Math.min(outer, outer - sign * smallDepth)), toY(-smallHalf), smallDepth * scale, smallHalf * 2 * scale);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(toX(outer - sign * boxDepth * 0.62), toY(0), 0.22 * scale, 0, Math.PI * 2);
    ctx.fill();
    for (const zSign of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(toX(outer), toY(zSign * halfW), 0.9 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// 维护良好的村镇赛事草坪：清晰条纹、细草理、克制磨损，不做大块泥斑。
export function paintVenuePitchTexture(canvas, culture, format, size = 1024, margin = 5.5) {
  const ctx = canvas.getContext("2d");
  const prng = createPrng(hashSeed(`venue-pitch:${culture.id}:${format.id}`));
  const worldW = format.pitch.length + margin * 2;
  const worldH = format.pitch.width + margin * 2;
  const scale = size / worldW;
  const pxH = worldH * scale;
  const offsetY = (size - pxH) / 2;
  const toX = (x) => (x + worldW / 2) * scale;
  const toY = (z) => offsetY + (z + worldH / 2) * scale;
  const grassA = mix(culture.ground.grass, "#4C8B48", 0.26);
  const grassB = mix(culture.ground.grassAlt, "#8ABA5E", 0.3);

  ctx.fillStyle = mix(grassA, "#335F37", 0.12);
  ctx.fillRect(0, 0, size, size);
  const stripes = 12;
  for (let i = 0; i < stripes; i += 1) {
    const x0 = toX(-format.pitch.length / 2 + (i / stripes) * format.pitch.length);
    const stripeW = (format.pitch.length / stripes) * scale + 1;
    ctx.fillStyle = i % 2 ? grassA : grassB;
    ctx.fillRect(x0, toY(-worldH / 2), stripeW, pxH);
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = i % 2 ? "#FFFFFF" : "#102A16";
    ctx.fillRect(x0, toY(-worldH / 2), Math.max(1, stripeW * 0.045), pxH);
    ctx.globalAlpha = 1;
  }

  const density = size / 1024;
  ctx.save();
  ctx.globalAlpha = 0.07;
  for (let i = 0; i < 5200 * density; i += 1) {
    ctx.fillStyle = prng.chance(0.58) ? "#FFFFFF" : "#0D2A16";
    const x = prng.next() * size;
    const y = offsetY + prng.next() * pxH;
    ctx.fillRect(x, y, 1 + prng.next() * density, 2 + prng.next() * 5 * density);
  }
  ctx.restore();

  // 只有门前和中圈出现低饱和踩踏色，远看仍是完整绿茵。
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = mix(culture.ground.soil, grassA, 0.58);
  const hotspots = [
    { x: -format.pitch.length / 2 + 3.8, z: 0, rx: 4.8, rz: 5.8 },
    { x: format.pitch.length / 2 - 3.8, z: 0, rx: 4.8, rz: 5.8 },
    { x: 0, z: 0, rx: 3.3, rz: 3.3 },
  ];
  for (const spot of hotspots) {
    for (let i = 0; i < 230 * density; i += 1) {
      const angle = prng.next() * Math.PI * 2;
      const radius = Math.sqrt(prng.next());
      const x = spot.x + Math.cos(angle) * spot.rx * radius;
      const z = spot.z + Math.sin(angle) * spot.rz * radius;
      ctx.fillRect(toX(x), toY(z), 1 + prng.next() * 4 * density, 1 + prng.next() * 3 * density);
    }
  }
  ctx.restore();

  paintFieldLines(ctx, culture, format, scale, toX, toY);
  return { canvas, worldW, worldH };
}

// 场外不是黄土荒地，也不是城市硬铺装：田块、灌渠、菜地与水泥村路交错。
export function paintRuralGroundTexture(canvas, culture, size = 1024) {
  const ctx = canvas.getContext("2d");
  const prng = createPrng(hashSeed(`rural-ground:${culture.id}`));
  const base = mix(culture.ground.soil, culture.ground.grassAlt, 0.58);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const cols = 7;
  const rows = 7;
  const cellW = size / cols;
  const cellH = size / rows;
  const crops = [
    mix(culture.ground.grass, "#83A94A", 0.42),
    mix(culture.ground.grassAlt, "#B7C86A", 0.3),
    mix(culture.ground.soil, "#A8804B", 0.36),
    "#6F9448",
  ];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const inset = 6 + prng.next() * 9;
      const x = col * cellW + inset;
      const y = row * cellH + inset;
      const w = cellW - inset * 2;
      const h = cellH - inset * 2;
      ctx.globalAlpha = 0.64 + prng.next() * 0.24;
      ctx.fillStyle = crops[Math.floor(prng.next() * crops.length)];
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = "#17351F";
      const furrows = 5 + Math.floor(prng.next() * 5);
      for (let i = 1; i < furrows; i += 1) ctx.fillRect(x, y + (i / furrows) * h, w, 2);
    }
  }
  ctx.globalAlpha = 1;

  // 灌渠带来水乡层次，控制宽度避免像城市河道。
  ctx.save();
  ctx.strokeStyle = "#527F86";
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = size * 0.014;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, size * 0.69);
  ctx.quadraticCurveTo(size * 0.48, size * 0.61, size, size * 0.66);
  ctx.stroke();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "#D9EEF0";
  ctx.lineWidth = size * 0.003;
  ctx.stroke();
  ctx.restore();

  // 两条水泥村路，颜色偏暖灰，明确是乡村基础设施而非城市道路。
  ctx.save();
  ctx.strokeStyle = "#B8B19E";
  ctx.globalAlpha = 0.92;
  ctx.lineWidth = size * 0.026;
  ctx.lineCap = "round";
  const roads = [[0, 0.3, 1, 0.25], [0.72, 0, 0.63, 1]];
  for (const [x0, y0, x1, y1] of roads) {
    ctx.beginPath();
    ctx.moveTo(size * x0, size * y0);
    ctx.quadraticCurveTo(size * 0.52, size * ((y0 + y1) / 2 + 0.04), size * x1, size * y1);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = "#5E594D";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  return canvas;
}
