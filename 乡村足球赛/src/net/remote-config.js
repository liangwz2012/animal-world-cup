// 云端配置：首发默认关闭联网能力；仅由已登记的 HTTPS 配置服务下发已随包审核的开关。
// 启动先读取缓存，再后台拉新。任何网络、格式或安全校验失败都回落到本地安全默认值，
// 因此配置服务不可用时游戏仍可正常单机开赛。
const { applyTeamOverrides } = require("../data/game-options");
const { normalizeRegionalShareFeature, normalizeRuralLeaderboardFeature } = require("../data/remote-feature-contracts");

// 包内只固定一个不含密钥的 HTTPS 开关地址。服务不可用或返回非法内容时继续使用
// DEFAULT_FEATURES（全部关闭），因此不会阻塞单机开赛；部署后可在不重发包的前提下开榜单/好友战。
const PRODUCTION_CONFIG_URL = "https://coaiz.com/rural-football/config/v1";
const STORAGE_KEY = "rural-football:team-config:v1";
const REQUEST_TIMEOUT_MS = 6000;

const DEFAULT_FEATURES = Object.freeze({
  leaderboard: Object.freeze({ enabled: false, apiUrl: "" }),
  friend: Object.freeze({ enabled: false, wssUrl: "" }),
  captainAvatarCustomization: Object.freeze({ enabled: false, apiUrl: "" }),
  ruralLeaderboard: Object.freeze(normalizeRuralLeaderboardFeature(null)),
  regionalShare: Object.freeze(normalizeRegionalShareFeature(null)),
  monetization: Object.freeze({
    enabled: false,
    playGateEnabled: false,
    adUnlockEnabled: false,
    rewardedAdUnitId: "",
    // 场次闸门参数也云端可调：开关不开时这些值不生效。
    freeMatchesPerDay: 2,
    singleUnlockMatches: 1,
    dayPassThreshold: 5,
    shareTitle: "",
  }),
  // 以下全部是「升级模块」的云端开关：包内默认关闭，服务端部署后按版本节奏逐个点亮。
  dailyTasks: Object.freeze({ enabled: false, tasks: Object.freeze([]) }),
  penaltyShootout: Object.freeze({ enabled: false, rounds: 5 }),
  regionHonorBoard: Object.freeze({ enabled: false, scopes: Object.freeze([]) }),
  regionRivalry: Object.freeze({ enabled: false, settleDayOfWeek: 0, rewardTitle: "" }),
  playerCodex: Object.freeze({ enabled: false }),
  spectateCheer: Object.freeze({ enabled: false, presets: Object.freeze([]) }),
  challengeCard: Object.freeze({ enabled: false, title: "" }),
  home: Object.freeze({ honorCard: false, rivalryBanner: false, taskStrip: false }),
  // 预留的扩展位：后续玩法先做云端接口，客户端按失败关闭处理。
  weather: Object.freeze({ enabled: false, types: Object.freeze([]), probability: 0 }),
  tournament: Object.freeze({ enabled: false, title: "", format: "knockout", rounds: 3 }),
  seasonPass: Object.freeze({ enabled: false, days: 30 }),
  achievements: Object.freeze({ enabled: false, list: Object.freeze([]) }),
  highlights: Object.freeze({ enabled: false }),
  dialectPack: Object.freeze({ enabled: false, pack: "" }),
  feedback: Object.freeze({ enabled: false }),
  experiments: Object.freeze({}),
  customModules: Object.freeze({}),
});

const DEFAULT_ANNOUNCEMENT = Object.freeze({ text: "", level: "info" });
const DEFAULT_MAINTENANCE = Object.freeze({ onlineBlocked: false, message: "", minClientVersion: "" });

