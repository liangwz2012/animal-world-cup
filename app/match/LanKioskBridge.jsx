"use client";

// Optional LAN challenge-station flow:
// AI attract match -> QR room -> two phones -> team selection -> fresh 2P match.
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { PLAYABLE_TEAMS, portraitSrc, runtimeHeadSrc } from "../data/teams";
import { useLocale } from "../i18n/LocaleProvider";
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
const RESULT_HOLD_SECONDS = 10;

function touchInput(slot) {
  const key = slot === 1 ? "__touchInput2" : "__touchInput";
  return (window[key] = window[key] || { ...EMPTY_INPUT });
}

function neutralize(slot, active = false) {
  Object.assign(touchInput(slot), EMPTY_INPUT, { active });
}

function readySlots(pads) {
  return new Set((pads || []).filter((pad) => pad.ready).map((pad) => pad.slot));
}

function requestId() {
  try { return crypto.randomUUID(); } catch {}
  return `start-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function phoneJoinUrl(message) {
  const current = window.location.hostname || "";
  const loopback = current === "localhost" || current === "127.0.0.1" || current === "::1";
  let host = loopback ? message.ip : current;
  if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
  return `http://${host}:${message.port || 13000}/pad?room=${encodeURIComponent(message.room)}`;
}

function TeamPicker({ slot, tone, picked, taken, disabled, onPick, t }) {
  return (
    <section className={`lan-team-picker lan-team-picker--${tone}`}>
      <header className="lan-team-picker__head">
        <span>{slot}</span>
        <b>{t(`team.${picked}.name`)}</b>
      </header>
      <div className="lan-team-picker__grid">
        {PLAYABLE_TEAMS.map((team) => {
          const selected = picked === team.id;
          const unavailable = taken === team.id && !selected;
          return (
            <button
              key={team.id}
              type="button"
              className={selected ? "is-selected" : ""}
              disabled={disabled || unavailable}
              aria-pressed={selected}
              onClick={() => onPick(team.id)}
            >
              {selected ? <i aria-hidden>OK</i> : null}
              <img
                src={portraitSrc(team.id)}
                alt=""
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = runtimeHeadSrc(team.id);
                }}
              />
              <span>{t(`team.${team.id}.name`)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TeamSelection({ red, blue, busy, onRed, onBlue, onConfirm, t }) {
  return (
    <div className="lan-team-select" role="dialog" aria-modal="true" aria-labelledby="lan-team-select-title">
      <div className="lan-team-select__panel">
        <header className="lan-team-select__title">
          <span>{t("lan.select.ready")}</span>
          <h1 id="lan-team-select-title">{t("lan.select.title")}</h1>
          <p>{t("lan.select.subtitle")}</p>
        </header>
        <div className="lan-team-select__duel">
          <TeamPicker
            slot={t("lan.select.p1")}
            tone="red"
            picked={red}
            taken={blue}
            disabled={busy}
            onPick={onRed}
            t={t}
          />
          <span className="lan-team-select__vs" aria-hidden>VS</span>
          <TeamPicker
            slot={t("lan.select.p2")}
            tone="blue"
            picked={blue}
            taken={red}
            disabled={busy}
            onPick={onBlue}
            t={t}
          />
        </div>
        <button
          type="button"
          className="lan-team-select__confirm"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? t("lan.select.confirming") : t("lan.select.confirm")}
        </button>
      </div>
    </div>
  );
}

export default function LanKioskBridge() {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(false);
  const [playMode, setPlayMode] = useState(false);
  const [room, setRoom] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [qr, setQr] = useState("");
  const [pads, setPads] = useState([]);
  const [connection, setConnection] = useState("connecting");
  const [phase, setPhase] = useState("waiting");
  const [selecting, setSelecting] = useState(false);
  const [redChoice, setRedChoice] = useState("argentina");
  const [blueChoice, setBlueChoice] = useState("portugal");
  const [resultCountdown, setResultCountdown] = useState(null);

  const lanRef = useRef(null);
  const roomRef = useRef("");
  const padsRef = useRef([]);
  const playModeRef = useRef(false);
  const phaseRef = useRef("waiting");
  const connectionRef = useRef("connecting");
  const choicesRef = useRef({ red: "argentina", blue: "portugal" });
  const matchInfoRef = useRef({ red: "argentina", blue: "portugal", side: "home", time: "6", ai: "0" });
  const confirmedSlotsRef = useRef(new Set());
  const startRequestRef = useRef("");
  const startRetryRef = useRef(null);
  const resultTimerRef = useRef(null);
  const lastInputAtRef = useRef(new Map());
  const startedRef = useRef(false);
  const endedRef = useRef(false);

  function broadcastSelecting(red = choicesRef.current.red, blue = choicesRef.current.blue, bothConfirmed = false) {
    lanRef.current?.send({ t: "selecting", red, blue, bothConfirmed });
  }

  function pick(slot, team) {
    if (startedRef.current || !PLAYABLE_TEAMS.some((item) => item.id === team)) return;
    const next = { ...choicesRef.current };
    if (slot === 0) {
      if (team === next.blue) return;
      next.red = team;
      setRedChoice(team);
    } else {
      if (team === next.red) return;
      next.blue = team;
      setBlueChoice(team);
    }
    choicesRef.current = next;
    confirmedSlotsRef.current.delete(slot);
    broadcastSelecting(next.red, next.blue);
  }

  function adoptServerInfo(info) {
    if (!info || typeof info !== "object") return false;
    const red = String(info.red || "");
    const blue = String(info.blue || "");
    if (
      red === blue ||
      !PLAYABLE_TEAMS.some((team) => team.id === red) ||
      !PLAYABLE_TEAMS.some((team) => team.id === blue)
    ) return false;
    choicesRef.current = { red, blue };
    matchInfoRef.current = { ...matchInfoRef.current, ...info, red, blue };
    setRedChoice(red);
    setBlueChoice(blue);
    return true;
  }

  function goToTwoPlayerMatch() {
    if (!roomRef.current) return;
    const next = new URL(window.location.href);
    next.searchParams.set("red", choicesRef.current.red);
    next.searchParams.set("blue", choicesRef.current.blue);
    next.searchParams.set("side", matchInfoRef.current.side || "home");
    next.searchParams.set("time", matchInfoRef.current.time || "6");
    next.searchParams.set("ai", matchInfoRef.current.ai || "0");
    next.searchParams.set("lan", roomRef.current);
    next.searchParams.set("play", "1");
    next.searchParams.set("p2", "1");
    next.searchParams.set("kiosk", "1");
    next.searchParams.delete("attract");
    window.location.replace(next.toString());
  }

  function goToAttractMatch() {
    const next = new URL(window.location.href);
    next.searchParams.delete("play");
    next.searchParams.delete("p2");
    next.searchParams.set("attract", "1");
    next.searchParams.set("kiosk", "1");
    if (roomRef.current) next.searchParams.set("lan", roomRef.current);
    window.location.replace(next.toString());
  }

  function sendStartRequest() {
    lanRef.current?.send({
      t: "start",
      requestId: startRequestRef.current,
      info: matchInfoRef.current,
    });
  }

  function armStartRetry(attempt = 0) {
    if (startRetryRef.current) clearTimeout(startRetryRef.current);
    startRetryRef.current = setTimeout(() => {
      if (phaseRef.current !== "starting") return;
      if (attempt >= 2) {
        startedRef.current = false;
        startRequestRef.current = "";
        phaseRef.current = "waiting";
        setPhase("waiting");
        return;
      }
      if (lanRef.current?.ready) sendStartRequest();
      armStartRetry(attempt + 1);
    }, 1000);
  }

  function confirmTeams() {
    const ready = readySlots(padsRef.current);
    if (
      playModeRef.current ||
      startedRef.current ||
      connectionRef.current !== "ready" ||
      !ready.has(0) ||
      !ready.has(1) ||
      choicesRef.current.red === choicesRef.current.blue
    ) return;
    startedRef.current = true;
    phaseRef.current = "starting";
    setPhase("starting");
    matchInfoRef.current = { ...matchInfoRef.current, ...choicesRef.current };
    startRequestRef.current = requestId();
    sendStartRequest();
    armStartRetry();
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const active = params.get("attract") === "1" || params.get("kiosk") === "1";
    if (!active) return undefined;
    setEnabled(true);

    const isPlayMode = params.get("play") === "1";
    playModeRef.current = isPlayMode;
    setPlayMode(isPlayMode);
    roomRef.current = (params.get("lan") || "").toUpperCase();
    setRoom(roomRef.current);

    const red = params.get("red") || "argentina";
    let blue = params.get("blue") || "portugal";
    if (red === blue) blue = PLAYABLE_TEAMS.find((team) => team.id !== red)?.id || "portugal";
    choicesRef.current = { red, blue };
    setRedChoice(red);
    setBlueChoice(blue);
    matchInfoRef.current = {
      red,
      blue,
      side: params.get("side") || "home",
      time: params.get("time") || "6",
      ai: params.get("ai") || "0",
    };

    function requestPlayModeStart() {
      const ready = readySlots(padsRef.current);
      if (
        !isPlayMode || endedRef.current || startedRef.current ||
        phaseRef.current === "playing" || !ready.has(0) || !ready.has(1)
      ) return;
      startedRef.current = true;
      phaseRef.current = "starting";
      setPhase("starting");
      startRequestRef.current = requestId();
      sendStartRequest();
      armStartRetry();
    }

    const lan = createLanClient({
      onOpen() {
        connectionRef.current = "connecting";
        setConnection("connecting");
      },
      onClose() {
        connectionRef.current = "connecting";
        setConnection("connecting");
        setSelecting(false);
        if (startRetryRef.current) clearTimeout(startRetryRef.current);
        if (phaseRef.current === "starting") {
          startedRef.current = false;
          startRequestRef.current = "";
          phaseRef.current = "waiting";
          setPhase("waiting");
        }
        neutralize(0, false);
        neutralize(1, false);
      },
      onMessage(message) {
        if (message.t === "hostErr" && message.reason === "host-key") {
          // A copied/stale kiosk URL has no valid session key. Start a fresh
          // local room instead of leaving the challenge screen disconnected.
          roomRef.current = "";
          setRoom("");
          const here = new URL(window.location.href);
          here.searchParams.delete("lan");
          window.history.replaceState(window.history.state, "", `${here.pathname}${here.search}${here.hash}`);
          lan.setHello(() => ({ t: "host", room: "", mode: "kiosk", hostKey: "" }));
          return;
        }
        if (message.t === "hosted") {
          connectionRef.current = "ready";
          setConnection("ready");
          roomRef.current = message.room;
          setRoom(message.room);
          storeLanHostKey(message.room, message.hostKey);
          phaseRef.current = message.phase || "waiting";
          setPhase(phaseRef.current);
          if (message.info) adoptServerInfo(message.info);

          const here = new URL(window.location.href);
          here.searchParams.set("lan", message.room);
          here.searchParams.set("kiosk", "1");
          window.history.replaceState(window.history.state, "", `${here.pathname}${here.search}${here.hash}`);

          const url = phoneJoinUrl(message);
          setJoinUrl(url);
          QRCode.toDataURL(url, {
            margin: 1,
            width: 300,
            errorCorrectionLevel: "M",
            color: { dark: "#21451b", light: "#fffef8" },
          }).then(setQr).catch(() => setQr(""));

          if (!isPlayMode && message.phase === "playing" && message.info && adoptServerInfo(message.info)) {
            startedRef.current = true;
            goToTwoPlayerMatch();
          }
          return;
        }

        if (message.t === "roster") {
          const roster = message.pads || [];
          const previousReady = readySlots(padsRef.current);
          padsRef.current = roster;
          setPads(roster);
          phaseRef.current = message.phase || phaseRef.current;
          setPhase(phaseRef.current);
          const ready = readySlots(roster);

          for (const slot of [0, 1]) {
            const live = isPlayMode && ready.has(slot);
            touchInput(slot).active = live;
            if (!live) neutralize(slot, false);
          }

          if (!isPlayMode) {
            const bothReady = ready.has(0) && ready.has(1) && phaseRef.current !== "playing";
            setSelecting(bothReady);
            if (bothReady && !(previousReady.has(0) && previousReady.has(1))) {
              confirmedSlotsRef.current = new Set();
            }
            if (bothReady) {
              const bothConfirmed = confirmedSlotsRef.current.has(0) && confirmedSlotsRef.current.has(1);
              broadcastSelecting(choicesRef.current.red, choicesRef.current.blue, bothConfirmed);
            }
          }
          requestPlayModeStart();
          return;
        }

        if (message.t === "input" && isPlayMode && (message.slot === 0 || message.slot === 1)) {
          const input = touchInput(message.slot);
          const data = message.d || {};
          input.active = true;
          input.vx = Number.isFinite(data.vx) ? data.vx : 0;
          input.vy = Number.isFinite(data.vy) ? data.vy : 0;
          input.shoot = !!data.shoot;
          input.sprint = !!data.sprint;
          if (data.pass) input.pass = true;
          if (data.lob) input.lob = true;
          if (data.switchPlayer) input.switchPlayer = true;
          if (data.tackle) input.tackle = true;
          lastInputAtRef.current.set(message.slot, Date.now());
          return;
        }

        if (message.t === "started") {
          if (startRequestRef.current && message.requestId && message.requestId !== startRequestRef.current) return;
          if (startRetryRef.current) clearTimeout(startRetryRef.current);
          if (message.info) adoptServerInfo(message.info);
          phaseRef.current = "playing";
          setPhase("playing");
          if (!isPlayMode) goToTwoPlayerMatch();
          return;
        }

        if (message.t === "startErr") {
          if (startRetryRef.current) clearTimeout(startRetryRef.current);
          if (message.reason === "already-playing" && message.info && adoptServerInfo(message.info)) {
            phaseRef.current = "playing";
            setPhase("playing");
            if (!isPlayMode) goToTwoPlayerMatch();
            return;
          }
          startedRef.current = false;
          startRequestRef.current = "";
          phaseRef.current = "waiting";
          setPhase("waiting");
          return;
        }

        if (message.t === "padPick") {
          pick(message.slot, message.team);
          return;
        }
        if (message.t === "padConfirm") {
          confirmedSlotsRef.current.add(message.slot);
          if (confirmedSlotsRef.current.has(0) && confirmedSlotsRef.current.has(1)) {
            broadcastSelecting(choicesRef.current.red, choicesRef.current.blue, true);
          }
          return;
        }
        if (
          message.t === "padStartMatch" &&
          confirmedSlotsRef.current.has(0) &&
          confirmedSlotsRef.current.has(1)
        ) confirmTeams();
      },
    });
    lanRef.current = lan;
    lan.setHello(() => ({
      t: "host",
      room: roomRef.current,
      mode: "kiosk",
      hostKey: loadLanHostKey(roomRef.current),
    }));

    const staleInputTimer = setInterval(() => {
      const ready = readySlots(padsRef.current);
      const now = Date.now();
      for (const slot of [0, 1]) {
        if (!isPlayMode || !ready.has(slot)) continue;
        if (now - (lastInputAtRef.current.get(slot) || 0) > 350) neutralize(slot, true);
      }
    }, 100);

    const onEnded = () => {
      if (!isPlayMode) return;
      endedRef.current = true;
      startedRef.current = false;
      phaseRef.current = "waiting";
      setPhase("waiting");
      neutralize(0, false);
      neutralize(1, false);
      lan.send({ t: "ended" });
      setResultCountdown(RESULT_HOLD_SECONDS);
      let remaining = RESULT_HOLD_SECONDS;
      resultTimerRef.current = setInterval(() => {
        remaining -= 1;
        setResultCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(resultTimerRef.current);
          resultTimerRef.current = null;
          goToAttractMatch();
        }
      }, 1000);
    };
    window.addEventListener("ab-match-ended", onEnded);

    const gameKeys = new Set([
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "a", "d", "w", "s", "q", "Shift",
    ]);
    const blockLocalControls = (event) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!isPlayMode || !gameKeys.has(key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", blockLocalControls, true);
    window.addEventListener("keyup", blockLocalControls, true);

    return () => {
      clearInterval(staleInputTimer);
      if (startRetryRef.current) clearTimeout(startRetryRef.current);
      if (resultTimerRef.current) clearInterval(resultTimerRef.current);
      window.removeEventListener("ab-match-ended", onEnded);
      window.removeEventListener("keydown", blockLocalControls, true);
      window.removeEventListener("keyup", blockLocalControls, true);
      neutralize(0, false);
      neutralize(1, false);
      lan.close();
      lanRef.current = null;
    };
  }, []);

  if (!enabled) return null;
  const onlinePads = pads.filter((pad) => pad.ready);
  const online = readySlots(pads);
  const bothReady = online.has(0) && online.has(1);
  const busy = phase === "starting";
  let status = t("lan.dock.waiting");
  if (connection !== "ready") status = t("lan.dock.connecting");
  else if (busy) status = t("lan.dock.starting");
  else if (phase === "playing") status = t("lan.dock.playing");
  else if (selecting) status = t("lan.dock.selecting");
  else if (onlinePads.length === 1) status = t("lan.dock.oneReady");
  else if (onlinePads.length >= 2) status = t("lan.dock.twoReady");
  if (resultCountdown !== null) {
    status = t("lan.dock.resultCountdown", { seconds: Math.max(0, resultCountdown) });
  }

  const showQrDock = (!playMode || resultCountdown !== null) && !selecting;
  return (
    <>
      {selecting && bothReady ? (
        <TeamSelection
          red={redChoice}
          blue={blueChoice}
          busy={busy}
          onRed={(team) => pick(0, team)}
          onBlue={(team) => pick(1, team)}
          onConfirm={confirmTeams}
          t={t}
        />
      ) : null}
      {connection === "ready" && online.has(0) && !online.has(1) && phase !== "playing" ? (
        <div className="lan-p1-toast" role="status">
          <span className="lan-p1-toast__dot" aria-hidden />
          <div className="lan-p1-toast__body">
            <b>{t("lan.p1Toast.ready")}</b>
            <span>{t("lan.p1Toast.scan")}</span>
          </div>
        </div>
      ) : null}
      {showQrDock ? (
        <aside className="lan-qr-dock" aria-live="polite" title={joinUrl || undefined}>
          <div className="lan-qr-dock__qr">
            {qr ? <img src={qr} alt={t("lan.scan")} /> : <span className="lan-qr-dock__spinner" aria-hidden />}
          </div>
          <div className="lan-qr-dock__meta">
            <span className="lan-qr-dock__eyebrow">{t("lan.dock.title")}</span>
            <b>{status}</b>
            <span className="lan-qr-dock__hint">{t("lan.dock.hint")}</span>
            <span className="lan-qr-dock__bottom">
              <code>{room || "...."}</code>
              <span className="lan-qr-dock__players" aria-label={`${onlinePads.length}/2`}>
                <i className={online.has(0) ? "is-ready" : ""}>P1</i>
                <i className={online.has(1) ? "is-ready" : ""}>P2</i>
              </span>
            </span>
          </div>
        </aside>
      ) : null}
    </>
  );
}
