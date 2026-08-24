const SHARE_REGION_VERSION = 1;
const VERSION_KEY = "rfv";
const REGION_KEY = "rh";
const CODE_PATTERN = /^\d{6,18}$/;

function cleanQuery(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const query = source.query && typeof source.query === "object" && !Array.isArray(source.query)
    ? source.query
    : source;
  return query;
}

function sharedRegionCodes(region) {
  const path = region && Array.isArray(region.path) ? region.path : [];
  const normalized = path.map((item) => {
    const source = item && typeof item === "object" ? item : {};
    const code = String(source.code || "").trim();
    const level = String(source.level || "").trim();
    return CODE_PATTERN.test(code) && ["province", "city", "county", "town"].includes(level)
      ? { code, level }
      : null;
  }).filter(Boolean);
  if (!normalized.length || normalized[0].level !== "province") return [];
  if (normalized[normalized.length - 1].level === "town") normalized.pop();
  return normalized.slice(0, 3).map((item) => item.code);
}

function buildShareRegionQuery(region) {
  const codes = sharedRegionCodes(region);
  return codes.length ? `${VERSION_KEY}=${SHARE_REGION_VERSION}&${REGION_KEY}=${codes.join(".")}` : "";
}

function parseShareRegionQuery(input) {
  const query = cleanQuery(input);
  const version = String(query[VERSION_KEY] || "").trim();
  const raw = String(query[REGION_KEY] || "").trim();
  if (!version && !raw) return { ok: false, reason: "missing" };
  if (version !== String(SHARE_REGION_VERSION)) return { ok: false, reason: "unsupported_version" };
  if (!raw || raw.length > 60 || !/^\d{6,18}(?:\.\d{6,18}){0,2}$/.test(raw)) {
    return { ok: false, reason: "invalid_region" };
  }
  const codes = raw.split(".");
  return {
    ok: true,
    version: SHARE_REGION_VERSION,
    codes,
    key: codes.join("."),
  };
}

function shareRegionContextForLaunch(input) {
  const query = cleanQuery(input);
  if (typeof query.invite === "string" && query.invite.trim()) {
    return { ok: false, reason: "friend_invite" };
  }
  return parseShareRegionQuery(query);
}

function appendShareRegionQuery(baseQuery, region) {
  const regional = buildShareRegionQuery(region);
  const base = String(baseQuery || "").trim().replace(/^[?&]+|[&]+$/g, "");
  return [base, regional].filter(Boolean).join("&");
}

module.exports = {
  REGION_KEY,
  SHARE_REGION_VERSION,
  VERSION_KEY,
  appendShareRegionQuery,
  buildShareRegionQuery,
  parseShareRegionQuery,
  shareRegionContextForLaunch,
  sharedRegionCodes,
};