// 任务类型白名单。不含任何分享类任务：微信禁止诱导分享，任务奖励只认比赛行为。
const TASK_KINDS = Object.freeze(["play_matches", "score_goals", "win_matches", "watch_match"]);
const BOARD_SCOPES = Object.freeze(["nation", "province", "city", "county"]);
const ANNOUNCEMENT_LEVELS = Object.freeze(["info", "warn", "urgent"]);
const WEATHER_TYPES = Object.freeze(["rain", "mud", "snow", "heat"]);
const TOURNAMENT_FORMATS = Object.freeze(["knockout", "league"]);
const EVENT_KINDS = Object.freeze(["festival", "cup", "rivalry", "custom"]);
// 键名白名单之外的保留键黑名单：防止 __proto__ 赋值触发原型链污染。
const FORBIDDEN_MAP_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

function safeText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSecureUrl(value, protocol) {
  const raw = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (!raw || raw.length > 512) return "";
  const expression = protocol === "wss"
    ? /^wss:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?$/i
    : /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?$/i;
  return expression.test(raw) ? raw : "";
}

function normalizePublicHttpsUrl(value) {
  const url = normalizeSecureUrl(value, "https");
  if (!url || /^https:\/\/(?:localhost|127(?:\.\d{1,3}){3})(?::|\/|$)/i.test(url)) return "";
  return url;
}

function normalizeTasks(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map((item) => {
    if (!plainObject(item)) return null;
    const id = safeText(item.id, 32);
    const kind = safeText(item.kind, 24);
    if (!id || !TASK_KINDS.includes(kind)) return null;
    return {
      id,
      kind,
      target: clampInt(item.target, 1, 99, 1),
      reward: safeText(item.reward, 32),
    };
  }).filter(Boolean);
}

function normalizeCheerPresets(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map((item) => {
    if (!plainObject(item)) return null;
    const icon = safeText(item.icon, 4);
    const text = safeText(item.text, 8);
    if (!icon || !text) return null;
    return { icon, text };
  }).filter(Boolean);
}

function normalizeBoardScopes(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((scope) => BOARD_SCOPES.includes(scope)).slice(0, 4);
}

function normalizeWeatherTypes(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((type) => WEATHER_TYPES.includes(type)).slice(0, 4);
}

function normalizeAchievements(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 32).map((item) => {
    if (!plainObject(item)) return null;
    const id = safeText(item.id, 32);
    const title = safeText(item.title, 24);
    if (!id || !title) return null;
    return { id, title, desc: safeText(item.desc, 60), target: clampInt(item.target, 1, 9999, 1) };
  }).filter(Boolean);
}

function normalizeEvents(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map((item) => {
    if (!plainObject(item)) return null;
    const id = safeText(item.id, 24);
    const title = safeText(item.title, 30);
    const kind = safeText(item.kind, 16);
    if (!id || !title || !EVENT_KINDS.includes(kind)) return null;
    return {
      id,
      title,
      kind,
      startAt: clampInt(item.startAt, 0, 4100000000000, 0),
      endAt: clampInt(item.endAt, 0, 4100000000000, 0),
    };
  }).filter(Boolean);
}

function normalizeExperiments(input) {
  if (!plainObject(input)) return {};
  const output = {};
  for (const key of Object.keys(input).slice(0, 8)) {
    if (!/^[a-z0-9_]{2,32}$/.test(key) || FORBIDDEN_MAP_KEYS.includes(key)) continue;
    const variant = safeText(input[key], 24);
    if (variant) output[key] = variant;
  }
  return output;
}

// 预留的通用扩展槽：未来新玩法未建专用字段前，可先用 customModules 下发开关。
// 只承载开关与备注，业务参数仍需走专用字段的白名单校验。
function normalizeCustomModules(input) {
  if (!plainObject(input)) return {};
  const output = {};
  for (const name of Object.keys(input).slice(0, 16)) {
    if (!/^[a-z0-9_]{2,32}$/.test(name) || FORBIDDEN_MAP_KEYS.includes(name)) continue;
    const entry = plainObject(input[name]) ? input[name] : {};
    output[name] = { enabled: !!entry.enabled, note: safeText(entry.note, 100) };
  }
  return output;
}

