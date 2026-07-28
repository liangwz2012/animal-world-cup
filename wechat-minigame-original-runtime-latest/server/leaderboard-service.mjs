import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createWxCodeVerifier } from "./wx-auth.mjs";

const MAX_BODY_BYTES = 32 * 1024;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_RANK_MATCHES = 5;
const METRICS = new Set(["points", "wins", "goals", "winRate", "cleanSheets", "streak"]);

function safeText(value, max = 32) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f]/g, "").slice(0, max) : "";
}

function safeAvatar(value) {
  const url = safeText(value, 1024);
  return /^https:\/\//i.test(url) ? url : "";
}

function whole(value, min = 0, max = 1_000_000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function blankStats() {
  return {
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    cleanSheets: 0,
    points: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    updatedAt: 0,
  };
}

function normalizeStats(input) {
  const source = input && typeof input === "object" ? input : {};
  const stats = blankStats();
  for (const key of Object.keys(stats)) stats[key] = Math.max(0, Math.floor(Number(source[key]) || 0));
  stats.matches = Math.max(stats.matches, stats.wins + stats.draws + stats.losses);
  stats.points = Math.max(stats.points, stats.wins * 3 + stats.draws);
  stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak);
  return stats;
}

function metricValue(stats, metric) {
  if (metric === "wins") return stats.wins;
  if (metric === "goals") return stats.goalsFor;
  if (metric === "winRate") return stats.matches ? Math.round(stats.wins * 1000 / stats.matches) / 10 : 0;
  if (metric === "cleanSheets") return stats.cleanSheets;
  if (metric === "streak") return stats.bestWinStreak;
  return stats.points;
}

function profileView(player) {
  return {
    nickname: player.profile.nickname,
    avatarUrl: player.profile.avatarUrl,
  };
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("请求体过大"), { statusCode: 413, code: "PAYLOAD_TOO_LARGE" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求体必须为对象");
    return value;
  } catch (error) {
    throw Object.assign(new Error("请求体不是合法 JSON"), { statusCode: 400, code: "INVALID_JSON" });
  }
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function apiError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export class LeaderboardStore {
  constructor(options = {}) {
    this.file = options.file || "";
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.data = { version: 1, players: {}, receipts: {} };
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (!this.file) return this;
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      this.data = {
        version: 1,
        players: parsed && parsed.players && typeof parsed.players === "object" ? parsed.players : {},
        receipts: parsed && parsed.receipts && typeof parsed.receipts === "object" ? parsed.receipts : {},
      };
      for (const [id, player] of Object.entries(this.data.players)) this.data.players[id] = this.normalizePlayer(player);
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
    }
    return this;
  }

  normalizePlayer(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      profile: {
        nickname: safeText(source.profile && source.profile.nickname),
        avatarUrl: safeAvatar(source.profile && source.profile.avatarUrl),
        consentedAt: Math.max(0, Math.floor(Number(source.profile && source.profile.consentedAt) || 0)),
      },
      stats: normalizeStats(source.stats),
    };
  }

  player(userId) {
    const id = String(userId || "");
    if (!id || id.length > 160) throw apiError(401, "AUTH_INVALID", "登录身份无效");
    if (!this.data.players[id]) this.data.players[id] = this.normalizePlayer({});
    return this.data.players[id];
  }

  async persist() {
    if (!this.file) return;
    const content = JSON.stringify(this.data);
    const target = this.file;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(temporary, content, "utf8");
      await fs.rename(temporary, target);
    });
    return this.writeQueue;
  }

  async setProfile(userId, input) {
    const nickname = safeText(input && (input.nickname || input.nickName));
    const avatarUrl = safeAvatar(input && input.avatarUrl);
    if (!nickname) throw apiError(400, "PROFILE_NICKNAME_REQUIRED", "请授权有效的微信昵称后再加入排行榜");
    if (!avatarUrl) throw apiError(400, "PROFILE_AVATAR_REQUIRED", "请授权有效的微信头像后再加入排行榜");
    const player = this.player(userId);
    player.profile = { nickname, avatarUrl, consentedAt: this.now() };
    await this.persist();
    return profileView(player);
  }

  async recordResult(userId, input) {
    const source = input && typeof input === "object" ? input : {};
    const matchId = safeText(source.matchId, 128);
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(matchId)) throw apiError(400, "MATCH_ID_INVALID", "比赛编号格式无效");
    const score = source.score;
    if (!score || typeof score !== "object" || Array.isArray(score)) throw apiError(400, "SCORE_INVALID", "比分格式无效");
    const mine = whole(score.mine, 0, 99);
    const opponent = whole(score.opponent, 0, 99);
    if (mine == null || opponent == null) throw apiError(400, "SCORE_INVALID", "比分必须为 0 到 99 的整数");
    const player = this.player(userId);
    if (!player.profile.nickname || !player.profile.avatarUrl) {
      throw apiError(403, "PROFILE_REQUIRED", "请先授权昵称和头像后再提交榜单成绩");
    }
    const receiptKey = `${userId}:${matchId}`;
    if (this.data.receipts[receiptKey]) return { duplicate: true, stats: normalizeStats(player.stats) };
    const stats = normalizeStats(player.stats);
    stats.matches += 1;
    stats.goalsFor += mine;
    stats.goalsAgainst += opponent;
    if (opponent === 0) stats.cleanSheets += 1;
    if (mine > opponent) {
      stats.wins += 1;
      stats.points += 3;
      stats.currentWinStreak += 1;
      stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak);
    } else if (mine === opponent) {
      stats.draws += 1;
      stats.points += 1;
      stats.currentWinStreak = 0;
    } else {
      stats.losses += 1;
      stats.currentWinStreak = 0;
    }
    stats.updatedAt = this.now();
    player.stats = stats;
    this.data.receipts[receiptKey] = stats.updatedAt;
    await this.persist();
    return { duplicate: false, stats: normalizeStats(stats) };
  }

  async deletePlayer(userId) {
    const id = String(userId || "");
    this.player(id); // 统一校验身份格式；即使尚无档案也可安全完成删除请求。
    delete this.data.players[id];
    for (const key of Object.keys(this.data.receipts)) {
      if (key.startsWith(`${id}:`)) delete this.data.receipts[key];
    }
    await this.persist();
  }

  rows(metric, userId = "") {
    const selectedMetric = METRICS.has(metric) ? metric : "points";
    const players = Object.entries(this.data.players)
      .map(([id, player]) => [id, this.normalizePlayer(player)])
      .filter(([, player]) => player.profile.nickname && player.profile.avatarUrl && player.stats.matches >= MIN_RANK_MATCHES)
      .sort(([, a], [, b]) => metricValue(b.stats, selectedMetric) - metricValue(a.stats, selectedMetric)
        || b.stats.points - a.stats.points
        || a.stats.updatedAt - b.stats.updatedAt);
    const all = players.map(([id, player], index) => ({
      rank: index + 1,
      self: id === userId,
      ...profileView(player),
      value: metricValue(player.stats, selectedMetric),
      stats: {
        matches: player.stats.matches,
        wins: player.stats.wins,
        goalsFor: player.stats.goalsFor,
        points: player.stats.points,
      },
    }));
    return { metric: selectedMetric, rows: all.slice(0, 50), self: all.find((row) => row.self) || null };
  }
}

