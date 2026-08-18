import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_CONFIG_BYTES = 64 * 1024;

export const SAFE_DEFAULT_CONFIG = Object.freeze({
  version: 1,
  teams: [],
  features: {
    leaderboard: { enabled: false, apiUrl: "" },
    friend: { enabled: false, wssUrl: "" },
    monetization: { enabled: false, playGateEnabled: false, adUnlockEnabled: false, rewardedAdUnitId: "" },
  },
});

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function secureUrl(value, protocol) {
  const raw = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (!raw || raw.length > 512) return "";
  const expression = protocol === "wss"
    ? /^wss:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?$/i
    : /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?$/i;
  return expression.test(raw) ? raw : "";
}

function safeTeams(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((team) => plainObject(team) && typeof team.id === "string" && /^[a-z0-9_-]{2,32}$/i.test(team.id))
    .slice(0, 32)
    .map((team) => ({
      id: team.id,
      name: typeof team.name === "string" ? team.name.slice(0, 16) : undefined,
      country: typeof team.country === "string" ? team.country.slice(0, 16) : undefined,
      color: typeof team.color === "string" && /^#[0-9a-f]{6}$/i.test(team.color) ? team.color : undefined,
      enabled: typeof team.enabled === "boolean" ? team.enabled : undefined,
      order: Number.isFinite(Number(team.order)) ? Math.max(-99, Math.min(99, Math.floor(Number(team.order)))) : undefined,
    }));
}

export function normalizeRemoteConfig(input) {
  const source = plainObject(input) ? input : {};
  const features = plainObject(source.features) ? source.features : {};
  const leaderboard = plainObject(features.leaderboard) ? features.leaderboard : {};
  const friend = plainObject(features.friend) ? features.friend : {};
  const monetization = plainObject(features.monetization) ? features.monetization : {};
  const apiUrl = secureUrl(leaderboard.apiUrl, "https");
  const wssUrl = secureUrl(friend.wssUrl, "wss");
  const adUnitId = typeof monetization.rewardedAdUnitId === "string"
    && /^adunit-[A-Za-z0-9_-]{6,128}$/.test(monetization.rewardedAdUnitId.trim())
    ? monetization.rewardedAdUnitId.trim()
    : "";
  const adEnabled = !!monetization.enabled && !!monetization.playGateEnabled
    && !!monetization.adUnlockEnabled && !!adUnitId;
  return {
    version: Math.max(1, Math.floor(Number(source.version) || 1)),
    teams: safeTeams(source.teams),
    features: {
      leaderboard: { enabled: !!leaderboard.enabled && !!apiUrl, apiUrl: !!leaderboard.enabled && apiUrl ? apiUrl : "" },
      friend: { enabled: !!friend.enabled && !!wssUrl, wssUrl: !!friend.enabled && wssUrl ? wssUrl : "" },
      monetization: {
        enabled: adEnabled,
        playGateEnabled: adEnabled,
        adUnlockEnabled: adEnabled,
        rewardedAdUnitId: adEnabled ? adUnitId : "",
      },
    },
  };
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

export class RemoteConfigStore {
  constructor(options = {}) {
    this.file = options.file || "";
    this.fallback = normalizeRemoteConfig(options.fallback || SAFE_DEFAULT_CONFIG);
  }

  async read() {
    if (!this.file) return this.fallback;
    try {
      const stat = await fs.stat(this.file);
      if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return this.fallback;
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      return normalizeRemoteConfig(parsed);
    } catch (error) {
      return this.fallback;
    }
  }
}

export class RemoteConfigService {
  constructor(options = {}) {
    this.host = options.host || "127.0.0.1";
    this.port = Number(options.port ?? 8789);
    this.store = options.store || new RemoteConfigStore({ file: options.dataFile });
    this.server = null;
  }

  async listen() {
    if (this.server) return this;
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch(() => sendJson(response, 500, { ok: false, code: "SERVER_ERROR" }));
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, resolve);
    });
    return this;
  }

  async close() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }

  url() {
    const address = this.server && this.server.address();
    if (!address || typeof address === "string") return "";
    const host = address.address === "::" || address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
    return `http://${host}:${address.port}`;
  }

  async handle(request, response) {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "rural-football-remote-config" });
    }
    if (request.method === "GET" && url.pathname === "/v1") {
      return sendJson(response, 200, await this.store.read());
    }
    return sendJson(response, 404, { ok: false, code: "NOT_FOUND" });
  }
}

export async function createRemoteConfigService(options = {}) {
  return new RemoteConfigService(options).listen();
}

async function main() {
  const service = await createRemoteConfigService({
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 8789),
    dataFile: process.env.REMOTE_CONFIG_FILE || path.resolve(process.cwd(), "server/data/remote-config.json"),
  });
  console.info(`[remote-config] listening on ${service.url()}`);
  const stop = async () => { await service.close(); process.exit(0); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[remote-config] fatal", error);
    process.exitCode = 1;
  });
}