function normalizeAnnouncement(input) {
  const source = plainObject(input) ? input : {};
  return {
    text: safeText(source.text, 100),
    level: ANNOUNCEMENT_LEVELS.includes(source.level) ? source.level : "info",
  };
}

function normalizeMaintenance(input) {
  const source = plainObject(input) ? input : {};
  return {
    onlineBlocked: !!source.onlineBlocked,
    message: safeText(source.message, 100),
    minClientVersion: safeText(source.minClientVersion, 16),
  };
}

function normalizeFeatures(input) {
  const source = plainObject(input) ? input : {};
  const leaderboard = plainObject(source.leaderboard) ? source.leaderboard : {};
  const friend = plainObject(source.friend) ? source.friend : {};
  const captainAvatarCustomization = plainObject(source.captainAvatarCustomization) ? source.captainAvatarCustomization : {};
  const ruralLeaderboard = plainObject(source.ruralLeaderboard) ? source.ruralLeaderboard : {};
  const regionalShare = plainObject(source.regionalShare) ? source.regionalShare : {};
  const monetization = plainObject(source.monetization) ? source.monetization : {};
  const dailyTasks = plainObject(source.dailyTasks) ? source.dailyTasks : {};
  const penaltyShootout = plainObject(source.penaltyShootout) ? source.penaltyShootout : {};
  const regionHonorBoard = plainObject(source.regionHonorBoard) ? source.regionHonorBoard : {};
  const regionRivalry = plainObject(source.regionRivalry) ? source.regionRivalry : {};
  const playerCodex = plainObject(source.playerCodex) ? source.playerCodex : {};
  const spectateCheer = plainObject(source.spectateCheer) ? source.spectateCheer : {};
  const challengeCard = plainObject(source.challengeCard) ? source.challengeCard : {};
  const home = plainObject(source.home) ? source.home : {};
  const weather = plainObject(source.weather) ? source.weather : {};
  const tournament = plainObject(source.tournament) ? source.tournament : {};
  const seasonPass = plainObject(source.seasonPass) ? source.seasonPass : {};
  const achievements = plainObject(source.achievements) ? source.achievements : {};
  const highlights = plainObject(source.highlights) ? source.highlights : {};
  const dialectPack = plainObject(source.dialectPack) ? source.dialectPack : {};
  const feedback = plainObject(source.feedback) ? source.feedback : {};
  const apiUrl = normalizeSecureUrl(leaderboard.apiUrl, "https");
  const wssUrl = normalizeSecureUrl(friend.wssUrl, "wss");
  const captainAvatarApiUrl = normalizePublicHttpsUrl(captainAvatarCustomization.apiUrl);
  const adUnitId = typeof monetization.rewardedAdUnitId === "string"
    && /^adunit-[A-Za-z0-9_-]{6,128}$/.test(monetization.rewardedAdUnitId.trim())
    ? monetization.rewardedAdUnitId.trim()
    : "";
  const adEnabled = !!monetization.enabled && !!monetization.playGateEnabled
    && !!monetization.adUnlockEnabled && !!adUnitId;
  return {
    leaderboard: { enabled: !!leaderboard.enabled && !!apiUrl, apiUrl: !!leaderboard.enabled && apiUrl ? apiUrl : "" },
    friend: { enabled: !!friend.enabled && !!wssUrl, wssUrl: !!friend.enabled && wssUrl ? wssUrl : "" },
    captainAvatarCustomization: {
      enabled: !!captainAvatarCustomization.enabled && !!captainAvatarApiUrl,
      apiUrl: !!captainAvatarCustomization.enabled && captainAvatarApiUrl ? captainAvatarApiUrl : "",
    },
    ruralLeaderboard: normalizeRuralLeaderboardFeature(ruralLeaderboard),
    regionalShare: normalizeRegionalShareFeature(regionalShare),
    monetization: {
      enabled: adEnabled,
      playGateEnabled: adEnabled,
      adUnlockEnabled: adEnabled,
      rewardedAdUnitId: adEnabled ? adUnitId : "",
      freeMatchesPerDay: clampInt(monetization.freeMatchesPerDay, 0, 20, 2),
      singleUnlockMatches: clampInt(monetization.singleUnlockMatches, 1, 10, 1),
      dayPassThreshold: clampInt(monetization.dayPassThreshold, 2, 20, 5),
      shareTitle: safeText(monetization.shareTitle, 40),
    },
    dailyTasks: { enabled: !!dailyTasks.enabled, tasks: normalizeTasks(dailyTasks.tasks) },
    penaltyShootout: { enabled: !!penaltyShootout.enabled, rounds: clampInt(penaltyShootout.rounds, 3, 7, 5) },
    regionHonorBoard: { enabled: !!regionHonorBoard.enabled, scopes: normalizeBoardScopes(regionHonorBoard.scopes) },
    regionRivalry: {
      enabled: !!regionRivalry.enabled,
      settleDayOfWeek: clampInt(regionRivalry.settleDayOfWeek, 0, 6, 0),
      rewardTitle: safeText(regionRivalry.rewardTitle, 24),
    },
    playerCodex: { enabled: !!playerCodex.enabled },
    spectateCheer: { enabled: !!spectateCheer.enabled, presets: normalizeCheerPresets(spectateCheer.presets) },
    challengeCard: { enabled: !!challengeCard.enabled, title: safeText(challengeCard.title, 30) },
    home: {
      honorCard: !!home.honorCard,
      rivalryBanner: !!home.rivalryBanner,
      taskStrip: !!home.taskStrip,
    },
    weather: {
      enabled: !!weather.enabled,
      types: normalizeWeatherTypes(weather.types),
      probability: clampInt(weather.probability, 0, 100, 0),
    },
    tournament: {
      enabled: !!tournament.enabled,
      title: safeText(tournament.title, 30),
      format: TOURNAMENT_FORMATS.includes(tournament.format) ? tournament.format : "knockout",
      rounds: clampInt(tournament.rounds, 2, 6, 3),
    },
    seasonPass: { enabled: !!seasonPass.enabled, days: clampInt(seasonPass.days, 7, 90, 30) },
    achievements: { enabled: !!achievements.enabled, list: normalizeAchievements(achievements.list) },
    highlights: { enabled: !!highlights.enabled },
    dialectPack: { enabled: !!dialectPack.enabled, pack: safeText(dialectPack.pack, 24) },
    feedback: { enabled: !!feedback.enabled },
    experiments: normalizeExperiments(source.experiments),
    customModules: normalizeCustomModules(source.customModules),
  };
}

