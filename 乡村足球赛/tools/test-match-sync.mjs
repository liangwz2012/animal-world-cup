import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  decodeAuthoritativeFrame,
  encodeAuthoritativeFrame,
  FrameReader,
  FrameWriter,
  inspectAuthoritativeFrame,
} = require("../src/net/match-sync-codec.js");
const { createMatchSyncBridge, growMatchStream } = require("../src/net/match-sync.js");
const { decodeSnapshotFrame, encodeSnapshotFrame } = require("../src/net/room-client.js");

class TeamFrame {
  constructor() {
    this.players = [];
    this.score = 0;
  }

  _grow(size) {
    while (this.players.length < size) this.players.push({});
  }
}

class TestFrame {
  constructor() {
    this._elapsed = -1;
    this.steps = 1;
    this.score = 0;
    this.flags = 0;
    this.timeScale = 1;
    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0 };
    this.heading = { x: 1, y: 0 };
    this.rotation = { x: 0, y: 0, z: 0, w: 1 };
    this.redTeam = new TeamFrame();
    this.blueTeam = new TeamFrame();
  }

  get elapsed() {
    return this._elapsed === -1 ? this.steps / 60 * this.timeScale : this._elapsed;
  }

  get duration() {
    return this.elapsed / this.timeScale;
  }

  clear() {
    this._elapsed = -1;
    this.steps = 0;
  }

  pack(writer) {
    writer.setUint8(this.steps);
    writer.setUint16(this.score);
    writer.setUint8(this.flags);
    writer.setNormal(this.timeScale);
    writer.setVector3(this.position);
    writer.setVector2Quantized16(100, this.velocity);
    writer.setVector2Normal(this.heading);
    writer.setRotation16(this.rotation);
  }

  unpack(reader) {
    this._elapsed = -1;
    this.steps = reader.getUint8();
    this.score = reader.getUint16();
    this.flags = reader.getUint8();
    this.timeScale = reader.getNormal();
    reader.getVector3(this.position);
    reader.getVector2Quantized16(100, this.velocity);
    reader.getVector2Normal(this.heading);
    reader.getRotation16(this.rotation);
  }

  interpolate(left, right, alpha) {
    this._elapsed = right.elapsed * alpha;
    this.steps = right.steps * alpha;
    this.score = right.score;
    this.flags = right.flags;
    this.timeScale = right.timeScale;
    for (const key of ["x", "y", "z"]) {
      this.position[key] = left.position[key] + (right.position[key] - left.position[key]) * alpha;
    }
    for (const key of ["x", "y"]) {
      this.velocity[key] = left.velocity[key] + (right.velocity[key] - left.velocity[key]) * alpha;
      this.heading[key] = right.heading[key];
    }
    for (const key of ["x", "y", "z", "w"]) this.rotation[key] = right.rotation[key];
  }
}

class TestMatchStream {
  constructor(size) {
    this.frames = Array.from({ length: size }, () => new TestFrame());
    this.interpolated = new TestFrame();
    this._merged = new TestFrame();
    this.index = 0;
    this.duration = 0;
  }

  unpackFrame(reader) {
    const frame = this.frames[this.index % this.frames.length];
    this.index += 1;
    this.duration -= frame.duration;
    frame.unpack(reader);
    this.duration += frame.duration;
    return frame;
  }
}

function runtimeRequire(id) {
  if (id === "net/stream") return { MatchStream: TestMatchStream };
  if (id === "net/frame") return { Frame: TestFrame };
  throw new Error(`unexpected runtime module: ${id}`);
}

function metadataFor(payload, matchId) {
  const header = inspectAuthoritativeFrame(payload);
  return { sequence: header.sequence, matchId };
}

