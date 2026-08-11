// 程序化动作系统：跑动、冲刺、停球、传球、射门、抢断、滑铲、头球、倒地、起身、
// 门将扑救与抛球、庆祝、过人。全部由曲线求值，不依赖任何动作捕捉文件。
//
// 两条"不能破"的规则：
// 1. 步频 = 速度 / 步幅 —— 脚落地的瞬间地面相对速度为零，不允许脚底打滑；
// 2. 出脚必须有蓄力、触球和随挥三段，不能只是把腿摆过去。

import { BONE_INDEX } from "./humanoid.js";
import { PSTATE } from "../core/constants.js";
import { clamp, lerp } from "../core/mathx.js";

const BONE_COUNT = 21;
const B = BONE_INDEX;

export function createPose() {
  return {
    rot: new Float32Array(BONE_COUNT * 3),
    rootY: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
  };
}

export function resetPose(pose) {
  pose.rot.fill(0);
  pose.rootY = 0;
  pose.pitch = 0;
  pose.roll = 0;
  pose.yaw = 0;
  return pose;
}

function setBone(pose, bone, x, y, z) {
  const i = bone * 3;
  pose.rot[i] = x;
  pose.rot[i + 1] = y;
  pose.rot[i + 2] = z;
}

function addBone(pose, bone, x, y, z) {
  const i = bone * 3;
  pose.rot[i] += x;
  pose.rot[i + 1] += y;
  pose.rot[i + 2] += z;
}

export function blendPose(base, target, t, out) {
  const k = clamp(t, 0, 1);
  for (let i = 0; i < BONE_COUNT * 3; i += 1) {
    out.rot[i] = base.rot[i] + (target.rot[i] - base.rot[i]) * k;
  }
  out.rootY = lerp(base.rootY, target.rootY, k);
  out.pitch = lerp(base.pitch, target.pitch, k);
  out.roll = lerp(base.roll, target.roll, k);
  out.yaw = lerp(base.yaw, target.yaw, k);
  return out;
}

const TAU = Math.PI * 2;

// 旋转方向约定（骨骼都朝 -Y 生长，角色面向 +Z）：
//   hip.x   正 = 大腿后摆（伸髋）        负 = 抬腿向前（屈髋）
//   knee.x  正 = 屈膝（脚跟往臀部收）    负 = 反关节，禁止出现
//   ankle.x 正 = 绷脚背（脚尖下压）      负 = 勾脚尖
//   shoulder.x 正 = 手臂后摆             elbow.x 负 = 屈肘（手往胸前收）
// 膝和肘的屈曲方向相反，这是人体结构决定的，改动作时别搞混。