function resolveConfigUrl(globalObject) {
  const g = globalObject || (typeof globalThis !== "undefined" ? globalThis : {});
  const explicit = g.__RURAL_FOOTBALL_CONFIG_URL__ || PRODUCTION_CONFIG_URL;
  return normalizeSecureUrl(explicit, "https");
}

function safeParse(text) {
  try { return JSON.parse(text); } catch (error) { return null; }
}

// 保留旧导出语义：该函数只判断可应用的队伍覆盖，不把“空队伍”误认为有效。
function isValidConfig(config) {
  return plainObject(config) && Array.isArray(config.teams) && config.teams.length > 0;
}

function isValidRemoteConfig(config) {
  return plainObject(config) && (isValidConfig(config) || plainObject(config.features)
    || plainObject(config.announcement) || plainObject(config.maintenance)
    || Array.isArray(config.events));
}

function normalizeRemoteConfig(input) {
  const source = plainObject(input) ? input : {};
  return {
    version: Math.max(1, Math.floor(Number(source.version) || 1)),
    // 与服务端 safeTeams 对齐的截断：超大载荷不得全量进入后续遍历。
    teams: isValidConfig(source) ? source.teams.slice(0, 32) : [],
    features: normalizeFeatures(source.features),
    announcement: normalizeAnnouncement(source.announcement),
    maintenance: normalizeMaintenance(source.maintenance),
    events: normalizeEvents(source.events),
  };
}

