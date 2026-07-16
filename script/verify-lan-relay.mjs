import { spawn } from "node:child_process";
import net from "node:net";
import { WebSocket } from "ws";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForServer(child, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`LAN relay startup timeout: ${output}`)), timeout);
    const onData = (chunk) => {
      output += String(chunk);
      if (!output.includes("relay listening")) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`LAN relay exited early (${code}): ${output}`));
    });
  });
}

function connect(url, hello) {
  const socket = new WebSocket(url);
  const queue = [];
  const waiters = [];

  function publish(value) {
    const index = waiters.findIndex((waiter) => waiter.predicate(value));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(value);
    } else {
      queue.push(value);
    }
  }

  socket.on("message", (data) => {
    try { publish(JSON.parse(String(data))); } catch {}
  });

  const opened = new Promise((resolve, reject) => {
    socket.once("open", () => {
      socket.send(JSON.stringify(hello));
      resolve();
    });
    socket.once("error", reject);
  });

  return {
    socket,
    opened,
    send(value) { socket.send(JSON.stringify(value)); },
    waitFor(predicate, timeout = 3000) {
      const queued = queue.findIndex(predicate);
      if (queued >= 0) return Promise.resolve(queue.splice(queued, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("socket message timeout"));
        }, timeout);
        waiters.push(waiter);
      });
    },
    close() { try { socket.close(); } catch {} },
  };
}

