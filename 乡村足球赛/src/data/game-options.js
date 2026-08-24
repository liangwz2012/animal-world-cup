// id 暂时保留英文键以兼容底层引擎的球队贴图索引；界面只展示乡村球队模板，
// 地区选择完成后会由省/市/县/镇或自定义队名覆盖。
const TEAMS = [
  { id: "england", name: "红衫队", country: "乡村联队", color: 0xc54539 },
  { id: "france", name: "蓝衫队", country: "乡村联队", color: 0x2858ad },
  { id: "germany", name: "墨金队", country: "乡村联队", color: 0x29231d },
  { id: "spain", name: "枣红队", country: "乡村联队", color: 0xc83f35 },
  { id: "portugal", name: "青禾队", country: "乡村联队", color: 0x176d49 },
  { id: "brazil", name: "麦穗队", country: "乡村联队", color: 0xedcf49 },
  { id: "argentina", name: "天蓝队", country: "乡村联队", color: 0x8ed3f3 },
  { id: "usa", name: "深蓝队", country: "乡村联队", color: 0x263f7b },
];

// 已随包发布（已过审）的默认队列快照，作为远程配置的兜底基线。
const DEFAULT_TEAMS = TEAMS.map((team) => Object.assign({}, team));

function parseColor(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value >>> 0;
  if (typeof value === "string") {
    const hex = value.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
  }
  return null;
}

// 远程只能覆盖"已随包发布"的队伍的名字/副标题/颜色/启用/排序，
// 不接受本地不存在的新 id —— 从代码层堵住"云端下发未审核新内容"的合规红线。
// 任何非法或有效队伍不足 2 支的配置一律忽略，回落到本地已审核默认队列。
function applyTeamOverrides(remoteTeams) {
  if (!Array.isArray(remoteTeams) || remoteTeams.length === 0) return false;
  const byId = new Map();
  for (const item of remoteTeams) {
    if (item && typeof item.id === "string") byId.set(item.id, item);
  }
  const merged = DEFAULT_TEAMS.map((base, index) => {
    const patch = byId.get(base.id) || {};
    const next = Object.assign({}, base);
    if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim().slice(0, 12);
    if (typeof patch.country === "string" && patch.country.trim()) next.country = patch.country.trim().slice(0, 12);
    const color = parseColor(patch.color);
    if (color != null) next.color = color;
    next.enabled = patch.enabled !== false;
    next.order = Number.isFinite(patch.order) ? patch.order : index;
    return next;
  });
  const active = merged
    .filter((team) => team.enabled)
    .sort((a, b) => a.order - b.order);
  if (active.length < 2) return false;
  TEAMS.length = 0;
  for (const team of active) {
    TEAMS.push({ id: team.id, name: team.name, country: team.country, color: team.color });
  }
  return true;
}

const FORMATIONS = [
  { name: "2-3-1", spots: [[3, 2, "D"], [3, 6, "D"], [5, 1, "M"], [5, 4, "M"], [5, 7, "M"], [7, 4, "A"]] },
  { name: "3-2-1", spots: [[3, 1, "D"], [3, 4, "D"], [3, 7, "D"], [5, 2, "M"], [5, 6, "M"], [7, 4, "A"]] },
  { name: "2-2-2", spots: [[3, 2, "D"], [3, 6, "D"], [5, 2, "M"], [5, 6, "M"], [7, 2, "A"], [7, 6, "A"]] },
  { name: "3-1-2", spots: [[3, 1, "D"], [3, 4, "D"], [3, 7, "D"], [5, 4, "M"], [7, 2, "A"], [7, 6, "A"]] },
  { name: "1-3-2", spots: [[3, 4, "D"], [5, 1, "M"], [5, 4, "M"], [5, 7, "M"], [7, 2, "A"], [7, 6, "A"]] },
  { name: "2-1-3", spots: [[3, 2, "D"], [3, 6, "D"], [5, 4, "M"], [7, 1, "A"], [7, 4, "A"], [7, 7, "A"]] },
];

const DIFFICULTIES = [
  { value: 0, label: "简单" },
  { value: 1, label: "普通" },
  { value: 2, label: "困难" },
];

