import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createWxCodeVerifier } from "./wx-auth.mjs";
import { createWxTextSecurityChecker } from "./wx-content-security.mjs";

const require = createRequire(import.meta.url);
const {
  createRegionalTeam,
  regionMatchesScope,
  regionalTeamKey,
  snapshotRegion,
  validScopeKey,
} = require("../src/data/region-league.js");
const { mergeRegionalSeedRows } = require("../src/data/leaderboard-seeds.js");

const MAX_BODY_BYTES = 32 * 1024;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RANKED_MATCH_TTL_MS = 30 * 60 * 1000;
const MIN_RANKED_SETTLE_DELAY_MS = 8 * 1000;
const MIN_RANK_MATCHES = 5;
const METRICS = new Set(["points", "goals", "winRate"]);
const TEAM_IDS = new Set(["england", "france", "germany", "spain", "portugal", "brazil", "argentina", "usa"]);
const FORMATION_IDS = new Set(["2-3-1", "3-2-1", "2-2-2", "3-1-2", "1-3-2", "2-1-3"]);
const DEFAULT_RATE_LIMITS = Object.freeze({
  auth: Object.freeze({ limit: 30, windowMs: 60_000 }),
  profile: Object.freeze({ limit: 12, windowMs: 60_000 }),
  region: Object.freeze({ limit: 30, windowMs: 60_000 }),
  rankedIssue: Object.freeze({ limit: 60, windowMs: 60_000 }),
  rankedSettle: Object.freeze({ limit: 60, windowMs: 60_000 }),
  accountDelete: Object.freeze({ limit: 5, windowMs: 60 * 60_000 }),
  leaderboardRead: Object.freeze({ limit: 180, windowMs: 60_000 }),
});

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

function rankedRules(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const redTeam = safeText(source.redTeam, 24);
  const blueTeam = safeText(source.blueTeam, 24);
  const redFormation = safeText(source.redFormation, 16);
  const blueFormation = safeText(source.blueFormation, 16);
  const ai = whole(source.ai, 0, 2);
  const time = whole(source.time, 4, 10);
  if (!TEAM_IDS.has(redTeam) || !TEAM_IDS.has(blueTeam) || redTeam === blueTeam
    || !FORMATION_IDS.has(redFormation) || !FORMATION_IDS.has(blueFormation)
    || ai == null || ![4, 6, 10].includes(time)) {
    throw apiError(400, "RANKED_RULES_INVALID", "排位赛规则不在已审核范围内");
  }
  return { redTeam, blueTeam, redFormation, blueFormation, ai, time, mode: "ai" };
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

function regionView(player) {
  return snapshotRegion(player && player.region);
}

function mergeTeamStats(target, stats) {
  const source = normalizeStats(stats);
  target.matches += source.matches;
  target.wins += source.wins;
  target.draws += source.draws;
  target.losses += source.losses;
  target.goalsFor += source.goalsFor;
  target.goalsAgainst += source.goalsAgainst;
  target.cleanSheets += source.cleanSheets;
  target.points += source.points;
  // 地区队“最佳连胜”取成员最佳成绩，不能把不连续的个人连胜相加伪造成队伍连胜。
  target.bestWinStreak = Math.max(target.bestWinStreak, source.bestWinStreak);
  target.updatedAt = Math.max(target.updatedAt, source.updatedAt);
  return target;
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

function sendJson(response, statusCode, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extraHeaders,
  });
  response.end(body);
}

function apiError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function rateLimitConfig(input, fallback) {
  const source = input && typeof input === "object" ? input : {};
  return {
    limit: Math.max(1, Math.floor(Number(source.limit ?? fallback.limit))),
    windowMs: Math.max(1000, Math.floor(Number(source.windowMs ?? fallback.windowMs))),
  };
}

export class FixedWindowRateLimiter {
  constructor(options = {}) {
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.buckets = new Map();
    this.operations = 0;
  }

