function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function parseSocketUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { ok: false, reason: "missing" };
  if (/[?#]/.test(raw) || /:\/\/[^/]*@/.test(raw)) {
    return { ok: false, reason: "unsafe_url" };
  }
  if (/^https?:\/\//i.test(raw)) return { ok: false, reason: "secure_websocket_required" };
  const match = /^(wss?):\/\/([^/]+)(\/[^?#]*)?$/i.exec(raw);
  if (!match) return { ok: false, reason: "invalid_url" };
  const protocol = match[1].toLowerCase();
  const authority = match[2];
  const hostname = authority.startsWith("[")
    ? authority.slice(1, authority.indexOf("]"))
    : authority.split(":")[0].toLowerCase();
  if (!hostname) return { ok: false, reason: "invalid_url" };
  if (protocol === "wss") return { ok: true, url: raw };
  if (protocol === "ws" && isLoopback(hostname)) {
    return { ok: true, url: raw, localOnly: true };
  }
  return { ok: false, reason: "secure_websocket_required" };
}

function resolveRoomEndpoint(options) {
  const opts = options || {};
  const globalObject = opts.globalObject || (typeof globalThis !== "undefined" ? globalThis : {});
  const wxApi = opts.wxApi || null;
  const explicit = opts.url
    || globalObject.__ANIMAL_FOOTBALL_ROOM_WSS__
    || wxApi && wxApi.__ANIMAL_FOOTBALL_ROOM_WSS__
    || "";
  const parsed = parseSocketUrl(explicit);
  if (!parsed.ok) return parsed;

  if (parsed.localOnly) {
    let platform = "";
    try {
      const info = wxApi && typeof wxApi.getSystemInfoSync === "function"
        ? wxApi.getSystemInfoSync()
        : null;
      platform = String(info && info.platform || "").toLowerCase();
    } catch (error) {}
    if (platform && platform !== "devtools") {
      return { ok: false, reason: "loopback_devtools_only" };
    }
  }
  return parsed;
}

function endpointErrorMessage(reason) {
  const messages = {
    missing: "好友对战服务尚未配置，请先设置正式 WSS 地址",
    invalid_url: "好友对战服务地址格式错误",
    unsafe_url: "好友对战服务地址不能包含账号、查询参数或锚点",
    secure_websocket_required: "好友对战必须使用 wss://；仅开发者工具可使用本机 ws://",
    loopback_devtools_only: "本机房间服务只能在微信开发者工具中使用",
  };
  return messages[reason] || "好友对战服务当前不可用";
}

module.exports = { endpointErrorMessage, parseSocketUrl, resolveRoomEndpoint };
