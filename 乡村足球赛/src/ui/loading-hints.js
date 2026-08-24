const LOADING_HINT_INTERVAL_MS = 2400;
const DEFAULT_LOADING_HINTS = Object.freeze([
  "正在加载比赛场景",
  "正在准备球员与球场",
  "观众正在入场",
  "加载仍在进行，请稍后",
]);

function buildLoadingHints(primary) {
  const first = String(primary || DEFAULT_LOADING_HINTS[0]).trim() || DEFAULT_LOADING_HINTS[0];
  return [first, ...DEFAULT_LOADING_HINTS.slice(1)].filter((value, index, list) => list.indexOf(value) === index);
}

function loadingHintForElapsed(primary, elapsedMs, intervalMs = LOADING_HINT_INTERVAL_MS) {
  const hints = buildLoadingHints(primary);
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const interval = Math.max(400, Number(intervalMs) || LOADING_HINT_INTERVAL_MS);
  return hints[Math.floor(elapsed / interval) % hints.length];
}

module.exports = {
  DEFAULT_LOADING_HINTS,
  LOADING_HINT_INTERVAL_MS,
  buildLoadingHints,
  loadingHintForElapsed,
};
