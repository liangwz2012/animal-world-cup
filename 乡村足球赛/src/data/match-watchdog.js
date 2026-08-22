// 比赛中「球员卡死」看门狗。真机独有的渲染/状态异常可能让个别外场球员整场钉在原地，
// 无头仿真证明引擎 AI 本身不存在该问题，因此用看门狗兜底：活球期间非门将球员
// 连续 N 秒未移动就强制归位（forceAI + ReturnHome），并把日志打进 vConsole 供定位。
// 只触碰 AI 状态机，不改渲染与碰撞；当前被人类操控的球员跳过（用户不摸屏是合法的）。
const DEFAULTS = {
  intervalMs: 1000,
  // 阈值标定：无头仿真的健康活球窗口最长约 9.6s（ GK 除外）；真机"整场钉死"的
  // 异常必然超过 20s。取 20s：宁可慢几秒恢复，也绝不错伤正常战术站位。
  staticSeconds: 20,
  minMoveMeters: 0.5,
  // 同一球员单场最多恢复 3 次：恢复后理应回到 AI 流；反复命中说明问题更深，
  // 停止骚扰，只留日志。
  maxRecoveriesPerPlayer: 3,
  // 开赛 N 秒后对全体外场球员做一次巡检日志：谁动没动、有没有渲染器、精灵是否脱钩。
  // 真机复现"球员钉死"时，这一条 vConsole 日志直接区分 实体卡死 / 渲染脱钩 两种根因。
  inspectSeconds: 20,
  desyncSeconds: 10,
  desyncMoveMeters: 2,
};

function createMatchWatchdog(options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  const getGame = opts.getGame || (() => null);
  const getPlayerGlobals = opts.getPlayerGlobals || (() => null);
  const getPlayerStates = opts.getPlayerStates || (() => null);
  const getUsers = opts.getUsers || (() => null);
  const getRenderers = opts.getRenderers || null;
  const logger = opts.logger || console;
  let timer = null;
  let positions = new Map();
  let recoveredTotal = 0;
  let recoveredPerPlayer = new Map();
  let liveSeconds = 0;
  let distanceCovered = new Map();
  let inspected = false;
  const rendererPositions = new Map();
  const desyncLogged = new Set();

  function isLive(pitch) {
    return !!(pitch && pitch.matchStarted && !pitch.ballOutOfPlay && !pitch.paused);
  }

  function inspect(pitch) {
    inspected = true;
    const renderers = typeof getRenderers === "function" ? getRenderers() : null;
    const rendererByPlayer = new Map();
    if (Array.isArray(renderers)) {
      for (const entry of renderers) {
        if (entry && entry.player && entry.renderer) rendererByPlayer.set(entry.player.id, entry.renderer);
      }
    }
    const lines = [];
    for (const team of [pitch.redTeam, pitch.blueTeam]) {
      for (const player of (team && team.allPlayers) || []) {
        if (!player || !player.position) continue;
        const renderer = rendererByPlayer.get(player.id);
        const covered = distanceCovered.get(player.id) || 0;
        lines.push(`id${player.id}${player.isGoalkeeper ? "(GK)" : ""} 跑动${covered.toFixed(1)}m 渲染器=${renderer ? "在" : "缺"}`);
      }
    }
    logger.warn(`[match-watchdog] 阵容巡检: ${lines.join(" | ")}`);
  }

  function checkDesync(player, at) {
    if (typeof getRenderers !== "function") return;
    const covered = distanceCovered.get(player.id) || 0;
    if (covered < opts.desyncMoveMeters) return;
    const renderers = getRenderers();
    if (!Array.isArray(renderers)) return;
    const hit = renderers.find((entry) => entry && entry.player === player);
    if (!hit || !hit.renderer) return;
    const position = hit.renderer.position || { x: 0, y: 0 };
    const last = rendererPositions.get(player.id);
    if (last && (last.x !== position.x || last.y !== position.y)) {
      rendererPositions.set(player.id, { x: position.x, y: position.y, since: at });
      return;
    }
    if (!last) {
      rendererPositions.set(player.id, { x: position.x, y: position.y, since: at });
      return;
    }
    const idleSeconds = (at - last.since) / 1000;
    if (idleSeconds >= opts.desyncSeconds && !desyncLogged.has(player.id)) {
      desyncLogged.add(player.id);
      logger.warn(`[match-watchdog] 渲染脱钩嫌疑：球员 id=${player.id} 实体已跑动 ${covered.toFixed(1)}m，但精灵 ${idleSeconds.toFixed(0)}s 未移动——根因在渲染绑定层，不在 AI`);
    }
  }

  function recover(player, idleSeconds) {
    const count = recoveredPerPlayer.get(player.id) || 0;
    if (count >= opts.maxRecoveriesPerPlayer) return;
    recoveredPerPlayer.set(player.id, count + 1);
    recoveredTotal += 1;
    logger.warn(`[match-watchdog] 球员 id=${player.id} 活球中 ${idleSeconds.toFixed(1)}s 未移动，执行归位恢复（第 ${count + 1} 次/本场该球员）`);
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
    const at = typeof now === "number" ? now : Date.now();
    liveSeconds += 1;
    eachFieldPlayer(pitch, (player) => {
      const last = positions.get(player.id);
      const moved = last
        ? Math.hypot(player.position.x - last.x, player.position.y - last.y) > opts.minMoveMeters
        : false;
      if (last) {
        distanceCovered.set(player.id, (distanceCovered.get(player.id) || 0)
          + Math.hypot(player.position.x - last.x, player.position.y - last.y));
      }
      if (!last || moved) {
        positions.set(player.id, { x: player.position.x, y: player.position.y, since: at });
        checkDesync(player, at);
        return;
      }
      const idleSeconds = (at - last.since) / 1000;
      if (idleSeconds >= opts.staticSeconds) {
        recover(player, idleSeconds);
        positions.set(player.id, { x: player.position.x, y: player.position.y, since: at });
      }
    });
    if (!inspected && liveSeconds >= opts.inspectSeconds) inspect(pitch);
  }

  return {
    start() {
      if (timer) return;
      positions = new Map();
      recoveredPerPlayer = new Map();
      liveSeconds = 0;
      distanceCovered = new Map();
      inspected = false;
      timer = setInterval(() => tick(Date.now()), opts.intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      positions = new Map();
      recoveredPerPlayer = new Map();
      liveSeconds = 0;
      distanceCovered = new Map();
      inspected = false;
    },
    isRunning() { return !!timer; },
    recoveries() { return recoveredTotal; },
    tick,
  };
}

module.exports = { createMatchWatchdog };
