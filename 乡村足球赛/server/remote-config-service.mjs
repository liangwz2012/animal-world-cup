import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { normalizeRegionalShareFeature, normalizeRuralLeaderboardFeature } = require("../src/data/remote-feature-contracts");

const MAX_CONFIG_BYTES = 64 * 1024;

export const SAFE_DEFAULT_CONFIG = Object.freeze({
  version: 1,
  teams: [],
  features: {
    leaderboard: { enabled: false, apiUrl: "" },
    friend: { enabled: false, wssUrl: "" },
    captainAvatarCustomization: { enabled: false, apiUrl: "" },
    ruralLeaderboard: normalizeRuralLeaderboardFeature(null),
    regionalShare: normalizeRegionalShareFeature(null),
    monetization: {
      enabled: false,
      playGateEnabled: false,
      adUnlockEnabled: false,
      rewardedAdUnitId: "",
      freeMatchesPerDay: 2,
      singleUnlockMatches: 1,
      dayPassThreshold: 5,
      shareTitle: "",
    },
    dailyTasks: { enabled: false, tasks: [] },
    penaltyShootout: { enabled: false, rounds: 5 },
    regionHonorBoard: { enabled: false, scopes: [] },
    regionRivalry: { enabled: false, settleDayOfWeek: 0, rewardTitle: "" },
    playerCodex: { enabled: false },
    spectateCheer: { enabled: false, presets: [] },
    challengeCard: { enabled: false, title: "" },
    home: { honorCard: false, rivalryBanner: false, taskStrip: false },
    weather: { enabled: false, types: [], probability: 0 },
    tournament: { enabled: false, title: "", format: "knockout", rounds: 3 },
    seasonPass: { enabled: false, days: 30 },
    achievements: { enabled: false, list: [] },
    highlights: { enabled: false },
    dialectPack: { enabled: false, pack: "" },
    feedback: { enabled: false },
    experiments: {},
    customModules: {},
  },
  announcement: { text: "", level: "info" },
  maintenance: { onlineBlocked: false, message: "", minClientVersion: "" },
  events: [],
});

const TASK_KINDS = Object.freeze(["play_matches", "score_goals", "win_matches", "watch_match"]);
const BOARD_SCOPES = Object.freeze(["nation", "province", "city", "county"]);
const ANNOUNCEMENT_LEVELS = Object.freeze(["info", "warn", "urgent"]);
const WEATHER_TYPES = Object.freeze(["rain", "mud", "snow", "heat"]);
const TOURNAMENT_FORMATS = Object.freeze(["knockout", "league"]);
const EVENT_KINDS = Object.freeze(["festival", "cup", "rivalry", "custom"]);
const FORBIDDEN_MAP_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

function safeText(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function clampInt(value, min, max, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function safeTasks(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map((item) => {
    if (!plainObject(item)) return null;
    const id = safeText(item.id, 32);
    const kind = safeText(item.kind, 24);
    if (!id || !TASK_KINDS.includes(kind)) return null;
    return { id, kind, target: clampInt(item.target, 1, 99, 1), reward: safeText(item.reward, 32) };
  }).filter(Boolean);
}

function safeCheerPresets(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map((item) => {
    if (!plainObject(item)) return null;
    const icon = safeText(item.icon, 4);
    const text = safeText(item.text, 8);
    if (!icon || !text) return null;
    return { icon, text };
  }).filter(Boolean);
}

function safeAchievements(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 32).map((item) => {
    if (!plainObject(item)) return null;
    const id = safeText(item.id, 32);
    const title = safeText(item.title, 24);
    if (!id || !title) return null;
    return { id, title, desc: safeText(item.desc, 60), target: clampInt(item.target, 1, 9999, 1) };
  }).filter(Boolean);
}

function safeEvents(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 8).map((item) => {
    if (!plainObject(item)) return null;
    const id = safeText(item.id, 24);
    const title = safeText(item.title, 30);
    const kind = safeText(item.kind, 16);
    if (!id || !title || !EVENT_KINDS.includes(kind)) return null;
    return {
      id,
      title,
      kind,
      startAt: clampInt(item.startAt, 0, 4100000000000, 0),
      endAt: clampInt(item.endAt, 0, 4100000000000, 0),
    };
  }).filter(Boolean);
}

