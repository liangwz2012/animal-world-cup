"use strict";

const {
  decodeAuthoritativeFrame,
  encodeAuthoritativeFrame,
  inspectAuthoritativeFrame,
} = require("./match-sync-codec");

const ROLES = new Set(["off", "host", "guest"]);
const SESSION_KINDS = new Set(["warmup", "friend"]);
const PULSE_ACTIONS = ["pass", "lob", "switchPlayer", "tackle"];
const CONTINUOUS_ACTIONS = ["shoot", "sprint"];
const DEFAULT_STREAM_FRAMES = 32;

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : 0;
}

function normalizeRole(value) {
  return ROLES.has(value) ? value : "off";
}

function normalizeSessionKind(value) {
  return SESSION_KINDS.has(value) ? value : "friend";
}

function createRemoteInput() {
  return {
    active: false,
    vx: 0,
    vy: 0,
    shoot: false,
    sprint: false,
    pass: false,
    lob: false,
    switchPlayer: false,
    tackle: false,
  };
}

function findRuntimeRequire(explicitRequire, runtimeRoot) {
  if (typeof explicitRequire === "function") return explicitRequire;
  const candidates = [
    runtimeRoot,
    runtimeRoot && runtimeRoot.window,
    typeof globalThis !== "undefined" ? globalThis : null,
    typeof globalThis !== "undefined" && globalThis.window,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate.require === "function") return candidate.require.bind(candidate);
  }
  return null;
}

function growMatchStream(stream, squadSize) {
  const frames = stream.frames.concat([stream.interpolated, stream._merged]);
  for (const frame of frames) {
    if (!frame || !frame.redTeam || !frame.blueTeam
      || typeof frame.redTeam._grow !== "function" || typeof frame.blueTeam._grow !== "function") {
      throw new Error("MatchStream Frame 缺少球队容量扩展接口");
    }
    frame.redTeam._grow(squadSize);
    frame.blueTeam._grow(squadSize);
  }
}