const isType = (type) => (message) => message.t === type;
const port = await freePort();
const server = spawn(process.execPath, ["script/lan-server.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, LAN_PORT: String(port), LAN_IP: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const clients = [];

try {
  await waitForServer(server);
  const url = `ws://127.0.0.1:${port}`;

  const missing = connect(url, { t: "join", room: "NONE", clientId: "missing" });
  clients.push(missing);
  await missing.opened;
  const missingError = await missing.waitFor(isType("joinErr"));
  if (missingError.reason !== "no-room") throw new Error("missing-room response mismatch");

  const classicHost = connect(url, { t: "host", room: "", mode: "classic" });
  clients.push(classicHost);
  await classicHost.opened;
  const classicHosted = await classicHost.waitFor(isType("hosted"));
  if (!classicHosted.hostKey || classicHosted.mode !== "classic") throw new Error("classic host credentials missing");

  const intruder = connect(url, {
    t: "host", room: classicHosted.room, mode: "classic", hostKey: "wrong-key",
  });
  clients.push(intruder);
  await intruder.opened;
  const denied = await intruder.waitFor(isType("hostErr"));
  if (denied.reason !== "host-key") throw new Error("host takeover was not denied");

  const classicPad = connect(url, {
    t: "join", room: classicHosted.room, clientId: "classic-pad", name: "P1 test",
  });
  clients.push(classicPad);
  await classicPad.opened;
  const classicJoined = await classicPad.waitFor(isType("joined"));
  if (classicJoined.slot !== 0 || classicJoined.resumed) throw new Error("classic P1 join mismatch");
  await classicHost.waitFor((message) =>
    message.t === "roster" && message.pads.some((pad) => pad.slot === 0 && pad.ready));

  const classicInfo = { red: "argentina", blue: "portugal", side: "home", time: 6, ai: 0 };
  classicHost.send({ t: "start", requestId: "classic-start", info: classicInfo });
  const [classicStarted, classicPadStart] = await Promise.all([
    classicHost.waitFor(isType("started")),
    classicPad.waitFor(isType("start")),
  ]);
  if (classicStarted.matchId !== 1 || classicPadStart.matchId !== 1) throw new Error("classic start mismatch");

  classicPad.send({ t: "input", d: { vx: 99, vy: -99, shoot: "yes", pass: 1 } });
  const cleanedInput = await classicHost.waitFor(isType("input"));
  if (cleanedInput.d.vx !== 1 || cleanedInput.d.vy !== -1 || !cleanedInput.d.shoot || !cleanedInput.d.pass) {
    throw new Error("LAN input was not sanitized");
  }

  classicPad.close();
  const neutral = await classicHost.waitFor((message) => message.t === "input" && message.slot === 0);
  if (neutral.d.vx !== 0 || neutral.d.shoot) throw new Error("disconnect did not neutralize input");
  await classicHost.waitFor((message) =>
    message.t === "roster" && message.pads.some((pad) => pad.slot === 0 && !pad.ready));

  const resumedClassicPad = connect(url, {
    t: "join", room: classicHosted.room, clientId: "classic-pad", name: "P1 resumed",
  });
  clients.push(resumedClassicPad);
  await resumedClassicPad.opened;
  const resumedClassic = await resumedClassicPad.waitFor(isType("joined"));
  if (!resumedClassic.resumed || resumedClassic.slot !== 0) throw new Error("classic controller did not reclaim P1");
  await resumedClassicPad.waitFor(isType("start"));

  const resumedHost = connect(url, {
    t: "host",
    room: classicHosted.room,
    mode: "classic",
    hostKey: classicHosted.hostKey,
  });
  clients.push(resumedHost);
  await resumedHost.opened;
  const resumedHosted = await resumedHost.waitFor(isType("hosted"));
  if (resumedHosted.phase !== "playing" || resumedHosted.matchId !== 1) {
    throw new Error("host reconnect did not restore match state");
  }
  resumedHost.send({ t: "start", requestId: "classic-start", info: classicInfo });
  const repeatedStart = await resumedHost.waitFor(isType("started"));
  if (repeatedStart.matchId !== 1) throw new Error("start request was not idempotent");
  resumedHost.send({ t: "ended" });
  await resumedClassicPad.waitFor(isType("ended"));

  const kioskHost = connect(url, { t: "host", room: "", mode: "kiosk" });
  clients.push(kioskHost);
  await kioskHost.opened;
  const kioskHosted = await kioskHost.waitFor(isType("hosted"));
  if (kioskHosted.mode !== "kiosk") throw new Error("kiosk room mode mismatch");

  const kioskPad0 = connect(url, {
    t: "join", room: kioskHosted.room, clientId: "kiosk-p0", name: "Kiosk P1",
  });
  clients.push(kioskPad0);
  await kioskPad0.opened;
  await kioskPad0.waitFor(isType("joined"));
  await kioskHost.waitFor((message) => message.t === "roster" && message.pads.length === 1);
  kioskHost.send({ t: "start", requestId: "too-early", info: classicInfo });
  const tooEarly = await kioskHost.waitFor(isType("startErr"));
  if (tooEarly.reason !== "players-not-ready") throw new Error("kiosk allowed one-player start");

  const kioskPad1 = connect(url, {
    t: "join", room: kioskHosted.room, clientId: "kiosk-p1", name: "Kiosk P2",
  });
  clients.push(kioskPad1);
  await kioskPad1.opened;
  const kioskJoined1 = await kioskPad1.waitFor(isType("joined"));
  if (kioskJoined1.slot !== 1) throw new Error("kiosk P2 slot mismatch");
  await kioskHost.waitFor((message) => message.t === "roster" && message.pads.filter((pad) => pad.ready).length === 2);

  kioskHost.send({
    t: "selecting", red: "england", blue: "france", bothConfirmed: false,
  });
  await Promise.all([
    kioskPad0.waitFor(isType("selecting")),
    kioskPad1.waitFor(isType("selecting")),
  ]);
  kioskPad1.send({ t: "pick", team: "brazil" });
  const pick = await kioskHost.waitFor(isType("padPick"));
  if (pick.slot !== 1 || pick.team !== "brazil") throw new Error("kiosk team pick relay mismatch");
  kioskPad0.send({ t: "confirm" });
  kioskPad1.send({ t: "confirm" });
  const confirms = await Promise.all([
    kioskHost.waitFor((message) => message.t === "padConfirm" && message.slot === 0),
    kioskHost.waitFor((message) => message.t === "padConfirm" && message.slot === 1),
  ]);
  if (confirms.length !== 2) throw new Error("kiosk confirmations missing");

  const kioskInfo = { red: "england", blue: "brazil", side: "home", time: 8, ai: 0 };
  kioskHost.send({ t: "start", requestId: "kiosk-start", info: kioskInfo });
  const [kioskStarted] = await Promise.all([
    kioskHost.waitFor(isType("started")),
    kioskPad0.waitFor(isType("start")),
    kioskPad1.waitFor(isType("start")),
  ]);
  if (kioskStarted.info.blue !== "brazil" || kioskStarted.info.time !== "8") {
    throw new Error("kiosk start info mismatch");
  }

  kioskHost.send({ t: "ended" });
  await Promise.all([
    kioskPad0.waitFor(isType("released")),
    kioskPad1.waitFor(isType("released")),
  ]);
  const emptyRoster = await kioskHost.waitFor((message) => message.t === "roster" && message.pads.length === 0);
  if (emptyRoster.phase !== "waiting") throw new Error("kiosk room did not reset");

  console.log(JSON.stringify({
    ok: true,
    classicRoom: classicHosted.room,
    kioskRoom: kioskHosted.room,
    checks: [
      "missing room error",
      "host takeover protection",
      "classic P1 start acknowledgement",
      "input validation and clamping",
      "disconnect neutral input",
      "controller slot recovery",
      "host state recovery",
      "idempotent start",
      "kiosk requires two controllers",
      "team selection relay",
      "kiosk release and room reset",
    ],
  }, null, 2));
} finally {
  for (const client of clients) client.close();
  server.kill("SIGTERM");
}