// ---------------------------------------------------------------- 移动循环
// 相位定义：a = 0 摆动相中点（脚在身下收起），π/2 触地前伸，π 支撑中点，3π/2 蹬地
function locomotion(pose, { phase, speedNorm, sprint, stamina, breathT }) {
  const p = phase * TAU;
  const amp = 0.28 + speedNorm * 0.72; // 摆幅随速度
  const sprintBoost = sprint ? 1.18 : 1;
  const lean = (0.06 + speedNorm * 0.24) * sprintBoost;

  // 骨盆：随步伐轻微上下与左右摆
  pose.rootY = -Math.abs(Math.cos(p)) * 0.028 * (0.4 + speedNorm) + 0.004;
  setBone(pose, B.hips, lean * 0.35, Math.sin(p) * 0.12 * amp, Math.cos(p) * 0.05 * amp);
  setBone(pose, B.spine, lean * 0.5, -Math.sin(p) * 0.09 * amp, 0);
  setBone(pose, B.chest, lean * 0.42, -Math.sin(p) * 0.12 * amp, 0);
  // 疲劳时头会往下垂
  const tired = clamp(1 - stamina, 0, 1);
  setBone(pose, B.neck, -lean * 0.6 + tired * 0.22, 0, 0);
  setBone(pose, B.head, -lean * 0.25 + Math.sin(breathT * 1.3) * 0.02, Math.sin(p) * 0.04, 0);

  for (const [suffix, offset] of [["L", 0], ["R", Math.PI]]) {
    const a = p + offset;
    const reach = Math.sin(a); // +1 大腿前伸，-1 蹬地在后
    // 收腿只在摆动相的一小段里发生：用 cos 的高次幂把峰变窄，
    // 否则脚跟会长时间贴在臀部，看起来像甩了一条辫子。
    const tuck = Math.max(0, Math.cos(a)) ** 1.6;
    const push = Math.max(0, -reach); // 蹬地相
    // 屈髋为负。真人跑步前摆比后蹬大，后蹬超过 25° 就开始显得夸张。
    const hip = (reach > 0 ? -reach * 0.78 : -reach * 0.42) * amp * sprintBoost + lean * 0.45;
    // 屈膝恒为正，峰值控制在 100° 上下（1.75 rad）；跑得快才收得多
    const knee = 0.16 + tuck * (0.62 + speedNorm * 0.6) * sprintBoost + push * 0.2;
    // 蹬地绷脚背，触地前略勾脚尖
    const ankle = 0.12 + push * 0.3 * amp - Math.max(0, reach) * 0.18 * amp;
    setBone(pose, B[`hip${suffix}`], hip, 0, 0);
    setBone(pose, B[`knee${suffix}`], knee, 0, 0);
    setBone(pose, B[`ankle${suffix}`], ankle, 0, 0);
  }

  // 手臂：与同侧腿反相，速度越高肘越弯
  const elbowBend = -(0.35 + speedNorm * 0.95 * sprintBoost);
  for (const [suffix, offset, sign] of [["L", Math.PI, 1], ["R", 0, -1]]) {
    const a = p + offset;
    const swing = Math.sin(a) * (0.42 + speedNorm * 0.66) * sprintBoost;
    setBone(pose, B[`shoulder${suffix}`], swing, 0, sign * (0.12 + speedNorm * 0.18));
    setBone(pose, B[`elbow${suffix}`], elbowBend - Math.max(0, swing) * 0.35, 0, 0);
    setBone(pose, B[`wrist${suffix}`], 0.1, 0, 0);
  }
  return pose;
}

function idle(pose, { breathT, stamina, ballSide }) {
  const breath = Math.sin(breathT * 1.6) * 0.02;
  const tired = clamp(1 - stamina, 0, 1);
  const pant = tired * Math.sin(breathT * 3.4) * 0.05;
  setBone(pose, B.hips, 0.02, Math.sin(breathT * 0.6) * 0.03, 0);
  setBone(pose, B.spine, 0.04 + breath + tired * 0.16, 0, 0);
  setBone(pose, B.chest, 0.02 + breath + pant, 0, 0);
  setBone(pose, B.neck, -0.04 + tired * 0.18, ballSide * 0.18, 0);
  setBone(pose, B.head, -0.02, ballSide * 0.22, 0);
  for (const [suffix, sign] of [["L", 1], ["R", -1]]) {
    setBone(pose, B[`shoulder${suffix}`], 0.05 + tired * 0.12, 0, sign * (0.16 + tired * 0.1));
    setBone(pose, B[`elbow${suffix}`], -0.28 - tired * 0.35, 0, 0);
    // 站立也不是笔直的：微屈髋、微屈膝，重心压在前脚掌
    setBone(pose, B[`hip${suffix}`], -0.05, 0, sign * 0.05);
    setBone(pose, B[`knee${suffix}`], 0.16, 0, 0);
    setBone(pose, B[`ankle${suffix}`], 0.06, 0, 0);
  }
  pose.rootY = -0.01 + breath * 0.4;
  return pose;
}

