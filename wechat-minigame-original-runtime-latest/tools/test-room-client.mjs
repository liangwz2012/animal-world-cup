import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { WebSocket } from "ws";
import { createFriendRoomServer } from "../server/friend-room-server.mjs";

const require = createRequire(import.meta.url);
const {
  RoomClient,
  SNAPSHOT_HEADER_BYTES,
  encodeSnapshotFrame,
  decodeSnapshotFrame,
} = require("../src/net/room-client.js");

class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.timeouts = new Map();
    this.intervals = new Map();
    this.time = 1_000;
  }

  api() {
    return {
      setTimeout: (fn, delay) => {
        const id = this.nextId++;
        this.timeouts.set(id, { fn, delay });
        return id;
      },
      clearTimeout: (id) => this.timeouts.delete(id),
      setInterval: (fn, delay) => {
        const id = this.nextId++;
        this.intervals.set(id, { fn, delay });
        return id;
      },
      clearInterval: (id) => this.intervals.delete(id),
      now: () => this.time,
    };
  }

  runNextTimeout() {
    const entry = this.timeouts.entries().next();
    assert.equal(entry.done, false, "预期存在待执行定时器");
    const [id, timer] = entry.value;
    this.timeouts.delete(id);
    timer.fn();
  }

  runIntervals() {
    for (const timer of Array.from(this.intervals.values())) timer.fn();
  }
}

class FakeSocket {
  constructor() {
    this.handlers = {};
    this.sent = [];
    this.readyState = 0;
    this.closeCalls = [];
  }

  onOpen(handler) { this.handlers.open = handler; }
  onMessage(handler) { this.handlers.message = handler; }
  onClose(handler) { this.handlers.close = handler; }
  onError(handler) { this.handlers.error = handler; }

  send(options) {
    if (this.readyState !== 1) throw new Error("socket-not-open");
    this.sent.push(options.data);
  }

  close(options) {
    this.closeCalls.push(options || {});
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.handlers.open && this.handlers.open({});
  }

  message(message) {
    this.handlers.message && this.handlers.message({ data: typeof message === "string" || message instanceof ArrayBuffer ? message : JSON.stringify(message) });
  }

  serverClose(reason) {
    this.readyState = 3;
    this.handlers.close && this.handlers.close({ reason: reason || "network" });
  }
}

function jsonMessages(socket) {
  return socket.sent.filter((item) => typeof item === "string").map((item) => JSON.parse(item));
}

function nextEvent(target, type, predicate = () => true, timeoutMs = 1_500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`等待 RoomClient 事件超时：${type}`));
    }, timeoutMs);
    const unsubscribe = target.on(type, (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(payload);
    });
  });
}

class WxSocketFromNode {
  constructor(url) {
    this.ws = new WebSocket(url);
  }

  get readyState() { return this.ws.readyState; }
  onOpen(handler) { this.ws.on("open", () => handler({})); }
  onClose(handler) { this.ws.on("close", (code, reason) => handler({ code, reason: String(reason || "") })); }
  onError(handler) { this.ws.on("error", (error) => handler(error)); }
  onMessage(handler) {
    this.ws.on("message", (raw, isBinary) => {
      if (!isBinary) return handler({ data: String(raw) });
      const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      handler({ data: copy.buffer });
    });
  }
  send(options) {
    this.ws.send(options.data, (error) => {
      if (error && options.fail) options.fail(error);
    });
  }
  close(options) { this.ws.close(options && options.code, options && options.reason); }
}

const timers = new FakeTimers();
const sockets = [];
const events = [];
const sendErrors = [];
const client = new RoomClient({
  url: "wss://room.example.test/v1",
  socketFactory() {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  },
  timers: timers.api(),
  heartbeatMs: 1_000,
  pongTimeoutMs: 500,
  reconnectDelays: [25, 50],
});
client.on("message", (message) => events.push(message));
client.on("send-error", (event) => sendErrors.push(event));

assert.equal(client.createRoom({}), false, "未连接时不得假装已发出创建请求");
assert.equal(sendErrors.at(-1).type, "create_room");
assert.equal(client.connect({ auth: { code: "wx-login-code" } }), true);
assert.equal(sockets.length, 1);
assert.equal(client.state, "connecting");

