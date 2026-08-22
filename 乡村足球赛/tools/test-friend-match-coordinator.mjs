import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFriendMatchCoordinator } = require("../src/app/friend-match-coordinator.js");
const { defaults, normalizeConfig } = require("../src/data/game-options.js");

class MockRoomClient {
  constructor() {
    this.listeners = new Map();
    this.connected = false;
    this.authenticated = false;
    this.roomId = "";
    this.matchId = "";
    this.role = "";
    this.calls = [];
  }
  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  emit(type, value) {
    for (const handler of this.listeners.get(type) || []) handler(value);
  }
  connect(options) {
    this.calls.push(["connect", options]);
    this.connected = true;
    this.authenticated = true;
    queueMicrotask(() => this.emit("auth_ok", { type: "auth_ok", v: 1 }));
    return true;
  }
  createRoom(config) { this.calls.push(["createRoom", config]); return true; }
  joinInvite(invite) { this.calls.push(["joinInvite", invite]); return true; }
  startWarmup() { this.calls.push(["startWarmup"]); return true; }
  endWarmup() { this.calls.push(["endWarmup"]); return true; }
  queueAfterWarmup(value) { this.calls.push(["queueAfterWarmup", value]); return true; }
  setWarmupSpectating(value) { this.calls.push(["setWarmupSpectating", value]); return true; }
  requestStart() { this.calls.push(["requestStart"]); return true; }
  loadReady(value) { this.calls.push(["loadReady", value]); return true; }
  sendInput(value, meta) { this.calls.push(["sendInput", value, meta]); return true; }
  sendSnapshot(value, meta) { this.calls.push(["sendSnapshot", value, meta]); return true; }
  sendMatchEnd(value) { this.calls.push(["sendMatchEnd", value]); return true; }
  decideGuestTimeout(value) { this.calls.push(["decideGuestTimeout", value]); return true; }
  close(value) { this.calls.push(["close", value]); this.connected = false; }
}

