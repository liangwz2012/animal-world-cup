import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createFriendRoomServer, FriendRoomServer } from "../server/friend-room-server.mjs";
import {
  MAX_SNAPSHOT_BYTES,
  ProtocolError,
  decodeSnapshotPacket,
  encodeSnapshotPacket,
} from "../server/protocol.mjs";
import { createWxCodeVerifier } from "../server/wx-auth.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class TestClient {
  constructor(ws) {
    this.ws = ws;
    this.messages = [];
    ws.on("message", (raw, isBinary) => {
      if (isBinary) this.messages.push({ binary: true, data: Buffer.from(raw) });
      else this.messages.push(JSON.parse(String(raw)));
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return new TestClient(ws);
  }

  send(type, body = {}) {
    this.ws.send(JSON.stringify({ v: 1, type, ...body }));
  }

  sendRaw(raw) {
    this.ws.send(raw);
  }

  async next(type, predicate = () => true, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex((message) => {
        if (type === "binary") return message.binary === true && predicate(message);
        return !message.binary && message.type === type && predicate(message);
      });
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await delay(5);
    }
    throw new Error(`等待消息超时：${type}；已有=${this.messages.map((item) => item.binary ? "binary" : `${item.type}:${item.code || ""}`).join(",")}`);
  }

  async expectNo(type, predicate = () => true, waitMs = 100) {
    await delay(waitMs);
    const found = this.messages.find((message) => {
      if (type === "binary") return message.binary === true && predicate(message);
      return !message.binary && message.type === type && predicate(message);
    });
    assert.equal(found, undefined, `不应收到 ${type}`);
  }

  async close() {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = new Promise((resolve) => this.ws.once("close", resolve));
    this.ws.close();
    await closed;
  }
}

async function authDev(client, id) {
  const requestId = `auth-${id}-${Math.random()}`;
  client.send("auth", { requestId, devPlayerId: id });
  return client.next("auth_ok", (message) => message.requestId === requestId);
}

async function createRoom(client, config = {}) {
  const requestId = `create-${Math.random()}`;
  client.send("create_room", { requestId, config });
  return client.next("room_created", (message) => message.requestId === requestId);
}

async function joinRoom(client, invite) {
  const requestId = `join-${Math.random()}`;
  client.send("join_invite", { requestId, invite });
  return client.next("room_state", (message) => message.requestId === requestId);
}

function assertHighEntropyToken(token, expectedBytes = 32) {
  assert.equal(typeof token, "string");
  assert.ok(!token.includes("="), "令牌应使用无填充 base64url");
  assert.ok(Buffer.from(token, "base64url").byteLength >= expectedBytes, `令牌至少需要 ${expectedBytes} 字节熵`);
}

async function testWxAuthBoundary() {
  let capturedUrl = null;
  const verify = createWxCodeVerifier({
    appId: "wx-test-app",
    appSecret: "server-only-secret",
    fetchImpl: async (url) => {
      capturedUrl = new URL(url);
      return { ok: true, status: 200, json: async () => ({ openid: "openid-host", session_key: "never-forward" }) };
    },
  });
  assert.deepEqual(await verify("valid_code_123"), { userId: "openid-host", unionId: "" });
  assert.equal(capturedUrl.searchParams.get("appid"), "wx-test-app");
  assert.equal(capturedUrl.searchParams.get("secret"), "server-only-secret");
  assert.equal(capturedUrl.searchParams.get("js_code"), "valid_code_123");

  await assert.rejects(
    () => createWxCodeVerifier({ appId: "", appSecret: "" })("valid_code_123"),
    (error) => error instanceof ProtocolError && error.code === "AUTH_CONFIG_MISSING",
  );

  const verifiedCodes = [];
  const server = await createFriendRoomServer({
    port: 0,
    verifyWxCode: async (code) => {
      verifiedCodes.push(code);
      return { userId: `wx:${code}` };
    },
    logger: { warn() {} },
  });
  const rejectedDev = await TestClient.connect(server.url());
  rejectedDev.send("auth", { devPlayerId: "fake-user" });
  assert.equal((await rejectedDev.next("error")).code, "DEV_AUTH_DISABLED", "生产模式不得默认绕过 wx.login");

  const wxClient = await TestClient.connect(server.url());
  wxClient.send("auth", { code: "wx_code_123" });
  const auth = await wxClient.next("auth_ok");
  assertHighEntropyToken(auth.sessionToken);
  assert.deepEqual(verifiedCodes, ["wx_code_123"]);
  await rejectedDev.close();
  await wxClient.close();
  await server.close();
}

