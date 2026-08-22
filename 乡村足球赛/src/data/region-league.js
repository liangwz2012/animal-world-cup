const { entry, pathTo } = require("./administrative-regions");
const { regionIdentity } = require("./region-identity");

const LEVELS = Object.freeze(["province", "city", "county", "town"]);
const SCOPE_IDS = Object.freeze(["nation", "province", "city", "county", "town"]);

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function safeLabel(value, max = 18) {
  return text(value).replace(/[\u0000-\u001f]/g, "").slice(0, max);
}

function validScopeKey(value) {
  const key = text(value);
  return key === "CN:rural"
    || /^\d{6}:rural$/.test(key)
    || /^\d{12}:village$/.test(key)
    // 只为读取历史缓存保留；新 UI 和服务端不会再生成旧省队/城市榜键。
    || key === "CN:province"
    || /^\d{6}:(?:city|county|town)$/.test(key)
    ? key
    : "";
}

function pathEntry(path, level) {
  return (Array.isArray(path) ? path : []).find((item) => item && item.level === level) || null;
}

function ruralScopeOptions(region) {
  const source = region && typeof region === "object" ? region : {};
  const identity = regionIdentity(source.path, source.customName);
  const province = pathEntry(identity.path, "province");
  const city = pathEntry(identity.path, "city");
  const county = pathEntry(identity.path, "county");
  const town = pathEntry(identity.path, "town");
  const option = (id, place, suffix, title) => ({
    id,
    label: `我的${{ province: "省", city: "市", county: "县", town: "乡镇" }[id] || "地区"}`,
    key: place ? `${place.code}:${suffix}` : "",
    title: place ? `${place.shortName}${title}` : "",
    enabled: !!place,
  });
  return [
    { id: "nation", label: "全国", key: "CN:rural", title: "全国乡村榜", enabled: true },
    option("province", province, "rural", "乡村榜"),
    option("city", city, "rural", "乡村榜"),
    option("county", county, "rural", "乡村榜"),
    option("town", town, "village", "村队榜"),
  ];
}

function scopeKeyFor(region, scopeId) {
  const id = SCOPE_IDS.includes(scopeId) ? scopeId : "nation";
  const selected = ruralScopeOptions(region).find((item) => item.id === id);
  return selected && selected.enabled ? selected.key : "CN:rural";
}

function parseRuralScopeKey(scopeKey) {
  const key = validScopeKey(scopeKey);
  if (key === "CN:rural") return { key, kind: "nation", code: "CN" };
  let match = key.match(/^(\d{6}):rural$/);
  if (match) return { key, kind: "ancestor", code: match[1] };
  match = key.match(/^(\d{12}):village$/);
  if (match) return { key, kind: "town", code: match[1] };
  return null;
}

function regionMatchesScope(region, scopeKey) {
  const parsed = parseRuralScopeKey(scopeKey);
  if (!parsed) return false;
  const identity = regionIdentity(region && region.path, region && region.customName);
  const town = pathEntry(identity.path, "town");
  if (!town) return false;
  if (parsed.kind === "nation") return true;
  return identity.path.some((item) => item.code === parsed.code);
}

function regionalTeamKey(region) {
  const identity = regionIdentity(region && region.path, region && region.customName);
  const town = pathEntry(identity.path, "town");
  if (!town) return "";
  return `${town.code}|${identity.customName || "乡亲联队"}`;
}

function snapshotRegion(input) {
  const source = input && typeof input === "object" ? input : {};
  const scope = source.scope && typeof source.scope === "object" ? source.scope : {};
  const level = LEVELS.includes(source.level) ? source.level : "";
  const code = text(source.code);
  if (!level || !code) return null;
  const pathSource = Array.isArray(source.path) && source.path.length
    ? source.path
    : [{
      code,
      parentCode: scope.parentCode,
      level,
      name: source.officialName || source.name,
      shortName: source.name,
    }];
  const identity = regionIdentity(pathSource, source.customName);
  const scopes = ruralScopeOptions(identity);
  const scopeKey = validScopeKey(scope.key);
  const selectedScope = (scopeKey && scopes.find((item) => item.key === scopeKey)) || scopes[0];
  return {
    version: 1,
    code,
    name: safeLabel(source.name),
    officialName: safeLabel(source.officialName),
    customName: safeLabel(identity.customName),
    fullRegionName: safeLabel(identity.fullRegionName, 96),
    fullTeamName: safeLabel(identity.fullTeamName, 120),
    path: identity.path,
    level,
    scope: {
      key: selectedScope.key,
      title: selectedScope.title,
      childLevel: "town",
      parentCode: selectedScope.key.split(":")[0],
    },
    scopes,
  };
}

// 只接受用户主动挑选的官方行政区代码；不读取 GPS，也不把多级名称拼成可识别住址。
async function createRegionalTeam(input, options) {
  const source = input && typeof input === "object" ? input : {};
  const code = text(source.code || source.locationCode);
  const place = await entry(code, options);
  if (!place || !LEVELS.includes(place.level)) throw new Error("请选择有效的省、市、县区或乡镇");
  const path = await pathTo(place.code, options);
  const identity = regionIdentity(path, source.customName);
  return snapshotRegion({
    version: 1,
    code: place.code,
    name: place.shortName,
    officialName: place.name,
    customName: identity.customName,
    fullRegionName: identity.fullRegionName,
    fullTeamName: identity.fullTeamName,
    path: identity.path,
    level: place.level,
    scope: ruralScopeOptions(identity)[0],
  });
}

module.exports = {
  LEVELS,
  SCOPE_IDS,
  createRegionalTeam,
  parseRuralScopeKey,
  regionMatchesScope,
  regionalTeamKey,
  ruralScopeOptions,
  scopeKeyFor,
  snapshotRegion,
  validScopeKey,
};
