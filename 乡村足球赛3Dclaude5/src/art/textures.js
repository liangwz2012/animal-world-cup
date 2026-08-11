// 程序化生成每名球员的贴图：球衣（含背号、胸前号、队名）、脸、皮肤晒痕、袜子和球鞋。
// 不使用任何外部图片资源，包体里没有一张 png。

import { ATLAS_SCALE, ATLAS_SIZE, RECTS } from "./atlas.js";
import { createPrng, hashSeed } from "../core/prng.js";

const FONT_STACK = '"PingFang SC","Heiti SC","Microsoft YaHei",sans-serif';

function shade(hex, amount) {
  const value = hex.replace("#", "");
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, "$1$1") : value, 16);
  let r = (num >> 16) & 255;
  let g = (num >> 8) & 255;
  let b = num & 255;
  r = Math.round(Math.min(255, Math.max(0, r + amount * 255)));
  g = Math.round(Math.min(255, Math.max(0, g + amount * 255)));
  b = Math.round(Math.min(255, Math.max(0, b + amount * 255)));
  return `rgb(${r},${g},${b})`;
}

// 两个 #rrggbb 按比例混合，用来把纯绿往土色里带
function mix(hexA, hexB, t) {
  const parse = (hex) => {
    const v = hex.replace("#", "");
    const n = parseInt(v.length === 3 ? v.replace(/(.)/g, "$1$1") : v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = parse(hexA);
  const b = parse(hexB);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

// #rrggbb 加透明度，用于羽化边缘的径向渐变
function rgba(hex, alpha) {
  const v = hex.replace("#", "");
  const n = parseInt(v.length === 3 ? v.replace(/(.)/g, "$1$1") : v, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function fillRect(ctx, rect, color) {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

// 布纹噪点：让纯色不像塑料。噪点始终只占一个物理像素，否则画布放大后布纹会变成马赛克
function fabricNoise(ctx, rect, prng, strength = 0.05) {
  ctx.save();
  ctx.globalAlpha = strength;
  const dot = 1 / ATLAS_SCALE;
  const count = rect.w * rect.h * 0.03 * ATLAS_SCALE * ATLAS_SCALE;
  for (let i = 0; i < count; i += 1) {
    const x = rect.x + prng.next() * rect.w;
    const y = rect.y + prng.next() * rect.h;
    ctx.fillStyle = prng.chance(0.5) ? "#000" : "#fff";
    ctx.fillRect(x, y, dot, dot);
  }
  ctx.restore();
}

// 晒痕：必须是渐变。硬边矩形贴到圆柱上就是一圈脏污，不是晓得发黑的胳膊
function tanFade(ctx, x, w, topY, bottomY, alpha) {
  const grad = ctx.createLinearGradient(0, topY, 0, bottomY);
  grad.addColorStop(0, "rgba(90,53,32,0)");
  grad.addColorStop(0.28, `rgba(90,53,32,${alpha * 0.8})`);
  grad.addColorStop(1, `rgba(90,53,32,${alpha})`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(x, topY, w, bottomY - topY);
  ctx.restore();
}

function toU(rect, u) {
  return rect.x + u * rect.w;
}

function toV(rect, v) {
  return rect.y + (1 - v) * rect.h;
}

function paintTorso(ctx, prng, { kit, player, teamShort, pattern }) {
  const rect = RECTS.torso;
  fillRect(ctx, rect, kit.primary);

  // 款式：纯色 / 竖条 / 斜肩 / 胸前横带 —— 村队球衣常见的几种便宜印法
  if (pattern === "stripes") {
    ctx.fillStyle = kit.secondary;
    for (let i = 0; i < 12; i += 1) {
      if (i % 2 === 0) continue;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(rect.x + (i / 12) * rect.w, rect.y, rect.w / 24, rect.h);
    }
    ctx.globalAlpha = 1;
  } else if (pattern === "sash") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.strokeStyle = kit.secondary;
    ctx.lineWidth = rect.h * 0.18;
    ctx.beginPath();
    ctx.moveTo(rect.x - 20, rect.y + rect.h * 0.9);
    ctx.lineTo(rect.x + rect.w + 20, rect.y + rect.h * 0.1);
    ctx.stroke();
    ctx.restore();
  } else if (pattern === "band") {
    ctx.fillStyle = kit.secondary;
    ctx.fillRect(rect.x, toV(rect, 0.62), rect.w, rect.h * 0.12);
  }

  // 领口与袖口色条
  ctx.fillStyle = kit.trim;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h * 0.07);
  ctx.fillStyle = shade(kit.primary, -0.16);
  ctx.fillRect(rect.x, toV(rect, 0.03), rect.w, rect.h * 0.05);

  // 正胸中线（接缝处）画一条门襟，把 UV 接缝变成设计
  ctx.fillStyle = shade(kit.primary, -0.12);
  ctx.fillRect(rect.x, rect.y, 3, rect.h);
  ctx.fillRect(rect.x + rect.w - 3, rect.y, 3, rect.h);

  // 背号：图集 u=0.5 正对背心中央
  const backX = toU(rect, 0.5);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = kit.number;
  ctx.strokeStyle = shade(kit.number, -0.55);
  ctx.lineWidth = 3;
  ctx.font = `bold 58px ${FONT_STACK}`;
  const number = String(player.number);
  ctx.strokeText(number, backX, toV(rect, 0.52));
  ctx.fillText(number, backX, toV(rect, 0.52));

  // 背后队名（村寨名），村超球衣就是这么印的
  ctx.font = `bold 17px ${FONT_STACK}`;
  ctx.fillStyle = kit.number;
  ctx.fillText(teamShort.slice(0, 5), backX, toV(rect, 0.82));

  // 胸前小号码（接缝右侧一点，正好落在左胸）
  ctx.font = `bold 22px ${FONT_STACK}`;
  ctx.fillText(number, toU(rect, 0.06), toV(rect, 0.66));

  fabricNoise(ctx, rect, prng, 0.06);
}

function paintHead(ctx, prng, player) {
  const rect = RECTS.head;
  const look = player.look;
  fillRect(ctx, rect, look.skin);

  // 脸中心在 u=0.5
  const cx = toU(rect, 0.5);
  const faceWidth = rect.w * 0.34;

  // 下颌阴影：贴着脸的下半圈，不能横贯整张贴图（那会在脸中间画出一条"大嘴"）
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = shade(look.skin, -0.3);
  ctx.beginPath();
  ctx.ellipse(cx, toV(rect, 0.3), faceWidth * 1.15, rect.h * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 头发：按发型覆盖头顶与两侧
  const hairTop = toV(rect, look.hairStyle === "bald-top" ? 0.86 : 0.67);
  const hairHeight = rect.y + rect.h - hairTop;
  if (look.hairStyle !== "bald-top") {
    ctx.fillStyle = look.hair;
    ctx.fillRect(rect.x, rect.y, rect.w, hairTop - rect.y + hairHeight * 0);
  } else {
    ctx.fillStyle = look.hair;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h * 0.1);
    // 两鬓仍有头发
    ctx.fillRect(rect.x, rect.y, rect.w * 0.22, rect.h * 0.34);
    ctx.fillRect(rect.x + rect.w * 0.78, rect.y, rect.w * 0.22, rect.h * 0.34);
  }
  if (look.hairStyle === "side-part") {
    ctx.fillStyle = shade(look.hair, 0.12);
    ctx.fillRect(cx - faceWidth * 0.9, rect.y + rect.h * 0.06, faceWidth * 0.5, rect.h * 0.1);
  }
  if (look.hairStyle === "messy") {
    ctx.fillStyle = shade(look.hair, -0.1);
    for (let i = 0; i < 14; i += 1) {
      const x = rect.x + prng.next() * rect.w;
      ctx.fillRect(x, rect.y + rect.h * 0.16, 3, 6 + prng.next() * 7);
    }
  }
  if (look.hairStyle === "ponytail" || look.hairStyle === "bun") {
    ctx.fillStyle = look.hair;
    // 后脑（u≈0 与 u≈1 两端）加一团
    ctx.fillRect(rect.x, rect.y + rect.h * 0.16, rect.w * 0.12, rect.h * 0.34);
    ctx.fillRect(rect.x + rect.w * 0.88, rect.y + rect.h * 0.16, rect.w * 0.12, rect.h * 0.34);
  }

  // ⚠ 头部贴图是圆柱展开：横向 96 px 对应整圈周长（约 5.28r），纵向 96 px 只对应
  // 头高（约 2.13r）。也就是说横向 1 px 的弧长是纵向的 2.5 倍——直接画圆，贴到头上
  // 就会被横向拉成 2.5 倍宽的裂缝。所有五官都在这个压扁变换里画，尺寸用"看上去的"单位。
  const FACE_SQUASH = 2.126 / 5.278;
  ctx.save();
  ctx.translate(cx, 0);
  ctx.scale(FACE_SQUASH, 1);
  ctx.translate(-cx, 0);

  const eyeY = toV(rect, 0.595);
  const gap = 19.5 * look.eyeGap;

  // 眉毛：皮克斯脸的表情几乎全靠眉毛
  ctx.fillStyle = shade(look.hair, 0.02);
  for (const sign of [-1, 1]) {
    const bx = cx + sign * gap;
    const lift = 15.5 + look.brow * 4;
    ctx.save();
    ctx.translate(bx, eyeY - lift);
    ctx.rotate(sign * (0.05 + look.brow * 0.1));
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 眼睛：大眼白 + 大虹膜 + 高光点 + 上眼睑压住上缘
  for (const sign of [-1, 1]) {
    const ex = cx + sign * gap;
    ctx.fillStyle = "#FBF7F0";
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 12.6, 10.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = "#6E6255";
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + 3.2, 11.4, 6.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#4A2E1C";
    ctx.beginPath();
    ctx.ellipse(ex + sign * 1, eyeY + 0.9, 7, 7.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#150D07";
    ctx.beginPath();
    ctx.ellipse(ex + sign * 1, eyeY + 1.1, 3.6, 3.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // 高光：皮克斯眼睛的"活气"就在这一点
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.ellipse(ex + sign * 1 - 2.8, eyeY - 3, 2.8, 2.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(ex + sign * 1 + 3, eyeY + 3.2, 1.3, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // 上眼睑只压住最上面一点
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY - 14.4, 13.6, 6.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = shade(look.skin, -0.4);
    ctx.beginPath();
    ctx.ellipse(ex, eyeY - 9.6, 13, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 鼻头：带高光的小圆球
  ctx.fillStyle = shade(look.skin, -0.1);
  ctx.beginPath();
  ctx.ellipse(cx, toV(rect, 0.498), 5.8, 4.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = shade(look.skin, 0.18);
  ctx.beginPath();
  ctx.ellipse(cx - 1.6, toV(rect, 0.512), 2.4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = shade(look.skin, -0.45);
  ctx.beginPath();
  ctx.ellipse(cx, toV(rect, 0.47), 6.6, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 嘴：上扬的弧线 + 下唇高光
  ctx.strokeStyle = shade(look.skin, -0.5);
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 9.5, toV(rect, 0.42));
  ctx.quadraticCurveTo(cx, toV(rect, 0.388), cx + 9.5, toV(rect, 0.42));
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = shade(look.skin, 0.22);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 7.4, toV(rect, 0.39));
  ctx.quadraticCurveTo(cx, toV(rect, 0.371), cx + 7.4, toV(rect, 0.39));
  ctx.stroke();
  ctx.restore();

  // 腮红
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = "#C4634A";
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sign * 28, toV(rect, 0.487), 9, 5.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  // 胡茬
  if (look.stubble > 0.2) {
    ctx.save();
    ctx.globalAlpha = 0.28 * look.stubble;
    ctx.fillStyle = look.hair;
    ctx.fillRect(cx - faceWidth * 0.75, toV(rect, 0.44), faceWidth * 1.5, rect.h * 0.22);
    ctx.restore();
  }

  // 皱纹（岁数越大越明显）
  if (look.wrinkle > 0.25) {
    ctx.save();
    ctx.globalAlpha = 0.22 * look.wrinkle;
    ctx.strokeStyle = shade(look.skin, -0.4);
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i += 1) {
      const y = toV(rect, 0.68 + i * 0.035);
      ctx.beginPath();
      ctx.moveTo(cx - faceWidth * 0.55, y);
      ctx.lineTo(cx + faceWidth * 0.55, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 耳朵（侧面 u≈0.25 / 0.75）
  ctx.fillStyle = shade(look.skin, -0.08);
  for (const u of [0.25, 0.75]) {
    ctx.beginPath();
    ctx.ellipse(toU(rect, u), toV(rect, 0.545), 2.6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 头带
  if (look.headband) {
    ctx.fillStyle = "#E8E2D2";
    ctx.fillRect(rect.x, toV(rect, 0.76), rect.w, rect.h * 0.07);
  }
  fabricNoise(ctx, rect, prng, 0.03);
}

function paintArm(ctx, prng, { kit, player }) {
  const rect = RECTS.arm;
  const look = player.look;
  // v=1 肩部（袖子），v=0 手腕
  fillRect(ctx, rect, look.skin);
  const sleeveEnd = look.sleeveRoll ? 0.72 : 0.6;
  ctx.fillStyle = kit.primary;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h * (1 - sleeveEnd));
  ctx.fillStyle = kit.trim;
  ctx.fillRect(rect.x, toV(rect, sleeveEnd), rect.w, 3);

  // 晒痕：袖口以下明显更黑
  tanFade(ctx, rect.x, rect.w, toV(rect, sleeveEnd - 0.02), rect.y + rect.h, 0.3 * look.tanLine);
  fabricNoise(ctx, rect, prng, 0.04);

  const hand = RECTS.hand;
  fillRect(ctx, hand, shade(look.skin, -0.06));
  ctx.save();
  ctx.globalAlpha = 0.3 * look.tanLine;
  ctx.fillStyle = "#5A3520";
  ctx.fillRect(hand.x, hand.y, hand.w, hand.h);
  ctx.restore();
}

function paintLeg(ctx, prng, { kit, player }) {
  const rect = RECTS.leg;
  const look = player.look;
  // v=1 髋部（短裤），中段皮肤，v=0 脚踝（球袜）
  fillRect(ctx, rect, shade(look.skin, -0.02));
  // 短裤只到大腿中段，长过膝盖会让整条腿糊成一根柱子
  ctx.fillStyle = kit.shorts;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h * 0.26);
  ctx.fillStyle = kit.trim;
  ctx.fillRect(rect.x, rect.y + rect.h * 0.24, rect.w, 3);

  const sockTop = look.sockDown ? 0.16 : 0.3;
  ctx.fillStyle = kit.socks;
  ctx.fillRect(rect.x, toV(rect, sockTop), rect.w, rect.h * sockTop);
  ctx.fillStyle = kit.trim;
  ctx.fillRect(rect.x, toV(rect, sockTop), rect.w, 3);

  // 小腿晒痕 + 泥点
  tanFade(ctx, rect.x, rect.w, toV(rect, 0.64), toV(rect, sockTop), 0.24 * look.tanLine);
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#6B5334";
  for (let i = 0; i < 26; i += 1) {
    ctx.fillRect(rect.x + prng.next() * rect.w, toV(rect, prng.next() * 0.45), 2, 2);
  }
  ctx.restore();

  // 短裤号码印在大腿外侧一小块；画在环向 UV 正中会被拉成一道歪斜的怪影
  ctx.fillStyle = kit.number;
  ctx.font = `bold 7px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(player.number), toU(rect, 0.24), rect.y + rect.h * 0.14);

  // 护膝
  if (look.kneeStrap) {
    ctx.fillStyle = "#4A4A46";
    ctx.fillRect(rect.x, toV(rect, 0.5), rect.w, rect.h * 0.035);
  }
  fabricNoise(ctx, rect, prng, 0.05);
}

function paintShoe(ctx, prng, { kit, player }) {
  const rect = RECTS.shoe;
  const base = player.role === "G" ? "#2C2C2C" : ["#1E1E1E", "#2A2A2A", "#3A2A1E", "#1A2A3A"][player.number % 4];
  fillRect(ctx, rect, base);
  ctx.fillStyle = kit.trim;
  ctx.fillRect(rect.x, rect.y + rect.h * 0.52, rect.w, rect.h * 0.1);
  ctx.fillStyle = "#D8D2C4";
  ctx.fillRect(rect.x, rect.y + rect.h * 0.86, rect.w, rect.h * 0.14);
  // 泥
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#7A6038";
  for (let i = 0; i < 20; i += 1) {
    ctx.fillRect(rect.x + prng.next() * rect.w, rect.y + rect.h * (0.6 + prng.next() * 0.4), 2, 2);
  }
  ctx.restore();
}

function paintExtra(ctx, prng, { kit, player }) {
  const rect = RECTS.extra;
  fillRect(ctx, rect, player.role === "G" ? kit.secondary : shade(kit.primary, -0.25));
  const hair = RECTS.hair;
  fillRect(ctx, hair, player.look.hair);
}

// 主入口：把一名球员画到一张 256×256 的画布上
export function paintPlayerAtlas(canvas, player, kit, teamShort) {
  const ctx = canvas.getContext("2d");
  const prng = createPrng(hashSeed(`atlas:${player.id}:${player.number}`));
  // 画布可能比逻辑坐标系大，之后所有绘制都按 256 坐标写，由这里统一放大
  const scale = canvas.width / ATLAS_SIZE;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  ctx.fillStyle = kit.primary;
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const patterns = ["solid", "stripes", "sash", "band"];
  const pattern = patterns[hashSeed(kit.id) % patterns.length];
  paintTorso(ctx, prng, { kit, player, teamShort, pattern });
  paintHead(ctx, prng, player);
  paintArm(ctx, prng, { kit, player });
  paintLeg(ctx, prng, { kit, player });
  paintShoe(ctx, prng, { kit, player });
  paintExtra(ctx, prng, { kit, player });
  return canvas;
}

// 球场：割草条纹 + 磨损秃斑 + 全套白线，一张贴图覆盖整块场地（含边外草地）
export function paintPitchTexture(canvas, culture, format, size = 1024, margin = 6) {
  const ctx = canvas.getContext("2d");
  const prng = createPrng(hashSeed(`pitch:${culture.id}:${format.id}`));
  const worldW = format.pitch.length + margin * 2;
  const worldH = format.pitch.width + margin * 2;
  const scale = size / worldW;
  const pxH = worldH * scale;
  const offsetY = (size - pxH) / 2;
  const toX = (x) => (x + worldW / 2) * scale;
  const toY = (z) => offsetY + (z + worldH / 2) * scale;

  ctx.fillStyle = mix(culture.ground.grassAlt, culture.ground.soil, 0.32);
  ctx.fillRect(0, 0, size, size);

  // 草色先掺一份土黄再用：村里的场子没有养护，纯绿不真实
  const grassA = mix(culture.ground.grass, culture.ground.soil, 0.28);
  const grassB = mix(culture.ground.grassAlt, "#D6E4A8", 0.045);
  // 固定数量的噪点在更大的贴图上会被稀释，密度跟着分辨率走
  const density = size / 1024;
  // 割草条纹沿场地长边
  const stripes = 11;
  for (let i = 0; i < stripes; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? grassA : grassB;
    const x0 = toX(-format.pitch.length / 2 + (i / stripes) * format.pitch.length);
    ctx.fillRect(x0, toY(-worldH / 2), (format.pitch.length / stripes) * scale + 1, pxH);
  }

  // 秃斑：门前、中圈、边线附近最秃，这是村里土场的特征
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = culture.ground.soil;
  // 村里的球场不是养护草坪：门前、中圈、两条边线和角旗区都踩得发黄
  const hotspots = [
    { x: -format.pitch.length / 2 + 5, z: 0, r: 9 },
    { x: format.pitch.length / 2 - 5, z: 0, r: 9 },
    { x: 0, z: 0, r: 6.5 },
    { x: 0, z: -format.pitch.width / 2 + 1.5, r: 5 },
    { x: 0, z: format.pitch.width / 2 - 1.5, r: 5 },
    { x: -format.pitch.length / 4, z: 0, r: 5 },
    { x: format.pitch.length / 4, z: 0, r: 5 },
  ];
  for (let i = 0; i < 4200 * density * density; i += 1) {
    const wx = (prng.next() - 0.5) * worldW;
    const wz = (prng.next() - 0.5) * worldH;
    let wear = 0.08;
    for (const spot of hotspots) {
      const d = Math.hypot(wx - spot.x, wz - spot.z);
      wear = Math.max(wear, 1 - d / spot.r);
    }
    if (prng.next() < wear) {
      ctx.fillRect(toX(wx), toY(wz), 2 + prng.next() * 6, 2 + prng.next() * 5);
    }
  }
  ctx.restore();

  // 成片的秃斑：只在踩得最多的地方连成片，其余是零星小块。
  // 半径要小、边缘要羽化——大颗硬边椭圆铺满全场，远看就是一地霉斑。
  ctx.save();
  for (let i = 0; i < 460 * density; i += 1) {
    const wx = (prng.next() - 0.5) * format.pitch.length * 0.98;
    const wz = (prng.next() - 0.5) * format.pitch.width * 0.98;
    let wear = 0.05;
    for (const spot of hotspots) {
      wear = Math.max(wear, 1 - Math.hypot(wx - spot.x, wz - spot.z) / spot.r);
    }
    if (prng.next() > wear * 0.9 + 0.11) continue;
    const cx = toX(wx);
    const cy = toY(wz);
    const r = (0.3 + prng.next() * 1.15 * (0.35 + wear)) * scale;
    const tone = prng.chance(0.6) ? culture.ground.soil : "#9C8A5C";
    const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    grad.addColorStop(0, rgba(tone, 1));
    grad.addColorStop(0.55, rgba(tone, 0.78));
    grad.addColorStop(1, rgba(tone, 0));
    ctx.globalAlpha = 0.24 + prng.next() * 0.32;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.74 + prng.next() * 0.26), prng.next() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 整体压一层暖土色：纯绿看着像高尔夫球场，村里的场子偏黄偏灰
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = culture.ground.soil;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // 白线
  const halfL = format.pitch.length / 2;
  const halfW = format.pitch.width / 2;
  ctx.strokeStyle = culture.ground.line;
  ctx.lineWidth = Math.max(2, 0.12 * scale);
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(toX(-halfL), toY(-halfW), format.pitch.length * scale, format.pitch.width * scale);
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(-halfW));
  ctx.lineTo(toX(0), toY(halfW));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(toX(0), toY(0), (format.pitch.width * 0.16) * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(toX(0), toY(0), 0.28 * scale, 0, Math.PI * 2);
  ctx.fillStyle = culture.ground.line;
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
    // 点球点
    ctx.beginPath();
    ctx.arc(toX(outer - sign * boxDepth * 0.62), toY(0), 0.22 * scale, 0, Math.PI * 2);
    ctx.fill();
    // 角球弧
    for (const zSign of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(toX(outer), toY(zSign * halfW), 0.9 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // 草地细噪点
  ctx.save();
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 9000 * density; i += 1) {
    ctx.fillStyle = prng.chance(0.5) ? "#000" : "#fff";
    ctx.fillRect(prng.next() * size, prng.next() * size, 2, 2);
  }
  ctx.restore();
  return { canvas, worldW, worldH };
}

// 场外地面：以黄土为底、草为斑块，再压上土路和耕地条纹。
// 之前是一整块纯绿，远看就是高尔夫球场，一点村子的样子都没有。
export function paintGroundTexture(canvas, culture, size = 1024) {
  const ctx = canvas.getContext("2d");
  const prng = createPrng(hashSeed(`ground:${culture.id}`));
  const soil = culture.ground.soil;
  ctx.fillStyle = soil;
  ctx.fillRect(0, 0, size, size);

  // 土色本身要有深浅，不能是一块死板的黄
  ctx.save();
  for (let i = 0; i < 1400; i += 1) {
    ctx.globalAlpha = 0.05 + prng.next() * 0.12;
    ctx.fillStyle = prng.chance(0.5) ? "#000000" : "#FFFFFF";
    const r = 6 + prng.next() * 40;
    ctx.beginPath();
    ctx.arc(prng.next() * size, prng.next() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 草只是斑块，不是满铺
  ctx.save();
  for (let i = 0; i < 220; i += 1) {
    ctx.globalAlpha = 0.5 + prng.next() * 0.4;
    ctx.fillStyle = prng.chance(0.5) ? culture.ground.grass : culture.ground.grassAlt;
    const cx = prng.next() * size;
    const cy = prng.next() * size;
    const r = 18 + prng.next() * 62;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.55 + prng.next() * 0.6), prng.next() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 耕地：一条条犁沟
  ctx.save();
  for (let f = 0; f < 5; f += 1) {
    const fx = prng.next() * size;
    const fy = prng.next() * size;
    const fw = 90 + prng.next() * 150;
    const fh = 70 + prng.next() * 120;
    const angle = prng.next() * Math.PI;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(angle);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = prng.chance(0.5) ? "#8A7340" : "#6E7C3A";
    ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#3E3320";
    for (let r = 0; r < fh; r += 9) {
      ctx.fillRect(-fw / 2, -fh / 2 + r, fw, 3);
    }
    ctx.restore();
  }
  ctx.restore();

  // 土路：两条穿过村子的主路
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = "#C6AE7C";
  ctx.lineWidth = size * 0.035;
  ctx.lineCap = "round";
  for (const [x0, y0, x1, y1] of [[0, size * 0.34, size, size * 0.28], [size * 0.62, 0, size * 0.7, size]]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(size * 0.5, (y0 + y1) / 2 + 40, x1, y1);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#8A7448";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  return canvas;
}

// 球网：透明底 + 白色网格，贴在球门的三面
export function paintNetTexture(canvas, size = 128) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(250,250,245,0.85)";
  ctx.lineWidth = 2;
  const cells = 14;
  for (let i = 0; i <= cells; i += 1) {
    const p = (i / cells) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  return canvas;
}

// 观众：一张横向排列的小人图集，看台用广告牌方式批量绘制
export function paintCrowdTexture(canvas, culture, cells = 8, cell = 64) {
  const ctx = canvas.getContext("2d");
  const prng = createPrng(hashSeed(`crowd:${culture.id}`));
  ctx.clearRect(0, 0, cells * cell, cell);
  for (let i = 0; i < cells; i += 1) {
    const x = i * cell;
    const shirt = culture.crowd.palette[i % culture.crowd.palette.length];
    const skin = ["#C98F63", "#B37A50", "#D3A177", "#9E603C"][Math.floor(prng.next() * 4)];
    // 身体
    ctx.fillStyle = shirt;
    ctx.fillRect(x + cell * 0.28, cell * 0.42, cell * 0.44, cell * 0.44);
    // 头
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x + cell * 0.5, cell * 0.3, cell * 0.14, 0, Math.PI * 2);
    ctx.fill();
    // 头发/帽子
    ctx.fillStyle = prng.chance(0.3) ? "#E4DCC8" : "#1B140E";
    ctx.fillRect(x + cell * 0.36, cell * 0.17, cell * 0.28, cell * 0.1);
    // 手臂（有的举着）
    ctx.fillStyle = skin;
    const raised = prng.chance(0.35);
    ctx.fillRect(x + cell * 0.2, raised ? cell * 0.24 : cell * 0.46, cell * 0.08, cell * 0.26);
    ctx.fillRect(x + cell * 0.72, raised ? cell * 0.24 : cell * 0.46, cell * 0.08, cell * 0.26);
    // 腿
    ctx.fillStyle = "#2A2F3A";
    ctx.fillRect(x + cell * 0.34, cell * 0.84, cell * 0.12, cell * 0.16);
    ctx.fillRect(x + cell * 0.54, cell * 0.84, cell * 0.12, cell * 0.16);
  }
  return canvas;
}

// 足球：白底 + 黑色块面 + 磨损泥点，村里的球都踢得发黄
export function paintBallTexture(canvas, size = 128) {
  const ctx = canvas.getContext("2d");
  const prng = createPrng(hashSeed("ball"));
  ctx.fillStyle = "#F2EFE4";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#23262B";
  const patches = [
    [0.5, 0.18], [0.16, 0.42], [0.84, 0.42], [0.34, 0.72], [0.66, 0.72], [0.5, 0.96],
  ];
  for (const [u, v] of patches) {
    ctx.beginPath();
    const cx = u * size;
    const cy = v * size;
    const r = size * 0.11;
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#8A7448";
  for (let i = 0; i < 260; i += 1) {
    ctx.fillRect(prng.next() * size, prng.next() * size, 3, 3);
  }
  ctx.restore();
  return canvas;
}

// 横幅：写真实地名，例如"榕江县古州 欢迎八方乡亲"
export function paintBannerTexture(canvas, text, colors, width = 512, height = 96) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colors.primary;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = colors.trim;
  ctx.fillRect(0, 0, width, 6);
  ctx.fillRect(0, height - 6, width, 6);
  ctx.fillStyle = colors.number;
  ctx.font = `bold 46px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text).slice(0, 16), width / 2, height / 2 + 2);
  return canvas;
}

export { shade };