// The custom writer/reader deliberately implements every primitive used by
// net/frame. Verify overwrite offsets too: ControllerFrame.pack relies on it.
const primitiveWriter = new FrameWriter(16);
const flagsAt = primitiveWriter.setUint32(0);
primitiveWriter.view.setUint32(flagsAt, 0xa5a55a5a, false);
primitiveWriter.setFlags(true, false, true);
primitiveWriter.setVector3Quantized16(100, { x: 1.25, y: -2.5, z: 0.75 });
const primitiveReader = new FrameReader(primitiveWriter.finish());
assert.equal(primitiveReader.getUint32(), 0xa5a55a5a);
assert.equal(primitiveReader.getFlags(), 0b101);
const quantized = {};
primitiveReader.getVector3Quantized16(100, quantized);
assert.deepEqual(quantized, { x: 1.25, y: -2.5, z: 0.75 });
assert.equal(primitiveReader.remaining, 0);

const hostPackets = [];
const host = createMatchSyncBridge();
host.bindRuntime(null, runtimeRequire);
host.configure({
  role: "host",
  sessionKind: "warmup",
  matchId: "warmup-match",
  snapshotHz: 20,
  sendSnapshot(payload, meta) { hostPackets.push({ payload, meta }); },
});
assert.equal(host.acceptsRemoteInput(), false, "warmup 必须由 AI 控制蓝方");

const source = new TestFrame();
source.redTeam._grow(7);
source.blueTeam._grow(7);
for (let sample = 0; sample < 5; sample += 1) {
  source.position.x = sample * 10;
  source.position.y = sample;
  source.score = sample;
  host.hostTick(source, 0.05, null);
}
assert.equal(hostPackets.length, 5, "20 Hz 配置必须产生五个 50 ms 帧");
assert.ok(hostPackets.every(({ payload }) => payload instanceof ArrayBuffer && payload.byteLength < 256 * 1024));
assert.deepEqual(hostPackets[0].meta, {
  sequence: 1,
  matchId: "warmup-match",
  sessionKind: "warmup",
});
const acfsPacket = encodeSnapshotFrame(hostPackets[0].payload, {
  roomId: "abcdefghijklmnopqrstuv",
  matchId: "1234567890123456789012",
  seq: hostPackets[0].meta.sequence,
});
const acfsDecoded = decodeSnapshotFrame(acfsPacket);
assert.equal(acfsDecoded.seq, 1);
assert.equal(acfsDecoded.matchId, "1234567890123456789012");
assert.equal(inspectAuthoritativeFrame(acfsDecoded.binary).sessionKind, "warmup");

const guest = createMatchSyncBridge();
guest.bindRuntime(null, runtimeRequire);
guest.configure({ role: "guest", sessionKind: "warmup", matchId: "warmup-match", bufferMs: 120 });
assert.equal(guest.isGuestRenderOnly, true);
for (const packet of hostPackets) {
  assert.equal(guest.pushSnapshot(packet.payload, metadataFor(packet.payload, "warmup-match")), true);
}
assert.equal(
  guest.pushSnapshot(hostPackets[4].payload, metadataFor(hostPackets[4].payload, "warmup-match")),
  false,
  "重复帧必须丢弃",
);
const rendered = guest.readGuestFrame(0);
assert.ok(rendered, "120 ms 缓冲后必须产生插值帧");
assert.equal(guest.currentGuestFrame, rendered, "好友 HUD 必须能读取当前权威插值帧");
assert.ok(rendered.position.x > 10 && rendered.position.x < 30, "客机应渲染延迟的插值位置");
assert.equal(guest.diagnostics.guestPhysicsTicks, 0, "客机不得运行物理 tick");

// A new formal match must reset the buffer and reject every late warmup frame.
guest.configure({ role: "guest", sessionKind: "friend", matchId: "formal-match" });
assert.equal(guest.currentGuestFrame, null, "正式新局不得继续显示热身比分帧");
assert.equal(
  guest.pushSnapshot(hostPackets[0].payload, metadataFor(hostPackets[0].payload, "warmup-match")),
  false,
  "旧 matchId/sessionKind 热身帧不得污染正式局",
);
assert.equal(guest.readGuestFrame(0.016), null, "重开正式局后帧缓冲必须为空");

