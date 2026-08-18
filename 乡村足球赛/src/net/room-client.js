const PROTOCOL_VERSION = 1;
const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_PONG_TIMEOUT_MS = 5_000;
const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];
const SNAPSHOT_HEADER_BYTES = 64;
const SNAPSHOT_MAGIC = [0x52, 0x46, 0x46, 0x53]; // RFFS
const MAX_JSON_SNAPSHOT_BYTES = 256 * 1024;

function defaultSocketFactory(options) {
  const wxApi = typeof wx !== "undefined" ? wx : null;
  if (!wxApi || typeof wxApi.connectSocket !== "function") {
    throw new Error("当前环境不支持 wx.connectSocket");
  }
  return wxApi.connectSocket(options);
}

function isArrayBuffer(value) {
  return typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer;
}

function writeAscii(bytes, offset, length, value) {
  const text = String(value || "");
  for (let index = 0; index < length; index += 1) {
    const code = index < text.length ? text.charCodeAt(index) : 0;
    bytes[offset + index] = code > 0 && code < 128 ? code : 0x3f;
  }
}

function readAscii(bytes, offset, length) {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    const code = bytes[offset + index];
    if (!code) break;
    result += String.fromCharCode(code);
  }
  return result;
}

function encodeSnapshotFrame(payload, details) {
  if (!isArrayBuffer(payload)) throw new TypeError("权威快照必须是 ArrayBuffer");
  const meta = details || {};
  const output = new ArrayBuffer(SNAPSHOT_HEADER_BYTES + payload.byteLength);
  const bytes = new Uint8Array(output);
  const view = new DataView(output);
  bytes.set(SNAPSHOT_MAGIC, 0);
  bytes[4] = PROTOCOL_VERSION;
  bytes[5] = 1;
  view.setUint16(6, SNAPSHOT_HEADER_BYTES, false);
  writeAscii(bytes, 8, 22, meta.roomId);
  writeAscii(bytes, 30, 22, meta.matchId);
  view.setUint32(52, Number(meta.seq) >>> 0, false);
  view.setUint32(56, payload.byteLength >>> 0, false);
  bytes.set(new Uint8Array(payload), SNAPSHOT_HEADER_BYTES);
  return output;
}

function decodeSnapshotFrame(packet) {
  if (!isArrayBuffer(packet) || packet.byteLength < SNAPSHOT_HEADER_BYTES) return null;
  const bytes = new Uint8Array(packet);
  for (let index = 0; index < SNAPSHOT_MAGIC.length; index += 1) {
    if (bytes[index] !== SNAPSHOT_MAGIC[index]) return null;
  }
  const view = new DataView(packet);
  const version = bytes[4];
  const kind = bytes[5];
  const headerBytes = view.getUint16(6, false);
  const payloadBytes = view.getUint32(56, false);
  if (version !== PROTOCOL_VERSION || kind !== 1 || headerBytes !== SNAPSHOT_HEADER_BYTES) return null;
  if (payloadBytes !== packet.byteLength - headerBytes) return null;
  return {
    type: "snapshot",
    v: version,
    roomId: readAscii(bytes, 8, 22),
    matchId: readAscii(bytes, 30, 22),
    seq: view.getUint32(52, false),
    binary: packet.slice(headerBytes),
  };
}

