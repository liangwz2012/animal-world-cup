// LAN relay for Animal Cup local-versus modes.
//
// One big screen owns the match simulation. Phones are wireless controllers;
// this process only validates and relays small JSON messages. It deliberately
// binds to the local network, so never expose port 13001 to the public internet.
import { randomBytes } from "node:crypto";
import os from "node:os";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.LAN_PORT || 13001);
const WEB_PORT = Number(process.env.WEB_PORT || 13000);
const SLOTS = 2;
const HOST_GRACE_MS = 25_000;
const PAD_GRACE_MS = 10_000;
const HEARTBEAT_MS = 10_000;
const MAX_JSON_BYTES = 8 * 1024;
const MAX_MESSAGES_PER_SECOND = 120;
const PLAYABLE_TEAMS = new Set([
  "england", "france", "germany", "spain",
  "portugal", "brazil", "argentina", "usa",
]);

function lanIP() {
  const forced = String(process.env.LAN_IP || "").trim();
  if (forced) return forced;

  const privateIPs = [];
  const otherIPs = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const item of interfaces[name] || []) {
      if (item.family !== "IPv4" || item.internal) continue;
      const target = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)
        ? privateIPs
        : otherIPs;
      target.push(item.address);
    }
  }
  return privateIPs[0] || otherIPs[0] || "127.0.0.1";
}

const rooms = new Map();
let padSequence = 1;

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from(
      { length: 4 },
      () => alphabet[(Math.random() * alphabet.length) | 0],
    ).join("");
  } while (rooms.has(code));
  return code;
}

function hostKey() {
  return randomBytes(24).toString("base64url");
}

function roomMode(value) {
  return value === "kiosk" ? "kiosk" : "classic";
}

function newRoom(host, mode, key) {
  return {
    host,
    hostKey: key || hostKey(),
    mode: roomMode(mode),
    pads: new Map(),
    phase: "waiting",
    matchId: 0,
    lastStartInfo: null,
    lastStartRequestId: null,
    graceTimer: null,
  };
}

function send(ws, value) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function freeSlot(room) {
  // A disconnected controller keeps its side during the reconnect grace.
  const used = new Set([...room.pads.values()].map((pad) => pad.slot));
  for (let slot = 0; slot < SLOTS; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return -1;
}

function publicRoster(room) {
  return [...room.pads.values()]
    .map((pad) => ({
      padId: pad.padId,
      name: pad.name,
      slot: pad.slot,
      ready: pad.ready,
    }))
    .sort((a, b) => a.slot - b.slot);
}

function pushRoster(room) {
  send(room.host, {
    t: "roster",
    pads: publicRoster(room),
    phase: room.phase,
    matchId: room.matchId,
    mode: room.mode,
  });
}

function readySlots(room) {
  return new Set(
    [...room.pads.values()].filter((pad) => pad.ready).map((pad) => pad.slot),
  );
}

function canStart(room) {
  const ready = readySlots(room);
  return room.mode === "kiosk"
    ? ready.has(0) && ready.has(1)
    : ready.has(0);
}

function sendStart(room, pad) {
  if (!pad.ready) return;
  send(pad.ws, {
    t: "start",
    slot: pad.slot,
    info: room.lastStartInfo,
    matchId: room.matchId,
  });
}

function attachPad(ws, code, pad) {
  ws.meta = { role: "pad", room: code, padId: pad.padId };
}

function cleanAxis(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-1, Math.min(1, number));
}

function cleanInput(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    vx: cleanAxis(value.vx),
    vy: cleanAxis(value.vy),
    shoot: !!value.shoot,
    sprint: !!value.sprint,
    pass: !!value.pass,
    lob: !!value.lob,
    switchPlayer: !!value.switchPlayer,
    tackle: !!value.tackle,
  };
}

function cleanStartInfo(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const red = String(value.red || "");
  const blue = String(value.blue || "");
  if (!PLAYABLE_TEAMS.has(red) || !PLAYABLE_TEAMS.has(blue)) {
    return { error: "invalid-team" };
  }
  if (red === blue) return { error: "same-team" };

  const rawTime = Number(value.time);
  const rawAi = Number(value.ai);
  return {
    info: {
      red,
      blue,
      side: value.side === "away" ? "away" : "home",
      time: String(Number.isFinite(rawTime) ? Math.max(1, Math.min(30, rawTime)) : 6),
      ai: String(Number.isFinite(rawAi) ? Math.max(0, Math.min(3, rawAi)) : 0),
    },
  };
}

function destroyRoom(code, room) {
  if (rooms.get(code) !== room) return;
  for (const pad of room.pads.values()) {
    if (pad.dropTimer) clearTimeout(pad.dropTimer);
    send(pad.ws, { t: "closed", reason: "host-left" });
    try { pad.ws?.close(1001, "host-left"); } catch {}
  }
  rooms.delete(code);
}

