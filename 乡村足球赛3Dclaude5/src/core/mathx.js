// 比赛核心只用平面向量 + 一个高度分量，避免引入 3D 引擎的数学库。
// 坐标约定：x 沿球场长边（进攻方向），z 沿短边，y 为高度。

export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function length2(x, z) {
  return Math.sqrt(x * x + z * z);
}

export function dist2(a, b) {
  return length2(a.x - b.x, a.z - b.z);
}

export function normalize2(x, z) {
  const len = length2(x, z);
  if (len < 1e-6) return { x: 0, z: 0, len: 0 };
  return { x: x / len, z: z / len, len };
}

export function angleOf(x, z) {
  return Math.atan2(x, z);
}

export function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

// 朝向平滑转动，返回新角度（每步最大转动 maxStep 弧度）
export function turnToward(current, target, maxStep) {
  const delta = wrapAngle(target - current);
  if (Math.abs(delta) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(delta) * maxStep);
}

export function moveToward(value, target, maxStep) {
  const delta = target - value;
  if (Math.abs(delta) <= maxStep) return target;
  return value + Math.sign(delta) * maxStep;
}

export function damp(value, target, rate, dt) {
  return lerp(value, target, 1 - Math.exp(-rate * dt));
}