function isJsonSnapshotPayload(value) {
  if (typeof value === "string") return true;
  if (Array.isArray(value)) return true;
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8ByteLength(value) {
  let bytes = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function toError(value, fallback) {
  if (value instanceof Error) return value;
  const message = value && (value.message || value.errMsg || value.reason || value.code);
  const error = new Error(String(message || fallback || "房间连接失败"));
  if (value && value.code) error.code = value.code;
  return error;
}

function socketIsOpen(socket, openFlag) {
  if (!socket || !openFlag) return false;
  if (typeof socket.readyState !== "number") return true;
  return socket.readyState === 1;
}

function bindSocket(socket, name, handler) {
  const wxMethod = `on${name[0].toUpperCase()}${name.slice(1)}`;
  if (socket && typeof socket[wxMethod] === "function") {
    socket[wxMethod](handler);
    return true;
  }
  if (socket && typeof socket.addEventListener === "function") {
    socket.addEventListener(name, handler);
    return true;
  }
  return false;
}

class RoomClient {
  constructor(options) {
    const opts = options || {};
    const timers = opts.timers || {};
    this.protocolVersion = Number(opts.protocolVersion) || PROTOCOL_VERSION;
    this.url = String(opts.url || "");
    this.socketFactory = opts.socketFactory || defaultSocketFactory;
    this.setTimeout = timers.setTimeout || setTimeout;
    this.clearTimeout = timers.clearTimeout || clearTimeout;
    this.setInterval = timers.setInterval || setInterval;
    this.clearInterval = timers.clearInterval || clearInterval;
    this.now = timers.now || Date.now;
    this.heartbeatMs = Math.max(1_000, Number(opts.heartbeatMs) || DEFAULT_HEARTBEAT_MS);
    this.pongTimeoutMs = Math.max(500, Number(opts.pongTimeoutMs) || DEFAULT_PONG_TIMEOUT_MS);
    this.reconnectDelays = Array.isArray(opts.reconnectDelays) && opts.reconnectDelays.length
      ? opts.reconnectDelays.map((value) => Math.max(0, Number(value) || 0))
      : DEFAULT_RECONNECT_DELAYS_MS.slice();
    this.autoReconnect = opts.autoReconnect !== false;

    this.socket = null;
    this.state = "idle";
    this.connected = false;
    this.authenticated = false;
    this.roomId = "";
    this.matchId = "";
    this.invite = "";
    this.role = "";
    this.resumeToken = "";
    this.sessionToken = "";

    this._listeners = new Map();
    this._authData = null;
    this._manualClose = false;
    this._opening = false;
    this._epoch = 0;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._pongTimer = null;
    this._inputSeq = 0;
    this._snapshotSeq = 0;
    this._resumeAfterAuth = false;
  }

  on(type, handler) {
    if (typeof handler !== "function") throw new TypeError("房间事件处理器必须是函数");
    const key = String(type);
    let listeners = this._listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this._listeners.set(key, listeners);
    }
    listeners.add(handler);
    return () => this.off(key, handler);
  }

  once(type, handler) {
    const unsubscribe = this.on(type, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off(type, handler) {
    const listeners = this._listeners.get(String(type));
    if (!listeners) return;
    listeners.delete(handler);
    if (!listeners.size) this._listeners.delete(String(type));
  }

  _emit(type, payload) {
    const listeners = this._listeners.get(String(type));
    if (!listeners) return;
    for (const handler of Array.from(listeners)) {
      try { handler(payload); } catch (error) {
        if (type !== "listener-error") this._emit("listener-error", { type, error });
      }
    }
  }

  connect(options) {
    const opts = typeof options === "string" ? { url: options } : (options || {});
    if (opts.url) this.url = String(opts.url);
    if (Object.prototype.hasOwnProperty.call(opts, "autoReconnect")) this.autoReconnect = opts.autoReconnect !== false;
    if (opts.auth) this._authData = Object.assign({}, opts.auth);
    if (opts.sessionToken) {
      this.sessionToken = String(opts.sessionToken);
      this._authData = { sessionToken: this.sessionToken };
    }
    if (opts.resumeToken) this.resumeToken = String(opts.resumeToken);
    this._resumeAfterAuth = !!this.resumeToken;
    if (!this.url) {
      const error = new Error("未配置好友对战 WSS 地址");
      error.code = "ROOM_SERVER_NOT_CONFIGURED";
      this.state = "error";
      this._emit("error", error);
      return false;
    }
    this._cancelReconnect();
    this._manualClose = false;
    this._reconnectAttempt = 0;
    return this._openSocket(false);
  }

  auth(credentials) {
    this._authData = Object.assign({}, credentials || {});
    return this._send("auth", this._authData);
  }

  createRoom(config) {
    return this._send("create_room", { config: config || {} });
  }

  joinInvite(invite) {
    const token = String(invite || "").trim();
    if (!token) return this._rejectSend("join_invite", "邀请令牌为空");
    return this._send("join_invite", { invite: token });
  }

  updateConfig(patch) {
    return this._send("update_config", { patch: patch || {} });
  }

  setReady(ready) {
    return this._send("ready", { ready: ready !== false });
  }

  setLoadReady(details) {
    const meta = details || {};
    return this._send("load_ready", {
      roomId: String(meta.roomId || this.roomId || ""),
      matchId: String(meta.matchId || this.matchId || ""),
    });
  }

  loadReady(details) {
    return this.setLoadReady(details);
  }

  requestStart() {
    return this._send("start_request");
  }

  startWarmup() {
    return this._send("host_warmup_start");
  }

  endWarmup() {
    return this._send("host_warmup_end");
  }

  queueAfterWarmup(queued) {
    return this._send("queue_after_warmup", { queued: queued !== false });
  }

  setWarmupSpectating(watching) {
    return this._send("warmup_spectate", { watching: watching !== false });
  }

  decideGuestTimeout(decision) {
    if (!["ai_takeover", "end_match"].includes(decision)) {
      return this._rejectSend("guest_timeout_decision", "断线处理决定无效");
    }
    return this._send("guest_timeout_decision", { decision });
  }

  sendInput(input, details) {
    const meta = details || {};
    const seq = Number.isInteger(meta.seq) ? meta.seq : ++this._inputSeq;
    this._inputSeq = Math.max(this._inputSeq, seq);
    return this._send("input", {
      roomId: String(meta.roomId || this.roomId || ""),
      matchId: String(meta.matchId || this.matchId || ""),
      seq,
      frame: Number.isFinite(meta.frame) ? Number(meta.frame) : 0,
      input: input || {},
    });
  }

  sendSnapshot(payload, details) {
    const meta = details || {};
    if (isArrayBuffer(payload)) {
      const seq = Number.isInteger(meta.seq) ? meta.seq : ++this._snapshotSeq;
      this._snapshotSeq = Math.max(this._snapshotSeq, seq);
      let packet;
      try {
        packet = encodeSnapshotFrame(payload, {
          roomId: String(meta.roomId || this.roomId || ""),
          matchId: String(meta.matchId || this.matchId || ""),
          seq,
        });
      } catch (cause) {
        return this._rejectSend("snapshot", "权威快照封装失败", cause);
      }
      return this._sendBinary("snapshot", packet);
    }
    if (!isJsonSnapshotPayload(payload)) {
      return this._rejectSend("snapshot", "JSON 快照只支持字符串、数组或普通对象");
    }
    let serializedPayload;
    try { serializedPayload = JSON.stringify(payload == null ? null : payload); } catch (cause) {
      return this._rejectSend("snapshot", "JSON 快照无法序列化", cause);
    }
    if (utf8ByteLength(serializedPayload) > MAX_JSON_SNAPSHOT_BYTES) {
      return this._rejectSend("snapshot", "JSON 快照超过 256 KiB 上限");
    }
    const seq = Number.isInteger(meta.seq) ? meta.seq : ++this._snapshotSeq;
    this._snapshotSeq = Math.max(this._snapshotSeq, seq);
    return this._send("snapshot", {
      roomId: String(meta.roomId || this.roomId || ""),
      matchId: String(meta.matchId || this.matchId || ""),
      seq,
      phase: meta.phase === "warmup" ? "warmup" : "friend",
      payload,
    });
  }

  sendMatchEnd(result) {
    return this._send("match_end", {
      roomId: this.roomId,
      matchId: this.matchId,
      result: result || null,
    });
  }

  resume(token) {
    const resumeToken = String(token || this.resumeToken || "");
    if (!resumeToken) return this._rejectSend("resume", "恢复令牌为空");
    this.resumeToken = resumeToken;
    return this._send("resume", { resumeToken });
  }

  _openSocket(isReconnect) {
    if (this._opening || this.connected) return false;
    this._opening = true;
    this.state = isReconnect ? "reconnecting" : "connecting";
    this._emit("state", { state: this.state, attempt: this._reconnectAttempt });
    const epoch = ++this._epoch;
    let socket;
    try {
      socket = this.socketFactory({ url: this.url });
    } catch (cause) {
      this._opening = false;
      const error = toError(cause, "创建房间连接失败");
      this._emit("error", error);
      this._scheduleReconnect(error);
      return false;
    }
    if (!socket || typeof socket.send !== "function") {
      this._opening = false;
      const error = new Error("Socket 工厂未返回可用连接");
      this._emit("error", error);
      this._scheduleReconnect(error);
      return false;
    }
    this.socket = socket;
    const active = (handler) => (event) => {
      if (epoch !== this._epoch || socket !== this.socket) return;
      handler.call(this, event || {});
    };
    bindSocket(socket, "open", active(() => this._handleOpen(isReconnect)));
    bindSocket(socket, "message", active((event) => this._handleMessage(event && Object.prototype.hasOwnProperty.call(event, "data") ? event.data : event)));
    bindSocket(socket, "close", active((event) => this._handleClose(event)));
    bindSocket(socket, "error", active((event) => this._handleTransportError(event)));
    return true;
  }

  _handleOpen(isReconnect) {
    this._opening = false;
    this.connected = true;
    this.authenticated = false;
    this.state = "open";
    this._startHeartbeat();
    this._emit("open", { reconnect: !!isReconnect });
    this._emit("state", { state: this.state, attempt: this._reconnectAttempt });
    if (isReconnect) this._resumeAfterAuth = !!this.resumeToken;
    if (isReconnect && this.sessionToken) this.auth({ sessionToken: this.sessionToken });
    else if (this._authData) this.auth(this._authData);
  }

  _handleMessage(raw) {
    if (isArrayBuffer(raw)) {
      const snapshot = decodeSnapshotFrame(raw);
      if (!snapshot) {
        this._emit("protocol-error", new Error("收到无效的 RFFS 权威快照"));
        return;
      }
      if (snapshot.roomId) this.roomId = snapshot.roomId;
      if (snapshot.matchId) this.matchId = snapshot.matchId;
      this._emit("message", snapshot);
      this._emit("snapshot", snapshot);
      return;
    }
    let message = raw;
    if (typeof raw === "string") {
      try { message = JSON.parse(raw); } catch (cause) {
        this._emit("protocol-error", toError(cause, "收到无法解析的房间消息"));
        return;
      }
    }
    if (!message || typeof message !== "object") {
      this._emit("protocol-error", new Error("收到空房间消息"));
      return;
    }
    if (message.v != null && Number(message.v) !== this.protocolVersion) {
      const error = new Error("好友对战版本不兼容");
      error.code = "VERSION_MISMATCH";
      error.detail = message;
      this._emit("error", error);
      return;
    }
    const type = String(message.type || message.t || "");
    if (!type) {
      this._emit("protocol-error", new Error("房间消息缺少 type"));
      return;
    }
    if (message.roomId) this.roomId = String(message.roomId);
    if (message.matchId) this.matchId = String(message.matchId);
    if (message.resumeToken) this.resumeToken = String(message.resumeToken);
    if (message.sessionToken) this.sessionToken = String(message.sessionToken);
    if (message.invite) this.invite = String(message.invite);
    if (message.role) this.role = String(message.role);
    if (message.room && typeof message.room === "object") {
      if (message.room.roomId) this.roomId = String(message.room.roomId);
      if (message.room.matchId) this.matchId = String(message.room.matchId);
      if (message.room.role) this.role = String(message.room.role);
    }
    if (message.self && typeof message.self === "object" && message.self.role) this.role = String(message.self.role);

    if (type === "auth_ok") {
      this.authenticated = true;
      this.state = "authenticated";
      this._reconnectAttempt = 0;
      if (this.sessionToken) this._authData = { sessionToken: this.sessionToken };
      this._emit("state", { state: this.state, attempt: 0 });
      if (this._resumeAfterAuth && this.resumeToken) {
        this._resumeAfterAuth = false;
        this.resume(this.resumeToken);
      }
    } else if (type === "resume_ok") {
      this.authenticated = true;
      this._resumeAfterAuth = false;
      this.state = "authenticated";
      this._reconnectAttempt = 0;
      this._emit("state", { state: this.state, attempt: 0, resumed: true });
    } else if (type === "room_created") {
      const state = message.room || message.state;
      if (state && state.roomId) this.roomId = String(state.roomId);
      if (state && state.role) this.role = String(state.role);
    } else if (type === "room_state") {
      const state = message.room || message.state || message;
      if (state.roomId) this.roomId = String(state.roomId);
      if (state.matchId) this.matchId = String(state.matchId);
      if (state.role) this.role = String(state.role);
    } else if (type === "load_match") {
      this.matchId = String(message.matchId || this.matchId || "");
    } else if (type === "pong") {
      this._clearPongTimeout();
    } else if (type === "error") {
      const error = toError(message, "房间服务返回错误");
      error.detail = message;
      this._emit("error", error);
    }
    this._emit("message", message);
    if (type !== "error") this._emit(type, message);
  }

  _handleTransportError(event) {
    const error = toError(event, "房间网络异常");
    this._emit("transport-error", error);
    const socket = this.socket;
    this._handleClose({ reason: error.message, transportError: true });
    if (socket && typeof socket.close === "function") {
      try { socket.close({ code: 4001, reason: "transport-error" }); } catch (cause) {}
    }
  }

  _handleClose(event) {
    this._opening = false;
    this.connected = false;
    this.authenticated = false;
    this.socket = null;
    this._stopHeartbeat();
    const manual = this._manualClose;
    this.state = manual ? "closed" : "disconnected";
    this._emit("close", { manual, event: event || null });
    this._emit("state", { state: this.state, attempt: this._reconnectAttempt });
    if (!manual) this._scheduleReconnect(toError(event, "房间连接已断开"));
  }

  _send(type, payload) {
    if (!socketIsOpen(this.socket, this.connected)) return this._rejectSend(type, "房间连接尚未就绪");
    if (!this.authenticated && !["auth", "resume", "ping"].includes(type)) {
      return this._rejectSend(type, "房间身份尚未验证");
    }
    const message = Object.assign({ v: this.protocolVersion, type }, payload || {});
    let data;
    try { data = JSON.stringify(message); } catch (cause) {
      return this._rejectSend(type, "房间消息无法序列化", cause);
    }
    try {
      this.socket.send({
        data,
        fail: (event) => this._emit("send-error", { type, error: toError(event, "房间消息发送失败") }),
      });
      return true;
    } catch (cause) {
      return this._rejectSend(type, "房间消息发送失败", cause);
    }
  }

  _sendBinary(type, data) {
    if (!socketIsOpen(this.socket, this.connected)) return this._rejectSend(type, "房间连接尚未就绪");
    if (!this.authenticated) return this._rejectSend(type, "房间身份尚未验证");
    try {
      this.socket.send({
        data,
        fail: (event) => this._emit("send-error", { type, error: toError(event, "房间快照发送失败") }),
      });
      return true;
    } catch (cause) {
      return this._rejectSend(type, "房间快照发送失败", cause);
    }
  }

  _rejectSend(type, message, cause) {
    const error = toError(cause, message);
    error.type = type;
    this._emit("send-error", { type, error });
    return false;
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = this.setInterval(() => {
      if (!this.connected) return;
      this._send("ping", { clientTime: Number(this.now()) || Date.now() });
      this._clearPongTimeout();
      this._pongTimer = this.setTimeout(() => {
        this._pongTimer = null;
        const error = new Error("房间心跳超时");
        error.code = "HEARTBEAT_TIMEOUT";
        this._handleTransportError(error);
      }, this.pongTimeoutMs);
    }, this.heartbeatMs);
  }

  _clearPongTimeout() {
    if (this._pongTimer != null) this.clearTimeout(this._pongTimer);
    this._pongTimer = null;
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer != null) this.clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
    this._clearPongTimeout();
  }

  _scheduleReconnect(reason) {
    if (this._manualClose || !this.autoReconnect || this._reconnectTimer != null) return;
    if (this._reconnectAttempt >= this.reconnectDelays.length) {
      this.state = "failed";
      this._emit("reconnect-failed", { attempts: this._reconnectAttempt, error: reason });
      this._emit("state", { state: this.state, attempt: this._reconnectAttempt });
      return;
    }
    const attempt = this._reconnectAttempt + 1;
    const delay = this.reconnectDelays[this._reconnectAttempt];
    this._reconnectAttempt = attempt;
    this.state = "reconnect-wait";
    this._emit("reconnect", { attempt, delay, error: reason });
    this._emit("state", { state: this.state, attempt, delay });
    this._reconnectTimer = this.setTimeout(() => {
      this._reconnectTimer = null;
      this._openSocket(true);
    }, delay);
  }

  _cancelReconnect() {
    if (this._reconnectTimer != null) this.clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  close(options) {
    const opts = options || {};
    this._manualClose = true;
    this._cancelReconnect();
    this._stopHeartbeat();
    const socket = this.socket;
    if (socketIsOpen(socket, this.connected) && opts.leave !== false) this._send("leave", { reason: String(opts.reason || "client_close").slice(0, 64) });
    this._epoch += 1;
    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this._opening = false;
    this.state = "closed";
    if (socket && typeof socket.close === "function") {
      try { socket.close({ code: 1000, reason: "client-close" }); } catch (error) {}
    }
    this._emit("close", { manual: true, event: null });
    this._emit("state", { state: this.state, attempt: this._reconnectAttempt });
  }
}

module.exports = {
  RoomClient,
  PROTOCOL_VERSION,
  DEFAULT_RECONNECT_DELAYS_MS,
  SNAPSHOT_HEADER_BYTES,
  MAX_JSON_SNAPSHOT_BYTES,
  encodeSnapshotFrame,
  decodeSnapshotFrame,
};