async function testRoomLifecycleAndRelay() {
  const server = await createFriendRoomServer({ port: 0, devAuth: true, logger: { warn() {} } });
  assert.equal(server.reconnectGraceMs, 20_000);
  assert.equal(server.waitingTtlMs, 10 * 60_000);
  assert.equal(server.hardTtlMs, 30 * 60_000);

  const host = await TestClient.connect(server.url());
  const guest = await TestClient.connect(server.url());
  const third = await TestClient.connect(server.url());
  await authDev(host, "host");
  await authDev(guest, "guest");
  await authDev(third, "third");

  const created = await createRoom(host, {
    redTeam: "brazil",
    blueTeam: "france",
    redFormation: "2-2-2",
    blueFormation: "1-3-2",
    ai: 2,
    time: 10,
    mode: "friend",
    side: "home",
    roomId: "ignored-client-room",
  });
  assertHighEntropyToken(created.invite);
  assertHighEntropyToken(created.resumeToken);
  assertHighEntropyToken(created.room.roomId, 16);
  assert.deepEqual(created.self, { role: "host", side: "red", online: true });
  assert.equal(created.room.configFrozen, true);

  const joined = await joinRoom(guest, created.invite);
  assertHighEntropyToken(joined.resumeToken);
  assert.deepEqual(joined.self, { role: "guest", side: "blue", online: true });
  assert.equal(joined.room.config.blueFormation, "1-3-2");
  assert.equal(joined.room.guestReady, true, "好友上线即准备，无需额外按钮");

  third.send("join_invite", { invite: created.invite });
  assert.equal((await third.next("error")).code, "ROOM_FULL");

  guest.send("update_config", { patch: { blueTeam: "usa" } });
  assert.equal((await guest.next("error")).code, "PERMISSION_DENIED", "好友不能修改已锁定蓝方");
  host.send("update_config", { patch: { redTeam: "usa" } });
  assert.equal((await host.next("error")).code, "CONFIG_FROZEN", "邀请发出后房主也不能偷偷改配置");
  guest.send("start_request");
  assert.equal((await guest.next("error")).code, "PERMISSION_DENIED", "只有房主能开赛");

  host.send("host_warmup_start");
  const warmupState = await host.next("room_state", (message) => message.room.state === "warmup");
  const warmupMatchId = warmupState.room.warmupMatchId;
  assertHighEntropyToken(warmupMatchId, 16);

  host.send("snapshot", {
    roomId: created.room.roomId,
    matchId: warmupMatchId,
    phase: "warmup",
    seq: 0,
    payload: { score: [1, 0], clock: 12 },
  });
  await guest.expectNo("snapshot", (message) => message.seq === 0);

  guest.send("warmup_spectate", { watching: true });
  const warmupLoad = await guest.next("load_match", (message) => message.phase === "warmup");
  assert.equal(warmupLoad.spectator, true);
  assert.deepEqual((await guest.next("snapshot", (message) => message.seq === 0)).payload.score, [1, 0], "开始观战时应补发最新热身帧");

  await host.next("room_state", (message) => message.room.guestReady === true);
  host.send("queue_after_warmup", { queued: true });
  await guest.next("room_state", (message) => message.room.state === "queue_after_warmup");

  host.send("snapshot", {
    roomId: created.room.roomId,
    matchId: warmupMatchId,
    phase: "warmup",
    seq: 1,
    payload: { score: [2, 0], clock: 24 },
  });
  assert.equal((await guest.next("snapshot", (message) => message.seq === 1)).phase, "warmup");

  host.send("host_warmup_end");
  const warmupEnd = await guest.next("match_end", (message) => message.phase === "warmup");
  assert.equal(warmupEnd.roomContinues, true);
  const [hostLoad, guestLoad] = await Promise.all([
    host.next("load_match", (message) => message.phase === "friend"),
    guest.next("load_match", (message) => message.phase === "friend"),
  ]);
  assert.equal(hostLoad.matchId, guestLoad.matchId);
  assert.notEqual(hostLoad.matchId, warmupMatchId, "正式局必须使用新 matchId 并从 0:0 重开");
  assert.equal(hostLoad.role, "host");
  assert.equal(guestLoad.role, "guest");

  host.send("load_ready", { roomId: hostLoad.roomId, matchId: hostLoad.matchId });
  guest.send("load_ready", { roomId: guestLoad.roomId, matchId: guestLoad.matchId });
  const [hostKickoff, guestKickoff] = await Promise.all([
    host.next("kickoff_at", (message) => message.matchId === hostLoad.matchId),
    guest.next("kickoff_at", (message) => message.matchId === hostLoad.matchId),
  ]);
  assert.equal(hostKickoff.kickoffAt, guestKickoff.kickoffAt);
  assert.ok(hostKickoff.kickoffAt - hostKickoff.serverTime >= 3000);

  guest.send("input", {
    roomId: hostLoad.roomId,
    matchId: hostLoad.matchId,
    seq: 0,
    frame: 8,
    input: { active: true, vx: 0.5, vy: -0.5, sprint: true, shoot: true, tackle: true, pulseSeq: { tackle: 1 } },
  });
  const input0 = await host.next("input", (message) => message.seq === 0);
  assert.equal(input0.input.shoot, true, "射门是连续输入，必须允许按住蓄力");
  assert.equal(input0.input.tackle, true, "好友铲球必须透传为 tackle");
  assert.equal(input0.input.vx, 0.5);

  guest.send("input", {
    roomId: hostLoad.roomId,
    matchId: hostLoad.matchId,
    seq: 1,
    frame: 9,
    input: { active: true, vx: 0, vy: 0, shoot: true, tackle: true, pulseSeq: { tackle: 1 } },
  });
  const input1 = await host.next("input", (message) => message.seq === 1);
  assert.equal(input1.input.shoot, true, "射门按住期间不得被脉冲去重清零");
  assert.equal(input1.input.tackle, false, "相同 tackle pulseSeq 不得消费两次");
  guest.send("input", {
    roomId: hostLoad.roomId,
    matchId: hostLoad.matchId,
    seq: 1,
    frame: 10,
    input: { active: true, vx: 0, vy: 0 },
  });
  assert.equal((await guest.next("error")).code, "STALE_SEQUENCE");

  host.send("input", {
    roomId: hostLoad.roomId,
    matchId: hostLoad.matchId,
    seq: 2,
    frame: 10,
    input: { active: true, vx: 0, vy: 0 },
  });
  assert.equal((await host.next("error")).code, "PERMISSION_DENIED");
  guest.send("snapshot", { roomId: hostLoad.roomId, matchId: hostLoad.matchId, seq: 0, payload: {} });
  assert.equal((await guest.next("error")).code, "PERMISSION_DENIED");

  const framePayload = Buffer.from([1, 3, 3, 7, 9]);
  const packet = encodeSnapshotPacket({
    roomId: hostLoad.roomId,
    matchId: hostLoad.matchId,
    seq: 0,
    payload: framePayload,
  });
  host.sendRaw(packet);
  const relayed = await guest.next("binary");
  const decoded = decodeSnapshotPacket(relayed.data);
  assert.equal(decoded.roomId, hostLoad.roomId);
  assert.equal(decoded.matchId, hostLoad.matchId);
  assert.equal(decoded.seq, 0);
  assert.deepEqual(decoded.payload, framePayload);

  const largeJsonFrame = "x".repeat(70 * 1024);
  host.send("snapshot", {
    roomId: hostLoad.roomId,
    matchId: hostLoad.matchId,
    phase: "friend",
    seq: 1,
    payload: largeJsonFrame,
  });
  assert.equal((await guest.next("snapshot", (message) => message.seq === 1)).payload.length, largeJsonFrame.length, "JSON snapshot 可使用 256 KiB 上限，普通控制消息仍限 64 KiB");

  guest.send("input", {
    roomId: hostLoad.roomId,
    matchId: hostLoad.matchId,
    seq: 2,
    frame: 11,
    input: { active: true, vx: 2, vy: 0 },
  });
  assert.equal((await guest.next("error")).code, "INVALID_INPUT");
  guest.ws.send(JSON.stringify({ v: 1, type: "input", roomId: hostLoad.roomId, matchId: hostLoad.matchId, seq: 3, frame: 12, input: {}, forgedRole: "host" }));
  assert.equal((await guest.next("error")).code, "UNKNOWN_FIELD");

  const oldResumeToken = joined.resumeToken;
  await guest.close();
  const cleared = await host.next("input", (message) => message.synthetic === true);
  assert.equal(cleared.input.active, false, "断线必须立即清空连续输入");
  const pause = await host.next("pause", (message) => message.disconnectedRole === "guest");
  assert.ok(pause.reconnectDeadline > Date.now());

  const intruder = await TestClient.connect(server.url());
  await authDev(intruder, "intruder");
  intruder.send("resume", { resumeToken: oldResumeToken });
  assert.equal((await intruder.next("error")).code, "RESUME_IDENTITY_MISMATCH");
  await intruder.close();

  const guestResumed = await TestClient.connect(server.url());
  await authDev(guestResumed, "guest");
  guestResumed.send("resume", { requestId: "resume-guest", resumeToken: oldResumeToken });
  const resumed = await guestResumed.next("resume_ok", (message) => message.requestId === "resume-guest");
  assert.equal(resumed.self.role, "guest");
  assertHighEntropyToken(resumed.resumeToken);
  assert.notEqual(resumed.resumeToken, oldResumeToken, "恢复后应轮换恢复令牌");
  await host.next("kickoff_at", (message) => message.resume === true);

  host.send("match_end", {
    roomId: hostLoad.roomId,
    matchId: hostLoad.matchId,
    result: { red: 3, blue: 1 },
  });
  const final = await guestResumed.next("match_end", (message) => message.reason === "completed");
  assert.deepEqual(final.result, { red: 3, blue: 1 });

  await host.close();
  await guestResumed.close();
  await third.close();
  await server.close();
}

