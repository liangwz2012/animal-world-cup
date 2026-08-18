// 云端配置：首发默认关闭联网能力；仅由已登记的 HTTPS 配置服务下发已随包审核的开关。
// 启动先读取缓存，再后台拉新。任何网络、格式或安全校验失败都回落到本地安全默认值，
// 因此配置服务不可用时游戏仍可正常单机开赛。
const { applyTeamOverrides } = require("../data/game-options");

// 包内只固定一个不含密钥的 HTTPS 开关地址。服务不可用或返回非法内容时继续使用
// DEFAULT_FEATURES（全部关闭），因此不会阻塞单机开赛；部署后可在不重发包的前提下开榜单/好友战。
const PRODUCTION_CONFIG_URL = "https://coaiz.com/rural-football/config/v1";
const STORAGE_KEY = "rural-football:team-config:v1";
const REQUEST_TIMEOUT_MS = 6000;

const DEFAULT_FEATURES = Object.freeze({
  leaderboard: Object.freeze({ enabled: false, apiUrl: "" }),
  friend: Object.freeze({ enabled: false, wssUrl: "" }),
  monetization: Object.freeze({
    enabled: false,
    playGateEnabled: false,
    adUnlockEnabled: false,
    rewardedAdUnitId: "",
  }),
});

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

function normalizeFeatures(input) {
  const source = plainObject(input) ? input : {};
  const leaderboard = plainObject(source.leaderboard) ? source.leaderboard : {};
  const friend = plainObject(source.friend) ? source.friend : {};
  const monetization = plainObject(source.monetization) ? source.monetization : {};
  const apiUrl = normalizeSecureUrl(leaderboard.apiUrl, "https");
  const wssUrl = normalizeSecureUrl(friend.wssUrl, "wss");
  const adUnitId = typeof monetization.rewardedAdUnitId === "string"
    && /^adunit-[A-Za-z0-9_-]{6,128}$/.test(monetization.rewardedAdUnitId.trim())
    ? monetization.rewardedAdUnitId.trim()
    : "";
  const adEnabled = !!monetization.enabled && !!monetization.playGateEnabled
    && !!monetization.adUnlockEnabled && !!adUnitId;
  return {
    leaderboard: { enabled: !!leaderboard.enabled && !!apiUrl, apiUrl: !!leaderboard.enabled && apiUrl ? apiUrl : "" },
    friend: { enabled: !!friend.enabled && !!wssUrl, wssUrl: !!friend.enabled && wssUrl ? wssUrl : "" },
    monetization: {
      enabled: adEnabled,
      playGateEnabled: adEnabled,
      adUnlockEnabled: adEnabled,
      rewardedAdUnitId: adEnabled ? adUnitId : "",
    },
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
  return plainObject(config) && (isValidConfig(config) || plainObject(config.features));
}

function normalizeRemoteConfig(input) {
  const source = plainObject(input) ? input : {};
  return {
    version: Math.max(1, Math.floor(Number(source.version) || 1)),
    teams: isValidConfig(source) ? source.teams : [],
    features: normalizeFeatures(source.features),
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
  if (typeof onFeatures === "function") onFeatures(normalized.features, { source: source || "remote", version: normalized.version });
  return teamApplied || true;
}

// 启动时调用一次。缓存同步生效，网络拉取不会阻塞首页。第三个参数可接收功能开关更新。
function initTeamConfig(wxApi, globalObject, options) {
  const onFeatures = typeof options === "function" ? options : options && options.onFeatures;
  const cached = readCachedConfig(wxApi);
  if (isValidRemoteConfig(cached)) applyRemoteConfig(cached, onFeatures, "cache");
  else if (typeof onFeatures === "function") onFeatures(normalizeFeatures(DEFAULT_FEATURES), { source: "default", version: 1 });
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
  PRODUCTION_CONFIG_URL,
  REQUEST_TIMEOUT_MS,
  STORAGE_KEY,
  applyRemoteConfig,
  fetchConfig,
  initTeamConfig,
  isValidConfig,
  isValidRemoteConfig,
  normalizeFeatures,
  normalizeRemoteConfig,
  readCachedConfig,
  resolveConfigUrl,
  writeCachedConfig,
};