// ---------------------------------------------------------------- 出脚三段
// t: 0~1。0~0.35 蓄力（髋后摆 + 屈膝），0.35~0.5 触球（爆发伸展），0.5~1 随挥
function kickPose(pose, { t, leg, power, mode }) {
  const swingSuffix = leg > 0 ? "R" : "L";
  const plantSuffix = leg > 0 ? "L" : "R";
  const windup = clamp(t / 0.35, 0, 1);
  const strike = clamp((t - 0.32) / 0.2, 0, 1);
  const follow = clamp((t - 0.5) / 0.5, 0, 1);
  const strength = mode === "shot" ? 1 : mode === "cross" ? 0.85 : 0.62;
  const p = power * strength;

  // 躯干：先后仰蓄力，触球时前压，随挥时转体
  const twist = (windup * -0.3 + strike * 0.5 + follow * 0.24) * leg * p;
  setBone(pose, B.hips, -windup * 0.12 * p + strike * 0.14 * p, twist * 0.6, 0);
  setBone(pose, B.spine, -windup * 0.2 * p + strike * 0.26 * p + follow * 0.08, twist, 0);
  setBone(pose, B.chest, -windup * 0.14 * p + strike * 0.2 * p, twist * 1.1, 0);
  setBone(pose, B.neck, 0.16 * strike * p, -twist * 0.3, 0);
  setBone(pose, B.head, 0.12 * strike, -twist * 0.2, 0);

  // 摆动腿的鞭打：蓄力时大腿后摆 + 小腿折起（hip 正、knee 正），
  // 触球瞬间大腿猛地前摆（hip 转负）同时小腿弹出（knee 收回接近 0），随挥再略回收。
  const hipSwing = windup * 0.85 * p - strike * 1.7 * p - follow * 0.4 * p;
  const kneeBend = 0.35 + windup * 1.55 * p - strike * 1.7 * p + follow * 0.45;
  setBone(pose, B[`hip${swingSuffix}`], hipSwing, 0, -leg * 0.1 * p);
  setBone(pose, B[`knee${swingSuffix}`], clamp(kneeBend, 0.02, 2.2), 0, 0);
  // 正脚背抽射要绷脚背
  setBone(pose, B[`ankle${swingSuffix}`], 0.16 + strike * 0.48 * p, 0, 0);

  // 支撑腿：屈膝站稳，脚尖指向目标
  setBone(pose, B[`hip${plantSuffix}`], -0.14 - strike * 0.12, 0, leg * 0.12);
  setBone(pose, B[`knee${plantSuffix}`], 0.4 + strike * 0.24, 0, 0);
  setBone(pose, B[`ankle${plantSuffix}`], 0.14, 0, 0);

  // 手臂：反向张开保持平衡
  setBone(pose, B[`shoulder${swingSuffix === "R" ? "L" : "R"}`], -0.9 * p - strike * 0.6, 0, leg * 0.9 * p);
  setBone(pose, B[`elbow${swingSuffix === "R" ? "L" : "R"}`], -0.7, 0, 0);
  setBone(pose, B[`shoulder${swingSuffix}`], 0.55 * p, 0, -leg * 0.5 * p);
  setBone(pose, B[`elbow${swingSuffix}`], -0.5, 0, 0);

  pose.rootY = -0.02 - strike * 0.03;
  pose.roll = -leg * (windup * 0.06 + strike * 0.12) * p;
  return pose;
}

function trapPose(pose, { t, ballSide, high }) {
  const reach = Math.sin(clamp(t, 0, 1) * Math.PI);
  const suffix = ballSide > 0 ? "R" : "L";
  setBone(pose, B.hips, 0.14 * reach, ballSide * 0.2 * reach, 0);
  setBone(pose, B.spine, 0.2 * reach, ballSide * 0.24 * reach, 0);
  setBone(pose, B.chest, high ? -0.24 * reach : 0.14 * reach, ballSide * 0.2 * reach, 0);
  setBone(pose, B.neck, 0.2 * reach, 0, 0);
  setBone(pose, B[`hip${suffix}`], -(high ? 0.2 : 0.66) * reach, 0, -ballSide * 0.2 * reach);
  setBone(pose, B[`knee${suffix}`], 0.5 + reach * 0.3, 0, 0);
  setBone(pose, B[`ankle${suffix}`], -0.24 * reach, 0, 0);
  setBone(pose, B[`hip${suffix === "R" ? "L" : "R"}`], 0.12, 0, 0);
  setBone(pose, B[`knee${suffix === "R" ? "L" : "R"}`], 0.5, 0, 0);
  for (const s of ["L", "R"]) {
    setBone(pose, B[`shoulder${s}`], -0.3 * reach, 0, (s === "L" ? 1 : -1) * (0.5 + reach * 0.5));
    setBone(pose, B[`elbow${s}`], -0.6, 0, 0);
  }
  pose.rootY = -0.03 * reach;
  return pose;
}