  consume(key, config) {
    const now = this.now();
    const bucketKey = String(key || "anonymous");
    let bucket = this.buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + config.windowMs };
      this.buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    this.operations += 1;
    if (this.operations % 256 === 0) {
      for (const [id, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(id);
      }
    }
    return {
      allowed: bucket.count <= config.limit,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
}

function mapContentSecurityError(error) {
  const code = String(error && error.code || "CONTENT_CHECK_UPSTREAM");
  const rejected = code === "CONTENT_CHECK_REJECTED" || code === "INVALID_USER_TEXT";
  return apiError(rejected ? 422 : 503, code, error && error.message || "昵称内容安全检查暂时不可用");
}

export class LeaderboardStore {
  constructor(options = {}) {
    this.file = options.file || "";
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.data = { version: 2, players: {}, receipts: {}, rankedMatches: {} };
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (!this.file) return this;
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      this.data = {
        version: 2,
        players: parsed && parsed.players && typeof parsed.players === "object" ? parsed.players : {},
        receipts: parsed && parsed.receipts && typeof parsed.receipts === "object" ? parsed.receipts : {},
        rankedMatches: parsed && parsed.rankedMatches && typeof parsed.rankedMatches === "object" ? parsed.rankedMatches : {},
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
      region: snapshotRegion(source.region),
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

  async setRegion(userId, input) {
    const player = this.player(userId);
    if (!player.profile.nickname || !player.profile.avatarUrl) {
      throw apiError(403, "PROFILE_REQUIRED", "请先主动加入排行榜，再选择你的地区战队");
    }
    let region;
    try {
      region = await createRegionalTeam(input);
    } catch (error) {
      throw apiError(400, "REGION_INVALID", error && error.message || "地区战队信息无效");
    }
    player.region = region;
    await this.persist();
    return regionView(player);
  }

  cleanupRankedMatches() {
    const cutoff = this.now() - RANKED_MATCH_TTL_MS;
    for (const [id, match] of Object.entries(this.data.rankedMatches)) {
      const expiresAt = Math.floor(Number(match && match.expiresAt) || 0);
      const settledAt = Math.floor(Number(match && match.settledAt) || 0);
      if ((!settledAt && expiresAt < cutoff) || (settledAt && settledAt < cutoff)) delete this.data.rankedMatches[id];
    }
  }

  async issueRankedMatch(userId, input) {
    const player = this.player(userId);
    if (!player.profile.nickname || !player.profile.avatarUrl) {
      throw apiError(403, "PROFILE_REQUIRED", "请先主动加入排行榜");
    }
    if (!regionView(player)) throw apiError(403, "REGION_REQUIRED", "请先选择地区战队");
    const rules = rankedRules(input && (input.config || input));
    this.cleanupRankedMatches();
    const issuedAt = this.now();
    const id = `rank_${crypto.randomBytes(18).toString("base64url")}`;
    this.data.rankedMatches[id] = {
      id,
      userId,
      issuedAt,
      earliestSubmitAt: issuedAt + MIN_RANKED_SETTLE_DELAY_MS,
      expiresAt: issuedAt + RANKED_MATCH_TTL_MS,
      settledAt: 0,
      rules,
    };
    await this.persist();
    return { id, issuedAt, expiresAt: issuedAt + RANKED_MATCH_TTL_MS, rules };
  }

  async settleRankedMatch(userId, matchIdInput, input) {
    const source = input && typeof input === "object" ? input : {};
    const matchId = safeText(matchIdInput || source.matchId, 128);
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(matchId)) throw apiError(400, "MATCH_ID_INVALID", "比赛编号格式无效");
    const signed = this.data.rankedMatches[matchId];
    if (!signed || signed.userId !== userId) throw apiError(404, "RANKED_MATCH_NOT_FOUND", "排位赛凭证不存在或不属于当前玩家");
    if (signed.settledAt) return { duplicate: true, stats: normalizeStats(this.player(userId).stats) };
    const submittedAt = this.now();
    if (submittedAt < signed.earliestSubmitAt) throw apiError(409, "RANKED_MATCH_TOO_EARLY", "比赛尚未达到可结算时间");
    if (submittedAt > signed.expiresAt) throw apiError(410, "RANKED_MATCH_EXPIRED", "排位赛凭证已过期");
    const score = source.score;
    if (!score || typeof score !== "object" || Array.isArray(score)) throw apiError(400, "SCORE_INVALID", "比分格式无效");
    const mine = whole(score.mine, 0, 20);
    const opponent = whole(score.opponent, 0, 20);
    if (mine == null || opponent == null) throw apiError(400, "SCORE_INVALID", "比分必须为 0 到 20 的整数");
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
    signed.settledAt = stats.updatedAt;
    signed.score = { mine, opponent };
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
    for (const [matchId, match] of Object.entries(this.data.rankedMatches)) {
      if (match && match.userId === id) delete this.data.rankedMatches[matchId];
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

  regionalRows(metric, scopeKey, userId = "") {
    const selectedMetric = METRICS.has(metric) ? metric : "points";
    const selectedScope = validScopeKey(scopeKey);
    if (!selectedScope) throw apiError(400, "REGION_SCOPE_INVALID", "地区榜范围无效");
    const teams = new Map();
    for (const [id, rawPlayer] of Object.entries(this.data.players)) {
      const player = this.normalizePlayer(rawPlayer);
      const region = regionView(player);
      if (!region || !regionMatchesScope(region, selectedScope) || player.stats.matches < MIN_RANK_MATCHES) continue;
      const teamKey = regionalTeamKey(region);
      if (!teamKey) continue;
      const previous = teams.get(teamKey) || {
        code: teamKey,
        nickname: region.fullTeamName,
        teamName: region.fullTeamName,
        fullTeamName: region.fullTeamName,
        teamLevel: region.level,
        path: region.path,
        stats: blankStats(),
        contributors: 0,
        self: false,
      };
      mergeTeamStats(previous.stats, player.stats);
      previous.contributors += 1;
      previous.self = previous.self || id === userId;
      teams.set(teamKey, previous);
    }
    const ordered = [...teams.values()]
      .sort((left, right) => metricValue(right.stats, selectedMetric) - metricValue(left.stats, selectedMetric)
        || right.stats.points - left.stats.points
        || right.stats.matches - left.stats.matches
        || left.teamName.localeCompare(right.teamName, "zh-Hans-CN"));
    const all = ordered.map((team, index) => ({
      rank: index + 1,
      code: team.code,
      self: team.self,
      nickname: team.teamName,
      teamName: team.teamName,
      fullTeamName: team.fullTeamName,
      path: team.path,
      teamLevel: team.teamLevel,
      contributors: team.contributors,
      value: metricValue(team.stats, selectedMetric),
      stats: {
        matches: team.stats.matches,
        wins: team.stats.wins,
        goalsFor: team.stats.goalsFor,
        points: team.stats.points,
      },
    }));
    const merged = mergeRegionalSeedRows(all, selectedScope, selectedMetric, 8);
    return {
      metric: selectedMetric,
      regional: true,
      scope: {
        key: selectedScope,
        title: merged.scope.title,
      },
      rows: merged.rows.slice(0, 50),
      self: merged.rows.find((row) => row.self) || null,
    };
  }
}

export class LeaderboardService {
  constructor(options = {}) {
    this.host = options.host || "127.0.0.1";
    this.port = Number(options.port ?? 8788);
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.store = options.store || new LeaderboardStore({ file: options.dataFile, now: this.now });
    this.verifyWxCode = options.verifyWxCode || createWxCodeVerifier(options.wx || {});
    const textSecurity = createWxTextSecurityChecker(options.wx || {});
    this.checkProfileText = Object.prototype.hasOwnProperty.call(options, "checkProfileText")
      ? options.checkProfileText
      : (textSecurity.available ? textSecurity : null);
    this.trustProxy = options.trustProxy === true || process.env.TRUST_PROXY === "1";
    this.rateLimiter = options.rateLimiter || new FixedWindowRateLimiter({ now: this.now });
    this.rateLimits = Object.fromEntries(Object.entries(DEFAULT_RATE_LIMITS).map(([name, fallback]) => [
      name,
      rateLimitConfig(options.rateLimits && options.rateLimits[name], fallback),
    ]));
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
        }, error && error.retryAfter ? { "retry-after": String(error.retryAfter) } : undefined);
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

  clientAddress(request) {
    if (this.trustProxy) {
      const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
      if (forwarded) return forwarded.slice(0, 128);
    }
    return String(request.socket && request.socket.remoteAddress || "unknown").slice(0, 128);
  }

  consumeRate(request, name, subject = "") {
    const config = this.rateLimits[name];
    if (!config) return;
    const key = `${name}:${subject || this.clientAddress(request)}`;
    const result = this.rateLimiter.consume(key, config);
    if (!result.allowed) {
      const error = apiError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试");
      error.retryAfter = result.retryAfter;
      throw error;
    }
  }

  async handle(request, response) {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/v1/health") {
      return sendJson(response, 200, { ok: true, service: "rural-football-leaderboard" });
    }
    if (request.method === "POST" && url.pathname === "/v1/auth") {
      this.consumeRate(request, "auth");
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
      return sendJson(response, 200, { ok: true, token, expiresAt, profile: profileView(player), region: regionView(player), stats: normalizeStats(player.stats) });
    }
    if (request.method === "PUT" && url.pathname === "/v1/profile") {
      const body = await readJsonBody(request);
      const session = this.session(request);
      this.consumeRate(request, "profile", session.userId);
      const nickname = safeText(body && (body.nickname || body.nickName));
      if (!nickname) throw apiError(400, "PROFILE_NICKNAME_REQUIRED", "请授权有效的微信昵称后再加入排行榜");
      if (!this.checkProfileText) throw apiError(503, "CONTENT_CHECK_CONFIG_MISSING", "排行榜昵称安全检查尚未配置");
      try {
        await this.checkProfileText({ content: nickname, openid: session.userId });
      } catch (error) {
        throw mapContentSecurityError(error);
      }
      const profile = await this.store.setProfile(session.userId, body);
      return sendJson(response, 200, { ok: true, profile });
    }
    if (request.method === "PUT" && url.pathname === "/v1/region") {
      const body = await readJsonBody(request);
      const session = this.session(request);
      this.consumeRate(request, "region", session.userId);
      const customName = safeText(body && body.customName, 18);
      if (customName) {
        if (!this.checkProfileText) throw apiError(503, "CONTENT_CHECK_CONFIG_MISSING", "自定义村队名安全检查尚未配置");
        try {
          await this.checkProfileText({ content: customName, openid: session.userId });
        } catch (error) {
          throw mapContentSecurityError(error);
        }
      }
      const region = await this.store.setRegion(session.userId, body);
      return sendJson(response, 200, { ok: true, region });
    }
    if (request.method === "POST" && url.pathname === "/v1/ranked-matches") {
      const body = await readJsonBody(request);
      const session = this.session(request);
      this.consumeRate(request, "rankedIssue", session.userId);
      const match = await this.store.issueRankedMatch(session.userId, body);
      return sendJson(response, 201, { ok: true, match });
    }
    const settleMatch = url.pathname.match(/^\/v1\/ranked-matches\/([A-Za-z0-9_-]{6,128})\/result$/);
    if (request.method === "POST" && settleMatch) {
      const body = await readJsonBody(request);
      const session = this.session(request);
      this.consumeRate(request, "rankedSettle", session.userId);
      const result = await this.store.settleRankedMatch(session.userId, settleMatch[1], body);
      return sendJson(response, 200, { ok: true, ...result });
    }
    if (request.method === "POST" && url.pathname === "/v1/results") {
      throw apiError(410, "LEGACY_RESULT_DISABLED", "旧成绩直传接口已关闭，请先签发排位赛凭证");
    }
    if (request.method === "DELETE" && url.pathname === "/v1/account") {
      const session = this.session(request);
      this.consumeRate(request, "accountDelete", session.userId);
      await this.store.deletePlayer(session.userId);
      for (const [token, value] of this.sessions) {
        if (value.userId === session.userId) this.sessions.delete(token);
      }
      return sendJson(response, 200, { ok: true, deleted: true });
    }
    if (request.method === "GET" && url.pathname === "/v1/leaderboards") {
      this.consumeRate(request, "leaderboardRead");
      const header = String(request.headers.authorization || "");
      let userId = "";
      if (header) userId = this.session(request).userId;
      const scope = url.searchParams.get("scope");
      const result = scope
        ? this.store.regionalRows(url.searchParams.get("metric"), scope, userId)
        : this.store.rows(url.searchParams.get("metric"), userId);
      return sendJson(response, 200, { ok: true, ...result });
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
