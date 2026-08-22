const RURAL_LEADERBOARD_METRICS = Object.freeze(["points", "goals", "winRate"]);
const RURAL_LEADERBOARD_SCOPES = Object.freeze(["nation", "province", "city", "county", "town"]);
const REGIONAL_SHARE_TOKENS = Object.freeze([
  "commonRegion", "commonProvince", "redLeaf", "blueLeaf",
  "redCompact", "blueCompact", "redFull", "blueFull",
]);

const DEFAULT_REGIONAL_SHARE_TEMPLATES = Object.freeze({
  sameCountyTemplate: "{{commonRegion}}乡村赛｜{{redLeaf}}队 VS {{blueLeaf}}队，快来踢球！",
  sameProvinceTemplate: "{{commonProvince}}乡村赛｜{{redCompact}} VS {{blueCompact}}，快来踢球！",
  crossProvinceTemplate: "全国乡村赛｜{{redCompact}} VS {{blueCompact}}，快来踢球！",
});

function object(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueAllowed(input, allowed) {
  const source = Array.isArray(input) ? input : [];
  return [...new Set(source.filter((item) => allowed.includes(item)))];
}

function normalizeRuralLeaderboardFeature(input) {
  const source = object(input);
  const metrics = uniqueAllowed(source.metrics, RURAL_LEADERBOARD_METRICS);
  const scopes = uniqueAllowed(source.scopes, RURAL_LEADERBOARD_SCOPES);
  const normalizedMetrics = metrics.length ? metrics : RURAL_LEADERBOARD_METRICS.slice();
  const normalizedScopes = scopes.length ? scopes : RURAL_LEADERBOARD_SCOPES.slice();
  const defaultScope = normalizedScopes.includes(source.defaultScope) ? source.defaultScope : "nation";
  return { enabled: source.enabled === true, metrics: normalizedMetrics, scopes: normalizedScopes, defaultScope };
}

function normalizeRegionalShareTemplate(value, fallback) {
  if (typeof value !== "string") return fallback;
  const source = value.trim();
  if (!source || Array.from(source).length > 80 || /[\u0000-\u001f\u007f<>]/u.test(source)) return fallback;
  const tokens = [...source.matchAll(/{{([A-Za-z]+)}}/g)].map((match) => match[1]);
  if (tokens.some((token) => !REGIONAL_SHARE_TOKENS.includes(token))) return fallback;
  const remainder = source.replace(/{{[A-Za-z]+}}/g, "");
  if (/[{}]/.test(remainder)) return fallback;
  return source;
}

function normalizeRegionalShareFeature(input) {
  const source = object(input);
  return {
    enabled: source.enabled !== false,
    sameCountyTemplate: normalizeRegionalShareTemplate(source.sameCountyTemplate, DEFAULT_REGIONAL_SHARE_TEMPLATES.sameCountyTemplate),
    sameProvinceTemplate: normalizeRegionalShareTemplate(source.sameProvinceTemplate, DEFAULT_REGIONAL_SHARE_TEMPLATES.sameProvinceTemplate),
    crossProvinceTemplate: normalizeRegionalShareTemplate(source.crossProvinceTemplate, DEFAULT_REGIONAL_SHARE_TEMPLATES.crossProvinceTemplate),
  };
}

module.exports = {
  DEFAULT_REGIONAL_SHARE_TEMPLATES,
  REGIONAL_SHARE_TOKENS,
  RURAL_LEADERBOARD_METRICS,
  RURAL_LEADERBOARD_SCOPES,
  normalizeRegionalShareFeature,
  normalizeRegionalShareTemplate,
  normalizeRuralLeaderboardFeature,
};
