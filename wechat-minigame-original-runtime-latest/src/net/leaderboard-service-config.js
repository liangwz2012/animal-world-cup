// 生产环境填写已在微信公众平台登记的 HTTPS request 合法域名（末尾包含 /v1）。
// 不得在客户端填写 AppSecret、服务器密码或任何长期密钥。
const PRODUCTION_LEADERBOARD_API_URL = "";
const SESSION_STORAGE_KEY = "animal-football:leaderboard-session:v1";

function normalizeApiUrl(value, allowInsecure = false) {
  const raw = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (!raw) return "";
  if (!/^https:\/\//i.test(raw) && !(allowInsecure && /^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(raw))) return "";
  return /\/v1$/i.test(raw) ? raw : `${raw}/v1`;
}

function resolveLeaderboardApi(options = {}) {
  const globalObject = options.globalObject || (typeof globalThis !== "undefined" ? globalThis : {});
  const explicit = options.url || globalObject.__ANIMAL_FOOTBALL_LEADERBOARD_API__ || PRODUCTION_LEADERBOARD_API_URL;
  return normalizeApiUrl(explicit, !!options.allowInsecure);
}

module.exports = {
  PRODUCTION_LEADERBOARD_API_URL,
  SESSION_STORAGE_KEY,
  normalizeApiUrl,
  resolveLeaderboardApi,
};
