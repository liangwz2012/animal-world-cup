"use client";

// Tiny reconnecting WebSocket client for the LAN relay (script/lan-server.mjs).
// Shared by the lobby (host), the phone controller (pad), and the in-match host
// bridge. The relay always lives on port 13001 of whatever host served this
// page — so the phone that opened http://<lan-ip>:13000/pad talks to
// ws://<lan-ip>:13001 with no extra config.
//
// Usage:
//   const lan = createLanClient({ onMessage, onOpen, onClose });
//   lan.send({ t: "host", room });
//   lan.close();

export const LAN_PORT = 13001;

export function lanWsUrl() {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname || "127.0.0.1";
  return `ws://${host}:${LAN_PORT}`;
}

export function createLanClient({ onMessage, onOpen, onClose } = {}) {
  let ws = null;
  let closed = false;
  let retry = 0;
  let retryTimer = null;
  let generation = 0;
  let helloFn = null; // re-sent on every (re)connect so the relay re-attaches us

  function connect() {
    if (closed) return;
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    const url = lanWsUrl();
    if (!url) return;
    const currentGeneration = ++generation;
    try {
      ws = new WebSocket(url);
    } catch {
      schedule();
      return;
    }
    ws.onopen = () => {
      if (currentGeneration !== generation) return;
      retry = 0;
      if (helloFn) {
        try { ws.send(JSON.stringify(helloFn())); } catch {}
      }
      onOpen && onOpen();
    };
    ws.onmessage = (ev) => {
      if (currentGeneration !== generation) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage && onMessage(msg);
    };
    ws.onclose = () => {
      if (currentGeneration !== generation) return;
      ws = null;
      onClose && onClose();
      if (!closed) schedule();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function schedule() {
    if (closed || retryTimer) return;
    retry = Math.min(retry + 1, 6);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, 300 * retry); // 0.3s..1.8s backoff
  }

  connect();

  return {
    // hello: a function returning the (re)attach message — stored so reconnects
    // re-announce identity (host re-attaches to its room; pad re-joins).
    setHello(fn) { helloFn = fn; if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(fn())); } catch {} } },
    send(obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch {} } },
    close() {
      closed = true;
      generation += 1;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (ws) try { ws.close(); } catch {}
      ws = null;
    },
    get ready() { return !!ws && ws.readyState === 1; },
  };
}
