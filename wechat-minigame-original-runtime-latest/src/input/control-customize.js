// 玩家自定义触控位置的持久化与几何工具。
// 位置以“屏幕归一化中心坐标”(nx, ny ∈ [0,1]) 存储，而非物理像素——
// 这样换机型 / 横竖屏 / 分辨率变化后，自定义位置仍按比例落在同样的相对位置。
// 存储结构：{ stick: {nx, ny} | null, pad: {nx, ny} | null }
// stick = 方向波轮中心；pad = 右侧动作键群(五键)整体中心(即中央冲刺键位置)。

const STORAGE_KEY = "animalCup.controls.v1";

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function sanitizePoint(point) {
  if (!point || typeof point !== "object") return null;
  const nx = clamp01(point.nx);
  const ny = clamp01(point.ny);
  if (nx == null || ny == null) return null;
  return { nx, ny };
}

function sanitizeOverrides(raw) {
  if (!raw || typeof raw !== "object") return {};
  const result = {};
  const stick = sanitizePoint(raw.stick);
  const pad = sanitizePoint(raw.pad);
  if (stick) result.stick = stick;
  if (pad) result.pad = pad;
  return result;
}

function readStorage(globalObject) {
  const store = globalObject && globalObject.localStorage;
  if (!store || typeof store.getItem !== "function") return null;
  try { return store.getItem(STORAGE_KEY); } catch (error) { return null; }
}

function writeStorage(globalObject, value) {
  const store = globalObject && globalObject.localStorage;
  if (!store || typeof store.setItem !== "function") return;
  try { store.setItem(STORAGE_KEY, value); } catch (error) {}
}

// 读出已保存的自定义位置；没有 / 损坏时返回空对象(=用默认自适配布局)。
function load(globalObject) {
  const raw = readStorage(globalObject);
  if (!raw) return {};
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (error) { return {}; }
  return sanitizeOverrides(parsed);
}

function save(globalObject, overrides) {
  const clean = sanitizeOverrides(overrides);
  writeStorage(globalObject, JSON.stringify(clean));
  return clean;
}

// 恢复默认：清空自定义，回落到自适配布局。
function reset(globalObject) {
  writeStorage(globalObject, JSON.stringify({}));
  return {};
}

// 把某一簇控件中心的物理像素坐标转成归一化，写入 overrides 的对应键。
function setCenter(overrides, kind, centerX, centerY, width, height) {
  const next = sanitizeOverrides(overrides);
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const point = sanitizePoint({ nx: centerX / w, ny: centerY / h });
  if (!point) return next;
  if (kind === "stick" || kind === "pad") next[kind] = point;
  return next;
}

module.exports = { STORAGE_KEY, load, save, reset, setCenter, sanitizeOverrides };
