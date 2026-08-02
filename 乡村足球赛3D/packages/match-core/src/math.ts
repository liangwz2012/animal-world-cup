import type { Vec2 } from './types.ts';

const QUANTIZE_SCALE = 100_000;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function length(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(vector: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
  const magnitude = length(vector);
  if (magnitude < 1e-8) return { ...fallback };
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

export function clampMagnitude(vector: Vec2, maximum: number): Vec2 {
  const magnitude = length(vector);
  if (magnitude <= maximum || magnitude < 1e-8) return { ...vector };
  const scale = maximum / magnitude;
  return { x: vector.x * scale, y: vector.y * scale };
}

export function moveTowards(current: number, target: number, maximumDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maximumDelta) return target;
  return current + Math.sign(delta) * maximumDelta;
}

export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * clamp01(alpha);
}

export function quantize(value: number): number {
  return Math.round(value * QUANTIZE_SCALE) / QUANTIZE_SCALE;
}

export function quantizeVec(vector: Vec2): Vec2 {
  return { x: quantize(vector.x), y: quantize(vector.y) };
}
