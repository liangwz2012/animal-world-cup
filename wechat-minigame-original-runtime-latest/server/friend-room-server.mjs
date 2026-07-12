import fs from "node:fs/promises";
import https from "node:https";
import { pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  MAX_JSON_BYTES,
  MAX_SNAPSHOT_BYTES,
  PROTOCOL_VERSION,
  ProtocolError,
  applyConfigPatch,
  assertKnownFields,
  assertPlainObject,
  decodeSnapshotPacket,
  hashToken,
  jsonByteLength,
  normalizeInitialConfig,
  randomToken,
  sanitizeInput,
} from "./protocol.mjs";
import { createWxCodeVerifier } from "./wx-auth.mjs";

const COMMON_FIELDS = ["v", "type", "requestId"];
const MESSAGE_FIELDS = Object.freeze({
  auth: new Set([...COMMON_FIELDS, "code", "sessionToken", "devPlayerId"]),
  create_room: new Set([...COMMON_FIELDS, "config"]),
  join_invite: new Set([...COMMON_FIELDS, "invite"]),
  update_config: new Set([...COMMON_FIELDS, "patch"]),
  ready: new Set([...COMMON_FIELDS, "ready"]),
  host_warmup_start: new Set(COMMON_FIELDS),
  host_warmup_end: new Set(COMMON_FIELDS),
  queue_after_warmup: new Set([...COMMON_FIELDS, "queued"]),
  warmup_spectate: new Set([...COMMON_FIELDS, "watching"]),
  guest_timeout_decision: new Set([...COMMON_FIELDS, "decision"]),
  start_request: new Set(COMMON_FIELDS),
  load_ready: new Set([...COMMON_FIELDS, "roomId", "matchId"]),
  input: new Set([...COMMON_FIELDS, "roomId", "matchId", "seq", "frame", "input"]),
  snapshot: new Set([...COMMON_FIELDS, "roomId", "matchId", "seq", "phase", "payload"]),
  ping: new Set([...COMMON_FIELDS, "clientTime"]),
  resume: new Set([...COMMON_FIELDS, "resumeToken"]),
  leave: new Set([...COMMON_FIELDS, "reason"]),
  match_end: new Set([...COMMON_FIELDS, "roomId", "matchId", "result"]),
});

const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "请先完成微信登录验证",
  PERMISSION_DENIED: "当前玩家无权执行此操作",
  ROOM_FULL: "房间已经有两名玩家",
  ROOM_EXPIRED: "邀请已经过期",
  ROOM_STATE_INVALID: "当前房间状态不允许此操作",
  PEER_NOT_READY: "好友尚未准备好",
  PEER_OFFLINE: "好友当前不在线",
});

