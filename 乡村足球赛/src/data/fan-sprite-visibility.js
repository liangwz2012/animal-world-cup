function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function snapshot(sprites) {
  const state = Object.create(null);
  const source = sprites && typeof sprites === "object" ? sprites : {};
  for (const key in source) {
    if (!own(source, key)) continue;
    const sprite = source[key];
    state[key] = sprite && typeof sprite === "object" ? sprite.visible !== false : null;
  }
  return state;
}

function hideHead(sprites) {
  const head = sprites && sprites.head;
  if (head && typeof head === "object") head.visible = false;
}

function showOnlyHead(sprites) {
  const source = sprites && typeof sprites === "object" ? sprites : {};
  for (const key in source) {
    if (!own(source, key)) continue;
    const sprite = source[key];
    if (!sprite || typeof sprite !== "object") continue;
    sprite.visible = key === "head";
  }
}

function restore(sprites, state) {
  const source = sprites && typeof sprites === "object" ? sprites : {};
  const saved = state && typeof state === "object" ? state : {};
  for (const key in source) {
    if (!own(source, key)) continue;
    const sprite = source[key];
    if (!sprite || typeof sprite !== "object" || saved[key] == null) continue;
    sprite.visible = !!saved[key];
  }
}

function createFanSpriteVisibilityBridge() {
  return Object.freeze({ snapshot, hideHead, showOnlyHead, restore });
}

module.exports = {
  createFanSpriteVisibilityBridge,
  hideHead,
  restore,
  showOnlyHead,
  snapshot,
};