host.configure({
  role: "host",
  sessionKind: "friend",
  matchId: "formal-match",
  startPaused: true,
});
assert.equal(host.paused, true, "load_ready/kickoff_at 前必须可硬暂停");
host.resume();
assert.equal(host.acceptsRemoteInput(), true, "只有正式 friend host 可接入蓝方输入");
host.setRemoteControlEnabled(false);
assert.equal(host.acceptsRemoteInput(), false, "好友超时后切换 AI 接管必须释放蓝方真人控制");
assert.equal(host.remoteInput.active, false);
host.setRemoteControlEnabled(true);
assert.equal(host.acceptsRemoteInput(), true);
assert.equal(host.setRemoteInput({ active: true, vx: 3, vy: 4, pass: true }, {
  sequence: 1,
  matchId: "formal-match",
  pulseSeq: { pass: 7 },
}), true);
assert.ok(Math.abs(Math.hypot(host.remoteInput.vx, host.remoteInput.vy) - 1) < 1e-9);
assert.equal(host.remoteInput.pass, true);
host.remoteInput.pass = false; // The original controller consumes the pulse.
assert.equal(host.setRemoteInput({ active: true, pass: true }, {
  sequence: 2,
  matchId: "formal-match",
  pulseSeq: { pass: 7 },
}), true);
assert.equal(host.remoteInput.pass, false, "同一 pulseSeq 不得重复消费");
assert.equal(host.setRemoteInput({ active: true }, { sequence: 2, matchId: "formal-match" }), false);
assert.equal(host.setRemoteInput({ active: true }, { sequence: 3, matchId: "old-match" }), false);
host.pause("disconnect");
assert.equal(host.remoteInput.active, false, "断线暂停必须清空连续输入");
host.configure({ role: "host", sessionKind: "friend", matchId: "rematch" });
assert.equal(host.setRemoteInput({ active: true, pass: true }, {
  sequence: 1,
  matchId: "rematch",
  pulseSeq: { pass: 1 },
}), true);
assert.equal(host.remoteInput.pass, true, "新 matchId 必须重置上一局的动作脉冲序号");

const generated = await fs.readFile(new URL("../generated/standalone.static.js", import.meta.url), "utf8");
assert.ok(generated.includes("guest render-only sync bridge unavailable; local simulation is forbidden"));
assert.ok(generated.includes("__ORIGINAL_RUNTIME_GUEST_PHYSICS_BLOCKED__"));
assert.ok(generated.includes("if(guestSync){guestSync.guestTick(elapsed,mode.game)}else{if(acPlay())"));
assert.ok(generated.includes("matchSync&&matchSync.hostTick(frame,elapsed,mode.game)"));
assert.ok(generated.includes("guestSync?guestSync.readGuestFrame(elapsed,mode.game):this.stream.readAll"));
assert.ok(generated.includes("!pitch.paused&&!(matchSync&&matchSync.paused)"));
assert.equal((generated.match(/pitch\.update\(elapsed\)/g) || []).length, 1);

const bootSource = await fs.readFile(new URL("../src/boot/start.js", import.meta.url), "utf8");
for (const publicApi of [
  "setRemoteInput(input, metadata)",
  "pushAuthoritativeSnapshot(payload, metadata)",
  "pauseMatchSync(reason)",
  "resumeMatchSync()",
  "startPaused",
]) assert.ok(bootSource.includes(publicApi), `boot API missing: ${publicApi}`);

// Load the actual generated AMD bundle and round-trip its sealed Frame through
// the codec. This catches private field counts (notably the seven-player squads)
// that a JSON-shaped stand-in cannot prove.
function makeCanvas() {
  const canvas = {
    width: 800,
    height: 450,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 450 }; },
  };
  const context = new Proxy({
    canvas,
    measureText() { return { width: 1 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createPattern() { return {}; },
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return function noopCanvasMethod() {};
    },
  });
  canvas.getContext = () => context;
  return canvas;
}

