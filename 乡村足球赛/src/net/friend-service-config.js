const { resolveRoomEndpoint } = require("./room-endpoint");

// 正式部署后填写已在微信公众平台登记的 Socket 合法域名。
// 不允许在这里填写 AppSecret；AppSecret 只能存在于房间服务环境变量中。
const PRODUCTION_ROOM_WSS_URL = "wss://coaiz.com/rural-ws";
const DEVTOOLS_ROOM_WS_URL = "ws://127.0.0.1:18787";
// 提审版临时关闭首页「好友对战」入口：正式 WSS 部署并在微信公众平台登记
// Socket 合法域名后改回 true。release-check 按此开关决定是否强制校验 WSS。
const FRIEND_ENTRY_ENABLED = false;
const DEV_PLAYER_STORAGE_KEY = "rural-football:friend-dev-player-id";

function platformOf(wxApi) {
  try {
    const info = wxApi && typeof wxApi.getSystemInfoSync === "function"
      ? wxApi.getSystemInfoSync()
      : null;
    return String(info && info.platform || "").toLowerCase();
  } catch (error) {
    return "";
  }
}

function resolveFriendService(options) {
  const opts = options || {};
  const wxApi = opts.wxApi || null;
  const globalObject = opts.globalObject || (typeof globalThis !== "undefined" ? globalThis : {});
  const explicit = opts.url
    || globalObject.__RURAL_FOOTBALL_ROOM_WSS__
    || globalObject.__RURAL_FOOTBALL_ROOM_WSS__;
  const devtools = platformOf(wxApi) === "devtools";
  return resolveRoomEndpoint({
    wxApi,
    globalObject,
    url: explicit || (devtools ? DEVTOOLS_ROOM_WS_URL : PRODUCTION_ROOM_WSS_URL),
  });
}

function randomDevPlayerId(random) {
  const value = Math.floor((typeof random === "function" ? random() : Math.random()) * 0x100000000)
    .toString(36)
    .padStart(7, "0");
  return `dev_${Date.now().toString(36)}_${value}`;
}

function devPlayerId(wxApi, globalObject, random) {
  const explicit = globalObject && (globalObject.__RURAL_FOOTBALL_DEV_PLAYER_ID__);
  if (typeof explicit === "string" && /^[A-Za-z0-9_.-]{2,64}$/.test(explicit)) return explicit;
  let stored = "";
  try {
    if (wxApi && typeof wxApi.getStorageSync === "function") stored = String(wxApi.getStorageSync(DEV_PLAYER_STORAGE_KEY) || "");
  } catch (error) {}
  if (/^[A-Za-z0-9_.-]{2,64}$/.test(stored)) return stored;
  const created = randomDevPlayerId(random);
  try {
    if (wxApi && typeof wxApi.setStorageSync === "function") wxApi.setStorageSync(DEV_PLAYER_STORAGE_KEY, created);
  } catch (error) {}
  return created;
}

function wxLoginCode(wxApi) {
  if (!wxApi || typeof wxApi.login !== "function") {
    return Promise.reject(new Error("当前环境不支持 wx.login"));
  }
  return new Promise((resolve, reject) => {
    wxApi.login({
      success(result) {
        const code = String(result && result.code || "");
        if (!code) reject(new Error("微信登录没有返回有效 code"));
        else resolve(code);
      },
      fail(result) { reject(new Error(result && result.errMsg || "微信登录失败")); },
    });
  });
}

async function createFriendAuth(options) {
  const opts = options || {};
  const endpoint = opts.endpoint || {};
  const wxApi = opts.wxApi || null;
  const globalObject = opts.globalObject || (typeof globalThis !== "undefined" ? globalThis : {});
  if (endpoint.localOnly) {
    return { devPlayerId: devPlayerId(wxApi, globalObject, opts.random) };
  }
  return { code: await wxLoginCode(wxApi) };
}

module.exports = {
  DEVTOOLS_ROOM_WS_URL,
  DEV_PLAYER_STORAGE_KEY,
  FRIEND_ENTRY_ENABLED,
  PRODUCTION_ROOM_WSS_URL,
  createFriendAuth,
  devPlayerId,
  platformOf,
  resolveFriendService,
  wxLoginCode,
};