function tacklePose(pose, { t }) {
  const lunge = Math.sin(clamp(t, 0, 1) * Math.PI);
  setBone(pose, B.hips, 0.34 * lunge, 0, 0);
  setBone(pose, B.spine, 0.3 * lunge, 0, 0);
  setBone(pose, B.chest, 0.16 * lunge, 0, 0);
  setBone(pose, B.neck, -0.2 * lunge, 0, 0);
  setBone(pose, B.hipR, -0.95 * lunge, 0, -0.12);
  setBone(pose, B.kneeR, 0.3 + lunge * 0.15, 0, 0);
  setBone(pose, B.ankleR, -0.3 * lunge, 0, 0);
  setBone(pose, B.hipL, 0.45 * lunge, 0, 0.1);
  setBone(pose, B.kneeL, 0.9 * lunge + 0.2, 0, 0);
  setBone(pose, B.shoulderL, -1.1 * lunge, 0, 0.8 * lunge);
  setBone(pose, B.shoulderR, -0.5 * lunge, 0, -1.0 * lunge);
  setBone(pose, B.elbowL, -0.5, 0, 0);
  setBone(pose, B.elbowR, -0.4, 0, 0);
  pose.rootY = -0.12 * lunge;
  return pose;
}

function slidePose(pose, { t, leg }) {
  const enter = clamp(t / 0.18, 0, 1);
  const hold = clamp(1 - Math.max(0, (t - 0.72) / 0.28), 0, 1);
  const k = enter * hold;
  const front = leg > 0 ? "R" : "L";
  const tuck = leg > 0 ? "L" : "R";
  setBone(pose, B.hips, -0.5 * k, 0, 0);
  setBone(pose, B.spine, -0.35 * k, 0, leg * 0.18 * k);
  setBone(pose, B.chest, -0.2 * k, 0, leg * 0.14 * k);
  setBone(pose, B.neck, 0.5 * k, 0, 0);
  setBone(pose, B[`hip${front}`], -1.25 * k, 0, -leg * 0.16);
  setBone(pose, B[`knee${front}`], 0.1 * k, 0, 0);
  setBone(pose, B[`ankle${front}`], -0.26 * k, 0, 0);
  setBone(pose, B[`hip${tuck}`], -0.4 * k, 0, leg * 0.4 * k);
  setBone(pose, B[`knee${tuck}`], 1.85 * k, 0, 0);
  setBone(pose, B.shoulderL, -1.5 * k, 0, 0.9 * k);
  setBone(pose, B.shoulderR, -1.5 * k, 0, -0.9 * k);
  setBone(pose, B.elbowL, -0.7 * k, 0, 0);
  setBone(pose, B.elbowR, -0.7 * k, 0, 0);
  // 身体几乎躺倒并侧滚
  pose.pitch = -0.95 * k;
  pose.roll = leg * 0.55 * k;
  pose.rootY = -0.42 * k;
  return pose;
}