async function testLimitsAndExpiry() {
  let clock = 10_000;
  const server = await createFriendRoomServer({
    port: 0,
    devAuth: true,
    now: () => clock,
    waitingTtlMs: 200,
    hardTtlMs: 500,
    reconnectGraceMs: 100,
    heartbeatTimeoutMs: 1_000_000,
    sweepIntervalMs: 60_000,
    kickoffDelayMs: 30,
    logger: { warn() {} },
  });

  const idleHost = await TestClient.connect(server.url());
  await authDev(idleHost, "idle-host");
  await createRoom(idleHost);
  clock += 201;
  server.sweep();
  assert.equal((await idleHost.next("match_end")).reason, "waiting_expired", "等待房 10 分钟语义必须可清理");
  await idleHost.close();

  const host = await TestClient.connect(server.url());
  const guest = await TestClient.connect(server.url());
  await authDev(host, "expiry-host");
  await authDev(guest, "expiry-guest");
  const room = await createRoom(host);
  const joined = await joinRoom(guest, room.invite);
  await host.next("room_state", (message) => message.room.guestReady);
  host.send("start_request");
  const hostLoad = await host.next("load_match", (message) => message.phase === "friend");
  const guestLoad = await guest.next("load_match", (message) => message.phase === "friend");
  host.send("load_ready", { roomId: hostLoad.roomId, matchId: hostLoad.matchId });
  guest.send("load_ready", { roomId: guestLoad.roomId, matchId: guestLoad.matchId });
  await host.next("kickoff_at");

  await guest.close();
  await host.next("pause", (message) => message.disconnectedRole === "guest");
  clock += 101;
  server.sweep();
  const expiredPause = await host.next("pause", (message) => message.reconnectExpired === true);
  assert.deepEqual(expiredPause.options, ["ai_takeover", "end_match"]);
  host.send("guest_timeout_decision", { decision: "ai_takeover" });
  const takeover = await host.next("resume_ok", (message) => message.aiTakeover === true);
  assert.equal(takeover.matchId, hostLoad.matchId);

  const lateGuest = await TestClient.connect(server.url());
  await authDev(lateGuest, "expiry-guest");
  lateGuest.send("resume", { resumeToken: joined.resumeToken });
  assert.equal((await lateGuest.next("error")).code, "RESUME_EXPIRED");
  await lateGuest.close();

  clock = room.room.hardExpiresAt + 1;
  server.sweep();
  assert.equal((await host.next("match_end")).reason, "hard_expired", "正式局必须受 30 分钟硬上限约束");
  await host.close();

  const rateClient = await TestClient.connect(server.url());
  await authDev(rateClient, "rate-user");
  for (let i = 0; i < 4; i += 1) rateClient.send("ping", { clientTime: i });
  assert.equal((await rateClient.next("error", (message) => message.code === "RATE_LIMITED")).code, "RATE_LIMITED");
  rateClient.ws.send(JSON.stringify({ v: 1, type: "ping", clientTime: "x".repeat(70 * 1024) }));
  assert.equal((await rateClient.next("error", (message) => message.code === "PAYLOAD_TOO_LARGE")).code, "PAYLOAD_TOO_LARGE");
  await rateClient.close();
  await server.close();

  assert.throws(
    () => encodeSnapshotPacket({ roomId: "a".repeat(22), matchId: "b".repeat(22), seq: 0, payload: Buffer.alloc(MAX_SNAPSHOT_BYTES + 1) }),
    (error) => error instanceof ProtocolError && error.code === "PAYLOAD_TOO_LARGE",
  );
  const malformed = Buffer.alloc(64);
  assert.throws(
    () => decodeSnapshotPacket(malformed),
    (error) => error instanceof ProtocolError && error.code === "INVALID_SNAPSHOT",
  );

  const defaults = new FriendRoomServer();
  assert.equal(defaults.devAuth, false, "DEV_AUTH 不得默认开启");
}

