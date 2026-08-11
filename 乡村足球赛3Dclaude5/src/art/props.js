// 地域小品库：鼓楼、风雨桥、吊脚楼、梯田、窑洞、四合院、渔船、蒙古包……
// 每个都是低面数几何体 + 顶点色，全部合批进同一个 mesh。

import * as THREE from "three";

const WOOD = "#6E4A2E";
const DARK_WOOD = "#4A3020";
const TILE = "#3E4148";
const STONE = "#9C978C";
const GREEN = "#3E6B34";
const GREEN_LIGHT = "#5C8A3E";

function palette(culture) {
  return {
    wall: culture.id === "jiangnan" ? "#EDE8DC" : culture.id === "northwest-loess" ? "#C39A63" : culture.id === "plateau" ? "#A79B88" : culture.id === "northeast" ? "#A6503C" : culture.id === "capital-outskirt" ? "#8C8A85" : "#C8B394",
    roof: culture.id === "lingnan" ? "#4A4238" : TILE,
    wood: WOOD,
    darkWood: DARK_WOOD,
    stone: STONE,
    foliage: culture.id === "coastal" ? "#3E7A4A" : culture.id === "northwest-loess" ? "#6E7C3A" : GREEN,
    foliageLight: GREEN_LIGHT,
    soil: culture.ground.soil,
    accent: culture.crowd.palette[0],
  };
}

// ---- 通用件 ----
function roofGable(b, w, d, h, hex, overhang = 0.35) {
  // 用一个压扁的四棱锥当坡屋顶，出檐比墙宽
  b.push(new THREE.Matrix4().makeTranslation(0, h / 2, 0));
  b.addGeometry(new THREE.ConeGeometry((w + overhang) * 0.78, h, 4, 1), hex, 0.05);
  b.pop();
}

function house(b, p, { w = 4, d = 3.4, h = 2.8, wall, roof, roofH = 1.3, stilts = 0, storeys = 1 }) {
  const wallColor = wall || p.wall;
  const roofColor = roof || p.roof;
  if (stilts > 0) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.push(new THREE.Matrix4().makeTranslation((sx * w) / 2.6, stilts / 2, (sz * d) / 2.6));
        b.cyl(0.11, 0.13, stilts, p.darkWood, 6);
        b.pop();
      }
    }
  }
  for (let i = 0; i < storeys; i += 1) {
    b.push(new THREE.Matrix4().makeTranslation(0, stilts + h / 2 + i * h, 0));
    b.box(w, h, d, i % 2 && storeys > 1 ? p.wood : wallColor);
    b.pop();
  }
  b.push(new THREE.Matrix4().makeTranslation(0, stilts + h * storeys, 0));
  roofGable(b, w, d, roofH, roofColor);
  b.pop();
  // 门窗
  b.push(new THREE.Matrix4().makeTranslation(0, stilts + 0.8, d / 2 + 0.02));
  b.box(0.8, 1.6, 0.06, p.darkWood);
  b.pop();
  for (const sx of [-1, 1]) {
    b.push(new THREE.Matrix4().makeTranslation((sx * w) / 3.2, stilts + h * 0.62, d / 2 + 0.02));
    b.box(0.6, 0.55, 0.06, "#5A6B72");
    b.pop();
  }
}

function tree(b, p, { trunkH = 3, trunkR = 0.16, kind = "ball", scale = 1, foliage }) {
  const leaf = foliage || p.foliage;
  b.push(new THREE.Matrix4().makeTranslation(0, (trunkH * scale) / 2, 0));
  b.cyl(trunkR * scale * 0.8, trunkR * scale, trunkH * scale, kind === "birch" ? "#D8D2C0" : p.darkWood, 6);
  b.pop();
  const top = trunkH * scale;
  if (kind === "cone") {
    for (let i = 0; i < 3; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation(0, top + i * 0.9 * scale, 0));
      b.addGeometry(new THREE.ConeGeometry((1.5 - i * 0.35) * scale, 1.9 * scale, 7), leaf, 0.1);
      b.pop();
    }
  } else if (kind === "palm") {
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2;
      const m = new THREE.Matrix4()
        .makeTranslation(Math.sin(a) * 0.9 * scale, top + 0.1 * scale, Math.cos(a) * 0.9 * scale)
        .multiply(new THREE.Matrix4().makeRotationY(-a))
        .multiply(new THREE.Matrix4().makeRotationX(0.5));
      b.push(m);
      b.box(0.28 * scale, 0.08 * scale, 2.1 * scale, leaf);
      b.pop();
    }
  } else if (kind === "column") {
    b.push(new THREE.Matrix4().makeTranslation(0, top + 1.6 * scale, 0));
    b.addGeometry(new THREE.SphereGeometry(0.85 * scale, 7, 6), leaf, 0.12);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, top + 3 * scale, 0));
    b.addGeometry(new THREE.SphereGeometry(0.6 * scale, 7, 6), leaf, 0.12);
    b.pop();
  } else if (kind === "weeping") {
    b.push(new THREE.Matrix4().makeTranslation(0, top + 0.6 * scale, 0));
    b.addGeometry(new THREE.SphereGeometry(1.5 * scale, 8, 6), leaf, 0.12);
    b.pop();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      b.push(new THREE.Matrix4().makeTranslation(Math.sin(a) * 1.3 * scale, top - 0.3 * scale, Math.cos(a) * 1.3 * scale));
      b.box(0.1 * scale, 1.6 * scale, 0.1 * scale, leaf);
      b.pop();
    }
  } else {
    b.push(new THREE.Matrix4().makeTranslation(0, top + 0.9 * scale, 0));
    b.addGeometry(new THREE.SphereGeometry(1.7 * scale, 8, 6), leaf, 0.14);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0.9 * scale, top + 0.2 * scale, 0.4 * scale));
    b.addGeometry(new THREE.SphereGeometry(1.1 * scale, 7, 5), leaf, 0.14);
    b.pop();
  }
}