const first = sockets[0];
first.open();
assert.equal(jsonMessages(first)[0].type, "auth", "Socket 打开后必须先鉴权");
assert.equal(client.createRoom({}), false, "auth_ok 之前不得创建房间");
first.message({ v: 1, type: "auth_ok", sessionToken: "session-token-1" });
assert.equal(client.authenticated, true);
assert.equal(client.sessionToken, "session-token-1");

assert.equal(client.createRoom({ redTeam: "argentina", blueTeam: "portugal" }), true);
assert.equal(jsonMessages(first).at(-1).type, "create_room");
first.message({
  v: 1,
  type: "room_created",
  invite: "opaque-invite",
  resumeToken: "resume-token-2",
  room: { roomId: "ROOMABCDEFGHIJKLMNOPQR" },
  self: { role: "host", side: "red" },
});
assert.equal(client.roomId, "ROOMABCDEFGHIJKLMNOPQR");
assert.equal(client.role, "host");
assert.equal(client.invite, "opaque-invite");
assert.equal(client.resumeToken, "resume-token-2");

assert.equal(client.updateConfig({ redFormation: "3-2-1" }), true);
assert.equal(client.setReady(true), true);
assert.equal(client.requestStart(), true);
assert.equal(client.setLoadReady({ matchId: "MATCHABCDEFGHIJKLMNOPQ" }), true);
assert.equal(client.startWarmup(), true);
assert.equal(client.setWarmupSpectating(true), true);
assert.equal(client.queueAfterWarmup(true), true);
assert.equal(client.decideGuestTimeout("ai_takeover"), true);
assert.equal(client.decideGuestTimeout("invalid"), false);
assert.equal(client.endWarmup(), true);
const sentTypes = jsonMessages(first).map((message) => message.type);
for (const type of ["update_config", "ready", "start_request", "load_ready", "host_warmup_start", "warmup_spectate", "queue_after_warmup", "guest_timeout_decision", "host_warmup_end"]) {
  assert.ok(sentTypes.includes(type), `缺少 ${type} 协议消息`);
}

first.message({ v: 1, type: "load_match", roomId: client.roomId, matchId: "MATCHABCDEFGHIJKLMNOPQ" });
assert.equal(client.matchId, "MATCHABCDEFGHIJKLMNOPQ");
assert.equal(client.sendInput({ vx: 1, shoot: true }, { frame: 42 }), true);
const inputMessage = jsonMessages(first).at(-1);
assert.equal(inputMessage.type, "input");
assert.equal(inputMessage.seq, 1);
assert.equal(inputMessage.frame, 42);

const rawFrame = new Uint8Array([7, 8, 9, 10]).buffer;
assert.equal(client.sendSnapshot(rawFrame, { seq: 9 }), true);
const packet = first.sent.at(-1);
assert.ok(packet instanceof ArrayBuffer, "ArrayBuffer 快照必须以二进制发送");
assert.equal(packet.byteLength, SNAPSHOT_HEADER_BYTES + rawFrame.byteLength);
const decoded = decodeSnapshotFrame(packet);
assert.equal(decoded.roomId, client.roomId.slice(0, 22));
assert.equal(decoded.matchId, client.matchId.slice(0, 22));
assert.equal(decoded.seq, 9);
assert.deepEqual(Array.from(new Uint8Array(decoded.binary)), [7, 8, 9, 10]);

let receivedSnapshot = null;
client.once("snapshot", (snapshot) => { receivedSnapshot = snapshot; });
first.message(encodeSnapshotFrame(new Uint8Array([3, 2, 1]).buffer, {
  roomId: client.roomId,
  matchId: client.matchId,
  seq: 10,
}));
assert.equal(receivedSnapshot.seq, 10);
assert.deepEqual(Array.from(new Uint8Array(receivedSnapshot.binary)), [3, 2, 1]);

timers.runIntervals();
assert.equal(jsonMessages(first).at(-1).type, "ping", "连接存活时必须定期发送心跳");
assert.equal(jsonMessages(first).at(-1).clientTime, timers.time);
first.message({ v: 1, type: "pong", at: timers.time });

