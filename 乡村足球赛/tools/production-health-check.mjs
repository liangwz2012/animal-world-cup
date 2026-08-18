import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";

export const PRODUCTION_ENDPOINTS = Object.freeze({
  config: "https://coaiz.com/rural-football/config/v1",
  leaderboard: "https://coaiz.com/rural-rank/v1/health",
  friend: "wss://coaiz.com/rural-ws",
});

function endpoint(value, secureProtocol, allowInsecure) {
  const url = new URL(String(value || ""));
  const allowed = allowInsecure
    ? new Set([secureProtocol, secureProtocol === "https:" ? "http:" : "ws:"])
    : new Set([secureProtocol]);
  if (!allowed.has(url.protocol)) throw new Error(`健康检查地址必须使用 ${secureProtocol.replace(":", "").toUpperCase()}`);
  return url.href;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  timer.unref?.();
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${new URL(url).pathname} 返回 HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function checkProductionServices(options = {}) {
  const allowInsecure = options.allowInsecure === true;
  const endpoints = { ...PRODUCTION_ENDPOINTS, ...(options.endpoints || {}) };
  const configUrl = endpoint(endpoints.config, "https:", allowInsecure);
  const leaderboardUrl = endpoint(endpoints.leaderboard, "https:", allowInsecure);
  const friendUrl = endpoint(endpoints.friend, "wss:", allowInsecure);
  const config = await fetchJson(configUrl, options);
  if (!config || typeof config !== "object" || !config.features || typeof config.features !== "object") {
    throw new Error("远程配置响应结构无效");
  }
  const leaderboard = await fetchJson(leaderboardUrl, options);
  if (!leaderboard?.ok || leaderboard.service !== "rural-football-leaderboard") {
    throw new Error("排行榜健康响应无效");
  }
  await new Promise((resolve, reject) => {
    const ws = new (options.WebSocketImpl || WebSocket)(friendUrl);
    const timer = setTimeout(() => {
      try { ws.terminate?.(); } catch {}
      reject(new Error("好友房间 WebSocket 连接超时"));
    }, options.timeoutMs || 5000);
    timer.unref?.();
    ws.once("open", () => {
      clearTimeout(timer);
      try { ws.close(1000, "health-check"); } catch {}
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`好友房间 WebSocket 不可用：${error && error.message || "连接失败"}`));
    });
  });
  return {
    ok: true,
    config: { url: configUrl, features: config.features },
    leaderboard: { url: leaderboardUrl, service: leaderboard.service },
    friend: { url: friendUrl, connected: true },
  };
}

async function main() {
  const result = await checkProductionServices();
  console.info(JSON.stringify(result, null, 2));
  console.info("[health:production] PASS：配置、排行榜和好友房间三个正式入口可连接");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[health:production] FAIL：${error && error.message || error}`);
    process.exitCode = 1;
  });
}