function terrace(b, p, { rows = 5, width = 16, step = 1.6, rise = 0.55, crop = GREEN_LIGHT }) {
  for (let i = 0; i < rows; i += 1) {
    b.push(new THREE.Matrix4().makeTranslation(0, i * rise, -i * step));
    b.box(width - i * 1.1, rise, step * 0.95, i % 2 ? crop : p.foliage, 0.1);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, i * rise + rise * 0.5, -i * step + step * 0.45));
    b.box(width - i * 1.1, rise * 0.25, 0.16, p.soil);
    b.pop();
  }
}

function fieldPatch(b, p, { w = 10, d = 8, hex, rows = 6 }) {
  for (let i = 0; i < rows; i += 1) {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.12, -d / 2 + (i / rows) * d));
    b.box(w, 0.22 + (i % 2) * 0.06, d / rows * 0.7, hex, 0.12);
    b.pop();
  }
}

function tieredTower(b, p, { levels = 5, baseR = 2.2, levelH = 1.5, roof }) {
  for (let i = 0; i < levels; i += 1) {
    const r = baseR * (1 - i / (levels + 1.5));
    b.push(new THREE.Matrix4().makeTranslation(0, i * levelH + levelH / 2, 0));
    b.cyl(r * 0.86, r, levelH * 0.62, p.wood, 8);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, i * levelH + levelH * 0.9, 0));
    b.addGeometry(new THREE.ConeGeometry(r * 1.5, levelH * 0.6, 8), roof || p.roof, 0.05);
    b.pop();
  }
  b.push(new THREE.Matrix4().makeTranslation(0, levels * levelH + 0.7, 0));
  b.addGeometry(new THREE.ConeGeometry(0.7, 1.6, 8), roof || p.roof, 0.05);
  b.pop();
}

function coveredBridge(b, p, { span = 12, width = 2.6, roofed = true, arch = false }) {
  if (arch) {
    const segments = 7;
    for (let i = 0; i < segments; i += 1) {
      const t = (i + 0.5) / segments;
      const x = (t - 0.5) * span;
      const y = Math.sin(t * Math.PI) * 1.5;
      b.push(new THREE.Matrix4().makeTranslation(x, y * 0.5, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.cos(t * Math.PI) * -0.5)));
      b.box(span / segments + 0.3, 0.34, width, p.stone);
      b.pop();
    }
    return;
  }
  b.push(new THREE.Matrix4().makeTranslation(0, 1.6, 0));
  b.box(span, 0.3, width, p.wood);
  b.pop();
  for (const sx of [-1, 1]) {
    b.push(new THREE.Matrix4().makeTranslation((sx * span) / 2.4, 0.8, 0));
    b.box(1.1, 1.6, width * 1.1, p.stone);
    b.pop();
  }
  if (roofed) {
    const bays = 3;
    for (let i = 0; i < bays; i += 1) {
      const x = (i / (bays - 1) - 0.5) * span * 0.72;
      b.push(new THREE.Matrix4().makeTranslation(x, 3.2, 0));
      b.addGeometry(new THREE.ConeGeometry(width * 1.5, 1.2, 4), p.roof, 0.05);
      b.pop();
      for (const sz of [-1, 1]) {
        b.push(new THREE.Matrix4().makeTranslation(x, 2.35, (sz * width) / 2.4));
        b.cyl(0.09, 0.09, 1.5, p.darkWood, 5);
        b.pop();
      }
    }
  }
}


// ---- 新农村：白墙小楼 + 彩钢瓦顶 + 太阳能热水器 + 水泥路 + 广场设施 ----
// 现在的村子不是清一色土坯房，二层小楼、瓷砖外墙、蓝红铁皮顶才是常见样子。
const NEW_ROOF = ["#4B5B5A", "#785248", "#4D6861", "#536A72"];
const NEW_WALL = ["#F2ECE0", "#E9DFC9", "#E2E8E7", "#F0E4D5"];