function allowMessage(ws) {
  const now = Date.now();
  if (!ws.rate || now - ws.rate.startedAt >= 1000) {
    ws.rate = { startedAt: now, count: 1 };
    return true;
  }
  ws.rate.count += 1;
  if (ws.rate.count <= MAX_MESSAGES_PER_SECOND) return true;
  try { ws.close(1008, "rate-limit"); } catch {}
  return false;
}

const wss = new WebSocketServer({
  port: PORT,
  host: "0.0.0.0",
  maxPayload: MAX_JSON_BYTES,
});

wss.on("connection", (ws) => {
  ws.meta = null;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw, isBinary) => {
    if (isBinary || !allowMessage(ws)) return;
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;

    if (msg.t === "host") {
      const requestedCode = String(msg.room || "").toUpperCase().slice(0, 4);
      const requestedKey = String(msg.hostKey || "").slice(0, 100);
      let code = requestedCode;
      let room = code && rooms.get(code);

      if (room) {
        if (!requestedKey || requestedKey !== room.hostKey) {
          send(ws, { t: "hostErr", reason: "host-key" });
          return;
        }
        if (room.graceTimer) {
          clearTimeout(room.graceTimer);
          room.graceTimer = null;
        }
        const oldHost = room.host;
        room.host = ws;
        if (oldHost && oldHost !== ws) {
          try { oldHost.close(4000, "host-replaced"); } catch {}
        }
      } else {
        code = code || roomCode();
        room = newRoom(ws, msg.mode, requestedKey);
        rooms.set(code, room);
      }

      ws.meta = { role: "host", room: code };
      send(ws, {
        t: "hosted",
        room: code,
        hostKey: room.hostKey,
        ip: lanIP(),
        port: WEB_PORT,
        slots: SLOTS,
        mode: room.mode,
        phase: room.phase,
        matchId: room.matchId,
        requestId: room.lastStartRequestId,
        info: room.lastStartInfo,
      });
      pushRoster(room);
      return;
    }

    if (msg.t === "join") {
      const code = String(msg.room || "").toUpperCase().slice(0, 4);
      const room = rooms.get(code);
      if (!room) {
        send(ws, { t: "joinErr", reason: "no-room" });
        return;
      }

      const clientId = String(msg.clientId || "").slice(0, 80);
      const name = String(msg.name || "").slice(0, 24);
      const resumed = clientId
        ? [...room.pads.values()].find((pad) => pad.clientId === clientId)
        : null;

      if (resumed) {
        if (resumed.dropTimer) {
          clearTimeout(resumed.dropTimer);
          resumed.dropTimer = null;
        }
        const oldSocket = resumed.ws;
        resumed.ws = ws;
        resumed.ready = true;
        if (name) resumed.name = name;
        attachPad(ws, code, resumed);
        if (oldSocket && oldSocket !== ws) {
          try { oldSocket.close(4001, "pad-reconnected"); } catch {}
        }
        send(ws, {
          t: "joined",
          padId: resumed.padId,
          slot: resumed.slot,
          room: code,
          resumed: true,
          mode: room.mode,
          phase: room.phase,
          matchId: room.matchId,
        });
        if (room.phase === "playing") sendStart(room, resumed);
        pushRoster(room);
        return;
      }

      const slot = freeSlot(room);
      if (slot < 0) {
        send(ws, { t: "joinErr", reason: "full" });
        return;
      }

      const padId = padSequence++;
      const pad = {
        padId,
        clientId: clientId || `legacy-${padId}`,
        ws,
        name: name || (slot === 0 ? "P1" : "P2"),
        slot,
        ready: true,
        dropTimer: null,
      };
      room.pads.set(padId, pad);
      attachPad(ws, code, pad);
      send(ws, {
        t: "joined",
        padId,
        slot,
        room: code,
        resumed: false,
        mode: room.mode,
        phase: room.phase,
        matchId: room.matchId,
      });
      if (room.phase === "playing") sendStart(room, pad);
      pushRoster(room);
      return;
    }

    const code = ws.meta?.room;
    const room = code && rooms.get(code);
    if (!room) return;

    if (msg.t === "input" && ws.meta.role === "pad") {
      const pad = room.pads.get(ws.meta.padId);
      if (pad && pad.ws === ws && pad.ready) {
        send(room.host, {
          t: "input",
          slot: pad.slot,
          padId: pad.padId,
          d: cleanInput(msg.d),
        });
      }
      return;
    }

    if (msg.t === "start" && ws.meta.role === "host" && room.host === ws) {
      const requestId = String(msg.requestId || "").slice(0, 100);
      if (room.phase === "playing") {
        if (!requestId || requestId === room.lastStartRequestId) {
          send(ws, {
            t: "started",
            requestId: room.lastStartRequestId,
            matchId: room.matchId,
            info: room.lastStartInfo,
          });
        } else {
          send(ws, {
            t: "startErr",
            requestId,
            reason: "already-playing",
            matchId: room.matchId,
            info: room.lastStartInfo,
          });
        }
        return;
      }
      if (!canStart(room)) {
        send(ws, {
          t: "startErr",
          requestId,
          reason: room.mode === "kiosk" ? "players-not-ready" : "p1-not-ready",
        });
        return;
      }

      const cleaned = cleanStartInfo(msg.info);
      if (cleaned.error) {
        send(ws, { t: "startErr", requestId, reason: cleaned.error });
        return;
      }

      room.phase = "playing";
      room.matchId += 1;
      room.lastStartRequestId = requestId || `match-${room.matchId}`;
      room.lastStartInfo = cleaned.info;
      for (const pad of room.pads.values()) sendStart(room, pad);
      send(ws, {
        t: "started",
        requestId: room.lastStartRequestId,
        matchId: room.matchId,
        info: room.lastStartInfo,
      });
      pushRoster(room);
      return;
    }

    if (msg.t === "selecting" && ws.meta.role === "host" && room.host === ws && room.mode === "kiosk") {
      const red = String(msg.red || "");
      const blue = String(msg.blue || "");
      if (!PLAYABLE_TEAMS.has(red) || !PLAYABLE_TEAMS.has(blue) || red === blue) return;
      for (const pad of room.pads.values()) {
        send(pad.ws, { t: "selecting", red, blue, bothConfirmed: !!msg.bothConfirmed });
      }
      return;
    }

    if (msg.t === "pick" && ws.meta.role === "pad" && room.mode === "kiosk") {
      const pad = room.pads.get(ws.meta.padId);
      const team = String(msg.team || "");
      if (pad && pad.ws === ws && pad.ready && PLAYABLE_TEAMS.has(team)) {
        send(room.host, { t: "padPick", slot: pad.slot, padId: pad.padId, team });
      }
      return;
    }

    if (msg.t === "confirm" && ws.meta.role === "pad" && room.mode === "kiosk") {
      const pad = room.pads.get(ws.meta.padId);
      if (pad && pad.ws === ws && pad.ready) {
        send(room.host, { t: "padConfirm", slot: pad.slot, padId: pad.padId });
      }
      return;
    }

    if (msg.t === "startMatch" && ws.meta.role === "pad" && room.mode === "kiosk") {
      const pad = room.pads.get(ws.meta.padId);
      if (pad && pad.ws === ws && pad.ready && pad.slot === 0) {
        send(room.host, { t: "padStartMatch", padId: pad.padId });
      }
      return;
    }

    if (msg.t === "assign" && ws.meta.role === "host" && room.host === ws) {
      const pad = room.pads.get(Number(msg.padId));
      const slot = Number(msg.slot);
      if (pad && Number.isInteger(slot) && slot >= 0 && slot < SLOTS) {
        for (const other of room.pads.values()) {
          if (other !== pad && other.slot === slot) other.slot = pad.slot;
        }
        pad.slot = slot;
        send(pad.ws, { t: "slot", slot: pad.slot });
        pushRoster(room);
      }
      return;
    }

    if (msg.t === "ended" && ws.meta.role === "host" && room.host === ws) {
      room.phase = "waiting";
      room.lastStartInfo = null;
      room.lastStartRequestId = null;

      if (room.mode === "kiosk") {
        // Kiosk matches release both seats for the next challengers.
        for (const pad of room.pads.values()) {
          if (pad.dropTimer) clearTimeout(pad.dropTimer);
          send(pad.ws, { t: "released", reason: "match-ended" });
          try { pad.ws?.close(1000, "match-ended"); } catch {}
        }
        room.pads.clear();
      } else {
        for (const pad of room.pads.values()) send(pad.ws, { t: "ended" });
      }
      pushRoster(room);
    }
  });

  ws.on("close", () => {
    const code = ws.meta?.room;
    const room = code && rooms.get(code);
    if (!room) return;

    if (ws.meta.role === "pad") {
      const pad = room.pads.get(ws.meta.padId);
      // A reconnect may already have replaced this socket.
      if (!pad || pad.ws !== ws) return;
      pad.ws = null;
      pad.ready = false;
      send(room.host, {
        t: "input",
        slot: pad.slot,
        padId: pad.padId,
        d: cleanInput(null),
      });
      pushRoster(room);
      pad.dropTimer = setTimeout(() => {
        if (!pad.ready && !pad.ws && room.pads.get(pad.padId) === pad) {
          room.pads.delete(pad.padId);
          pushRoster(room);
        }
      }, PAD_GRACE_MS);
      return;
    }

    if (ws.meta.role === "host" && room.host === ws) {
      room.host = null;
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.graceTimer = setTimeout(() => destroyRoom(code, room), HOST_GRACE_MS);
    }
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);
heartbeat.unref();
wss.on("close", () => clearInterval(heartbeat));

wss.on("listening", () => {
  const ip = lanIP();
  console.log(
    `[lan] relay listening on ws://${ip}:${PORT}  (phones join via http://${ip}:${WEB_PORT}/pad)`,
  );
});