const roomId = "ROOMID1234567890123456";
const warmupMatchId = "WARMUP123456789012345";
const friendMatchId = "FRIEND123456789012345";
const inviteToken = "Invite_token_1234567890_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
let config = defaults();
config.redRegion = {
  path: [
    { code: "440000", parentCode: "", level: "province", name: "广东省", shortName: "广东" },
    { code: "440900", parentCode: "440000", level: "city", name: "茂名市", shortName: "茂名" },
    { code: "440983", parentCode: "440900", level: "county", name: "信宜市", shortName: "信宜" },
    { code: "440983101000", parentCode: "440983", level: "town", name: "镇隆镇", shortName: "镇隆" },
  ],
};
config.blueRegion = {
  path: [
    { code: "440000", parentCode: "", level: "province", name: "广东省", shortName: "广东" },
    { code: "440900", parentCode: "440000", level: "city", name: "茂名市", shortName: "茂名" },
    { code: "440983", parentCode: "440900", level: "county", name: "信宜市", shortName: "信宜" },
    { code: "440983102000", parentCode: "440983", level: "town", name: "水口镇", shortName: "水口" },
  ],
};
config = normalizeConfig(config);
const wireConfig = {
  redTeam: config.redTeam,
  blueTeam: config.blueTeam,
  redFormation: config.redFormation,
  blueFormation: config.blueFormation,
  ai: config.ai,
  time: config.time,
  redLabel: config.redJersey.locationLabel,
  blueLabel: config.blueJersey.locationLabel,
  redCustom: false,
  blueCustom: false,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const hostClient = new MockRoomClient();
const hostViews = [];
const hostMatches = [];
const sharedCalls = [];
let modalOptions = null;
const hostRuntime = {
  touchInput: { active: true, vx: 0, vy: 0 },
  pauseMatchSync(reason) { sharedCalls.push(["pause", reason]); },
  resumeMatchSync() { sharedCalls.push(["resume"]); },
};
const host = createFriendMatchCoordinator({
  wxApi: {
    shareAppMessage(payload) { sharedCalls.push(["share", payload]); },
    showModal(options) { modalOptions = options; },
  },
  globalObject: {},
  roomClientFactory: () => hostClient,
  resolveService: () => ({ ok: true, url: "ws://127.0.0.1:8787", localOnly: true }),
  createAuth: async () => ({ devPlayerId: "host" }),
  getRuntime: () => hostRuntime,
  showFriendRoom: (state) => hostViews.push(state),
  beginMatch: (next) => hostMatches.push(next),
});

assert.equal(host.handleAction("invite", config), true);
await flush();
assert.equal(hostClient.calls.some(([name]) => name === "createRoom"), true, "鉴权后必须创建房间");
const createRoomCall = hostClient.calls.find(([name]) => name === "createRoom");
assert.equal(createRoomCall[1].redLabel, config.redJersey.locationLabel);
assert.equal(createRoomCall[1].blueLabel, config.blueJersey.locationLabel);
assert.equal(Object.prototype.hasOwnProperty.call(createRoomCall[1], "redRegion"), false, "不得把完整行政区对象塞进联网协议");
hostClient.roomId = roomId;
hostClient.role = "host";
hostClient.emit("room_created", {
  invite: inviteToken,
  room: { roomId, state: "waiting", config: wireConfig, guestOnline: false },
  self: { role: "host" },
});
assert.equal(hostViews.at(-1).status, "waiting_host");
assert.match(sharedCalls.find(([name]) => name === "share")[1].query, /^invite=/, "建房成功必须立即拉起微信转发");
assert.equal(sharedCalls.find(([name]) => name === "share")[1].title, "信宜镇隆 VS 信宜水口，快来踢球！", "好友邀请必须使用本地短地域对阵标题");

host.handleAction("warmup-ai", config);
assert.equal(hostClient.calls.at(-1)[0], "startWarmup");
hostClient.emit("room_state", {
  room: { roomId, state: "warmup", config: wireConfig, guestOnline: false, warmupMatchId },
  self: { role: "host" },
});
assert.equal(hostMatches.at(-1).matchSync.role, "host");
assert.equal(hostMatches.at(-1).matchSync.sessionKind, "warmup");
assert.equal(hostMatches.at(-1).matchSync.matchId, warmupMatchId);

hostClient.emit("room_state", {
  room: { roomId, state: "warmup", config: wireConfig, guestOnline: true, guestReady: true, warmupMatchId, revision: 3 },
  self: { role: "host" },
});
assert.ok(modalOptions, "好友上线时必须提示房主");
assert.deepEqual(sharedCalls.at(-1), ["pause", "friend-arrived"]);
modalOptions.success({ confirm: false });
assert.deepEqual(hostClient.calls.at(-1), ["queueAfterWarmup", true]);
assert.deepEqual(sharedCalls.at(-1), ["resume"]);
host.handleMatchEnded({ score: [1, 0] });
assert.equal(hostClient.calls.at(-1)[0], "endWarmup", "选择踢完本局后，全场结束必须自动切好友局");
hostClient.matchId = friendMatchId;
hostClient.emit("load_match", { phase: "friend", role: "host", roomId, matchId: friendMatchId, config: wireConfig });
assert.equal(hostMatches.at(-1).redJersey.locationLabel, wireConfig.redLabel);
assert.equal(hostMatches.at(-1).blueJersey.locationLabel, wireConfig.blueLabel);
hostClient.emit("pause", { reconnectExpired: true, disconnectedRole: "guest" });
assert.equal(modalOptions.title, "好友连接超时");
modalOptions.success({ confirm: true });
assert.deepEqual(hostClient.calls.at(-1), ["decideGuestTimeout", "ai_takeover"]);

const guestClient = new MockRoomClient();
const guestViews = [];
const guestMatches = [];
const repeaters = new Map();
let repeaterId = 0;
const guestRuntime = {
  touchInput: { active: true, vx: 0.5, vy: 0, pass: true },
  resumeMatchSync() { sharedCalls.push(["guest-resume"]); },
  pushAuthoritativeSnapshot() {},
};
const guest = createFriendMatchCoordinator({
  wxApi: {},
  globalObject: {},
  roomClientFactory: () => guestClient,
  resolveService: () => ({ ok: true, url: "ws://127.0.0.1:8787", localOnly: true }),
  createAuth: async () => ({ devPlayerId: "guest" }),
  getRuntime: () => guestRuntime,
  showFriendRoom: (state) => guestViews.push(state),
  beginMatch: (next) => guestMatches.push(next),
  setInterval(callback) { const id = ++repeaterId; repeaters.set(id, callback); return id; },
  clearInterval(id) { repeaters.delete(id); },
});

guest.handleLaunchOptions({ query: { invite: inviteToken, v: "1" } });
await flush();
assert.deepEqual(guestClient.calls.find(([name]) => name === "joinInvite"), ["joinInvite", inviteToken], "打开分享卡必须自动上线并通知房主");
guestClient.roomId = roomId;
guestClient.role = "guest";
guestClient.emit("room_state", {
  room: { roomId, state: "warmup", config: wireConfig, guestOnline: true, guestReady: true, guestSpectating: false, warmupMatchId },
  self: { role: "guest" },
});
assert.equal(guestViews.at(-1).status, "guest_can_spectate");
guest.handleAction("watch-warmup", config);
assert.deepEqual(guestClient.calls.at(-1), ["setWarmupSpectating", true]);
guestClient.emit("load_match", { phase: "warmup", spectator: true, roomId, matchId: warmupMatchId, config: wireConfig });
assert.equal(guestMatches.at(-1).matchSync.role, "guest");
assert.equal(guestMatches.at(-1).matchSync.sessionKind, "warmup");
assert.equal(guestMatches.at(-1).matchSync.startPaused, false);

guestClient.matchId = friendMatchId;
guestClient.emit("load_match", { phase: "friend", role: "guest", roomId, matchId: friendMatchId, config: wireConfig });
assert.equal(guestMatches.at(-1).matchSync.sessionKind, "friend");
assert.equal(guestMatches.at(-1).matchSync.startPaused, true, "正式局必须等待统一 kickoff");
guest.handleMatchStarted();
assert.equal(guestClient.calls.at(-1)[0], "loadReady");
guestClient.emit("kickoff_at", { roomId, matchId: friendMatchId, kickoffAt: 1000, serverTime: 1000 });
await flush();
assert.deepEqual(sharedCalls.at(-1), ["guest-resume"]);
assert.equal(repeaters.size, 1, "蓝方开球后必须启动 30 Hz 输入发送器");
for (const callback of repeaters.values()) callback();
assert.equal(guestClient.calls.at(-1)[0], "sendInput");
assert.equal(guestClient.calls.at(-1)[1].pass, true);

host.destroy();
guest.destroy();
console.info("[test:friend-match-coordinator] PASS：转发、热身排队、上线弹窗、观战、正式加载和蓝方输入串联正常");
