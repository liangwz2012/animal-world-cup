"use client";

// Classic LAN bridge. The lobby owns room creation; this component re-attaches
// on /match, maps phone input to the two engine slots, and re-arms controllers
// after an explicit rematch. Kiosk rooms are handled by LanKioskBridge.
import { useEffect } from "react";
import { createLanClient } from "../lan/lanClient";
import { loadLanHostKey, storeLanHostKey } from "../lan/hostKey";

const EMPTY_INPUT = {
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

function touchInput(slot) {
  const key = slot === 1 ? "__touchInput2" : "__touchInput";
  return (window[key] = window[key] || { ...EMPTY_INPUT });
}

function neutralize(slot, active = false) {
  Object.assign(touchInput(slot), EMPTY_INPUT, { active });
}

function requestId() {
  try { return crypto.randomUUID(); } catch {}
  return `start-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default function LanHostBridge() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = (params.get("lan") || "").toUpperCase();
    if (!room || params.get("kiosk") === "1") return undefined;

    const info = {
      red: params.get("red") || "argentina",
      blue: params.get("blue") || "portugal",
      side: params.get("side") || "home",
      time: params.get("time") || "6",
      ai: params.get("ai") || "0",
    };
    const present = new Set();
    const lastInputAt = new Map();
    let phase = "waiting";
    let starting = false;
    let ended = false;
    let currentRequestId = "";

    function maybeStart(lan) {
      if (ended || starting || phase === "playing" || !present.has(0)) return;
      starting = true;
      currentRequestId = requestId();
      lan.send({ t: "start", requestId: currentRequestId, info });
    }

    const lan = createLanClient({
      onMessage(msg) {
        if (msg.t === "hosted") {
          storeLanHostKey(room, msg.hostKey);
          phase = msg.phase || "waiting";
          maybeStart(lan);
          return;
        }
        if (msg.t === "roster") {
          phase = msg.phase || phase;
          present.clear();
          for (const pad of msg.pads || []) if (pad.ready) present.add(pad.slot);
          for (const slot of [0, 1]) {
            const live = present.has(slot);
            touchInput(slot).active = live;
            if (!live) neutralize(slot, false);
          }
          maybeStart(lan);
          return;
        }
        if (msg.t === "input" && (msg.slot === 0 || msg.slot === 1)) {
          const input = touchInput(msg.slot);
          const data = msg.d || {};
          input.active = true;
          input.vx = Number.isFinite(data.vx) ? data.vx : 0;
          input.vy = Number.isFinite(data.vy) ? data.vy : 0;
          input.shoot = !!data.shoot;
          input.sprint = !!data.sprint;
          if (data.pass) input.pass = true;
          if (data.lob) input.lob = true;
          if (data.switchPlayer) input.switchPlayer = true;
          if (data.tackle) input.tackle = true;
          lastInputAt.set(msg.slot, Date.now());
          return;
        }
        if (msg.t === "started") {
          if (currentRequestId && msg.requestId && msg.requestId !== currentRequestId) return;
          phase = "playing";
          starting = false;
          return;
        }
        if (msg.t === "startErr") {
          if (msg.reason === "already-playing") phase = "playing";
          starting = false;
        }
      },
    });

    lan.setHello(() => ({
      t: "host",
      room,
      mode: "classic",
      hostKey: loadLanHostKey(room),
    }));

    const staleInputTimer = setInterval(() => {
      const now = Date.now();
      for (const slot of [0, 1]) {
        if (!present.has(slot)) continue;
        if (now - (lastInputAt.get(slot) || 0) > 350) neutralize(slot, true);
      }
    }, 100);

    const onEnded = () => {
      ended = true;
      phase = "waiting";
      neutralize(0, false);
      neutralize(1, false);
      lan.send({ t: "ended" });
    };
    window.addEventListener("ab-match-ended", onEnded);

    // Phone controllers own both sides in LAN matches.
    const gameKeys = new Set([
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "a", "d", "w", "s", "q", "Shift",
    ]);
    const blockLocalControls = (event) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!gameKeys.has(key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", blockLocalControls, true);
    window.addEventListener("keyup", blockLocalControls, true);

    return () => {
      clearInterval(staleInputTimer);
      window.removeEventListener("ab-match-ended", onEnded);
      window.removeEventListener("keydown", blockLocalControls, true);
      window.removeEventListener("keyup", blockLocalControls, true);
      neutralize(0, false);
      neutralize(1, false);
      lan.close();
    };
  }, []);

  return null;
}
