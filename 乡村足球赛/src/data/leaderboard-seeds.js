const snapshot = require("./china-administrative-core");

const METRICS = new Set(["points", "wins", "goals", "winRate", "cleanSheets", "streak"]);
const DIRECT_MUNICIPALITIES = new Set(["11", "12", "31", "50"]);
const TOWN_SEEDS = Object.freeze({
  "440983": Object.freeze([
    ["440983101000", "镇隆镇"], ["440983102000", "水口镇"], ["440983105000", "丁堡镇"],
    ["440983106000", "池洞镇"], ["440983112000", "贵子镇"], ["440983113000", "怀乡镇"],
    ["440983116000", "白石镇"], ["440983122000", "钱排镇"],
  ]),
});

function compactName(value) {
  return String(value || "")
    .replace(/(?:特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|自治县|街道办事处|街道|省|市|区|县|旗|镇|乡)$/u, "")
    || String(value || "");
}

function stableHash(value) {
  let hash = 2166136261;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function areaParentCode(row) {
  const province = String(row && row.p || "");
  const city = String(row && row.y || "");
  if (DIRECT_MUNICIPALITIES.has(province) || city === "90") return `${province}0000`;
  return `${province}${city}00`;
}

function scopeCandidates(scopeKey) {
  const key = String(scopeKey || "");
  if (key === "CN:province") {
    return (snapshot.provinces || []).map((row) => ({ code: row.c, name: compactName(row.n), level: "province" }));
  }
  const match = key.match(/^(\d{6}):(city|county|town)$/);
  if (!match) return [];
  const parentCode = match[1];
  const level = match[2];
  if (level === "city") {
    return (snapshot.cities || [])
      .filter((row) => `${row.p}0000` === parentCode)
      .map((row) => ({ code: row.c, name: compactName(row.n), level }));
  }
  if (level === "county") {
    return (snapshot.areas || [])
      .filter((row) => areaParentCode(row) === parentCode && !/市辖区|直辖县级行政区划/.test(row.n))
      .map((row) => ({ code: row.c, name: compactName(row.n), level }));
  }
  return (TOWN_SEEDS[parentCode] || []).map(([code, name]) => ({ code, name: compactName(name), level }));
}

function parentName(code) {
  const all = [...(snapshot.provinces || []), ...(snapshot.cities || []), ...(snapshot.areas || [])];
  const row = all.find((item) => item.c === code);
  return row ? compactName(row.n) : "地区";
}

function scopeTitle(scopeKey) {
  if (scopeKey === "CN:province") return "全国省队榜";
  const match = String(scopeKey || "").match(/^(\d{6}):(city|county|town)$/);
  if (!match) return "地区战队榜";
  return `${parentName(match[1])}${{ city: "城市榜", county: "区县榜", town: "乡镇榜" }[match[2]]}`;
}

function seedStats(code, index) {
  const hash = stableHash(`rural-league-seed|${code}`);
  const matches = 16 + hash % 19;
  const wins = Math.min(matches - 2, 7 + (hash >>> 5) % Math.max(5, matches - 9));
  const draws = Math.min(matches - wins, 2 + (hash >>> 11) % 5);
  const losses = Math.max(0, matches - wins - draws);
  const goalsFor = wins * 2 + draws + 5 + (hash >>> 15) % 13;
  const goalsAgainst = losses * 2 + draws + 3 + (hash >>> 20) % 8;
  const cleanSheets = 2 + (hash >>> 23) % Math.max(2, Math.min(7, wins));
  const bestWinStreak = 2 + (hash >>> 26) % 6;
  return {
    matches, wins, draws, losses, goalsFor, goalsAgainst, cleanSheets,
    points: wins * 3 + draws,
    currentWinStreak: index % 3,
    bestWinStreak,
    updatedAt: 0,
  };
}

function metricValue(stats, metric) {
  if (metric === "wins") return stats.wins;
  if (metric === "goals") return stats.goalsFor;
  if (metric === "winRate") return stats.matches ? Math.round(stats.wins * 1000 / stats.matches) / 10 : 0;
  if (metric === "cleanSheets") return stats.cleanSheets;
  if (metric === "streak") return stats.bestWinStreak;
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
      nickname: place.name,
      teamName: place.name,
      teamLevel: place.level,
      contributors: 2 + stableHash(place.code) % 7,
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
  TOWN_SEEDS,
  mergeRegionalSeedRows,
  regionalSeedLeaderboard,
  scopeCandidates,
  scopeTitle,
};

