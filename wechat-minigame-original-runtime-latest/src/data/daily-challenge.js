const STORAGE_KEY = "animal-football:daily-challenge:v1";
const HISTORY_LIMIT = 7;
const HOME_TEAM = "england";
const TEAM_POOL = ["france", "germany", "spain", "portugal", "brazil", "argentina", "usa"];
const THEMES = ["决胜一球", "稳守反击", "进球挑战"];

function whole(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min;
}

function localDayKey(now) {
  const date = now instanceof Date ? now : new Date(now || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function stableNumber(input) {
  let value = 2166136261;
  for (const char of String(input)) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function challengeForDate(date) {
  const key = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDayKey();
  const seed = stableNumber(key);
  return {
    id: `daily-${key}`,
    date: key,
    theme: THEMES[seed % THEMES.length],
    redTeam: HOME_TEAM,
    blueTeam: TEAM_POOL[Math.floor(seed / 7) % TEAM_POOL.length],
    ai: Math.floor(seed / 31) % 3,
    time: [4, 6, 6][Math.floor(seed / 97) % 3],
    targetDifference: 1,
  };
}

function storageGet(wxApi) {
  try { return wxApi && wxApi.getStorageSync ? wxApi.getStorageSync(STORAGE_KEY) : null; } catch (error) { return null; }
}

function storageSet(wxApi, value) {
  try {
    if (wxApi && wxApi.setStorageSync) wxApi.setStorageSync(STORAGE_KEY, value);
    return true;
  } catch (error) { return false; }
}

function normalizeCandidate(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    complete: !!source.complete,
    difference: whole(source.difference, -99, 99),
    goals: whole(source.goals, 0, 99),
    elapsedMs: whole(source.elapsedMs, 0, 8 * 60 * 60 * 1000),
    achievedAt: whole(source.achievedAt, 0),
  };
}

function isBetter(candidate, best) {
  if (!best) return true;
  if (candidate.complete !== best.complete) return candidate.complete;
  if (candidate.difference !== best.difference) return candidate.difference > best.difference;
  if (candidate.goals !== best.goals) return candidate.goals > best.goals;
  if (candidate.elapsedMs !== best.elapsedMs) return candidate.elapsedMs < best.elapsedMs;
  return candidate.achievedAt < best.achievedAt;
}

function normalizeEntry(input) {
  const source = input && typeof input === "object" ? input : {};
  const challenge = challengeForDate(source.date);
  if (source.id !== challenge.id) return null;
  const settledIds = Array.isArray(source.settledIds)
    ? [...new Set(source.settledIds.filter((id) => typeof id === "string" && id.startsWith(`${challenge.id}-a`)))].slice(-60)
    : [];
  return {
    id: challenge.id,
    date: challenge.date,
    attempts: whole(source.attempts, 0, 9999),
    settledIds,
    best: source.best ? normalizeCandidate(source.best) : null,
  };
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const entries = Array.isArray(source.history) ? source.history.map(normalizeEntry).filter(Boolean) : [];
  entries.sort((left, right) => right.date.localeCompare(left.date));
  return { version: 1, history: entries.slice(0, HISTORY_LIMIT) };
}

function createDailyChallenge(options = {}) {
  const wxApi = options.wxApi || null;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const getDayKey = typeof options.dayKey === "function" ? options.dayKey : () => localDayKey(now());
  let state = normalizeState(storageGet(wxApi));

  function save() { return storageSet(wxApi, state); }

  function entryForToday() {
    const challenge = challengeForDate(getDayKey());
    let entry = state.history.find((item) => item.id === challenge.id);
    if (!entry) {
      entry = { id: challenge.id, date: challenge.date, attempts: 0, settledIds: [], best: null };
      state.history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
      save();
    }
    return entry;
  }

  function snapshot() {
    const challenge = challengeForDate(getDayKey());
    const entry = state.history.find((item) => item.id === challenge.id) || null;
    return {
      challenge,
      attempts: entry ? entry.attempts : 0,
      best: entry && entry.best ? Object.assign({}, entry.best) : null,
      history: state.history.map((item) => ({
        challenge: challengeForDate(item.date),
        attempts: item.attempts,
        best: item.best ? Object.assign({}, item.best) : null,
      })),
    };
  }

  function prepareMatch() {
    const entry = entryForToday();
    entry.attempts += 1;
    const attemptId = `${entry.id}-a${entry.attempts}`;
    save();
    const challenge = challengeForDate(entry.date);
    return Object.assign({}, challenge, {
      journeyMode: "daily",
      challengeId: entry.id,
      dailyAttemptId: attemptId,
      matchId: attemptId,
      mode: "ai",
      side: "home",
    });
  }

  function recordMatch(detail, config, meta = {}) {
    if (!config || config.journeyMode !== "daily") return { accepted: false, reason: "wrong_mode", snapshot: snapshot() };
    const challenge = challengeForDate(getDayKey());
    if (config.challengeId !== challenge.id || typeof config.dailyAttemptId !== "string") {
      return { accepted: false, reason: "stale_challenge", snapshot: snapshot() };
    }
    const score = Array.isArray(detail && detail.score) ? detail.score : null;
    const mine = whole(score && score[0], 0, 99);
    const opponent = whole(score && score[1], 0, 99);
    if (!score || mine !== Number(score[0]) || opponent !== Number(score[1])) {
      return { accepted: false, reason: "invalid_score", snapshot: snapshot() };
    }
    const entry = entryForToday();
    if (entry.settledIds.includes(config.dailyAttemptId)) return { accepted: false, reason: "duplicate", snapshot: snapshot() };
    const difference = mine - opponent;
    const candidate = {
      complete: difference >= challenge.targetDifference,
      difference,
      goals: mine,
      elapsedMs: whole(meta.elapsedMs, 0, 8 * 60 * 60 * 1000),
      achievedAt: whole(now(), 0),
    };
    const improved = isBetter(candidate, entry.best);
    if (improved) entry.best = candidate;
    entry.settledIds = [...entry.settledIds, config.dailyAttemptId].slice(-60);
    save();
    return { accepted: true, improved, candidate, snapshot: snapshot() };
  }

  return { snapshot, prepareMatch, recordMatch, clear() { state = { version: 1, history: [] }; save(); return snapshot(); } };
}

module.exports = { STORAGE_KEY, HISTORY_LIMIT, localDayKey, challengeForDate, isBetter, createDailyChallenge };