function newVillageHouse(b, p, prng, { storeys = 2, w = 5.4, d = 4.4, floorH = 2.9 } = {}) {
  const wall = NEW_WALL[Math.floor(prng.next() * NEW_WALL.length)];
  const roof = NEW_ROOF[Math.floor(prng.next() * NEW_ROOF.length)];
  for (let i = 0; i < storeys; i += 1) {
    b.push(new THREE.Matrix4().makeTranslation(0, floorH / 2 + i * floorH, 0));
    b.box(w, floorH, d, wall, 0.03);
    b.pop();
    // 腰线
    b.push(new THREE.Matrix4().makeTranslation(0, i * floorH + floorH - 0.12, 0));
    b.box(w + 0.12, 0.24, d + 0.12, "#C9BFA8");
    b.pop();
    // 窗
    for (const sx of [-1, 0, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * w * 0.3, i * floorH + floorH * 0.6, d / 2 + 0.025));
      b.box(w * 0.23, floorH * 0.39, 0.055, "#EEE7D8", 0.02);
      b.pop();
      b.push(new THREE.Matrix4().makeTranslation(sx * w * 0.3, i * floorH + floorH * 0.6, d / 2 + 0.04));
      b.box(w * 0.2, floorH * 0.34, 0.08, "#6E93A6");
      b.pop();
    }
  }
  if (storeys > 1) {
    b.push(new THREE.Matrix4().makeTranslation(0, floorH + 0.12, d / 2 + 0.42));
    b.box(w * 0.72, 0.18, 0.86, "#D5C9B0", 0.04);
    b.pop();
    for (const sx of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * w * 0.33, floorH + 0.48, d / 2 + 0.76));
      b.cyl(0.045, 0.05, 0.72, "#687477", 5, 0.02);
      b.pop();
    }
  }
  // 彩钢瓦坡顶
  b.push(new THREE.Matrix4().makeTranslation(0, storeys * floorH + 0.55, 0));
  b.addGeometry(new THREE.ConeGeometry(w * 0.82, 1.1, 4, 1), roof, 0.04);
  b.pop();
  // 太阳能热水器：一个横罐 + 一排真空管
  b.push(new THREE.Matrix4().makeTranslation(w * 0.12, storeys * floorH + 1.15, -d * 0.15).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  b.cyl(0.24, 0.24, 1.9, "#D8DCE0", 8);
  b.pop();
  for (let i = 0; i < 7; i += 1) {
    b.push(new THREE.Matrix4().makeTranslation(w * 0.12 - 0.75 + i * 0.25, storeys * floorH + 0.95, d * 0.12).multiply(new THREE.Matrix4().makeRotationX(0.5)));
    b.cyl(0.055, 0.055, 1.3, "#2A3A4A", 5);
    b.pop();
  }
  // 大门与门前台阶
  b.push(new THREE.Matrix4().makeTranslation(0, 1.05, d / 2 + 0.05));
  b.box(1.3, 2.1, 0.1, "#7A4A2C");
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(0, 0.09, d / 2 + 0.5));
  b.box(2.2, 0.18, 0.9, "#C4C0B4");
  b.pop();
  // 院墙
  if (prng.chance(0.55)) {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.55, d / 2 + 3.2));
    b.box(w + 1.6, 1.1, 0.22, "#E4DCC8");
    b.pop();
    for (const sx of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation((sx * (w + 1.6)) / 2, 0.75, d / 2 + 1.7));
      b.box(0.3, 1.5, 3.2, "#E4DCC8");
      b.pop();
    }
  }
}

function solarLamp(b, p) {
  b.push(new THREE.Matrix4().makeTranslation(0, 2.6, 0));
  b.cyl(0.07, 0.1, 5.2, "#9AA0A6", 6);
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(0.3, 5.3, 0).multiply(new THREE.Matrix4().makeRotationZ(-0.35)));
  b.box(0.9, 0.06, 0.6, "#22304A");
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(-0.35, 5.1, 0));
  b.box(0.5, 0.16, 0.24, "#F2E8C8");
  b.pop();
}

function basketballHoop(b, p) {
  b.push(new THREE.Matrix4().makeTranslation(0, 1.7, 0));
  b.cyl(0.09, 0.12, 3.4, "#6E7278", 6);
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(0, 3.5, 0.35));
  b.box(1.8, 1.1, 0.1, "#F2EFE4");
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(0, 3.15, 0.62));
  b.cyl(0.28, 0.28, 0.06, "#C0392B", 10);
  b.pop();
}

