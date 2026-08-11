// 球场与村庄环境：维护草坪、窄红跑道、村镇看台、观众、集市、村居与农田。
// 除观众、球网和横幅外全部合批到 1~2 个 drawcall。

import * as THREE from "three";
import { GeoBuilder } from "./geo.js";
import { buildProp, propPalette } from "./props.js";
import { paintBannerTexture, paintCrowdTexture, paintNetTexture } from "./textures.js";
import { paintRuralGroundTexture, paintVenuePitchTexture, venueTextureBudget } from "./environment-textures.js";
import { createPrng, hashSeed } from "../core/prng.js";

function makeTexture(canvas, { repeat = null, filter = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = filter ? THREE.LinearFilter : THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }
  return texture;
}

function addKarstMountain(builder, x, z, height, radius, hex, rotation = 0) {
  const segments = [
    { y: height * 0.18, rx: radius, ry: height * 0.24, rz: radius * 0.82 },
    { y: height * 0.44, rx: radius * 0.66, ry: height * 0.28, rz: radius * 0.6 },
    { y: height * 0.69, rx: radius * 0.36, ry: height * 0.22, rz: radius * 0.36 },
    { y: height * 0.87, rx: radius * 0.18, ry: height * 0.12, rz: radius * 0.2 },
  ];
  for (const segment of segments) {
    const matrix = new THREE.Matrix4()
      .makeTranslation(x, segment.y, z)
      .multiply(new THREE.Matrix4().makeRotationY(rotation))
      .multiply(new THREE.Matrix4().makeScale(segment.rx, segment.ry, segment.rz));
    builder.push(matrix);
    builder.addGeometry(new THREE.SphereGeometry(1, 9, 7), hex, 0.13);
    builder.pop();
  }
}

// 一座有顶主看台 + 两段开放台阶 + 四根灯杆，规模属于村镇公共球场。
// 所有构件进入静态环境合批，不增加场景 drawcall。
function buildCommunityVenue(builder, { format, halfL, halfW, fenceZ, quality, p }) {
  const concrete = "#A7A69E";
  const concreteLight = "#C5C1B5";
  const steel = "#596467";
  const roof = "#587174";
  const mainWidth = Math.min(23, format.pitch.length * 0.44);
  const mainZ = -(fenceZ + 1.05);
  const rows = quality === "low" ? 2 : 3;

  for (let row = 0; row < rows; row += 1) {
    const height = 0.45 + row * 0.8;
    builder.at(0, height / 2, mainZ - row * 1.3);
    builder.box(mainWidth, height, 1.34, row % 2 ? concrete : concreteLight, 0.04);
    builder.pop();
  }

  // 主看台轻型顶棚与立柱。
  const roofZ = mainZ - (rows - 1) * 0.65;
  for (const x of [-mainWidth * 0.46, -mainWidth * 0.16, mainWidth * 0.16, mainWidth * 0.46]) {
    builder.at(x, 2.45, roofZ - 1.4);
    builder.cyl(0.07, 0.09, 4.9, steel, 6, 0.02);
    builder.pop();
  }
  builder.at(0, 4.92, roofZ - 0.15, 0, 1);
  builder.box(mainWidth + 1.4, 0.22, 5.6, roof, 0.06);
  builder.pop();
  builder.at(0, 4.72, roofZ + 2.55);
  builder.box(mainWidth + 1.1, 0.24, 0.18, "#D5C7A9", 0.02);
  builder.pop();
  const festivalColors = ["#B94A3E", "#D8AA43", "#3F7187", "#4F7A57"];
  for (let i = 0; i < 13; i += 1) {
    const x = -mainWidth * 0.44 + (i / 12) * mainWidth * 0.88;
    builder.at(x, 4.43 - (i % 2) * 0.08, roofZ + 2.7);
    builder.box(0.58, 0.34, 0.05, festivalColors[i % festivalColors.length], 0.04);
    builder.pop();
  }

  // 主看台两侧低矮开放台阶，保留乡亲围场的亲密尺度。
  const sideWidth = Math.max(7, (format.pitch.length - mainWidth - 9) / 2);
  for (const sx of [-1, 1]) {
    const x = sx * (mainWidth / 2 + sideWidth / 2 + 1.5);
    for (let row = 0; row < 2; row += 1) {
      const height = 0.38 + row * 0.58;
      builder.at(x, height / 2, mainZ - row * 1.15);
      builder.box(sideWidth, height, 1.2, row ? concrete : concreteLight, 0.04);
      builder.pop();
    }
  }

  // 四根实用灯杆；灯盘不做职业体育场的巨型阵列。
  const lampX = halfL - Math.min(6.5, halfL * 0.2);
  const lampZ = halfW + 7.2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      builder.at(sx * lampX, 5.6, sz * lampZ);
      builder.cyl(0.11, 0.18, 11.2, steel, 8, 0.03);
      builder.pop();
      builder.at(sx * lampX, 11.15, sz * lampZ);
      builder.box(3.1, 0.16, 0.22, steel, 0.02);
      builder.pop();
      for (let i = -1; i <= 1; i += 1) {
        builder.at(sx * lampX + i * 0.95, 11.35, sz * lampZ);
        builder.box(0.66, 0.48, 0.26, "#F5E4B8", 0.025);
        builder.pop();
      }
    }
  }

  // 替补棚与简易直播台贴近近侧边线，形成真实赛事组织感。
  for (const sx of [-1, 1]) {
    builder.at(sx * 11, 0.34, halfW + 3.65);
    builder.box(7.2, 0.22, 1.6, "#708A8B", 0.04);
    builder.pop();
    builder.at(sx * 11, 1.32, halfW + 4.15);
    builder.box(7.4, 0.18, 2.5, sx > 0 ? "#486F86" : "#8D443B", 0.05);
    builder.pop();
    for (const px of [-3.2, 3.2]) {
      builder.at(sx * 11 + px, 0.75, halfW + 4.15);
      builder.cyl(0.055, 0.065, 1.5, steel, 5, 0.02);
      builder.pop();
    }
  }
  if (quality !== "low") {
    builder.at(halfL * 0.62, 0.48, fenceZ + 1.1);
    builder.box(3.2, 0.72, 2.2, p.darkWood, 0.06);
    builder.pop();
    builder.at(halfL * 0.62, 1.15, fenceZ + 0.35);
    builder.cyl(0.16, 0.2, 1.05, steel, 7, 0.03);
    builder.pop();
  }
}

