const { parseRuralScopeKey } = require("./region-league");
const { regionIdentity } = require("./region-identity");

const METRICS = new Set(["points", "goals", "winRate"]);

const NATIONAL_TOWN_SEEDS = Object.freeze([
  ["520121104000", ["贵州省", "贵阳市", "开阳县", "楠木渡镇"]],
  ["530124105000", ["云南省", "昆明市", "富民县", "东村镇"]],
  ["350121105000", ["福建省", "福州市", "闽侯县", "青口镇"]],
  ["430121109000", ["湖南省", "长沙市", "长沙县", "高桥镇"]],
  ["450123103000", ["广西壮族自治区", "南宁市", "隆安县", "那桐镇"]],
  ["510121113000", ["四川省", "成都市", "金堂县", "竹篙镇"]],
  ["370124105000", ["山东省", "济南市", "平阴县", "洪范池镇"]],
  ["340121106000", ["安徽省", "合肥市", "长丰县", "下塘镇"]],
]);

const XINYI_TOWN_SEEDS = Object.freeze([
  ["440983101000", "镇隆镇"], ["440983102000", "水口镇"], ["440983105000", "丁堡镇"],
  ["440983106000", "池洞镇"], ["440983112000", "贵子镇"], ["440983113000", "怀乡镇"],
  ["440983116000", "白石镇"], ["440983122000", "钱排镇"],
].map(([code, town]) => [code, ["广东省", "茂名市", "信宜市", town]]));

const LEVELS = ["province", "city", "county", "town"];

function seedPath(code, names) {
  const values = Array.isArray(names) ? names : [];
  const codes = [code.slice(0, 2) + "0000", code.slice(0, 4) + "00", code.slice(0, 6), code];
  return values.slice(0, 4).map((name, index) => ({
    code: codes[index],
    parentCode: index ? codes[index - 1] : "",
    level: LEVELS[index],
    name,
    officialName: name,
    shortName: String(name).replace(/(?:壮族自治区|自治区|自治州|自治县|省|市|区|县|镇|乡)$/u, ""),
  }));
}

function seedPlace([code, names]) {
  const identity = regionIdentity(seedPath(code, names), "");
  return {
    code: `${code}|乡亲联队`,
    townCode: code,
    fullTeamName: identity.fullTeamName,
    path: identity.path,
    level: "town",
  };
}

const NATIONAL_PLACES = Object.freeze(NATIONAL_TOWN_SEEDS.map(seedPlace));
const LOCAL_PLACES = Object.freeze(XINYI_TOWN_SEEDS.map(seedPlace));

function stableHash(value) {
  let hash = 2166136261;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scopeCandidates(scopeKey) {
  const scope = parseRuralScopeKey(scopeKey);
  if (!scope) return [];
  if (scope.kind === "nation") return NATIONAL_PLACES.slice();
  return LOCAL_PLACES.concat(NATIONAL_PLACES)
    .filter((place) => place.path.some((item) => item.code === scope.code));
}

function scopeTitle(scopeKey) {
  const scope = parseRuralScopeKey(scopeKey);
  if (!scope) return "乡村足球荣耀榜";
  if (scope.kind === "nation") return "全国乡村榜";
  const place = LOCAL_PLACES.concat(NATIONAL_PLACES)
    .flatMap((item) => item.path)
    .find((item) => item.code === scope.code);
  if (!place) return scope.kind === "town" ? "我的乡镇村队榜" : "我的地区乡村榜";
  return `${place.shortName}${scope.kind === "town" ? "村队榜" : "乡村榜"}`;
}

function seedStats(code, index) {
  const hash = stableHash(`rural-honor-seed|${code}`);
  const matches = 16 + hash % 19;
  const wins = Math.min(matches - 2, 7 + (hash >>> 5) % Math.max(5, matches - 9));
  const draws = Math.min(matches - wins, 2 + (hash >>> 11) % 5);
  const losses = Math.max(0, matches - wins - draws);
  const goalsFor = wins * 2 + draws + 5 + (hash >>> 15) % 13;
  return {
    matches,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst: losses * 2 + draws + 3 + (hash >>> 20) % 8,
    cleanSheets: 2 + (hash >>> 23) % Math.max(2, Math.min(7, wins)),
    points: wins * 3 + draws,
    currentWinStreak: index % 3,
    bestWinStreak: 2 + (hash >>> 26) % 6,
    updatedAt: 0,
  };
}

function metricValue(stats, metric) {
  if (metric === "goals") return stats.goalsFor;
  if (metric === "winRate") return stats.matches ? Math.round(stats.wins * 1000 / stats.matches) / 10 : 0;
  return stats.points;
}

function sortRows(rows) {
  return rows.slice().sort((left, right) => right.value - left.value
    || Number(right.stats && right.stats.points || 0) - Number(left.stats && left.stats.points || 0)
    || String(left.teamName || left.nickname).localeCompare(String(right.teamName || right.nickname), "zh-Hans-CN"));
}

function regionalSeedLeaderboard(scopeKey, metric, limit = 8) {
  const selectedMetric = METRICS.has(metric) ? metric : "points";
  const rows = scopeCandidates(scopeKey).map((place, index) => {
    const stats = seedStats(place.code, index);
    return {
      code: place.code,
      self: false,
      nickname: place.fullTeamName,
      teamName: place.fullTeamName,
      fullTeamName: place.fullTeamName,
      path: place.path,
      teamLevel: "town",
      contributors: 2 + stableHash(place.townCode) % 7,
      value: metricValue(stats, selectedMetric),
      stats: { matches: stats.matches, wins: stats.wins, goalsFor: stats.goalsFor, points: stats.points },
      baseline: true,
    };
  });
  return {
    metric: selectedMetric,
    scope: { key: scopeKey, title: scopeTitle(scopeKey) },
    rows: sortRows(rows).slice(0, Math.max(0, limit)).map((row, index) => ({ ...row, rank: index + 1 })),
  };
}

function mergeRegionalSeedRows(realRows, scopeKey, metric, target = 8) {
  const real = Array.isArray(realRows) ? realRows.slice() : [];
  const realCodes = new Set(real.map((row) => row && row.code).filter(Boolean));
  const seed = regionalSeedLeaderboard(scopeKey, metric, target).rows
    .filter((row) => !realCodes.has(row.code))
    .slice(0, Math.max(0, target - real.length));
  const rows = sortRows([...real, ...seed]).map((row, index) => ({ ...row, rank: index + 1 }));
  return { metric: METRICS.has(metric) ? metric : "points", scope: { key: scopeKey, title: scopeTitle(scopeKey) }, rows };
}

module.exports = {
  NATIONAL_TOWN_SEEDS,
  XINYI_TOWN_SEEDS,
  mergeRegionalSeedRows,
  regionalSeedLeaderboard,
  scopeCandidates,
  scopeTitle,
};