const { installMiniWindow } = require("../src/platform/adapter.js");
globalThis.wx = {
  getSystemInfoSync() { return { windowWidth: 800, windowHeight: 450, pixelRatio: 1 }; },
  getFileSystemManager() {
    return {
      readFileSync() { throw new Error("not a bundled text asset"); },
      accessSync() { throw new Error("not a bundled text asset"); },
    };
  },
};
installMiniWindow({ canvas: makeCanvas() });
const originalCreateElement = globalThis.document.createElement.bind(globalThis.document);
globalThis.document.createElement = (tag) => (
  String(tag).toLowerCase() === "canvas" ? makeCanvas() : originalCreateElement(tag)
);
const originalWarn = console.warn;
console.warn = () => {};
const pixiExport = require("../generated/pixi.static.js");
globalThis.PIXI = pixiExport && (pixiExport.default || pixiExport.PIXI) || globalThis.PIXI;
globalThis.window.PIXI = globalThis.PIXI;
require("../generated/swig.static.js");
require("../generated/shim.static.js");
try {
  require("../generated/match.static.js");
} finally {
  console.warn = originalWarn;
}
const amdRequire = globalThis.window.require.bind(globalThis.window);
const ActualFrame = amdRequire("net/frame").Frame;
const ActualMatchStream = amdRequire("net/stream").MatchStream;
const actualSource = new ActualFrame();
actualSource.redTeam._grow(7);
actualSource.blueTeam._grow(7);
actualSource.steps = 1;
actualSource.matchTime = 4321;
actualSource.redTeam.score = 2;
actualSource.blueTeam.score = 1;
actualSource.camera.position.x = 12.5;
actualSource.camera.position.y = -8.25;
actualSource.camera.zoom = 1.4;
actualSource.ball.position.x = 13.75;
actualSource.ball.position.y = 22.5;
actualSource.ball.position.z = 0.8;
actualSource.ball.velocity.x = 2.5;
actualSource.ball.velocity.y = -1.25;
actualSource.ball.radius = 0.2;
const actualPayload = encodeAuthoritativeFrame(actualSource, {
  sequence: 77,
  sessionKind: "friend",
  steps: 3,
});
const actualTarget = new ActualMatchStream(8);
growMatchStream(actualTarget, 7);
const actualDecoded = decodeAuthoritativeFrame(actualPayload, actualTarget);
assert.equal(actualDecoded.sequence, 77);
assert.equal(actualDecoded.sessionKind, "friend");
assert.equal(actualDecoded.frame.steps, 3);
assert.equal(actualDecoded.frame.matchTime, 4321);
assert.equal(actualDecoded.frame.redTeam.score, 2);
assert.equal(actualDecoded.frame.blueTeam.score, 1);
assert.ok(Math.abs(actualDecoded.frame.ball.position.x - 13.75) < 1e-5);
assert.ok(Math.abs(actualDecoded.frame.ball.velocity.y + 1.25) < 0.011);
assert.equal(actualDecoded.frame.redTeam.players.length, 7);
assert.equal(actualDecoded.frame.blueTeam.players.length, 7);
assert.equal(actualSource.steps, 1, "导出不得篡改房主当前 Frame");
actualSource.ball.position.x = 23.75;
const actualPayload2 = encodeAuthoritativeFrame(actualSource, {
  sequence: 78,
  sessionKind: "friend",
  steps: 3,
});
const actualDecoded2 = decodeAuthoritativeFrame(actualPayload2, actualTarget);
actualTarget.interpolated.clear();
actualTarget.interpolated.interpolate(actualDecoded.frame, actualDecoded2.frame, 0.5);
assert.ok(Math.abs(actualTarget.interpolated.ball.position.x - 18.75) < 1e-5);

console.info("[test:match-sync] PASS：20 Hz 权威帧、120 ms 插值、蓝方输入、热身隔离和客机物理硬闸门正常");