export function buildStadium({ format, culture, team, rivalTeam, createCanvas, quality = "high" }) {
  const group = new THREE.Group();
  group.name = "stadium";
  const prng = createPrng(hashSeed(`stadium:${team.id}:${culture.id}`));
  const disposables = [];
  const halfL = format.pitch.length / 2;
  const halfW = format.pitch.width / 2;

  // ---------------- 草皮 ----------------
  // 高档保留近景草理，低档稳定控制启动峰值。
  const textureBudget = venueTextureBudget(quality);
  const pitchSize = textureBudget.pitch;
  const pitchCanvas = createCanvas(pitchSize, pitchSize);
  const { worldW, worldH } = paintVenuePitchTexture(pitchCanvas, culture, format, pitchSize, 5.5);
  const pitchTexture = makeTexture(pitchCanvas);
  disposables.push(pitchTexture);
  const pitchMat = new THREE.MeshPhongMaterial({ map: pitchTexture, shininess: 4, specular: 0x141810 });
  const pitchMesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldW), pitchMat);
  pitchMesh.rotation.x = -Math.PI / 2;
  // 必须高于场外土地的顶面（土地盒顶在 y=0.005），否则草皮会被土色盖住
  pitchMesh.position.y = 0.02;
  pitchMesh.receiveShadow = true;
  group.add(pitchMesh);

  // ---------------- 场外地面与远山 ----------------
  // 田块、灌渠、菜地和水泥村路共同构成当代乡村底盘。
  const groundCanvas = createCanvas(textureBudget.ground, textureBudget.ground);
  paintRuralGroundTexture(groundCanvas, culture, textureBudget.ground);
  const groundTexture = makeTexture(groundCanvas, { repeat: [2, 2] });
  disposables.push(groundTexture);
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ map: groundTexture }),
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.04;
  group.add(groundMesh);

  const env = new GeoBuilder();
  const p = propPalette(culture);
  // 场地外一圈暖灰色基层，顶面压在草皮和跑道之下。
  env.at(0, -0.005, 0);
  env.box(worldW + 13, 0.02, worldH + 12, "#9A927E", 0.08);
  env.pop();

  // 窄红跑道：四段合成一圈，不做县城职业体育场的八道大跑道。
  const track = "#A84236";
  const trackEdge = "#D9C7B0";
  const trackOffset = 2.25;
  const trackWidth = 3.2;
  for (const sz of [-1, 1]) {
    env.at(0, 0.035, sz * (halfW + trackOffset));
    env.box(format.pitch.length + 8.8, 0.07, trackWidth, track, 0.08);
    env.pop();
    env.at(0, 0.075, sz * (halfW + trackOffset));
    env.box(format.pitch.length + 8.8, 0.018, 0.055, trackEdge, 0);
    env.pop();
  }
  for (const sx of [-1, 1]) {
    env.at(sx * (halfL + trackOffset), 0.035, 0);
    env.box(trackWidth, 0.07, format.pitch.width + 8.8, track, 0.08);
    env.pop();
  }

  const hills = culture.terrain.hills;
  if (hills > 0.05) {
    const ringCount = quality === "low" ? 8 : 16;
    for (let i = 0; i < ringCount; i += 1) {
      const a = (i / ringCount) * Math.PI * 2 + prng.next() * 0.2;
      const dist = 95 + prng.next() * 55;
      const h = (14 + prng.next() * 32) * hills;
      const mountainColor = i % 3 === 0 ? "#496451" : i % 3 === 1 ? "#58725B" : "#3F5A4B";
      addKarstMountain(
        env,
        Math.sin(a) * dist,
        Math.cos(a) * dist,
        h,
        7 + prng.next() * 9,
        culture.terrain.snowPeak && h > 28 ? "#E8EEF2" : mountainColor,
        prng.next() * Math.PI,
      );
    }
  }
  if (culture.terrain.water === "sea") {
    env.at(0, 0.06, -120);
    env.box(320, 0.06, 130, "#3E7E96", 0.05);
    env.pop();
  } else if (culture.terrain.water === "canal" || culture.terrain.water === "stream") {
    env.at(0, 0.06, -halfW - 26, 0.08);
    env.box(200, 0.06, 9, "#4E7E86", 0.05);
    env.pop();
  } else if (culture.terrain.water === "pond") {
    env.at(-halfL - 26, 0.06, halfW + 20);
    env.box(26, 0.06, 18, "#4E7E86", 0.05);
    env.pop();
  }

  // ---------------- 球门与角旗 ----------------
  const goalW = format.goal.width;
  const goalH = format.goal.height;
  const postR = 0.07;
  for (const sign of [-1, 1]) {
    const x = sign * halfL;
    for (const zSign of [-1, 1]) {
      env.at(x, goalH / 2, (zSign * goalW) / 2);
      env.cyl(postR, postR, goalH, "#F4F2EA", 6, 0);
      env.pop();
    }
    env.push(new THREE.Matrix4().makeTranslation(x, goalH, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    env.cyl(postR, postR, goalW, "#F4F2EA", 6, 0);
    env.pop();
    // 后支撑杆
    for (const zSign of [-1, 1]) {
      env.push(new THREE.Matrix4().makeTranslation(x + sign * 0.9, goalH * 0.45, (zSign * goalW) / 2).multiply(new THREE.Matrix4().makeRotationX(0.5)));
      env.cyl(0.05, 0.05, goalH * 1.15, "#E8E4D8", 5, 0);
      env.pop();
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      env.at(sx * halfL, 0.75, sz * halfW);
      env.cyl(0.035, 0.035, 1.5, "#EFEAD8", 5, 0);
      env.pop();
      env.at(sx * halfL + 0.18, 1.32, sz * halfW);
      env.box(0.36, 0.26, 0.02, team.kit.trim);
      env.pop();
    }
  }

  // ---------------- 护栏与村镇看台 ----------------
  const fenceZ = halfW + 4.5;
  const fenceX = halfL + 4.8;
  for (const sz of [-1, 1]) {
    for (let i = -14; i <= 14; i += 1) {
      env.at((i / 14) * (halfL + 3), 0.55, sz * fenceZ);
      env.cyl(0.04, 0.05, 1.1, "#6F7778", 5, 0);
      env.pop();
    }
    env.at(0, 0.95, sz * fenceZ);
    env.box((halfL + 3) * 2, 0.06, 0.06, "#6F7778");
    env.pop();
  }
  for (const sx of [-1, 1]) {
    env.at(sx * fenceX, 0.4, 0);
    env.box(0.18, 0.8, halfW * 2 + 7.5, "#6F7778", 0.04);
    env.pop();
  }

  buildCommunityVenue(env, { format, halfL, halfW, fenceZ, quality, p });

  const envGeometry = env.toGeometry();
  const envMesh = new THREE.Mesh(envGeometry, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 6, specular: 0x1a1a16 }));
  envMesh.receiveShadow = true;
  envMesh.castShadow = false;
  group.add(envMesh);

  // ---------------- 村子：村居、稻田、集市为主体，地域小品为点缀 ----------------
  const props = new GeoBuilder();
  buildNewVillage(props, { culture, prng, halfL, halfW, quality });

  const propList = culture.props.filter((id) => id !== "banner-arch");
  const slots = quality === "low" ? 7 : 12;
  for (let i = 0; i < slots; i += 1) {
    const id = propList[i % propList.length];
    const a = (i / slots) * Math.PI * 2 + prng.signed(0.14);
    const radius = 46 + prng.next() * 30;
    const x = Math.sin(a) * radius * 1.35;
    const z = Math.cos(a) * radius;
    // 不要挡住主视角（南侧留出摄像机通道）
    if (Math.abs(x) < halfL + 8 && z > halfW && z < halfW + 16) continue;
    props.at(x, 0, z, Math.atan2(-x, -z) + prng.signed(0.4), 0.85 + prng.next() * 0.5);
    buildProp(props, id, culture, prng);
    props.pop();
  }
  const propGeometry = props.toGeometry();
  const propMesh = new THREE.Mesh(propGeometry, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 8, specular: 0x201e18 }));
  propMesh.castShadow = quality !== "low";
  propMesh.receiveShadow = false;
  group.add(propMesh);

  // ---------------- 球网 ----------------
  const netCanvas = createCanvas(128, 128);
  paintNetTexture(netCanvas, 128);
  const netTexture = makeTexture(netCanvas, { repeat: [4, 3] });
  disposables.push(netTexture);
  const netMat = new THREE.MeshLambertMaterial({ map: netTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const netDepth = 1.7;
  for (const sign of [-1, 1]) {
    const x = sign * halfL;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(goalW, goalH), netMat);
    back.position.set(x + sign * netDepth, goalH / 2, 0);
    back.rotation.y = Math.PI / 2;
    group.add(back);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(netDepth, goalW), netMat);
    top.position.set(x + (sign * netDepth) / 2, goalH, 0);
    top.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    group.add(top);
    for (const zSign of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(netDepth, goalH), netMat);
      side.position.set(x + (sign * netDepth) / 2, goalH / 2, (zSign * goalW) / 2);
      group.add(side);
    }
  }

  // ---------------- 观众 ----------------
  const crowdCanvas = createCanvas(8 * 64, 64);
  paintCrowdTexture(crowdCanvas, culture, 8, 64);
  const crowdTexture = makeTexture(crowdCanvas, { filter: false });
  disposables.push(crowdTexture);
  const crowdGeom = buildCrowdGeometry({ format, culture, prng, quality });
  const crowdMesh = new THREE.Mesh(crowdGeom, new THREE.MeshBasicMaterial({ map: crowdTexture, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  crowdMesh.name = "crowd";
  group.add(crowdMesh);

  // ---------------- 横幅：真实地名 ----------------
  const bannerCanvas = createCanvas(512, 96);
  paintBannerTexture(bannerCanvas, team.banner, team.kit, 512, 96);
  const bannerTexture = makeTexture(bannerCanvas);
  disposables.push(bannerTexture);
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTexture, side: THREE.DoubleSide });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.7), bannerMat);
  // 绑在护栏上、偏离中线：挂到看台顶上会飘出画面，挂正中央会被顶部计分板压掉一半字
  const bannerX = -12;
  const bannerZ = -fenceZ + 0.03;
  banner.position.set(bannerX, 1.35, bannerZ);
  group.add(banner);
  for (const sx of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x5a4634 }));
    pole.position.set(bannerX + sx * 6.1, 1.3, bannerZ);
    group.add(pole);
  }

  const rivalCanvas = createCanvas(512, 96);
  paintBannerTexture(rivalCanvas, `${rivalTeam.place.county}${rivalTeam.shortName}  客队`, rivalTeam.kit, 512, 96);
  const rivalTexture = makeTexture(rivalCanvas);
  disposables.push(rivalTexture);
  const rivalBanner = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.9), new THREE.MeshBasicMaterial({ map: rivalTexture, side: THREE.DoubleSide }));
  rivalBanner.position.set(13, 1.45, bannerZ + 0.02);
  group.add(rivalBanner);

  return {
    group,
    crowdMesh,
    dispose() {
      for (const item of disposables) item.dispose?.();
      envGeometry.dispose();
      propGeometry.dispose();
      crowdGeom.dispose();
    },
  };
}

