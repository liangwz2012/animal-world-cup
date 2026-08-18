const { entry } = require("./administrative-regions");

const LEVELS = Object.freeze(["province", "city", "county", "town"]);
const SCOPE_LEVELS = Object.freeze({
  province: { key: "CN:province", title: "全国省队榜", childLevel: "province" },
  city: { suffix: "city", title: "城市榜", childLevel: "city" },
  county: { suffix: "county", title: "区县榜", childLevel: "county" },
  town: { suffix: "town", title: "乡镇榜", childLevel: "town" },
});

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function safeLabel(value, max = 18) {
  return text(value).replace(/[\u0000-\u001f]/g, "").slice(0, max);
}

function validScopeKey(value) {
  const key = text(value);
  return key === "CN:province" || /^\d{6}:(?:city|county|town)$/.test(key) ? key : "";
}

function snapshotRegion(input) {
  const source = input && typeof input === "object" ? input : {};
  const scope = source.scope && typeof source.scope === "object" ? source.scope : {};
  const level = LEVELS.includes(source.level) ? source.level : "";
  const code = text(source.code);
  const scopeKey = validScopeKey(scope.key);
  if (!level || !code || !scopeKey) return null;
  return {
    version: 1,
    code,
    name: safeLabel(source.name),
    officialName: safeLabel(source.officialName),
    level,
    scope: {
      key: scopeKey,
      title: safeLabel(scope.title),
      childLevel: LEVELS.includes(scope.childLevel) ? scope.childLevel : level,
      parentCode: text(scope.parentCode),
    },
  };
}

async function scopeFor(place, options) {
  const definition = SCOPE_LEVELS[place.level];
  if (!definition) throw new Error("地区层级不支持排行榜");
  if (place.level === "province") {
    return {
      key: definition.key,
      title: definition.title,
      childLevel: definition.childLevel,
      parentCode: "CN",
    };
  }
  const parent = await entry(place.parentCode, options);
  if (!parent) throw new Error("地区上级信息不完整");
  return {
    key: `${place.parentCode}:${definition.suffix}`,
    title: `${parent.shortName}${definition.title}`,
    childLevel: definition.childLevel,
    parentCode: place.parentCode,
  };
}

// 只接受用户主动挑选的官方行政区代码；不读取 GPS，也不把多级名称拼成可识别住址。
async function createRegionalTeam(input, options) {
  const source = input && typeof input === "object" ? input : {};
  const code = text(source.code || source.locationCode);
  const place = await entry(code, options);
  if (!place || !LEVELS.includes(place.level)) throw new Error("请选择有效的省、市、县区或乡镇");
  const scope = await scopeFor(place, options);
  return snapshotRegion({
    version: 1,
    code: place.code,
    name: place.shortName,
    officialName: place.name,
    level: place.level,
    scope,
  });
}

module.exports = {
  LEVELS,
  SCOPE_LEVELS,
  createRegionalTeam,
  snapshotRegion,
  validScopeKey,
};
