const { SESSION_STORAGE_KEY, resolveLeaderboardApi } = require("./leaderboard-service-config");
const { wxLoginCode } = require("./friend-service-config");

function storageGet(wxApi, key) {
  try { return wxApi && typeof wxApi.getStorageSync === "function" ? wxApi.getStorageSync(key) : null; } catch (error) { return null; }
}

function storageSet(wxApi, key, value) {
  try {
    if (wxApi && typeof wxApi.setStorageSync === "function") wxApi.setStorageSync(key, value);
    return true;
  } catch (error) { return false; }
}

function storageRemove(wxApi, key) {
  try { if (wxApi && typeof wxApi.removeStorageSync === "function") wxApi.removeStorageSync(key); } catch (error) {}
}

function request(wxApi, options) {
  if (!wxApi || typeof wxApi.request !== "function") return Promise.reject(new Error("当前环境不支持榜单网络请求"));
  return new Promise((resolve, reject) => {
    try {
      wxApi.request({
        url: options.url,
        method: options.method || "GET",
        data: options.data,
        header: Object.assign({ "content-type": "application/json" }, options.header || {}),
        success(result) {
          const data = result && result.data;
          if (Number(result && result.statusCode) >= 200 && Number(result.statusCode) < 300 && data && data.ok !== false) resolve(data || {});
          else {
            const error = new Error(data && data.message || `榜单服务返回 HTTP ${result && result.statusCode || 0}`);
            error.code = data && data.code || "HTTP_ERROR";
            reject(error);
          }
        },
        fail(result) { reject(Object.assign(new Error(result && result.errMsg || "榜单网络请求失败"), { code: "NETWORK_ERROR" })); },
      });
    } catch (error) { reject(error); }
  });
}

function normalizeSession(input, now) {
  const source = input && typeof input === "object" ? input : {};
  const token = typeof source.token === "string" && /^[A-Za-z0-9_-]{24,}$/.test(source.token) ? source.token : "";
  const expiresAt = Number(source.expiresAt) || 0;
  return token && expiresAt > now + 60_000 ? { token, expiresAt } : null;
}

function createLeaderboardClient(options = {}) {
  const wxApi = options.wxApi || null;
  const globalObject = options.globalObject || (typeof globalThis !== "undefined" ? globalThis : {});
  const now = typeof options.now === "function" ? options.now : Date.now;
  const apiUrl = resolveLeaderboardApi({ url: options.url, globalObject, allowInsecure: !!options.allowInsecure });
  let session = normalizeSession(storageGet(wxApi, SESSION_STORAGE_KEY), now());
  let loginInFlight = null;

  function available() { return !!apiUrl; }

  function clearSession() {
    session = null;
    storageRemove(wxApi, SESSION_STORAGE_KEY);
  }

  async function authorize() {
    if (!apiUrl) throw Object.assign(new Error("榜单服务尚未配置"), { code: "SERVICE_UNAVAILABLE" });
    if (session) return session;
    if (loginInFlight) return loginInFlight;
    loginInFlight = (async () => {
      const code = await wxLoginCode(wxApi);
      const result = await request(wxApi, { url: `${apiUrl}/auth`, method: "POST", data: { code } });
      const next = normalizeSession(result, now());
      if (!next) throw Object.assign(new Error("榜单服务没有返回有效会话"), { code: "SESSION_INVALID" });
      session = next;
      storageSet(wxApi, SESSION_STORAGE_KEY, next);
      return next;
    })();
    try { return await loginInFlight; } finally { loginInFlight = null; }
  }

  async function authed(method, path, data, retry = true) {
    const current = await authorize();
    try {
      return await request(wxApi, {
        url: `${apiUrl}${path}`,
        method,
        data,
        header: { authorization: `Bearer ${current.token}` },
      });
    } catch (error) {
      if (retry && error && error.code === "SESSION_EXPIRED") {
        clearSession();
        return authed(method, path, data, false);
      }
      throw error;
    }
  }

  return {
    available,
    apiUrl,
    async updateProfile(profile) {
      return authed("PUT", "/profile", { nickname: profile && profile.nickname, avatarUrl: profile && profile.avatarUrl });
    },
    async updateRegion(region) {
      return authed("PUT", "/region", { code: region && (region.code || region.locationCode) });
    },
    async createRankedMatch(config) {
      return authed("POST", "/ranked-matches", { config });
    },
    async submitRankedResult(matchId, score) {
      const id = typeof matchId === "string" ? matchId : "";
      if (!/^[A-Za-z0-9_-]{6,128}$/.test(id)) throw Object.assign(new Error("排位赛凭证无效"), { code: "MATCH_ID_INVALID" });
      return authed("POST", `/ranked-matches/${encodeURIComponent(id)}/result`, { score });
    },
    async deleteAccount() {
      const result = await authed("DELETE", "/account");
      clearSession();
      return result;
    },
    async fetchLeaderboard(metric, scope) {
      if (!apiUrl) return { online: false, rows: [], self: null, metric: metric || "points", regional: !!scope };
      // 已有会话时附带它以返回自己的名次；没有会话则保持公开查询，绝不为了看榜而额外弹登录。
      const query = [`metric=${encodeURIComponent(metric || "points")}`];
      if (typeof scope === "string" && scope) query.push(`scope=${encodeURIComponent(scope)}`);
      const result = await request(wxApi, {
        url: `${apiUrl}/leaderboards?${query.join("&")}`,
        header: session ? { authorization: `Bearer ${session.token}` } : {},
      });
      return Object.assign({ online: true, rows: [], self: null }, result);
    },
    clearSession,
  };
}

module.exports = { createLeaderboardClient, request, normalizeSession };
