// 程序化蒙皮人物：按身材参数现场生成骨架 + 一体化蒙皮网格 + 一张图集贴图。
// 一个球员 = 1 个 SkinnedMesh = 1 个 drawcall，约 1060 个顶点，手机上 14 个人也不吃力。
// 模型朝向 +Z，左手边为 +X（与比赛核心的 facing = atan2(dirX, dirZ) 对齐）。

import * as THREE from "three";
import { ATLAS_SIZE, RECTS, headU, torsoU } from "./atlas.js";

export const BONE_NAMES = [
  "hips", "spine", "chest", "neck", "head",
  "shoulderL", "elbowL", "wristL", "handL",
  "shoulderR", "elbowR", "wristR", "handR",
  "hipL", "kneeL", "ankleL", "toeL",
  "hipR", "kneeR", "ankleR", "toeR",
];

export const BONE_INDEX = Object.freeze(
  BONE_NAMES.reduce((acc, name, index) => {
    acc[name] = index;
    return acc;
  }, {}),
);

// 由身材参数推出骨骼长度。比例参考成人真人，而不是漫画的九头身。
export function measurementsOf(body) {
  const h = body.height;
  const legRatio = body.legRatio;
  const limb = body.limb;
  // 腿比写实短一档：大头 + 短腿是可爱感的来源
  const thigh = h * 0.228 * legRatio;
  const shin = h * 0.215 * legRatio;
  const ankleY = h * 0.042;
  return {
    height: h,
    hipY: thigh + shin + ankleY,
    spine: h * 0.1,
    chest: h * 0.115,
    neck: h * 0.085 * body.neck,
    headOffset: h * 0.05,
    // 动画片比例：头高约为身高的 1/5.6（写实是 1/7.4）。再大就成 Q 版了，
    // 再小就回到写实、失去可爱感。headRadius 会被放样成 2.17 倍高。
    headRadius: h * 0.082,
    shoulderHalf: h * 0.107 * body.shoulder,
    hipHalf: h * 0.055,
    // 四肢比写实短一档：可爱感来自"大头 + 短粗四肢"的对比
    upperArm: h * 0.148 * limb,
    foreArm: h * 0.132 * limb,
    hand: h * 0.072,
    thigh,
    shin,
    ankleY,
    footLen: h * 0.158,
    // 体块半径
    rHip: h * 0.088 * body.belly,
    rWaist: h * 0.079 * body.belly,
    rChest: h * 0.096 * body.chest,
    rShoulder: h * 0.044 * body.shoulder,
    rNeck: h * 0.032 * body.neck,
    // 四肢比写实略粗、末端更圆：皮克斯的手脚是"厚实的小块"，不是竹竿
    rUpperArm: h * 0.038 * limb,
    rElbow: h * 0.033 * limb,
    rWrist: h * 0.028 * limb,
    rThigh: h * 0.064 * limb,
    rKnee: h * 0.049 * limb,
    rAnkle: h * 0.036 * limb,
    depthChest: h * 0.062 * body.chest,
    depthBelly: h * 0.058 * body.belly,
  };
}

// 骨架静置姿势：稍微外八的站姿，手臂自然下垂并略微外展（A-pose）
export function buildRestPose(m) {
  const armDrop = 0.14; // 手臂外展角
  const list = [];
  const add = (name, parent, x, y, z) => list.push({ name, parent, pos: [x, y, z] });
  add("hips", -1, 0, m.hipY, 0);
  add("spine", 0, 0, m.spine, 0);
  add("chest", 1, 0, m.chest, 0);
  add("neck", 2, 0, m.neck, 0);
  add("head", 3, 0, m.headOffset, 0);
  for (const [suffix, sign] of [["L", 1], ["R", -1]]) {
    const shoulderIndex = list.length;
    add(`shoulder${suffix}`, BONE_INDEX.chest, sign * m.shoulderHalf, m.neck * 0.32, 0);
    add(`elbow${suffix}`, shoulderIndex, sign * m.upperArm * armDrop, -m.upperArm * 0.99, 0);
    add(`wrist${suffix}`, shoulderIndex + 1, sign * m.foreArm * 0.05, -m.foreArm, 0);
    add(`hand${suffix}`, shoulderIndex + 2, 0, -m.hand, 0);
  }
  for (const [suffix, sign] of [["L", 1], ["R", -1]]) {
    const hipIndex = list.length;
    add(`hip${suffix}`, BONE_INDEX.hips, sign * m.hipHalf, -m.hipY * 0.06, 0);
    add(`knee${suffix}`, hipIndex, sign * 0.004, -m.thigh, 0);
    add(`ankle${suffix}`, hipIndex + 1, 0, -m.shin, 0);
    add(`toe${suffix}`, hipIndex + 2, 0, -m.ankleY * 0.55, m.footLen * 0.62);
  }
  return list;
}