function headerPose(pose, { t }) {
  // 起跳 -> 顶点顶球 -> 落地屈膝
  const jump = Math.sin(clamp(t, 0, 1) * Math.PI);
  const crouch = clamp(1 - t / 0.22, 0, 1);
  const snap = clamp((t - 0.42) / 0.18, 0, 1) * clamp(1 - (t - 0.6) / 0.3, 0, 1);
  setBone(pose, B.hips, -0.2 * jump + 0.35 * crouch, 0, 0);
  setBone(pose, B.spine, -0.36 * jump + 0.3 * crouch + snap * 0.5, 0, 0);
  setBone(pose, B.chest, -0.3 * jump + snap * 0.45, 0, 0);
  setBone(pose, B.neck, -0.32 * jump + snap * 0.62, 0, 0);
  setBone(pose, B.head, -0.2 * jump + snap * 0.4, 0, 0);
  for (const [s, sign] of [["L", 1], ["R", -1]]) {
    setBone(pose, B[`shoulder${s}`], -1.6 * jump, 0, sign * (0.5 + jump * 0.7));
    setBone(pose, B[`elbow${s}`], -0.5 - jump * 0.4, 0, 0);
    setBone(pose, B[`hip${s}`], 0.3 * jump - 0.5 * crouch, 0, 0);
    setBone(pose, B[`knee${s}`], 0.3 + jump * 0.95 + crouch * 0.95, 0, 0);
    setBone(pose, B[`ankle${s}`], 0.34 * jump, 0, 0);
  }
  pose.rootY = jump * 0.42 - crouch * 0.1;
  return pose;
}

function fallPose(pose, { t, dir }) {
  const k = clamp(t * 2.2, 0, 1);
  setBone(pose, B.hips, -0.4 * k, 0, 0);
  setBone(pose, B.spine, -0.3 * k, 0, dir * 0.3 * k);
  setBone(pose, B.chest, 0.2 * k, 0, dir * 0.2 * k);
  setBone(pose, B.neck, 0.4 * k, 0, 0);
  for (const [s, sign] of [["L", 1], ["R", -1]]) {
    setBone(pose, B[`shoulder${s}`], -1.2 * k, 0, sign * 0.9 * k);
    setBone(pose, B[`elbow${s}`], -0.9 * k, 0, 0);
    setBone(pose, B[`hip${s}`], -0.6 * k, 0, 0);
    setBone(pose, B[`knee${s}`], 1.15 * k, 0, 0);
  }
  pose.pitch = -1.15 * k;
  pose.roll = dir * 0.5 * k;
  pose.rootY = -0.62 * k;
  return pose;
}

function getupPose(pose, { t }) {
  const k = clamp(1 - t, 0, 1);
  return fallPose(pose, { t: k * 0.45, dir: 1 });
}

function divePose(pose, { t, dir }) {
  const launch = clamp(t / 0.25, 0, 1);
  const air = Math.sin(clamp(t, 0, 1) * Math.PI);
  const land = clamp((t - 0.65) / 0.35, 0, 1);
  setBone(pose, B.hips, -0.25 * launch, 0, dir * 0.3 * launch);
  setBone(pose, B.spine, -0.2 * launch, 0, dir * 0.35 * launch);
  setBone(pose, B.chest, -0.1, 0, dir * 0.2 * launch);
  setBone(pose, B.neck, 0.3 * launch, -dir * 0.3, 0);
  // 双臂朝球伸展
  setBone(pose, B.shoulderL, -2.1 * launch, 0, (dir > 0 ? 0.4 : 1.2) * launch);
  setBone(pose, B.shoulderR, -2.1 * launch, 0, -(dir > 0 ? 1.2 : 0.4) * launch);
  setBone(pose, B.elbowL, -0.25 * launch, 0, 0);
  setBone(pose, B.elbowR, -0.25 * launch, 0, 0);
  for (const s of ["L", "R"]) {
    setBone(pose, B[`hip${s}`], -0.12 * launch - land * 0.4, 0, 0);
    setBone(pose, B[`knee${s}`], 0.35 + air * 0.55, 0, 0);
  }
  pose.roll = dir * (1.15 * launch - land * 0.25);
  pose.rootY = air * 0.5 - land * 0.35;
  return pose;
}