function isSafeText(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function errorFrom(value) {
  if (value instanceof ProtocolError) return value;
  return new ProtocolError("SERVER_ERROR", "房间服务暂时不可用");
}

function makeRateBucket() {
  return { second: -1, counts: Object.create(null) };
}

export class FriendRoomServer {
  constructor(options = {}) {
    this.options = options;
    this.host = options.host || "127.0.0.1";
    this.port = Number(options.port ?? 8787);
    this.devAuth = options.devAuth === true;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.waitingTtlMs = Number(options.waitingTtlMs ?? 10 * 60 * 1000);
    this.hardTtlMs = Number(options.hardTtlMs ?? 30 * 60 * 1000);
    this.reconnectGraceMs = Number(options.reconnectGraceMs ?? 20 * 1000);
    this.sessionTtlMs = Number(options.sessionTtlMs ?? 15 * 60 * 1000);
    this.heartbeatTimeoutMs = Number(options.heartbeatTimeoutMs ?? 15 * 1000);
    this.kickoffDelayMs = Number(options.kickoffDelayMs ?? 3000);
    this.sweepIntervalMs = Number(options.sweepIntervalMs ?? 1000);
    this.maxConnections = Number(options.maxConnections ?? 20_000);
    this.maxRooms = Number(options.maxRooms ?? 10_000);
    this.logger = options.logger || console;
    this.verifyWxCode = options.verifyWxCode || createWxCodeVerifier(options.wx || {});
    this.rooms = new Map();
    this.invites = new Map();
    this.resumes = new Map();
    this.sessions = new Map();
    this.connections = new Set();
    this.wss = null;
    this.httpsServer = null;
    this.sweepTimer = null;
  }

  async listen() {
    if (this.wss) return this;
    const maxPayload = MAX_SNAPSHOT_BYTES + 1024;
    if (this.options.httpsServer) {
      this.wss = new WebSocketServer({ server: this.options.httpsServer, maxPayload });
    } else if (this.options.tls?.cert && this.options.tls?.key) {
      this.httpsServer = https.createServer({ cert: this.options.tls.cert, key: this.options.tls.key });
      this.wss = new WebSocketServer({ server: this.httpsServer, maxPayload });
      await new Promise((resolve, reject) => {
        this.httpsServer.once("error", reject);
        this.httpsServer.listen(this.port, this.host, resolve);
      });
    } else {
      this.wss = new WebSocketServer({ host: this.host, port: this.port, maxPayload });
      await new Promise((resolve, reject) => {
        this.wss.once("listening", resolve);
        this.wss.once("error", reject);
      });
    }
    this.wss.on("connection", (ws) => this.handleConnection(ws));
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.sweepTimer.unref?.();
    if (this.devAuth) this.logger.warn?.("[friend-room] DEV_AUTH 已开启，仅可用于本地自动测试，禁止生产使用");
    return this;
  }

  address() {
    return (this.httpsServer || this.wss)?.address?.() || null;
  }

  url() {
    const address = this.address();
    if (!address) return "";
    const host = address.address === "::" || address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
    return `${this.httpsServer ? "wss" : "ws"}://${host}:${address.port}`;
  }

  async close() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const ws of this.connections) {
      try { ws.terminate(); } catch {}
    }
    this.connections.clear();
    const wss = this.wss;
    this.wss = null;
    if (wss) await new Promise((resolve) => wss.close(() => resolve()));
    if (this.httpsServer) {
      const server = this.httpsServer;
      this.httpsServer = null;
      if (server.listening) await new Promise((resolve) => server.close(() => resolve()));
    }
  }

  handleConnection(ws) {
    if (this.connections.size >= this.maxConnections) {
      try {
        ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "error", code: "SERVER_BUSY", message: "房间服务连接数已满" }));
        ws.close(1013, "server-busy");
      } catch {}
      return;
    }
    const now = this.now();
    ws.friend = {
      authenticated: false,
      userId: "",
      roomId: "",
      role: "",
      lastSeenAt: now,
      detached: false,
      queue: Promise.resolve(),
      rate: makeRateBucket(),
    };
    this.connections.add(ws);
    ws.on("message", (raw, isBinary) => {
      ws.friend.queue = ws.friend.queue
        .then(() => this.handleRawMessage(ws, raw, isBinary))
        .catch((error) => this.sendError(ws, error));
    });
    ws.on("close", () => this.handleClose(ws));
    ws.on("error", () => {});
  }

  async handleRawMessage(ws, raw, isBinary) {
    ws.friend.lastSeenAt = this.now();
    this.consumeRate(ws, "all", 100);
    if (isBinary) {
      this.consumeRate(ws, "snapshot", 25);
      this.handleBinarySnapshot(ws, raw);
      return;
    }
    if (raw.byteLength > MAX_SNAPSHOT_BYTES + 1024) throw new ProtocolError("PAYLOAD_TOO_LARGE", "JSON 消息超过大小限制");
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      throw new ProtocolError("INVALID_JSON", "消息不是合法 JSON");
    }
    assertPlainObject(message);
    if (message.v !== PROTOCOL_VERSION) throw new ProtocolError("VERSION_MISMATCH", "客户端协议版本不兼容");
    if (typeof message.type !== "string" || !MESSAGE_FIELDS[message.type]) {
      throw new ProtocolError("UNKNOWN_MESSAGE", "不支持的消息类型");
    }
    if (message.type !== "snapshot" && raw.byteLength > MAX_JSON_BYTES) {
      throw new ProtocolError("PAYLOAD_TOO_LARGE", "控制消息超过 64 KiB 大小限制");
    }
    assertKnownFields(message, MESSAGE_FIELDS[message.type]);
    if (message.requestId != null && !isSafeText(message.requestId, 1, 64)) {
      throw new ProtocolError("INVALID_REQUEST_ID", "requestId 格式错误");
    }
    try {
      await this.handleMessage(ws, message);
    } catch (error) {
      if (message.requestId != null && error && typeof error === "object") error.requestId = message.requestId;
      throw error;
    }
  }

  async handleMessage(ws, message) {
    const requestId = message.requestId;
    switch (message.type) {
      case "auth": return this.handleAuth(ws, message);
      case "ping": {
        this.consumeRate(ws, "ping", 3);
        this.send(ws, { type: "pong", requestId, clientTime: message.clientTime ?? null, serverTime: this.now() });
        return;
      }
      case "resume": return this.handleResume(ws, message);
      default: this.requireAuth(ws);
    }
    switch (message.type) {
      case "create_room": return this.handleCreateRoom(ws, message);
      case "join_invite": return this.handleJoinInvite(ws, message);
      case "update_config": return this.handleUpdateConfig(ws, message);
      case "ready": return this.handleReady(ws, message);
      case "host_warmup_start": return this.handleWarmupStart(ws, message);
      case "host_warmup_end": return this.handleWarmupEnd(ws, message);
      case "queue_after_warmup": return this.handleQueueAfterWarmup(ws, message);
      case "warmup_spectate": return this.handleWarmupSpectate(ws, message);
      case "guest_timeout_decision": return this.handleGuestTimeoutDecision(ws, message);
      case "start_request": return this.handleStartRequest(ws, message);
      case "load_ready": return this.handleLoadReady(ws, message);
      case "input": return this.handleInput(ws, message);
      case "snapshot": return this.handleJsonSnapshot(ws, message);
      case "leave": return this.handleLeave(ws, message);
      case "match_end": return this.handleMatchEnd(ws, message);
      default: throw new ProtocolError("UNKNOWN_MESSAGE", "不支持的消息类型");
    }
  }

  async handleAuth(ws, message) {
    this.consumeRate(ws, "auth", 5);
    if (ws.friend.authenticated) throw new ProtocolError("ALREADY_AUTHENTICATED", "当前连接已经完成登录验证");
    let identity;
    if (message.sessionToken) {
      const record = this.sessions.get(hashToken(message.sessionToken));
      if (!record || record.expiresAt <= this.now()) throw new ProtocolError("SESSION_EXPIRED", "登录会话已经过期");
      identity = { userId: record.userId };
    } else if (this.devAuth) {
      if (!isSafeText(message.devPlayerId, 2, 64) || !/^[A-Za-z0-9_.-]+$/.test(message.devPlayerId)) {
        throw new ProtocolError("AUTH_INVALID_DEV_ID", "DEV_AUTH 需要合法的 devPlayerId");
      }
      identity = { userId: `dev:${message.devPlayerId}` };
    } else {
      if (message.devPlayerId != null) throw new ProtocolError("DEV_AUTH_DISABLED", "生产模式禁止使用 DEV_AUTH 身份");
      identity = await this.verifyWxCode(message.code);
    }
    if (!identity?.userId || String(identity.userId).length > 256) throw new ProtocolError("AUTH_REJECTED", "登录身份无效");
    ws.friend.authenticated = true;
    ws.friend.userId = String(identity.userId);
    const sessionToken = randomToken(32);
    this.sessions.set(hashToken(sessionToken), { userId: ws.friend.userId, expiresAt: this.now() + this.sessionTtlMs });
    this.send(ws, {
      type: "auth_ok",
      requestId: message.requestId,
      sessionToken,
      expiresAt: this.now() + this.sessionTtlMs,
    });
  }

  handleCreateRoom(ws, message) {
    this.assertUnbound(ws);
    this.assertUserNotSeated(ws.friend.userId);
    if (this.rooms.size >= this.maxRooms) throw new ProtocolError("SERVER_BUSY", "房间服务当前已满，请稍后重试");
    const config = normalizeInitialConfig(message.config);
    const now = this.now();
    const roomId = randomToken(16);
    const invite = randomToken(32);
    const room = {
      id: roomId,
      inviteHash: hashToken(invite),
      createdAt: now,
      updatedAt: now,
      waitExpiresAt: now + this.waitingTtlMs,
      hardExpiresAt: now + this.hardTtlMs,
      startedAt: 0,
      state: "waiting",
      revision: 1,
      config,
      configFrozen: true,
      host: this.createSeat(ws.friend.userId, "host", "red"),
      guest: null,
      guestReady: false,
      guestSpectating: false,
      warmupMatchId: "",
      matchId: "",
      resumeFromState: "",
      kickoffAt: 0,
      loadReady: { host: false, guest: false },
      lastInputSeq: -1,
      lastSnapshotSeq: -1,
      pulseState: Object.create(null),
      lastSnapshot: null,
    };
    this.rooms.set(roomId, room);
    this.invites.set(room.inviteHash, { roomId, expiresAt: room.waitExpiresAt });
    const resumeToken = this.issueResume(room, room.host);
    this.bindSeat(ws, room, room.host);
    this.send(ws, {
      type: "room_created",
      requestId: message.requestId,
      invite,
      resumeToken,
      room: this.roomView(room),
      self: this.seatView(room.host),
    });
    this.sendRoomStates(room);
  }

  handleJoinInvite(ws, message) {
    this.assertUnbound(ws);
    if (!isSafeText(message.invite, 32, 128)) throw new ProtocolError("INVALID_INVITE", "邀请令牌格式错误");
    const record = this.invites.get(hashToken(message.invite));
    const room = record && this.rooms.get(record.roomId);
    if (!record || !room || record.expiresAt <= this.now() || room.hardExpiresAt <= this.now()) {
      throw new ProtocolError("ROOM_EXPIRED", ERROR_MESSAGES.ROOM_EXPIRED);
    }
    if (room.startedAt || ["loading", "playing"].includes(room.state)) {
      throw new ProtocolError("ROOM_ALREADY_STARTED", "好友对战已经开始");
    }
    if (room.host.userId === ws.friend.userId) throw new ProtocolError("SELF_JOIN", "不能加入自己创建的房间");
    this.assertUserNotSeated(ws.friend.userId);
    if (room.guest) throw new ProtocolError("ROOM_FULL", ERROR_MESSAGES.ROOM_FULL);
    room.guest = this.createSeat(ws.friend.userId, "guest", "blue");
    room.guestReady = true;
    room.guestSpectating = false;
    room.revision += 1;
    room.updatedAt = this.now();
    const resumeToken = this.issueResume(room, room.guest);
    this.bindSeat(ws, room, room.guest);
    this.send(ws, {
      type: "room_state",
      requestId: message.requestId,
      resumeToken,
      room: this.roomView(room),
      self: this.seatView(room.guest),
    });
    this.sendRoomStates(room);
  }

  handleUpdateConfig(ws, message) {
    const { room, seat } = this.boundRoom(ws);
    if (room.configFrozen) {
      if (seat.role === "guest") throw new ProtocolError("PERMISSION_DENIED", "邀请配置已由房主锁定，好友不能修改蓝方配置");
      throw new ProtocolError("CONFIG_FROZEN", "邀请发出后比赛配置已经锁定");
    }
    if (room.state !== "waiting") throw new ProtocolError("ROOM_STATE_INVALID", ERROR_MESSAGES.ROOM_STATE_INVALID);
    room.config = applyConfigPatch(room.config, message.patch, seat.role);
    room.guestReady = false;
    room.revision += 1;
    room.updatedAt = this.now();
    this.sendRoomStates(room);
  }

  handleReady(ws, message) {
    const { room, seat } = this.boundRoom(ws, "guest");
    if (!["waiting", "warmup", "queue_after_warmup"].includes(room.state)) throw new ProtocolError("ROOM_STATE_INVALID", ERROR_MESSAGES.ROOM_STATE_INVALID);
    if (typeof message.ready !== "boolean") throw new ProtocolError("INVALID_READY", "ready 必须是布尔值");
    room.guestReady = message.ready;
    room.revision += 1;
    room.updatedAt = this.now();
    this.sendRoomStates(room);
  }

  handleWarmupStart(ws) {
    const { room } = this.boundRoom(ws, "host");
    if (room.state !== "waiting" || room.startedAt) throw new ProtocolError("ROOM_STATE_INVALID", "当前不能开始 AI 热身赛");
    room.state = "warmup";
    room.warmupMatchId = randomToken(16);
    room.guestSpectating = false;
    room.lastSnapshotSeq = -1;
    room.lastSnapshot = null;
    room.revision += 1;
    room.updatedAt = this.now();
    this.sendRoomStates(room);
  }

  handleWarmupEnd(ws) {
    const { room } = this.boundRoom(ws, "host");
    if (!["warmup", "queue_after_warmup"].includes(room.state)) throw new ProtocolError("ROOM_STATE_INVALID", "当前没有进行中的 AI 热身赛");
    const shouldStartFriend = room.state === "queue_after_warmup";
    if (room.guest?.ws && room.guestSpectating) {
      this.send(room.guest.ws, {
        type: "match_end",
        phase: "warmup",
        roomContinues: true,
        roomId: room.id,
        matchId: room.warmupMatchId,
        reason: "host_ended_warmup",
      });
    }
    room.state = "waiting";
    room.warmupMatchId = "";
    room.guestSpectating = false;
    room.lastSnapshotSeq = -1;
    room.lastSnapshot = null;
    room.revision += 1;
    room.updatedAt = this.now();
    if (shouldStartFriend && room.guest?.ws && room.guestReady) this.beginFormalLoad(room);
    else this.sendRoomStates(room);
  }

  handleQueueAfterWarmup(ws, message) {
    const { room } = this.boundRoom(ws, "host");
    if (!["warmup", "queue_after_warmup"].includes(room.state)) {
      throw new ProtocolError("ROOM_STATE_INVALID", "当前没有可排队的 AI 热身赛");
    }
    if (typeof message.queued !== "boolean") throw new ProtocolError("INVALID_QUEUE", "queued 必须是布尔值");
    room.state = message.queued ? "queue_after_warmup" : "warmup";
    room.revision += 1;
    room.updatedAt = this.now();
    this.sendRoomStates(room);
  }

  handleWarmupSpectate(ws, message) {
    const { room } = this.boundRoom(ws, "guest");
    if (!["warmup", "queue_after_warmup"].includes(room.state)) throw new ProtocolError("ROOM_STATE_INVALID", "当前没有可观看的 AI 热身赛");
    if (typeof message.watching !== "boolean") throw new ProtocolError("INVALID_SPECTATE", "watching 必须是布尔值");
    room.guestSpectating = message.watching;
    room.revision += 1;
    room.updatedAt = this.now();
    if (message.watching) {
      this.send(ws, {
        type: "load_match",
        phase: "warmup",
        spectator: true,
        roomId: room.id,
        matchId: room.warmupMatchId,
        config: room.config,
      });
      this.sendLastSnapshot(ws, room);
    }
    this.sendRoomStates(room);
  }

  handleGuestTimeoutDecision(ws, message) {
    const { room } = this.boundRoom(ws, "host");
    if (room.state !== "paused" || !room.startedAt || !room.guest?.reconnectExpired) {
      throw new ProtocolError("ROOM_STATE_INVALID", "好友尚未超过恢复时限");
    }
    if (!new Set(["ai_takeover", "end_match"]).has(message.decision)) {
      throw new ProtocolError("INVALID_DECISION", "decision 只能是 ai_takeover 或 end_match");
    }
    if (message.decision === "end_match") {
      this.finishRoom(room, "host_ended_after_guest_timeout");
      return;
    }
    const guest = room.guest;
    if (guest.resumeHash) this.resumes.delete(guest.resumeHash);
    room.guest = null;
    room.guestReady = false;
    room.guestSpectating = false;
    room.resumeFromState = "";
    room.state = "playing";
    room.revision += 1;
    room.updatedAt = this.now();
    const resumeAt = this.now() + this.kickoffDelayMs;
    this.send(room.host.ws, {
      type: "resume_ok",
      phase: "friend",
      roomId: room.id,
      matchId: room.matchId,
      aiTakeover: true,
      resumeAt,
      serverTime: this.now(),
    });
    this.sendRoomStates(room);
  }

  handleStartRequest(ws) {
    const { room } = this.boundRoom(ws, "host");
    if (room.state !== "waiting" || room.startedAt) throw new ProtocolError("ROOM_STATE_INVALID", ERROR_MESSAGES.ROOM_STATE_INVALID);
    if (!room.guest || !room.guest.ws) throw new ProtocolError("PEER_OFFLINE", ERROR_MESSAGES.PEER_OFFLINE);
    if (!room.guestReady) throw new ProtocolError("PEER_NOT_READY", ERROR_MESSAGES.PEER_NOT_READY);
    this.beginFormalLoad(room);
  }

  beginFormalLoad(room) {
    room.state = "loading";
    room.startedAt = this.now();
    room.matchId = randomToken(16);
    room.loadReady = { host: false, guest: false };
    room.kickoffAt = 0;
    room.lastInputSeq = -1;
    room.lastSnapshotSeq = -1;
    room.pulseState = Object.create(null);
    room.lastSnapshot = null;
    room.revision += 1;
    room.updatedAt = this.now();
    for (const seat of [room.host, room.guest]) {
      this.send(seat.ws, {
        type: "load_match",
        phase: "friend",
        roomId: room.id,
        matchId: room.matchId,
        config: room.config,
        role: seat.role,
        side: seat.side,
      });
    }
    this.sendRoomStates(room);
  }

  handleLoadReady(ws, message) {
    const { room, seat } = this.boundRoom(ws);
    if (room.state !== "loading") throw new ProtocolError("ROOM_STATE_INVALID", ERROR_MESSAGES.ROOM_STATE_INVALID);
    this.assertMatchIdentity(room, message);
    room.loadReady[seat.role] = true;
    room.updatedAt = this.now();
    if (room.loadReady.host && room.loadReady.guest) {
      room.state = "playing";
      room.kickoffAt = this.now() + this.kickoffDelayMs;
      room.revision += 1;
      this.broadcast(room, {
        type: "kickoff_at",
        phase: "friend",
        roomId: room.id,
        matchId: room.matchId,
        kickoffAt: room.kickoffAt,
        serverTime: this.now(),
      });
      this.sendRoomStates(room);
    }
  }

  handleInput(ws, message) {
    this.consumeRate(ws, "input", 40);
    const { room } = this.boundRoom(ws, "guest");
    if (room.state !== "playing") throw new ProtocolError("ROOM_STATE_INVALID", "正式比赛尚未开始或已经暂停");
    this.assertMatchIdentity(room, message);
    const seq = this.assertSequence(message.seq, room.lastInputSeq, "input");
    const frame = Number(message.frame ?? 0);
    if (!Number.isSafeInteger(frame) || frame < 0) throw new ProtocolError("INVALID_INPUT", "frame 必须是非负整数");
    const input = sanitizeInput(message.input, room.pulseState);
    room.lastInputSeq = seq;
    room.updatedAt = this.now();
    this.send(room.host.ws, {
      type: "input",
      roomId: room.id,
      matchId: room.matchId,
      seq,
      frame,
      input,
    });
  }

  handleJsonSnapshot(ws, message) {
    this.consumeRate(ws, "snapshot", 25);
    const { room } = this.boundRoom(ws, "host");
    const isWarmup = room.state === "warmup" || room.state === "queue_after_warmup";
    const phase = isWarmup ? "warmup" : "friend";
    if (!isWarmup && room.state !== "playing") {
      throw new ProtocolError("ROOM_STATE_INVALID", "当前房间不能发送比赛快照");
    }
    const expectedMatchId = phase === "warmup" ? room.warmupMatchId : room.matchId;
    if (message.roomId !== room.id || message.matchId !== expectedMatchId) {
      throw new ProtocolError("MATCH_MISMATCH", "snapshot 不属于当前比赛");
    }
    if (message.phase != null && message.phase !== phase) throw new ProtocolError("MATCH_MISMATCH", "snapshot 阶段不匹配");
    const seq = this.assertSequence(message.seq, room.lastSnapshotSeq, "snapshot");
    if (message.payload == null || !["string", "object"].includes(typeof message.payload)) {
      throw new ProtocolError("INVALID_SNAPSHOT", "JSON snapshot payload 格式错误");
    }
    if (jsonByteLength(message.payload) > MAX_SNAPSHOT_BYTES) throw new ProtocolError("PAYLOAD_TOO_LARGE", "snapshot 超过大小限制");
    room.lastSnapshotSeq = seq;
    room.updatedAt = this.now();
    const outgoing = {
      v: PROTOCOL_VERSION,
      type: "snapshot",
      phase,
      roomId: room.id,
      matchId: expectedMatchId,
      seq,
      payload: message.payload,
    };
    room.lastSnapshot = { binary: false, data: outgoing };
    if (this.shouldRelaySnapshot(room, phase)) this.send(room.guest.ws, outgoing);
  }

  handleBinarySnapshot(ws, raw) {
    this.requireAuth(ws);
    const { room } = this.boundRoom(ws, "host");
    const decoded = decodeSnapshotPacket(raw);
    const isWarmup = room.state === "warmup" || room.state === "queue_after_warmup";
    const phase = isWarmup ? "warmup" : "friend";
    if (!isWarmup && room.state !== "playing") {
      throw new ProtocolError("ROOM_STATE_INVALID", "当前房间不能发送比赛快照");
    }
    const expectedMatchId = phase === "warmup" ? room.warmupMatchId : room.matchId;
    if (decoded.roomId !== room.id || decoded.matchId !== expectedMatchId) {
      throw new ProtocolError("MATCH_MISMATCH", "snapshot 不属于当前比赛");
    }
    room.lastSnapshotSeq = this.assertSequence(decoded.seq, room.lastSnapshotSeq, "snapshot");
    room.updatedAt = this.now();
    room.lastSnapshot = { binary: true, data: Buffer.from(decoded.packet) };
    if (this.shouldRelaySnapshot(room, phase)) this.sendRaw(room.guest.ws, decoded.packet);
  }

  handleResume(ws, message) {
    this.requireAuth(ws);
    this.assertUnbound(ws);
    if (!isSafeText(message.resumeToken, 32, 128)) throw new ProtocolError("INVALID_RESUME", "恢复令牌格式错误");
    const tokenHash = hashToken(message.resumeToken);
    const record = this.resumes.get(tokenHash);
    const room = record && this.rooms.get(record.roomId);
    const seat = room && room[record.role];
    if (!record || !room || !seat || record.expiresAt <= this.now() || room.hardExpiresAt <= this.now()) {
      throw new ProtocolError("RESUME_EXPIRED", "恢复令牌已经过期");
    }
    if (record.userId !== ws.friend.userId || seat.userId !== ws.friend.userId) {
      throw new ProtocolError("RESUME_IDENTITY_MISMATCH", "恢复令牌与当前微信身份不一致");
    }
    if (seat.ws) throw new ProtocolError("PLAYER_ALREADY_ONLINE", "该玩家已经在线");
    if (seat.disconnectedAt && this.now() - seat.disconnectedAt > this.reconnectGraceMs) {
      throw new ProtocolError("RESUME_EXPIRED", "已超过 20 秒恢复时间");
    }
    this.resumes.delete(tokenHash);
    const resumeToken = this.issueResume(room, seat);
    this.bindSeat(ws, room, seat);
    this.send(ws, {
      type: "resume_ok",
      requestId: message.requestId,
      resumeToken,
      room: this.roomView(room),
      self: this.seatView(seat),
      serverTime: this.now(),
    });
    if (seat.role === "guest" && ["warmup", "queue_after_warmup"].includes(room.state) && room.guestSpectating) {
      this.send(ws, {
        type: "load_match",
        phase: "warmup",
        spectator: true,
        roomId: room.id,
        matchId: room.warmupMatchId,
        config: room.config,
      });
      this.sendLastSnapshot(ws, room);
    }
    this.maybeResumeRoom(room);
    this.sendRoomStates(room);
  }

  handleLeave(ws) {
    const { room, seat } = this.boundRoom(ws);
    if (seat.role === "host") {
      this.finishRoom(room, "host_left");
      return;
    }
    if (["loading", "playing", "paused"].includes(room.state) && room.startedAt) {
      this.finishRoom(room, "guest_left");
      return;
    }
    this.removeGuest(room, "guest_left");
  }

  handleMatchEnd(ws, message) {
    const { room } = this.boundRoom(ws, "host");
    if (!room.startedAt || !["playing", "paused"].includes(room.state)) {
      throw new ProtocolError("ROOM_STATE_INVALID", ERROR_MESSAGES.ROOM_STATE_INVALID);
    }
    this.assertMatchIdentity(room, message);
    if (message.result != null && jsonByteLength(message.result) > 4096) {
      throw new ProtocolError("PAYLOAD_TOO_LARGE", "比赛结果超过大小限制");
    }
    this.finishRoom(room, "completed", message.result ?? null);
  }

  handleClose(ws) {
    this.connections.delete(ws);
    if (ws.friend?.detached) return;
    ws.friend.detached = true;
    const room = ws.friend.roomId && this.rooms.get(ws.friend.roomId);
    const seat = room && room[ws.friend.role];
    if (!room || !seat || seat.ws !== ws) return;
    seat.ws = null;
    seat.disconnectedAt = this.now();
    room.updatedAt = this.now();
    room.revision += 1;

    if (seat.role === "guest" && room.state === "playing" && room.host.ws) {
      room.lastInputSeq += 1;
      this.send(room.host.ws, {
        type: "input",
        roomId: room.id,
        matchId: room.matchId,
        seq: room.lastInputSeq,
        frame: 0,
        synthetic: true,
        input: { active: false, vx: 0, vy: 0, sprint: false, shoot: false, pass: false, lob: false, tackle: false, switchPlayer: false },
      });
    }

    const shouldPause = room.state === "loading"
      || room.state === "playing"
      || (seat.role === "host" && ["warmup", "queue_after_warmup"].includes(room.state));
    if (shouldPause) {
      room.resumeFromState = room.state;
      room.state = "paused";
      this.broadcast(room, {
        type: "pause",
        roomId: room.id,
        matchId: room.matchId || room.warmupMatchId,
        disconnectedRole: seat.role,
        reconnectDeadline: this.now() + this.reconnectGraceMs,
      });
    }
    this.sendRoomStates(room);
  }

  sweep() {
    const now = this.now();
    for (const [hash, record] of this.sessions) if (record.expiresAt <= now) this.sessions.delete(hash);
    for (const [hash, record] of this.resumes) if (record.expiresAt <= now) this.resumes.delete(hash);
    for (const [hash, record] of this.invites) if (record.expiresAt <= now) this.invites.delete(hash);

    for (const ws of this.connections) {
      if (now - ws.friend.lastSeenAt > this.heartbeatTimeoutMs) {
        this.handleClose(ws);
        try { ws.terminate(); } catch {}
      }
    }

    for (const room of [...this.rooms.values()]) {
      if (room.hardExpiresAt <= now) {
        this.finishRoom(room, "hard_expired");
        continue;
      }
      if (!room.startedAt && room.waitExpiresAt <= now) {
        this.finishRoom(room, "waiting_expired");
        continue;
      }
      for (const seat of [room.host, room.guest].filter(Boolean)) {
        if (!seat.ws && seat.disconnectedAt && now - seat.disconnectedAt > this.reconnectGraceMs) {
          if (seat.role === "host") {
            this.finishRoom(room, "host_reconnect_timeout");
          } else if (room.startedAt && !seat.reconnectExpired) {
            seat.reconnectExpired = true;
            if (seat.resumeHash) this.resumes.delete(seat.resumeHash);
            this.broadcast(room, {
              type: "pause",
              roomId: room.id,
              matchId: room.matchId,
              disconnectedRole: "guest",
              reconnectExpired: true,
              options: ["ai_takeover", "end_match"],
            });
          } else {
            this.removeGuest(room, "guest_reconnect_timeout");
          }
          break;
        }
      }
    }
  }

  createSeat(userId, role, side) {
    return { userId, role, side, ws: null, disconnectedAt: 0, reconnectExpired: false, resumeHash: "" };
  }

  issueResume(room, seat) {
    if (seat.resumeHash) this.resumes.delete(seat.resumeHash);
    const token = randomToken(32);
    seat.resumeHash = hashToken(token);
    this.resumes.set(seat.resumeHash, {
      roomId: room.id,
      role: seat.role,
      userId: seat.userId,
      expiresAt: room.hardExpiresAt,
    });
    return token;
  }

  bindSeat(ws, room, seat) {
    seat.ws = ws;
    seat.disconnectedAt = 0;
    seat.reconnectExpired = false;
    ws.friend.roomId = room.id;
    ws.friend.role = seat.role;
    ws.friend.detached = false;
  }

  removeGuest(room, reason) {
    if (!room.guest) return;
    const guest = room.guest;
    if (guest.resumeHash) this.resumes.delete(guest.resumeHash);
    if (guest.ws) {
      guest.ws.friend.roomId = "";
      guest.ws.friend.role = "";
      this.send(guest.ws, { type: "match_end", phase: "room", roomId: room.id, reason, roomContinues: false });
    }
    room.guest = null;
    room.guestReady = false;
    room.guestSpectating = false;
    if (room.state === "paused" && !room.startedAt) {
      room.state = ["warmup", "queue_after_warmup"].includes(room.resumeFromState) ? room.resumeFromState : "waiting";
    }
    room.revision += 1;
    room.updatedAt = this.now();
    this.sendRoomStates(room);
  }

  finishRoom(room, reason, result = null) {
    if (!this.rooms.has(room.id)) return;
    this.broadcast(room, {
      type: "match_end",
      phase: room.startedAt ? "friend" : "room",
      roomId: room.id,
      matchId: room.matchId || room.warmupMatchId || undefined,
      reason,
      result,
      roomContinues: false,
    });
    this.rooms.delete(room.id);
    this.invites.delete(room.inviteHash);
    for (const seat of [room.host, room.guest].filter(Boolean)) {
      if (seat.resumeHash) this.resumes.delete(seat.resumeHash);
      if (seat.ws?.friend) {
        seat.ws.friend.roomId = "";
        seat.ws.friend.role = "";
      }
    }
  }

  maybeResumeRoom(room) {
    if (room.state !== "paused" || !room.host.ws || (room.guest && !room.guest.ws)) return;
    const previous = room.resumeFromState;
    room.resumeFromState = "";
    room.state = previous || (room.startedAt ? "playing" : "waiting");
    room.revision += 1;
    const resumeAt = ["playing", "warmup", "queue_after_warmup"].includes(room.state) ? this.now() + this.kickoffDelayMs : 0;
    this.broadcast(room, {
      type: "resume_ok",
      roomId: room.id,
      matchId: room.matchId || room.warmupMatchId || undefined,
      phase: ["warmup", "queue_after_warmup"].includes(room.state) ? "warmup" : "friend",
      resumeAt,
      serverTime: this.now(),
    });
    if (resumeAt) {
      this.broadcast(room, {
        type: "kickoff_at",
        roomId: room.id,
        matchId: room.matchId || room.warmupMatchId,
        phase: ["warmup", "queue_after_warmup"].includes(room.state) ? "warmup" : "friend",
        kickoffAt: resumeAt,
        resume: true,
        serverTime: this.now(),
      });
    }
    if (room.guest?.ws && room.lastSnapshot && (!["warmup", "queue_after_warmup"].includes(room.state) || room.guestSpectating)) {
      this.sendLastSnapshot(room.guest.ws, room);
    }
  }

  shouldRelaySnapshot(room, phase) {
    return !!room.guest?.ws && (phase === "friend" || room.guestSpectating);
  }

  sendLastSnapshot(ws, room) {
    if (!room.lastSnapshot) return;
    if (room.lastSnapshot.binary) this.sendRaw(ws, room.lastSnapshot.data);
    else this.send(ws, room.lastSnapshot.data);
  }

  assertMatchIdentity(room, message) {
    if (message.roomId !== room.id || message.matchId !== room.matchId) {
      throw new ProtocolError("MATCH_MISMATCH", "消息不属于当前正式比赛");
    }
  }

  assertSequence(value, previous, label) {
    const seq = Number(value);
    if (!Number.isSafeInteger(seq) || seq < 0 || seq > 0xffffffff) {
      throw new ProtocolError("INVALID_SEQUENCE", `${label} seq 格式错误`);
    }
    if (seq <= previous) throw new ProtocolError("STALE_SEQUENCE", `${label} seq 重复或倒序`);
    return seq;
  }

  assertUnbound(ws) {
    if (ws.friend.roomId) throw new ProtocolError("ALREADY_IN_ROOM", "当前连接已经加入房间");
  }

  assertUserNotSeated(userId) {
    for (const room of this.rooms.values()) {
      if (room.host.userId === userId || room.guest?.userId === userId) {
        throw new ProtocolError("ALREADY_IN_ROOM", "当前微信身份已经占用一个房间席位");
      }
    }
  }

  requireAuth(ws) {
    if (!ws.friend?.authenticated) throw new ProtocolError("AUTH_REQUIRED", ERROR_MESSAGES.AUTH_REQUIRED);
  }

  boundRoom(ws, role = "") {
    this.requireAuth(ws);
    const room = ws.friend.roomId && this.rooms.get(ws.friend.roomId);
    const seat = room && room[ws.friend.role];
    if (!room || !seat || seat.ws !== ws) throw new ProtocolError("NOT_IN_ROOM", "当前连接尚未加入有效房间");
    if (role && seat.role !== role) throw new ProtocolError("PERMISSION_DENIED", ERROR_MESSAGES.PERMISSION_DENIED);
    return { room, seat };
  }

  seatView(seat) {
    return { role: seat.role, side: seat.side, online: !!seat.ws };
  }

  roomView(room) {
    return {
      roomId: room.id,
      state: room.state,
      revision: room.revision,
      config: { ...room.config },
      configFrozen: room.configFrozen,
      hostOnline: !!room.host.ws,
      guestPresent: !!room.guest,
      guestOnline: !!room.guest?.ws,
      guestReady: room.guestReady,
      guestSpectating: room.guestSpectating,
      warmupMatchId: room.warmupMatchId || "",
      matchId: room.matchId || "",
      kickoffAt: room.kickoffAt || 0,
      waitExpiresAt: room.waitExpiresAt,
      hardExpiresAt: room.hardExpiresAt,
    };
  }

  sendRoomStates(room) {
    for (const seat of [room.host, room.guest].filter(Boolean)) {
      if (!seat.ws) continue;
      this.send(seat.ws, { type: "room_state", room: this.roomView(room), self: this.seatView(seat) });
    }
  }

  broadcast(room, message, except = null) {
    for (const seat of [room.host, room.guest].filter(Boolean)) {
      if (seat.ws && seat.ws !== except) this.send(seat.ws, message);
    }
  }

  consumeRate(ws, category, limit) {
    const second = Math.floor(this.now() / 1000);
    const bucket = ws.friend.rate;
    if (bucket.second !== second) {
      bucket.second = second;
      bucket.counts = Object.create(null);
    }
    bucket.counts[category] = (bucket.counts[category] || 0) + 1;
    if (bucket.counts[category] > limit) throw new ProtocolError("RATE_LIMITED", `${category} 消息发送过快`);
  }

  send(ws, message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const body = { v: PROTOCOL_VERSION, ...message };
    try { ws.send(JSON.stringify(body)); } catch {}
  }

  sendRaw(ws, raw) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(raw, { binary: true }); } catch {}
  }

  sendError(ws, value) {
    const error = errorFrom(value);
    this.send(ws, {
      type: "error",
      requestId: error.requestId,
      code: error.code,
      message: error.message || ERROR_MESSAGES[error.code] || "请求失败",
      details: error.details,
    });
  }
}

export async function createFriendRoomServer(options = {}) {
  const service = new FriendRoomServer(options);
  return service.listen();
}

async function main() {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "0.0.0.0";
  const devAuth = process.env.DEV_AUTH === "1";
  let tls;
  if (process.env.TLS_CERT_PATH || process.env.TLS_KEY_PATH) {
    if (!process.env.TLS_CERT_PATH || !process.env.TLS_KEY_PATH) {
      throw new Error("TLS_CERT_PATH 与 TLS_KEY_PATH 必须同时配置");
    }
    tls = {
      cert: await fs.readFile(process.env.TLS_CERT_PATH),
      key: await fs.readFile(process.env.TLS_KEY_PATH),
    };
  }
  const server = await createFriendRoomServer({ port, host, devAuth, tls });
  const publicProtocol = tls ? "wss" : "ws";
  console.info(`[friend-room] listening on ${publicProtocol}://${host}:${server.address().port}`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[friend-room] fatal", error);
    process.exitCode = 1;
  });
}