function worldRestPositions(rest) {
  const out = [];
  for (const bone of rest) {
    const [x, y, z] = bone.pos;
    if (bone.parent < 0) out.push(new THREE.Vector3(x, y, z));
    else out.push(out[bone.parent].clone().add(new THREE.Vector3(x, y, z)));
  }
  return out;
}

class SkinBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.skinIndices = [];
    this.skinWeights = [];
    this.indices = [];
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  pushVertex(p, n, uv, bones, weights) {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(uv[0], uv[1]);
    this.skinIndices.push(bones[0], bones[1] ?? 0, 0, 0);
    const w0 = weights[0];
    const w1 = weights[1] ?? 0;
    const sum = w0 + w1 || 1;
    this.skinWeights.push(w0 / sum, w1 / sum, 0, 0);
  }

  // rings: [{ center, ex, ez, rx, rz, bones:[a,b], weights:[wa,wb], v }]
  tube(rings, radial, rect, uMode, { capTop = false, capBottom = false } = {}) {
    const start = this.vertexCount;
    for (const ring of rings) {
      for (let i = 0; i <= radial; i += 1) {
        const angle = (i / radial) * Math.PI * 2;
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        const offset = ring.ex.clone().multiplyScalar(sin * ring.rx).addScaledVector(ring.ez, cos * ring.rz);
        const p = ring.center.clone().add(offset);
        const n = offset.clone().normalize();
        let u;
        if (uMode === "torso") u = torsoU(angle);
        else if (uMode === "head") u = headU(angle);
        else u = i / radial;
        this.pushVertex(p, n, uvRect(rect, u, ring.v), ring.bones, ring.weights);
      }
    }
    const stride = radial + 1;
    for (let r = 0; r < rings.length - 1; r += 1) {
      for (let i = 0; i < radial; i += 1) {
        const a = start + r * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        // 绕序必须让法线朝外：(b-a) 是切向、(c-a) 是轴向，cross 后指向体外
        this.indices.push(a, b, c, b, d, c);
      }
    }
    if (capBottom) this.cap(rings[0], radial, rect, true);
    if (capTop) this.cap(rings[rings.length - 1], radial, rect, false);
  }

  cap(ring, radial, rect, downward) {
    const center = this.vertexCount;
    const normal = ring.ex.clone().cross(ring.ez).normalize().multiplyScalar(downward ? -1 : 1);
    this.pushVertex(ring.center, normal, uvRect(rect, 0.5, ring.v), ring.bones, ring.weights);
    const first = this.vertexCount;
    for (let i = 0; i <= radial; i += 1) {
      const angle = (i / radial) * Math.PI * 2;
      const offset = ring.ex.clone().multiplyScalar(Math.sin(angle) * ring.rx * 0.96).addScaledVector(ring.ez, Math.cos(angle) * ring.rz * 0.96);
      this.pushVertex(ring.center.clone().add(offset), normal, uvRect(rect, i / radial, ring.v), ring.bones, ring.weights);
    }
    for (let i = 0; i < radial; i += 1) {
      if (downward) this.indices.push(center, first + i + 1, first + i);
      else this.indices.push(center, first + i, first + i + 1);
    }
  }

  toGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.skinWeights, 4));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function uvRect(rect, u, v) {
  return [(rect.x + u * rect.w) / ATLAS_SIZE, 1 - (rect.y + (1 - v) * rect.h) / ATLAS_SIZE];
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// 沿骨段生成一串环。dir 为骨段方向，ex/ez 为环的横截面基向量。
function segmentRings(from, to, steps, radiusFn, bonesFn, vFrom, vTo) {
  const dir = to.clone().sub(from);
  const len = dir.length() || 1e-4;
  dir.divideScalar(len);
  let ex = AXIS_X.clone();
  if (Math.abs(dir.dot(ex)) > 0.9) ex = AXIS_Z.clone();
  ex = ex.sub(dir.clone().multiplyScalar(ex.dot(dir))).normalize();
  const ez = new THREE.Vector3().crossVectors(dir, ex).normalize();
  // 让 ez 尽量指向 +Z（正面），保证贴图正反不会反
  if (ez.z < 0) {
    ez.multiplyScalar(-1);
    ex.multiplyScalar(-1);
  }
  const rings = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const center = from.clone().lerp(to, t);
    const { rx, rz } = radiusFn(t);
    const { bones, weights } = bonesFn(t);
    rings.push({ center, ex, ez, rx, rz, bones, weights, v: vFrom + (vTo - vFrom) * t });
  }
  return rings;
}

