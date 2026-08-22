const LEVELS = Object.freeze(["province", "city", "county", "town"]);

function clean(value, max = 48) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().replace(/[\u0000-\u001f\u007f<>`{}\\]/g, "").slice(0, max)
    : "";
}

function normalizeRegionPath(input) {
  const rows = Array.isArray(input) ? input : [];
  const path = [];
  for (const item of rows.slice(0, LEVELS.length)) {
    const source = item && typeof item === "object" ? item : {};
    const code = clean(source.code, 18);
    const level = clean(source.level, 12);
    const officialName = clean(source.officialName || source.name, 48);
    if (!code || !LEVELS.includes(level) || !officialName) continue;
    path.push({
      code,
      parentCode: clean(source.parentCode, 18),
      level,
      name: officialName,
      officialName,
      shortName: clean(source.shortName || officialName, 18),
    });
  }
  return path.sort((left, right) => LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level));
}

function fullRegionName(path) {
  return normalizeRegionPath(path).map((item) => item.officialName).join("");
}

function teamSuffix(customName) {
  const custom = clean(customName, 18);
  if (!custom) return "乡亲联队";
  return /队$/u.test(custom) ? custom : `${custom}队`;
}

function fullRegionTeamName(path, customName) {
  const prefix = fullRegionName(path);
  return prefix ? `${prefix}${teamSuffix(customName)}` : "乡村足球队";
}

function regionIdentity(path, customName) {
  const normalizedPath = normalizeRegionPath(path);
  const leaf = normalizedPath[normalizedPath.length - 1] || null;
  return {
    path: normalizedPath,
    customName: clean(customName, 18),
    fullRegionName: fullRegionName(normalizedPath),
    fullTeamName: fullRegionTeamName(normalizedPath, customName),
    leaf,
  };
}

module.exports = {
  LEVELS,
  cleanRegionIdentityText: clean,
  fullRegionName,
  fullRegionTeamName,
  normalizeRegionPath,
  regionIdentity,
  teamSuffix,
};