function safeExperiments(input) {
  if (!plainObject(input)) return {};
  const output = {};
  for (const key of Object.keys(input).slice(0, 8)) {
    if (!/^[a-z0-9_]{2,32}$/.test(key) || FORBIDDEN_MAP_KEYS.includes(key)) continue;
    const variant = safeText(input[key], 24);
    if (variant) output[key] = variant;
  }
  return output;
}

function safeCustomModules(input) {
  if (!plainObject(input)) return {};
  const output = {};
  for (const name of Object.keys(input).slice(0, 16)) {
    if (!/^[a-z0-9_]{2,32}$/.test(name) || FORBIDDEN_MAP_KEYS.includes(name)) continue;
    const entry = plainObject(input[name]) ? input[name] : {};
    output[name] = { enabled: !!entry.enabled, note: safeText(entry.note, 100) };
  }
  return output;
}

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

function publicHttpsUrl(value) {
  const url = secureUrl(value, "https");
  if (!url || /^https:\/\/(?:localhost|127(?:\.\d{1,3}){3})(?::|\/|$)/i.test(url)) return "";
  return url;
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
  const captainAvatarCustomization = plainObject(features.captainAvatarCustomization) ? features.captainAvatarCustomization : {};
  const ruralLeaderboard = plainObject(features.ruralLeaderboard) ? features.ruralLeaderboard : {};
  const regionalShare = plainObject(features.regionalShare) ? features.regionalShare : {};
  const monetization = plainObject(features.monetization) ? features.monetization : {};
  const dailyTasks = plainObject(features.dailyTasks) ? features.dailyTasks : {};
  const penaltyShootout = plainObject(features.penaltyShootout) ? features.penaltyShootout : {};
  const regionHonorBoard = plainObject(features.regionHonorBoard) ? features.regionHonorBoard : {};
  const regionRivalry = plainObject(features.regionRivalry) ? features.regionRivalry : {};
  const playerCodex = plainObject(features.playerCodex) ? features.playerCodex : {};
  const spectateCheer = plainObject(features.spectateCheer) ? features.spectateCheer : {};
  const challengeCard = plainObject(features.challengeCard) ? features.challengeCard : {};
  const home = plainObject(features.home) ? features.home : {};
  const weather = plainObject(features.weather) ? features.weather : {};
  const tournament = plainObject(features.tournament) ? features.tournament : {};
  const seasonPass = plainObject(features.seasonPass) ? features.seasonPass : {};
  const achievements = plainObject(features.achievements) ? features.achievements : {};
  const highlights = plainObject(features.highlights) ? features.highlights : {};
  const dialectPack = plainObject(features.dialectPack) ? features.dialectPack : {};
  const feedback = plainObject(features.feedback) ? features.feedback : {};
  const apiUrl = secureUrl(leaderboard.apiUrl, "https");
  const wssUrl = secureUrl(friend.wssUrl, "wss");
  const captainAvatarApiUrl = publicHttpsUrl(captainAvatarCustomization.apiUrl);
  const adUnitId = typeof monetization.rewardedAdUnitId === "string"
    && /^adunit-[A-Za-z0-9_-]{6,128}$/.test(monetization.rewardedAdUnitId.trim())
    ? monetization.rewardedAdUnitId.trim()
    : "";
  const adEnabled = !!monetization.enabled && !!monetization.playGateEnabled
    && !!monetization.adUnlockEnabled && !!adUnitId;
  const announcement = plainObject(source.announcement) ? source.announcement : {};
  const maintenance = plainObject(source.maintenance) ? source.maintenance : {};
  return {
    version: Math.max(1, Math.floor(Number(source.version) || 1)),
    teams: safeTeams(source.teams),
    features: {
      leaderboard: { enabled: !!leaderboard.enabled && !!apiUrl, apiUrl: !!leaderboard.enabled && apiUrl ? apiUrl : "" },
      friend: { enabled: !!friend.enabled && !!wssUrl, wssUrl: !!friend.enabled && wssUrl ? wssUrl : "" },
      captainAvatarCustomization: {
        enabled: !!captainAvatarCustomization.enabled && !!captainAvatarApiUrl,
        apiUrl: !!captainAvatarCustomization.enabled && captainAvatarApiUrl ? captainAvatarApiUrl : "",
      },
      ruralLeaderboard: normalizeRuralLeaderboardFeature(ruralLeaderboard),
      regionalShare: normalizeRegionalShareFeature(regionalShare),
      monetization: {
        enabled: adEnabled,
        playGateEnabled: adEnabled,
        adUnlockEnabled: adEnabled,
        rewardedAdUnitId: adEnabled ? adUnitId : "",
        freeMatchesPerDay: clampInt(monetization.freeMatchesPerDay, 0, 20, 2),
        singleUnlockMatches: clampInt(monetization.singleUnlockMatches, 1, 10, 1),
        dayPassThreshold: clampInt(monetization.dayPassThreshold, 2, 20, 5),
        shareTitle: safeText(monetization.shareTitle, 40),
      },
      dailyTasks: { enabled: !!dailyTasks.enabled, tasks: safeTasks(dailyTasks.tasks) },
      penaltyShootout: { enabled: !!penaltyShootout.enabled, rounds: clampInt(penaltyShootout.rounds, 3, 7, 5) },
      regionHonorBoard: {
        enabled: !!regionHonorBoard.enabled,
        scopes: Array.isArray(regionHonorBoard.scopes)
          ? regionHonorBoard.scopes.filter((scope) => BOARD_SCOPES.includes(scope)).slice(0, 4)
          : [],
      },
      regionRivalry: {
        enabled: !!regionRivalry.enabled,
        settleDayOfWeek: clampInt(regionRivalry.settleDayOfWeek, 0, 6, 0),
        rewardTitle: safeText(regionRivalry.rewardTitle, 24),
      },
      playerCodex: { enabled: !!playerCodex.enabled },
      spectateCheer: { enabled: !!spectateCheer.enabled, presets: safeCheerPresets(spectateCheer.presets) },
      challengeCard: { enabled: !!challengeCard.enabled, title: safeText(challengeCard.title, 30) },
      home: {
        honorCard: !!home.honorCard,
        rivalryBanner: !!home.rivalryBanner,
        taskStrip: !!home.taskStrip,
      },
      weather: {
        enabled: !!weather.enabled,
        types: Array.isArray(weather.types) ? weather.types.filter((type) => WEATHER_TYPES.includes(type)).slice(0, 4) : [],
        probability: clampInt(weather.probability, 0, 100, 0),
      },
      tournament: {
        enabled: !!tournament.enabled,
        title: safeText(tournament.title, 30),
        format: TOURNAMENT_FORMATS.includes(tournament.format) ? tournament.format : "knockout",
        rounds: clampInt(tournament.rounds, 2, 6, 3),
      },
      seasonPass: { enabled: !!seasonPass.enabled, days: clampInt(seasonPass.days, 7, 90, 30) },
      achievements: { enabled: !!achievements.enabled, list: safeAchievements(achievements.list) },
      highlights: { enabled: !!highlights.enabled },
      dialectPack: { enabled: !!dialectPack.enabled, pack: safeText(dialectPack.pack, 24) },
      feedback: { enabled: !!feedback.enabled },
      experiments: safeExperiments(features.experiments),
      customModules: safeCustomModules(features.customModules),
    },
    announcement: {
      text: safeText(announcement.text, 100),
      level: ANNOUNCEMENT_LEVELS.includes(announcement.level) ? announcement.level : "info",
    },
    maintenance: {
      onlineBlocked: !!maintenance.onlineBlocked,
      message: safeText(maintenance.message, 100),
      minClientVersion: safeText(maintenance.minClientVersion, 16),
    },
    events: safeEvents(source.events),
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
