// 比赛中「球员卡死」看门狗。真机独有的渲染/状态异常可能让个别外场球员整场钉在原地，
// 无头仿真证明引擎 AI 本身不存在该问题，因此用看门狗兜底：活球期间非门将球员
// 连续 N 秒未移动就强制归位（forceAI + ReturnHome），并把日志打进 vConsole 供定位。
// 只触碰 AI 状态机，不改渲染与碰撞；当前被人类操控的球员跳过（用户不摸屏是合法的）。
const DEFAULTS = {
  intervalMs: 1000,
  staticSeconds: 10,
  minMoveMeters: 0.5,
};

function createMatchWatchdog(options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  const getGame = opts.getGame || (() => null);
  const getPlayerGlobals = opts.getPlayerGlobals || (() => null);
  const getPlayerStates = opts.getPlayerStates || (() => null);
  const getUsers = opts.getUsers || (() => null);
  const logger = opts.logger || console;
  let timer = null;
  let positions = new Map();
  let recoveredTotal = 0;

  function isLive(pitch) {
    return !!(pitch && pitch.matchStarted && !pitch.ballOutOfPlay && !pitch.paused);
  }

  function recover(player, idleSeconds) {
    recoveredTotal += 1;
    logger.warn(`[match-watchdog] 球员 id=${player.id} 活球中 ${idleSeconds.toFixed(1)}s 未移动，执行归位恢复（第 ${recoveredTotal} 次）`);
    try {
      const globals = getPlayerGlobals();
      const states = getPlayerStates();
      if (globals && typeof globals.forceAI === "function") globals.forceAI(player, null);
      if (states && states.ReturnHome && player.states && typeof player.states.change === "function") {
        player.states.change(states.ReturnHome);
      }
    } catch (error) {
      logger.warn("[match-watchdog] 归位恢复失败（已忽略，不中断比赛）", error && error.message || error);
    }
  }

  function eachFieldPlayer(pitch, fn) {
    const users = getUsers();
    const list = users && users.list || [];
    for (const team of [pitch.redTeam, pitch.blueTeam]) {
      const players = team && team.allPlayers || [];
      for (const player of players) {
        if (!player || player.isGoalkeeper || !player.position) continue;
        // 当前被任一用户操控的球员跳过：站着不动是用户的合法选择。
        if (list.some((user) => user && user.player === player)) continue;
        fn(player);
      }
    }
  }

  function tick(now) {
    const game = getGame();
    const pitch = game && game.pitch;
    if (!isLive(pitch)) return;
    const at = Number(now) || Date.now();
    eachFieldPlayer(pitch, (player) => {
      const last = positions.get(player.id);
      const moved = last
        ? Math.hypot(player.position.x - last.x, player.position.y - last.y) > opts.minMoveMeters
        : false;
      if (!last || moved) {
        positions.set(player.id, { x: player.position.x, y: player.position.y, since: at });
        return;
      }
      const idleSeconds = (at - last.since) / 1000;
      if (idleSeconds >= opts.staticSeconds) {
        recover(player, idleSeconds);
        positions.set(player.id, { x: player.position.x, y: player.position.y, since: at });
      }
    });
  }

  return {
    start() {
      if (timer) return;
      positions = new Map();
      timer = setInterval(() => tick(Date.now()), opts.intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      positions = new Map();
    },
    isRunning() { return !!timer; },
    recoveries() { return recoveredTotal; },
    tick,
  };
}

module.exports = { createMatchWatchdog };