async function testHeartbeatTimeout() {
  let clock = 50_000;
  const server = await createFriendRoomServer({
    port: 0,
    devAuth: true,
    now: () => clock,
    heartbeatTimeoutMs: 50,
    reconnectGraceMs: 1000,
    waitingTtlMs: 10_000,
    hardTtlMs: 20_000,
    sweepIntervalMs: 60_000,
    logger: { warn() {} },
  });
  const host = await TestClient.connect(server.url());
  const guest = await TestClient.connect(server.url());
  await authDev(host, "heartbeat-host");
  await authDev(guest, "heartbeat-guest");
  const room = await createRoom(host);
  await joinRoom(guest, room.invite);
  await host.next("room_state", (message) => message.room.guestOnline === true);

  clock += 51;
  host.send("ping", { clientTime: clock });
  await host.next("pong");
  server.sweep();
  const offline = await host.next("room_state", (message) => message.room.guestPresent === true && message.room.guestOnline === false);
  assert.equal(offline.room.guestPresent, true, "心跳超时后仍应保留 20 秒恢复席位");

  await host.close();
  await guest.close();
  await server.close();
}

await testWxAuthBoundary();
await testRoomLifecycleAndRelay();
await testLimitsAndExpiry();
await testHeartbeatTimeout();

console.info("[test:friend-room-server] PASS：微信鉴权边界、双人角色、配置锁定、AI 热身/排队观战、正式开球、输入与权威帧中继、频率/载荷校验、20 秒恢复及 10/30 分钟过期均正常");
