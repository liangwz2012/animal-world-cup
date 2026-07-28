const STORAGE_KEY = "animal-football:season-journey:v1";
const SEASON_SIZE = 6;
const ROUND_COUNT = SEASON_SIZE - 1;
const DIFFICULTY_BY_ROUND = [0, 1, 1, 2, 2];
const TIME_BY_ROUND = [4, 6, 6, 6, 10];

function whole(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min;
}

function teamId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{1,31}$/.test(value) ? value : "";
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

function blankState(seasonNumber = 1, bestRank = 0) {
  return {
    version: 1,
    seasonNumber: whole(seasonNumber, 1),
    bestRank: whole(bestRank, 0, SEASON_SIZE),
    playerTeam: "",
    teamIds: [],
    schedule: [],
    results: [],
  };
}

function normalizeScore(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const red = whole(value[0], 0, 99);
  const blue = whole(value[1], 0, 99);
  return red === Number(value[0]) && blue === Number(value[1]) ? [red, blue] : null;
}

function normalizePair(pair, allowed) {
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const first = teamId(pair[0]);
  const second = teamId(pair[1]);
  return first && second && first !== second && allowed.has(first) && allowed.has(second) ? [first, second] : null;
}

function buildRoundRobin(teamIds) {
  const ids = [...new Set((teamIds || []).map(teamId).filter(Boolean))].slice(0, SEASON_SIZE);
  if (ids.length !== SEASON_SIZE) return [];
  const rotating = ids.slice();
  const rounds = [];
  for (let round = 0; round < ROUND_COUNT; round += 1) {
    const pairs = [];
    for (let index = 0; index < SEASON_SIZE / 2; index += 1) {
      pairs.push([rotating[index], rotating[SEASON_SIZE - 1 - index]]);
    }
    rounds.push(pairs);
    rotating.splice(1, 0, rotating.pop());
  }
  return rounds;
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const playerTeam = teamId(source.playerTeam);
  const teamIds = [...new Set(Array.isArray(source.teamIds) ? source.teamIds.map(teamId).filter(Boolean) : [])].slice(0, SEASON_SIZE);
  const allowed = new Set(teamIds);
  const schedule = Array.isArray(source.schedule)
    ? source.schedule.slice(0, ROUND_COUNT).map((round) => {
      const pairs = Array.isArray(round) ? round.map((pair) => normalizePair(pair, allowed)).filter(Boolean) : [];
      return pairs.length === SEASON_SIZE / 2 ? pairs : null;
    }).filter(Boolean)
    : [];
  const results = Array.isArray(source.results)
    ? source.results.slice(0, ROUND_COUNT).map((entry, index) => {
      const score = normalizeScore(entry && entry.score);
      const opponent = teamId(entry && entry.opponent);
      return score && opponent && schedule[index] ? { score, opponent } : null;
    }).filter(Boolean)
    : [];
  if (!playerTeam || teamIds.length !== SEASON_SIZE || !allowed.has(playerTeam) || schedule.length !== ROUND_COUNT) {
    return blankState(source.seasonNumber, source.bestRank);
  }
  return {
    version: 1,
    seasonNumber: whole(source.seasonNumber, 1),
    bestRank: whole(source.bestRank, 0, SEASON_SIZE),
    playerTeam,
    teamIds,
    schedule,
    results,
  };
}

