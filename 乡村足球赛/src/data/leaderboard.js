const STORAGE_KEY = "rural-football:leaderboard:v1";
const MAX_RECENT_MATCHES = 80;
const MIN_RANK_MATCHES = 5;
const { regionIdentity } = require("./region-identity");
const { ruralScopeOptions, validScopeKey } = require("./region-league");

const METRICS = Object.freeze([
  { id: "points", label: "积分", value: (stats) => stats.points },
  { id: "goals", label: "进球", value: (stats) => stats.goalsFor },
  { id: "winRate", label: "胜率", value: (stats) => stats.matches ? Math.round(stats.wins * 1000 / stats.matches) / 10 : 0, suffix: "%" },
]);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function whole(value, min = 0, max = 1_000_000) {
  return Math.max(min, Math.min(max, Math.floor(number(value))));
}

function safeText(value, max = 32) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f]/g, "").slice(0, max) : "";
}

function safeAvatar(value) {
  const url = safeText(value, 1024);
  return /^https:\/\//i.test(url) ? url : "";
}

function blankStats() {
  return {
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    cleanSheets: 0,
    points: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    updatedAt: 0,
  };
}

function blankState() {
  return {
    version: 1,
    profile: { nickname: "", avatarUrl: "", consentedAt: 0 },
    region: null,
    stats: blankStats(),
    recentMatchIds: [],
  };
}

function normalizeRegion(input) {
  const source = input && typeof input === "object" ? input : {};
  const scope = source.scope && typeof source.scope === "object" ? source.scope : {};
  const code = safeText(source.code, 18);
  const level = safeText(source.level, 12);
  const scopeKey = validScopeKey(scope.key);
  if (!code || !["province", "city", "county", "town"].includes(level)
    || !scopeKey) return null;
  const identity = regionIdentity(source.path, source.customName);
  const scopes = ruralScopeOptions(identity);
  return {
    version: 1,
    code,
    name: safeText(source.name, 18),
    officialName: safeText(source.officialName, 32),
    customName: safeText(identity.customName, 18),
    fullRegionName: safeText(identity.fullRegionName || source.fullRegionName, 96),
    fullTeamName: safeText(identity.fullTeamName || source.fullTeamName || source.name, 120),
    path: identity.path,
    scopes,
    level,
    scope: {
      key: scopeKey,
      title: safeText(scope.title, 24),
      childLevel: safeText(scope.childLevel, 12),
      parentCode: safeText(scope.parentCode, 18),
    },
  };
}