const TIMES = [
  { value: 4, label: "短" },
  { value: 6, label: "标准" },
  { value: 10, label: "长" },
];

const CAPTAIN_BODY_PROFILES = Object.freeze([
  "balanced",
  "tall-slim",
  "compact-strong",
  "tall-strong",
  "large",
]);

const REGION_LEVELS = Object.freeze(["province", "city", "county", "town"]);

function normalizeJerseyText(value, limit) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return Array.from(String(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>`{}\\]/g, "")
    .replace(/\s+/g, "")
    .trim())
    .slice(0, limit || 18)
    .join("");
}

function normalizeRegionEntry(input) {
  const source = input && typeof input === "object" ? input : {};
  const level = REGION_LEVELS.includes(source.level) ? source.level : "";
  const code = typeof source.code === "string" ? source.code.trim() : "";
  const expectedCode = level === "town" ? /^\d{12}$/ : /^\d{6}$/;
  if (!level || !expectedCode.test(code)) return null;
  const parentCode = typeof source.parentCode === "string" ? source.parentCode.trim() : "";
  const name = normalizeJerseyText(source.name, 24);
  const shortName = normalizeJerseyText(source.shortName || source.name, 18);
  if (!shortName) return null;
  return { code, parentCode, level, name: name || shortName, shortName };
}

function normalizeRegionTeam(input, fallback) {
  const source = input && typeof input === "object" ? input : {};
  const defaults = fallback && typeof fallback === "object" ? fallback : {};
  const pathSource = Array.isArray(source.path) ? source.path : Array.isArray(defaults.path) ? defaults.path : [];
  const path = [];
  for (const raw of pathSource) {
    const item = normalizeRegionEntry(raw);
    if (!item) continue;
    const expectedLevel = REGION_LEVELS[path.length];
    if (item.level !== expectedLevel) break;
    if (path.length && item.parentCode !== path[path.length - 1].code) break;
    path.push(item);
    if (path.length >= REGION_LEVELS.length) break;
  }
  const customName = normalizeJerseyText(
    Object.prototype.hasOwnProperty.call(source, "customName") ? source.customName : defaults.customName,
    18,
  );
  const leaf = path[path.length - 1] || null;
  const displayName = customName || (leaf && leaf.shortName) || normalizeJerseyText(source.displayName || defaults.displayName, 18) || "";
  return {
    path,
    customName,
    displayName,
    leafCode: leaf ? leaf.code : "",
    leafLevel: leaf ? leaf.level : "",
    fallback: !!source.fallback,
    fallbackReason: normalizeJerseyText(source.fallbackReason || source.reason, 48),
    opponentNonce: Math.max(0, Math.floor(Number(source.opponentNonce) || 0)),
  };
}

function regionJersey(region, current, fallbackNumber) {
  const normalized = normalizeRegionTeam(region);
  const leafCodes = normalized.path.slice(-2).map((item) => item.code);
  return normalizeJersey(Object.assign({}, current || {}, {
    customName: normalized.customName,
    locationLabel: normalized.displayName,
    locationCodes: leafCodes,
    number: Number(current && current.number) || fallbackNumber,
  }), { number: fallbackNumber });
}

function normalizeJersey(input, fallback) {
  const source = input && typeof input === "object" ? input : {};
  const defaults = fallback || {};
  const number = Math.round(Number(source.number));
  const locationCodes = Array.from(new Set((Array.isArray(source.locationCodes) ? source.locationCodes : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{6}(?:\d{6})?$/.test(value))))
    .slice(0, 2);
  return {
    province: normalizeJerseyText(source.province, 12),
    cityOrCounty: normalizeJerseyText(source.cityOrCounty || source.city || source.county, 12),
    village: normalizeJerseyText(source.village, 12),
    customName: normalizeJerseyText(source.customName || source.name || defaults.customName, 18),
    // 行政区代码只保留一层或相邻两层；显示文字在开赛前按本地数据快照解析。
    locationCodes,
    locationLabel: normalizeJerseyText(source.locationLabel, 18),
    number: Number.isFinite(number) && number >= 1 && number <= 99
      ? number
      : (Number.isFinite(Number(defaults.number)) ? Number(defaults.number) : 0),
  };
}

function defaults() {
  return {
    redTeam: "argentina",
    blueTeam: "portugal",
    redFormation: FORMATIONS[0].name,
    blueFormation: FORMATIONS[1].name,
    side: "home",
    ai: 0,
    time: 4,
    mode: "ai",
    roomId: "",
    redCaptainProfile: "large",
    // 首次打开不预填开发者家乡。四级入口始终可见，乡镇分包只在用户选到县后按需加载。
    redRegion: { path: [], customName: "", displayName: "" },
    blueRegion: { path: [], customName: "", displayName: "" },
    redJersey: { locationCodes: [], locationLabel: "", number: 7 },
    blueJersey: { locationCodes: [], locationLabel: "", number: 9 },
  };
}

function byValue(items, value, key) {
  return items.some((item) => item[key] === value) ? value : items[0][key];
}

function normalizeConfig(input) {
  const provided = input && typeof input === "object" ? input : {};
  const base = Object.assign(defaults(), provided);
  base.redTeam = byValue(TEAMS, base.redTeam, "id");
  base.blueTeam = byValue(TEAMS, base.blueTeam, "id");
  if (base.blueTeam === base.redTeam) {
    base.blueTeam = TEAMS.find((team) => team.id !== base.redTeam).id;
  }
  base.redFormation = byValue(FORMATIONS, base.redFormation, "name");
  base.blueFormation = byValue(FORMATIONS, base.blueFormation, "name");
  base.ai = byValue(DIFFICULTIES, Number(base.ai), "value");
  base.time = byValue(TIMES, Number(base.time), "value");
  base.side = base.side === "away" ? "away" : "home";
  base.mode = ["ai", "friend", "watch"].includes(base.mode) ? base.mode : "ai";
  base.roomId = typeof base.roomId === "string" ? base.roomId.trim().slice(0, 96) : "";
  base.redCaptainProfile = CAPTAIN_BODY_PROFILES.includes(base.redCaptainProfile)
    ? base.redCaptainProfile
    : "large";
  const baseline = defaults();
  base.redRegion = normalizeRegionTeam(base.redRegion, baseline.redRegion);
  base.blueRegion = normalizeRegionTeam(base.blueRegion, baseline.blueRegion);
  // 兼容旧版本只写 redJersey/blueJersey.customName 的本地配置；显式提供地区状态时，
  // 始终以新的地区状态为准。
  if (!Object.prototype.hasOwnProperty.call(provided, "redRegion") && provided.redJersey && provided.redJersey.customName) {
    base.redRegion = normalizeRegionTeam(Object.assign({}, base.redRegion, { customName: provided.redJersey.customName }), baseline.redRegion);
  }
  if (!Object.prototype.hasOwnProperty.call(provided, "blueRegion") && provided.blueJersey && provided.blueJersey.customName) {
    base.blueRegion = normalizeRegionTeam(Object.assign({}, base.blueRegion, { customName: provided.blueJersey.customName }), baseline.blueRegion);
  }
  base.redJersey = regionJersey(base.redRegion, normalizeJersey(base.redJersey, baseline.redJersey), baseline.redJersey.number);
  base.blueJersey = regionJersey(base.blueRegion, normalizeJersey(base.blueJersey, baseline.blueJersey), baseline.blueJersey.number);
  return base;
}

function formation(name) {
  return FORMATIONS.find((item) => item.name === name) || FORMATIONS[0];
}

function cycle(items, value, key, direction) {
  const index = Math.max(0, items.findIndex((item) => item[key] === value));
  const next = (index + (direction || 1) + items.length) % items.length;
  return items[next][key];
}

module.exports = {
  TEAMS,
  DEFAULT_TEAMS,
  FORMATIONS,
  DIFFICULTIES,
  TIMES,
  CAPTAIN_BODY_PROFILES,
  defaults,
  normalizeJersey,
  normalizeRegionTeam,
  regionJersey,
  normalizeConfig,
  formation,
  cycle,
  applyTeamOverrides,
};