function blankRow(id) {
  return { id, matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

function applyScore(table, first, second, firstGoals, secondGoals) {
  const one = table.get(first);
  const two = table.get(second);
  if (!one || !two) return;
  one.matches += 1;
  two.matches += 1;
  one.goalsFor += firstGoals;
  one.goalsAgainst += secondGoals;
  two.goalsFor += secondGoals;
  two.goalsAgainst += firstGoals;
  if (firstGoals > secondGoals) {
    one.wins += 1;
    two.losses += 1;
    one.points += 3;
  } else if (firstGoals < secondGoals) {
    two.wins += 1;
    one.losses += 1;
    two.points += 3;
  } else {
    one.draws += 1;
    two.draws += 1;
    one.points += 1;
    two.points += 1;
  }
}

function stableNumber(input) {
  let value = 2166136261;
  for (const char of String(input)) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function simulatedScore(seasonNumber, roundIndex, first, second) {
  const seed = stableNumber(`${seasonNumber}:${roundIndex}:${first}:${second}`);
  const firstGoals = seed % 4;
  const secondGoals = Math.floor(seed / 11) % 4;
  return [firstGoals, secondGoals];
}

function calculateStandings(state) {
  const table = new Map(state.teamIds.map((id) => [id, blankRow(id)]));
  state.results.forEach((entry, roundIndex) => {
    const pairs = state.schedule[roundIndex] || [];
    pairs.forEach((pair) => {
      if (pair.includes(state.playerTeam)) {
        const firstIsPlayer = pair[0] === state.playerTeam;
        applyScore(table, pair[0], pair[1], firstIsPlayer ? entry.score[0] : entry.score[1], firstIsPlayer ? entry.score[1] : entry.score[0]);
      } else {
        const score = simulatedScore(state.seasonNumber, roundIndex, pair[0], pair[1]);
        applyScore(table, pair[0], pair[1], score[0], score[1]);
      }
    });
  });
  return [...table.values()].sort((left, right) => {
    const leftDiff = left.goalsFor - left.goalsAgainst;
    const rightDiff = right.goalsFor - right.goalsAgainst;
    return right.points - left.points || rightDiff - leftDiff || right.goalsFor - left.goalsFor || left.id.localeCompare(right.id);
  });
}

function createSeasonJourney(options = {}) {
  const wxApi = options.wxApi || null;
  let state = normalizeState(storageGet(wxApi));

  function save() { return storageSet(wxApi, state); }

  function initialize(playerTeam, candidateTeams) {
    const selectedPlayer = teamId(playerTeam);
    const allTeams = [...new Set((candidateTeams || []).map(teamId).filter(Boolean))];
    const selected = [selectedPlayer, ...allTeams.filter((id) => id !== selectedPlayer)].slice(0, SEASON_SIZE);
    if (!selectedPlayer || selected.length !== SEASON_SIZE) throw new Error("赛季队伍不足，无法开始");
    state = Object.assign(blankState(state.seasonNumber, state.bestRank), {
      playerTeam: selectedPlayer,
      teamIds: selected,
      schedule: buildRoundRobin(selected),
    });
    save();
  }

  function currentRound() {
    if (!state.playerTeam || !state.schedule.length) return null;
    const roundIndex = state.results.length;
    if (roundIndex >= ROUND_COUNT) return null;
    const pairs = state.schedule[roundIndex];
    const pair = pairs.find((item) => item.includes(state.playerTeam));
    if (!pair) return null;
    return {
      index: roundIndex,
      number: roundIndex + 1,
      opponent: pair[0] === state.playerTeam ? pair[1] : pair[0],
      ai: DIFFICULTY_BY_ROUND[roundIndex],
      time: TIME_BY_ROUND[roundIndex],
    };
  }

  function snapshot() {
    const standings = state.playerTeam ? calculateStandings(state) : [];
    const rank = standings.findIndex((row) => row.id === state.playerTeam) + 1;
    const mine = standings.find((row) => row.id === state.playerTeam) || blankRow(state.playerTeam || "");
    return {
      seasonNumber: state.seasonNumber,
      playerTeam: state.playerTeam,
      completedRounds: state.results.length,
      totalRounds: ROUND_COUNT,
      nextRound: currentRound(),
      complete: state.results.length >= ROUND_COUNT,
      rank: rank || 0,
      bestRank: state.bestRank,
      stats: mine,
      standings,
    };
  }

  function prepareMatch(input = {}) {
    const selectedTeam = teamId(input.teamId);
    if (!state.playerTeam) initialize(selectedTeam, input.teamIds);
    const round = currentRound();
    if (!round) throw new Error("当前赛季已经完成，请开始新赛季");
    return {
      journeyMode: "season",
      campaignMatchId: `season-${state.seasonNumber}-round-${round.number}`,
      matchId: `season-${state.seasonNumber}-round-${round.number}`,
      redTeam: state.playerTeam,
      blueTeam: round.opponent,
      redFormation: input.redFormation,
      blueFormation: input.blueFormation,
      side: "home",
      mode: "ai",
      ai: round.ai,
      time: round.time,
    };
  }

  function recordMatch(detail, config) {
    if (!config || config.journeyMode !== "season") return { accepted: false, reason: "wrong_mode", snapshot: snapshot() };
    const round = currentRound();
    const score = normalizeScore(detail && detail.score);
    if (!round || !score || config.campaignMatchId !== `season-${state.seasonNumber}-round-${round.number}`) {
      return { accepted: false, reason: "invalid_result", snapshot: snapshot() };
    }
    state.results.push({ score, opponent: round.opponent });
    const standings = calculateStandings(state);
    const rank = standings.findIndex((row) => row.id === state.playerTeam) + 1;
    if (state.results.length >= ROUND_COUNT && rank) state.bestRank = state.bestRank ? Math.min(state.bestRank, rank) : rank;
    save();
    return {
      accepted: true,
      completed: state.results.length >= ROUND_COUNT,
      rank,
      snapshot: snapshot(),
    };
  }

  function startNextSeason() {
    if (state.results.length < ROUND_COUNT) return { accepted: false, reason: "season_incomplete", snapshot: snapshot() };
    state = blankState(state.seasonNumber + 1, state.bestRank);
    save();
    return { accepted: true, snapshot: snapshot() };
  }

  return { snapshot, prepareMatch, recordMatch, startNextSeason, clear() { state = blankState(); save(); return snapshot(); } };
}

module.exports = { STORAGE_KEY, ROUND_COUNT, buildRoundRobin, calculateStandings, createSeasonJourney };