function blend(t, boneA, boneB, softness = 0.35) {
  const k = Math.min(1, Math.max(0, (t - (0.5 - softness)) / (softness * 2)));
  return { bones: [boneA, boneB], weights: [1 - k, k] };
}

// 关节球：胘和膝弯起来时，两段圆柱之间会露出开口和朝下的封盖（在阴影里就是一块深斑），
// 补一颗跟着关节骨骼转的球正好把接缝盖住。
function jointBall(builder, center, radius, boneIdx, rect, v, radial = 10) {
  const rings = [];
  const steps = 4;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const y = -0.95 + t * 1.9;
    const shell = Math.sqrt(Math.max(0.05, 1 - y * y));
    rings.push({
      center: center.clone().add(new THREE.Vector3(0, y * radius * 0.92, 0)),
      ex: AXIS_X.clone(),
      ez: AXIS_Z.clone(),
      rx: radius * shell,
      rz: radius * shell,
      bones: [boneIdx, boneIdx],
      weights: [1, 0],
      v,
    });
  }
  builder.tube(rings, radial, rect, "limb");
}

export function buildHumanoidGeometry(body) {
  const m = measurementsOf(body);
  const rest = buildRestPose(m);
  const world = worldRestPositions(rest);
  const builder = new SkinBuilder();
  const B = BONE_INDEX;

  // ---- 躯干：从髋到颈的放样，肚子、胸腔和肩宽分别控制 ----
  const hipsP = world[B.hips];
  const neckP = world[B.neck];
  const torsoRings = [];
  const torsoSteps = 7;
  for (let i = 0; i <= torsoSteps; i += 1) {
    const t = i / torsoSteps;
    const center = hipsP.clone().lerp(neckP, t);
    // 腰最细、胸最宽、肚子在 0.28 处最鼓
    const bellyBulge = Math.exp(-((t - 0.26) ** 2) / 0.03) * (body.belly - 0.9) * 0.5;
    const rx = THREE.MathUtils.lerp(m.rHip, m.rChest, Math.min(1, t * 1.25)) * (1 + bellyBulge) * (t > 0.82 ? 1 - (t - 0.82) * 1.6 : 1);
    const rz = THREE.MathUtils.lerp(m.depthBelly, m.depthChest, Math.min(1, t * 1.15)) * (1 + bellyBulge * 1.3) * (t > 0.82 ? 1 - (t - 0.82) * 1.8 : 1);
    const info = t < 0.45 ? blend(t / 0.45, B.hips, B.spine, 0.4) : blend((t - 0.45) / 0.55, B.spine, B.chest, 0.4);
    torsoRings.push({ center, ex: AXIS_X.clone(), ez: AXIS_Z.clone(), rx, rz, ...info, v: t });
  }
  builder.tube(torsoRings, 16, RECTS.torso, "torso", { capBottom: true, capTop: true });

  // ---- 脖子 ----
  const headP = world[B.head];
  builder.tube(
    segmentRings(neckP, headP, 2, () => ({ rx: m.rNeck, rz: m.rNeck }), (t) => blend(t, B.neck, B.head, 0.45), 0.02, 0.12),
    8,
    RECTS.head,
    "head",
  );

  // ---- 头：椭球放样，脸在 +Z ----
  const headRings = [];
  const headSteps = 8;
  for (let i = 0; i <= headSteps; i += 1) {
    const t = i / headSteps;
    const y = -0.55 + t * 1.62; // 从下颌到头顶
    // 指数越小越接近球：皮克斯的头是饱满的蛋形，不是长条
    const shell = Math.sqrt(Math.max(0.02, 1 - Math.min(0.985, Math.abs(y) ** 2.4)));
    const jaw = t < 0.34 ? 0.82 + t * 0.53 : 1;
    const center = headP.clone().add(new THREE.Vector3(0, y * m.headRadius * 0.98, 0));
    headRings.push({
      center,
      ex: AXIS_X.clone(),
      ez: AXIS_Z.clone(),
      rx: m.headRadius * shell * 0.84 * jaw,
      rz: m.headRadius * shell * 0.94 * jaw,
      bones: [B.head, B.head],
      weights: [1, 0],
      v: 0.1 + t * 0.9,
    });
  }
  builder.tube(headRings, 16, RECTS.head, "head", { capTop: true, capBottom: true });

  // ---- 四肢 ----
  for (const suffix of ["L", "R"]) {
    const shoulder = world[B[`shoulder${suffix}`]];
    const elbow = world[B[`elbow${suffix}`]];
    const wrist = world[B[`wrist${suffix}`]];
    const hand = world[B[`hand${suffix}`]];
    const hip = world[B[`hip${suffix}`]];
    const knee = world[B[`knee${suffix}`]];
    const ankle = world[B[`ankle${suffix}`]];
    const toe = world[B[`toe${suffix}`]];
    const sIdx = B[`shoulder${suffix}`];
    const eIdx = B[`elbow${suffix}`];
    const wIdx = B[`wrist${suffix}`];
    const hIdx = B[`hand${suffix}`];

    // 肩头：一个球，而不是短圆柱——圆柱的两个平端在剪影上就是方块
    const shoulderRings = [];
    const shoulderSteps = 5;
    for (let i = 0; i <= shoulderSteps; i += 1) {
      const t = i / shoulderSteps;
      const y = -0.95 + t * 1.9;
      const shell = Math.sqrt(Math.max(0.03, 1 - y * y));
      shoulderRings.push({
        center: shoulder.clone().add(new THREE.Vector3(0, y * m.rShoulder * 0.95, 0)),
        ex: AXIS_X.clone(),
        ez: AXIS_Z.clone(),
        rx: m.rShoulder * shell,
        rz: m.rShoulder * shell,
        bones: [B.chest, sIdx],
        weights: [0.45, 0.55],
        v: 0.9 + t * 0.09,
      });
    }
    builder.tube(shoulderRings, 10, RECTS.arm, "limb", { capTop: true, capBottom: true });
    builder.tube(
      segmentRings(shoulder, elbow, 3, (t) => ({ rx: THREE.MathUtils.lerp(m.rUpperArm, m.rElbow, t), rz: THREE.MathUtils.lerp(m.rUpperArm, m.rElbow, t) }),
        (t) => blend(t, sIdx, eIdx, 0.42), 0.92, 0.58),
      10, RECTS.arm, "limb",
    );
    builder.tube(
      segmentRings(elbow, wrist, 3, (t) => ({ rx: THREE.MathUtils.lerp(m.rElbow, m.rWrist, t), rz: THREE.MathUtils.lerp(m.rElbow, m.rWrist, t) }),
        (t) => blend(t, eIdx, wIdx, 0.42), 0.58, 0.14),
      10, RECTS.arm, "limb",
    );
    // v 取 0.5 而不是肘部真实的 0.58：0.58 正压在袖口那条 trim 色带上，球会变成一颗撞色的珠子
    jointBall(builder, elbow, m.rElbow * 1.02, eIdx, RECTS.arm, 0.5);
    // 手掌：从腕口直接长出来的一块厚手套。t=0 的半径故意等于腕围，
    // 否则手会成为一颗悬在前臂末端外的独立椭球。
    builder.tube(
      segmentRings(wrist, hand, 4,
        (t) => {
          const swell = Math.sin(Math.PI * t);
          return {
            rx: m.rWrist * (1 + 0.45 * swell) * (1 - t * t * 0.45),
            rz: m.rWrist * (0.92 + 0.16 * swell) * (1 - t * t * 0.5),
          };
        },
        (t) => blend(t, wIdx, hIdx, 0.45), 0.9, 0.1),
      10, RECTS.hand, "limb", { capTop: true },
    );

    const hipIdx = B[`hip${suffix}`];
    const kneeIdx = B[`knee${suffix}`];
    const ankleIdx = B[`ankle${suffix}`];
    const toeIdx = B[`toe${suffix}`];
    builder.tube(
      segmentRings(hip.clone().add(new THREE.Vector3(0, m.rThigh * 0.35, 0)), knee, 4,
        (t) => ({ rx: THREE.MathUtils.lerp(m.rThigh, m.rKnee, t), rz: THREE.MathUtils.lerp(m.rThigh * 1.05, m.rKnee, t) }),
        (t) => blend(t, hipIdx, kneeIdx, 0.4), 1, 0.52),
      10, RECTS.leg, "limb",
    );
    jointBall(builder, knee, m.rKnee * 1.02, kneeIdx, RECTS.leg, 0.52);
    builder.tube(
      segmentRings(knee, ankle, 4,
        (t) => ({ rx: THREE.MathUtils.lerp(m.rKnee, m.rAnkle, t ** 0.7), rz: THREE.MathUtils.lerp(m.rKnee * 1.1, m.rAnkle, t ** 0.7) }),
        (t) => blend(t, kneeIdx, ankleIdx, 0.4), 0.52, 0.1),
      10, RECTS.leg, "limb", { capTop: true },
    );
    // 鞋：起点插回脚踝里一点、起始半径对齐踝围，才不会成为浮在小腿下的黑块
    builder.tube(
      segmentRings(ankle.clone().add(new THREE.Vector3(0, m.rAnkle * 0.3, -m.footLen * 0.16)), toe, 3,
        (t) => ({ rx: m.rAnkle * (1.04 - t * t * 0.34), rz: m.rAnkle * (0.94 - t * t * 0.42) }),
        (t) => blend(t, ankleIdx, toeIdx, 0.5), 0.92, 0.05),
      10, RECTS.shoe, "limb", { capTop: true, capBottom: true },
    );
  }

  return { geometry: builder.toGeometry(), rest, measurements: m };
}

export function buildSkeleton(rest) {
  const bones = rest.map((spec) => {
    const bone = new THREE.Bone();
    bone.name = spec.name;
    bone.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
    return bone;
  });
  rest.forEach((spec, index) => {
    if (spec.parent >= 0) bones[spec.parent].add(bones[index]);
  });
  return { bones, root: bones[0], skeleton: new THREE.Skeleton(bones) };
}

export function buildHumanoid(body, material) {
  const { geometry, rest, measurements } = buildHumanoidGeometry(body);
  const { bones, root, skeleton } = buildSkeleton(rest);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return { mesh, skeleton, bones, root, measurements, restSpec: rest };
}