function readCachedConfig(wxApi) {
  try {
    if (wxApi && typeof wxApi.getStorageSync === "function") {
      const raw = wxApi.getStorageSync(STORAGE_KEY);
      if (plainObject(raw)) return raw;
      if (typeof raw === "string" && raw) return safeParse(raw);
    }
  } catch (error) {}
  return null;
}

function writeCachedConfig(wxApi, config) {
  try {
    if (wxApi && typeof wxApi.setStorage === "function") {
      wxApi.setStorage({ key: STORAGE_KEY, data: config });
    } else if (wxApi && typeof wxApi.setStorageSync === "function") {
      wxApi.setStorageSync(STORAGE_KEY, config);
    }
  } catch (error) {}
}

function fetchConfig(wxApi, globalObject) {
  return new Promise((resolve) => {
    if (!wxApi || typeof wxApi.request !== "function") { resolve(null); return; }
    const url = resolveConfigUrl(globalObject);
    if (!url) { resolve(null); return; }
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => done(null), REQUEST_TIMEOUT_MS);
    try {
      wxApi.request({
        url,
        method: "GET",
        timeout: REQUEST_TIMEOUT_MS,
        success: (res) => {
          clearTimeout(timer);
          const data = res && res.data;
          // 客户端侧大小门：异常巨型响应直接丢弃，不解析不缓存。
          if (typeof data === "string" && data.length > 256 * 1024) { done(null); return; }
          const parsed = typeof data === "string" ? safeParse(data) : data;
          done(isValidRemoteConfig(parsed) ? parsed : null);
        },
        fail: () => { clearTimeout(timer); done(null); },
      });
    } catch (error) {
      clearTimeout(timer);
      done(null);
    }
  });
}

function applyRemoteConfig(config, onFeatures, source) {
  if (!isValidRemoteConfig(config)) return false;
  const normalized = normalizeRemoteConfig(config);
  const teamApplied = normalized.teams.length ? applyTeamOverrides(normalized.teams) : false;
  if (typeof onFeatures === "function") {
    onFeatures(normalized.features, {
      source: source || "remote",
      version: normalized.version,
      announcement: normalized.announcement,
      maintenance: normalized.maintenance,
      events: normalized.events,
    });
  }
  return teamApplied || true;
}

// 启动时调用一次。缓存同步生效，网络拉取不会阻塞首页。第三个参数可接收功能开关更新。
function initTeamConfig(wxApi, globalObject, options) {
  const onFeatures = typeof options === "function" ? options : options && options.onFeatures;
  const cached = readCachedConfig(wxApi);
  if (isValidRemoteConfig(cached)) applyRemoteConfig(cached, onFeatures, "cache");
  else if (typeof onFeatures === "function") {
    onFeatures(normalizeFeatures(DEFAULT_FEATURES), {
      source: "default",
      version: 1,
      announcement: normalizeAnnouncement(null),
      maintenance: normalizeMaintenance(null),
      events: [],
    });
  }
  return fetchConfig(wxApi, globalObject)
    .then((config) => {
      if (!isValidRemoteConfig(config)) return false;
      const applied = applyRemoteConfig(config, onFeatures, "remote");
      if (applied) writeCachedConfig(wxApi, config);
      return applied;
    })
    .catch(() => false);
}

module.exports = {
  DEFAULT_FEATURES,
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_MAINTENANCE,
  PRODUCTION_CONFIG_URL,
  REQUEST_TIMEOUT_MS,
  STORAGE_KEY,
  applyRemoteConfig,
  fetchConfig,
  initTeamConfig,
  isValidConfig,
  isValidRemoteConfig,
  normalizeAnnouncement,
  normalizeFeatures,
  normalizeMaintenance,
  normalizeRemoteConfig,
  readCachedConfig,
  resolveConfigUrl,
  writeCachedConfig,
};