export class LeaderboardService {
  constructor(options = {}) {
    this.host = options.host || "127.0.0.1";
    this.port = Number(options.port ?? 8788);
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.store = options.store || new LeaderboardStore({ file: options.dataFile, now: this.now });
    this.verifyWxCode = options.verifyWxCode || createWxCodeVerifier(options.wx || {});
    this.sessions = new Map();
    this.server = null;
  }

  async listen() {
    if (this.server) return this;
    await this.store.load();
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        sendJson(response, error && error.statusCode || 500, {
          ok: false,
          code: error && error.code || "SERVER_ERROR",
          message: error && error.message || "榜单服务暂时不可用",
        });
      });
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
    return `http://${host}:${address.port}/v1`;
  }

  session(request) {
    const header = String(request.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const session = token && this.sessions.get(token);
    if (!session || session.expiresAt <= this.now()) {
      if (token) this.sessions.delete(token);
      throw apiError(401, "SESSION_EXPIRED", "登录已过期，请静默重新登录");
    }
    return session;
  }

  async handle(request, response) {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/v1/health") {
      return sendJson(response, 200, { ok: true, service: "animal-football-leaderboard" });
    }
    if (request.method === "POST" && url.pathname === "/v1/auth") {
      const body = await readJsonBody(request);
      const code = safeText(body.code, 256);
      if (!code) throw apiError(400, "AUTH_CODE_REQUIRED", "缺少 wx.login code");
      const verified = await this.verifyWxCode(code);
      const userId = safeText(verified && verified.userId, 160);
      if (!userId) throw apiError(401, "AUTH_REJECTED", "微信登录验证失败");
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = this.now() + SESSION_TTL_MS;
      this.sessions.set(token, { userId, expiresAt });
      const player = this.store.player(userId);
      return sendJson(response, 200, { ok: true, token, expiresAt, profile: profileView(player), stats: normalizeStats(player.stats) });
    }
    if (request.method === "PUT" && url.pathname === "/v1/profile") {
      const body = await readJsonBody(request);
      const session = this.session(request);
      const profile = await this.store.setProfile(session.userId, body);
      return sendJson(response, 200, { ok: true, profile });
    }
    if (request.method === "POST" && url.pathname === "/v1/results") {
      const body = await readJsonBody(request);
      const session = this.session(request);
      const result = await this.store.recordResult(session.userId, body);
      return sendJson(response, 200, { ok: true, ...result });
    }
    if (request.method === "DELETE" && url.pathname === "/v1/account") {
      const session = this.session(request);
      await this.store.deletePlayer(session.userId);
      for (const [token, value] of this.sessions) {
        if (value.userId === session.userId) this.sessions.delete(token);
      }
      return sendJson(response, 200, { ok: true, deleted: true });
    }
    if (request.method === "GET" && url.pathname === "/v1/leaderboards") {
      const header = String(request.headers.authorization || "");
      let userId = "";
      if (header) userId = this.session(request).userId;
      return sendJson(response, 200, { ok: true, ...this.store.rows(url.searchParams.get("metric"), userId) });
    }
    throw apiError(404, "NOT_FOUND", "接口不存在");
  }
}

export async function createLeaderboardService(options = {}) {
  return new LeaderboardService(options).listen();
}

async function main() {
  const service = await createLeaderboardService({
    host: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 8788),
    dataFile: process.env.RANK_DATA_FILE || path.resolve(process.cwd(), "server/data/leaderboard.json"),
  });
  console.info(`[leaderboard] listening on ${service.url()}`);
  const stop = async () => { await service.close(); process.exit(0); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[leaderboard] fatal", error);
    process.exitCode = 1;
  });
}