function throwPose(pose, { t }) {
  const wind = clamp(t / 0.4, 0, 1);
  const release = clamp((t - 0.38) / 0.3, 0, 1);
  setBone(pose, B.hips, -0.1 * wind + 0.16 * release, -0.24 * wind + 0.3 * release, 0);
  setBone(pose, B.spine, -0.24 * wind + 0.34 * release, -0.34 * wind + 0.42 * release, 0);
  setBone(pose, B.chest, -0.18 * wind + 0.24 * release, -0.3 * wind + 0.4 * release, 0);
  setBone(pose, B.shoulderR, -2.4 * wind + 1.9 * release, 0, -0.5);
  setBone(pose, B.elbowR, -1.5 * wind + 1.35 * release, 0, 0);
  setBone(pose, B.shoulderL, -0.9 * wind, 0, 0.7);
  setBone(pose, B.elbowL, -0.8, 0, 0);
  setBone(pose, B.hipL, -0.42 * release, 0, 0);
  setBone(pose, B.kneeL, 0.5 + release * 0.2, 0, 0);
  setBone(pose, B.hipR, 0.32 * wind, 0, 0);
  setBone(pose, B.kneeR, 0.45, 0, 0);
  return pose;
}

function celebratePose(pose, { t, breathT }) {
  const wave = Math.sin(breathT * 6) * 0.25;
  setBone(pose, B.spine, -0.16, wave * 0.3, 0);
  setBone(pose, B.chest, -0.2, wave * 0.4, 0);
  setBone(pose, B.neck, -0.28, 0, 0);
  setBone(pose, B.head, -0.2, wave * 0.4, 0);
  for (const [s, sign] of [["L", 1], ["R", -1]]) {
    setBone(pose, B[`shoulder${s}`], -2.5 + wave * 0.3, 0, sign * (1.0 + wave * 0.2));
    setBone(pose, B[`elbow${s}`], -0.35, 0, 0);
  }
  return pose;
}

function skillPose(pose, { t, kind, leg }) {
  const k = Math.sin(clamp(t, 0, 1) * Math.PI);
  const suffix = leg > 0 ? "R" : "L";
  if (kind === "stepover") {
    setBone(pose, B[`hip${suffix}`], -0.55 * k, leg * 0.9 * k, 0);
    setBone(pose, B[`knee${suffix}`], 1.15 * k, 0, 0);
    setBone(pose, B.hips, 0, leg * 0.28 * k, 0);
    setBone(pose, B.spine, 0.1 * k, -leg * 0.2 * k, 0);
  } else {
    // 急停变向：重心明显压低并侧倾
    setBone(pose, B.hips, 0.2 * k, -leg * 0.3 * k, leg * 0.2 * k);
    setBone(pose, B.spine, 0.26 * k, -leg * 0.34 * k, leg * 0.18 * k);
    setBone(pose, B[`hip${suffix}`], -0.45 * k, 0, -leg * 0.4 * k);
    setBone(pose, B[`knee${suffix}`], 0.95 * k, 0, 0);
    setBone(pose, B[`hip${suffix === "R" ? "L" : "R"}`], 0.35 * k, 0, 0);
    setBone(pose, B[`knee${suffix === "R" ? "L" : "R"}`], 0.75 * k, 0, 0);
    pose.roll = leg * 0.22 * k;
    pose.rootY = -0.09 * k;
  }
  for (const [s, sign] of [["L", 1], ["R", -1]]) {
    setBone(pose, B[`shoulder${s}`], -0.5 * k, 0, sign * (0.6 + k * 0.4));
    setBone(pose, B[`elbow${s}`], -0.6, 0, 0);
  }
  return pose;
}

// ---------------------------------------------------------------- 主入口
const scratchBase = createPose();
const scratchAction = createPose();