function normalizeProfile(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    nickname: safeText(source.nickname || source.nickName),
    avatarUrl: safeAvatar(source.avatarUrl),
    consentedAt: whole(source.consentedAt, 0, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeStats(input) {
  const source = input && typeof input === "object" ? input : {};
  const stats = blankStats();
  for (const key of Object.keys(stats)) stats[key] = whole(source[key], 0, Number.MAX_SAFE_INTEGER);
  // 历史存储可被手工修改；以下不变量必须在读取时恢复，避免排行榜出现负/矛盾数据。
  stats.matches = Math.max(stats.matches, stats.wins + stats.draws + stats.losses);
  stats.points = Math.max(stats.points, stats.wins * 3 + stats.draws);
  stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak);
  return stats;
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const ids = Array.isArray(source.recentMatchIds) ? source.recentMatchIds : [];
  return {
    version: 1,
    profile: normalizeProfile(source.profile),
    region: normalizeRegion(source.region),
    stats: normalizeStats(source.stats),
    recentMatchIds: [...new Set(ids.filter((id) => typeof id === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(id)))].slice(-MAX_RECENT_MATCHES),
  };
}

function storageGet(wxApi, key) {
  try { return wxApi && typeof wxApi.getStorageSync === "function" ? wxApi.getStorageSync(key) : null; } catch (error) { return null; }
}

function storageSet(wxApi, key, value) {
  try {
    if (wxApi && typeof wxApi.setStorageSync === "function") wxApi.setStorageSync(key, value);
    return true;
  } catch (error) { return false; }
}

function scorePair(detail) {
  const score = detail && detail.score;
  if (!Array.isArray(score) || score.length < 2) return null;
  const red = whole(score[0], 0, 99);
  const blue = whole(score[1], 0, 99);
  if (red !== Number(score[0]) || blue !== Number(score[1])) return null;
  return [red, blue];
}

function localSide(config) {
  return config && config.localRole === "guest" && config.friendPhase === "friend" ? "blue" : "red";
}

function metricValue(stats, id) {
  const metric = METRICS.find((item) => item.id === id) || METRICS[0];
  return metric.value(stats);
}

function metricLabel(id) {
  return (METRICS.find((item) => item.id === id) || METRICS[0]).label;
}

function createLeaderboard(options = {}) {
  const wxApi = options.wxApi || null;
  const now = typeof options.now === "function" ? options.now : Date.now;
  let state = normalizeState(storageGet(wxApi, STORAGE_KEY));

  function save() {
    storageSet(wxApi, STORAGE_KEY, state);
  }

  function snapshot() {
    const stats = Object.assign({}, state.stats);
    const values = {};
    for (const metric of METRICS) values[metric.id] = metric.value(stats);
    return {
      profile: Object.assign({}, state.profile),
      region: state.region && Object.assign({}, state.region, {
        scope: Object.assign({}, state.region.scope),
        path: Array.isArray(state.region.path) ? state.region.path.map((item) => Object.assign({}, item)) : [],
        scopes: Array.isArray(state.region.scopes) ? state.region.scopes.map((item) => Object.assign({}, item)) : [],
      }),
      stats,
      values,
      qualified: stats.matches >= MIN_RANK_MATCHES,
      matchesUntilQualified: Math.max(0, MIN_RANK_MATCHES - stats.matches),
      metrics: METRICS.map((metric) => ({ id: metric.id, label: metric.label, suffix: metric.suffix || "" })),
    };
  }

  function setProfile(profile) {
    const normalized = normalizeProfile(Object.assign({}, profile, { consentedAt: now() }));
    if (!normalized.nickname) throw new Error("未获取到有效昵称");
    state = Object.assign({}, state, { profile: normalized });
    save();
    return snapshot();
  }

  function requestProfile() {
    if (!wxApi || typeof wxApi.getUserProfile !== "function") {
      return Promise.reject(new Error("当前环境不支持获取微信昵称和头像"));
    }
    return new Promise((resolve, reject) => {
      try {
        wxApi.getUserProfile({
          desc: "用于在乡村足球赛排行榜显示你的昵称和头像",
          success(result) {
            try { resolve(setProfile(result && (result.userInfo || result))); } catch (error) { reject(error); }
          },
          fail(result) { reject(new Error(result && result.errMsg || "用户取消授权")); },
        });
      } catch (error) { reject(error); }
    });
  }

  function setRegion(region) {
    const normalized = normalizeRegion(region);
    if (!normalized) throw new Error("地区战队信息无效");
    state = Object.assign({}, state, { region: normalized });
    save();
    return snapshot();
  }

  function recordMatch(detail, config) {
    // 观看 AI 对战只是观赛，不得计入本机战绩，否则挂机观战可以刷高胜场。
    if (config && config.mode === "watch") return { accepted: false, reason: "watch_mode", snapshot: snapshot() };
    const score = scorePair(detail);
    if (!score) return { accepted: false, reason: "invalid_score", snapshot: snapshot() };
    const matchId = safeText(config && (config.matchId || config.roomId), 128);
    if (matchId && state.recentMatchIds.includes(matchId)) {
      return { accepted: false, reason: "duplicate", snapshot: snapshot() };
    }
    const isBlue = localSide(config) === "blue";
    const mine = isBlue ? score[1] : score[0];
    const opponent = isBlue ? score[0] : score[1];
    const stats = Object.assign({}, state.stats);
    stats.matches += 1;
    stats.goalsFor += mine;
    stats.goalsAgainst += opponent;
    if (opponent === 0) stats.cleanSheets += 1;
    if (mine > opponent) {
      stats.wins += 1;
      stats.points += 3;
      stats.currentWinStreak += 1;
      stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak);
    } else if (mine === opponent) {
      stats.draws += 1;
      stats.points += 1;
      stats.currentWinStreak = 0;
    } else {
      stats.losses += 1;
      stats.currentWinStreak = 0;
    }
    stats.updatedAt = whole(now(), 0, Number.MAX_SAFE_INTEGER);
    state = Object.assign({}, state, {
      stats,
      recentMatchIds: matchId ? [...state.recentMatchIds, matchId].slice(-MAX_RECENT_MATCHES) : state.recentMatchIds,
    });
    save();
    return {
      accepted: true,
      match: { mine, opponent, won: mine > opponent, draw: mine === opponent, metric: metricValue(stats, "points") },
      snapshot: snapshot(),
    };
  }

  return {
    snapshot,
    setProfile,
    setRegion,
    requestProfile,
    recordMatch,
    metricValue: (id) => metricValue(state.stats, id),
    metricLabel,
    clear() {
      state = blankState();
      save();
      return snapshot();
    },
  };
}

module.exports = {
  STORAGE_KEY,
  MAX_RECENT_MATCHES,
  MIN_RANK_MATCHES,
  METRICS,
  createLeaderboard,
  metricValue,
  metricLabel,
  normalizeRegion,
};
