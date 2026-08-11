// 单人一张图集：躯干占上半张（号码要看得清），头/四肢/鞋分享下半张。
// 躯干的环向 UV 是非线性的：背面和正面各占 30%，两侧各占 20%，
// 背号因此能拿到约 76 像素宽，比均匀展开清楚一倍。接缝放在正胸中线，
// 画成门襟一样的竖条，反而像村队真实球衣。

// 所有绘制和 RECTS 都在 256 的逻辑坐标系里，实际画布放大 ATLAS_SCALE 倍。
// 因为贴图全是 Canvas 矢量指令，放大后是真细节（五官、号码、织纹），不是插值。
export const ATLAS_SIZE = 256;
export const ATLAS_SCALE = 2;
export const ATLAS_PIXELS = ATLAS_SIZE * ATLAS_SCALE;

export const RECTS = Object.freeze({
  torso: { x: 0, y: 0, w: 256, h: 128 },
  head: { x: 0, y: 128, w: 96, h: 96 },
  arm: { x: 96, y: 128, w: 48, h: 96 },
  leg: { x: 144, y: 128, w: 64, h: 96 },
  shoe: { x: 208, y: 128, w: 48, h: 48 },
  extra: { x: 208, y: 176, w: 48, h: 48 },
  hand: { x: 0, y: 224, w: 48, h: 32 },
  hair: { x: 48, y: 224, w: 96, h: 32 },
});

// rect 内的 (u,v) -> 图集 UV。v=0 是 rect 底部。
export function uvOf(rect, u, v) {
  return [(rect.x + u * rect.w) / ATLAS_SIZE, 1 - (rect.y + (1 - v) * rect.h) / ATLAS_SIZE];
}

const FRONT_SHARE = 0.3;
const SIDE_SHARE = 0.2;
const HALF_PI = Math.PI / 2;

function wrapPi(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// angle = 0 是正胸方向，π 是背面。背面中心固定映射到 u = 0.5。
export function torsoU(angle) {
  const d = wrapPi(angle - Math.PI); // 相对背面中心的偏角
  const sign = d < 0 ? -1 : 1;
  const a = Math.abs(d);
  let offset;
  if (a < HALF_PI * 0.5) {
    offset = (a / (HALF_PI * 0.5)) * (FRONT_SHARE / 2);
  } else if (a < HALF_PI * 1.5) {
    offset = FRONT_SHARE / 2 + ((a - HALF_PI * 0.5) / Math.PI) * SIDE_SHARE;
  } else {
    offset = FRONT_SHARE / 2 + SIDE_SHARE + ((a - HALF_PI * 1.5) / (HALF_PI * 0.5)) * (FRONT_SHARE / 2);
  }
  return 0.5 + sign * offset;
}

// 头部：脸固定在 u = 0.5，接缝藏在后脑勺
export function headU(angle) {
  return 0.5 + wrapPi(angle) / (Math.PI * 2);
}

// 号码区域（u 空间）：背号居中，胸前小号码在接缝右侧
export const TORSO_BACK = Object.freeze({ center: 0.5, width: FRONT_SHARE });
export const TORSO_FRONT = Object.freeze({ leftEdge: 0, rightEdge: 1, width: FRONT_SHARE });
export const TORSO_SIDE_SHARE = SIDE_SHARE;
