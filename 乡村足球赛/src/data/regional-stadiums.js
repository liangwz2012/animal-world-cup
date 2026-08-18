"use strict";

const PROVINCES = Object.freeze([
  ["110000", "北京市", "北京"],
  ["120000", "天津市", "天津"],
  ["130000", "河北省", "河北"],
  ["140000", "山西省", "山西"],
  ["150000", "内蒙古自治区", "内蒙古"],
  ["210000", "辽宁省", "辽宁"],
  ["220000", "吉林省", "吉林"],
  ["230000", "黑龙江省", "黑龙江"],
  ["310000", "上海市", "上海"],
  ["320000", "江苏省", "江苏"],
  ["330000", "浙江省", "浙江"],
  ["340000", "安徽省", "安徽"],
  ["350000", "福建省", "福建"],
  ["360000", "江西省", "江西"],
  ["370000", "山东省", "山东"],
  ["410000", "河南省", "河南"],
  ["420000", "湖北省", "湖北"],
  ["430000", "湖南省", "湖南"],
  ["440000", "广东省", "广东"],
  ["450000", "广西壮族自治区", "广西"],
  ["460000", "海南省", "海南"],
  ["500000", "重庆市", "重庆"],
  ["510000", "四川省", "四川"],
  ["520000", "贵州省", "贵州"],
  ["530000", "云南省", "云南"],
  ["540000", "西藏自治区", "西藏"],
  ["610000", "陕西省", "陕西"],
  ["620000", "甘肃省", "甘肃"],
  ["630000", "青海省", "青海"],
  ["640000", "宁夏回族自治区", "宁夏"],
  ["650000", "新疆维吾尔自治区", "新疆"],
  ["710000", "台湾省", "台湾"],
  ["810000", "香港特别行政区", "香港"],
  ["820000", "澳门特别行政区", "澳门"],
]);

const THEME_SOURCE = Object.freeze({
  capital: ["京津沪现代乡郊", "courtyard-skyline", "capital-brick-red", "capital-neighbors", ["courtyard-wall", "poplar-line"]],
  "northern-plain": ["北方平原麦场", "northern-courtyard-wheat", "wheat-gold-green", "plain-neighbors", ["wheat-stack", "brick-courtyard"]],
  northeast: ["东北黑土村场", "black-soil-birch-village", "sorghum-red-green", "northeast-neighbors", ["birch-line", "grain-barn"]],
  jiangnan: ["江南水乡村场", "white-wall-water-village", "indigo-rice-green", "jiangnan-neighbors", ["white-wall-roofline", "canal-bridge"]],
  lingnan: ["岭南乡村球场", "lingnan-arcade-village", "kapok-vermilion-green", "lingnan-neighbors", ["lingnan-roofline", "orchard-banner"]],
  "southwest-mountain": ["西南山地村场", "terrace-wood-village", "terrace-green-earth", "southwest-neighbors", ["terrace-line", "wooden-village"]],
  "northwest-oasis": ["西北乡村球场", "loess-oasis-village", "earth-blue-green", "northwest-neighbors", ["loess-ridge", "oasis-poplar"]],
  plateau: ["高原乡村球场", "plateau-stone-village", "sky-blue-earth", "plateau-neighbors", ["plateau-ridge", "stone-house"]],
  coastal: ["海岛沿海村场", "coastal-fishing-village", "sea-blue-coconut-green", "coastal-neighbors", ["coastal-roofline", "windbreak-tree"]],
});

const stadiumThemes = {};
for (const themeId of Object.keys(THEME_SOURCE)) {
  const row = THEME_SOURCE[themeId];
  stadiumThemes[themeId] = Object.freeze({
    themeId,
    name: row[0],
    architectureId: row[1],
    toneId: row[2],
    audiencePoolId: row[3],
    edgeDecorationIds: Object.freeze(row[4].concat(["sideline-locality-sign"])),
  });
}
const STADIUM_THEMES = Object.freeze(stadiumThemes);