first.serverClose("temporary-network-loss");
assert.equal(client.state, "reconnect-wait");
assert.equal(client.connected, false);
timers.runNextTimeout();
assert.equal(sockets.length, 2, "断线后必须按退避计划创建新 Socket");
const second = sockets[1];
second.open();
assert.equal(jsonMessages(second)[0].type, "auth", "重连必须先恢复已鉴权的微信会话");
assert.equal(jsonMessages(second)[0].sessionToken, "session-token-1");
second.message({ v: 1, type: "auth_ok", sessionToken: "session-token-2" });
assert.equal(jsonMessages(second)[1].type, "resume", "重连不能自报 role，必须使用服务端恢复令牌");
assert.equal(jsonMessages(second)[1].resumeToken, "resume-token-2");
second.message({ v: 1, type: "resume_ok", roomId: client.roomId, role: "host" });
assert.equal(client.state, "authenticated");

const socketCountBeforeClose = sockets.length;
client.close();
assert.equal(client.state, "closed");
assert.equal(client.connected, false);
assert.equal(jsonMessages(second).at(-1).type, "leave");
assert.equal(timers.timeouts.size, 0, "主动关闭必须取消重连与心跳超时器");
assert.equal(sockets.length, socketCountBeforeClose, "主动关闭不得再次重连");

assert.ok(events.some((message) => message.type === "room_created"));
assert.ok(events.some((message) => message.type === "load_match"));

const integrationServer = await createFriendRoomServer({ port: 0, devAuth: true, logger: { warn() {} } });
const socketFactory = ({ url }) => new WxSocketFromNode(url);
const host = new RoomClient({ url: integrationServer.url(), socketFactory, heartbeatMs: 60_000 });
const guest = new RoomClient({ url: integrationServer.url(), socketFactory, heartbeatMs: 60_000 });
try {
  const hostAuth = nextEvent(host, "auth_ok");
  assert.equal(host.connect({ auth: { devPlayerId: "client-host" } }), true);
  await hostAuth;
  const createdEvent = nextEvent(host, "room_created");
  assert.equal(host.createRoom({
    redTeam: "argentina",
    blueTeam: "portugal",
    redFormation: "2-3-1",
    blueFormation: "3-2-1",
    ai: 1,
    time: 6,
    mode: "friend",
    side: "home",
    roomId: "",
  }), true);
  const created = await createdEvent;
  assert.equal(host.role, "host", "真实 room_created 的 self.role 必须被解析");

  const guestAuth = nextEvent(guest, "auth_ok");
  assert.equal(guest.connect({ auth: { devPlayerId: "client-guest" } }), true);
  await guestAuth;
  const joinedEvent = nextEvent(guest, "room_state", (message) => !!message.resumeToken);
  assert.equal(guest.joinInvite(created.invite), true);
  await joinedEvent;
  assert.equal(guest.role, "guest", "真实 room_state 的 self.role 必须被解析");
  assert.equal(guest.roomId, host.roomId);

  const hostReadyState = nextEvent(host, "room_state", (message) => message.room.guestReady === true);
  assert.equal(guest.setReady(true), true);
  await hostReadyState;
  const hostLoadEvent = nextEvent(host, "load_match", (message) => message.phase === "friend");
  const guestLoadEvent = nextEvent(guest, "load_match", (message) => message.phase === "friend");
  assert.equal(host.requestStart(), true);
  const [hostLoad, guestLoad] = await Promise.all([hostLoadEvent, guestLoadEvent]);
  assert.equal(hostLoad.matchId, guestLoad.matchId);

  const kickoffEvent = nextEvent(guest, "kickoff_at");
  assert.equal(host.setLoadReady(), true);
  assert.equal(guest.setLoadReady(), true);
  await kickoffEvent;

  const inputEvent = nextEvent(host, "input");
  assert.equal(guest.sendInput({ active: true, vx: 0.5, vy: -0.25, shoot: false }, { frame: 12 }), true);
  const relayedInput = await inputEvent;
  assert.equal(relayedInput.input.vx, 0.5);
  assert.equal(relayedInput.matchId, host.matchId);

  const snapshotEvent = nextEvent(guest, "snapshot", (message) => message.seq === 1);
  assert.equal(host.sendSnapshot(new Uint8Array([11, 22, 33]).buffer, { seq: 1 }), true);
  const relayedSnapshot = await snapshotEvent;
  assert.deepEqual(Array.from(new Uint8Array(relayedSnapshot.binary)), [11, 22, 33]);
  assert.equal(relayedSnapshot.matchId, guest.matchId);
} finally {
  guest.close();
  host.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await integrationServer.close();
}

console.info("[test:room-client] PASS：单元与真实房间服务集成下，鉴权、角色、开球、输入、ACFS 快照、心跳与恢复重连正常");
