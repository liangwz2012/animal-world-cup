// 「再来一局」路由：赛季/每日挑战必须重新走签发流程拿新场次凭证，
// 直接复用已结算的 campaignMatchId/dailyAttemptId 会被账本静默拒收（空气局）。
function resolveRematchRoute(config) {
  const journeyMode = config && config.journeyMode;
  if (journeyMode === "season" || journeyMode === "daily") return journeyMode;
  return "local";
}

module.exports = { resolveRematchRoute };