const COMMON_AUDIENCE = Object.freeze([
  Object.freeze({ id: "village-families", name: "乡亲家庭", weight: 5 }),
  Object.freeze({ id: "school-football-club", name: "乡校师生", weight: 3 }),
  Object.freeze({ id: "veteran-supporters", name: "村队老球迷", weight: 3 }),
  Object.freeze({ id: "market-neighbors", name: "集市乡亲", weight: 2 }),
  Object.freeze({ id: "returnee-youth", name: "返乡青年", weight: 3 }),
  Object.freeze({ id: "local-workers", name: "本地工友", weight: 2 }),
  Object.freeze({ id: "women-supporters", name: "女足与妇女球迷", weight: 3 }),
  Object.freeze({ id: "village-children", name: "村中少年", weight: 3 }),
]);

function regionalAudiencePool(localId, localName) {
  return Object.freeze([
    Object.freeze({ id: localId, name: localName, weight: 4 }),
    ...COMMON_AUDIENCE,
  ]);
}

const AUDIENCE_POOLS = Object.freeze({
  "capital-neighbors": regionalAudiencePool("courtyard-neighbors", "院落街坊"),
  "plain-neighbors": regionalAudiencePool("harvest-neighbors", "麦场乡亲"),
  "northeast-neighbors": regionalAudiencePool("black-soil-growers", "黑土地乡亲"),
  "jiangnan-neighbors": regionalAudiencePool("water-town-neighbors", "水乡邻里"),
  "lingnan-neighbors": regionalAudiencePool("orchard-growers", "果园乡亲"),
  "southwest-neighbors": regionalAudiencePool("terrace-growers", "山地梯田乡亲"),
  "northwest-neighbors": regionalAudiencePool("oasis-neighbors", "绿洲村民"),
  "plateau-neighbors": regionalAudiencePool("plateau-neighbors", "高原乡亲"),
  "coastal-neighbors": regionalAudiencePool("fishing-village-neighbors", "渔村乡亲"),
});

