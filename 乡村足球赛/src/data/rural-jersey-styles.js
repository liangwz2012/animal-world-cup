const RURAL_JERSEY_STYLES = Object.freeze([
  Object.freeze({
    teamId: "argentina",
    id: "cunchao-red",
    label: "红金撞色",
    home: Object.freeze({ primary: "#C3272B", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#16233F" }),
    away: Object.freeze({ primary: "#1464D2", secondary: "#F7D84A", accent: "#FF6B2C", dark: "#0B2E63" }),
    goalkeeper: Object.freeze({ primary: "#E8B11B", secondary: "#22407A", accent: "#F5E9D0", dark: "#6B4E12" }),
  }),
  Object.freeze({
    teamId: "brazil",
    id: "cunchao-green",
    label: "翠绿撞色",
    home: Object.freeze({ primary: "#2E7350", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#143326" }),
    away: Object.freeze({ primary: "#176BC1", secondary: "#F7D84A", accent: "#E53B32", dark: "#0A315A" }),
    goalkeeper: Object.freeze({ primary: "#C94B7A", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#57203A" }),
  }),
  Object.freeze({
    teamId: "england",
    id: "cunchao-navy",
    label: "藏青撞色",
    home: Object.freeze({ primary: "#1F4E8C", secondary: "#F5E9D0", accent: "#C3272B", dark: "#12263F" }),
    away: Object.freeze({ primary: "#E86A1C", secondary: "#173D7A", accent: "#F8D34A", dark: "#6A2708" }),
    goalkeeper: Object.freeze({ primary: "#2E9E57", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#14522D" }),
  }),
  Object.freeze({
    teamId: "france",
    id: "cunchao-sky",
    label: "天蓝撞色",
    home: Object.freeze({ primary: "#4A90D9", secondary: "#F5E9D0", accent: "#C3272B", dark: "#1C3A5C" }),
    away: Object.freeze({ primary: "#F0B51C", secondary: "#173D7A", accent: "#E34335", dark: "#604509" }),
    goalkeeper: Object.freeze({ primary: "#E8721B", secondary: "#22407A", accent: "#F5E9D0", dark: "#6B3A12" }),
  }),
  Object.freeze({
    teamId: "germany",
    id: "cunchao-orange",
    label: "橙蓝撞色",
    home: Object.freeze({ primary: "#D96A1E", secondary: "#F5E9D0", accent: "#22407A", dark: "#5C2E0E" }),
    away: Object.freeze({ primary: "#1A66D9", secondary: "#F4C433", accent: "#E84A2A", dark: "#0A2E69" }),
    goalkeeper: Object.freeze({ primary: "#6E8B3D", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#33421A" }),
  }),
  Object.freeze({
    teamId: "portugal",
    id: "cunchao-purple",
    label: "宝蓝亮青撞色",
    // Image2 原母版是紫青色；运行时主/客场均从该母版色板重映射为新的宝蓝亮青。
    master: Object.freeze({ primary: "#7A3B8F", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#2A1540" }),
    home: Object.freeze({ primary: "#1767D8", secondary: "#F5DC45", accent: "#FF702A", dark: "#092F70" }),
    away: Object.freeze({ primary: "#00A7E8", secondary: "#FFF08A", accent: "#FF4F38", dark: "#064C76" }),
    goalkeeper: Object.freeze({ primary: "#3FA7C9", secondary: "#22407A", accent: "#F5E9D0", dark: "#1B4A5C" }),
  }),
  Object.freeze({
    teamId: "spain",
    id: "cunchao-teal",
    label: "青金撞色",
    home: Object.freeze({ primary: "#2B7783", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#143A42" }),
    away: Object.freeze({ primary: "#D83978", secondary: "#F7D84A", accent: "#143C70", dark: "#641431" }),
    goalkeeper: Object.freeze({ primary: "#D94F70", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#5C1F2E" }),
  }),
  Object.freeze({
    teamId: "usa",
    id: "cunchao-black",
    label: "黑红撞色",
    home: Object.freeze({ primary: "#333333", secondary: "#C3272B", accent: "#F5E9D0", dark: "#101010" }),
    away: Object.freeze({ primary: "#E7BE18", secondary: "#173D7A", accent: "#E43B31", dark: "#5D4908" }),
    goalkeeper: Object.freeze({ primary: "#8A5BC0", secondary: "#F5E9D0", accent: "#F0BC3F", dark: "#3A2452" }),
  }),
]);

const RURAL_JERSEY_TEAM_IDS = Object.freeze(RURAL_JERSEY_STYLES.map((style) => style.teamId));

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function regionJerseySeed(selection) {
  const source = selection && typeof selection === "object" ? selection : {};
  const codes = Array.isArray(source.locationCodes)
    ? source.locationCodes
    : (Array.isArray(source.path) ? source.path.map((item) => item && item.code) : []);
  return [
    ...codes.filter(Boolean),
    source.customName || "",
    source.locationLabel || source.displayName || "",
  ].join("|") || "rural-football-default";
}

function teamIdForRegion(selection, excludedTeamId) {
  const seed = regionJerseySeed(selection);
  let index = stableHash(`rural-jersey|${seed}`) % RURAL_JERSEY_TEAM_IDS.length;
  if (RURAL_JERSEY_TEAM_IDS[index] === excludedTeamId) {
    index = (index + 1 + stableHash(`${seed}|contrast`) % (RURAL_JERSEY_TEAM_IDS.length - 1))
      % RURAL_JERSEY_TEAM_IDS.length;
  }
  return RURAL_JERSEY_TEAM_IDS[index];
}

function teamIdForMatchSide(side, selection) {
  // 双方基础色是产品识别：主队固定红、客队固定蓝。地区只改变队名与归属。
  return side === "red" ? "argentina" : "portugal";
}

module.exports = {
  RURAL_JERSEY_STYLES,
  RURAL_JERSEY_TEAM_IDS,
  regionJerseySeed,
  stableHash,
  teamIdForMatchSide,
  teamIdForRegion,
};