function createMatchSyncBridge(options) {
  const initial = options || {};
  const remoteInput = createRemoteInput();
  const pulseTokens = Object.create(null);
  const pulseLevels = Object.create(null);
  const diagnostics = {
    role: "off",
    sessionKind: "friend",
    matchId: "",
    hostFramesSent: 0,
    guestFramesReceived: 0,
    guestFramesDropped: 0,
    guestPhysicsTicks: 0,
    lastInputSequence: -1,
    lastSnapshotSequence: -1,
    lastError: "",
    paused: false,
    remoteControlEnabled: false,
  };

  let role = "off";
  let sessionKind = "friend";
  let matchId = "";
  let sendSnapshot = null;
  let snapshotIntervalSeconds = 1 / 20;
  let bufferSeconds = 0.12;
  let hostAccumulator = 0;
  let hostSequence = 0;
  let lastInputSequence = -1;
  let lastSnapshotSequence = -1;
  let runtimeRequire = null;
  let MatchStream = null;
  let guestStream = null;
  let guestTimeline = [];
  let guestLatestTime = 0;
  let guestPlayhead = null;
  let currentGuestFrame = null;
  let attachedGame = null;
  let paused = false;
  let remoteControlEnabled = false;
  let disposed = false;
  let onRoleChanged = typeof initial.onRoleChanged === "function" ? initial.onRoleChanged : null;

  function setError(error) {
    diagnostics.lastError = error && error.message || String(error || "");
  }

  function clearRemoteInput() {
    remoteInput.active = false;
    remoteInput.vx = 0;
    remoteInput.vy = 0;
    for (const action of CONTINUOUS_ACTIONS.concat(PULSE_ACTIONS)) remoteInput[action] = false;
    for (const action of PULSE_ACTIONS) pulseLevels[action] = false;
  }

  function resetGuestStream() {
    guestStream = null;
    guestTimeline = [];
    guestLatestTime = 0;
    guestPlayhead = null;
    currentGuestFrame = null;
    lastSnapshotSequence = -1;
    diagnostics.lastSnapshotSequence = -1;
  }

  function ensureGuestStream(game) {
    if (guestStream) return guestStream;
    if (!MatchStream) throw new Error("客机只渲染启动失败：MatchStream 未绑定");
    const redPlayers = game && game.pitch && game.pitch.redTeam && game.pitch.redTeam.allPlayers;
    const bluePlayers = game && game.pitch && game.pitch.blueTeam && game.pitch.blueTeam.allPlayers;
    const squadSize = Math.max(
      7,
      Array.isArray(redPlayers) ? redPlayers.length : 0,
      Array.isArray(bluePlayers) ? bluePlayers.length : 0,
    );
    guestStream = new MatchStream(DEFAULT_STREAM_FRAMES);
    growMatchStream(guestStream, squadSize);
    return guestStream;
  }

  function bindRuntime(runtimeRoot, explicitRequire) {
    runtimeRequire = findRuntimeRequire(explicitRequire, runtimeRoot);
    if (!runtimeRequire) throw new Error("比赛同步适配失败：原版 AMD require 不可用");
    const streamModule = runtimeRequire("net/stream");
    const frameModule = runtimeRequire("net/frame");
    MatchStream = streamModule && streamModule.MatchStream;
    if (typeof MatchStream !== "function" || !frameModule || typeof frameModule.Frame !== "function") {
      throw new Error("比赛同步适配失败：Frame/MatchStream 接口不完整");
    }
    resetGuestStream();
    return true;
  }

  function configure(nextOptions) {
    const next = nextOptions || {};
    role = normalizeRole(next.role);
    sessionKind = normalizeSessionKind(next.sessionKind);
    matchId = String(next.matchId || "");
    sendSnapshot = typeof next.sendSnapshot === "function"
      ? next.sendSnapshot
      : typeof next.onSnapshot === "function" ? next.onSnapshot : null;
    const snapshotHz = clamp(next.snapshotHz == null ? 20 : next.snapshotHz, 1, 60);
    snapshotIntervalSeconds = 1 / snapshotHz;
    bufferSeconds = clamp(next.bufferMs == null ? 120 : next.bufferMs, 50, 500) / 1000;
    hostAccumulator = 0;
    hostSequence = 0;
    lastInputSequence = -1;
    for (const action of PULSE_ACTIONS) {
      delete pulseTokens[action];
      pulseLevels[action] = false;
    }
    paused = !!next.startPaused;
    remoteControlEnabled = role === "host" && sessionKind === "friend";
    disposed = false;
    attachedGame = null;
    diagnostics.role = role;
    diagnostics.sessionKind = sessionKind;
    diagnostics.matchId = matchId;
    diagnostics.hostFramesSent = 0;
    diagnostics.guestFramesReceived = 0;
    diagnostics.guestFramesDropped = 0;
    diagnostics.guestPhysicsTicks = 0;
    diagnostics.lastInputSequence = -1;
    diagnostics.lastError = "";
    diagnostics.paused = paused;
    diagnostics.remoteControlEnabled = remoteControlEnabled;
    clearRemoteInput();
    if (remoteControlEnabled) remoteInput.active = true;
    resetGuestStream();
    if (onRoleChanged) onRoleChanged({ role, sessionKind, matchId });
    return bridge;
  }

  function attachGame(game) {
    if (!game) return;
    attachedGame = game;
    if (role === "guest") ensureGuestStream(game);
    if (paused && game.pitch && typeof game.pitch.pause === "function") game.pitch.pause();
  }

  function acceptsRemoteInput() {
    return !disposed && !paused && remoteControlEnabled && role === "host" && sessionKind === "friend";
  }

  function setRemoteControlEnabled(enabled) {
    remoteControlEnabled = !!enabled && role === "host" && sessionKind === "friend";
    clearRemoteInput();
    if (remoteControlEnabled && !paused) remoteInput.active = true;
    diagnostics.remoteControlEnabled = remoteControlEnabled;
    return remoteControlEnabled;
  }

  function setRemoteInput(input, metadata) {
    if (!acceptsRemoteInput()) return false;
    const message = input || {};
    const meta = metadata || {};
    if (matchId && String(meta.matchId || "") !== matchId) return false;
    const sequence = Number(meta.sequence == null ? message.seq : meta.sequence);
    if (!Number.isFinite(sequence) || sequence <= lastInputSequence) return false;
    lastInputSequence = sequence;
    diagnostics.lastInputSequence = sequence;
    let vx = clamp(message.vx, -1, 1);
    let vy = clamp(message.vy, -1, 1);
    const magnitude = Math.sqrt(vx * vx + vy * vy);
    if (magnitude > 1) {
      vx /= magnitude;
      vy /= magnitude;
    }
    remoteInput.active = message.active !== false;
    remoteInput.vx = remoteInput.active ? vx : 0;
    remoteInput.vy = remoteInput.active ? vy : 0;
    for (const action of CONTINUOUS_ACTIONS) remoteInput[action] = remoteInput.active && !!message[action];
    const suppliedTokens = message.pulseSeq || meta.pulseSeq || {};
    for (const action of PULSE_ACTIONS) {
      const token = Number(suppliedTokens[action]);
      const level = !!message[action];
      if (Number.isFinite(token)) {
        if (!(action in pulseTokens) || token > pulseTokens[action]) {
          pulseTokens[action] = token;
          if (level) remoteInput[action] = true;
        }
      } else if (level && !pulseLevels[action]) {
        remoteInput[action] = true;
      }
      pulseLevels[action] = level;
    }
    return true;
  }

  function hostTick(frame, elapsed, game) {
    attachGame(game);
    if (disposed || paused || role !== "host") return false;
    if (!frame || typeof frame.pack !== "function") {
      setError(new Error("房主权威 Frame.pack 不可用"));
      return false;
    }
    hostAccumulator += clamp(elapsed, 0, 0.25);
    if (hostAccumulator + 1e-7 < snapshotIntervalSeconds) return false;
    const sampledSeconds = hostAccumulator;
    hostAccumulator = 0;
    const sequence = ++hostSequence;
    try {
      const encoded = encodeAuthoritativeFrame(frame, {
        sequence,
        sessionKind,
        steps: Math.max(1, Math.round(sampledSeconds * 60)),
      });
      const payload = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
      diagnostics.hostFramesSent += 1;
      if (sendSnapshot) sendSnapshot(payload, { sequence, matchId, sessionKind });
      return payload;
    } catch (error) {
      setError(error);
      throw error;
    }
  }

  function pushSnapshot(payload, metadata) {
    if (disposed || role !== "guest") return false;
    const meta = metadata || {};
    if (matchId && String(meta.matchId || "") !== matchId) {
      diagnostics.guestFramesDropped += 1;
      return false;
    }
    try {
      const inspected = inspectAuthoritativeFrame(payload);
      if (inspected.sessionKind !== sessionKind) {
        diagnostics.guestFramesDropped += 1;
        return false;
      }
      if (!Number.isFinite(Number(meta.sequence)) || Number(meta.sequence) !== inspected.sequence) {
        throw new Error("房间快照序号与 Frame payload 不一致");
      }
      if (inspected.sequence <= lastSnapshotSequence) {
        diagnostics.guestFramesDropped += 1;
        return false;
      }
      const stream = ensureGuestStream(attachedGame);
      const writeIndex = stream.index;
      const previousSequence = lastSnapshotSequence;
      const decoded = decodeAuthoritativeFrame(payload, stream);
      const gap = previousSequence < 0 ? 1 : Math.max(1, decoded.sequence - previousSequence);
      if (gap > 1) {
        const oldDuration = decoded.frame.duration;
        decoded.frame.steps = Math.min(255, Math.max(1, decoded.frame.steps * gap));
        stream.duration += decoded.frame.duration - oldDuration;
      }
      guestLatestTime = guestTimeline.length
        ? guestLatestTime + decoded.frame.duration
        : 0;
      guestTimeline.push({
        ringIndex: writeIndex % stream.frames.length,
        sequence: decoded.sequence,
        time: guestLatestTime,
        frame: decoded.frame,
      });
      if (guestTimeline.length > stream.frames.length) guestTimeline.shift();
      lastSnapshotSequence = decoded.sequence;
      diagnostics.lastSnapshotSequence = decoded.sequence;
      diagnostics.guestFramesReceived += 1;
      return true;
    } catch (error) {
      diagnostics.guestFramesDropped += 1;
      setError(error);
      return false;
    }
  }

  function guestTick(elapsed, game) {
    attachGame(game);
    diagnostics.guestPhysicsTicks += 0;
    return !disposed && role === "guest";
  }

  function readGuestFrame(elapsed) {
    if (disposed || paused || role !== "guest" || !guestStream || guestTimeline.length < 2) return null;
    const first = guestTimeline[0];
    const latest = guestTimeline[guestTimeline.length - 1];
    if (latest.time - first.time < bufferSeconds) return null;
    const bufferedEdge = latest.time - bufferSeconds;
    if (guestPlayhead == null || guestPlayhead < first.time) guestPlayhead = Math.max(first.time, bufferedEdge);
    else guestPlayhead = Math.min(bufferedEdge, guestPlayhead + clamp(elapsed, 0, 0.1));

    let rightIndex = 1;
    while (rightIndex < guestTimeline.length && guestTimeline[rightIndex].time < guestPlayhead) rightIndex += 1;
    if (rightIndex >= guestTimeline.length) rightIndex = guestTimeline.length - 1;
    const left = guestTimeline[Math.max(0, rightIndex - 1)];
    const right = guestTimeline[rightIndex];
    const duration = Math.max(1e-6, right.time - left.time);
    const alpha = Math.max(0, Math.min(1, (guestPlayhead - left.time) / duration));
    guestStream.interpolated.clear();
    guestStream.interpolated.interpolate(left.frame, right.frame, alpha);
    currentGuestFrame = guestStream.interpolated;
    return currentGuestFrame;
  }

  function pause(reason) {
    paused = true;
    diagnostics.paused = true;
    diagnostics.pauseReason = String(reason || "");
    clearRemoteInput();
    if (attachedGame && attachedGame.pitch && typeof attachedGame.pitch.pause === "function") {
      attachedGame.pitch.pause();
    }
  }

  function resume() {
    paused = false;
    diagnostics.paused = false;
    diagnostics.pauseReason = "";
    if (remoteControlEnabled) remoteInput.active = true;
    if (attachedGame && attachedGame.pitch && typeof attachedGame.pitch.resume === "function") {
      attachedGame.pitch.resume();
    }
  }

  function dispose() {
    disposed = true;
    clearRemoteInput();
    resetGuestStream();
    attachedGame = null;
  }

  const bridge = {
    bindRuntime,
    configure,
    acceptsRemoteInput,
    setRemoteInput,
    clearRemoteInput,
    hostTick,
    pushSnapshot,
    guestTick,
    readGuestFrame,
    setRemoteControlEnabled,
    pause,
    resume,
    dispose,
    diagnostics,
    remoteInput,
    get role() { return role; },
    get sessionKind() { return sessionKind; },
    get matchId() { return matchId; },
    get paused() { return paused; },
    get hasSnapshotSink() { return typeof sendSnapshot === "function"; },
    get isGuestRenderOnly() { return role === "guest"; },
    get currentGuestFrame() { return currentGuestFrame; },
    get remoteControlEnabled() { return remoteControlEnabled; },
  };

  configure(initial);
  return bridge;
}

module.exports = {
  createMatchSyncBridge,
  createRemoteInput,
  growMatchStream,
  normalizeRole,
  normalizeSessionKind,
};