// 观众用朝向球场的四边形，一次性合并成一个几何体
function buildCrowdGeometry({ format, culture, prng, quality }) {
  const halfL = format.pitch.length / 2;
  const halfW = format.pitch.width / 2;
  const positions = [];
  const uvs = [];
  const indices = [];
  const density = culture.crowd.density * (quality === "low" ? 0.45 : 1);
  const cells = 8;

  const addPerson = (x, y, z, facing, height) => {
    const w = height * 0.5;
    const base = positions.length / 3;
    const dirX = Math.cos(facing);
    const dirZ = -Math.sin(facing);
    const hx = (dirX * w) / 2;
    const hz = (dirZ * w) / 2;
    positions.push(x - hx, y, z - hz, x + hx, y, z + hz, x + hx, y + height, z + hz, x - hx, y + height, z - hz);
    const cell = Math.floor(prng.next() * cells);
    const u0 = cell / cells;
    const u1 = (cell + 1) / cells;
    uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (const sz of [-1, 1]) {
    const sideRows = sz < 0 ? (quality === "low" ? 2 : 3) : 1;
    for (let row = 0; row < sideRows; row += 1) {
      const z = sz * (halfW + 5.05 + row * 1.3);
      const y = sz < 0 ? 0.55 + row * 0.8 : 0.28;
      const sideDensity = sz < 0 ? 0.7 : 0.52;
      const count = Math.floor((halfL + 4) * 2 * sideDensity * density);
      for (let i = 0; i < count; i += 1) {
        const x = -(halfL + 3.4) + ((i + prng.next() * 0.8) / count) * (halfL + 3.4) * 2;
        addPerson(x, y, z + prng.signed(0.25), sz > 0 ? Math.PI : 0, 1.5 + prng.next() * 0.3);
      }
    }
  }
  // 两端零星站着的人。竖屏机位在端线后方约 22 m，这里要留出通道，
  // 否则最近的观众会正对镜头糊成一堵墙。
  for (const sx of [-1, 1]) {
    const count = Math.floor(halfW * 1.1 * density);
    for (let i = 0; i < count; i += 1) {
      const z = -halfW + (i / count) * halfW * 2 + prng.signed(0.6);
      if (Math.abs(z) < 5.5) continue;
      addPerson(sx * (halfL + 6.2 + prng.next() * 1.6), 0.35, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 1.5 + prng.next() * 0.3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// B 版村镇主场：村居只形成疏密有致的组团，稻田、河流和山体保留大面积呼吸感；
// 小集市贴着球场入口，表达“全镇来看球”，而不是职业体育场商业街。
function buildNewVillage(builder, { culture, prng, halfL, halfW, quality }) {
  const backZ = -halfW - 35;
  const houseSlots = quality === "low"
    ? [-halfL - 14, -halfL - 4, halfL + 4, halfL + 14]
    : [-halfL - 17, -halfL - 8, -halfL + 1, halfL - 1, halfL + 8, halfL + 17];
  for (let i = 0; i < houseSlots.length; i += 1) {
    builder.at(houseSlots[i] + prng.signed(1.1), 0, backZ + prng.signed(1.4), Math.PI + prng.signed(0.06), 0.72 + prng.next() * 0.12);
    buildProp(builder, i % 3 === 1 ? "new-village-block" : "new-village-house", culture, prng);
    builder.pop();
  }

  // 公共服务中心和学校式院落用一栋尺度稍大的公共建筑概括。
  builder.at(-halfL - 22, 0, backZ - 3.5, Math.PI + 0.04, 0.78);
  buildProp(builder, "village-service-center", culture, prng);
  builder.pop();

  // 远端村路的太阳能路灯，间距大、数量少。
  const lampCount = quality === "low" ? 4 : 7;
  for (let i = 0; i < lampCount; i += 1) {
    const t = lampCount === 1 ? 0.5 : i / (lampCount - 1);
    builder.at(-halfL - 20 + t * (halfL * 2 + 40), 0, backZ + 7.2, 0, 0.84);
    buildProp(builder, "solar-lamp", culture, prng);
    builder.pop();
  }

  // 住宅之间穿插常绿树组，软化程序化建筑的方盒轮廓。
  const treeCount = quality === "low" ? 4 : 8;
  for (let i = 0; i < treeCount; i += 1) {
    const t = treeCount === 1 ? 0.5 : i / (treeCount - 1);
    const x = -halfL - 18 + t * (halfL * 2 + 36) + prng.signed(1.8);
    builder.at(x, 0, backZ + 1.8 + prng.signed(2), prng.next() * Math.PI, 0.48 + prng.next() * 0.22);
    buildProp(builder, "fir-forest", culture, prng);
    builder.pop();
  }

  // 东西侧各保留少量住宅，不围成城市街墙。
  for (const sx of [-1, 1]) {
    const x = sx * (halfL + 29);
    const count = quality === "low" ? 2 : 3;
    for (let i = 0; i < count; i += 1) {
      const z = -halfW - 8 + i * 13 + prng.signed(1.5);
      builder.at(x + prng.signed(2), 0, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0.9 + prng.next() * 0.25);
      buildProp(builder, "new-village-house", culture, prng);
      builder.pop();
    }
  }

  // 稻田与梯田是主体，不再让建筑填满远景。
  for (const sx of [-1, 1]) {
    builder.at(sx * (halfL + 13), 0, backZ + 12, sx > 0 ? -0.16 : 0.14, 1.32);
    buildProp(builder, culture.terrain.terrace ? "rice-terrace" : "terrace-field", culture, prng);
    builder.pop();
    builder.at(sx * (halfL + 39), 0, -halfW - 5, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 1.28);
    buildProp(builder, "rice-terrace", culture, prng);
    builder.pop();
  }

  // 球场远侧入口的小集市：摊棚、农产品和一辆农用三轮，尺度克制。
  const stallCount = quality === "low" ? 3 : 6;
  for (let i = 0; i < stallCount; i += 1) {
    const side = i % 2 ? 1 : -1;
    const x = side * (halfL + 3 + Math.floor(i / 2) * 4.2);
    builder.at(x, 0, -halfW - 7.8 + prng.signed(0.35), Math.PI + prng.signed(0.06), 0.8 + prng.next() * 0.12);
    buildProp(builder, "market-stall", culture, prng);
    builder.pop();
  }
  if (quality !== "low") {
    builder.at(halfL + 11, 0, -halfW - 10.5, -0.3, 0.85);
    buildProp(builder, "farm-tricycle", culture, prng);
    builder.pop();
  }

  // 村级文体设施作为生活痕迹，退到球场两端。
  builder.at(-halfL - 20, 0, halfW + 18, 0.3, 0.9);
  buildProp(builder, "basketball-hoop", culture, prng);
  builder.pop();
  builder.at(-halfL - 14, 0, halfW + 24, -0.2, 0.9);
  buildProp(builder, "fitness-corner", culture, prng);
  builder.pop();
  builder.at(halfL + 18, 0, halfW + 18, -0.6, 1);
  buildProp(builder, "notice-board", culture, prng);
  builder.pop();
  builder.at(halfL + 37, 0, -halfW - 16, 0, 0.92);
  buildProp(builder, "water-tower", culture, prng);
  builder.pop();
}
