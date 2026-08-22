const HOME_REGION_STORAGE_KEY = "rural-football:home-region:v1";
const LEVELS = new Set(["province", "city", "county", "town"]);

function clean(value, max = 32) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max)
    : "";
}

function normalizeHomeRegionStorage(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const path = (Array.isArray(source.path) ? source.path : [])
    .slice(0, 4)
    .map((item) => {
      const row = item && typeof item === "object" ? item : {};
      const code = clean(row.code, 18);
      const level = clean(row.level, 12);
      if (!code || !LEVELS.has(level)) return null;
      return {
        code,
        parentCode: clean(row.parentCode, 18),
        level,
        name: clean(row.name, 32),
        shortName: clean(row.shortName || row.name, 18),
      };
    })
    .filter(Boolean);
  if (!path.length || path[0].level !== "province") return null;
  return {
    version: 1,
    path,
    customName: clean(source.customName, 18),
  };
}

function readHomeRegionStorage(wxApi) {
  try {
    if (!wxApi || typeof wxApi.getStorageSync !== "function") return null;
    const stored = wxApi.getStorageSync(HOME_REGION_STORAGE_KEY);
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    return normalizeHomeRegionStorage(parsed);
  } catch (error) {
    return null;
  }
}

function writeHomeRegionStorage(wxApi, region) {
  const normalized = normalizeHomeRegionStorage(region);
  if (!normalized || !wxApi || typeof wxApi.setStorageSync !== "function") return false;
  try {
    wxApi.setStorageSync(HOME_REGION_STORAGE_KEY, normalized);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  HOME_REGION_STORAGE_KEY,
  normalizeHomeRegionStorage,
  readHomeRegionStorage,
  writeHomeRegionStorage,
};
