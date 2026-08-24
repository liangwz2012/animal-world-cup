const { RURAL_MATCH_LINEUP_INDEXES, RURAL_SQUAD } = require("./rural-squad");

function matchPlayerForRuntimeId(runtimeId, sideHint, teamId) {
  const id = Number(runtimeId);
  if (!Number.isInteger(id) || id < 0 || id > 13) return null;
  const runtimeSide = id >= 7 ? "blue" : "red";
  const hint = sideHint === "blue" ? "blue" : sideHint === "red" ? "red" : "";
  if (hint && hint !== runtimeSide) return null;
  const localIndex = runtimeSide === "blue" ? id - 7 : id;
  // 运行时 ID 的 0-6/7-13 只代表场上红蓝位置；真正名单由球队资源决定：
  // Argentina 是主队红名单，其他球队均使用客队蓝名单。
  const rosterSide = teamId ? (teamId === "argentina" ? "red" : "blue") : runtimeSide;
  const squadIndex = RURAL_MATCH_LINEUP_INDEXES[rosterSide][localIndex];
  const player = Number.isInteger(squadIndex) ? RURAL_SQUAD[squadIndex] : null;
  return player ? Object.assign({ runtimeId: id, side: runtimeSide, rosterSide, localIndex, teamId: teamId || "" }, player) : null;
}

function matchPlayerPortraitPath(runtimeId, sideHint, teamId) {
  const player = matchPlayerForRuntimeId(runtimeId, sideHint, teamId);
  return player ? `shell-assets/squad/${player.id}.png` : "";
}

module.exports = {
  matchPlayerForRuntimeId,
  matchPlayerPortraitPath,
};