// 每个省级地区都有独立配置；同一地域家族共享几何和基础美术语言，
// 省份自己的色彩、景观与纹样由轻量叠加层体现。
const PROVINCE_PROFILES = Object.freeze({
  "110000": ["capital", "北京院落与长城山脊", "courtyard-brick", "#b5483a", "#d7b46a"],
  "120000": ["capital", "天津海河乡郊与砖院", "river-brick", "#3b718c", "#c97946"],
  "130000": ["northern-plain", "燕赵平原与太行山", "taihang-wheat", "#9b5439", "#d5a63a"],
  "140000": ["northwest-oasis", "晋北黄土与灰砖院落", "shanxi-brick", "#a25d36", "#be9a68"],
  "150000": ["northern-plain", "草原农牧村落与风带", "grassland-wind", "#3f7b66", "#d1a849"],
  "210000": ["northeast", "辽东丘陵与苹果村", "liaodong-orchard", "#4c7751", "#b64836"],
  "220000": ["northeast", "长白山林与玉米村", "changbai-corn", "#477050", "#d2a638"],
  "230000": ["northeast", "黑土地与白桦粮仓", "blacksoil-birch", "#315f4d", "#cc9534"],
  "310000": ["capital", "江南近郊水网与海派村镇", "shanghai-water", "#376f72", "#b44a3d"],
  "320000": ["jiangnan", "苏南水乡与苏北稻麦田", "jiangsu-water", "#3e7168", "#c5a954"],
  "330000": ["jiangnan", "浙东白墙黑瓦与茶山", "zhejiang-tea", "#2f7758", "#d1b05b"],
  "340000": ["jiangnan", "皖南村落与徽派马头墙", "anhui-huiwall", "#3f6659", "#b7523d"],
  "350000": ["coastal", "福建土楼剪影与茶山", "fujian-tulou", "#58723d", "#b95c35"],
  "360000": ["jiangnan", "赣鄱稻田与青砖村落", "jiangxi-rice", "#4b7b4a", "#c49a38"],
  "370000": ["northern-plain", "齐鲁麦田与石墙村", "shandong-stone", "#51704b", "#c58b36"],
  "410000": ["northern-plain", "中原麦田与豫西土寨", "henan-wheat", "#607247", "#c49b37"],
  "420000": ["jiangnan", "江汉湖田与楚地村落", "hubei-lake", "#3c776b", "#b65c43"],
  "430000": ["southwest-mountain", "湘西山村与洞庭稻田", "hunan-hill", "#49764a", "#be5d37"],
  "440000": ["lingnan", "岭南骑楼、镬耳屋与荔枝园", "lingnan-lychee", "#367546", "#c94a36"],
  "450000": ["southwest-mountain", "喀斯特峰林与稻田村落", "guangxi-karst", "#3f7a59", "#c49a3b"],
  "460000": ["coastal", "椰林、火山石与海岛村落", "hainan-coconut", "#267a70", "#d0a83f"],
  "500000": ["southwest-mountain", "巴渝山城村落与吊脚楼", "chongqing-hill", "#557044", "#b64b38"],
  "510000": ["southwest-mountain", "川西竹林与盆地农田", "sichuan-bamboo", "#4e7849", "#c6923c"],
  "520000": ["southwest-mountain", "黔地梯田与木寨山谷", "guizhou-terrace", "#4e7048", "#c15f3e"],
  "530000": ["southwest-mountain", "云贵高原花田与茶山", "yunnan-flower", "#3d7254", "#c65354"],
  "540000": ["plateau", "高原山谷与石木村落", "tibet-plateau", "#407086", "#b66b3f"],
  "610000": ["northwest-oasis", "关中麦塬与陕北窑院", "shaanxi-loess", "#9f633b", "#c89b3a"],
  "620000": ["northwest-oasis", "河西走廊与黄土村落", "gansu-corridor", "#8b6843", "#3f7580"],
  "630000": ["plateau", "青海湖畔高原农庄", "qinghai-lake", "#377486", "#c39445"],
  "640000": ["northwest-oasis", "塞上绿洲与贺兰山村", "ningxia-oasis", "#4f7750", "#c89b3c"],
  "650000": ["northwest-oasis", "天山绿洲与葡萄架村庄", "xinjiang-oasis", "#357b65", "#c55a3d"],
  "710000": ["coastal", "海岛丘陵、稻田与沿海村镇", "taiwan-coast", "#367665", "#c85f42"],
  "810000": ["coastal", "新界乡郊、围村与海湾", "hongkong-village", "#326b69", "#b54b3c"],
  "820000": ["coastal", "路环村落与滨海街巷", "macau-coast", "#3f7470", "#bd5540"],
});

function themeRecord(provinceCode, provinceName, shortName) {
  const profile = PROVINCE_PROFILES[provinceCode];
  const themeId = profile && profile[0] || "northern-plain";
  const theme = STADIUM_THEMES[themeId];
  return Object.freeze({
    provinceCode,
    provinceName,
    themeId: theme.themeId,
    runtimeThemeId: "international",
    plannedRuntimeThemeId: `province-${provinceCode}`,
    name: `${shortName}乡村球场`,
    architectureId: theme.architectureId,
    toneId: theme.toneId,
    audiencePoolId: theme.audiencePoolId,
    edgeDecorationIds: theme.edgeDecorationIds,
    cultureDescription: profile[1],
    patternId: profile[2],
    primaryColor: profile[3],
    accentColor: profile[4],
    overlayAsset: "",
    fallbackThemeId: "international",
    usesFallbackTheme: true,
  });
}

const regionalStadiums = {};
for (const [provinceCode, provinceName, shortName] of PROVINCES) {
  regionalStadiums[provinceCode] = themeRecord(provinceCode, provinceName, shortName);
}

