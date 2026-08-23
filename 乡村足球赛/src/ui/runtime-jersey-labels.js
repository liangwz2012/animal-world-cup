const { normalizeJerseyIdentity } = require("./dynamic-jersey");

const SIDE_SIZE = 7;

function collectPlayerRenderers(game) {
  const result = [];
  function walk(node, depth) {
    if (!node || depth > 8) return;
    if (node.spine && node.player) {
      const id = Number(node.player.id);
      if (Number.isFinite(id) && id >= 0 && id < SIDE_SIZE * 2) result.push(node);
      return;
    }
    for (const child of node.children || []) walk(child, depth + 1);
  }
  walk(game && game.stadium, 0);
  return result;
}

function displayLabel(input) {
  const identity = normalizeJerseyIdentity(input);
  return identity.frontLabel || identity.backLabel || "";
}

function labelSize(label) {
  const count = Array.from(label || "").length;
  // PlayerSpine 在进入 256×256 人物纹理前还会乘约 0.5 的根缩放；这里按最终
  // 屏幕字号反算，但不再铺号码布底，避免文字像一张硬贴纸盖住球衣。
  if (count <= 2) return { font: 20 };
  if (count <= 4) return { font: 14 };
  return { font: 11 };
}

function hierarchyMirrored(display) {
  // setDirection 往往早于下一帧 worldTransform 更新；此时沿父链累计 X/Y 缩放
  // 的符号，仍可识别“胸衣局部不翻、Spine 根节点翻转”的客队镜像情况。
  let reflected = false;
  let current = display;
  let depth = 0;
  while (current && depth < 12) {
    const scale = current.scale || {};
    const sx = Number(scale.x);
    const sy = Number(scale.y);
    if ((Number.isFinite(sx) ? sx : 1) * (Number.isFinite(sy) ? sy : 1) < 0) reflected = !reflected;
    current = current.parent;
    depth += 1;
  }
  if (depth) return reflected;
  // 极少数自定义容器不暴露 parent/scale，只能回退到已计算的世界变换。
  const transform = display && display.worldTransform;
  return !!(transform
    && Number(transform.a) * Number(transform.d) - Number(transform.b) * Number(transform.c) < 0);
}

function syncDirection(spine) {
  const shirt = spine && spine.sprites && spine.sprites.chest_shirt;
  const label = shirt && shirt.__ruralRegionLabel;
  if (!label || !label.scale) return;
  label.scale.x = hierarchyMirrored(shirt) ? -1 : 1;
}

function ensureDirectionHook(spine) {
  if (!spine || spine.__ruralRegionLabelDirectionHook || typeof spine.setDirection !== "function") return;
  const original = spine.setDirection;
  spine.setDirection = function ruralRegionLabelDirection(direction) {
    const result = original.apply(this, arguments);
    syncDirection(this);
    return result;
  };
  spine.__ruralRegionLabelDirectionHook = true;
}

function attachOne(renderer, PIXI, label) {
  const spine = renderer && renderer.spine;
  const shirt = spine && spine.sprites && spine.sprites.chest_shirt;
  if (!shirt || typeof shirt.addChild !== "function" || !PIXI || !PIXI.Container || !PIXI.Text) {
    return false;
  }
  if (shirt.__ruralRegionLabel) {
    try { shirt.removeChild(shirt.__ruralRegionLabel); } catch (error) {}
    try { shirt.__ruralRegionLabel.destroy({ children: true }); } catch (error) {}
  }
  const dimensions = labelSize(label);
  const layer = new PIXI.Container();
  const caption = new PIXI.Text(label, {
    font: `900 ${dimensions.font}px "PingFang SC", "Noto Sans CJK SC", sans-serif`,
    // 透明背景，只保留类似热转印的浅金字和深绿细描边。
    fill: 0xffe08a,
    stroke: 0x17352b,
    strokeThickness: 1.6,
    align: "center",
  });
  if (caption.anchor && typeof caption.anchor.set === "function") caption.anchor.set(0.5, 0.5);
  if (caption.position && typeof caption.position.set === "function") caption.position.set(0, 0);
  if ("resolution" in caption) caption.resolution = 2;
  if (typeof caption.updateText === "function") caption.updateText();
  caption.alpha = 0.98;
  layer.addChild(caption);
  if (layer.position && typeof layer.position.set === "function") layer.position.set(0, -3);
  shirt.addChild(layer);
  shirt.__ruralRegionLabel = layer;
  layer.__ruralRegionText = caption;
  ensureDirectionHook(spine);
  syncDirection(spine);
  return true;
}

function attachRuntimeJerseyLabels(options) {
  const config = options || {};
  const red = displayLabel(config.redJersey);
  const blue = displayLabel(config.blueJersey);
  const renderers = collectPlayerRenderers(config.game);
  let attached = 0;
  for (const renderer of renderers) {
    const id = Number(renderer.player && renderer.player.id);
    const label = id < SIDE_SIZE ? red : blue;
    if (label && attachOne(renderer, config.PIXI, label)) attached += 1;
  }
  const status = { attached, expected: renderers.length, red, blue };
  console.info(
    "[runtime-jersey-labels] attached",
    `${attached}/${renderers.length}`,
    `red=${red}`,
    `blue=${blue}`,
  );
  return status;
}

module.exports = {
  SIDE_SIZE,
  collectPlayerRenderers,
  displayLabel,
  hierarchyMirrored,
  labelSize,
  attachRuntimeJerseyLabels,
};