function noticeBoard(b, p) {
  for (const sx of [-1, 1]) {
    b.push(new THREE.Matrix4().makeTranslation(sx * 1.5, 0.9, 0));
    b.box(0.18, 1.8, 0.18, "#9AA0A6");
    b.pop();
  }
  b.push(new THREE.Matrix4().makeTranslation(0, 2.1, 0));
  b.box(3.4, 1.9, 0.16, "#C0392B");
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(0, 2.1, 0.1));
  b.box(3.05, 1.55, 0.06, "#F2EFE4");
  b.pop();
}

function fitnessCorner(b, p, prng) {
  b.push(new THREE.Matrix4().makeTranslation(0, 0.05, 0));
  b.box(6, 0.1, 4, "#B7A98C");
  b.pop();
  for (const sx of [-1, 1]) {
    b.push(new THREE.Matrix4().makeTranslation(sx * 1.6, 0.8, 0));
    b.cyl(0.08, 0.09, 1.6, "#E8B11B", 6);
    b.pop();
  }
  b.push(new THREE.Matrix4().makeTranslation(0, 1.55, 0));
  b.box(3.4, 0.1, 0.1, "#E8B11B");
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(2.2, 0.55, 1.1));
  b.box(0.9, 1.1, 0.5, "#2E7350");
  b.pop();
}

function waterTower(b, p) {
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.push(new THREE.Matrix4().makeTranslation(Math.sin(a) * 0.9, 2.4, Math.cos(a) * 0.9));
    b.cyl(0.09, 0.12, 4.8, "#8E9298", 5);
    b.pop();
  }
  b.push(new THREE.Matrix4().makeTranslation(0, 5.4, 0));
  b.cyl(1.3, 1.5, 1.6, "#DCE0E4", 10);
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(0, 6.4, 0));
  b.addGeometry(new THREE.ConeGeometry(1.6, 0.7, 10), "#2E5E8A", 0.04);
  b.pop();
}

function villageServiceCenter(b, p, prng) {
  newVillageHouse(b, p, prng, { storeys: 2, w: 8.4, d: 5.2, floorH: 2.8 });
  // 无文字的公共服务入口与遮雨檐，避免出现敏感标牌。
  b.push(new THREE.Matrix4().makeTranslation(0, 2.35, 3.1));
  b.box(5.8, 0.2, 1.7, "#506B70", 0.03);
  b.pop();
  for (const sx of [-1, 1]) {
    b.push(new THREE.Matrix4().makeTranslation(sx * 2.35, 1.15, 3.1));
    b.cyl(0.08, 0.1, 2.3, "#737C7E", 6, 0.02);
    b.pop();
  }
  b.push(new THREE.Matrix4().makeTranslation(0, 1.15, 2.66));
  b.box(2.3, 2.2, 0.1, "#496C78", 0.02);
  b.pop();
}

function marketStall(b, p, prng) {
  const awnings = ["#B94A3E", "#3F7187", "#D8AA43", "#4F7A57"];
  const awning = awnings[Math.floor(prng.next() * awnings.length)];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * 1.45, 1.25, sz * 0.9));
      b.cyl(0.045, 0.055, 2.5, "#6C6557", 5, 0.02);
      b.pop();
    }
  }
  b.push(new THREE.Matrix4().makeTranslation(0, 2.55, 0));
  b.box(3.3, 0.16, 2.15, awning, 0.08);
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(0, 0.74, 0.15));
  b.box(3, 0.72, 1.15, "#A97949", 0.08);
  b.pop();
  for (let i = 0; i < 7; i += 1) {
    const x = -1.15 + (i % 4) * 0.76;
    const z = -0.18 + Math.floor(i / 4) * 0.48;
    b.push(new THREE.Matrix4().makeTranslation(x, 1.18, z));
    b.sphere(0.18 + prng.next() * 0.08, i % 3 === 0 ? "#D79C36" : i % 3 === 1 ? "#6F9343" : "#B14A38", 6, 0.08);
    b.pop();
  }
}