const REGIONAL_STADIUMS = Object.freeze(regionalStadiums);
const INTERNATIONAL_STADIUM = Object.freeze({
  provinceCode: "",
  provinceName: "",
  themeId: STADIUM_THEMES["northern-plain"].themeId,
  runtimeThemeId: "international",
  name: "通用乡村球场",
  architectureId: STADIUM_THEMES["northern-plain"].architectureId,
  toneId: STADIUM_THEMES["northern-plain"].toneId,
  audiencePoolId: STADIUM_THEMES["northern-plain"].audiencePoolId,
  edgeDecorationIds: STADIUM_THEMES["northern-plain"].edgeDecorationIds,
  cultureDescription: "通用乡村足球环境",
  patternId: "generic-rural",
  primaryColor: "#497346",
  accentColor: "#c79a3b",
  overlayAsset: "",
  fallbackThemeId: "",
  usesFallbackTheme: true,
});

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function collectRegionCodes(region) {
  if (Array.isArray(region)) return region.reduce((codes, item) => codes.concat(collectRegionCodes(item)), []);
  if (typeof region === "string" || typeof region === "number") return [text(region)];
  if (!region || typeof region !== "object") return [];

  const codes = [
    region.provinceCode,
    region.code,
  ];
  for (const key of ["locationCodes", "codes"]) {
    if (Array.isArray(region[key])) codes.push(...region[key]);
  }
  if (Array.isArray(region.entries)) {
    for (const entry of region.entries) codes.push(entry && entry.code);
  }
  if (region.jersey && typeof region.jersey === "object") {
    codes.push(...collectRegionCodes(region.jersey));
  }
  return codes.map(text).filter(Boolean);
}

function provinceCodeFromRegion(region) {
  for (const candidate of collectRegionCodes(region)) {
    const digits = candidate.trim();
    if (!/^\d{2}(?:\d{4}|\d{10})?$/.test(digits)) continue;
    const provinceCode = digits.length === 2
      ? `${digits}0000`
      : `${digits.slice(0, 2)}0000`;
    if (provinceCode && REGIONAL_STADIUMS[provinceCode]) return provinceCode;
  }
  return "";
}

function selectRegionalStadium(region) {
  const provinceCode = provinceCodeFromRegion(region);
  return REGIONAL_STADIUMS[provinceCode] || INTERNATIONAL_STADIUM;
}

function stableSeedText(value, seen) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableSeedText(item, seen)).join(",")}]`;
  if (typeof value !== "object") return String(value);

  const visited = seen || new Set();
  if (visited.has(value)) return "[circular]";
  visited.add(value);
  const result = `{${Object.keys(value).sort().map((key) => `${key}:${stableSeedText(value[key], visited)}`).join(",")}}`;
  visited.delete(value);
  return result;
}

function hashSeed(value) {
  const source = stableSeedText(value) || "regional-friendly";
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function audienceCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 24;
  return Math.max(0, Math.min(96, Math.floor(count)));
}

function composeRegionalAudience(region, matchSeed, options) {
  const stadium = selectRegionalStadium(region);
  const pool = AUDIENCE_POOLS[stadium.audiencePoolId] || AUDIENCE_POOLS["plain-neighbors"];
  const count = audienceCount(options && options.count);
  const seedHash = hashSeed(`${stadium.provinceCode || "international"}:${stadium.audiencePoolId}:${stableSeedText(matchSeed)}`);
  const random = seededRandom(seedHash);
  const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
  const counts = new Map(pool.map((item) => [item.id, 0]));
  const sequence = [];

  for (let index = 0; index < count; index += 1) {
    let cursor = random() * totalWeight;
    let selected = pool[pool.length - 1];
    for (const candidate of pool) {
      cursor -= candidate.weight;
      if (cursor < 0) {
        selected = candidate;
        break;
      }
    }
    counts.set(selected.id, counts.get(selected.id) + 1);
    sequence.push(Object.freeze({
      archetypeId: selected.id,
      variantId: `${selected.id}-v${1 + Math.floor(random() * 3)}`,
    }));
  }

  const groups = pool
    .map((item) => Object.freeze({
      archetypeId: item.id,
      name: item.name,
      count: counts.get(item.id),
    }))
    .filter((item) => item.count > 0);

  return Object.freeze({
    themeId: stadium.themeId,
    audiencePoolId: stadium.audiencePoolId,
    seedHash,
    total: count,
    groups: Object.freeze(groups),
    sequence: Object.freeze(sequence),
  });
}

module.exports = {
  AUDIENCE_POOLS,
  INTERNATIONAL_STADIUM,
  PROVINCE_PROFILES,
  REGIONAL_STADIUMS,
  STADIUM_THEMES,
  composeRegionalAudience,
  provinceCodeFromRegion,
  selectRegionalStadium,
};