const ACTION_STATES = new Set([
  PSTATE.PASS, PSTATE.SHOOT, PSTATE.TACKLE, PSTATE.SLIDE, PSTATE.HEADER,
  PSTATE.TRAP, PSTATE.FALL, PSTATE.GETUP, PSTATE.DIVE, PSTATE.THROW,
  PSTATE.CELEBRATE, PSTATE.SKILL,
]);

export function evaluatePlayerPose(out, player, context) {
  const { breathT, ballSide = 0, ballHigh = false, maxSpeed = 6 } = context;
  const speedNorm = clamp(player.speed / Math.max(2, maxSpeed), 0, 1.25);
  resetPose(scratchBase);
  if (player.speed > 0.45) {
    locomotion(scratchBase, {
      phase: player.anim.legPhase,
      speedNorm,
      sprint: player.sprinting || player.state === PSTATE.SPRINT,
      stamina: player.stamina,
      breathT,
    });
  } else {
    idle(scratchBase, { breathT, stamina: player.stamina, ballSide });
  }

  if (!ACTION_STATES.has(player.state)) {
    return copyPose(scratchBase, out);
  }

  resetPose(scratchAction);
  const total = player.lockTotal || 0.4;
  const t = clamp(player.stateT / total, 0, 1);
  const leg = player.anim.kickLeg >= 0 ? 1 : -1;

  switch (player.state) {
    case PSTATE.PASS:
      kickPose(scratchAction, { t, leg, power: 0.75, mode: "pass" });
      break;
    case PSTATE.SHOOT:
      kickPose(scratchAction, { t, leg, power: 1, mode: "shot" });
      break;
    case PSTATE.TRAP:
      trapPose(scratchAction, { t, ballSide: ballSide >= 0 ? 1 : -1, high: ballHigh });
      break;
    case PSTATE.TACKLE:
      tacklePose(scratchAction, { t });
      break;
    case PSTATE.SLIDE:
      slidePose(scratchAction, { t, leg });
      break;
    case PSTATE.HEADER:
      headerPose(scratchAction, { t });
      break;
    case PSTATE.FALL:
      fallPose(scratchAction, { t, dir: leg });
      break;
    case PSTATE.GETUP:
      getupPose(scratchAction, { t });
      break;
    case PSTATE.DIVE:
      divePose(scratchAction, { t, dir: leg });
      break;
    case PSTATE.THROW:
      throwPose(scratchAction, { t });
      break;
    case PSTATE.CELEBRATE:
      celebratePose(scratchAction, { t, breathT });
      break;
    case PSTATE.SKILL:
      skillPose(scratchAction, { t, kind: player.anim.skill || "cut", leg });
      break;
    default:
      break;
  }

  // 动作层进出都有过渡，避免"啪"地切换
  const inRamp = clamp(t / 0.12, 0, 1);
  const outRamp = clamp((1 - t) / 0.18, 0, 1);
  const weight = Math.min(inRamp, player.state === PSTATE.FALL || player.state === PSTATE.SLIDE ? 1 : outRamp);
  return blendPose(scratchBase, scratchAction, weight, out);
}

export function copyPose(from, to) {
  to.rot.set(from.rot);
  to.rootY = from.rootY;
  to.pitch = from.pitch;
  to.roll = from.roll;
  to.yaw = from.yaw;
  return to;
}

// 把姿态写进骨骼。damping 让渲染层的姿态在两帧之间平滑，掩盖 30 Hz 与 60 fps 的差。
export function applyPose(bones, pose, damping = 1) {
  for (let i = 0; i < BONE_COUNT; i += 1) {
    const bone = bones[i];
    if (!bone) continue;
    const j = i * 3;
    if (damping >= 1) {
      bone.rotation.set(pose.rot[j], pose.rot[j + 1], pose.rot[j + 2]);
    } else {
      bone.rotation.set(
        lerp(bone.rotation.x, pose.rot[j], damping),
        lerp(bone.rotation.y, pose.rot[j + 1], damping),
        lerp(bone.rotation.z, pose.rot[j + 2], damping),
      );
    }
  }
}

export { BONE_COUNT };
