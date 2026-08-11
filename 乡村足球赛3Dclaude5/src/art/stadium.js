// 球场与村庄环境：草皮、白线、球门、球网、角旗、护栏、土坡看台、观众、
// 横幅（写真实地名）以及一圈地域小品。除观众和横幅外全部合批到 1~2 个 drawcall。

import * as THREE from "three";
import { GeoBuilder } from "./geo.js";
import { buildProp, propPalette } from "./props.js";
import { paintBannerTexture, paintCrowdTexture, paintGroundTexture, paintNetTexture, paintPitchTexture } from "./textures.js";
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

export function buildStadium({ format, culture, team, rivalTeam, createCanvas, quality = "high" }) {
  const group = new THREE.Group();
  group.name = "stadium";
  const prng = createPrng(hashSeed(`stadium:${team.id}:${culture.id}`));
  const disposables = [];
  const halfL = format.pitch.length / 2;
  const halfW = format.pitch.width / 2;

  // ---------------- 草皮 ----------------
  // 一张贴图要盖住 76×50 米；1024 时每米只有 13 像素，镜头一拉近草地就糊了
  const pitchSize = quality === "low" ? 1024 : 2048;
  const pitchCanvas = createCanvas(pitchSize, pitchSize);
  const { worldW, worldH } = paintPitchTexture(pitchCanvas, culture, format, pitchSize, 6);
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
  // 地面是一张黄土 + 草斑 + 耕地 + 土路的贴图，不再是一整块绿
  const groundCanvas = createCanvas(1024, 1024);
  paintGroundTexture(groundCanvas, culture, 1024);
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
  // 场地外一圈踩秃的黄土，顶面压在草皮之下
  env.at(0, -0.005, 0);
  env.box(worldW + 12, 0.02, worldH + 10, culture.ground.soil, 0.12);
  env.pop();

  const hills = culture.terrain.hills;
  if (hills > 0.05) {
    const ringCount = quality === "low" ? 8 : 16;
    for (let i = 0; i < ringCount; i += 1) {
      const a = (i / ringCount) * Math.PI * 2 + prng.next() * 0.2;
      const dist = 95 + prng.next() * 55;
      const h = (6 + prng.next() * 26) * hills;
      env.at(Math.sin(a) * dist, 0, Math.cos(a) * dist, prng.next() * 3);
      env.addGeometry(new THREE.ConeGeometry(16 + prng.next() * 22, h, 6), culture.terrain.snowPeak && h > 22 ? "#E8EEF2" : p.foliage, 0.1);
      env.pop();
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

  // ---------------- 护栏与土坡看台 ----------------
  const fenceZ = halfW + 3.2;
  const fenceX = halfL + 4.4;
  for (const sz of [-1, 1]) {
    for (let i = -14; i <= 14; i += 1) {
      env.at((i / 14) * (halfL + 3), 0.55, sz * fenceZ);
      env.cyl(0.045, 0.05, 1.1, p.darkWood, 5, 0);
      env.pop();
    }
    env.at(0, 0.95, sz * fenceZ);
    env.box((halfL + 3) * 2, 0.06, 0.06, p.darkWood);
    env.pop();
    // 土坡看台：三级
    for (let row = 0; row < 3; row += 1) {
      env.at(0, 0.28 + row * 0.42, sz * (fenceZ + 1.4 + row * 1.5));
      env.box((halfL + 4) * 2, 0.55 + row * 0.85, 1.5, culture.ground.soil, 0.07);
      env.pop();
    }
  }
  for (const sx of [-1, 1]) {
    env.at(sx * fenceX, 0.4, 0);
    env.box(0.25, 0.8, halfW * 2 + 6, p.darkWood, 0.06);
    env.pop();
  }

  const envGeometry = env.toGeometry();
  const envMesh = new THREE.Mesh(envGeometry, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 6, specular: 0x1a1a16 }));
  envMesh.receiveShadow = true;
  envMesh.castShadow = false;
  group.add(envMesh);

  // ---------------- 村子：先排新农村住宅，再撒地域小品 ----------------
  const props = new GeoBuilder();
  buildNewVillage(props, { culture, prng, halfL, halfW, quality });

  const propList = culture.props.filter((id) => id !== "banner-arch");
  const slots = quality === "low" ? 10 : 18;
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
  const bannerZ = -(halfW + 3.2);
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
  rivalBanner.position.set(0, 2.6, halfW + 6.4);
  rivalBanner.rotation.y = Math.PI;
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
  const rows = 3;

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
    for (let row = 0; row < rows; row += 1) {
      const z = sz * (halfW + 4.2 + row * 1.5);
      const y = 0.55 + row * 0.85;
      const count = Math.floor((halfL + 4) * 2 * 0.62 * density);
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

// 新农村布局：北侧两排面向球场的二层小楼 + 一条水泥主路 + 文化广场设施，
// 东西两侧各一排。目的是让球场"嵌在村子里"，而不是浮在一片草地上。
function buildNewVillage(builder, { culture, prng, halfL, halfW, quality }) {
  const rows = quality === "low" ? 1 : 2;
  const houseGap = 9.5;

  // 北侧（远端）两排住宅，正面朝球场
  for (let row = 0; row < rows; row += 1) {
    const z = -halfW - 26 - row * 15;
    const count = Math.floor((halfL + 26) * 2 / houseGap);
    for (let i = 0; i < count; i += 1) {
      const x = -(halfL + 24) + i * houseGap + prng.signed(1.6);
      builder.at(x, 0, z + prng.signed(1.4), Math.PI + prng.signed(0.08), 0.92 + prng.next() * 0.22);
      buildProp(builder, prng.chance(0.18) ? "new-village-block" : "new-village-house", culture, prng);
      builder.pop();
    }
    // 路灯
    for (let i = 0; i < count; i += 2) {
      builder.at(-(halfL + 24) + i * houseGap + houseGap / 2, 0, z + 7.5, 0, 1);
      buildProp(builder, "solar-lamp", culture, prng);
      builder.pop();
    }
  }

  // 东西两侧各一排，侧脸朝球场
  for (const sx of [-1, 1]) {
    const x = sx * (halfL + 30);
    const count = quality === "low" ? 3 : 5;
    for (let i = 0; i < count; i += 1) {
      const z = -halfW - 6 + i * 11 + prng.signed(1.5);
      builder.at(x + prng.signed(2), 0, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0.9 + prng.next() * 0.25);
      buildProp(builder, "new-village-house", culture, prng);
      builder.pop();
    }
  }

  // 文化广场：篮球架、健身器材、宣传栏、水塔
  builder.at(-halfL - 22, 0, halfW + 20, 0.3, 1);
  buildProp(builder, "basketball-hoop", culture, prng);
  builder.pop();
  builder.at(-halfL - 16, 0, halfW + 27, -0.2, 1);
  buildProp(builder, "fitness-corner", culture, prng);
  builder.pop();
  builder.at(halfL + 18, 0, halfW + 18, -0.6, 1);
  buildProp(builder, "notice-board", culture, prng);
  builder.pop();
  builder.at(halfL + 34, 0, -halfW - 12, 0, 1);
  buildProp(builder, "water-tower", culture, prng);
  builder.pop();
  for (const sx of [-1, 1]) {
    builder.at(sx * (halfL + 10), 0, halfW + 12, 0, 1);
    buildProp(builder, "solar-lamp", culture, prng);
    builder.pop();
  }
}
