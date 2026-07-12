// 远程队列配置：本地已审核队列为默认兜底，远程仅按 id 覆盖 名字/动物/颜色/启用/排序。
// 策略：启动时先用上次缓存的配置"瞬时生效"，再后台拉新写入缓存供下次启动使用；
// 任何拉取失败/超时/格式错误都回落本地，游戏永不因配置服务不可用而无法开局。
//
// ⚠️ 目标域名（默认 football.allrich.ai）必须登记在微信公众平台的 request 合法域名。
// ⚠️ 远程只能调整已随包发布(已过审)的队伍；新增带美术的队伍须随版本重新提审，
//    合规守卫在 game-options.applyTeamOverrides 内实现（忽略本地不存在的新 id）。
const { applyTeamOverrides } = require("../data/game-options");

const PRODUCTION_CONFIG_URL = "https://football.allrich.ai/minigame-config/teams.json";
const STORAGE_KEY = "animal-football:team-config";
const REQUEST_TIMEOUT_MS = 6000;

function resolveConfigUrl(globalObject) {
  const g = globalObject || (typeof globalThis !== "undefined" ? globalThis : {});
  return g.__ANIMAL_FOOTBALL_CONFIG_URL__ || PRODUCTION_CONFIG_URL;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch (error) { return null; }
}

function isValidConfig(config) {
  return !!config && typeof config === "object" && Array.isArray(config.teams) && config.teams.length > 0;
}

function readCachedConfig(wxApi) {
  try {
    if (wxApi && typeof wxApi.getStorageSync === "function") {
      const raw = wxApi.getStorageSync(STORAGE_KEY);
      if (raw && typeof raw === "object") return raw;
      if (typeof raw === "string" && raw) return safeParse(raw);
    }
  } catch (error) {}
  return null;
}

function writeCachedConfig(wxApi, config) {
  try {
    if (wxApi && typeof wxApi.setStorage === "function") {
      wxApi.setStorage({ key: STORAGE_KEY, data: config });
    }
  } catch (error) {}
}

function fetchConfig(wxApi, globalObject) {
  return new Promise((resolve) => {
    if (!wxApi || typeof wxApi.request !== "function") { resolve(null); return; }
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => done(null), REQUEST_TIMEOUT_MS);
    try {
      wxApi.request({
        url: resolveConfigUrl(globalObject),
        method: "GET",
        timeout: REQUEST_TIMEOUT_MS,
        success: (res) => {
          clearTimeout(timer);
          const data = res && res.data;
          const parsed = typeof data === "string" ? safeParse(data) : data;
          done(isValidConfig(parsed) ? parsed : null);
        },
        fail: () => { clearTimeout(timer); done(null); },
      });
    } catch (error) {
      clearTimeout(timer);
      done(null);
    }
  });
}

// 启动时调用一次。返回后台拉新是否应用成功的 Promise（供诊断，非必须 await）。
function initTeamConfig(wxApi, globalObject) {
  const cached = readCachedConfig(wxApi);
  if (isValidConfig(cached)) applyTeamOverrides(cached.teams);
  return fetchConfig(wxApi, globalObject)
    .then((config) => {
      if (!isValidConfig(config)) return false;
      const applied = applyTeamOverrides(config.teams);
      if (applied) writeCachedConfig(wxApi, config);
      return applied;
    })
    .catch(() => false);
}

module.exports = {
  initTeamConfig,
  fetchConfig,
  readCachedConfig,
  isValidConfig,
  PRODUCTION_CONFIG_URL,
  STORAGE_KEY,
};