function farmTricycle(b, p) {
  b.push(new THREE.Matrix4().makeTranslation(0, 0.62, 0));
  b.box(2.5, 0.9, 1.45, "#3F785F", 0.08);
  b.pop();
  b.push(new THREE.Matrix4().makeTranslation(1.55, 0.75, 0));
  b.box(0.95, 1.15, 1.1, "#467B88", 0.07);
  b.pop();
  for (const [x, z] of [[-0.9, -0.78], [-0.9, 0.78], [1.7, 0]]) {
    b.push(new THREE.Matrix4().makeTranslation(x, 0.33, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    b.cyl(0.34, 0.34, 0.18, "#292B29", 10, 0.04);
    b.pop();
  }
}

const BUILDERS = {
  "drum-tower": (b, p) => tieredTower(b, p, { levels: 6, baseR: 2.4, levelH: 1.4, roof: "#4A4A4E" }),
  "wind-rain-bridge": (b, p) => coveredBridge(b, p, { span: 13, roofed: true }),
  "stone-arch-bridge": (b, p) => coveredBridge(b, p, { span: 9, width: 2.2, arch: true }),
  "stilt-house": (b, p) => house(b, p, { w: 4.6, d: 3.6, h: 2.6, stilts: 1.5, storeys: 2, wall: p.wood, roof: "#4A4A4E" }),
  "white-wall-house": (b, p) => house(b, p, { w: 5, d: 3.8, h: 3.4, wall: "#EFEAE0", roof: "#3A3D42" }),
  "wok-ear-house": (b, p) => {
    house(b, p, { w: 5, d: 3.6, h: 3, wall: "#D8C9AC", roof: "#4A4238" });
    for (const sx of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * 2.4, 3.6, 0));
      b.cyl(0.9, 0.9, 0.28, "#4A4238", 10);
      b.pop();
    }
  },
  "red-brick-house": (b, p) => house(b, p, { w: 5, d: 3.8, h: 2.8, wall: "#A6503C", roof: "#5A5348" }),
  "grey-courtyard": (b, p) => {
    house(b, p, { w: 6, d: 3.4, h: 2.7, wall: "#8C8A85", roof: "#4A4C50" });
    b.push(new THREE.Matrix4().makeTranslation(0, 0.9, 3.4));
    b.box(6.4, 1.8, 0.3, "#8C8A85");
    b.pop();
  },
  "brick-courtyard": (b, p) => {
    house(b, p, { w: 5.4, d: 3.6, h: 2.7, wall: "#B08363", roof: "#5A544A" });
    b.push(new THREE.Matrix4().makeTranslation(0, 0.7, 3.2));
    b.box(6, 1.4, 0.28, "#A88358");
    b.pop();
  },
  "arcade-shop": (b, p) => {
    house(b, p, { w: 6, d: 3.2, h: 3.4, storeys: 2, wall: "#D9CBA8", roof: "#4A4238" });
    for (let i = -2; i <= 2; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation(i * 1.2, 1.4, 1.9));
      b.cyl(0.13, 0.15, 2.8, "#C4B08C", 6);
      b.pop();
    }
  },
  "ancestral-hall": (b, p) => {
    house(b, p, { w: 7, d: 4.2, h: 3.2, wall: "#CBB89A", roof: "#3E3A34", roofH: 1.8 });
    b.push(new THREE.Matrix4().makeTranslation(0, 3.6, 2.3));
    b.box(2.4, 0.5, 0.16, p.accent);
    b.pop();
  },
  "cave-dwelling": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 1.8, 0));
    b.box(9, 3.6, 4, "#C39A63");
    b.pop();
    for (let i = -1; i <= 1; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation(i * 2.6, 1.1, 2.05));
      b.addGeometry(new THREE.CylinderGeometry(0.85, 0.85, 0.3, 10, 1, false, 0, Math.PI), "#5B4530", 0.04);
      b.pop();
      b.push(new THREE.Matrix4().makeTranslation(i * 2.6, 0.55, 2.05));
      b.box(1.7, 1.1, 0.24, "#5B4530");
      b.pop();
    }
  },
  "loess-ridge": (b, p) => terrace(b, p, { rows: 4, width: 20, step: 2.6, rise: 0.9, crop: "#B08A52" }),
  "terrace-field": (b, p) => terrace(b, p, { rows: 6, width: 18, step: 2.2, rise: 0.6 }),
  "rice-terrace": (b, p) => terrace(b, p, { rows: 5, width: 16, step: 2, rise: 0.5, crop: "#7FA84A" }),
  "tea-terrace": (b, p) => terrace(b, p, { rows: 5, width: 14, step: 1.7, rise: 0.45, crop: "#3E7A44" }),
  "barley-field": (b, p) => fieldPatch(b, p, { w: 12, d: 9, hex: "#C8B15C", rows: 7 }),
  "rape-flower-field": (b, p) => fieldPatch(b, p, { w: 13, d: 9, hex: "#E8C43A", rows: 7 }),
  "grain-drying-yard": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.06, 0));
    b.box(11, 0.12, 8, "#CFC3A4");
    b.pop();
    for (let i = 0; i < 4; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation(-3.5 + i * 2.4, 0.35, 1.4));
      b.box(1.8, 0.4, 2.6, "#D8B25C", 0.1);
      b.pop();
    }
  },
  "lotus-pond": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.04, 0));
    b.box(12, 0.08, 8, "#4E6E72");
    b.pop();
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      b.push(new THREE.Matrix4().makeTranslation(Math.sin(a) * 3.6, 0.14, Math.cos(a) * 2.4));
      b.cyl(0.6, 0.6, 0.06, "#4E8A46", 7);
      b.pop();
    }
  },
  "grape-trellis": (b, p) => {
    for (let i = -2; i <= 2; i += 1) {
      for (const sz of [-1, 1]) {
        b.push(new THREE.Matrix4().makeTranslation(i * 2, 1.05, sz * 1.6));
        b.cyl(0.08, 0.1, 2.1, p.darkWood, 5);
        b.pop();
      }
    }
    b.push(new THREE.Matrix4().makeTranslation(0, 2.2, 0));
    b.box(9.4, 0.3, 3.6, "#4E7A38", 0.14);
    b.pop();
  },
  "fir-forest": (b, p, prng) => {
    for (let i = 0; i < 7; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation((prng.next() - 0.5) * 12, 0, (prng.next() - 0.5) * 7));
      tree(b, p, { kind: "cone", trunkH: 2.4 + prng.next() * 1.6, scale: 0.9 + prng.next() * 0.5 });
      b.pop();
    }
  },
  "poplar-row": (b, p, prng) => {
    for (let i = 0; i < 6; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation(-7 + i * 2.8, 0, (prng.next() - 0.5) * 1.2));
      tree(b, p, { kind: "column", trunkH: 4.4 + prng.next(), trunkR: 0.14, scale: 0.9 });
      b.pop();
    }
  },
  "birch-row": (b, p, prng) => {
    for (let i = 0; i < 6; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation(-7 + i * 2.6, 0, (prng.next() - 0.5) * 1.6));
      tree(b, p, { kind: "birch", trunkH: 4 + prng.next(), trunkR: 0.13, scale: 0.9, foliage: "#7FA046" });
      b.pop();
    }
  },
  willow: (b, p) => tree(b, p, { kind: "weeping", trunkH: 3, scale: 1.1, foliage: "#6E9A4A" }),
  "banyan-tree": (b, p) => {
    tree(b, p, { kind: "ball", trunkH: 2.6, trunkR: 0.4, scale: 1.5 });
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      b.push(new THREE.Matrix4().makeTranslation(Math.sin(a) * 1.5, 1.1, Math.cos(a) * 1.5));
      b.cyl(0.08, 0.12, 2.2, p.darkWood, 5);
      b.pop();
    }
  },
  "scholar-tree": (b, p) => tree(b, p, { kind: "ball", trunkH: 3.4, trunkR: 0.28, scale: 1.2 }),
  "lychee-grove": (b, p, prng) => {
    for (let i = 0; i < 5; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation((prng.next() - 0.5) * 10, 0, (prng.next() - 0.5) * 6));
      tree(b, p, { kind: "ball", trunkH: 2, scale: 0.85, foliage: "#2E6B32" });
      b.pop();
    }
  },
  "banana-grove": (b, p, prng) => {
    for (let i = 0; i < 6; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation((prng.next() - 0.5) * 9, 0, (prng.next() - 0.5) * 5));
      tree(b, p, { kind: "palm", trunkH: 2.2, scale: 0.8, foliage: "#4E8A3A" });
      b.pop();
    }
  },
  "coconut-palm": (b, p) => tree(b, p, { kind: "palm", trunkH: 5.4, trunkR: 0.16, scale: 1 }),
  "wheat-stack": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 1.1, 0));
    b.addGeometry(new THREE.ConeGeometry(1.5, 2.2, 9), "#D8B25C", 0.1);
    b.pop();
  },
  haystack: (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.9, 0));
    b.addGeometry(new THREE.CylinderGeometry(1.2, 1.4, 1.8, 9), "#C8A85C", 0.1);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 2.1, 0));
    b.addGeometry(new THREE.ConeGeometry(1.5, 0.9, 9), "#B8964C", 0.1);
    b.pop();
  },
  "corn-rack": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 1.3, 0));
    b.box(3.4, 2.2, 1, "#D8A83C", 0.16);
    b.pop();
    for (const sx of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * 1.8, 1.2, 0));
      b.cyl(0.09, 0.11, 2.6, p.darkWood, 5);
      b.pop();
    }
  },
  "grain-barn": (b, p) => house(b, p, { w: 4.4, d: 3, h: 3, wall: "#B4753C", roof: "#5A5348", roofH: 1 }),
  tractor: (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.85, 0));
    b.box(2.6, 0.9, 1.3, "#B8402E");
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(-0.6, 1.6, 0));
    b.box(1, 0.9, 1.1, "#2E3A44");
    b.pop();
    for (const [sx, r] of [[-1, 0.75], [1, 0.45]]) {
      for (const sz of [-1, 1]) {
        b.push(new THREE.Matrix4().makeTranslation(sx * 0.95, r, sz * 0.72).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
        b.cyl(r, r, 0.3, "#22242A", 10);
        b.pop();
      }
    }
  },
  "well-head": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.4, 0));
    b.cyl(0.7, 0.75, 0.8, p.stone, 10);
    b.pop();
    for (const sx of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * 0.7, 1.2, 0));
      b.cyl(0.07, 0.07, 1.6, p.darkWood, 5);
      b.pop();
    }
    b.push(new THREE.Matrix4().makeTranslation(0, 2, 0));
    b.box(1.8, 0.12, 0.16, p.darkWood);
    b.pop();
  },
  "clay-jar": (b, p, prng) => {
    for (let i = 0; i < 4; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation((prng.next() - 0.5) * 2.4, 0.4, (prng.next() - 0.5) * 1.6));
      b.addGeometry(new THREE.SphereGeometry(0.42, 8, 6), "#6B4A32", 0.08);
      b.pop();
    }
  },
  "bamboo-fence": (b, p) => {
    for (let i = 0; i < 14; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation(-6.5 + i, 0.55, 0));
      b.cyl(0.05, 0.06, 1.1, "#9BA85C", 5);
      b.pop();
    }
    b.push(new THREE.Matrix4().makeTranslation(0, 0.85, 0));
    b.box(14, 0.07, 0.07, "#8A9A50");
    b.pop();
  },
  sheepfold: (b, p, prng) => {
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      b.push(new THREE.Matrix4().makeTranslation(Math.sin(a) * 3, 0.5, Math.cos(a) * 2.2));
      b.cyl(0.07, 0.08, 1, p.darkWood, 4);
      b.pop();
    }
    for (let i = 0; i < 4; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation((prng.next() - 0.5) * 4, 0.42, (prng.next() - 0.5) * 3));
      b.box(0.8, 0.5, 0.4, "#E4DDCE");
      b.pop();
    }
  },
  yak: (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 1.05, 0));
    b.box(2, 0.95, 0.9, "#3A322C");
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(1.05, 1.25, 0));
    b.box(0.65, 0.6, 0.6, "#2E2823");
    b.pop();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.push(new THREE.Matrix4().makeTranslation(sx * 0.7, 0.3, sz * 0.32));
        b.cyl(0.1, 0.11, 0.62, "#2A2420", 5);
        b.pop();
      }
    }
  },
  "stone-house": (b, p) => house(b, p, { w: 4.4, d: 3.4, h: 2.8, wall: "#A79B88", roof: "#7A6E5C", roofH: 0.6 }),
  "stone-cairn": (b, p, prng) => {
    let y = 0;
    for (let i = 0; i < 6; i += 1) {
      const r = 0.7 - i * 0.09;
      b.push(new THREE.Matrix4().makeTranslation((prng.next() - 0.5) * 0.15, y + r * 0.5, (prng.next() - 0.5) * 0.15));
      b.addGeometry(new THREE.SphereGeometry(r, 6, 4), p.stone, 0.14);
      b.pop();
      y += r * 0.85;
    }
  },
  "prayer-wall": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.75, 0));
    b.box(7, 1.5, 0.9, "#B4A894", 0.1);
    b.pop();
  },
  "colour-banner-line": (b, p) => {
    for (const sx of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * 5, 1.7, 0));
      b.cyl(0.07, 0.09, 3.4, p.darkWood, 5);
      b.pop();
    }
    const colors = ["#C0392B", "#2E86C1", "#F1C40F", "#27AE60", "#F5F0E1"];
    for (let i = 0; i < 12; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation(-4.6 + i * 0.85, 2.75, 0));
      b.box(0.5, 0.66, 0.03, colors[i % colors.length]);
      b.pop();
    }
  },
  yurt: (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.85, 0));
    b.cyl(2.1, 2.1, 1.7, "#EFEAE0", 12);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 2.2, 0));
    b.addGeometry(new THREE.ConeGeometry(2.3, 1.1, 12), "#E4DDCE", 0.05);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 0.8, 2.1));
    b.box(0.9, 1.5, 0.1, "#B8402E");
    b.pop();
  },
  "horse-post": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 1.1, 0));
    b.cyl(0.11, 0.14, 2.2, p.darkWood, 6);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 2.1, 0));
    b.box(1.4, 0.12, 0.12, p.darkWood);
    b.pop();
  },
  windmill: (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 2.4, 0));
    b.cyl(0.35, 0.7, 4.8, "#CFC3A4", 8);
    b.pop();
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2;
      b.push(new THREE.Matrix4().makeTranslation(0, 5, 0.3).multiply(new THREE.Matrix4().makeRotationZ(a)));
      b.box(0.28, 3.4, 0.08, "#E4DDCE");
      b.pop();
    }
  },
  lighthouse: (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 3, 0));
    b.cyl(0.9, 1.5, 6, "#F2EFE4", 10);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 4.4, 0));
    b.cyl(1, 1, 0.9, "#C0392B", 10);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 6.4, 0));
    b.cyl(0.7, 0.8, 0.9, "#7FA0B4", 8);
    b.pop();
  },
  "fishing-boat": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.45, 0));
    b.box(5.4, 0.7, 1.5, "#4A6E7A");
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0.6, 1.1, 0));
    b.addGeometry(new THREE.CylinderGeometry(0.85, 0.85, 1.9, 8, 1, false, 0, Math.PI), "#C8BFA6", 0.05);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(-2, 1.8, 0));
    b.cyl(0.06, 0.08, 3, p.darkWood, 5);
    b.pop();
  },
  "dragon-boat": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.4, 0));
    b.box(7, 0.6, 1.1, "#B8402E");
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(3.4, 1, 0));
    b.box(0.9, 1, 0.5, "#E8B11B");
    b.pop();
  },
  "wu-peng-boat": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.35, 0));
    b.box(4.6, 0.55, 1.3, "#5A4634");
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0.2, 0.95, 0));
    b.addGeometry(new THREE.CylinderGeometry(0.72, 0.72, 2.2, 8, 1, false, 0, Math.PI), "#2E2A26", 0.05);
    b.pop();
  },
  "net-rack": (b, p) => {
    for (const sx of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * 2.2, 1.2, 0));
      b.cyl(0.08, 0.1, 2.4, p.darkWood, 5);
      b.pop();
    }
    b.push(new THREE.Matrix4().makeTranslation(0, 2.3, 0));
    b.box(4.8, 0.1, 0.1, p.darkWood);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 1.5, 0));
    b.box(4.4, 1.5, 0.06, "#8C8F7A", 0.2);
    b.pop();
  },
  "stone-fish-house": (b, p) => house(b, p, { w: 4.2, d: 3.2, h: 2.6, wall: "#B4998A", roof: "#8A7A66", roofH: 0.7 }),
  "shell-wall": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.6, 0));
    b.box(7, 1.2, 0.4, "#D8CCB4", 0.16);
    b.pop();
  },
  "canal-dock": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.25, 0));
    b.box(5, 0.5, 2.4, p.stone);
    b.pop();
    for (let i = 0; i < 4; i += 1) {
      b.push(new THREE.Matrix4().makeTranslation(-1.8 + i * 1.2, 0.6, 1.4));
      b.box(1.1, 0.2, 0.6, p.stone);
      b.pop();
    }
  },
  "screen-wall": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 1.1, 0));
    b.box(4.4, 2.2, 0.35, "#9A8F82");
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 2.35, 0));
    b.addGeometry(new THREE.ConeGeometry(2.8, 0.5, 4), "#4A4C50", 0.05);
    b.pop();
  },
  "stone-drum": (b, p) => {
    for (const sx of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * 1.2, 0.45, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
      b.cyl(0.45, 0.45, 0.3, p.stone, 10);
      b.pop();
    }
  },
  "bicycle-shed": (b, p) => {
    for (const sx of [-1, 1]) {
      b.push(new THREE.Matrix4().makeTranslation(sx * 2, 1, 0));
      b.cyl(0.08, 0.08, 2, "#6E7278", 5);
      b.pop();
    }
    b.push(new THREE.Matrix4().makeTranslation(0, 2.1, 0));
    b.box(4.6, 0.12, 2, "#4A6E7A");
    b.pop();
  },
  "lamp-post": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 2.4, 0));
    b.cyl(0.08, 0.12, 4.8, "#5A5E62", 6);
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 4.9, 0));
    b.box(0.5, 0.3, 0.5, "#F2E8C8");
    b.pop();
  },
  chimney: (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 3, 0));
    b.cyl(0.5, 0.75, 6, "#A6503C", 8);
    b.pop();
  },
  "waist-drum-stage": (b, p) => {
    b.push(new THREE.Matrix4().makeTranslation(0, 0.35, 0));
    b.box(6, 0.7, 4, "#B4753C");
    b.pop();
    b.push(new THREE.Matrix4().makeTranslation(0, 1.4, -1.8));
    b.box(6, 1.4, 0.2, "#C0392B");
    b.pop();
  },
  "new-village-house": (b, p, prng) => newVillageHouse(b, p, prng, { storeys: 2 }),
  "new-village-block": (b, p, prng) => newVillageHouse(b, p, prng, { storeys: 3, w: 6.4, d: 4.8 }),
  "village-service-center": villageServiceCenter,
  "market-stall": marketStall,
  "farm-tricycle": farmTricycle,
  "solar-lamp": solarLamp,
  "basketball-hoop": basketballHoop,
  "notice-board": noticeBoard,
  "fitness-corner": fitnessCorner,
  "water-tower": waterTower,
  "banner-arch": () => {},
};

const ALIASES = {
  "birch-row": "birch-row",
  "sea-wall": "shell-wall",
};

export function propPalette(culture) {
  return palette(culture);
}

export function buildProp(builder, id, culture, prng) {
  const p = palette(culture);
  const fn = BUILDERS[ALIASES[id] || id];
  if (!fn) return false;
  fn(builder, p, prng);
  return true;
}

export function knownProps() {
  return Object.keys(BUILDERS);
}
